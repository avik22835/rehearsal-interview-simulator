import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

from .database import Database, now
from .coding_context import CodingDraft,capture_coding_context
from .coding_evidence import evidence_manifest,read_attempt
from .modes import MODES, MODE_BY_ID, validate_transition
from .assessments import validate_assessment
from .providers import DEFAULTS, check_provider, load_settings, public_settings, stream_interview, stream_report, stream_feedback
from .secrets import seal
from .voice import VoiceService, voice_router

ROOT = Path(__file__).resolve().parents[3]

class ProviderInput(BaseModel):
    kind: Literal["mock", "gateway", "compatible"]
    base_url: str = Field(default=DEFAULTS["base_url"], max_length=1000)
    model: str = Field(default="auto", min_length=1, max_length=200)
    timeout: int = Field(default=180, ge=10, le=1200)
    stream: bool = True
    api_key: str | None = Field(default=None, max_length=4000)
    clear_key: bool = False

    @field_validator("base_url")
    @classmethod
    def valid_url(cls, value):
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Use an HTTP(S) endpoint without credentials, query parameters, or fragments.")
        return value.rstrip("/")

class SessionInput(BaseModel):
    mode: str
    topic: str = Field(default="", max_length=12000)
    level: Literal["Intern", "Junior", "Mid-level", "Senior"] = "Junior"
    duration: int = Field(default=25, ge=5, le=120)
    provider: Literal["mock", "gateway", "compatible"] = "mock"
    remote_consent: bool = False

class TurnInput(BaseModel):
    coding_context: CodingDraft | None = None
    action: Literal["start", "answer", "retry"] = "answer"
    content: str = Field(default="", max_length=12000)

class ConversationInput(BaseModel):
    url: str = Field(max_length=300)

    @field_validator("url")
    @classmethod
    def chat_url(cls, value):
        import re
        if not re.fullmatch(r"https://chatgpt\.com/c/[a-zA-Z0-9-]+", value):
            raise ValueError("Use the original https://chatgpt.com/c/... conversation link.")
        return value

class ControlInput(BaseModel):
    action: Literal["pause", "resume", "end"]

