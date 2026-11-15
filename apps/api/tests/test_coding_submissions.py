import asyncio
import json
import threading
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app import coding,providers,coding_submissions
from app.main import create_app
from app.assessments import validate_assessment
from app.modes import MODE_BY_ID

PROBLEM={'title':'Add integers','statement':'Add two supplied integers.','starter_code':'def solve(a,b):\n    pass','io_mode':'function','entry_point':'solve','examples':[{'label':'Example','args':[2,3],'expected':5}]}
CODE='def solve(a,b): return a+b'

@pytest.fixture
def setup(tmp_path,monkeypatch):
    captured=[];runs=[];state={'fail':False,'forge':False}
    async def workspace(*args):yield {'type':'delta','text':json.dumps({'problem':PROBLEM})}
    async def execute(code,problem):
        runs.append((code,problem))
        return {'status':'complete','cases':[{'label':'Example','status':'passed','input':{'args':[2,3]},'expected':5,'actual':5}]}
    async def model(session,settings,messages):
        manifest=session.get('_assessment_evidence',{});captured.append((session,manifest))
        if state['fail']:raise ValueError('Controlled provider failure')
        sources=manifest.get('sources',[]);src=next((s for s in sources if s['kind']=='code'),None)
        evidence=[{'source_id':src['id'],'quote':src['text']}] if src else []
        value={'summary':'Code and recorded examples were inspected; general correctness is not proven.','strengths':[], 'improvements':[],
               'dimensions':[{'name':name,'score':3 if name=='Code quality' and evidence else None,'reasoning':'Inspected the captured code.' if evidence else 'Insufficient evidence.','evidence':evidence if name=='Code quality' else []} for name in MODE_BY_ID['dsa']['rubric']], 'next_steps':['Check boundary cases.']}
        if state['forge'] and src:
            value['dimensions'][4]['evidence']=[{'source_id':'another-session-code','quote':CODE}]
        if session.get('_task') in ('report','submission'):
            yield {'type':'delta','text':json.dumps({'report':value})}
        elif session.get('_task')=='feedback':yield {'type':'delta','text':json.dumps({'feedback':value})}
        else:
            answered=any(m['role']=='user' for m in messages)
            yield {'type':'delta','text':'What invariant supports that draft?\nINTERVIEW_FEEDBACK_JSON:\n'+json.dumps({'feedback':value if answered else None})}
    monkeypatch.setattr(coding,'stream_answer',workspace);monkeypatch.setattr(coding_submissions,'execute_python',execute);monkeypatch.setattr(providers,'stream_answer',model)
    with TestClient(create_app(str(tmp_path/'submissions.db'))) as client:
        client.put('/api/settings',json={'kind':'compatible','base_url':'http://127.0.0.1:9999/v1','model':'test'})
        session=client.post('/api/sessions',json={'mode':'dsa','provider':'compatible','remote_consent':True}).json()
        base='/api/sessions/'+session['id'];w=client.post(base+'/coding/prepare',json={'source':'generate','request':'Add two integers'}).json()['workspace']
        payload={'workspace_id':w['id'],'expected_revision':1,'code':CODE,'explanation':'I add the two inputs.','request_id':str(uuid4())}
        yield client,base,w,payload,captured,runs,state,monkeypatch


