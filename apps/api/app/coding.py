import asyncio
import json
from typing import Literal
from uuid import uuid4
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from .assessments import model_json
from .coding_contract import Problem, Example
from .database import now
from .providers import load_settings,stream_answer
from .python_runner import execute_python,runner_status
from .coding_resources import install_resource_routes
from .execution_driver import execution_driver

class PrepareInput(BaseModel):
    source: Literal['paste','generate','resources','grounded','random']
    request: str = Field(default='',max_length=20000)
    new_version: bool=False
    resource_id: str | None=None

class CodeInput(BaseModel):
    workspace_id: str
    code: str=Field(max_length=50000)
    expected_revision: int=Field(ge=1)

class RunInput(CodeInput):
    examples: list[Example] | None=Field(default=None,min_length=1,max_length=12)

class Draft(BaseModel):
    model_config=ConfigDict(extra='forbid')
    clarification: str | None=Field(default=None,max_length=2000)
    problem: Problem | None=None

def install_coding_routes(app,database,get_session,active,tasks,remember_conversation,save_output):
    install_resource_routes(app,database)
    coding_tasks={}

    def workspace(session_id):
        get_session(session_id)
        with database.connection() as conn:
            row=conn.execute('SELECT * FROM coding_workspaces WHERE session_id=? ORDER BY rowid DESC LIMIT 1',(session_id,)).fetchone()
            if not row:return {'workspace':None,'runs':[],'attempts':[]}
            value=dict(row);value['problem']=json.loads(value['problem'])
            value['execution_driver']=execution_driver(value['problem'])
            runs=[{**dict(item),'result':json.loads(item['result']) if item['result'] else None} for item in conn.execute('SELECT r.*,s.revision AS code_revision FROM coding_runs r JOIN coding_snapshots s ON s.id=r.snapshot_id WHERE r.workspace_id=? ORDER BY r.rowid DESC LIMIT 8',(row['id'],))]
            attempts=[dict(item) for item in conn.execute('SELECT a.id,a.workspace_id,a.created_at,r.status,s.revision AS code_revision FROM coding_attempts a JOIN coding_runs r ON r.id=a.run_id JOIN coding_snapshots s ON s.id=a.snapshot_id WHERE a.session_id=? ORDER BY a.rowid DESC',(session_id,))]
            return {'workspace':value,'runs':runs,'attempts':attempts}

    def save_code(session_id,payload):
        with database.connection() as conn:
            row=conn.execute('SELECT * FROM coding_workspaces WHERE session_id=? ORDER BY rowid DESC LIMIT 1',(session_id,)).fetchone()
            if not row or row['id']!=payload.workspace_id:raise HTTPException(409,'The active problem version changed. Reload the workspace before saving.')
            if row['revision']!=payload.expected_revision:raise HTTPException(409,'Code changed in another window. Your local draft is retained; reload before overwriting.')
            revision=row['revision']
            if row['code']!=payload.code:
                revision+=1
                conn.execute('UPDATE coding_workspaces SET code=?,revision=?,updated_at=? WHERE id=?',(payload.code,revision,now(),row['id']))
                conn.execute('INSERT INTO coding_snapshots VALUES(?,?,?,?,?)',(str(uuid4()),row['id'],revision,payload.code,now()))
            snapshot=conn.execute('SELECT id FROM coding_snapshots WHERE workspace_id=? AND revision=? ORDER BY rowid DESC LIMIT 1',(row['id'],revision)).fetchone()
            return snapshot['id']

    def idle(session_id):
        value=get_session(session_id)
        if value['mode']!='dsa':raise HTTPException(409,'The coding workspace belongs to coding interviews.')
        if value['status']!='active':raise HTTPException(409,'Resume this interview before running or submitting code.')
        if session_id in active:raise HTTPException(409,'A response or execution is running. Wait or cancel it first.')
        return value

    @app.get('/api/coding/runner')
    async def runner():return await asyncio.to_thread(runner_status)

    @app.get('/api/sessions/{session_id}/coding')
    async def detail(session_id:str):return workspace(session_id)

    @app.post('/api/sessions/{session_id}/coding/cancel',status_code=204)
    async def cancel(session_id:str):
        get_session(session_id)
        task=coding_tasks.get(session_id)
        if task:
            task.cancel();await asyncio.gather(task,return_exceptions=True)

    @app.post('/api/sessions/{session_id}/coding/prepare')
    async def prepare(session_id:str,payload:PrepareInput):
        session=idle(session_id)
        if payload.source=='paste' and len(payload.request.strip())<10:raise HTTPException(422,'Paste the complete question statement, or use the question-name option.')
        if payload.source in ('generate','grounded') and len(payload.request.strip())<2:raise HTTPException(422,'Enter a question name or topic.')
        resource=None
        if payload.source in ('resources','grounded'):
            with database.connection() as conn:
                row=conn.execute('SELECT * FROM coding_resources WHERE id=?',(payload.resource_id,)).fetchone()
            if not row:raise HTTPException(422,'Select and preview a resource before preparing the workspace.')
            resource=dict(row)
        if workspace(session_id)['workspace'] and not payload.new_version:raise HTTPException(409,'Choose a new problem version explicitly. Earlier code and runs will be retained.')
        settings=load_settings(database)
        if session['provider']=='mock':raise HTTPException(409,'Problem preparation requires Your model. Practice demo does not generate problems.')
        if not session['remote_consent'] or settings['kind']!=session['provider']:raise HTTPException(409,'Restore this interview’s model settings and sharing consent first.')
        active.add(session_id);tasks[session_id]=coding_tasks[session_id]=asyncio.current_task();raw=''
        with database.connection() as conn:database.event(conn,session_id,'coding_preparation_started',{'source':payload.source})
        try:
            request={'source':payload.source,'request':payload.request.strip(),'language':'python','level':session['level']}
            if payload.source=='random':
                request['instruction']='Choose a fresh coding interview problem yourself at the requested level. Use the optional topic preference if supplied. Do not ask the user to choose a question; do not reveal the solution.'
            elif payload.source=='generate':
                request['instruction']='Frame the named question or a complete exercise for the requested topic. Ask a focused clarification only if a question name is genuinely ambiguous.'
            if resource:
                request['selected_resource']={'id':resource['id'],'name':resource['name'],'topic':resource['topic'],'content':resource['content']}
                request['instruction']='Use exactly this selected question. Preserve its full statement, constraints and public examples. Prepare only the executable contract, unsolved starter template and public tests. Never substitute a different question or include a solution.' if payload.source=='resources' else 'Generate an original exercise grounded in this source. Label additions as generated.'
            async for piece in stream_answer({**session,'_task':'workspace','_workspace_request':request},settings,session['messages']):
                if piece['type']=='conversation':remember_conversation(session_id,piece)
                else:raw=piece['text'] if piece['type']=='replace' else raw+piece['text']
            save_output(session_id,{'task':'coding_workspace','raw':raw})
            draft=Draft.model_validate(model_json(raw))
            if draft.clarification:
                if draft.problem is not None:raise ValueError('The model returned both a problem and a clarification.')
                return {'clarification':draft.clarification,**workspace(session_id)}
            if draft.problem is None:raise ValueError('The model returned no complete problem.')
            problem=draft.problem.model_dump()
            if payload.source=='paste':problem['statement']=payload.request
            if resource:
                problem['source_reference']={'id':resource['id'],'name':resource['name'],'topic':resource['topic'],'content':resource['content']}
                if payload.source=='resources':problem['statement']=resource['content']
            wid=str(uuid4());snapshot_id=str(uuid4());stamp=now()
            with database.connection() as conn:
                conn.execute('INSERT INTO coding_workspaces VALUES(?,?,?,?,?,?,?,?,?)',(wid,session_id,payload.source,payload.request,json.dumps(problem),problem['starter_code'],1,stamp,stamp))
                conn.execute('INSERT INTO coding_snapshots VALUES(?,?,?,?,?)',(snapshot_id,wid,1,problem['starter_code'],stamp))
                database.event(conn,session_id,'coding_workspace_prepared',{'workspace_id':wid,'source':payload.source,'examples':'model-prepared; not independently verified'})
            return {'clarification':None,**workspace(session_id)}
        except asyncio.CancelledError:
            with database.connection() as conn:database.event(conn,session_id,'coding_preparation_cancelled',{})
            raise HTTPException(499,'Workspace preparation cancelled.') from None
        except ValidationError as error:
            issues=['.'.join(str(part) for part in item['loc'])+': '+item['msg'] for item in error.errors(include_url=False,include_input=False)]
            message='; '.join(issues)[:1000]
            with database.connection() as conn:database.event(conn,session_id,'coding_preparation_failed',{'message':message})
            raise HTTPException(422,'The model returned an incomplete workspace. '+message+' Your request is retained; try preparing it again.') from None
        except (ValueError,TypeError,KeyError) as error:
            with database.connection() as conn:database.event(conn,session_id,'coding_preparation_failed',{'message':str(error)[:1200]})
            raise HTTPException(422,'Workspace could not be validated: '+str(error)[:1200]) from None
        finally:
            active.discard(session_id);tasks.pop(session_id,None);coding_tasks.pop(session_id,None)

    @app.put('/api/sessions/{session_id}/coding/code')
    async def update_code(session_id:str,payload:CodeInput):
        session=get_session(session_id)
        if session['status']=='ended':raise HTTPException(409,'This saved interview is read-only.')
        save_code(session_id,payload)
        return workspace(session_id)

    @app.post('/api/sessions/{session_id}/coding/run')
    async def run(session_id:str,payload:RunInput):
        idle(session_id)
        current=workspace(session_id)['workspace']
        if not current:raise HTTPException(409,'Prepare a workspace before running code.')
        problem=current['problem']
        if payload.examples is not None:
            examples=[example.model_dump() for example in payload.examples]
            try:
                if len(json.dumps(examples,allow_nan=False))>100000:raise ValueError('Custom test input exceeds the size limit.')
            except ValueError as error:raise HTTPException(422,str(error)) from None
            if problem['io_mode']=='stdin' and any(not isinstance(case['expected'],str) for case in examples):raise HTTPException(422,'For stdin mode, expected output must be text.')
            problem={**problem,'examples':examples}
        snapshot=save_code(session_id,payload)
        run_id=str(uuid4());active.add(session_id);tasks[session_id]=coding_tasks[session_id]=asyncio.current_task()
        with database.connection() as conn:
            conn.execute('INSERT INTO coding_runs VALUES(?,?,?,?,?,?)',(run_id,current['id'],snapshot,'running',None,now()))
            database.event(conn,session_id,'coding_run_started',{'run_id':run_id,'snapshot_id':snapshot})
        try:
            result=await execute_python(payload.code,problem)
            result['test_source']='custom' if payload.examples is not None else 'public_examples'
            with database.connection() as conn:
                conn.execute('UPDATE coding_runs SET status=?,result=? WHERE id=?',(result['status'],json.dumps(result),run_id))
                database.event(conn,session_id,'coding_run_finished',{'run_id':run_id,'status':result['status']})
            return workspace(session_id)
        except asyncio.CancelledError:
            with database.connection() as conn:conn.execute("UPDATE coding_runs SET status='cancelled' WHERE id=?",(run_id,))
            raise HTTPException(499,'Execution cancelled.') from None
        except (ValueError,OSError,RuntimeError) as error:
            with database.connection() as conn:conn.execute("UPDATE coding_runs SET status='error',result=? WHERE id=?",(json.dumps({'message':str(error),'cases':[]}),run_id))
            raise HTTPException(503,str(error)) from None
        finally:
            active.discard(session_id);tasks.pop(session_id,None);coding_tasks.pop(session_id,None)

    from .coding_submissions import install_submission_routes
    install_submission_routes(app,database,get_session,workspace,save_code,idle,active,tasks,coding_tasks)
