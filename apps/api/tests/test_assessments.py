import asyncio
import json
import pytest
import threading
from fastapi.testclient import TestClient
from app import providers
from app.assessments import partial_string, spoken_prefix, interview_envelope, FEEDBACK_MARKER, validate_assessment, model_json
from app.main import create_app
from app.modes import MODE_BY_ID


def assessment(answer=None, final=False):
    evidence = [{"message_id": answer["id"], "quote": answer["content"][:50]}] if answer else []
    return {"summary": "The answer describes an approach but needs validation.",
            "strengths": [{"text": "A concrete approach was described.", "evidence": evidence}] if answer else [],
            "improvements": [], "dimensions": [{"name": name, "score": 3 if evidence and index == 0 else None,
                "reasoning": "Observed in this answer." if evidence and index == 0 else "Insufficient evidence.", "evidence": evidence if index == 0 else []}
                for index, name in enumerate(MODE_BY_ID['backend']['rubric'] if final else ['Accuracy'])],
            "next_steps": ["Explain a concurrent retry and its failure path."]}


@pytest.mark.parametrize('wrap', [lambda s:'<escape>'+s+'</escape>', lambda s:'```json\n'+s+'\n```'])
def test_report_presentation_wrapper_keeps_strict_evidence_validation(wrap):
    answer={'id':'a1','role':'user','status':'complete','content':'Use a unique key.'}
    raw=wrap(json.dumps({'report':assessment(answer,final=True)}))
    parsed=model_json(raw)['report']
    assert validate_assessment(parsed,[answer],MODE_BY_ID['backend']['rubric'],final=True)
    parsed['strengths'][0]['evidence'][0]['quote']='fabricated evidence'
    with pytest.raises(ValueError):
        validate_assessment(parsed,[answer],MODE_BY_ID['backend']['rubric'],final=True)
    with pytest.raises(ValueError):
        model_json(raw+' trailing garbage')


def test_invalid_feedback_does_not_fail_a_valid_streamed_question(monkeypatch):
    answer={'id':'a1','role':'user','status':'complete','content':'Use a unique key.'}
    async def raw_stream(*args):
        yield {'type':'delta','text':'How would you handle a concurrent retry?\n'+FEEDBACK_MARKER+'\n{"feedback":{}}'}
    monkeypatch.setattr(providers,'stream_answer',raw_stream)
    async def run():
        pieces=[piece async for piece in providers.stream_interview({'mode':'backend'},{'kind':'gateway'},[answer])]
        assert pieces[0]['text']=='How would you handle a concurrent retry?'
        assert any(piece['type']=='provider_output' for piece in pieces)
        assert pieces[-1]['type']=='feedback_error'
        assert pieces[-1]['answer_id']=='a1'
    asyncio.run(run())


def test_feedback_repair_preserves_question_and_keeps_raw_output_local(tmp_path,monkeypatch):
    import sqlite3
    async def remote(session,settings,messages):
        yield {'type':'conversation','url':'https://chatgpt.com/c/repair-test'}
        answer=next((item for item in reversed(messages) if item['role']=='user'),None)
        if session.get('_task')=='feedback':
            raw='<escape>'+json.dumps({'feedback':assessment(answer)})+'</escape>'
        else:
            raw='What would you test next?\n'+FEEDBACK_MARKER+'\n'+json.dumps({'feedback':{} if answer else None})
        yield {'type':'delta','text':raw}
    monkeypatch.setattr(providers,'stream_answer',remote)
    path=tmp_path/'repair.db'
    with TestClient(create_app(str(path))) as client:
        client.put('/api/settings',json={'kind':'gateway'})
        session=client.post('/api/sessions',json={'mode':'backend','provider':'gateway','remote_consent':True}).json()
        base='/api/sessions/'+session['id']
        client.post(base+'/turns',json={'action':'start'})
        result=client.post(base+'/turns',json={'action':'answer','content':'Use a unique key.'})
        assert '"type": "complete"' in result.text
        before=client.get(base).json()
        assert before['messages'][-1]['status']=='complete'
        assert before['assessments'][-1]['status']=='error'
        assert '"type": "complete"' in client.post(base+'/feedback').text
        after=client.get(base+'/export').json()
        assert after['messages']==before['messages']
        assert after['assessments'][-1]['status']=='complete'
        assert 'provider_outputs' not in after
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT COUNT(*) FROM provider_outputs').fetchone()[0]==3


