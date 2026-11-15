import asyncio, os
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.coding_contract import Problem
from app.python_runner import execute_python

def test_resource_search_returns_complete_text_and_requires_explicit_match(tmp_path):
    with TestClient(create_app(str(tmp_path/'library.db'))) as client:
        text='# Longest substring\nFind a unique window.\nExamples: abc -> 3.\nConstraints: length <= 100.'
        response=client.post('/api/coding/resources',json={'name':'Sliding window notes','content':text})
        assert response.status_code==201
        result=client.get('/api/coding/resources',params={'q':'substring'}).json()
        assert len(result)==1 and result[0]['content']==text
        assert client.get('/api/coding/resources',params={'q':'unmatchedtoken'}).json()==[]
        assert client.delete('/api/coding/resources/'+result[0]['id']).status_code==204
        assert client.get('/api/coding/resources').json()==[]

def test_solved_starter_is_rejected():
    with pytest.raises(ValueError):
        Problem(title='Add',statement='Add both given integers.',starter_code='def solve(a,b): return a+b',examples=[{'args':[1,2],'expected':3}])

@pytest.mark.skipif(os.getenv('REHEARSAL_DOCKER_TESTS')!='1',reason='Opt-in real Docker integration')
@pytest.mark.parametrize('mode,entry,code,case,status',[
 ('function','solve','def solve(a,b): return a+b',{'args':[2,3],'expected':5},'passed'),
 ('function','Solution.solve','class Solution:\n def solve(self,a): return a[::-1]',{'args':[[1,2]],'expected':[2,1]},'passed'),
 ('stdin','solve','print(sum(map(int,input().split())))',{'stdin':'2 3\n','expected':'5'},'passed'),
 ('function','solve','def solve():\n while True: pass',{'args':[],'expected':0},'timeout'),
 ('function','solve','def solve():\n open("/work/main.py","w").write("overwrite")',{'args':[],'expected':0},'error'),
])
def test_real_docker_runner(mode,entry,code,case,status):
    result=asyncio.run(execute_python(code,{'io_mode':mode,'entry_point':entry,'examples':[{'label':'Example',**case}]}))
    assert result['status']=='complete',result
    assert result['cases'][0]['status']==status,result

def test_preparation_preserves_resource_versions_and_exports(monkeypatch,tmp_path):
    import json
    from app import coding
    async def fake_stream(*args):
        yield {'type':'delta','text':json.dumps({'clarification':None,'problem':{'title':'Add integers','statement':'Add two supplied integers.','starter_code':'def solve(a, b):\n    pass','examples':[{'label':'Example','args':[2,3],'expected':5}]}})}
    monkeypatch.setattr(coding,'stream_answer',fake_stream)
    with TestClient(create_app(str(tmp_path/'coding.db'))) as client:
        assert client.put('/api/settings',json={'kind':'compatible','base_url':'http://127.0.0.1:9999/v1','model':'test'}).status_code==200
        session=client.post('/api/sessions',json={'mode':'dsa','provider':'compatible','remote_consent':True}).json()
        resource=client.post('/api/coding/resources',json={'name':'Original note','content':'Add two integers. Examples: 2 + 3 = 5. Constraints: integers only.'}).json()
        base='/api/sessions/'+session['id']+'/coding'
        payload={'source':'resources','request':'Prepare this complete problem','resource_id':resource['id']}
        response=client.post(base+'/prepare',json=payload)
        assert response.status_code==200,response.text
        w=response.json()['workspace']
        assert w['problem']['statement'].startswith('Add two integers. Examples:')
        assert w['problem']['source_reference']['id']==resource['id']
        code={'workspace_id':w['id'],'expected_revision':1,'code':'def solve(a,b): return a+b'}
        assert client.put(base+'/code',json=code).json()['workspace']['revision']==2
        assert client.put(base+'/code',json=code).status_code==409
        assert client.post(base+'/prepare',json=payload).status_code==409
        assert client.post(base+'/prepare',json={**payload,'new_version':True}).status_code==200
        saved=client.get('/api/sessions/'+session['id']+'/export').json()['coding_workspaces']
        assert len(saved)==2 and len(saved[0]['snapshots'])==2

@pytest.mark.parametrize('notes,expected', [('One note','One note'),(['Difficulty: Junior','Do not add a solution.'],'Difficulty: Junior\nDo not add a solution.'),([],''),(None,'')])
def test_model_notes_variants_are_preserved(notes,expected):
    problem=Problem(title='Sum',statement='Add two given integers.',starter_code='def solve(a,b):\n    pass',examples=[{'args':[2,3],'expected':5}],notes=notes)
    assert problem.notes==expected

@pytest.mark.parametrize('notes', [[{'instruction':'arbitrary object'}],['valid',3],{'text':'object'},['x'*2001]])
def test_model_notes_do_not_bypass_type_or_size_validation(notes):
    with pytest.raises(ValueError):
        Problem(title='Sum',statement='Add two given integers.',starter_code='def solve(a,b):\n    pass',examples=[{'args':[2,3],'expected':5}],notes=notes)

