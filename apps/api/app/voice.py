"""Local speech with independent, bounded CPU workers. No audio persistence."""
import asyncio
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from importlib.util import find_spec
import io
import json
import logging
import multiprocessing
import os
from pathlib import Path
import threading
import time
import wave

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import Literal

VOICES = {'piper_lessac': 'Lessac · quick response', 'af_heart': 'Heart · expressive, slower', 'af_bella': 'Bella · expressive, slower', 'am_michael': 'Michael · expressive, slower', 'bf_emma': 'Emma · British, slower', 'bm_george': 'George · British, slower'}
PIPER_MODEL = 'piper/en/en_US/lessac/medium/en_US-lessac-medium.onnx'
MAX_BYTES = 4_000_000
MAX_SECONDS = 90
_runtime_handles = []

def model_root():
    return Path(os.environ.get('REHEARSAL_VOICE_DIR', Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'Rehearsal' / 'voice'))

def prepare_runtime():
    # App-local Microsoft runtime, if provisioned; never replace Windows DLLs.
    if os.name == 'nt' and not _runtime_handles:
        import ctypes
        folder = model_root() / 'runtime'
        names = ('vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll')
        if all((folder / name).is_file() for name in names):
            _runtime_handles.extend(ctypes.WinDLL(str(folder / name)) for name in names)

class SpeechInput(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    voice: Literal['piper_lessac','af_heart','af_bella','am_michael','bf_emma','bm_george'] = 'piper_lessac'
    speed: float = Field(default=1, ge=0.8, le=1.3)

class BusyWorker:
    def __init__(self, name, native=False):
        self.name, self.native = name, native
        self.executor = self.create_executor()
        self.lock = threading.Lock()
        self.busy = False

    def create_executor(self):
        return ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context('spawn')) if self.native else ThreadPoolExecutor(max_workers=1, thread_name_prefix=self.name)

    async def run(self, function, *args):
        with self.lock:
            if self.busy:
                raise HTTPException(409, 'Speech engine is finishing another request. Please try again in a moment.')
            self.busy = True
        try:
            future = self.executor.submit(function, *args)
        except BrokenProcessPool:
            with self.lock:
                self.busy = False
                self.executor.shutdown(wait=False, cancel_futures=True)
                self.executor = self.create_executor()
            raise HTTPException(503, 'The local speech worker is restarting. Your interview is safe; retry speech.')
        except BaseException:
            with self.lock:
                self.busy = False
            raise
        def released(_):
            with self.lock:
                self.busy = False
        future.add_done_callback(released)
        # Cancelling an HTTP request must not free the slot while native CPU work continues.
        try:
            result = await asyncio.shield(asyncio.wrap_future(future))
            if isinstance(result, dict) and '_voice_error' in result:
                raise HTTPException(result['status'], result['_voice_error'])
            return result
        except BrokenProcessPool:
            with self.lock:
                self.executor.shutdown(wait=False, cancel_futures=True)
                self.executor = self.create_executor()
            raise HTTPException(503, 'The local speech worker stopped. Your interview is safe; retry speech or use typing.')

    def close(self):
        self.executor.shutdown(wait=False, cancel_futures=True)