def test_partial_json_question_decoder_preserves_split_escapes_and_unicode():
    raw = '{"question":"A \\uD83D\\uDE00 quote: \\"yes\\"\\nWhy?","feedback":null}'
    # Real JSON encoding gives exact streaming boundaries, including surrogate pairs.
    raw = json.dumps({"question": 'A 😀 quote: "yes"\nWhy?', "feedback": None})
    previous = ''
    for index in range(len(raw) + 1):
        current = partial_string(raw[:index], 'question')
        assert current.startswith(previous)
        previous = current
    assert previous == 'A 😀 quote: "yes"\nWhy?'


def test_assessment_rejects_forged_evidence_and_unsupported_scores():
    answer = {"id": "a1", "role": "user", "content": "I would store an idempotency key.", "status": "complete"}
    value = assessment(answer)
    assert validate_assessment(value, [answer], ['Accuracy'])['dimensions'][0]['score'] == 3
    value['strengths'][0]['evidence'][0]['quote'] = 'A claim that was never made'
    with pytest.raises(ValueError, match='could not be verified'):
        validate_assessment(value, [answer], ['Accuracy'])
    value = assessment(answer)
    value['dimensions'][0]['evidence'] = []
    with pytest.raises(ValueError):
        validate_assessment(value, [answer], ['Accuracy'])


def test_followups_send_only_current_answer_to_saved_conversation():
    session = {"id": "session-one", "mode": "backend", "level": "Junior", "topic": "Unique opening topic", "phase": "follow_up", "gateway_bound": 1}
    history = [{"id": "old", "role": "user", "content": "Older unrelated answer", "status": "complete"},
               {"id": "new", "role": "user", "content": "Use a unique key.", "status": "complete"}]
    text = providers.conversation(session, {'kind':'gateway'}, history)[0]['content']
    packed = json.loads(text)
    assert packed['candidate_answer'] == {'message_id':'new', 'text':'Use a unique key.'}
    assert 'Older unrelated answer' not in text and 'Unique opening topic' not in text
    assert 'interview_instructions' not in packed
    retry = json.loads(providers.conversation({**session, '_action':'retry'}, {'kind':'gateway'}, history)[0]['content'])
    assert 'candidate_answer' not in retry


def test_live_feedback_and_final_report_survive_export_and_report_retry(tmp_path, monkeypatch):
    fail_report = True
    async def remote(session, settings, messages):
        nonlocal fail_report
        yield {'type':'conversation', 'url':'https://chatgpt.com/c/interview-one'}
        answers = [item for item in messages if item['role'] == 'user']
        if session.get('_task') == 'report':
            if fail_report:
                fail_report = False
                raise ValueError('Temporary model failure')
            value = {'report':assessment(answers[-1], final=True)}
        else:
            value = {'question':'How would that behave under concurrent retries?', 'feedback':assessment(answers[-1]) if answers else None}
        raw = json.dumps(value)
        for index in range(0, len(raw), 11):
            yield {'type':'delta', 'text':raw[index:index+11]}
    monkeypatch.setattr(providers, 'stream_answer', remote)
    with TestClient(create_app(str(tmp_path/'reports.db'))) as client:
        client.put('/api/settings',json={'kind':'gateway'})
        session = client.post('/api/sessions',json={'mode':'backend','provider':'gateway','remote_consent':True}).json()
        base = '/api/sessions/'+session['id']
        opening = client.post(base+'/turns',json={'action':'start'})
        assert opening.text.count('"type": "delta"') > 1
        assert '"type": "complete"' in opening.text
        assert client.get(base).json()['gateway_conversation_url'] == 'https://chatgpt.com/c/interview-one'
        client.post(base+'/turns',json={'action':'answer','content':'I would store an idempotency key in the database.'})
        saved = client.get(base).json()
        assert len(saved['assessments']) == 1
        assert saved['assessments'][0]['content']['strengths'][0]['evidence'][0]['message_id'] == saved['messages'][1]['id']
        assert client.post(base+'/report').status_code == 409
        client.post(base+'/control',json={'action':'end'})
        assert 'Temporary model failure' in client.post(base+'/report').text
        assert client.get(base).json()['assessments'][-1]['status'] == 'error'
        assert '"type": "complete"' in client.post(base+'/report').text
        exported = client.get(base+'/export').json()
        assert exported['assessments'][-1]['status'] == 'complete'
        assert len(exported['assessments'][-1]['content']['dimensions']) == 5
        assert len(exported['messages']) == 3
        assert sum(item['role']=='user' for item in exported['messages']) == 1


