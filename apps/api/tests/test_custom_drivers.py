import asyncio
import json
import os
import pytest
from fastapi.testclient import TestClient
from app.coding_contract import Problem
from app.main import create_app
from app.python_runner import execute_python

def problem(driver,entry,starter,args,expected):
    return Problem(title='Adapter exercise',statement='Use the specified Python interface and preserve its semantics.',entry_point=entry,starter_code=starter,
        driver={'code':driver,'description':'Fixture conversion and candidate invocation only.','input_format':'JSON fixtures described by this adapter.','output_format':'JSON observation.'},
        examples=[{'label':'Public case','args':args,'expected':expected}]).model_dump()

LINKED='''class ListNode:
 def __init__(self,val=0,next=None): self.val=val;self.next=next
CANDIDATE_GLOBALS={"ListNode":ListNode}
def run_case(candidate,args,kwargs):
 head=None
 for value in reversed(args[0]): head=ListNode(value,head)
 node=candidate.Solution().reverseList(head);values=[];seen=set()
 while node:
  if id(node) in seen: raise ValueError("Unexpected cycle")
  seen.add(id(node));values.append(node.val);node=node.next
 return values
'''
TREE='''from collections import deque
class TreeNode:
 def __init__(self,val=0,left=None,right=None): self.val=val;self.left=left;self.right=right
CANDIDATE_GLOBALS={"TreeNode":TreeNode}
def run_case(candidate,args,kwargs):
 values=iter(args[0]);first=next(values,None);root=TreeNode(first) if first is not None else None
 queue=deque([root] if root else [])
 while queue:
  node=queue.popleft()
  for field in ("left","right"):
   value=next(values,None)
   if value is not None: child=TreeNode(value);setattr(node,field,child);queue.append(child)
 root=candidate.Solution().invertTree(root);out=[];queue=deque([root] if root else [])
 while queue:
  node=queue.popleft();out.append(node.val if node else None)
  if node: queue.extend([node.left,node.right])
 while out and out[-1] is None: out.pop()
 return out
'''
DESIGN='''def run_case(candidate,args,kwargs):
 operations,arguments=args
 if len(operations)!=len(arguments): raise ValueError("Operation/argument length mismatch")
 instance=getattr(candidate,operations[0])(*arguments[0]);out=[None]
 for name,params in zip(operations[1:],arguments[1:]): out.append(getattr(instance,name)(*params))
 return out
'''
INPLACE='''def run_case(candidate,args,kwargs):
 nums=args[0];k=candidate.Solution().removeDuplicates(nums)
 return {"k":k,"prefix":nums[:k]}
'''
GRAPH='''class Node:
 def __init__(self,val=0,neighbors=None): self.val=val;self.neighbors=neighbors or []
CANDIDATE_GLOBALS={"Node":Node}
def run_case(candidate,args,kwargs):
 nodes={i+1:Node(i+1) for i in range(len(args[0]))}
 for key,neighbors in enumerate(args[0],1): nodes[key].neighbors=[nodes[value] for value in neighbors]
 result=candidate.Solution().cloneGraph(nodes.get(1));seen={};todo=[result] if result else []
 while todo:
  node=todo.pop()
  if node.val in seen: continue
  seen[node.val]=node;todo.extend(node.neighbors)
 return {"adjacency":[[n.val for n in seen[key].neighbors] for key in sorted(seen)],"cloned":all(node not in nodes.values() for node in seen.values())}
'''
RANDOM='''class Node:
 def __init__(self,val=0,next=None,random=None):self.val=val;self.next=next;self.random=random
CANDIDATE_GLOBALS={"Node":Node}
def run_case(candidate,args,kwargs):
 source=[Node(item[0]) for item in args[0]]
 for i,item in enumerate(args[0]):
  source[i].next=source[i+1] if i+1<len(source) else None
  source[i].random=source[item[1]] if item[1] is not None else None
 head=candidate.Solution().copyRandomList(source[0] if source else None);nodes=[];seen=set()
 while head:
  if id(head) in seen:raise ValueError("Cycle in next pointers")
  seen.add(id(head));nodes.append(head);head=head.next
 ids={node:i for i,node in enumerate(nodes)}
 return {"nodes":[[n.val,ids[n.random] if n.random else None] for n in nodes],"cloned":all(n not in source for n in nodes)}
'''
API='''first_bad=1
def isBadVersion(value):return value>=first_bad
CANDIDATE_GLOBALS={"isBadVersion":isBadVersion}
def run_case(candidate,args,kwargs):
 global first_bad
 first_bad=args[1]
 return candidate.Solution().firstBadVersion(args[0])
'''
PROPERTY='''def run_case(candidate,args,kwargs):
 n,edges=args;order=candidate.solve(n,edges)
 if not isinstance(order,list) or len(order)!=n or set(order)!=set(range(n)):return False
 positions={value:index for index,value in enumerate(order)}
 return all(positions[a]<positions[b] for a,b in edges)
'''

