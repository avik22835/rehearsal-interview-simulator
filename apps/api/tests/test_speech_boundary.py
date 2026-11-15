import asyncio
from fastapi.testclient import TestClient
from app import providers
from app.main import create_app

def test_end_of_question_precedes_feedback_completion(monkeypatch,tmp_path):
    metadata_finished=False
    async def raw_stream(*args):
        nonlocal metadata_finished
        yield {'type':'delta','text':'Why does that work?\nINTERVIEW_FEEDBACK_JSON:\n'}
        metadata_finished=True
        yield {'type':'delta','text':'{"feedback":null}'}
    monkeypatch.setattr(providers,'stream_answer',raw_stream)
    async def check():
        stream=providers.stream_interview({'mode':'backend'},{'kind':'gateway'},[])
        assert (await anext(stream))['type']=='delta'
        assert await anext(stream)=={'type':'speech_complete'}
        assert metadata_finished is False
        await stream.aclose()
    asyncio.run(check())
    async def completed_stream(*args):
        yield {'type':'delta','text':'Why does that work?'}
        yield {'type':'speech_complete'}
    with TestClient(create_app(str(tmp_path/'boundary.db'),provider_stream=completed_stream)) as client:
        session=client.post('/api/sessions',json={'mode':'backend','provider':'mock'}).json()
        result=client.post(f"/api/sessions/{session['id']}/turns",json={'action':'start'})
        assert result.status_code==200
        assert '"type": "speech_complete"' in result.text or '"type":"speech_complete"' in result.text
        assert '"type": "complete"' in result.text or '"type":"complete"' in result.text
