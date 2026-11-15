import asyncio
import json
import os
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.modes import validate_transition
from app import providers

@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(str(tmp_path / "test.db"))) as value:
        yield value

def create(client, mode="backend", **extra):
    result = client.post("/api/sessions", json={"mode": mode, "provider": "mock", **extra})
    assert result.status_code == 201, result.text
    return result.json()

def turn(client, session, action="start", content=""):
    result = client.post(f"/api/sessions/{session['id']}/turns", json={"action": action, "content": content})
    assert result.status_code == 200, result.text
    assert "no-transform" in result.headers["cache-control"]
    return [json.loads(line[6:]) for line in result.text.splitlines() if line.startswith("data: ")]

def test_all_modes_have_working_typed_openers_and_no_invented_sources(client):
    modes = client.get("/api/modes").json()
    assert len(modes) == 6
    for mode in modes:
        session = create(client, mode["id"])
        events = turn(client, session)
        saved = events[-1]["session"]
        assert saved["phase"] == "clarification"
        assert saved["messages"][-1]["status"] == "complete"
        assert mode["rubric"]
        context = next(event for event in saved["events"] if event["type"] == "context_loaded")
        assert context["data"]["sources"] == []

def test_answer_drives_mock_followup_and_session_survives_reopening(client):
    session = create(client, topic="Order retries")
    turn(client, session)
    events = turn(client, session, "answer", "I would store an idempotency key in the database.")
    saved = events[-1]["session"]
    assert saved["phase"] == "follow_up"
    assert "idempotency key" in saved["messages"][-1]["content"]
    reopened = client.get(f"/api/sessions/{session['id']}").json()
    assert len(reopened["messages"]) == 3
    assert reopened["messages"][1]["content"].startswith("I would store")
    assert any(event["type"] == "candidate_response" for event in reopened["events"])
    assert client.get("/api/sessions").json()[0]["answer_count"] == 1

def test_pause_resume_end_and_export_preserve_history(client):
    session = create(client)
    turn(client, session)
    base = f"/api/sessions/{session['id']}"
    assert client.post(base + "/control", json={"action": "pause"}).json()["status"] == "paused"
    assert client.post(base + "/turns", json={"content": "Not accepted while paused"}).status_code == 409
    assert client.post(base + "/control", json={"action": "resume"}).json()["status"] == "active"
    ended = client.post(base + "/control", json={"action": "end"}).json()
    assert ended["phase"] == "report"
    assert ended["status"] == "ended"
    assert client.post(base + "/turns", json={"content": "Too late"}).status_code == 409
    assert client.get(base + "/export").json()["messages"] == ended["messages"]

def test_invalid_transitions_double_start_and_bad_modes_are_rejected(client):
    with pytest.raises(ValueError):
        validate_transition("introduction", "report")
    assert client.post("/api/sessions", json={"mode": "unknown"}).status_code == 422
    session = create(client)
    assert client.post(f"/api/sessions/{session['id']}/turns", json={"content": "premature"}).status_code == 422
    turn(client, session)
    assert client.post(f"/api/sessions/{session['id']}/turns", json={"action": "start"}).status_code == 409

def test_partial_failure_is_saved_and_retry_does_not_duplicate_candidate_answers(tmp_path):
    attempts = 0
    async def flaky(session, settings, messages):
        nonlocal attempts
        attempts += 1
        yield {"type": "delta", "text": "Partial thought"}
        if attempts == 1:
            raise ValueError("Test interruption")
        yield {"type": "delta", "text": ". A complete question?"}
    with TestClient(create_app(str(tmp_path / "failure.db"), provider_stream=flaky)) as client:
        session = create(client)
        events = turn(client, session)
        assert events[-1]["type"] == "error"
        saved = client.get(f"/api/sessions/{session['id']}").json()
        assert saved["messages"][-1]["content"] == "Partial thought"
        assert saved["messages"][-1]["status"] == "error"
        assert saved["phase"] == "introduction"
        assert not any(x["type"] == "question_shown" for x in saved["events"])
        retried = turn(client, session, "retry")[-1]["session"]
        assert retried["phase"] == "clarification"
        assert len([x for x in retried["messages"] if x["role"] == "user"]) == 0