def test_submission_is_immutable_idempotent_reviewable_and_exported(setup):
    client,base,w,payload,captured,runs,state,_=setup
    response=client.post(base+'/coding/submit',json=payload);assert response.status_code==200,response.text
    aid=response.json()['submitted_attempt_id'];assert len(runs)==1
    assert client.post(base+'/coding/submit',json=payload).json()['submitted_attempt_id']==aid
    assert len(runs)==1
    assert client.post(base+'/coding/submit',json={**payload,'explanation':'Changed'}).status_code==409
    assert client.put(base+'/coding/code',json={'workspace_id':w['id'],'expected_revision':2,'code':'def solve(a,b): return a-b'}).status_code==200
    attempt=client.get(base+'/coding/attempts/'+aid).json()
    assert attempt['content']['code']==CODE and attempt['content']['explanation']==payload['explanation']
    assert attempt['run']['result']['test_source']=='public_examples'
    review=client.post(base+'/coding/attempts/'+aid+'/review');assert '"type": "complete"' in review.text,review.text
    session=client.get(base).json();assessment=session['assessments'][-1]
    assert assessment['kind']=='submission' and assessment['status']=='complete'
    source=next(s for s in assessment['evidence_sources'] if s['kind']=='code')
    artifact=client.get(base+'/assessments/'+assessment['id']+'/sources/'+source['id']).json()
    assert artifact['text']==CODE and artifact['submitted']
    assert captured[-1][1]['sources'][0]['text']==CODE
    other=client.post('/api/sessions',json={'mode':'dsa','provider':'compatible','remote_consent':True}).json()
    assert client.get('/api/sessions/'+other['id']+'/assessments/'+assessment['id']+'/sources/'+source['id']).status_code==404
    assert client.get('/api/sessions/'+other['id']+'/coding/attempts/'+aid).status_code==404
    client.post(base+'/control',json={'action':'end'})
    assert '"type": "complete"' in client.post(base+'/report').text
    exported=client.get(base+'/export').json()
    assert exported['coding_attempts'][0]['content']['code']==CODE
    assert len(exported['assessment_evidence'])==2
    assert client.post(base+'/coding/submit',json={**payload,'request_id':str(uuid4()),'expected_revision':3}).status_code==409
    assert client.delete(base).status_code==204
    assert client.get(base+'/coding/attempts/'+aid).status_code==404


def test_live_feedback_and_repair_use_frozen_draft_sources(setup):
    client,base,w,payload,captured,*_=setup
    draft={'workspace_id':w['id'],'expected_revision':1,'code':CODE}
    assert '"type": "complete"' in client.post(base+'/turns',json={'action':'start','coding_context':draft}).text
    assert '"type": "complete"' in client.post(base+'/turns',json={'action':'answer','content':'I add both inputs.','coding_context':draft}).text
    feedback=client.get(base).json()['assessments'][-1]
    assert feedback['status']=='complete'
    assert feedback['evidence_sources'][0]['submitted'] is False
    client.put(base+'/coding/code',json={**draft,'code':'def solve(a,b): return a-b'})
    repair=client.post(base+'/feedback');assert '"type": "complete"' in repair.text,repair.text
    assert captured[-1][1]['sources'][0]['text']==CODE


def test_failed_execution_and_failed_review_preserve_attempt_for_retry(setup):
    client,base,w,payload,captured,runs,state,monkeypatch=setup
    async def broken(*args):raise OSError('Docker unavailable')
    monkeypatch.setattr(coding_submissions,'execute_python',broken)
    aid=client.post(base+'/coding/submit',json=payload).json()['submitted_attempt_id']
    assert client.get(base+'/coding/attempts/'+aid).json()['run']['status']=='error'
    state['fail']=True;assert '"type": "error"' in client.post(base+'/coding/attempts/'+aid+'/review').text
    assert client.get(base).json()['assessments'][-1]['status']=='error'
    state['fail']=False;assert '"type": "complete"' in client.post(base+'/coding/attempts/'+aid+'/review').text
    run_source=next(s for s in captured[-1][1]['sources'] if s['kind']=='run')
    assert 'Execution status: error' in run_source['text']
    assert 'Docker unavailable' in run_source['text']
    assert client.get(base+'/coding/attempts/'+aid).json()['content']['code']==CODE


