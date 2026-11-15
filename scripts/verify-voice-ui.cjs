// Browser/audio integration against isolated API 8001 and web 3001 only.
const {chromium}=require('C:/Users/KIIT0001/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const http=require('node:http');
(async()=>{
 const earlyListening=process.env.REHEARSAL_EARLY_LISTEN_TEST==='1';
 let modelTurn=0,firstSpeechAt=0,firstReplyDoneAt=0;
 const model=http.createServer((req,res)=>{if(req.method!=='POST'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"data":[{"id":"voice-test"}]}');return;}let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
   modelTurn++;res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
   const chunk=text=>res.write('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n');
   chunk(modelTurn===1?'How would you test a hash map? ':'Why does that approach work? ');
   setTimeout(()=>{chunk(modelTurn===1?'What edge cases matter?\nINTERVIEW_FEEDBACK_JSON:\n':'\nINTERVIEW_FEEDBACK_JSON:\n');setTimeout(()=>{chunk('{"feedback":null}');if(modelTurn===1)firstReplyDoneAt=Date.now();res.end('data: [DONE]\n\n');},earlyListening?6500:0);},1800);
 });});await new Promise(resolve=>model.listen(19895,'127.0.0.1',resolve));
 const proxy=http.createServer((req,res)=>{const port=req.url.startsWith('/api/')?8001:3001;const upstream=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${port}`,origin:'http://127.0.0.1:3000','accept-encoding':'identity'}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});upstream.on('error',()=>res.end());req.pipe(upstream);});await new Promise(resolve=>proxy.listen(3002,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['microphone']});const page=await context.newPage();const errors=[],spoken=[],transcribed=[],turns=[];
 page.on('pageerror',e=>errors.push(e.message));
 const clip=fs.readFileSync(path.join(__dirname,'../data/voice-sample.wav'));
 let responseNumber=0;
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=req.url();
  if(url.endsWith('/voice/status'))return route.fulfill({json:{ready:true,voices:{piper_lessac:'Lessac · quick response'},loaded:{recognition:true,synthesis:true}}});
  if(url.endsWith('/voice/warm'))return route.fulfill({json:{ready:true,voices:{piper_lessac:'Lessac · quick response'},loaded:{recognition:true,synthesis:true}}});
  if(url.endsWith('/voice/transcribe')){const raw=req.postDataBuffer();assert.equal(raw.toString('ascii',0,4),'RIFF');assert.ok(raw.length>3200);transcribed.push(raw.length);return route.fulfill({json:{text:'I would use a hash map for constant time lookup.'}});}
  if(url.endsWith('/voice/speak')){if(!firstSpeechAt)firstSpeechAt=Date.now();spoken.push(req.postDataJSON().text);return route.fulfill({body:clip,contentType:'audio/wav'});}
  if(url.endsWith('/turns')){
    turns.push(req.postDataJSON());
    return route.continue(); // Native streaming through the isolated proxy, never buffered route.fetch.
  }
  const response=await route.fetch({url:url.replace('127.0.0.1:3002','127.0.0.1:8001'),headers:{...req.headers(),origin:'http://127.0.0.1:3000'}});await route.fulfill({response});
 });
 try{
   await page.request.put('http://127.0.0.1:8001/api/settings',{data:{kind:'compatible',base_url:'http://127.0.0.1:19895/v1',model:'voice-test',stream:true}});
   const session=await(await page.request.post('http://127.0.0.1:8001/api/sessions',{data:{mode:'backend',provider:'compatible',remote_consent:true,topic:'Voice browser verification'}})).json();
   await page.goto('http://127.0.0.1:3002');await page.getByRole('button',{name:new RegExp(session.title)}).first().click();
   if(earlyListening){
     await page.getByRole('button',{name:'Hands-free off',exact:true}).click();await page.getByRole('button',{name:/Ask the first question/}).click();await page.getByRole('button',{name:/Stop & review/}).waitFor({timeout:20000});
     assert.equal(firstReplyDoneAt,0,'Listening should not wait for feedback metadata');assert.equal(transcribed.length,0);
     const result={listeningBeforeMetadata:true,firstSpeechAt,listeningAt:Date.now(),errors};assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'../data/handsfree-early-listening.json'),JSON.stringify(result,null,2));await page.screenshot({path:path.join(__dirname,'../data/handsfree-listening.png'),fullPage:true,animations:'disabled'});await page.getByRole('button',{name:'Hands-free on',exact:true}).click();console.log(JSON.stringify(result));return;
   }
   await page.getByRole('button',{name:'Spoken replies off'}).click();await page.getByRole('button',{name:/Ask the first question/}).click();
   await page.getByRole('button',{name:'Replay question'}).waitFor();await page.waitForTimeout(2500);if(!spoken.some(text=>text.includes('hash map')))console.log(JSON.stringify({modelTurn,spoken,errors,body:(await page.locator('body').innerText()).slice(-2200)}));assert.ok(spoken.some(text=>text.includes('hash map')),'Spoken interview question missing');
   assert.ok(firstSpeechAt<firstReplyDoneAt,'Speech should begin before the full response metadata finishes');
   await page.getByRole('button',{name:'Record answer',exact:true}).click();await page.getByRole('button',{name:/Stop ·/}).waitFor();
   await page.waitForTimeout(1100);assert.equal(await page.getByRole('button',{name:'Stop audio',exact:true}).count(),0,'Recording must stop playback');
   await page.getByRole('button',{name:/Stop ·/}).click();await page.getByLabel('Review your answer').waitFor();
   assert.ok(transcribed.length);await page.getByLabel('Review your answer').fill('Edited transcript: I would use a hash map.');
   await page.locator('.voice-transcript').getByRole('button',{name:'Send answer',exact:true}).click();await page.waitForTimeout(400);
   assert.equal(turns.at(-1).content,'Edited transcript: I would use a hash map.');
   await page.getByRole('button',{name:'Spoken replies on'}).click();assert.equal(await page.getByRole('button',{name:'Stop audio',exact:true}).count(),0);
   await page.screenshot({path:path.join(__dirname,'../data/voice-ui-dark.png'),fullPage:true,animations:'disabled'});
   assert.deepEqual(errors,[]);assert.ok(spoken.every(text=>!text.includes('FEEDBACK')&&!text.includes('{')));const result={microphoneCapture:true,editableTranscript:true,sentCorrectedText:true,playbackInterrupted:true,speechBeforeMetadata:true,firstSpeechAt,firstReplyDoneAt,spoken,errors};fs.writeFileSync(path.join(__dirname,'../data/voice-ui-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();model.close();proxy.close();model.closeAllConnections();proxy.closeAllConnections();}
})().catch(error=>{console.error(error);process.exitCode=1;});