def test_remote_provider_requires_explicit_session_consent(client):
    client.put("/api/settings", json={"kind": "gateway"})
    assert client.post("/api/sessions", json={"mode": "backend", "provider": "gateway"}).status_code == 400
    assert client.post("/api/sessions", json={"mode": "backend", "provider": "gateway", "remote_consent": True}).status_code == 201
    assert client.post("/api/sessions", json={"mode": "backend", "provider": "compatible", "remote_consent": True}).status_code == 400

def test_browser_origin_is_restricted_and_settings_url_is_validated(client):
    assert client.put("/api/settings", json={"kind": "gateway"}, headers={"Origin": "https://unrelated.example"}).status_code == 403
    assert client.put("/api/settings", json={"kind": "gateway", "base_url": "http://password@host/v1"}).status_code == 422

@pytest.mark.skipif(os.name != "nt", reason="Windows credential storage")
def test_credential_is_encrypted_and_not_returned_to_browser(client):
    secret = "test-local-credential-never-return"
    response = client.put("/api/settings", json={"kind": "compatible", "api_key": secret})
    assert response.status_code == 200
    assert response.json()["has_key"] is True
    assert secret not in response.text
    assert secret not in client.get("/api/settings").text
    assert client.put("/api/settings", json={"kind": "compatible", "clear_key": True}).json()["has_key"] is False

def test_restart_marks_pending_generation_interrupted(tmp_path):
    path = str(tmp_path / "restart.db")
    app = create_app(path)
    with TestClient(app) as client:
        session = create(client)
        with app.state.database.connection() as conn:
            conn.execute("INSERT INTO messages VALUES(?,?,?,?,?,?)", ("partial", session["id"], "assistant", "Saved before restart", "generating", "2026-10-27T00:00:00+00:00"))
    with TestClient(create_app(path)) as client:
        saved = client.get(f"/api/sessions/{session['id']}").json()
        assert saved["messages"][-1]["status"] == "interrupted"
        assert saved["messages"][-1]["content"] == "Saved before restart"

def test_gateway_adapter_packs_context_and_handles_unicode_and_revisions(monkeypatch):
    import httpx
    original = httpx.AsyncClient
    captured = []
    def handler(request):
        captured.append(json.loads(request.content))
        data = 'data: {"choices":[{"delta":{"content":"héllo"}}]}\n\nevent: snapshot\ndata: {"content":"Revised question?"}\n\ndata: [DONE]\n\n'
        return httpx.Response(200, text=data, headers={"Content-Type": "text/event-stream"})
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handler), **kw))
    async def collect():
        return [item async for item in providers.stream_answer({"id": "test-session", "mode": "backend", "level": "Junior", "phase": "introduction", "topic": "Queues"}, {**providers.DEFAULTS, "kind": "gateway"}, [])]
    items = asyncio.run(collect())
    assert items == [{"type": "delta", "text": "héllo"}, {"type": "replace", "text": "Revised question?"}]
    assert len(captured[0]["messages"]) == 1
    assert "Queues" in captured[0]["messages"][0]["content"]
    assert "\n" not in captured[0]["messages"][0]["content"]
    assert "Queues" == json.loads(captured[0]["messages"][0]["content"])["session_context"]["topic"]
    assert captured[0]["new_conversation"] is True

def test_provider_does_not_treat_stream_truncation_as_success(monkeypatch):
    import httpx
    original = httpx.AsyncClient
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(lambda request: httpx.Response(200, text='data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')), **kw))
    async def collect():
        return [item async for item in providers.stream_answer({"id": "test-session", "mode": "backend", "level": "Junior", "phase": "introduction", "topic": ""}, {**providers.DEFAULTS, "kind": "gateway"}, [])]
    with pytest.raises(ValueError, match="without a complete answer"):
        asyncio.run(collect())


def test_compatible_provider_supports_non_streaming_responses(monkeypatch):
    import httpx
    original = httpx.AsyncClient
    captured = []
    def handler(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "What would you measure first?"}}]})
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handler), **kw))
    async def collect():
        return [item async for item in providers.stream_answer({"id": "test-session", "mode": "backend", "level": "Junior", "phase": "introduction", "topic": "Queues"}, {**providers.DEFAULTS, "kind": "compatible", "stream": False}, [])]
    assert asyncio.run(collect()) == [{"type": "delta", "text": "What would you measure first?"}]
    assert captured[0]["stream"] is False
    assert captured[0]["messages"][0]["role"] == "system"