def test_pause_cancels_submission_without_losing_frozen_code(setup):
    client,base,w,payload,captured,runs,state,monkeypatch=setup
    entered=threading.Event()
    async def slow(*args):entered.set();await asyncio.sleep(60)
    monkeypatch.setattr(coding_submissions,'execute_python',slow)
    outcome=[]
    thread=threading.Thread(target=lambda:outcome.append(client.post(base+'/coding/submit',json=payload)))
    thread.start();assert entered.wait(5)
    assert client.post(base+'/control',json={'action':'pause'}).status_code==200
    thread.join(5);assert not thread.is_alive()
    aid=client.get(base+'/coding').json()['attempts'][0]['id']
    frozen=client.get(base+'/coding/attempts/'+aid).json()
    assert frozen['run']['status']=='cancelled' and frozen['content']['code']==CODE
    assert client.post(base+'/coding/submit',json={**payload,'request_id':str(uuid4()),'expected_revision':2}).status_code==409
    assert client.post(base+'/coding/submit',json=payload).json()['submitted_attempt_id']==aid


def test_artifact_citations_reject_invented_ids_quotes_and_stale_run_scores():
    source={'id':'code-one','text':CODE,'kind':'code'}
    value={'summary':'Review','strengths':[],'improvements':[],'dimensions':[{'name':'Code quality','score':3,'reasoning':'Observed code.','evidence':[{'source_id':'code-one','quote':'return a+b'}]}],'next_steps':[]}
    assert validate_assessment(value,[],['Code quality'],sources=[source])
    with pytest.raises(ValueError):validate_assessment(value,[],['Code quality'],sources=[])
    with pytest.raises(ValueError):validate_assessment(value,[],['Code quality'],sources=[{**source,'text':'different code'}])
    with pytest.raises(ValueError):validate_assessment(value,[],['Code quality'],sources=[{**source,'stale':True}])


def test_provider_cannot_publish_forged_submission_citations(setup):
    client,base,w,payload,captured,runs,state,_=setup
    aid=client.post(base+'/coding/submit',json=payload).json()['submitted_attempt_id']
    state['forge']=True
    response=client.post(base+'/coding/attempts/'+aid+'/review')
    assert '"type": "error"' in response.text
    assert client.get(base).json()['assessments'][-1]['status']=='error'
    state['forge']=False
    assert '"type": "complete"' in client.post(base+'/coding/attempts/'+aid+'/review').text


def test_submission_review_can_be_cancelled_and_retried(setup):
    client,base,w,payload,captured,runs,state,monkeypatch=setup
    aid=client.post(base+'/coding/submit',json=payload).json()['submitted_attempt_id']
    original=providers.stream_answer;entered=threading.Event()
    async def waiting(*args):
        entered.set();await asyncio.sleep(60)
        yield {'type':'delta','text':'unreachable'}
    monkeypatch.setattr(providers,'stream_answer',waiting)
    def request_review():
        try:client.post(base+'/coding/attempts/'+aid+'/review')
        except Exception:pass  # The streaming transport can close on cancellation.
    thread=threading.Thread(target=request_review);thread.start();assert entered.wait(5)
    assert client.post(base+'/report/cancel').status_code==200
    thread.join(5);assert not thread.is_alive()
    assert client.get(base).json()['assessments'][-1]['status']=='interrupted'
    assert client.get(base+'/coding/attempts/'+aid).json()['content']['code']==CODE
    monkeypatch.setattr(providers,'stream_answer',original)
    assert '"type": "complete"' in client.post(base+'/coding/attempts/'+aid+'/review').text


def test_final_review_declares_omitted_attempts_in_large_sessions(setup):
    from app.coding_evidence import evidence_manifest
    client,base,w,payload,*_=setup
    ids=[];long_code=CODE+'\n#'+'x'*48000
    for index in range(4):
        value=client.post(base+'/coding/submit',json={**payload,'code':long_code,'expected_revision':1 if index==0 else 2,'request_id':str(uuid4())}).json()
        ids.append(value['submitted_attempt_id'])
    manifest=evidence_manifest(client.app.state.database,client.get(base).json())
    assert len(manifest['attempts'])==3 and manifest['omitted_attempt_count']==1
    assert ids[0] not in [a['id'] for a in manifest['attempts']]
    assert not any(s['attempt_id']==ids[0] for s in manifest['sources'])