CASES=[
 (LINKED,'Solution.reverseList','class Solution:\n def reverseList(self,head: Optional[ListNode]) -> Optional[ListNode]:\n  pass',
  'class Solution:\n def reverseList(self,head: Optional[ListNode]) -> Optional[ListNode]:\n  previous=None\n  while head:\n   nxt=head.next;head.next=previous;previous=head;head=nxt\n  return previous',[[1,2,3]],[3,2,1]),
 (TREE,'Solution.invertTree','class Solution:\n def invertTree(self,root): pass',
  'class Solution:\n def invertTree(self,root):\n  if root: root.left,root.right=self.invertTree(root.right),self.invertTree(root.left)\n  return root',[[1,2,3,None,4]],[1,3,2,None,None,4]),
 (DESIGN,'MinStack','class MinStack:\n def __init__(self): pass\n def push(self,x): pass\n def pop(self): pass\n def getMin(self): pass',
  'class MinStack:\n def __init__(self): self.values=[]\n def push(self,x): self.values.append(x)\n def pop(self): self.values.pop()\n def getMin(self): return min(self.values)',[['MinStack','push','push','getMin','pop','getMin'],[[],[3],[1],[],[],[]]],[None,None,None,1,None,3]),
 (INPLACE,'Solution.removeDuplicates','class Solution:\n def removeDuplicates(self,nums): pass',
  'class Solution:\n def removeDuplicates(self,nums):\n  nums[:]=sorted(set(nums));return len(nums)',[[1,1,2,3,3]],{'k':3,'prefix':[1,2,3]}),
 (GRAPH,'Solution.cloneGraph','class Solution:\n def cloneGraph(self,node): pass',
  'class Solution:\n def cloneGraph(self,node):\n  copies={}\n  def clone(n):\n   if n not in copies:\n    copies[n]=Node(n.val);copies[n].neighbors=[clone(x) for x in n.neighbors]\n   return copies[n]\n  return clone(node) if node else None',[[[2],[1]]],{'adjacency':[[2],[1]],'cloned':True}),
 (RANDOM,'Solution.copyRandomList','class Solution:\n def copyRandomList(self,head): pass',
  'class Solution:\n def copyRandomList(self,head):\n  copies={None:None};node=head\n  while node: copies[node]=Node(node.val);node=node.next\n  node=head\n  while node: copies[node].next=copies[node.next];copies[node].random=copies[node.random];node=node.next\n  return copies[head]',[[[7,None],[13,0]]],{'nodes':[[7,None],[13,0]],'cloned':True}),
 (API,'Solution.firstBadVersion','class Solution:\n def firstBadVersion(self,n): pass',
  'class Solution:\n def firstBadVersion(self,n):\n  low,high=1,n\n  while low<high:\n   mid=(low+high)//2\n   if isBadVersion(mid): high=mid\n   else: low=mid+1\n  return low',[10,6],6),
 (PROPERTY,'solve','def solve(n,edges): pass','def solve(n,edges): return [1,0,2]',[3,[[0,2],[1,2]]],True),
]

@pytest.mark.skipif(os.getenv('REHEARSAL_DOCKER_TESTS')!='1',reason='Real Docker adapter integration')
@pytest.mark.parametrize('driver,entry,starter,solution,args,expected',CASES)
def test_real_custom_drivers(driver,entry,starter,solution,args,expected):
    value=problem(driver,entry,starter,args,expected)
    result=asyncio.run(execute_python(solution,value))
    assert result['cases'][0]['status']=='passed',result
    assert result['driver']['source']=='model' and result['driver']['files']['adapter.py']==driver
    assert len(result['driver']['sha256'])==64

def test_driver_validation_never_executes_code_and_class_stays_unsolved(tmp_path):
    target=tmp_path/'must-not-exist'
    driver=f'open({str(target)!r},"w").write("bad")\n'+DESIGN
    problem(driver,'MinStack','class MinStack:\n def __init__(self): pass',[['MinStack'],[[]]],[None])
    assert not target.exists()
    with pytest.raises(ValueError):problem('print(1)','solve','def solve(): pass',[],0)
    with pytest.raises(ValueError):problem(DESIGN,'MinStack','class MinStack:\n def getMin(self): return 1',[],0)

@pytest.mark.skipif(os.getenv('REHEARSAL_DOCKER_TESTS')!='1',reason='Real Docker adapter isolation')
def test_faulty_and_hanging_adapters_are_reported_without_host_execution():
    for prefix,status in [('open("/work/main.py","w").write("bad")\n','error'),('while True: pass\n','timeout')]:
        value=problem(prefix+INPLACE,'Solution.removeDuplicates','class Solution:\n def removeDuplicates(self,nums): pass',[[1,1]],{'k':1,'prefix':[1]})
        result=asyncio.run(execute_python('class Solution:\n def removeDuplicates(self,nums): return 1',value))
        assert result['cases'][0]['status']==status,result
        assert result['driver']['source']=='model'
        if status=='error':assert result['cases'][0]['error_stage']=='driver_setup'

def test_model_preparation_retains_inspectable_driver_and_export(monkeypatch,tmp_path):
    from app import coding
    value=problem(LINKED,'Solution.reverseList','class Solution:\n def reverseList(self,head): pass',[[1,2]],[2,1])
    async def stream(*args):yield {'type':'delta','text':json.dumps({'clarification':None,'problem':value})}
    monkeypatch.setattr(coding,'stream_answer',stream)
    with TestClient(create_app(str(tmp_path/'driver.db'))) as client:
        client.put('/api/settings',json={'kind':'compatible','base_url':'http://127.0.0.1:9999/v1'})
        session=client.post('/api/sessions',json={'mode':'dsa','provider':'compatible','remote_consent':True}).json()
        result=client.post(f"/api/sessions/{session['id']}/coding/prepare",json={'source':'generate','request':'Reverse linked list'})
        assert result.status_code==200,result.text
        workspace=result.json()['workspace'];assert workspace['execution_driver']['files']['adapter.py']==LINKED
        exported=client.get(f"/api/sessions/{session['id']}/export").json()
        assert exported['coding_workspaces'][0]['problem']['driver']['code']==LINKED
