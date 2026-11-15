'use client';

import {useEffect,useRef,useState} from 'react';
import {api} from '@/lib/api';

export type Citation = { message_id: string; quote: string } | {source_id:string;quote:string};
export type EvidenceSource={id:string;kind:'code'|'run'|'explanation';label:string;submitted:boolean;attempt_id?:string;context_id?:string;text?:string;stale?:boolean};
export type AssessmentContent = {
  summary: string;
  strengths: { text: string; evidence: Citation[] }[];
  improvements: { text: string; evidence: Citation[] }[];
  dimensions: { name: string; score: number | null; reasoning: string; evidence: Citation[] }[];
  next_steps: string[];
};
export type SavedAssessment = {
  id: string; kind: 'live' | 'final' | 'submission'; message_id: string | null;
  status: 'generating' | 'complete' | 'error' | 'interrupted';
  evidence_sources?:EvidenceSource[];evidence_scope?:{scope:string;attempt_ids:string[];omitted_attempt_count:number};
  content: AssessmentContent | null; error: string | null; created_at: string;
};

export function AssessmentView({ value, onEvidence, answerIds, sources=[], sessionId, assessmentId, scope }: {
  value: AssessmentContent; onEvidence: (id: string) => void; answerIds: string[];sources?:EvidenceSource[];sessionId?:string;assessmentId?:string;scope?:SavedAssessment['evidence_scope'];
}) {
  const sourceView=useRef<HTMLElement>(null);
  const [opened,setOpened]=useState<EvidenceSource|null>(null);const [openedLine,setOpenedLine]=useState<number|null>(null);const [sourceError,setSourceError]=useState('');const [loadingSource,setLoadingSource]=useState(false);
  useEffect(()=>{if(opened)sourceView.current?.scrollIntoView({block:'nearest',behavior:'auto'});},[opened,openedLine]);
  async function openSource(id:string,quote:string){
    if(!sessionId||!assessmentId)return;setLoadingSource(true);setSourceError('');
    try{const source=await api<EvidenceSource>(`/sessions/${sessionId}/assessments/${assessmentId}/sources/${encodeURIComponent(id)}`);setOpened(source);const at=(source.text||'').indexOf(quote);setOpenedLine(source.kind==='code'&&at>=0?(source.text||'').slice(0,at).split('\n').length:null);}
    catch(e){setSourceError(e instanceof Error?e.message:'Could not load the saved evidence.');}finally{setLoadingSource(false);}
  }
  function evidence(items: Citation[]) {
    return items.map((item,index)=>{
      const source='source_id' in item?sources.find(s=>s.id===item.source_id):undefined;
      return <blockquote className="assessment-evidence" key={index}><p>“{item.quote}”</p>{'message_id' in item?<button className="text-button" onClick={()=>onEvidence(item.message_id)}>View answer {answerIds.indexOf(item.message_id)+1} in transcript →</button>:<button className="text-button" disabled={loadingSource} onClick={()=>void openSource(item.source_id,item.quote)}>{source?.label||'View captured evidence'}{source?.attempt_id?` · attempt ${source.attempt_id.slice(0,8)}`:''} →</button>}</blockquote>;
    });
  }
  return <div className="assessment-content">
    <p className="assessment-summary">{value.summary}</p>
    <p className="assessment-disclaimer">{sources.length?'Model judgments based on saved answers and the captured code/run sources below. Exact evidence quotes are checked. Public-example execution does not prove general correctness; expected values are model-prepared.':'Model feedback based on this practice transcript. Quotes are checked against saved answers; code execution is not included in this assessment.'}</p>
    {scope&&scope.omitted_attempt_count>0&&<p className="assessment-disclaimer">This review covers {scope.attempt_ids.length} submitted attempts. {scope.omitted_attempt_count} older attempts were outside this review’s context budget.</p>}
    {sourceError&&<p className="inline-error" role="alert">{sourceError}</p>}
    {opened&&<section ref={sourceView} className="captured-evidence-view" aria-label="Captured evidence"><div><h3>{opened.label}</h3><button className="text-button" onClick={()=>setOpened(null)}>Close source</button></div><p className="help-text">{opened.submitted?'Frozen submission':'Working draft snapshot'}{opened.attempt_id?` · ${opened.attempt_id}`:''}{opened.stale?' · run belongs to older code':''}{openedLine?` · quote starts at line ${openedLine}`:''}</p><pre tabIndex={0}>{opened.kind==='code'?(opened.text||'').split('\n').map((line,i)=>`${i+1}  ${line}`).join('\n'):opened.text}</pre></section>}
    {value.dimensions.length > 0 && <section><h3>Practice dimensions</h3>{value.dimensions.map(item =>
      <div className="assessment-dimension" key={item.name}>
        <div><h4>{item.name}</h4><span className="dimension-score">{item.score === null ? 'Not assessed' : `${item.score} / 5`}</span></div>
        <p>{item.reasoning}</p>{evidence(item.evidence)}
      </div>)}</section>}
    {([{ title: 'What worked', items: value.strengths }, { title: 'What to improve', items: value.improvements }]).map(group =>
      group.items.length > 0 && <section key={group.title}><h3>{group.title}</h3>{group.items.map((item, index) =>
        <div className="assessment-finding" key={index}><p>{item.text}</p>{evidence(item.evidence)}</div>)}</section>)}
    {value.next_steps.length > 0 && <section><h3>Next practice steps</h3><ol>{value.next_steps.map((step, index) => <li key={index}>{step}</li>)}</ol></section>}
  </div>;
}
