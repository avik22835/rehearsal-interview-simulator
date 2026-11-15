'use strict';
// Read-only lifecycle telemetry. No credentials, prompts, page text or general
// Node/Electron APIs are exposed to the remote website.
const {ipcRenderer} = require('electron');
let ticks=0, previous=performance.now(), maxGapMs=0;
const started=previous;
function sample(event) {
  const time=performance.now();
  maxGapMs=Math.max(maxGapMs,time-previous);previous=time;
  ipcRenderer.send('rehearsal:page-health', {
    event, ticks, elapsedMs:time-started, maxGapMs,
    hidden:document.hidden, focused:document.hasFocus(),
    composerReady:location.hostname==='chatgpt.com' && !!document.querySelector('#prompt-textarea, #mobile-composer-prompt, [contenteditable="true"][role="textbox"]'),
  });
}
window.addEventListener('DOMContentLoaded',()=>sample('ready'),{once:true});
for(const event of ['visibilitychange','freeze','resume']) document.addEventListener(event,()=>sample(event));
setInterval(()=>{ticks++;sample('tick');},1000);
