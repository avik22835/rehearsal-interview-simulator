'use strict';
const {ipcMain}=require('electron');
const {randomUUID}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
function conversationUrl(value){try{const u=new URL(value);return u.origin==='https://chatgpt.com' && /^\/c\/[a-zA-Z0-9-]+$/.test(u.pathname)?u.origin+u.pathname:null;}catch{return null;}}
async function startDesktopGateway({view,root,record,onState}) {
  const {createGateway}=await import(pathToFileURL(path.join(root,'vendor/chatgpt-gateway/gateway-server.mjs')).href);
  const {server,wss}=createGateway({bindingPath:path.join(root,'data/desktop-conversations.json'),logger:(event,detail)=>record('desktop_gateway_'+event,detail)});
  let ws=null,active=null,ready=false,closed=false;
  const pending=new Map();
  const trusted=event=>event.sender===view.webContents && event.senderFrame===view.webContents.mainFrame && new URL(view.webContents.getURL()).origin==='https://chatgpt.com';
  function send(value){if(ws?.readyState===1)ws.send(JSON.stringify(value));}
  function command(message,timeout=8000){
    if(!ready)return Promise.reject(new Error('Hosted ChatGPT is still loading or needs sign-in.'));
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Hosted ChatGPT did not acknowledge '+message.type));},timeout);
      pending.set(id,{resolve,reject,timer});
      view.webContents.send('rehearsal:command',{id,message});
    });
  }
  const onCommand=(event,payload)=>{
    if(!trusted(event) || !payload || !pending.has(payload.id))return;
    const item=pending.get(payload.id);pending.delete(payload.id);clearTimeout(item.timer);item.resolve(payload.value);
  };
  const onReady=event=>{if(trusted(event)){ready=true;onState({connected:ws?.readyState===1,ready});}};
  const onResult=(event,message)=>{
    if(!trusted(event) || !active || !message || message.requestId!==active.id || !['progress','response'].includes(message.type))return {received:false};
    for(const key of ['content','error'])if(message[key]!==undefined && (typeof message[key]!=='string' || message[key].length>4*1024*1024))return {received:false};
    send({...message,conversationUrl:conversationUrl(message.conversationUrl)||conversationUrl(view.webContents.getURL())});
    if(message.type==='response')active=null;
    return {received:true};
  };
  ipcMain.on('rehearsal:command-result',onCommand);
  ipcMain.on('rehearsal:adapter-ready',onReady);
  ipcMain.handle('rehearsal:browser-result',onResult);
  view.webContents.on('did-start-navigation',(_event,_url,inPlace,isMainFrame)=>{
    if(isMainFrame && !inPlace){ready=false;for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Hosted ChatGPT navigated.'));}pending.clear();}
  });
  async function waitReady(owner){
    const end=Date.now()+45000;
    while(Date.now()<end){
      if(owner && active!==owner)throw new Error('Desktop request was cancelled before submission.');
      if(ready){const state=await command({type:'ping'});if(state?.ok && state.composerReady)return state;}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw new Error('Hosted ChatGPT did not become ready. Open its panel and check sign-in.');
  }
  async function handle(message){
    if(message.type==='keepalive')return;
    if(message.type==='inspect'){
      try{const state=await command({type:'ping'});send({type:'inspection',requestId:message.requestId,ok:true,data:{extensionVersion:'desktop-0.2.0',activeRequest:active?.id||null,diagnostics:state.diagnostics,desktop:true}});}
      catch(error){send({type:'inspection',requestId:message.requestId,ok:false,error:error.message});}return;
    }
    if(message.type==='cancel'){
      const current=active;
      if(current?.id===message.requestId){current.cancelled=true;try{if(ready)await command({type:'cancel',requestId:current.id},10000);active=null;send({type:'cancelled',requestId:current.id});}catch{ws.close();}}
      else send({type:'cancelled',requestId:message.requestId});
      return;
    }
    if(message.type!=='chat')return;
    if(active){send({type:'response',requestId:message.requestId,ok:false,error:'Desktop browser already has an active request.'});return;}
    const owner={id:message.requestId};active=owner;
    try{
      const url=conversationUrl(message.conversationBinding?.url);
      if(url && conversationUrl(view.webContents.getURL())!==url)await view.webContents.loadURL(url);
      else if(message.newConversation)await view.webContents.loadURL('https://chatgpt.com/');
      const state=await waitReady(owner);
      if(owner.cancelled || active!==owner)return;
      if(state.activeTurnId && state.activeTurnId!==owner.id)await command({type:'cancel',requestId:state.activeTurnId},10000);
      if(url && conversationUrl(view.webContents.getURL())!==url)throw new Error('Hosted ChatGPT changed conversation before submission.');
      send({type:'conversation',requestId:owner.id,binding:{tabId:view.webContents.id,documentId:state.documentId,url:conversationUrl(view.webContents.getURL())}});
      const user=[...(message.messages||[])].reverse().find(item=>item.role==='user');
      if(!user?.content)throw new Error('No prompt was supplied.');
      const accepted=await command({type:'chat',requestId:owner.id,userMessage:user.content,model:message.model,timeout:message.timeout,conversationUrl:url,newConversation:message.newConversation});
      if(!accepted?.accepted)throw new Error(accepted?.error||'Hosted page refused the request.');
    }catch(error){if(active===owner){send({type:'response',requestId:owner.id,ok:false,error:error.message});active=null;}}
  }
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(18791,'127.0.0.1',resolve);});
  function connect(){
    if(closed)return;
    ws=new WebSocket('ws://127.0.0.1:18791/ws');
    ws.addEventListener('open',()=>{send({type:'hello',version:'desktop-0.2.0',protocol:4});onState({connected:true,ready,port:18791});});
    ws.addEventListener('message',event=>{try{void handle(JSON.parse(event.data)).catch(error=>record('desktop_adapter_error',{message:error.message}));}catch{}});
    ws.addEventListener('error',()=>{});
    ws.addEventListener('close',()=>{onState({connected:false,ready});if(active && ready)void command({type:'cancel',requestId:active.id}).catch(()=>{});active=null;if(!closed)setTimeout(connect,1000);});
  }
  connect();
  const timer=setInterval(()=>{if(active && ready)void command({type:'tick',requestId:active.id},2000).catch(()=>{});},500);
  return {port:18791,close(){closed=true;clearInterval(timer);for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Desktop host closed.'));}pending.clear();ipcMain.removeListener('rehearsal:command-result',onCommand);ipcMain.removeListener('rehearsal:adapter-ready',onReady);ipcMain.removeHandler('rehearsal:browser-result');ws?.close();for(const client of wss.clients)client.terminate();wss.close();server.close();}};
}
module.exports={startDesktopGateway,conversationUrl};