def test_custom_case_run_keeps_original_problem_and_records_source(monkeypatch,tmp_path):
    import json
    from app import coding
    captured=[]
    async def fake_stream(*args):
        yield {'type':'delta','text':json.dumps({'problem':{'title':'Add integers','statement':'Add two supplied integers.','starter_code':'def solve(a,b):\n    pass','examples':[{'args':[2,3],'expected':5}]}})}
    async def fake_execute(code,problem):
        captured.append(problem)
        return {'status':'complete','cases':[{'status':'passed','actual':15,'expected':15}]}
    monkeypatch.setattr(coding,'stream_answer',fake_stream)
    monkeypatch.setattr(coding,'execute_python',fake_execute)
    with TestClient(create_app(str(tmp_path/'custom.db'))) as client:
        client.put('/api/settings',json={'kind':'compatible','base_url':'http://127.0.0.1:9999/v1','model':'test'})
        session=client.post('/api/sessions',json={'mode':'dsa','provider':'compatible','remote_consent':True}).json()
        base='/api/sessions/'+session['id']+'/coding'
        w=client.post(base+'/prepare',json={'source':'generate','request':'Add two integers please'}).json()['workspace']
        payload={'workspace_id':w['id'],'expected_revision':1,'code':'def solve(a,b): return a+b','examples':[{'args':[7,8],'expected':15}]}
        response=client.post(base+'/run',json=payload)
        assert response.status_code==200,response.text
        value=response.json()
        assert captured[0]['examples'][0]['args']==[7,8]
        assert value['workspace']['problem']['examples'][0]['args']==[2,3]
        assert value['runs'][0]['result']['test_source']=='custom'
        assert value['workspace']['revision']==2
        assert value['runs'][0]['code_revision']==2
        oversized={**payload,'expected_revision':2,'examples':[{'args':['x'*100001],'expected':0}]}
        assert client.post(base+'/run',json=oversized).status_code==422
        assert len(client.get(base).json()['runs'])==1
        assert client.post(base+'/run',json={**payload,'expected_revision':2,'examples':[]}).status_code==422
        assert client.post(base+'/run',json={**payload,'expected_revision':2,'examples':[{'args':'invalid','expected':0}]}).status_code==422

def test_topic_library_migrates_existing_notes_and_imports_atomically(tmp_path):
    import sqlite3
    path=str(tmp_path/'old-library.db')
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE coding_resources(id TEXT PRIMARY KEY,name TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL)')
        conn.execute('INSERT INTO coding_resources VALUES(?,?,?,?)',('old','Existing question','Original notes remain available.','2026-01-01'))
    with TestClient(create_app(path)) as client:
        assert client.get('/api/coding/resources').json()[0]['topic']==''
        payload={'resources':[{'name':'Two Sum','topic':'Arrays','content':'Find two numbers. Unique matching pair.'},{'name':'BFS','topic':'Graphs','content':'Traverse a graph with a breadth first queue.'}]}
        assert client.post('/api/coding/resources/import',json=payload).status_code==201
        topics=client.get('/api/coding/resources/topics').json()
        assert {item['topic']:item['count'] for item in topics}=={'':1,'Arrays':1,'Graphs':1}
        assert [r['name'] for r in client.get('/api/coding/resources',params={'topic':'Arrays'}).json()]==['Two Sum']
        assert [r['name'] for r in client.get('/api/coding/resources',params={'q':'queue'}).json()]==['BFS']
        assert client.get('/api/coding/resources',params={'topic':'Arrays','q':'queue'}).json()==[]
        assert [r['name'] for r in client.get('/api/coding/resources',params={'q':'queu'}).json()]==['BFS']
        assert [r['name'] for r in client.get('/api/coding/resources',params={'q':'graph queue'}).json()]==['BFS']
        assert client.post('/api/coding/resources/import',json={'resources':[payload['resources'][0],{'name':'Broken','content':'short'}]}).status_code==422
        assert len(client.get('/api/coding/resources').json())==3


def test_three_question_routes_send_only_selected_note_and_allow_random(monkeypatch,tmp_path):
    import json
    from app import coding
    captured=[]
    async def fake_stream(session,*args):
        captured.append(session['_workspace_request'])
        yield {'type':'delta','text':json.dumps({'problem':{'title':'Add integers','statement':'Add two supplied integers.','starter_code':'def solve(a,b):\n    pass','examples':[{'args':[2,3],'expected':5}]}})}
    monkeypatch.setattr(coding,'stream_answer',fake_stream)
    with TestClient(create_app(str(tmp_path/'routes.db'))) as client:
        client.put('/api/settings',json={'kind':'compatible','base_url':'http://127.0.0.1:9999/v1','model':'test'})
        session=client.post('/api/sessions',json={'mode':'dsa','provider':'compatible','remote_consent':True}).json()
        base='/api/sessions/'+session['id']+'/coding'
        note=client.post('/api/coding/resources',json={'name':'Two Sum','topic':'Arrays','content':'Selected original question. Find two numbers.'}).json()
        client.post('/api/coding/resources',json={'name':'Private other question','topic':'Graphs','content':'This unrelated note must not be sent.'})
        response=client.post(base+'/prepare',json={'source':'resources','resource_id':note['id']})
        assert response.status_code==200,response.text
        assert response.json()['workspace']['problem']['statement']=='Selected original question. Find two numbers.'
        assert captured[-1]['selected_resource']['topic']=='Arrays'
        assert 'unrelated note' not in json.dumps(captured[-1])
        assert client.post(base+'/prepare',json={'source':'generate','request':'Two Sum','new_version':True}).status_code==200
        assert client.post(base+'/prepare',json={'source':'random','new_version':True}).status_code==200
        assert captured[-1]['source']=='random' and 'Choose a fresh' in captured[-1]['instruction']
        assert 'selected_resource' not in captured[-1]
        assert client.post(base+'/prepare',json={'source':'generate','request':'','new_version':True}).status_code==422
        assert client.post(base+'/prepare',json={'source':'paste','request':'Two Sum','new_version':True}).status_code==422
        assert client.post(base+'/prepare',json={'source':'resources','new_version':True}).status_code==422
