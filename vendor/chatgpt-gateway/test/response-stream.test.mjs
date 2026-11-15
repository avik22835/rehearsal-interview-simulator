import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../response-stream.js',import.meta.url),'utf8');
function setup(fetch) {
  const posts=[];
  let control;
  const window={addEventListener(type,fn){if(type==='message')control=fn;},postMessage(value){posts.push(value);}};
  class Socket { constructor(){this.events={};} addEventListener(type,fn){this.events[type]=fn;} receive(value){this.events.message?.({data:JSON.stringify(value)});} }
  const context=vm.createContext({window,location:{origin:'https://chatgpt.com'},URL,TextDecoder,fetch,WebSocket:Socket});
  vm.runInContext(source,context);
  const arm=(token='test')=>control({source:window,data:{source:'interview-gateway-response-v1-control',type:'arm',token}});
  return {context,posts,arm,Socket,stop:()=>control({source:window,data:{source:'interview-gateway-response-v1-control',type:'stop',token:'test'}})};
}

test('network observer captures assistant snapshots and patches without consuming page messages',async()=>{
  const {context,posts,arm,stop,Socket}=setup();
  const ws=new context.WebSocket('wss://chatgpt.com/channel');
  assert.ok(ws instanceof Socket);
  ws.receive({message:{author:{role:'assistant'},content:{content_type:'text',parts:['ignored']}}});
  assert.equal(posts.length,0);
  arm();
  ws.receive({conversation_id:'chat-one',message:{author:{role:'user'},content:{content_type:'text',parts:['not assistant']}}});
  ws.receive({message:{author:{role:'assistant'},channel:'analysis',content:{content_type:'text',parts:['private reasoning']}}});
  ws.receive({message:{author:{role:'assistant'},channel:'final',content:{content_type:'text',parts:['First']},status:'in_progress'}});
  await Promise.resolve();
  ws.receive({p:'/message/content/parts/0',o:'append',v:' question?'});
  ws.receive({p:'/message/status',o:'replace',v:'finished_successfully'});
  await Promise.resolve();
  const snapshots=posts.filter(item=>item.text);
  assert.equal(snapshots[0].text,'First');
  assert.equal(snapshots.at(-1).text,'First question?');
  assert.equal(snapshots.at(-1).done,true);
  assert.equal(snapshots.at(-1).conversationUrl,'https://chatgpt.com/c/chat-one');
  assert.ok(!JSON.stringify(snapshots).includes('private reasoning'));
  stop();
  const count=posts.length;
  ws.receive({p:'/message/content/parts/0',o:'append',v:'ignored after stop'});
  assert.equal(posts.length,count);
});

test('fetch observer reads only a clone and preserves original response and request options',async()=>{
  const data='data: '+JSON.stringify({message:{author:{role:'assistant'},content:{content_type:'text',parts:['Visible immediately']},status:'finished_successfully'}})+'\n\n';
  const response=new Response(data,{headers:{'content-type':'text/event-stream'}});
  Object.defineProperty(response,'url',{value:'https://chatgpt.com/backend-api/f/conversation'});
  const options=new Proxy({},{get(){throw new Error('Request credentials/body must not be inspected');}});
  const {context,posts,arm}=setup(async(url,passed)=>{assert.equal(passed,options);return response;});
  arm();
  const returned=await context.fetch('https://chatgpt.com/backend-api/f/conversation',options);
  assert.equal(returned,response);
  assert.equal(await returned.text(),data);
  for(let index=0;index<20 && !posts.some(item=>item.text);index++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(posts.find(item=>item.text)?.text,'Visible immediately');
});

test('a cancelled fetch cannot publish its late body into a newer turn',async()=>{
  let finishRead;
  const reader={read:()=>new Promise(resolve=>{finishRead=resolve;}),cancel:async()=>{},releaseLock(){}};
  const response={url:'https://chatgpt.com/backend-api/f/conversation',headers:{get:()=> 'text/event-stream'},clone:()=>({body:{getReader:()=>reader}})};
  const {context,posts,arm}=setup(async()=>response);
  arm('old');
  await context.fetch('https://chatgpt.com/backend-api/f/conversation');
  arm('new');
  finishRead({done:false,value:new TextEncoder().encode('data: '+JSON.stringify({message:{author:{role:'assistant'},content:{content_type:'text',parts:['STALE ANSWER']}}})+'\n\n')});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(!posts.some(item=>item.text));
});

test('local control sockets are never observed as assistant responses',async()=>{
  const {context,posts,arm}=setup();
  arm();
  const socket=new context.WebSocket('ws://127.0.0.1:18790/ws');
  socket.receive({message:{author:{role:'assistant'},content:{content_type:'text',parts:['not page output']}}});
  await Promise.resolve();
  assert.equal(posts.length,0);
});

test('worker ticks finish a hidden-page turn even when all page timers are suspended',async()=>{
  let listener,clock=0,sent=false;
  const events=[];
  const editor={offsetParent:{},contentEditable:'true',textContent:'',focus(){}};
  const context=vm.createContext({
    Date:class extends Date {static now(){return clock;}},
    setTimeout(){return 1;},clearTimeout(){},
    chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}},sendMessage:async event=>{events.push(event);return {received:true};}}},
    window:{location:{href:'https://chatgpt.com/c/hidden'}},
    document:{hidden:true,querySelector(selector){if(selector==='#prompt-textarea')return editor;if(selector==='[data-testid="send-button"]')return {disabled:false,click(){sent=true;}};return null;},execCommand(command,unused,value){if(command==='insertText')editor.textContent=value;}},
    GatewayResponseReader:{read:()=>({node:editor,count:sent?1:0,text:sent?(clock<4000?'A partial':'A partial question?'):'',streaming:sent&&clock<4000}),inspect:()=>({})},
    console:{log(){},error(){}},
  });
  vm.runInContext(readFileSync(new URL('../content.js',import.meta.url),'utf8'),context);
  listener({type:'chat',requestId:'hidden',userMessage:'Ask one question',model:'auto',timeout:60000},{},()=>{});
  for(let index=0;index<50&&!events.some(event=>event.type==='response');index++) {
    clock+=500;listener({type:'tick',requestId:'hidden'},{},()=>{});
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(events.find(event=>event.type==='response')?.ok,true);
  assert.ok(events.filter(event=>event.type==='progress').length>=2);
});