def create_app(db_path: str | None = None, provider_stream=stream_interview, report_stream=stream_report):
    database = Database(db_path or os.getenv("SIMULATOR_DB", str(ROOT / "data/simulator.db")))
    active: set[str] = set()
    tasks: dict[str, asyncio.Task] = {}
    voice = VoiceService()

    @asynccontextmanager
    async def lifespan(app):
        database.recover()
        yield
        for task in list(tasks.values()):
            task.cancel()
        voice.close()

    app = FastAPI(title="Interview Studio", version="0.1.0", lifespan=lifespan)
    app.state.database = database
    app.include_router(voice_router(voice))
    origins = {"http://127.0.0.1:3000", "http://localhost:3000", "http://127.0.0.1:8000", "http://localhost:8000"}
    app.add_middleware(CORSMiddleware, allow_origins=list(origins), allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Content-Type"])

    @app.middleware("http")
    async def local_browser_access(request, call_next):
        if request.headers.get("origin") and request.headers["origin"] not in origins:
            return JSONResponse({"detail": "Browser origin not allowed."}, status_code=403)
        return await call_next(request)

    def get_session(session_id):
        session = database.session(session_id)
        if not session:
            raise HTTPException(404, "Session not found.")
        return session

    def move(conn, session_id, current, target):
        if current == target:
            return
        validate_transition(current, target)
        conn.execute("UPDATE sessions SET phase=?,updated_at=? WHERE id=?", (target, now(), session_id))
        database.event(conn, session_id, "phase_changed", {"from": current, "to": target})

    @app.get("/api/health")
    async def health():
        return {"status": "ok", "version": "0.1.0", "phase": 1}

    @app.get("/api/modes")
    async def modes():
        return MODES

    @app.get("/api/settings")
    async def settings():
        return public_settings(load_settings(database))

    @app.put("/api/settings")
    async def update_settings(payload: ProviderInput):
        previous = load_settings(database)
        value = payload.model_dump(exclude={"api_key", "clear_key"})
        if previous.get("encrypted_key") and not payload.clear_key:
            value["encrypted_key"] = previous["encrypted_key"]
        if payload.api_key:
            try:
                value["encrypted_key"] = seal(payload.api_key)
            except ValueError as error:
                raise HTTPException(400, str(error))
        with database.connection() as conn:
            conn.execute("INSERT OR REPLACE INTO settings VALUES('provider',?)", (json.dumps(value),))
        return public_settings(value)

    @app.post("/api/settings/check")
    async def check():
        return await check_provider(load_settings(database))

    @app.get("/api/sessions")
    async def sessions():
        with database.connection() as conn:
            return [dict(row) for row in conn.execute("""
                SELECT s.*, (SELECT count(*) FROM messages m WHERE m.session_id=s.id AND m.role='user') AS answer_count
                FROM sessions s ORDER BY updated_at DESC LIMIT 200
            """)]

    @app.post("/api/sessions", status_code=201)
    async def create_session(payload: SessionInput):
        if payload.mode not in MODE_BY_ID:
            raise HTTPException(422, "Choose a supported interview mode.")
        if payload.provider != "mock" and not payload.remote_consent:
            raise HTTPException(400, "Confirm that this session's topic and conversation may be sent to your configured model.")
        settings = load_settings(database)
        if payload.provider != "mock" and payload.provider != settings["kind"]:
            raise HTTPException(400, "Save matching provider settings before starting this session.")
        session_id = str(uuid4())
        title = " ".join(payload.topic.split())[:80] or MODE_BY_ID[payload.mode]["name"]
        with database.connection() as conn:
            conn.execute("INSERT INTO sessions(id,mode,title,topic,level,duration,provider,remote_consent,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                         (session_id, payload.mode, title, payload.topic.strip(), payload.level, payload.duration, payload.provider, payload.remote_consent, now(), now()))
            conn.execute("UPDATE sessions SET gateway_session_version=3 WHERE id=?", (session_id,))
            database.event(conn, session_id, "session_created", payload.model_dump())
            move(conn, session_id, "setup", "context_loading")
            database.event(conn, session_id, "context_loaded", {"sources": [], "note": "Topic and conversation only; document ingestion is a later phase."})
            move(conn, session_id, "context_loading", "introduction")
        return get_session(session_id)

    @app.get("/api/sessions/{session_id}")
    async def session_detail(session_id: str):
        return get_session(session_id)

    @app.post("/api/sessions/{session_id}/control")
    async def control(session_id: str, payload: ControlInput):
        session = get_session(session_id)
        if session["status"] == "ended":
            raise HTTPException(409, "This session has ended. Start another session to practise again.")
        status = {"pause": "paused", "resume": "active", "end": "ended"}[payload.action]
        with database.connection() as conn:
            if payload.action == "end":
                # Explicit early end is permitted from any interview phase.
                database.event(conn, session_id, "phase_changed", {"from": session["phase"], "to": "evaluation", "reason": "user_ended"})
                conn.execute("UPDATE sessions SET phase='evaluation' WHERE id=?", (session_id,))
                move(conn, session_id, "evaluation", "report")
            conn.execute("UPDATE sessions SET status=?,updated_at=? WHERE id=?", (status, now(), session_id))
            database.event(conn, session_id, f"session_{status}", {})
        task = tasks.get(session_id)
        if payload.action in {"pause", "end"} and task:
            task.cancel()
            # Wait until its generator has preserved partial text and released
            # the session before the UI starts a final assessment.
            await asyncio.gather(task, return_exceptions=True)
        return get_session(session_id)

    @app.put("/api/sessions/{session_id}/conversation")
    async def link_conversation(session_id: str, payload: ConversationInput):
        session = get_session(session_id)
        if session["provider"] != "gateway" or session_id in active:
            raise HTTPException(409, "Only an idle gateway session can be linked.")
        if session.get("gateway_conversation_url") and session["gateway_conversation_url"] != payload.url:
            raise HTTPException(409, "This interview is already linked to another chat.")
        with database.connection() as conn:
            conn.execute("UPDATE sessions SET gateway_conversation_url=?,gateway_bound=1 WHERE id=?", (payload.url, session_id))
            database.event(conn, session_id, "conversation_linked", {"url": payload.url})
        return get_session(session_id)

    def remember_conversation(session_id, piece):
        url = piece.get("url")
        if url:
            ConversationInput(url=url)
        with database.connection() as conn:
            previous = conn.execute("SELECT gateway_conversation_url FROM sessions WHERE id=?", (session_id,)).fetchone()[0]
            if previous and url and previous != url:
                raise ValueError("The browser returned another interview chat. The saved binding was preserved.")
            conn.execute("UPDATE sessions SET gateway_bound=1,gateway_conversation_url=COALESCE(?,gateway_conversation_url) WHERE id=?", (url, session_id))

    def save_output(session_id, piece):
        with database.connection() as conn:
            conn.execute("INSERT INTO provider_outputs(session_id,task,raw,created_at) VALUES(?,?,?,?)", (session_id,piece['task'],piece['raw'],now()))

    @app.post("/api/sessions/{session_id}/report/cancel")
    async def cancel_report(session_id: str):
        session = get_session(session_id)
        if session["status"] != "ended" and not any(item["status"] == "generating" for item in session["assessments"]):
            raise HTTPException(409, "Use Pause to stop an active interview turn.")
        task = tasks.get(session_id)
        if task and any(item["status"] == "generating" for item in session["assessments"]):
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        return get_session(session_id)

    @app.post("/api/sessions/{session_id}/report")
    async def generate_report(session_id: str):
        return await generate_assessment(session_id, 'final')

    @app.post("/api/sessions/{session_id}/feedback")
    async def generate_feedback(session_id: str):
        return await generate_assessment(session_id, 'live')

    @app.post('/api/sessions/{session_id}/coding/attempts/{attempt_id}/review')
    async def review_attempt(session_id:str,attempt_id:str):
        with database.connection() as conn:attempt=read_attempt(conn,session_id,attempt_id)
        if not attempt:raise HTTPException(404,'Submission not found in this interview.')
        if attempt['run']['status']=='running':raise HTTPException(409,'The submission run is still in progress.')
        if get_session(session_id)['provider']=='mock':raise HTTPException(409,'Connect a model to review a submitted attempt. Local execution remains available.')
        return await generate_assessment(session_id,'submission',attempt_id)

    @app.get('/api/sessions/{session_id}/assessments/{assessment_id}/sources/{source_id}')
    async def assessment_source(session_id:str,assessment_id:str,source_id:str):
        get_session(session_id)
        with database.connection() as conn:
            row=conn.execute('SELECT s.content FROM assessment_sources s JOIN assessments a ON a.id=s.assessment_id WHERE a.session_id=? AND a.id=?',(session_id,assessment_id)).fetchone()
        sources=json.loads(row['content']).get('sources',[]) if row else []
        source=next((item for item in sources if item['id']==source_id),None)
        if not source:raise HTTPException(404,'Evidence source not found in this assessment.')
        return source

    async def generate_assessment(session_id, kind,attempt_id=None):
        session = get_session(session_id)
        if kind=='submission':
            with database.connection() as conn:frozen=read_attempt(conn,session_id,attempt_id)
            session={**session,'messages':[m for m in session['messages'] if m['created_at']<=frozen['created_at']]}
        if kind == 'final' and session["status"] != "ended":
            raise HTTPException(409, "End the interview before generating its final assessment.")
        if session_id in active:
            raise HTTPException(409, "A response or report is still running. Wait, then retry.")
        settings = load_settings(database)
        if session["provider"] != "mock" and settings["kind"] != session["provider"]:
            raise HTTPException(409, "Restore this session's provider settings before generating its report.")
        if session["provider"] != "mock" and not session["remote_consent"]:
            raise HTTPException(403, "This session does not allow model requests.")
        if session["provider"] == "gateway" and not (session["gateway_bound"] or session["gateway_conversation_url"]):
            raise HTTPException(409, "Link this older interview to its original ChatGPT conversation before generating a report.")
        settings["kind"] = session["provider"]
        answers = [item for item in session['messages'] if item['role']=='user' and item['status']=='complete']
        if kind == 'live' and (not answers or session['provider']=='mock'):
            raise HTTPException(409, 'Feedback requires a saved candidate answer and a model connection.')
        repair_context=None
        if kind=='live' and session['mode']=='dsa' and answers:
            with database.connection() as conn:
                row=conn.execute('SELECT c.content FROM coding_turn_contexts c JOIN messages m ON m.id=c.assistant_message_id WHERE c.session_id=? AND m.rowid>(SELECT rowid FROM messages WHERE id=?) ORDER BY m.rowid LIMIT 1',(session_id,answers[-1]['id'])).fetchone()
            if row:repair_context=json.loads(row['content'])
        manifest=evidence_manifest(database,session,kind,attempt_id,repair_context)
        session={**session,'_assessment_evidence':manifest,'_task':'submission' if kind=='submission' else 'report' if kind=='final' else 'feedback'}
        report_id = str(uuid4())
        with database.connection() as conn:
            conn.execute("INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?)", (report_id, session_id, kind, answers[-1]["id"] if kind == "live" else None, "generating", None, None, now()))
            conn.execute("INSERT INTO assessment_sources VALUES(?,?)",(report_id,json.dumps(manifest)))
            database.event(conn, session_id, "report_started", {"report_id": report_id})
        active.add(session_id)

        async def report_events():
            complete = False
            tasks[session_id] = asyncio.current_task()
            def encode(value):
                return "data: " + json.dumps(value, ensure_ascii=False) + "\n\n"
            try:
                yield encode({"type": "started"})
                assessment = None
                async for piece in (report_stream if kind != "live" else stream_feedback)(session, settings, session["messages"]):
                    if piece["type"] == "conversation":
                        remember_conversation(session_id, piece)
                    elif piece["type"] == "provider_output":
                        save_output(session_id,piece)
                    elif piece["type"] == "preview":
                        yield encode(piece)
                    elif piece["type"] == "assessment":
                        assessment = piece["assessment"]
                if assessment is None:
                    raise ValueError("The provider did not return an assessment.")
                assessment=validate_assessment(assessment,session['messages'],MODE_BY_ID[session['mode']]['rubric'],final=kind!='live',sources=manifest['sources'])
                with database.connection() as conn:
                    conn.execute("UPDATE assessments SET status='complete',content=? WHERE id=?", (json.dumps(assessment), report_id))
                    conn.execute("UPDATE sessions SET gateway_session_version=3 WHERE id=?", (session_id,))
                    database.event(conn, session_id, "report_completed", {"report_id": report_id})
                complete = True
                yield encode({"type": "complete", "session": get_session(session_id)})
            except asyncio.CancelledError:
                raise
            except Exception as error:
                detail = str(error) if isinstance(error, ValueError) else "Report generation failed. Your transcript is saved; retry the report."
                with database.connection() as conn:
                    conn.execute("UPDATE assessments SET status='error',error=? WHERE id=?", (detail, report_id))
                yield encode({"type": "error", "message": detail})
            finally:
                if not complete:
                    with database.connection() as conn:
                        conn.execute("UPDATE assessments SET status='interrupted',error='Report interrupted. Retry when ready.' WHERE id=? AND status='generating'", (report_id,))
                active.discard(session_id)
                tasks.pop(session_id, None)
        return StreamingResponse(report_events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})

    @app.delete("/api/sessions/{session_id}", status_code=204)
    async def delete(session_id: str):
        get_session(session_id)
        if session_id in active:
            raise HTTPException(409, "Pause this session before deleting it.")
        with database.connection() as conn:
            conn.execute("DELETE FROM sessions WHERE id=?", (session_id,))

    @app.get("/api/sessions/{session_id}/export")
    async def export(session_id: str):
        value=get_session(session_id)
        with database.connection() as conn:
            workspaces=[dict(row) for row in conn.execute('SELECT * FROM coding_workspaces WHERE session_id=?',(session_id,))]
            for workspace in workspaces:
                workspace['problem']=json.loads(workspace['problem'])
                workspace['snapshots']=[dict(row) for row in conn.execute('SELECT * FROM coding_snapshots WHERE workspace_id=? ORDER BY rowid',(workspace['id'],))]
                workspace['runs']=[{**dict(row),'result':json.loads(row['result']) if row['result'] else None} for row in conn.execute('SELECT * FROM coding_runs WHERE workspace_id=? ORDER BY rowid',(workspace['id'],))]
            value['coding_workspaces']=workspaces
            value['coding_attempts']=[read_attempt(conn,session_id,row['id']) for row in conn.execute('SELECT id FROM coding_attempts WHERE session_id=? ORDER BY rowid',(session_id,))]
            value['assessment_evidence']=[{'assessment_id':row['assessment_id'],'content':json.loads(row['content'])} for row in conn.execute('SELECT s.* FROM assessment_sources s JOIN assessments a ON a.id=s.assessment_id WHERE a.session_id=?',(session_id,))]
            value['coding_turn_contexts']=[{**dict(row),'content':json.loads(row['content'])} for row in conn.execute('SELECT * FROM coding_turn_contexts WHERE session_id=? ORDER BY rowid',(session_id,))]
        return JSONResponse(value, headers={"Content-Disposition": f'attachment; filename="interview-{session_id}.json"'})

    @app.post("/api/sessions/{session_id}/turns")
    async def turn(session_id: str, payload: TurnInput, request: Request):
        session = get_session(session_id)
        if session["status"] != "active":
            raise HTTPException(409, "Resume the session before continuing.")
        if session_id in active:
            raise HTTPException(409, "An interviewer response is already in progress.")
        is_intro = session["phase"] == "introduction"
        if payload.action == "start" and (not is_intro or session["messages"]):
            raise HTTPException(409, "The interview has already started.")
        if payload.action == "answer" and (is_intro or not payload.content.strip()):
            raise HTTPException(422, "Start the interview first, then enter an answer.")
        if payload.action == "retry":
            assistants = [x for x in session["messages"] if x["role"] == "assistant"]
            if not assistants or assistants[-1]["status"] not in {"interrupted", "error"}:
                raise HTTPException(409, "There is no interrupted response to retry.")
        settings = load_settings(database)
        settings["kind"] = session["provider"]
        if session["provider"] != "mock" and not session["remote_consent"]:
            raise HTTPException(403, "Model context sharing was not enabled for this session.")
        configured = load_settings(database)
        if session["provider"] != "mock" and configured["kind"] != session["provider"]:
            raise HTTPException(409, "Restore this session's provider in settings or start a new session.")
        if session["provider"] == "gateway" and not session["gateway_bound"] and not session["gateway_conversation_url"] and session["messages"] and not session["gateway_session_version"]:
            raise HTTPException(409, "Link this older interview to its original ChatGPT conversation, or start a new interview. Its history will not be copied into a fresh chat.")
        coding_context=capture_coding_context(database,session,payload.coding_context)
        if coding_context is not None:coding_context['context_id']=str(uuid4())
        turn_manifest=evidence_manifest(database,session,'live',context=coding_context)
        active.add(session_id)
        message_id = str(uuid4())
        with database.connection() as conn:
            if payload.action == "answer":
                user_id = str(uuid4())
                conn.execute("INSERT INTO messages VALUES(?,?,?,?,?,?)", (user_id, session_id, "user", payload.content.strip(), "complete", now()))
                database.event(conn, session_id, "candidate_response", {"message_id": user_id})
                move(conn, session_id, session["phase"], "answer")
            conn.execute("INSERT INTO messages VALUES(?,?,?,?,?,?)", (message_id, session_id, "assistant", "", "generating", now()))
            database.event(conn, session_id, "generation_started", {"message_id": message_id, "provider": settings["kind"]})
            if coding_context is not None:
                context_id=coding_context['context_id']
                conn.execute('INSERT INTO coding_turn_contexts VALUES(?,?,?,?,?,?)',(context_id,session_id,message_id,coding_context['workspace_id'],json.dumps(coding_context),now()))
                database.event(conn,session_id,'coding_context_shared',{'context_id':context_id,'assistant_message_id':message_id,'workspace_id':coding_context['workspace_id'],'code_sha256':coding_context['code_sha256'],'draft_is_unsaved':coding_context['draft_is_unsaved']})
            conn.execute("UPDATE sessions SET updated_at=? WHERE id=?", (now(), session_id))

        def encode(value):
            return "data: " + json.dumps(value, ensure_ascii=False) + "\n\n"

        async def generate():
            content = ""
            finished = False
            interrupted = False
            last_saved = 0.0
            tasks[session_id] = asyncio.current_task()
            try:
                if get_session(session_id)["status"] != "active":
                    raise ValueError("Session is paused or ended.")
                yield encode({"type": "started", "message_id": message_id})
                current = {**get_session(session_id), "_action": payload.action,"_coding_context":coding_context,"_assessment_evidence":turn_manifest}
                feedback = None
                feedback_error = None
                async for piece in provider_stream(current, settings, current["messages"]):
                    if piece["type"] == "conversation":
                        remember_conversation(session_id, piece)
                        continue
                    if piece["type"] == "provider_output":
                        save_output(session_id,piece)
                        continue
                    if piece["type"] == "speech_complete":
                        yield encode(piece)
                        continue
                    if piece["type"] == "feedback_error":
                        feedback_error = piece
                        continue
                    if piece["type"] == "feedback":
                        try:
                            checked=validate_assessment(piece['assessment'],current['messages'],MODE_BY_ID[current['mode']]['rubric'],sources=turn_manifest['sources'])
                            feedback={**piece,'assessment':checked}
                        except ValueError as error:feedback_error={'answer_id':piece['answer_id'],'message':str(error)}
                        continue
                    if get_session(session_id)["status"] != "active":
                        raise ValueError("Session paused. Partial text was saved.")
                    content = piece["text"] if piece["type"] == "replace" else content + piece["text"]
                    if time.monotonic() - last_saved > 0.3:
                        with database.connection() as conn:
                            conn.execute("UPDATE messages SET content=? WHERE id=?", (content, message_id))
                        last_saved = time.monotonic()
                    yield encode(piece)
                if not content.strip():
                    raise ValueError("The provider returned an empty response.")
                with database.connection() as conn:
                    conn.execute("UPDATE messages SET content=?,status='complete' WHERE id=?", (content, message_id))
                    conn.execute("UPDATE sessions SET gateway_session_version=3 WHERE id=?", (session_id,))
                    phase = conn.execute("SELECT phase FROM sessions WHERE id=?", (session_id,)).fetchone()[0]
                    move(conn, session_id, phase, "clarification" if is_intro else "follow_up")
                    database.event(conn, session_id, "question_shown", {"message_id": message_id})
                    if feedback:
                        assessment_id = str(uuid4())
                        conn.execute("INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?)", (assessment_id, session_id, "live", feedback["answer_id"], "complete", json.dumps(feedback["assessment"]), None, now()))
                        conn.execute('INSERT INTO assessment_sources VALUES(?,?)',(assessment_id,json.dumps(turn_manifest)))
                        database.event(conn, session_id, "feedback_saved", {"assessment_id": assessment_id, "answer_id": feedback["answer_id"]})
                    if feedback_error:
                        conn.execute("INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?)", (str(uuid4()),session_id,"live",feedback_error["answer_id"],"error",None,feedback_error["message"],now()))
                        database.event(conn,session_id,'feedback_error',{'message':feedback_error['message']})
                finished = True
                yield encode({"type": "complete", "session": get_session(session_id)})
            except asyncio.CancelledError:
                interrupted = True
                raise
            except Exception as error:
                with database.connection() as conn:
                    database.event(conn, session_id, "generation_error", {"message_id": message_id, "message": str(error) if isinstance(error, ValueError) else "Unexpected provider error"})
                yield encode({"type": "error", "message": str(error) if isinstance(error, ValueError) else "Provider generation failed. Your work is saved; retry after checking settings."})
            finally:
                if not finished:
                    with database.connection() as conn:
                        conn.execute("UPDATE messages SET content=?,status=? WHERE id=?", (content, "interrupted" if interrupted else "error", message_id))
                        database.event(conn, session_id, "generation_interrupted", {"message_id": message_id})
                active.discard(session_id)
                tasks.pop(session_id, None)

        return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})

    from .coding import install_coding_routes
    install_coding_routes(app,database,get_session,active,tasks,remember_conversation,save_output)
    return app

app = create_app()
