"""Real HTTP + native-process speech roundtrip, using synthetic input only."""
import io,json,time,wave
from pathlib import Path
import httpx
import numpy as np

root=Path(__file__).resolve().parents[1]
with httpx.Client(base_url='http://127.0.0.1:8001/api',timeout=90) as client:
    status=client.get('/voice/status');status.raise_for_status();assert status.json()['ready']
    response=client.post('/voice/warm');response.raise_for_status()
    measurements=[]
    for text in ['What is the time complexity of binary search in Python?','How would you handle collisions in a hash map?']:
        started=time.perf_counter();spoken=client.post('/voice/speak',json={'text':text,'voice':'piper_lessac','speed':1});spoken.raise_for_status()
        elapsed=round((time.perf_counter()-started)*1000)
        with wave.open(io.BytesIO(spoken.content),'rb') as audio:
            rate=audio.getframerate();samples=np.frombuffer(audio.readframes(audio.getnframes()),dtype='<i2').astype('float32')/32768
        converted=np.interp(np.arange(int(len(samples)*16000/rate))*rate/16000,np.arange(len(samples)),samples)
        recording=io.BytesIO()
        with wave.open(recording,'wb') as audio:
            audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(16000);audio.writeframes((converted*32767).astype('<i2').tobytes())
        started=time.perf_counter();recognized=client.post('/voice/transcribe',content=recording.getvalue(),headers={'Content-Type':'audio/wav'});recognized.raise_for_status()
        item={'text':text,'spoken_ms':elapsed,'transcribed_ms':round((time.perf_counter()-started)*1000),'recognition':recognized.json()};measurements.append(item)
        print(json.dumps(item),flush=True)
        assert 'binary search' in item['recognition']['text'].lower() if 'binary' in text else 'hash map' in item['recognition']['text'].lower()
    invalid=client.post('/voice/transcribe',content=b'bad wav',headers={'Content-Type':'audio/wav'});assert invalid.status_code==422
    assert client.get('/health').status_code==200
    (root/'data/voice-http-verification.json').write_text(json.dumps(measurements,indent=2),encoding='utf-8')
