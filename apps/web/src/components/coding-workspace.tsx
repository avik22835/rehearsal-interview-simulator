'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import CodingWorkbench,{type TestCase,type Workspace,type Run} from './coding-workbench';
import type {AttemptSummary} from './submission-panel';
import {Library,Sparkles,Shuffle,Search,FolderOpen,FileText} from 'lucide-react';
import {api,streamTurn,type Session,type CodingDraft} from '@/lib/api';

type Resource={id:string;name:string;content:string;topic:string;score:number};
type ImportQuestion={name:string;content:string;topic:string};
type Detail={workspace:Workspace|null;runs:Run[];attempts:AttemptSummary[];submitted_attempt_id?:string;clarification?:string};
const sources=[
 {id:'resources',label:'Choose from my notes',description:'Browse topics and pick an uploaded question.',Icon:Library},
 {id:'generate',label:'Question or topic',description:'Name a question, describe a topic, or paste its text.',Icon:Sparkles},
 {id:'random',label:'Surprise me',description:'Let ChatGPT choose a question at your interview level.',Icon:Shuffle},
];

export default function CodingWorkspace({session,busy,onBusy,onDiscuss,onSessionUpdate,onEvidence}:{onSessionUpdate:(session:Session)=>void;onEvidence:(id:string)=>void;session:Session;busy:boolean;onBusy:(value:boolean)=>void;onDiscuss:(text:string,draft?:CodingDraft)=>void}){
 const [detail,setDetail]=useState<Detail>({workspace:null,runs:[],attempts:[]});
 const [code,setCode]=useState('');const [source,setSource]=useState('resources');const [request,setRequest]=useState(session.topic);
 const [working,setWorking]=useState(false);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [runner,setRunner]=useState('Checking Docker…');const [resources,setResources]=useState<Resource[]>([]);const [selected,setSelected]=useState<Resource|null>(null);
 const [randomTopic,setRandomTopic]=useState('');const importPanel=useRef<HTMLDetailsElement>(null);
 const [query,setQuery]=useState('');const [topic,setTopic]=useState('*');const [topics,setTopics]=useState<{topic:string;count:number}[]>([]);const [libraryLoading,setLibraryLoading]=useState(false);
 const [resourceName,setResourceName]=useState('');const [resourceText,setResourceText]=useState('');const [resourceTopic,setResourceTopic]=useState('');
 const [pendingFiles,setPendingFiles]=useState<ImportQuestion[]>([]);const [importMessage,setImportMessage]=useState('');const [paste,setPaste]=useState(false);const [newProblem,setNewProblem]=useState(false);
 const [share,setShare]=useState(false);
 const [reviewPreview,setReviewPreview]=useState('');const reviewAbort=useRef<AbortController|null>(null);const reviewing=useRef(false);const submissionKey=useRef<{signature:string;id:string}|null>(null);
 const mounted=useRef(true);const operation=useRef(false);const libraryRequest=useRef(0);const importRequest=useRef(0);const endpoint=`/sessions/${session.id}/coding`;
 const locked=working||busy||session.status!=='active';
 const load=useCallback(async()=>{const value=await api<Detail>(endpoint);if(mounted.current){setDetail(value);const saved=localStorage.getItem(`rehearsal-code-${value.workspace?.id}`);setCode(saved??value.workspace?.code??'');}},[endpoint]);
 useEffect(()=>{mounted.current=true;void load().catch(e=>setError(e.message)).finally(()=>setLoading(false));void api<{message:string}>('/coding/runner').then(v=>setRunner(v.message)).catch(e=>setRunner(e.message));return()=>{mounted.current=false;if(operation.current)void fetch(reviewing.current?`/api/sessions/${session.id}/report/cancel`:`/api${endpoint}/cancel`,{method:'POST',keepalive:true});reviewAbort.current?.abort();onBusy(false);};},[endpoint,load,onBusy]);
 useEffect(()=>{if(detail.workspace)localStorage.setItem(`rehearsal-code-${detail.workspace.id}`,code);},[code,detail.workspace?.id]);
 const browse=useCallback(async()=>{
  const id=++libraryRequest.current;setLibraryLoading(true);
  try{const params=new URLSearchParams({q:query});if(topic!=='*')params.set('topic',topic);const [items,groups]=await Promise.all([api<Resource[]>('/coding/resources?'+params),api<{topic:string;count:number}[]>('/coding/resources/topics')]);if(mounted.current&&id===libraryRequest.current){setResources(items);setTopics(groups);}}
  catch(e){if(mounted.current&&id===libraryRequest.current)setError((e as Error).message);}
  finally{if(mounted.current&&id===libraryRequest.current)setLibraryLoading(false);}
 },[query,topic]);
 useEffect(()=>{if(source!=='resources')return;const timer=setTimeout(()=>void browse(),180);return()=>clearTimeout(timer);},[source,browse]);
 async function perform(action:()=>Promise<void>){if(operation.current)return;setError('');setNotice('');setWorking(true);operation.current=true;onBusy(true);try{await action();}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Request failed. Your draft is retained.');}finally{operation.current=false;if(mounted.current){setWorking(false);onBusy(false);}}}
 async function prepare(){await perform(async()=>{const value=await api<Detail>(endpoint+'/prepare',{method:'POST',body:JSON.stringify({source:source==='generate'&&paste?'paste':source,request:source==='resources'?'':source==='random'?randomTopic:request,new_version:!!detail.workspace,resource_id:source==='resources'?selected?.id:undefined})});if(!mounted.current)return;setDetail(value);setNotice(value.clarification||'Workspace prepared. Inspect the examples before using them to judge your solution.');if(!value.clarification){setCode(value.workspace?.code??'');setNewProblem(false);}});}
 async function save(run:boolean,examples?:TestCase[]){await perform(async()=>{const w=detail.workspace;if(!w)return;const value=await api<Detail>(endpoint+(run?'/run':'/code'),{method:run?'POST':'PUT',body:JSON.stringify({workspace_id:w.id,code,expected_revision:w.revision,...(examples?{examples}:{})})});if(mounted.current){setDetail(value);setNotice(run?'':'Code version saved.');}});}
 async function submit(explanation:string){await perform(async()=>{
  const w=detail.workspace;if(!w)return;const signature=JSON.stringify([w.id,code,explanation]);
  if(submissionKey.current?.signature!==signature)submissionKey.current={signature,id:crypto.randomUUID()};
  try{const value=await api<Detail>(endpoint+'/submit',{method:'POST',body:JSON.stringify({workspace_id:w.id,expected_revision:w.revision,code,explanation,request_id:submissionKey.current.id})});if(mounted.current){setDetail(value);setNotice('Attempt saved. Review uses this frozen version, even if you keep editing.');submissionKey.current=null;}}
  catch(e){if(mounted.current){const restored=await api<Detail>(endpoint).catch(()=>null);if(restored)setDetail(restored);}throw e;}
 });}
 async function review(attemptId:string){await perform(async()=>{
  const abort=new AbortController();reviewAbort.current=abort;reviewing.current=true;setReviewPreview('Reviewing the frozen code and recorded execution…');
  try{await streamTurn(session.id,{action:'review'},abort.signal,event=>{if(!mounted.current)return;if(event.type==='preview')setReviewPreview(event.text||'Checking evidence…');if(event.type==='complete'&&event.session)onSessionUpdate(event.session);},`coding/attempts/${attemptId}/review`);}
  finally{reviewing.current=false;reviewAbort.current=null;if(mounted.current){const restored=await api<Session>('/sessions/'+session.id);onSessionUpdate(restored);setReviewPreview('');}}
 });}
 async function cancel(){const path=reviewing.current?'/sessions/'+session.id+'/report/cancel':endpoint+'/cancel';await api(path,{method:'POST'}).catch(e=>setError(e.message));reviewAbort.current?.abort();}
 async function importResource(){await perform(async()=>{await api('/coding/resources',{method:'POST',body:JSON.stringify({name:resourceName,content:resourceText,topic:resourceTopic})});setResourceText('');setNotice('Question saved locally. Select it from your library.');setQuery('');setTopic('*');await browse();if(importPanel.current)importPanel.current.open=false;});}
 async function stageFiles(files:FileList|null){
  if(!files)return;const id=++importRequest.current;setPendingFiles([]);setImportMessage('Reading files locally…');
  const all=Array.from(files),usable=all.filter(f=>/\.(txt|md)$/i.test(f.name));
  if(usable.length>100){setImportMessage('Choose up to 100 question files per import. Nothing was saved.');return;}
  try{const staged:ImportQuestion[]=[];for(const f of usable){if(f.size>80000)throw Error(`${f.name} is too large. Keep each question under 20,000 characters.`);const content=await f.text();if(content.length<10||content.length>20000)throw Error(`${f.name} must contain 10–20,000 characters. Nothing was saved.`);const parts=(f.webkitRelativePath||f.name).split('/');const folders=parts.slice(1,-1);const group=folders.length?folders.join(' / '):parts.length>1?parts[0]:resourceTopic;const name=f.name.replace(/\.(txt|md)$/i,'');if(name.length>180||group.length>180)throw Error('A question name or topic path exceeds 180 characters. Rename it before importing.');staged.push({name,content,topic:group});}
   if(id!==importRequest.current)return;setPendingFiles(staged);setImportMessage(`${staged.length} question files ready. ${all.length-usable.length} unsupported files skipped. Review the topics, then save locally.`);
  }catch(e){if(id===importRequest.current){setPendingFiles([]);setImportMessage((e as Error).message);}}
 }
 async function importFolder(){await perform(async()=>{await api('/coding/resources/import',{method:'POST',body:JSON.stringify({resources:pendingFiles})});setNotice(`${pendingFiles.length} questions saved locally. Choose one from your library.`);setPendingFiles([]);setImportMessage('Questions saved locally. Choose one below.');setQuery('');setTopic('*');await browse();if(importPanel.current)importPanel.current.open=false;});}
 const w=detail.workspace;
 if(loading)return <div className="coding-panel" role="status">Restoring your coding workspace…</div>;
 return <div className={`coding-panel ${w&&!newProblem?'has-workbench':'is-preparing'}`}>
  {(!w||newProblem)&&<div className="coding-heading"><div><span className="eyebrow">YOUR NEXT CHALLENGE</span><h2>Choose what you want to solve.</h2></div><span className="coding-runner">{runner}</span></div>}
  {error&&<p className="inline-error" role="alert">{error}</p>}{notice&&<p className="coding-notice" role="status">{notice}</p>}
  {(!w||newProblem)&&<section className="problem-preparation">
   <fieldset className="problem-source-picker"><legend>Where should the question come from?</legend><div>{sources.map(({id,label,description,Icon})=><label className={source===id?'selected':''} key={id}><input type="radio" name="problem-source" value={id} checked={source===id} disabled={locked} onChange={()=>{setSource(id);setShare(false);}}/><Icon size={20}/><span><strong>{label}</strong><small>{description}</small></span></label>)}</div></fieldset>
   {source==='resources'&&<div className="coding-library">
    <div className="question-library-heading"><div><h3>Your question library</h3><p>One file per question. Keep your topic folders and choose the exact question to practise.</p></div><FolderOpen size={22}/></div>
    <div className="question-library-filters"><label>Topic<select aria-label="Filter questions by topic" value={topic} onChange={e=>{++libraryRequest.current;setLibraryLoading(true);setResources([]);setTopic(e.target.value);setSelected(null);setShare(false);}}><option value="*">All topics</option>{topics.map(t=><option key={t.topic} value={t.topic}>{t.topic||'Unsorted'} ({t.count})</option>)}</select></label><label>Keyword search<div className="question-search"><Search size={15}/><input aria-label="Search resource text" placeholder="Question name, topic, or words in your notes…" value={query} onChange={e=>{++libraryRequest.current;setLibraryLoading(true);setResources([]);setQuery(e.target.value);setSelected(null);setShare(false);}}/></div></label></div>
    <div className="resource-list" aria-label="Question list" aria-busy={libraryLoading}>{resources.map(r=><button key={r.id} disabled={locked} aria-pressed={selected?.id===r.id} className={selected?.id===r.id?'selected':''} onClick={()=>{setSelected(r);setShare(false);}}><span>{r.name}</span><small>{r.topic||'Unsorted'} · {r.content.length.toLocaleString()} characters</small></button>)}</div>
    {!resources.length&&!libraryLoading&&<div className="question-library-empty"><FileText size={24}/><p>{query||topic!=='*'?'No questions match these filters.':'Your library is ready for your notes.'}</p><small>Import Markdown or text files below. Your notes stay local until you prepare a selected question.</small></div>}
    {selected&&<details open className="selected-question-preview"><summary>Selected question · {selected.name} · {selected.topic||'Unsorted'}</summary><pre className="source-preview">{selected.content}</pre></details>}
    <details className="question-import" ref={importPanel}><summary>Upload question files or a topic folder</summary><p className="help-text">Example: Interview notes / Arrays / Two Sum.md becomes topic “Arrays”, question “Two Sum”. Import your notes root folder to retain its topic subfolders. One file is one question.</p><label className="field-label" htmlFor="resource-topic">Topic for individual files or questions</label><input id="resource-topic" placeholder="e.g. Arrays" value={resourceTopic} maxLength={180} onChange={e=>setResourceTopic(e.target.value)}/><div className="question-upload-inputs"><label>Choose files<input aria-label="Upload question files" type="file" accept=".txt,.md" multiple disabled={locked} onChange={e=>void stageFiles(e.target.files)}/></label><label>Choose notes folder<input aria-label="Upload topic folder" type="file" multiple disabled={locked} ref={node=>{node?.setAttribute('webkitdirectory','');}} onChange={e=>void stageFiles(e.target.files)}/></label></div>{importMessage&&<p className="help-text" role="status">{importMessage}</p>}{pendingFiles.length>0&&<><ul className="question-import-preview">{pendingFiles.map((f,i)=><li key={i}><strong>{f.name}</strong><span>{f.topic||'Unsorted'}</span></li>)}</ul><button className="button secondary small" disabled={locked} onClick={()=>void importFolder()}>Save {pendingFiles.length} questions locally</button></>}<details><summary>Or add a question manually</summary><label className="field-label" htmlFor="resource-name">Question name</label><input id="resource-name" value={resourceName} onChange={e=>setResourceName(e.target.value)} maxLength={180}/><label className="field-label" htmlFor="resource-content">Complete problem text</label><textarea id="resource-content" value={resourceText} onChange={e=>setResourceText(e.target.value)} rows={6} maxLength={20000}/><button className="button secondary small" disabled={locked||!resourceName.trim()||resourceText.length<10} onClick={()=>void importResource()}>Save locally</button></details></details>
   </div>}
   {source==='generate'&&<label className="checkbox-line"><input type="checkbox" checked={paste} onChange={e=>{setPaste(e.target.checked);setShare(false);}}/><span>I have the complete question text—preserve it exactly.</span></label>}
   {source!=='resources'&&<><label className="field-label" htmlFor="problem-request">{source==='random'?'Topic preference (optional)':paste?'Complete question, examples and constraints':'Question name, topic or description'}</label><textarea id="problem-request" rows={source==='random'?2:5} maxLength={20000} value={source==='random'?randomTopic:request} disabled={locked} onChange={e=>{if(source==='random')setRandomTopic(e.target.value);else setRequest(e.target.value);setShare(false);}} placeholder={source==='random'?'Leave blank for a surprise, or narrow it to graphs, arrays…':paste?'Paste the original question here.':'e.g. Two Sum, sliding windows, or a medium graph traversal problem…'}/></>}
   {source==='resources'&&selected&&<p className="question-preparation-note">ChatGPT will prepare the starter template and public tests for <strong>{selected.name}</strong>. Your selected question is preserved.</p>}
   {source==='random'&&<p className="help-text">ChatGPT chooses the question at {session.level} level. This does not select a random uploaded file.</p>}
   <label className="checkbox-line"><input type="checkbox" checked={share} disabled={locked} onChange={e=>setShare(e.target.checked)}/><span>{source==='resources'?'Send only the selected question to my configured model to prepare its workspace.':'Send this request to my configured model to prepare the workspace.'}</span></label>
   <div className="coding-actions"><button className="button primary" disabled={locked||!share||(source==='generate'&&request.trim().length<2)||(source==='resources'&&!selected)||session.provider==='mock'} onClick={()=>void prepare()}>Prepare workspace</button>{w&&<button className="button secondary" disabled={working} onClick={()=>setNewProblem(false)}>Keep current problem</button>}</div>
   {session.provider==='mock'&&<p className="help-text">Connect your model to prepare arbitrary problems. The offline demo does not generate workspace content.</p>}
  </section>}
  {w&&!newProblem&&<CodingWorkbench key={w.id} workspace={w} code={code} onCode={setCode} runs={detail.runs} attempts={detail.attempts??[]} reviewPreview={reviewPreview} onSubmit={explanation=>void submit(explanation)} onReview={id=>void review(id)} onEvidence={onEvidence} session={session} busy={busy} working={working} runner={runner} onSave={()=>void save(false)} onRun={examples=>void save(true,examples)} onDiscuss={text=>onDiscuss(text,{workspace_id:w.id,expected_revision:w.revision,code})} onChoose={()=>setNewProblem(true)} onCancel={()=>void cancel()}/>}
  {working&&(!w||newProblem)&&<div className="coding-actions" role="status"><span>Working… your current code is retained.</span><button className="button secondary small" onClick={()=>void api(endpoint+'/cancel',{method:'POST'}).catch(e=>setError(e.message))}>Cancel operation</button></div>}
 </div>;
}
