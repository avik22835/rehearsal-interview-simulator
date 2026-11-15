import json
import sqlite3
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.providers import conversation,DEFAULTS
from app.database import now


def test_turn_includes_unsaved_editor_and_authoritative_run_without_changing_transcript(tmp_path):
    path=str(tmp_path/'context.db');captured=[]
    async def interview(session,*args):
        captured.append(session['_coding_context'])
        yield {'type':'delta','text':'What invariant does this draft preserve?'}
    with TestClient(create_app(path,provider_stream=interview)) as client:
        session=client.post('/api/sessions',json={'mode':'dsa','provider':'mock'}).json();sid=session['id'];wid=str(uuid4());snapshot=str(uuid4())
        problem={'title':'Add integers','statement':'Add two supplied integers.','starter_code':'def solve(a,b):\n    pass','examples':[{'args':[2,3],'expected':5}],'source_reference':{'name':'Selected note','content':'Duplicate original statement'}}
        saved='def solve(a,b): return a+b';draft='def solve(a,b):\n    # Still thinking\n    return a-b'
        with sqlite3.connect(path) as conn:
            conn.execute('INSERT INTO coding_workspaces VALUES(?,?,?,?,?,?,?,?,?)',(wid,sid,'resources','',json.dumps(problem),saved,2,now(),now()))
            conn.execute('INSERT INTO coding_snapshots VALUES(?,?,?,?,?)',(snapshot,wid,2,saved,now()))
            conn.execute('INSERT INTO coding_runs VALUES(?,?,?,?,?,?)',('run1',wid,snapshot,'complete',json.dumps({'cases':[{'status':'passed','actual':5,'expected':5}]}),now()))
        payload={'action':'start','coding_context':{'workspace_id':wid,'expected_revision':2,'code':draft}}
        response=client.post(f'/api/sessions/{sid}/turns',json=payload)
        assert response.status_code==200,response.text
        assert captured[-1]['code']==draft and captured[-1]['draft_is_unsaved']
        assert not captured[-1]['latest_run']['matches_current_code']
        assert captured[-1]['latest_run']['run_id']=='run1'
        assert 'source_reference' not in captured[-1]['problem']
        assert client.get(f'/api/sessions/{sid}/coding').json()['workspace']['code']==saved
        answer={**payload,'action':'answer','content':'I am checking the loop invariant.'}
        answer['coding_context']={**payload['coding_context'],'code':saved}
        assert client.post(f'/api/sessions/{sid}/turns',json=answer).status_code==200
        assert captured[-1]['latest_run']['matches_current_code']
        reopened=client.get(f'/api/sessions/{sid}').json()
        assert [m['content'] for m in reopened['messages'] if m['role']=='user']==['I am checking the loop invariant.']
        exported=client.get(f'/api/sessions/{sid}/export').json()
        assert len(exported['coding_turn_contexts'])==2
        assert exported['coding_turn_contexts'][0]['content']['code']==draft
        assert exported['coding_turn_contexts'][1]['content']['code']==saved
        invalid={**answer,'coding_context':{**answer['coding_context'],'expected_revision':1}}
        assert client.post(f'/api/sessions/{sid}/turns',json=invalid).status_code==409
        forged={**answer,'coding_context':{**answer['coding_context'],'workspace_id':'another-interview'}}
        assert client.post(f'/api/sessions/{sid}/turns',json=forged).status_code==409
        forged['coding_context']={**answer['coding_context'],'latest_run':{'status':'passed'}}
        assert client.post(f'/api/sessions/{sid}/turns',json=forged).status_code==422
        assert len(client.get(f'/api/sessions/{sid}/export').json()['coding_turn_contexts'])==2
        other=client.post('/api/sessions',json={'mode':'backend','provider':'mock'}).json()
        assert client.post(f"/api/sessions/{other['id']}/turns",json=payload).status_code==422


@pytest.mark.parametrize('kind',['gateway','compatible'])
def test_editor_context_is_included_on_followup_without_gateway_history_replay(kind):
    snapshot={'code':'def solve(x):\n    pass','evidence_rules':'Incomplete draft, not a submission.'}
    session={'mode':'dsa','level':'Junior','topic':'Arrays','phase':'follow_up','gateway_bound':True,'gateway_session_version':3,'_action':'answer','_coding_context':snapshot}
    messages=[{'id':'earlier','role':'user','status':'complete','content':'An earlier approach.'},{'id':'new','role':'user','status':'complete','content':'What about this edge case?'}]
    packed=conversation(session,{**DEFAULTS,'kind':kind},messages)
    final=json.loads(packed[-1]['content'])
    assert final['coding_context']['code']==snapshot['code']
    if kind=='gateway':
        assert len(packed)==1
        assert final['candidate_answer']['text']=='What about this edge case?'
        assert 'An earlier approach.' not in packed[0]['content']
    else:assert 'current editor snapshot' in packed[0]['content']
