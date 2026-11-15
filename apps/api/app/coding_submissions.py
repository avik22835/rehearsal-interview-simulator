import asyncio
import hashlib
import json
from uuid import uuid4
from fastapi import HTTPException
from pydantic import BaseModel,ConfigDict,Field
from .database import now
from .python_runner import execute_python
from .coding_evidence import read_attempt

class SubmissionInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    workspace_id:str=Field(max_length=100)
    expected_revision:int=Field(ge=1)
    code:str=Field(max_length=50000)
    explanation:str=Field(default='',max_length=12000)
    request_id:str=Field(pattern=r'^[a-zA-Z0-9-]{16,100}$')

def install_submission_routes(app,database,get_session,workspace,save_code,idle,active,tasks,coding_tasks):
    @app.get('/api/sessions/{session_id}/coding/attempts/{attempt_id}')
    async def detail(session_id:str,attempt_id:str):
        get_session(session_id)
        with database.connection() as conn:value=read_attempt(conn,session_id,attempt_id)
        if not value:raise HTTPException(404,'Submission not found in this interview.')
        return value

    @app.post('/api/sessions/{session_id}/coding/submit')
    async def submit(session_id:str,payload:SubmissionInput):
        session=get_session(session_id)
        with database.connection() as conn:
            row=conn.execute('SELECT id FROM coding_attempts WHERE session_id=? AND request_id=?',(session_id,payload.request_id)).fetchone()
            existing=read_attempt(conn,session_id,row['id']) if row else None
        if existing:
            if existing['workspace_id']!=payload.workspace_id or existing['content']['code']!=payload.code or existing['content']['explanation']!=payload.explanation:
                raise HTTPException(409,'This submission key belongs to a different attempt. Start a new submission.')
            return {**workspace(session_id),'submitted_attempt_id':existing['id']}
        idle(session_id)
        snapshot=save_code(session_id,payload);current=workspace(session_id)['workspace']
        aid=str(uuid4());rid=str(uuid4());stamp=now()
        content={'code':payload.code,'code_sha256':hashlib.sha256(payload.code.encode()).hexdigest(),'problem':current['problem'],'explanation':payload.explanation,
                 'candidate_message_ids':[m['id'] for m in session['messages'] if m['role']=='user' and m['status']=='complete']}
        with database.connection() as conn:
            conn.execute('INSERT INTO coding_runs VALUES(?,?,?,?,?,?)',(rid,current['id'],snapshot,'running',None,stamp))
            conn.execute('INSERT INTO coding_attempts VALUES(?,?,?,?,?,?,?,?)',(aid,session_id,current['id'],snapshot,rid,payload.request_id,json.dumps(content),stamp))
            database.event(conn,session_id,'coding_attempt_submitted',{'attempt_id':aid,'workspace_id':current['id'],'snapshot_id':snapshot,'run_id':rid})
        active.add(session_id);tasks[session_id]=coding_tasks[session_id]=asyncio.current_task()
        try:
            result=await execute_python(payload.code,current['problem']);result['test_source']='public_examples'
            with database.connection() as conn:
                conn.execute('UPDATE coding_runs SET status=?,result=? WHERE id=?',(result['status'],json.dumps(result),rid))
                database.event(conn,session_id,'coding_submission_run_finished',{'attempt_id':aid,'run_id':rid,'status':result['status']})
        except asyncio.CancelledError:
            with database.connection() as conn:conn.execute("UPDATE coding_runs SET status='cancelled' WHERE id=?",(rid,))
            raise HTTPException(499,'Submission run cancelled. The frozen attempt is retained.') from None
        except (ValueError,OSError,RuntimeError) as error:
            with database.connection() as conn:conn.execute("UPDATE coding_runs SET status='error',result=? WHERE id=?",(json.dumps({'cases':[],'message':str(error)}),rid))
        finally:
            active.discard(session_id);tasks.pop(session_id,None);coding_tasks.pop(session_id,None)
        return {**workspace(session_id),'submitted_attempt_id':aid}