class SpeechEngines:
    def __init__(self):
        self.recognizer = self.speaker = self.quick_speaker = None
        self.threads = max(1, min(4, int(os.getenv('REHEARSAL_VOICE_THREADS', '2'))))

    def status(self):
        root = model_root()
        packages = all(find_spec(name) is not None for name in ('faster_whisper', 'kokoro_onnx', 'piper'))
        models = all((root / name).is_file() for name in ('kokoro-v1.0.onnx', 'voices-v1.0.bin', 'espeak-ng-data/phontab', 'piper-data/phontab', PIPER_MODEL, PIPER_MODEL+'.json', 'base.en/model.bin', 'base.en/config.json', 'base.en/tokenizer.json', 'base.en/vocabulary.txt'))
        return {'ready': packages and models, 'installed': packages, 'models': models, 'recognition': 'Whisper base.en · CPU int8', 'synthesis': 'Piper quick / Kokoro expressive · CPU', 'loaded': {'recognition': self.recognizer is not None, 'synthesis': self.speaker is not None or self.quick_speaker is not None}, 'voices': VOICES, 'max_seconds': MAX_SECONDS, 'message': 'Speech stays on this computer. First use warms the models.' if packages and models else 'Run scripts/setup-voice.py after installing apps/api/requirements-voice.txt.'}

    def require_ready(self):
        if not self.status()['ready']:
            raise HTTPException(503, self.status()['message'])

    def transcribe(self, raw):
        prepare_runtime()
        import numpy as np
        try:
            with wave.open(io.BytesIO(raw), 'rb') as recording:
                if recording.getnchannels() != 1 or recording.getsampwidth() != 2 or recording.getframerate() != 16000 or recording.getcomptype() != 'NONE':
                    raise ValueError()
                count = recording.getnframes()
                if count < 3200 or count > MAX_SECONDS * 16000:
                    raise ValueError()
                pcm = recording.readframes(count)
                if len(pcm) != count * 2:
                    raise ValueError()
                audio = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
        except (wave.Error, EOFError, ValueError):
            raise HTTPException(422, 'Record 0.2–90 seconds of mono 16 kHz PCM audio.')
        started = time.perf_counter()
        if self.recognizer is None:
            from faster_whisper import WhisperModel
            self.recognizer = WhisperModel(str(model_root() / 'base.en'), device='cpu', compute_type='int8', cpu_threads=self.threads, num_workers=1, local_files_only=True)
        segments, info = self.recognizer.transcribe(audio, language='en', task='transcribe', beam_size=3,
            condition_on_previous_text=False, vad_filter=True,
            vad_parameters={'min_silence_duration_ms': 350}, initial_prompt='Technical interview: Python, SQL, API, hash map, binary search, complexity, database, Docker.')
        # Whisper already combines no-speech probability and log probability.
        # An additional independent cutoff can discard confident accented speech.
        pieces = [part.text.strip() for part in segments if part.text.strip()]
        return {'text': ' '.join(pieces), 'seconds': len(audio) / 16000, 'processing_ms': round((time.perf_counter()-started)*1000), 'language': 'en'}

    def synthesize(self, text, voice, speed):
        prepare_runtime()
        import numpy as np
        started = time.perf_counter()
        if voice == 'piper_lessac':
            import onnxruntime as rt
            from piper import PiperVoice, SynthesisConfig
            from piper.config import PiperConfig
            self.speaker = None
            if self.quick_speaker is None:
                options = rt.SessionOptions(); options.intra_op_num_threads = self.threads; options.inter_op_num_threads = 1
                model = model_root() / PIPER_MODEL
                self.quick_speaker = PiperVoice(config=PiperConfig.from_dict(json.loads(Path(str(model)+'.json').read_text(encoding='utf-8'))), session=rt.InferenceSession(str(model),sess_options=options,providers=['CPUExecutionProvider']), espeak_data_dir=model_root()/'piper-data')
            output = io.BytesIO()
            with wave.open(output,'wb') as audio:
                self.quick_speaker.synthesize_wav(text,audio,SynthesisConfig(length_scale=1/speed))
            return output.getvalue(), round((time.perf_counter()-started)*1000)
        self.quick_speaker = None
        if self.speaker is None:
            import onnxruntime as rt
            from kokoro_onnx import Kokoro
            from kokoro_onnx.config import EspeakConfig
            options = rt.SessionOptions()
            options.intra_op_num_threads = self.threads
            options.inter_op_num_threads = 1
            filename = os.getenv('REHEARSAL_TTS_MODEL', 'kokoro-v1.0.onnx')
            if filename not in {'kokoro-v1.0.int8.onnx', 'kokoro-v1.0.onnx'}:
                raise ValueError('Unsupported voice model.')
            session = rt.InferenceSession(str(model_root() / filename), sess_options=options, providers=['CPUExecutionProvider'])
            if not (model_root() / 'espeak-ng-data' / 'phontab').is_file():
                raise RuntimeError('Speech pronunciation data is missing. Run scripts/setup-voice.py again.')
            self.speaker = Kokoro.from_session(session, str(model_root() / 'voices-v1.0.bin'), espeak_config=EspeakConfig(data_path=str(model_root())))
        samples, rate = self.speaker.create(text, voice=voice, speed=speed, lang='en-gb' if voice.startswith('b') else 'en-us')
        output = io.BytesIO()
        with wave.open(output, 'wb') as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(rate)
            audio.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())
        return output.getvalue(), round((time.perf_counter()-started)*1000)

_engines = None

def _infer(task, *args):
    global _engines
    if _engines is None:
        _engines = SpeechEngines()
    if task == 'warm_stt':
        silence = io.BytesIO()
        with wave.open(silence, 'wb') as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(16000)
            audio.writeframes(bytes(8000))
        return _engines.transcribe(silence.getvalue())
    if task == 'transcribe':
        return _engines.transcribe(*args)
    return _engines.synthesize(*args)

def infer(task, *args):
    # HTTPException itself is not safely picklable across Windows spawn workers.
    try:
        return _infer(task, *args)
    except HTTPException as error:
        return {'_voice_error': error.detail, 'status': error.status_code}
    except Exception:
        logging.getLogger(__name__).exception('Local speech worker failed')
        return {'_voice_error': 'Local speech could not finish. Retry, or use typing. Check the local speech setup if this continues.', 'status': 503}

class VoiceService(SpeechEngines):
    def __init__(self):
        super().__init__()
        self.stt_worker, self.tts_worker = BusyWorker('voice-stt', True), BusyWorker('voice-tts', True)

    def close(self):
        self.stt_worker.close(); self.tts_worker.close()

def voice_router(service):
    router = APIRouter(prefix='/api/voice', tags=['local voice'])

    @router.get('/status')
    async def status():
        return service.status()

    @router.post('/warm')
    async def warm():
        service.require_ready()
        jobs = []
        if service.recognizer is None:
            jobs.append(service.stt_worker.run(infer, 'warm_stt'))
        if service.speaker is None:
            jobs.append(service.tts_worker.run(infer, 'synthesize', 'Hello.', 'piper_lessac', 1))
        await asyncio.gather(*jobs)
        service.recognizer = service.speaker = True
        return service.status()

    @router.post('/transcribe')
    async def transcribe(request: Request):
        service.require_ready()
        if request.headers.get('content-type', '').split(';')[0] != 'audio/wav':
            raise HTTPException(415, 'Use audio/wav.')
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > MAX_BYTES:
                raise HTTPException(413, 'Recording too large. Maximum duration is 90 seconds.')
        result = await service.stt_worker.run(infer, 'transcribe', bytes(data))
        service.recognizer = True
        return result

    @router.post('/speak')
    async def speak(body: SpeechInput):
        service.require_ready()
        text = body.text.strip()
        if not text or any(value in text for value in ('```', '<script', '{"', '"question":')):
            raise HTTPException(422, 'Speech needs plain interview text, not code or response metadata.')
        audio, elapsed = await service.tts_worker.run(infer, 'synthesize', text, body.voice, body.speed)
        service.speaker = True
        return Response(audio, media_type='audio/wav', headers={'Cache-Control':'no-store', 'X-Speech-Processing-Ms': str(elapsed)})

    return router