def test_demo_report_is_honestly_unscored(tmp_path):
    with TestClient(create_app(str(tmp_path/'demo.db'))) as client:
        session = client.post('/api/sessions',json={'mode':'ai'}).json()
        base = '/api/sessions/'+session['id']
        client.post(base+'/control',json={'action':'end'})
        client.post(base+'/report')
        report = client.get(base).json()['assessments'][-1]['content']
        assert 'No AI assessment' in report['summary']
        assert all(item['score'] is None for item in report['dimensions'])


def test_link_validation_does_not_allow_cross_site_or_rebinding(tmp_path):
    with TestClient(create_app(str(tmp_path/'links.db'))) as client:
        client.put('/api/settings',json={'kind':'gateway'})
        session = client.post('/api/sessions',json={'mode':'backend','provider':'gateway','remote_consent':True}).json()
        base = '/api/sessions/'+session['id']+'/conversation'
        assert client.put(base,json={'url':'https://unrelated.example/c/x'}).status_code == 422
        assert client.put(base,json={'url':'https://chatgpt.com/c/one'}).status_code == 200
        assert client.put(base,json={'url':'https://chatgpt.com/c/two'}).status_code == 409


def test_opening_retry_reinstalls_contract_without_creating_new_chat():
    session = {"id":"interrupted", "mode":"backend", "level":"Junior", "topic":"Orders", "phase":"introduction", "gateway_bound":1, "_action":"retry"}
    request = json.loads(providers.conversation(session, {'kind':'gateway'}, [])[0]['content'])
    assert 'interview_instructions' in request
    assert 'interview_history' not in request


def test_report_can_be_cancelled_from_another_browser_request(tmp_path):
    started = threading.Event()
    stopped = threading.Event()
    async def slow_report(session, settings, messages):
        try:
            started.set()
            yield {'type':'preview','text':'Review in progress'}
            await asyncio.sleep(30)
        finally:
            stopped.set()
    with TestClient(create_app(str(tmp_path/'cancel.db'), report_stream=slow_report)) as client:
        session = client.post('/api/sessions',json={'mode':'backend'}).json()
        base = '/api/sessions/'+session['id']
        assert client.post(base+'/report/cancel').status_code == 409
        client.post(base+'/control',json={'action':'end'})
        errors = []
        def request_report():
            try:
                client.post(base+'/report')
            except BaseException as error:
                errors.append(error)
        worker = threading.Thread(target=request_report, daemon=True)
        worker.start()
        assert started.wait(5)
        response = client.post(base+'/report/cancel')
        assert response.status_code == 200
        worker.join(5)
        assert not worker.is_alive()
        assert stopped.is_set()
        assert client.get(base).json()['assessments'][-1]['status'] == 'interrupted'


def test_spoken_question_streams_without_exposing_any_split_metadata_marker():
    question = 'Which index would you add, and why?'
    raw = question + '\n' + FEEDBACK_MARKER + '\n{"feedback":null}'
    for end in range(len(raw)+1):
        visible = spoken_prefix(raw[:end])
        assert question.startswith(visible)
        assert '<' not in visible and 'feedback' not in visible
    assert spoken_prefix(raw) == question


@pytest.mark.parametrize('metadata', ['<escape>{"feedback":null}</escape>', '```json\n{"feedback":null}\n```'])
def test_observed_metadata_wrappers_are_parsed_without_exposing_them(metadata):
    raw = 'What would you clarify?\n'+FEEDBACK_MARKER+'\n'+metadata
    assert interview_envelope(raw) == {'question':'What would you clarify?', 'feedback':None}
    assert spoken_prefix(raw) == 'What would you clarify?'


