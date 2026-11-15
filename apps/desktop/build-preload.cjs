'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vendor=path.resolve(__dirname,'../../vendor/chatgpt-gateway');
const network=fs.readFileSync(path.join(vendor,'response-stream.js'),'utf8');
const reader=fs.readFileSync(path.join(vendor,'response-reader.js'),'utf8');
const content=fs.readFileSync(path.join(vendor,'content.js'),'utf8');
const telemetry=fs.readFileSync(path.join(__dirname,'chat-preload.cjs'),'utf8');
const bridge=`
if(location.hostname==='chatgpt.com') {
  const {webFrame}=require('electron');
  const listeners=[];
  globalThis.chrome=globalThis.chrome || {};
  chrome.runtime={
    onMessage:{addListener(listener){listeners.push(listener);}},
    async sendMessage(message){
      if(!message || !['progress','response'].includes(message.type))return {received:false};
      return ipcRenderer.invoke('rehearsal:browser-result',message);
    },
  };
  ipcRenderer.on('rehearsal:command',(_,payload)=>{
    if(!payload || !['ping','chat','cancel','tick'].includes(payload.message?.type))return;
    let replied=false;
    const respond=value=>{if(!replied){replied=true;ipcRenderer.send('rehearsal:command-result',{id:payload.id,value});}};
    for(const listener of listeners)listener(payload.message,{},respond);
  });
  // Observe response bodies in the page world, as in the existing extension.
  // This never reads authentication cookies or request headers/bodies.
  void webFrame.executeJavaScript(${JSON.stringify(network)}).catch(()=>{});
  window.addEventListener('DOMContentLoaded',()=>{
    ${reader}
    ${content}
    ipcRenderer.send('rehearsal:adapter-ready');
  },{once:true});
}
`;
fs.mkdirSync(path.join(__dirname,'generated'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'generated/chat-preload.cjs'),telemetry+'\n'+bridge);
console.log('Desktop preload built from the shared gateway readers.');
