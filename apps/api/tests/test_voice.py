import asyncio
import io
import threading
import wave
import os

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest

from app.voice import BusyWorker, SpeechEngines, SpeechInput, VoiceService, voice_router

def test_cancel_does_not_release_native_work_slot():
    async def check():
        worker = BusyWorker('test')
        entered, release = threading.Event(), threading.Event()
        def work():
            entered.set(); release.wait(5)
            return 'finished'
        task = asyncio.create_task(worker.run(work))
        while not entered.is_set():
            await asyncio.sleep(.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        with pytest.raises(HTTPException) as caught:
            await worker.run(lambda: 'must not start')
        assert caught.value.status_code == 409
        release.set()
        while worker.busy:
            await asyncio.sleep(.01)
        assert await worker.run(lambda: 'next') == 'next'
        worker.close()
    asyncio.run(check())

def test_native_worker_crash_is_isolated_and_recoverable():
    async def check():
        worker = BusyWorker('crash-test', native=True)
        try:
            with pytest.raises(HTTPException) as caught:
                await worker.run(os._exit, 17)
            assert caught.value.status_code == 503
            assert await worker.run(abs, -7) == 7
        finally:
            worker.close()
    asyncio.run(check())

def test_bad_audio_never_loads_recognition_model():
    engine = SpeechEngines()
    with pytest.raises(HTTPException):
        engine.transcribe(b'not a recording')
    assert engine.recognizer is None
    recording = io.BytesIO()
    with wave.open(recording, 'wb') as audio:
        audio.setnchannels(2); audio.setsampwidth(2); audio.setframerate(44100)
        audio.writeframes(bytes(16000))
    with pytest.raises(HTTPException):
        engine.transcribe(recording.getvalue())
    assert engine.recognizer is None

def test_api_bounds_and_plain_speech_contract(monkeypatch):
    service = VoiceService()
    monkeypatch.setattr(service, 'require_ready', lambda: None)
    app = FastAPI(); app.include_router(voice_router(service))
    with TestClient(app) as client:
        assert client.post('/api/voice/transcribe',content=b'a',headers={'Content-Type':'text/plain'}).status_code==415
        assert client.post('/api/voice/transcribe',content=b'a'*4_000_001,headers={'Content-Type':'audio/wav'}).status_code==413
        for text in [' ', '```python\nprint(1)```', '{"question":"Hello"}']:
            assert client.post('/api/voice/speak',json={'text':text}).status_code==422
        assert client.post('/api/voice/speak',json={'text':'a'*601}).status_code==422
        assert client.post('/api/voice/speak',json={'text':'Hello','voice':'untrusted/path'}).status_code==422
        assert client.post('/api/voice/speak',json={'text':'Hello','speed':5}).status_code==422
    service.close()

def test_absent_models_report_setup_instead_of_downloading(tmp_path,monkeypatch):
    monkeypatch.setenv('REHEARSAL_VOICE_DIR',str(tmp_path))
    engine = SpeechEngines()
    assert engine.status()['ready'] is False
    with pytest.raises(HTTPException) as caught:
        engine.require_ready()
    assert caught.value.status_code == 503
