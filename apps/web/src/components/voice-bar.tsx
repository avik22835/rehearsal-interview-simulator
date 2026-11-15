'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Mic,Square,Volume2,VolumeX,RotateCcw,LoaderCircle,Send} from 'lucide-react';
import {api,type Session} from '@/lib/api';
import {pcmWave,speechSegments} from '@/lib/speech';

type Status={ready:boolean;message:string;voices:Record<string,string>;loaded:{recognition:boolean;synthesis:boolean}};
type Recording={stream:MediaStream;context:AudioContext;node:AudioWorkletNode;chunks:Float32Array[];timer:ReturnType<typeof setInterval>;rate:number;automatic:boolean;sessionId:string;questionId:string;questionText:string;held:boolean;waitForSpeechUntil:number};
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function checked(response:Response){if(response.ok)return response;const body=await response.json().catch(()=>({}));throw new Error(typeof body.detail==='string'?body.detail:'Local speech failed. Please try again.');}

export default function VoiceBar({session,busy,onAnswer}:{session:Session;busy:boolean;onAnswer:(text:string)=>void}) {
  const [status,setStatus]=useState<Status|null>(null),[enabled,setEnabled]=useState(false),[voice,setVoice]=useState('piper_lessac'),[speed,setSpeed]=useState(1),[volume,setVolume]=useState(0.85);
  const [stage,setStage]=useState<'idle'|'starting'|'recording'|'transcribing'>('idle'),[seconds,setSeconds]=useState(0),[transcript,setTranscript]=useState(''),[error,setError]=useState(''),[speaking,setSpeaking]=useState(false),[warming,setWarming]=useState(false);
  const [handsFree,setHandsFree]=useState(false),[pauseMs,setPauseMs]=useState(3000),[held,setHeld]=useState(false),[remainingMs,setRemainingMs]=useState<number|null>(null),[heardSpeech,setHeardSpeech]=useState(false);
  const automatic=useRef(false),listenedTo=useRef(''),pendingAnswer=useRef<{text:string;sessionId:string;questionId:string}|null>(null),[pendingVersion,setPendingVersion]=useState(0);
  const captureGeneration=useRef(0);
  const current=useRef({session,busy,onAnswer});current.current={session,busy,onAnswer};
  const recording=useRef<Recording|null>(null),pendingMic=useRef(false),mounted=useRef(true),abort=useRef(new AbortController()),micAbort=useRef(new AbortController());
  const audio=useRef<HTMLAudioElement|null>(null),audioURL=useRef(''),generation=useRef(0),texts=useRef<string[]>([]),clips=useRef<Blob[]>([]),synthesizing=useRef(false),playing=useRef(false);
  const cursor=useRef({id:'',offset:0,prefix:''}),preferences=useRef({voice,speed,volume}),stopRecordingRef=useRef<(discard?:boolean,submitAutomatically?:boolean)=>Promise<void>>(async()=>{});
  const mutedMessage=useRef('');
  const container=useRef<HTMLElement>(null);
  preferences.current={voice,speed,volume};
  useEffect(()=>{const bar=container.current,parent=bar?.parentElement;if(!bar||!parent)return;const measure=()=>parent.style.setProperty('--voice-height',`${Math.ceil(bar.getBoundingClientRect().height)+18}px`);measure();const observer=new ResizeObserver(measure);observer.observe(bar);return()=>{observer.disconnect();parent.style.removeProperty('--voice-height');};},[]);
  const stopPlayback=useCallback(()=>{generation.current++;abort.current.abort();abort.current=new AbortController();texts.current=[];clips.current=[];synthesizing.current=false;playing.current=false;if(audio.current){audio.current.pause();audio.current.onended=null;audio.current.onerror=null;audio.current=null;}if(audioURL.current){URL.revokeObjectURL(audioURL.current);audioURL.current='';}if(mounted.current)setSpeaking(false);},[]);
  const discardCapture=useCallback(()=>{captureGeneration.current++;pendingMic.current=false;micAbort.current.abort();micAbort.current=new AbortController();const current=recording.current;recording.current=null;if(current){clearInterval(current.timer);current.node.disconnect();current.node.port.onmessage=null;current.stream.getTracks().forEach(track=>track.stop());void current.context.close();}if(mounted.current){setStage('idle');setHeld(false);setRemainingMs(null);setHeardSpeech(false);}},[]);
  const pauseAutomatic=useCallback(()=>{automatic.current=false;pendingAnswer.current=null;if(mounted.current)setHandsFree(false);},[]);
  useEffect(()=>{mounted.current=true;void api<Status>('/voice/status').then(setStatus).catch(e=>setError(e.message));try{setVoice(localStorage.getItem('rehearsal-voice')||'piper_lessac');}catch{}return()=>{mounted.current=false;stopPlayback();discardCapture();};},[stopPlayback,discardCapture]);
  useEffect(()=>{pauseAutomatic();stopPlayback();discardCapture();setTranscript('');listenedTo.current='';cursor.current={id:'',offset:0,prefix:''};},[session.id,stopPlayback,discardCapture,pauseAutomatic]);
  useEffect(()=>{if(session.status!=='active'){pauseAutomatic();stopPlayback();discardCapture();} },[session.status,stopPlayback,discardCapture,pauseAutomatic]);
  useEffect(()=>{if(audio.current)audio.current.volume=volume;},[volume]);
  useEffect(()=>{const stop=()=>{pendingAnswer.current=null;stopPlayback();discardCapture();};window.addEventListener('rehearsal:stop-voice',stop);return()=>window.removeEventListener('rehearsal:stop-voice',stop);},[stopPlayback,discardCapture]);

  function playNext(token:number){
    if(token!==generation.current||playing.current||!clips.current.length)return;
    const clip=clips.current.shift()!; const url=URL.createObjectURL(clip);audioURL.current=url;
    const player=new Audio(url);audio.current=player;player.volume=preferences.current.volume;playing.current=true;setSpeaking(true);
    const finish=()=>{URL.revokeObjectURL(url);if(token!==generation.current)return;audioURL.current='';audio.current=null;playing.current=false;if(clips.current.length)playNext(token);else if(!synthesizing.current&&!texts.current.length)setSpeaking(false);};
    player.onended=finish;player.onerror=()=>{pauseAutomatic();setError('Audio playback failed. Use Replay question to try again.');stopPlayback();};
    void player.play().catch(()=>{if(token===generation.current){pauseAutomatic();setError('Click Replay question to allow audio playback.');stopPlayback();}});
  }
  async function pump(token:number){
    if(synthesizing.current||token!==generation.current)return;synthesizing.current=true;setSpeaking(true);
    try{
      while(texts.current.length&&token===generation.current){
        // Keep synthesis at most two clips ahead of playback, bounding memory/work.
        if(clips.current.length>=2){await wait(60);continue;}
        const text=texts.current.shift()!;let response:Response|undefined;
        for(let retry=0;retry<20;retry++){
          response=await fetch('/api/voice/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,voice:preferences.current.voice,speed:preferences.current.speed}),signal:abort.current.signal});
          if(response.status!==409)break;await wait(150);
          if(token!==generation.current)return;
        }
        if(!response)throw new Error('Voice did not respond.');await checked(response);
        const clip=await response.blob();if(token!==generation.current)return;clips.current.push(clip);playNext(token);
      }
    }catch(e){if(token===generation.current){pauseAutomatic();setError(e instanceof Error?e.message:'Speech failed.');stopPlayback();}}
    finally{if(token===generation.current){synthesizing.current=false;if(!playing.current)setSpeaking(false);}}
  }
  function enqueue(segments:string[]){if(!segments.length)return;texts.current.push(...segments);void pump(generation.current);}
  const last=session.messages.at(-1);
  const speechReady=useRef('');if(last?.speech_complete||last?.status==='complete')speechReady.current=last?.id||'';
  useEffect(()=>{const capture=recording.current;if(capture?.automatic&&(capture.sessionId!==session.id||capture.questionId!==last?.id||capture.questionText!==last?.content||['error','interrupted'].includes(last?.status||''))){pauseAutomatic();discardCapture();setError('The question changed or was interrupted. Recording stopped; start again for the current question.');}},[last?.id,last?.content,last?.status,session.id,discardCapture,pauseAutomatic]);
  useEffect(()=>{
    if(!enabled||warming||session.status!=='active'||stage!=='idle')return;
    if(!last||last.role!=='assistant'){stopPlayback();cursor.current={id:'',offset:0,prefix:''};return;}
    if(mutedMessage.current===last.id)return;
    if(['error','interrupted'].includes(last.status)){pauseAutomatic();stopPlayback();return;}
    if(cursor.current.id!==last.id){stopPlayback();cursor.current={id:last.id,offset:0,prefix:''};}
    if(!last.content.startsWith(cursor.current.prefix)){stopPlayback();cursor.current={id:last.id,offset:0,prefix:''};}
    const next=speechSegments(last.content.slice(cursor.current.offset),last.status==='complete');
    cursor.current.offset+=next.consumed;cursor.current.prefix=last.content.slice(0,cursor.current.offset);enqueue(next.segments);
    // The queue is driven only by interview-message changes, not report previews.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[last?.id,last?.content,last?.status,enabled,warming,handsFree,session.status,stage]);

  useEffect(()=>{
    if(!handsFree||!enabled||warming||error||stage!=='idle'||speaking||transcript||pendingAnswer.current||!last||last.role!=='assistant'||(last.status!=='complete'&&speechReady.current!==last.id)||['error','interrupted'].includes(last.status)||!last.content.trim()||session.status!=='active'||listenedTo.current===last.id)return;
    const questionId=last.id;
    // Require the end-of-question marker and every queued/playing clip. Metadata
    // may still stream; never open in a gap between spoken sentences.
    const timer=setTimeout(()=>{if(!automatic.current||playing.current||synthesizing.current||clips.current.length||texts.current.length||cursor.current.id!==questionId||last.content.slice(cursor.current.offset).trim())return;listenedTo.current=questionId;void startRecording(true);},350);
    return()=>clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[handsFree,enabled,warming,error,busy,stage,speaking,transcript,last?.id,last?.status,last?.speech_complete,last?.content,session.status]);
  useEffect(()=>{
    const pending=pendingAnswer.current;if(!pending||!handsFree||busy||stage!=='idle')return;
    if(!automatic.current||session.status!=='active'||session.id!==pending.sessionId||last?.id!==pending.questionId){pendingAnswer.current=null;return;}
    pendingAnswer.current=null;setTranscript('');onAnswer(pending.text);
  },[pendingVersion,handsFree,busy,stage,session.id,session.status,last?.id,onAnswer]);

  async function stopRecording(discard=false,submitAutomatically=false){
    const current=recording.current;if(!current)return;
    const boundSessionId=current.sessionId,questionId=current.questionId;
    setStage('transcribing');clearInterval(current.timer);
    // Preserve the final short PCM block before disconnecting the worklet.
    if(!discard)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,150);current.node.port.onmessage=event=>{if(event.data instanceof Float32Array)current.chunks.push(event.data);else if(event.data?.flushed){clearTimeout(timer);resolve();}};current.node.port.postMessage('flush');});
    if(recording.current!==current)return;
    const chunks=current.chunks,rate=current.rate;discardCapture();if(discard)return;
    setStage('transcribing');setError('');const signal=micAbort.current.signal;
    try{const response=await checked(await fetch('/api/voice/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:pcmWave(chunks,rate),signal}));const result=await response.json();if(!mounted.current||signal.aborted)return;const text=typeof result.text==='string'?result.text.trim():'';setTranscript(value=>[value,text].filter(Boolean).join(' '));if(!text){pauseAutomatic();setError('No clear speech detected. Hands-free is paused; try recording again or type your answer.');}else if(submitAutomatically&&automatic.current&&currentSession().id===boundSessionId&&currentSession().status==='active'&&currentSession().messages.at(-1)?.id===questionId){pendingAnswer.current={text,sessionId:boundSessionId,questionId};setPendingVersion(value=>value+1);}}
    catch(e){if(!signal.aborted){pauseAutomatic();setError(e instanceof Error?e.message:'Transcription failed.');}}
    finally{if(mounted.current&&!signal.aborted)setStage('idle');}
  }
  stopRecordingRef.current=stopRecording;
  function currentSession(){return current.current.session;}
  async function startRecording(auto=false){
    if(stage!=='idle')return;mutedMessage.current=last?.id||'';stopPlayback();setError('');setStage('starting');pendingMic.current=true;
    const captureToken=++captureGeneration.current;
    let stream:MediaStream|null=null,context:AudioContext|null=null;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(!mounted.current||!pendingMic.current||captureToken!==captureGeneration.current){stream.getTracks().forEach(track=>track.stop());return;}
      context=new AudioContext();await context.audioWorklet.addModule('/voice-recorder.js');await context.resume();
      if(!mounted.current||!pendingMic.current||captureToken!==captureGeneration.current){stream.getTracks().forEach(track=>track.stop());await context.close();return;}
      const source=context.createMediaStreamSource(stream),node=new AudioWorkletNode(context,'rehearsal-recorder'),chunks:Float32Array[]=[];
      node.port.onmessage=event=>{if(event.data instanceof Float32Array)chunks.push(event.data);else if(event.data?.limit){pauseAutomatic();setError('90-second recording limit reached. Review and send this answer manually.');void stopRecordingRef.current();}else if(event.data?.activity){setRemainingMs(event.data.remainingMs);setHeardSpeech(event.data.heardSpeech);if(event.data.ended&&automatic.current)void stopRecordingRef.current(false,true);}};
      if(auto)node.port.postMessage({automatic:true,pauseMs});source.connect(node);node.connect(context.destination);
      const started=Date.now();setSeconds(0);
      const timer=setInterval(()=>{const elapsed=Math.floor((Date.now()-started)/1000);setSeconds(elapsed);const capture=recording.current;if(auto&&capture&&!capture.held&&Date.now()>=capture.waitForSpeechUntil&&!heardSpeechRef.current){pauseAutomatic();discardCapture();setError('No speech detected for 30 seconds. Hands-free is paused.');}},250);
      heardSpeechRef.current=false;recording.current={stream,context,node,chunks,timer,rate:context.sampleRate,automatic:auto,sessionId:currentSession().id,questionId:currentSession().messages.at(-1)?.id||'',questionText:currentSession().messages.at(-1)?.content||'',held:false,waitForSpeechUntil:Date.now()+30000};setStage('recording');
    }catch(e){stream?.getTracks().forEach(track=>track.stop());if(context)void context.close();if(mounted.current&&captureToken===captureGeneration.current){pauseAutomatic();setStage('idle');setError(e instanceof Error?`${e.message} You can still type your answer.`:'Microphone unavailable. You can still type.');}}
  }
  const heardSpeechRef=useRef(false);heardSpeechRef.current=heardSpeech;
  async function toggleHandsFree(){
    if(automatic.current){pauseAutomatic();discardCapture();return;}
    if(transcript.trim()){setError('Send or discard your current transcript before starting hands-free.');return;}
    automatic.current=true;setHandsFree(true);setEnabled(true);setError('');listenedTo.current='';mutedMessage.current='';stopPlayback();cursor.current={id:'',offset:0,prefix:''};setWarming(true);
    try{const ready=await api<Status>('/voice/warm',{method:'POST'});if(mounted.current)setStatus(ready);}catch(e){pauseAutomatic();if(mounted.current)setError(e instanceof Error?e.message:'Could not warm voice.');}finally{if(mounted.current)setWarming(false);}
  }
  async function enableVoice(){
    if(enabled){pauseAutomatic();discardCapture();setEnabled(false);stopPlayback();return;}
    setEnabled(true);setError('');setWarming(true);
    // Do not replay old conversation on enabling; Replay is explicit.
    cursor.current={id:last?.id||'',offset:last?.content.length||0,prefix:last?.content||''};
    try{setStatus(await api<Status>('/voice/warm',{method:'POST'}));}catch(e){setError(e instanceof Error?e.message:'Could not warm voice.');}finally{if(mounted.current)setWarming(false);}
  }
  function send(){if(!transcript.trim()||busy||session.status!=='active')return;stopPlayback();onAnswer(transcript.trim());setTranscript('');}
  return <section ref={container} className="voice-bar" aria-label="Local interview voice">
    <div className="voice-controls"><div className="voice-title"><Mic size={17}/><strong>Interview voice</strong><span>English · on this device</span></div><div className="voice-actions">
      <button type="button" className="button secondary small" aria-pressed={handsFree} disabled={!status?.ready||(!handsFree&&(warming||stage!=='idle'))||session.status!=='active'} onClick={()=>void toggleHandsFree()}>{handsFree?<Mic size={15}/>:<Volume2 size={15}/>} {handsFree?'Hands-free on':'Hands-free off'}</button>
      <button type="button" className={`button secondary small ${stage==='recording'?'voice-recording':''}`} disabled={stage!=='recording'&&(!status?.ready||!session.messages.some(message=>message.role==='assistant')||session.status!=='active'||stage==='starting'||stage==='transcribing')} onClick={()=>{if(stage==='recording'){pauseAutomatic();void stopRecording();}else{pauseAutomatic();void startRecording();}}}>{stage==='starting'||stage==='transcribing'?<LoaderCircle size={15} className="spin"/>:stage==='recording'?<Square size={14}/>:<Mic size={15}/>} {stage==='recording'?`${handsFree?'Stop & review':'Stop'} · ${seconds}s`:stage==='transcribing'?'Transcribing…':stage==='starting'?'Opening microphone…':'Record answer'}</button>
      <button type="button" className="button secondary small" aria-pressed={enabled} disabled={!status?.ready} onClick={()=>void enableVoice()}>{enabled?<Volume2 size={15}/>:<VolumeX size={15}/>} {enabled?'Spoken replies on':'Spoken replies off'}</button>
      {speaking&&<button type="button" className="text-button" onClick={()=>{pauseAutomatic();mutedMessage.current=last?.id||'';stopPlayback();}}><Square size={13}/>Stop audio</button>}
      <button type="button" className="text-button" disabled={!status?.ready||!last||last.role!=='assistant'||last.status!=='complete'||stage!=='idle'} onClick={()=>{stopPlayback();setError('');enqueue(speechSegments(last?.content||'',true).segments);}}><RotateCcw size={14}/>Replay question</button>
    </div></div>
    {(enabled||speaking)&&<div className="voice-options"><label>Voice<select value={voice} disabled={handsFree} onChange={e=>{setVoice(e.target.value);localStorage.setItem('rehearsal-voice',e.target.value);stopPlayback();}}>{Object.entries(status?.voices||{piper_lessac:'Lessac · quick response'}).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>Speed<select value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[0.9,1,1.1,1.2,1.3].map(value=><option key={value} value={value}>{value}×</option>)}</select></label><label>Volume<input type="range" min="0" max="1" step="0.05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label><label>Send after silence<select value={pauseMs} disabled={stage!=='idle'} onChange={e=>setPauseMs(Number(e.target.value))}>{[2000,3000,4500,6000].map(value=><option key={value} value={value}>{value/1000} seconds</option>)}</select></label><span role="status">{warming?'Warming local models…':stage==='transcribing'?'Transcribing your answer…':speaking?'Interviewer speaking…':handsFree?'Microphone follows the interviewer':'Ready for the next question'}</span></div>}
    {handsFree&&stage==='idle'&&!speaking&&!warming&&<p className="help-text">Hands-free is ready. After the question plays, speak normally; your answer transcript and current code send automatically after a {pauseMs/1000}-second pause.</p>}
    {stage==='recording'&&<div className="voice-listening" role="status"><span/>{handsFree?<>{held?'Listening · automatic send is held.':heardSpeech?`Listening · sends after ${Math.max(0,(remainingMs??pauseMs)/1000).toFixed(1)}s of silence.`:'Listening · take your time. Silence alone will not send an answer.'}<button type="button" className="button secondary small" aria-pressed={held} onClick={()=>{const next=!held;setHeld(next);const capture=recording.current;if(capture){capture.held=next;capture.waitForSpeechUntil=Date.now()+30000;capture.node.port.postMessage({hold:next});}}}>{held?'Resume pause detection':'Hold — I’m thinking'}</button></>:'Listening. Stop when you finish, then review your transcript. Maximum 90 seconds.'}</div>}
    {transcript&&<div className="voice-transcript"><label htmlFor="voice-transcript">Review your answer <span>{pendingAnswer.current?'Waiting for the current operation before automatic send.':'Correct names or technical terms before sending.'}</span></label><textarea id="voice-transcript" maxLength={12000} rows={3} value={transcript} onChange={e=>{pendingAnswer.current=null;pauseAutomatic();setTranscript(e.target.value);}} disabled={stage!=='idle'}/><div><button type="button" className="text-button" disabled={stage!=='idle'} onClick={()=>{pendingAnswer.current=null;pauseAutomatic();setTranscript('');}}>Discard transcript</button><button type="button" className="button primary small" onClick={send} disabled={busy||stage!=='idle'||session.status!=='active'}><Send size={14}/>Send answer{session.mode==='dsa'?' + current code':''}</button></div></div>}
    {!status?.ready&&<p className="help-text">{status?.message||'Checking local speech engines…'}</p>}
    {error&&<p className="inline-error" role="alert">{error}</p>}
  </section>;
}
