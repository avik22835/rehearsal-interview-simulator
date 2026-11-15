"""Synthetic, explicitly named interview using the installed desktop provider."""
import json
from pathlib import Path
import httpx

root=Path(__file__).resolve().parents[1]
with httpx.Client(base_url='http://127.0.0.1:8000/api',timeout=240) as client:
    settings=client.get('/settings').json()
    assert settings['kind']=='gateway','Keep the existing provider configuration; this check needs the desktop gateway.'
    health=httpx.get(settings['base_url'].rsplit('/v1',1)[0]+'/health').json()
    assert health['extensionConnected'] and health['pendingRequests']==0,'Provider must be connected and idle.'
    session=client.post('/sessions',json={'mode':'dsa','provider':'gateway','remote_consent':True,'duration':5,'topic':'Verification · generated linked-list driver'});session.raise_for_status();sid=session.json()['id']
    print('Preparing a live linked-list workspace',flush=True)
    prepared=client.post(f'/sessions/{sid}/coding/prepare',json={'source':'generate','request':'Reverse Linked List. Preserve Solution.reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]. Generate the driver adapter and ListNode helper in driver.CANDIDATE_GLOBALS, convert list fixtures to nodes and serialize the returned head to a list. Include a nonempty and an empty public example. Starter method must remain unsolved.'});prepared.raise_for_status()
    workspace=prepared.json()['workspace'];assert workspace['problem'].get('driver'),'The real model did not supply the required custom driver.'
    solution='class Solution:\n    def reverseList(self, head):\n        previous = None\n        while head:\n            nxt = head.next\n            head.next = previous\n            previous = head\n            head = nxt\n        return previous\n'
    executed=client.post(f'/sessions/{sid}/coding/run',json={'workspace_id':workspace['id'],'expected_revision':workspace['revision'],'code':solution});executed.raise_for_status()
    result=executed.json()['runs'][0]['result'];passed=sum(case['passed'] for case in result['cases'])
    evidence={'session_id':sid,'provider':'live desktop ChatGPT','problem':workspace['problem'],'driver':workspace['execution_driver'],'result':result}
    (root/'data/driver-live-verification.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
    assert passed==len(result['cases']) and passed>=2,result
    print(json.dumps({'passed':True,'public_cases':passed,'custom_driver':True,'driver_sha256':result['driver']['sha256'],'session_id':sid}),flush=True)
