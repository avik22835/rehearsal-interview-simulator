'use client';

import {useEffect,useRef,useState} from 'react';
import {api,type Session} from '@/lib/api';
import {AssessmentView} from './assessment-view';

export type AttemptSummary={id:string;workspace_id:string;created_at:string;status:string;code_revision:number};
type FrozenAttempt=AttemptSummary&{content:{code:string;explanation:string;problem:{title:string;statement:string}};run:{status:string;result?:{message?:string;cases:{status:string;label?:string;error?:string}[]}}};

export default function SubmissionPanel({workspaceId,attempts,session,working,busy,preview,onSubmit,onReview,onEvidence}:{workspaceId:string;attempts:AttemptSummary[];session:Session;working:boolean;busy:boolean;preview:string;onSubmit:(explanation:string)=>void;onReview:(id:string)=>void;onEvidence:(id:string)=>void}){
 const [explanation,setExplanation]=useState(()=>{try{return localStorage.getItem('rehearsal-explanation-'+workspaceId)||'';}catch{return '';}});
 const [selected,setSelected]=useState(attempts[0]?.id||'');const [frozen,setFrozen]=useState<FrozenAttempt|null>(null);const [error,setError]=useState('');const latest=useRef(attempts[0]?.id);
 useEffect(()=>{try{localStorage.setItem('rehearsal-explanation-'+workspaceId,explanation);}catch{}},[explanation,workspaceId]);
 useEffect(()=>{if(attempts[0]?.id!==latest.current){latest.current=attempts[0]?.id;setSelected(attempts[0]?.id||'');}},[attempts]);
 useEffect(()=>{if(!selected)return;let disposed=false;setError('');setFrozen(null);void api<FrozenAttempt>(`/sessions/${session.id}/coding/attempts/${selected}`).then(value=>{if(!disposed)setFrozen(value);}).catch(e=>{if(!disposed)setError(e.message);});return()=>{disposed=true;};},[selected,session.id]);
 const review=[...session.assessments].reverse().find(a=>a.kind==='submission'&&a.evidence_scope?.attempt_ids.includes(selected));
 const locked=working||busy;const runCases=frozen?.run.result?.cases??[];
 return <div className="submission-panel">
  <h3>Submit this attempt</h3><p className="help-text">Freeze your current code, question and explanation, then run the public examples against that exact version. You can keep editing afterward.</p>
  <label className="field-label" htmlFor="submission-explanation">Your reasoning <span>optional · earlier interview answers are retained</span></label><textarea id="submission-explanation" rows={3} maxLength={12000} value={explanation} disabled={locked||session.status!=='active'} onChange={e=>setExplanation(e.target.value)} placeholder="Explain your approach, complexity and remaining uncertainties…"/>
  <button className="wb-run" disabled={locked||session.status!=='active'} onClick={()=>onSubmit(explanation)}>Submit & run examples</button>
  <p className="help-text">Expected outputs are model-prepared. Passing these examples is not a complete correctness verdict.</p>
  {working&&<p role="status" className="submission-review-preview">{preview||'Working… your current draft is retained.'}</p>}
  {attempts.length>0&&<section className="submitted-history"><label className="field-label" htmlFor="submitted-attempt">Saved submissions</label><select id="submitted-attempt" value={selected} onChange={e=>setSelected(e.target.value)}>{attempts.map((a,index)=><option key={a.id} value={a.id}>Attempt {attempts.length-index} · {a.id.slice(0,8)} · version {a.code_revision} · {a.status}</option>)}</select>
   {error&&<p className="inline-error" role="alert">{error}</p>}
   {frozen&&<><h3>{frozen.content.problem.title}</h3><p className="submission-run-state">Run {frozen.run.status}{runCases.length?` · ${runCases.filter(c=>c.status==='passed').length}/${runCases.length} public examples passed`:''}</p>{frozen.run.result?.message&&<p className="help-text">{frozen.run.result.message}</p>}
    <details><summary>Inspect frozen code and explanation</summary><pre>{frozen.content.code}</pre><p>{frozen.content.explanation||'No additional submission explanation supplied.'}</p></details>
    <button className="wb-button" disabled={locked||frozen.run.status==='running'||session.provider==='mock'} onClick={()=>onReview(selected)}>{review?.status==='error'||review?.status==='interrupted'?'Retry review':review?.status==='complete'?'Review again':'Review submitted attempt'}</button>
    {session.provider==='mock'&&<p className="help-text">Connect your model for an AI review. The saved run above is real local execution.</p>}
   </>}
   {review&&review.status!=='complete'&&<p className="help-text">{review.error||'The review is in progress. Your frozen submission is retained.'}</p>}
   {review?.content&&<AssessmentView key={review.id} scope={review.evidence_scope} value={review.content} sessionId={session.id} assessmentId={review.id} sources={review.evidence_sources} onEvidence={onEvidence} answerIds={session.messages.filter(m=>m.role==='user').map(m=>m.id)}/>}
  </section>}
 </div>;
}
