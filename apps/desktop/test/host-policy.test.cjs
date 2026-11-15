const {test}=require('node:test');
const assert=require('node:assert/strict');
const {allowedNavigation,layout,sanitizeHealth,safeOrigin,allowedStudioAudio}=require('../host-policy.cjs');
test('only trusted studio audio capture is granted',()=>{
  assert.equal(allowedStudioAudio('media','http://127.0.0.1:3000/',{mediaTypes:['audio']}),true);
  assert.equal(allowedStudioAudio('media','http://127.0.0.1:3000',{mediaType:'audio'}),true);
  for(const origin of ['https://chatgpt.com','http://127.0.0.1:3000.evil.test','http://127.0.0.1:3001'])assert.equal(allowedStudioAudio('media',origin,{mediaTypes:['audio']}),false);
  for(const mediaTypes of [[],['video'],['audio','video']])assert.equal(allowedStudioAudio('media','http://127.0.0.1:3000',{mediaTypes}),false);
  assert.equal(allowedStudioAudio('media','http://127.0.0.1:3000',{mediaType:'audio',isMainFrame:false}),false);
  assert.equal(allowedStudioAudio('display-capture','http://127.0.0.1:3000',{mediaType:'audio'}),false);
});
test('remote navigation excludes local files, credentials and deceptive domains',()=>{
  for(const value of ['https://chatgpt.com/','https://auth.openai.com/log-in','https://accounts.google.com/'])assert.equal(allowedNavigation(value),true);
  for(const value of ['file:///C:/private','http://chatgpt.com/','https://chatgpt.com.evil.test/','https://evilopenai.com/','https://user:secret@chatgpt.com/','javascript:alert(1)'])assert.equal(allowedNavigation(value),false);
});
test('logs retain origin without tokens or conversation paths',()=>{
  assert.equal(safeOrigin('https://auth.openai.com/callback?code=private'),'https://auth.openai.com');
});
test('split and focused views remain within the available host bounds',()=>{
  for(const width of [0,420,960,1440])for(const mode of ['split','studio','chat']){
    const parts=layout(width,800,mode);
    for(const item of Object.values(parts).filter(Boolean))assert.ok(item.x>=0 && item.width>=0 && item.x+item.width<=width);
    if(mode==='split')assert.equal(parts.studio.width+parts.chat.width,width);
  }
});
test('remote telemetry has a bounded schema and does not retain arbitrary fields',()=>{
  const sample={event:'tick',hidden:false,focused:true,composerReady:true,ticks:2,elapsedMs:2000,maxGapMs:1002,secret:'discard'};
  assert.equal(sanitizeHealth(sample).secret,undefined);
  assert.equal(sanitizeHealth({...sample,event:'run-shell'}),null);
  assert.equal(sanitizeHealth({...sample,ticks:Infinity}),null);
});