def test_escape_wrapper_around_entire_metadata_block_is_hidden_incrementally():
    raw = 'Why?\n\n<escape>'+FEEDBACK_MARKER+'\n{"feedback":null}</escape>'
    for end in range(len(raw)+1):
        assert 'Why?'.startswith(spoken_prefix(raw[:end]))
    assert interview_envelope(raw) == {'question':'Why?', 'feedback':None}


def test_individually_escaped_delimiter_and_feedback_are_hidden_and_decoded():
    raw='Why?\n\n<escape>'+FEEDBACK_MARKER+'</escape>\n<escape>{"feedback":null}</escape>'
    for end in range(len(raw)+1):
        assert 'Why?'.startswith(spoken_prefix(raw[:end]))
    assert interview_envelope(raw)=={'question':'Why?','feedback':None}


def test_question_is_yielded_before_feedback_json_exists(monkeypatch):
    reached_metadata = False
    async def raw_stream(session, settings, messages):
        nonlocal reached_metadata
        yield {'type':'delta','text':'What would you'}
        yield {'type':'delta','text':' clarify first?\nINTERVIEW_FEE'}
        reached_metadata = True
        yield {'type':'delta','text':'DBACK_JSON:\n{"feedback":null}'}
    monkeypatch.setattr(providers,'stream_answer',raw_stream)
    async def run():
        stream = providers.stream_interview({'mode':'backend'},{'kind':'gateway'},[])
        first = await anext(stream)
        assert first == {'type':'delta','text':'What would you'}
        assert not reached_metadata
        rest = [piece async for piece in stream]
        assert ''.join(piece['text'] for piece in [first,*rest] if piece['type'] in ('delta','replace')) == 'What would you clarify first?'
    asyncio.run(run())


def test_new_interview_gets_new_chat_without_ending_previous_one(tmp_path, monkeypatch):
    import httpx
    original = httpx.AsyncClient
    requests = []
    def handler(request):
        payload = json.loads(request.content)
        requests.append(payload)
        prompt = json.loads(payload['messages'][0]['content'])
        answer = prompt.get('candidate_answer')
        value = assessment({'id':answer['message_id'],'content':answer['text']}) if answer else None
        text = 'What would you clarify first?\n'+FEEDBACK_MARKER+'\n'+json.dumps({'feedback':value})
        data = 'event: conversation\ndata: '+json.dumps({'conversation_url':'https://chatgpt.com/c/'+payload['conversation_key']})+'\n\n'
        data += 'data: '+json.dumps({'choices':[{'delta':{'content':text}}]})+'\n\ndata: [DONE]\n\n'
        return httpx.Response(200,text=data)
    monkeypatch.setattr(providers.httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(handler),**kw))
    with TestClient(create_app(str(tmp_path/'isolation.db'))) as client:
        client.put('/api/settings',json={'kind':'gateway'})
        first=client.post('/api/sessions',json={'mode':'backend','provider':'gateway','remote_consent':True}).json()
        second=client.post('/api/sessions',json={'mode':'ai','provider':'gateway','remote_consent':True}).json()
        for session in (first,second):
            response=client.post('/api/sessions/'+session['id']+'/turns',json={'action':'start'})
            assert '"type": "complete"' in response.text
        assert all(request['new_conversation'] for request in requests)
        assert requests[0]['conversation_key'] != requests[1]['conversation_key']
        assert client.get('/api/sessions/'+first['id']).json()['status'] == 'active'
        response=client.post('/api/sessions/'+first['id']+'/turns',json={'action':'answer','content':'I would store the key atomically.'})
        assert '"type": "complete"' in response.text
        assert requests[-1]['new_conversation'] is False
        assert requests[-1]['conversation_url'].endswith(first['id'])
        assert 'candidate_answer' in json.loads(requests[-1]['messages'][0]['content'])
        assert 'interview_history' not in requests[-1]['messages'][0]['content']
