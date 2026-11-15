// Isolated test services 8001/3001 only; synthetic linked-list fixture.
const {chromium}=require('C:/Users/KIIT0001/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const http=require('node:http'),fs=require('node:fs'),assert=require('node:assert/strict');
const adapter=`class ListNode:
 def __init__(self,val=0,next=None):self.val=val;self.next=next
CANDIDATE_GLOBALS={"ListNode":ListNode}
def run_case(candidate,args,kwargs):
 head=None
 for value in reversed(args[0]):head=ListNode(value,head)
 node=candidate.Solution().reverseList(head);out=[]
 while node:out.append(node.val);node=node.next
 return out
`;
const problem={title:'Reverse a linked list',statement:'Reverse a singly linked list and return the new head.',constraints:['Zero to 100 nodes'],entry_point:'Solution.reverseList',io_mode:'function',starter_code:'class Solution:\n    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:\n        pass\n',notes:'Preserve the node-based API.',driver:{code:adapter,description:'Build and serialize ListNode fixtures.',input_format:'args=[values], including an empty list.',output_format:'Node values from the returned head.'},examples:[{label:'Three nodes',args:[[1,2,3]],kwargs:{},stdin:'',expected:[3,2,1],comparison:'exact'},{label:'Empty',args:[[]],kwargs:{},stdin:'',expected:[],comparison:'exact'}]};
(async()=>{const model=http.createServer((req,res)=>{if(req.method!=='POST'){res.end('{"data":[]}');return;}req.resume();req.on('end',()=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({clarification:null,problem})}}]}));});});await new Promise(resolve=>model.listen(19897,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));try{
 await page.route('**/api/**',async route=>{const response=await route.fetch({url:route.request().url().replace('127.0.0.1:3001','127.0.0.1:8001'),headers:{...route.request().headers(),origin:'http://127.0.0.1:3000'}});await route.fulfill({response});});
 await page.request.put('http://127.0.0.1:8001/api/settings',{data:{kind:'compatible',base_url:'http://127.0.0.1:19897/v1',model:'driver-test',stream:false}});
 const session=await(await page.request.post('http://127.0.0.1:8001/api/sessions',{data:{mode:'dsa',provider:'compatible',remote_consent:true,topic:'Driver browser verification'}})).json();
 const prepared=await page.request.post(`http://127.0.0.1:8001/api/sessions/${session.id}/coding/prepare`,{data:{source:'generate',request:'Reverse a linked list'}});assert.ok(prepared.ok(),await prepared.text());
 await page.goto('http://127.0.0.1:3001');await page.getByRole('button',{name:new RegExp(session.title)}).first().click();await page.getByText('main.py',{exact:true}).waitFor();
 await page.getByRole('tab',{name:'Driver',exact:true}).click();assert.equal(await page.getByLabel('Full execution driver code').innerText(),adapter);await page.getByLabel('Driver file').selectOption('invoke.py');assert.ok((await page.getByLabel('Full execution driver code').innerText()).includes('adapter.run_case'));
 const solution='class Solution:\n    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:\n        previous = None\n        while head:\n            nxt = head.next\n            head.next = previous\n            previous = head\n            head = nxt\n        return previous\n';
 // Set the actual editor model: keyboard.insertText treats every newline as a
 // typed Enter and adds indentation, unlike a real multiline paste.
 await page.locator('.monaco-editor').first().waitFor();await page.evaluate(value=>{const model=window.monaco.editor.getModels().find(model=>model.getValue().includes('class Solution'));if(!model)throw Error('Editor model missing');model.setValue(value);},solution);
 await page.getByRole('button',{name:/Run examples/}).click();await page.getByText('All selected cases passed',{exact:true}).waitFor({timeout:30000});
 await page.getByLabel('Driver snapshot').selectOption('run');await page.getByLabel('Driver file').selectOption('adapter.py');assert.equal(await page.getByLabel('Full execution driver code').innerText(),adapter);assert.deepEqual(errors,[]);await page.screenshot({path:'data/driver-workspace.png',fullPage:true,animations:'disabled'});console.log(JSON.stringify({passed:true,customDriverVisible:true,applicationWrapperVisible:true,recordedDriverVisible:true,linkedListDockerCases:2,errors}));
}catch(error){console.error('Driver UI assertion:',error);await page.screenshot({path:'data/driver-ui-failure.png',fullPage:true});throw error;}finally{await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();model.close();model.closeAllConnections();}})().catch(error=>{console.error(error);process.exitCode=1;});
