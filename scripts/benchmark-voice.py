"""Offline CPU engine smoke test. Synthetic speech is not an accent/real-mic test."""
import io
import json
import os
from pathlib import Path
import sys
import wave

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/api'))
from app.voice import VoiceService

def main():
    def no_network(event, args):
        if event == 'socket.connect':
            raise RuntimeError('Network is blocked during the offline speech benchmark.')
    sys.addaudithook(no_network)
    service = VoiceService()
    print(json.dumps(service.status()), flush=True)
    evidence=[]
    # Cold + warm measurements, including domain vocabulary.
    for index, text in enumerate([
        'How would you handle collisions in a hash map?',
        'What is the time complexity of binary search in Python?',
        'Explain how you would test this function with an empty input.',
    ]):
        raw, elapsed = service.synthesize(text, 'piper_lessac', 1)
        with wave.open(io.BytesIO(raw), 'rb') as audio:
            import numpy as np
            samples=np.frombuffer(audio.readframes(audio.getnframes()),dtype='<i2').astype('float32')/32768
            rate=audio.getframerate()
        # Linear resampling is sufficient for this synthetic pipeline check.
        converted=np.interp(np.arange(int(len(samples)*16000/rate))*rate/16000,np.arange(len(samples)),samples)
        recording=io.BytesIO()
        with wave.open(recording,'wb') as audio:
            audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(16000)
            audio.writeframes((converted*32767).astype('<i2').tobytes())
        result=service.transcribe(recording.getvalue())
        item={'input':text,'tts_ms':elapsed,'audio_seconds':round(len(samples)/rate,2),'stt':result}
        evidence.append(item);print(json.dumps(item),flush=True)
        if index==1:
            destination=Path(__file__).resolve().parents[1]/'data/voice-sample.wav'
            destination.write_bytes(raw)
    (Path(__file__).resolve().parents[1]/'data/voice-benchmark.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
    service.close()

if __name__=='__main__':main()
