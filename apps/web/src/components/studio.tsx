'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, ArrowUp, ArrowLeft, Check, CheckCircle2, ChevronRight, CircleHelp, Clock3, Code2, Download, History, House, Layers3, LoaderCircle, Menu, MessagesSquare, Pause, Play, Plus, RotateCcw, Search, Server, Settings2, ShieldCheck, Sparkles, Square, Trash2, Workflow, X, AlertCircle, BookOpen, ListChecks } from 'lucide-react';
import { AssessmentView } from './assessment-view';
import CodingWorkspace from './coding-workspace';
import ThemeToggle from './theme-toggle';
import VoiceBar from './voice-bar';
import { api, streamTurn, type Mode, type Session, type Settings, type ProviderCheck, type CodingDraft } from '@/lib/api';

const icons = { code: Code2, layers: Layers3, workflow: Workflow, server: Server, sparkles: Sparkles, message: MessagesSquare };
const providerNames: Record<string,string> = { mock: 'Practice demo', gateway: 'ChatGPT gateway', compatible: 'Compatible endpoint' };
const phaseNames: Record<string,string> = { introduction: 'Introduction', clarification: 'Clarify the problem', answer: 'Your reasoning', follow_up: 'Follow-up', evaluation: 'Review', report: 'Session recap' };
const nextTools: Record<string,string> = { dsa: 'Editor and Python tests', project: 'Repository evidence', design: 'Architecture canvas', backend: 'Your engineering notes', ai: 'Your topic collections', behavioral: 'Resume and story bank' };
function date(value: string) { return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
function time(value: string) { return new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }
function errorText(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
function ModeIcon({ mode, size = 20 }: { mode?: Mode; size?: number }) { const Icon = icons[(mode?.icon || 'message') as keyof typeof icons]; return <Icon size={size} strokeWidth={1.65} />; }

export default function Studio() {
  const [view, setView] = useState<'practice' | 'history' | 'settings' | 'session' | 'library'>('practice');
  const [modes, setModes] = useState<Mode[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [check, setCheck] = useState<ProviderCheck | null>(null);
  const [selected, setSelected] = useState('dsa');
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reportPreview, setReportPreview] = useState('');
  const [assessmentRunning, setAssessmentRunning] = useState(false);
  const [error, setError] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [today, setToday] = useState('');
  const controller = useRef<AbortController | null>(null);
  const currentId = useRef<string | null>(null);

  const refreshSessions = useCallback(async () => { setSessions(await api<Session[]>('/sessions')); }, []);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [allModes, allSessions, provider] = await Promise.all([api<Mode[]>('/modes'), api<Session[]>('/sessions'), api<Settings>('/settings')]);
      setModes(allModes); setSessions(allSessions); setSettings(provider);
      setCheck(await api<ProviderCheck>('/settings/check', { method: 'POST' }));
    } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); setToday(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })); }, [load]);
  const remoteGeneration = !!session && (session.messages.some(item => item.status === 'generating') || session.assessments?.some(item => item.status === 'generating'));
  useEffect(() => {
    if (!session || busy || !remoteGeneration) return;
    let disposed = false;
    const id = session.id;
    const timer = setInterval(() => {
      void api<Session>(`/sessions/${id}`).then(value => {
        if (!disposed && currentId.current === id) setSession(value);
      }).catch(e => { if (!disposed) setError(errorText(e)); });
    }, 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [session?.id, busy, remoteGeneration]);
  function navigate(next: typeof view) { setView(next); setMobileNav(false); setError(''); }

  async function openSession(id: string) {
    if (busy && currentId.current !== id) { setError('Pause or finish the current response before opening another session.'); return; }
    try { const result = await api<Session>(`/sessions/${id}`); currentId.current = id; setSession(result); navigate('session'); }
    catch (e) { setError(errorText(e)); }
  }

  async function runTurn(target: Session, action: 'start' | 'answer' | 'retry', content = '', draft?:CodingDraft) {
    if (controller.current && !controller.current.signal.aborted) return;
    window.dispatchEvent(new Event('rehearsal:stop-voice'));
    setBusy(true); setError('');
    const abort = new AbortController(); controller.current = abort;
    if (action === 'answer') setSession(previous => previous ? { ...previous, messages: [...previous.messages, { id: 'local-user', role: 'user', content, status: 'complete', created_at: new Date().toISOString() }] } : previous);
    try {
      let codingContext=draft;
      if(target.mode==='dsa'&&!codingContext){
        const detail=await api<{workspace:{id:string;revision:number;code:string}|null}>(`/sessions/${target.id}/coding`);
        if(detail.workspace){const w=detail.workspace;codingContext={workspace_id:w.id,expected_revision:w.revision,code:localStorage.getItem(`rehearsal-code-${w.id}`)??w.code};}
      }
      await streamTurn(target.id, { action, content, coding_context:codingContext }, abort.signal, event => {
        if (currentId.current !== target.id) return;
        if (event.type === 'started') setSession(previous => previous ? { ...previous, messages: [...previous.messages, { id: event.message_id!, role: 'assistant', content: '', status: 'generating', created_at: new Date().toISOString() }] } : previous);
        if (event.type === 'speech_complete') setSession(previous=>{if(!previous)return previous;const messages=[...previous.messages];const last=messages.at(-1);if(last?.role==='assistant')messages[messages.length-1]={...last,speech_complete:true};return {...previous,messages};});
        if (event.type === 'delta' || event.type === 'replace') setSession(previous => {
          if (!previous) return previous;
          const messages = [...previous.messages];
          const last = messages[messages.length-1];
          if (last?.role === 'assistant') messages[messages.length-1] = { ...last, content: event.type === 'replace' ? event.text! : last.content + event.text };
          return { ...previous, messages };
        });
        if (event.type === 'complete') setSession(event.session!);
      });
    } catch (e) { if (!abort.signal.aborted) setError(errorText(e)); }
    finally {
      if (controller.current === abort) { setBusy(false); controller.current = null; }
      try {
        if (currentId.current === target.id) { const saved = await api<Session>(`/sessions/${target.id}`); if (currentId.current === target.id) setSession(saved); }
        await refreshSessions();
      } catch (e) { setError(errorText(e)); }
    }
  }

  async function runReport(target: Session, endpoint: 'report' | 'feedback' = 'report') {
    if (busy && controller.current && !controller.current.signal.aborted) return;
    setBusy(true); setAssessmentRunning(true); setError(''); setReportPreview('');
    const abort = new AbortController(); controller.current = abort;
    try {
      await streamTurn(target.id, {action:'report'}, abort.signal, event => {
        if (currentId.current !== target.id) return;
        if (event.type === 'preview') setReportPreview(event.text || '');
        if (event.type === 'complete') setSession(event.session!);
      }, endpoint);
    } catch (e) { if (!abort.signal.aborted) setError(errorText(e)); }
    finally {
      if (controller.current === abort) { setBusy(false); setAssessmentRunning(false); controller.current = null; }
      try { if (currentId.current === target.id) { const saved = await api<Session>(`/sessions/${target.id}`); if (currentId.current === target.id) setSession(saved); } await refreshSessions(); }
      catch (e) { setError(errorText(e)); }
    }
  }

  async function cancelReport() {
    if (!session) return;
    controller.current?.abort();
    try { setSession(await api<Session>(`/sessions/${session.id}/report/cancel`, {method:'POST'})); }
    catch(e) { setError(errorText(e)); }
  }

  async function start(values: { topic: string; level: string; duration: number; provider: string; remote_consent: boolean }) {
    setCreating(true); setError('');
    try {
      // Starting another interview takes priority over this page's active turn.
      // Save and pause it; each new session below gets a fresh, independent ID.
      if (controller.current && !controller.current.signal.aborted && session) {
        controller.current.abort();
        if (session.status !== 'ended') await api(`/sessions/${session.id}/control`, {method:'POST',body:JSON.stringify({action:'pause'})});
        else await api(`/sessions/${session.id}/report/cancel`, {method:'POST'});
      }
      const result = await api<Session>('/sessions', { method: 'POST', body: JSON.stringify({ ...values, mode: selected }) });
      currentId.current = result.id; setSession(result); navigate('session'); await refreshSessions();
      if (result.mode !== 'dsa') void runTurn(result, 'start');
    } catch (e) { setError(errorText(e)); } finally { setCreating(false); }
  }

  async function control(action: 'pause' | 'resume' | 'end') {
    if (!session) return;
    if (action !== 'resume') controller.current?.abort();
    try {
      const result = await api<Session>(`/sessions/${session.id}/control`, { method: 'POST', body: JSON.stringify({ action }) });
      setSession(result); await refreshSessions();
      if (action === 'end') void runReport(result);
    } catch (e) { setError(errorText(e)); }
  }

  async function removeSession(target: Session) {
    if (!window.confirm(`Delete “${target.title}” and its transcript? This cannot be undone.`)) return;
    try {
      await api(`/sessions/${target.id}`, { method: 'DELETE' });
      if (session?.id === target.id) { setSession(null); currentId.current = null; navigate('history'); }
      await refreshSessions();
    } catch (e) { setError(errorText(e)); }
  }

  const activeMode = modes.find(mode => mode.id === selected);
  const sessionMode = modes.find(mode => mode.id === session?.mode);
  const completed = sessions.filter(item => item.status === 'ended').length;

  return <div className={`app-shell ${view === 'session' && session?.mode === 'dsa' ? 'coding-session' : ''}`}>
    <a href="#main-content" className="skip-link">Skip to content</a>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside id="workspace-navigation" className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
      <button className="brand" onClick={() => navigate('practice')} aria-label="Rehearsal home"><span className="brand-mark"><span/><span/><span/></span><span>rehearsal<span className="brand-caption">INTERVIEW STUDIO</span></span></button>
      <div className="sidebar-label">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation">
        <button className={`nav-item ${view === 'practice' ? 'active' : ''}`} onClick={() => navigate('practice')}><House size={18}/>Practice<span className="nav-key">P</span></button>
        <button className={`nav-item ${view === 'history' ? 'active' : ''}`} onClick={() => navigate('history')}><History size={18}/>Session history{sessions.length > 0 && <span className="nav-count">{sessions.length}</span>}</button>
        <button className={`nav-item ${view === 'library' ? 'active' : ''}`} onClick={() => navigate('library')}><BookOpen size={18}/>Context library<span className="soon-dot"/></button>
      </nav>
      {session && session.status !== 'ended' && <div className="ongoing"><div className="sidebar-label">PICK UP WHERE YOU LEFT OFF</div><button onClick={() => void openSession(session.id)}><span className={`status-dot ${busy ? 'pulsing' : ''}`}/><span>{session.title}<small>{busy ? 'Interviewer responding' : session.status === 'paused' ? 'Paused session' : 'Session in progress'}</small></span><ChevronRight size={15}/></button></div>}
      <div className="sidebar-bottom">
        <div className="local-note"><ShieldCheck size={17}/><div>Your practice, your space.<small>History stays on this device.</small></div></div>
        <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18}/>Settings</button>
        <div className="profile"><div className="avatar">Y</div><span>Your workspace<small>Personal edition</small></span><span className="version">v0.1</span></div>
      </div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={mobileNav} aria-controls="workspace-navigation" onClick={() => setMobileNav(true)}><Menu size={20}/></button><span>Workspace</span><ChevronRight size={13}/><strong>{view === 'practice' ? 'Practice' : view === 'history' ? 'Session history' : view === 'settings' ? 'Settings' : view === 'library' ? 'Context library' : sessionMode?.short || 'Interview'}</strong></div>
        <div className="topbar-actions"><ThemeToggle/><button className="provider-indicator" onClick={() => navigate('settings')}><span className={`status-dot ${check?.connected ? '' : 'neutral'}`}/>{settings ? providerNames[settings.kind] : 'Connecting'}<ChevronRight size={13}/></button></div>
      </header>
      <main id="main-content" className={`main-content ${view === 'session' ? 'interview-main' : ''}`}>
        {error && <div className="error-banner" role="alert"><AlertCircle size={18}/><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
        {loading ? <div className="page-loading" aria-label="Loading workspace"><div className="skeleton heading"/><div className="skeleton subheading"/><div className="skeleton large"/></div> : !settings || !modes.length ? <div className="empty-state"><Server size={32}/><h1>Let’s reconnect your workspace.</h1><p>Start the local API, then try again. Your saved sessions stay on this device.</p><button className="button primary" onClick={() => void load()}><RotateCcw size={16}/>Try again</button></div> : <>
        {view === 'practice' && <>
          <div className="welcome"><div><div className="eyebrow"><span className="tiny-spark">✳</span> A LITTLE PRACTICE, EVERY DAY</div><h1>Get a little sharper.<br/><em>One conversation at a time.</em></h1><p>Make room to think, explain, and get better.<br className="desktop-break"/> Your next interview starts with a good question.</p></div><div className="welcome-note"><span className="hand-drawn"><MessagesSquare size={31} strokeWidth={1.2}/></span><p>Progress comes from<br/>showing your thinking.</p><span>{today}</span></div></div>
          <div className="practice-layout"><section className="mode-selection" aria-labelledby="choose-mode"><div className="section-heading"><h2 id="choose-mode">What are we practising?</h2><span>6 ways to grow</span></div><div className="mode-list">{modes.map(mode => <button key={mode.id} className={`mode-row ${selected === mode.id ? 'selected' : ''}`} onClick={() => setSelected(mode.id)} aria-pressed={selected === mode.id}><span className="mode-number">{mode.number}</span><span className="mode-icon"><ModeIcon mode={mode}/></span><span className="mode-copy"><strong>{mode.name}</strong><small>{mode.description}</small></span><span className="mode-choice">{selected === mode.id ? <Check size={15}/> : <ArrowUpRight size={16}/>}</span></button>)}</div></section>
          <SetupPanel mode={activeMode!} settings={settings} start={start} disabled={creating || busy} navigateSettings={() => navigate('settings')}/></div>
          <section className="recent-section"><div className="section-heading"><h2>Your recent practice</h2>{sessions.length > 0 && <button className="text-button" onClick={() => navigate('history')}>View all sessions <ArrowUpRight size={14}/></button>}</div>{sessions.length ? <div className="recent-list">{sessions.slice(0,3).map(item => <SessionRow key={item.id} session={item} mode={modes.find(m => m.id === item.mode)} onOpen={() => void openSession(item.id)}/>)}</div> : <div className="history-empty"><span className="empty-line-icon"><History size={23} strokeWidth={1.4}/></span><div><strong>Your first session starts a story.</strong><p>Choose a mode above. We’ll save the conversation so you can come back to it.</p></div><span className="empty-decoration">01 →</span></div>}</section>
          <div className="home-footer"><span><ShieldCheck size={14}/> Saved locally. Shared with a model only when you choose.</span><span>{completed > 0 ? `${completed} completed ${completed === 1 ? 'session' : 'sessions'}` : 'Small steps. Clearer thinking.'}</span></div>
        </>}
        {view === 'history' && <HistoryPage sessions={sessions} modes={modes} open={openSession} remove={removeSession} create={() => navigate('practice')}/>}
        {view === 'settings' && <SettingsPage settings={settings} check={check} onSave={async value => { setSettings(value); setCheck(null); }} onCheck={setCheck}/>}
        {view === 'library' && <div className="library-page"><div className="eyebrow">YOUR CONTEXT, WITH INTENTION</div><h1>A place for what you know.</h1><p className="page-intro">Your repositories, notes, resume, and sources will live here. You’ll choose exactly what each interview can use.</p><div className="library-preview"><BookOpen size={34} strokeWidth={1.2}/><div><h2>Source imports are in development.</h2><p>For now, add a topic or paste a problem when you start a session. This build uses the conversation and that text only.</p><button className="button secondary" onClick={() => navigate('practice')}>Start with a topic <ArrowUpRight size={16}/></button></div></div><div className="library-principles"><div><ShieldCheck size={20}/><h3>Selected by you</h3><p>No folders are scanned automatically.</p></div><div><ListChecks size={20}/><h3>Evidence you can inspect</h3><p>Source citations will make the interviewer’s context visible.</p></div></div></div>}
        {view === 'session' && session && sessionMode && <Interview assessmentRunning={assessmentRunning || !!session.assessments?.some(item=>item.status==='generating')} onFeedback={() => void runReport(session!,'feedback')} reportPreview={reportPreview} onReport={() => void runReport(session!)} onCancelReport={() => void cancelReport()} onSessionUpdate={updated=>{if(currentId.current===updated.id)setSession(updated);}} session={session} mode={sessionMode} busy={busy || remoteGeneration} onAnswer={(value,draft) => void runTurn(session,'answer',value,draft)} onRetry={() => void runTurn(session,'retry')} onBegin={draft => void runTurn(session,'start','',draft)} onControl={control} onBack={() => navigate('practice')}/>}
        </>}
      </main>
    </div>
  </div>;
}

function SetupPanel({ mode, settings, start, disabled, navigateSettings }: { mode: Mode; settings: Settings; start: (value: {topic:string;level:string;duration:number;provider:string;remote_consent:boolean}) => void; disabled: boolean; navigateSettings: () => void }) {
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState('Junior');
  const [duration, setDuration] = useState(25);
  const [useMock, setUseMock] = useState(settings.kind === 'mock');
  const [consent, setConsent] = useState(false);
  useEffect(() => { setUseMock(settings.kind === 'mock'); setConsent(false); }, [settings.kind]);
  const provider = useMock ? 'mock' : settings.kind;
  const placeholders: Record<string,string> = { dsa: 'e.g. Sliding windows, or paste a problem…', project: 'e.g. The architecture of my research agent…', design: 'e.g. Design a notification service…', backend: 'e.g. Transactions, idempotency, or API design…', ai: 'e.g. RAG evaluation and retrieval failures…', behavioral: 'e.g. A difficult decision on a team project…' };
  function submit(event: FormEvent) { event.preventDefault(); start({ topic, level, duration, provider, remote_consent: consent }); }
  return <section className="setup-panel" aria-labelledby="session-setup"><div className="setup-top"><span className="eyebrow">YOUR NEXT SESSION</span><span className="conversation-badge">Typed practice</span></div><div className="selected-mode-title"><ModeIcon mode={mode} size={24}/><h2 id="session-setup">{mode.name}</h2></div><p className="setup-tagline">{mode.category}</p><form onSubmit={submit}><label className="field-label" htmlFor="topic">A topic to explore <span>optional</span></label><textarea id="topic" maxLength={12000} value={topic} onChange={event => setTopic(event.target.value)} placeholder={placeholders[mode.id]} rows={3}/><div className="form-pair"><div><label className="field-label" htmlFor="level">Interview level</label><select id="level" value={level} onChange={event => setLevel(event.target.value)}>{['Intern','Junior','Mid-level','Senior'].map(value => <option key={value}>{value}</option>)}</select></div><div><label className="field-label" htmlFor="duration">Time to focus</label><select id="duration" value={duration} onChange={event => setDuration(Number(event.target.value))}>{[15,25,45,60].map(value => <option key={value} value={value}>{value} minutes</option>)}</select></div></div>
    <div className="provider-choice"><div><span className="field-label">Interviewer</span><button className="text-button" type="button" onClick={navigateSettings}>Configure <Settings2 size={13}/></button></div>{settings.kind !== 'mock' ? <div className="segmented"><button type="button" className={!useMock ? 'selected' : ''} onClick={() => {setUseMock(false);setConsent(false);}}>Your model</button><button type="button" className={useMock ? 'selected' : ''} onClick={() => setUseMock(true)}>Practice demo</button></div> : <div className="mock-option"><span className="status-dot"/>Practice demo<span>Ready offline</span></div>}<p className="help-text">{provider === 'mock' ? 'Deterministic sample questions. Try the flow without a model connection.' : 'Uses your saved endpoint and model. Your browser must stay connected for ChatGPT.'}</p></div>
    {provider !== 'mock' && <label className="consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/><span>Allow this topic, conversation and selected coding workspace to be sent to my configured model.</span></label>}
    <button className="button primary start-button" type="submit" disabled={disabled || (provider !== 'mock' && !consent)}>{disabled ? <><LoaderCircle size={17} className="spin"/>Starting session…</> : <>Begin practice <ArrowUpRight size={18}/></>}</button><p className="setup-footnote"><Clock3 size={13}/>A time target, not a countdown. Go at your own pace.</p></form><div className="foundation-note"><CircleHelp size={15}/><span>Conversation practice is ready. {nextTools[mode.id]} will be added as the workspace grows.</span></div></section>;
}

function SessionRow({ session, mode, onOpen }: {session:Session;mode?:Mode;onOpen:()=>void}) {
  return <button className="session-row" onClick={onOpen}><span className="session-mode-icon"><ModeIcon mode={mode}/></span><span className="session-row-copy"><strong>{session.title}</strong><small>{mode?.short} <span>·</span> {session.level} <span>·</span> {providerNames[session.provider]}</small></span><span className={`status-label ${session.status}`}>{session.status === 'ended' ? 'Completed' : session.status === 'paused' ? 'Paused' : 'In progress'}</span><time>{date(session.updated_at)}</time><ChevronRight size={16}/></button>;
}

function HistoryPage({ sessions, modes, open, remove, create }: {sessions:Session[];modes:Mode[];open:(id:string)=>void;remove:(session:Session)=>void;create:()=>void}) {
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all');
  const visible = sessions.filter(item => (filter === 'all' || item.status === filter) && `${item.title} ${item.mode} ${item.level}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="history-page"><div className="page-heading"><div><div className="eyebrow">A RECORD OF YOUR THINKING</div><h1>Every session leaves something.</h1><p className="page-intro">Return to an unfinished conversation, or look back at how you approached a question.</p></div><button className="button primary" onClick={create}><Plus size={16}/>New session</button></div><div className="history-toolbar"><label className="search-input"><Search size={17}/><input aria-label="Search sessions" placeholder="Find a session…" value={query} onChange={e => setQuery(e.target.value)}/></label><select aria-label="Filter session status" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All sessions</option><option value="active">In progress</option><option value="paused">Paused</option><option value="ended">Completed</option></select></div><div className="section-heading"><span>{visible.length} {visible.length === 1 ? 'session' : 'sessions'}</span><span>Saved on this device</span></div>{visible.length ? <div className="history-table">{visible.map(item => <div className="history-table-row" key={item.id}><SessionRow session={item} mode={modes.find(m => m.id === item.mode)} onOpen={() => open(item.id)}/><a className="icon-button" aria-label={`Export ${item.title}`} href={`/api/sessions/${item.id}/export`} download><Download size={16}/></a><button className="icon-button destructive" aria-label={`Delete ${item.title}`} onClick={() => remove(item)}><Trash2 size={16}/></button></div>)}</div> : <div className="empty-state compact"><History size={30}/><h2>{query || filter !== 'all' ? 'No sessions match this view.' : 'A fresh page for your practice.'}</h2><p>{query || filter !== 'all' ? 'Try a different search or filter.' : 'Start a conversation and your transcript will appear here.'}</p></div>}</div>;
}

function SettingsPage({ settings, check, onSave, onCheck }: { settings:Settings;check:ProviderCheck|null;onSave:(settings:Settings)=>void;onCheck:(check:ProviderCheck)=>void }) {
  const [form, setForm] = useState(settings); const [key, setKey] = useState(''); const [clearKey, setClearKey] = useState(false); const [saving, setSaving] = useState(false); const [testing, setTesting] = useState(false); const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  async function save(event: FormEvent) { event.preventDefault(); setSaving(true); setNotice(''); setError(''); try { const result = await api<Settings>('/settings', {method:'PUT',body:JSON.stringify({...form,api_key:key || null,clear_key:clearKey})}); onSave(result);setForm(result);setKey('');setClearKey(false);setNotice('Provider settings saved.'); } catch(e){setError(errorText(e));}finally{setSaving(false);} }
  async function test() { setTesting(true);setError('');try { onCheck(await api<ProviderCheck>('/settings/check',{method:'POST'})); }catch(e){setError(errorText(e));}finally{setTesting(false);} }
  return <div className="settings-page"><div className="eyebrow">MAKE THE WORKSPACE YOURS</div><h1>A connection that works for you.</h1><p className="page-intro">Use your ChatGPT gateway, another compatible endpoint, or explore the interview flow offline.</p><div className="settings-layout"><form className="settings-form" onSubmit={save}><h2>Model connection</h2><label className="field-label" htmlFor="provider-kind">Provider</label><select id="provider-kind" value={form.kind} onChange={e => setForm({...form,kind:e.target.value as Settings['kind']})}><option value="mock">Practice demo (offline)</option><option value="gateway">ChatGPT browser gateway</option><option value="compatible">OpenAI-compatible endpoint</option></select><p className="help-text">{form.kind === 'mock' ? 'Sample questions follow a deterministic pattern. No model assessment is performed.' : form.kind === 'gateway' ? 'Uses the ChatGPT tab you sign in to yourself. Keep the gateway and extension running.' : 'Connect to your own hosted or local chat-completions endpoint.'}</p>{form.kind !== 'mock' && <><label className="field-label" htmlFor="base-url">Base URL</label><input id="base-url" required type="url" value={form.base_url} onChange={e => setForm({...form,base_url:e.target.value})}/><div className="form-pair"><div><label className="field-label" htmlFor="model">Model identifier</label><input id="model" required value={form.model} onChange={e => setForm({...form,model:e.target.value})}/></div><div><label className="field-label" htmlFor="timeout">Timeout (seconds)</label><input id="timeout" type="number" min={10} max={1200} required value={form.timeout} onChange={e => setForm({...form,timeout:Number(e.target.value)})}/></div></div><label className="field-label" htmlFor="credential">API credential <span>optional</span></label><input id="credential" type="password" autoComplete="off" value={key} placeholder={form.has_key ? 'A protected credential is saved. Leave blank to keep it.' : 'Not required for the browser gateway'} onChange={e => setKey(e.target.value)}/><p className="help-text">Saved credentials are encrypted for your Windows user. Existing credentials are never returned to this page.</p>{form.has_key && <label className="checkbox-line"><input type="checkbox" checked={clearKey} onChange={e => setClearKey(e.target.checked)}/>Remove saved credential</label>}<label className="checkbox-line streaming-setting"><input type="checkbox" checked={form.stream} onChange={e => setForm({...form,stream:e.target.checked})}/><span>Stream interviewer responses<small>Turn off for endpoints that return complete responses only.</small></span></label></>}<div className="settings-actions"><button className="button primary" disabled={saving}>{saving ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>}Save settings</button><button type="button" className="button secondary" disabled={testing || saving} onClick={() => void test()}>{testing ? <LoaderCircle size={16} className="spin"/> : <Server size={16}/>}Check saved connection</button></div>{notice && <p className="success-message" role="status"><CheckCircle2 size={16}/>{notice}</p>}{error && <p className="inline-error" role="alert">{error}</p>}</form><aside className="connection-panel"><span className="eyebrow">CONNECTION CHECK</span><div className={`connection-symbol ${check?.connected ? 'connected' : ''}`}>{check?.connected ? <CheckCircle2 size={28} strokeWidth={1.4}/> : <Server size={28} strokeWidth={1.4}/>}</div><h2>{check ? check.connected ? 'Ready to connect.' : 'Needs a little attention.' : 'Save, then check.'}</h2><p>{check?.message || 'The check tests your saved configuration without sending an interview prompt.'}</p>{check && <dl className="capabilities">{Object.entries(check.capabilities).map(([name,value]) => <div key={name}><dt>{name.replace('_',' ')}</dt><dd>{value.replaceAll('_',' ')}</dd></div>)}</dl>}<div className="privacy-note"><ShieldCheck size={17}/><p>History stays local. Model requests send only the topic and conversation you authorize. File imports are not enabled in this build.</p></div></aside></div></div>;
}

function Interview({ assessmentRunning, session, mode, busy: conversationBusy, onAnswer, onRetry, onBegin, onControl, onBack, onReport, onCancelReport, reportPreview, onFeedback, onSessionUpdate }: {onSessionUpdate:(session:Session)=>void;assessmentRunning:boolean;onFeedback:()=>void;onReport:()=>void;onCancelReport:()=>void;reportPreview:string;session:Session;mode:Mode;busy:boolean;onAnswer:(value:string,draft?:CodingDraft)=>void;onRetry:()=>void;onBegin:(draft?:CodingDraft)=>void;onControl:(action:'pause'|'resume'|'end')=>void;onBack:()=>void}) {
  const [codingBusy,setCodingBusy] = useState(false); const busy = conversationBusy || codingBusy;
  const [chatLink, setChatLink] = useState(''); const [linkError,setLinkError] = useState('');
  const [answer, setAnswer] = useState(''); const [tab, setTab] = useState(session.mode === 'dsa' ? 'workspace' : 'conversation'); const [repeat, setRepeat] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({block:'nearest',behavior:'auto'}); }, [session.messages]);
  useEffect(() => { setAnswer('');setTab(session.mode === 'dsa' ? 'workspace' : 'conversation');setRepeat(false); }, [session.id]);
  useEffect(() => { if (session.status === 'ended') setTab('report'); }, [session.status,session.id]);
  const userAnswers = session.messages.filter(message => message.role === 'user');
  const lastAssistant = [...session.messages].reverse().find(message => message.role === 'assistant');
  const canRetry = !busy && session.status === 'active' && lastAssistant && ['error','interrupted'].includes(lastAssistant.status);
  const feedback = Array.from(new Map((session.assessments || []).filter(item => item.kind === 'live').map(item => [item.message_id || item.id, item] as const)).values());
  const reports = (session.assessments || []).filter(item => item.kind === 'final');
  const report = [...reports].reverse().find(item => item.status === 'complete');
  const latestReport = reports[reports.length - 1];
  function showEvidence(id:string) { setTab('conversation'); setTimeout(() => document.getElementById(`message-${id}`)?.scrollIntoView({block:'center',behavior:'smooth'}),0); }
  async function linkChat(event:FormEvent) {
    event.preventDefault(); setLinkError('');
    try { await api(`/sessions/${session.id}/conversation`,{method:'PUT',body:JSON.stringify({url:chatLink.trim()})}); window.location.reload(); }
    catch(error) { setLinkError(errorText(error)); }
  }
  function submit(event?: FormEvent) { event?.preventDefault(); if (!answer.trim() || busy || session.status !== 'active') return; onAnswer(answer.trim());setAnswer('');setRepeat(false); }
  return <div className="interview"><div className="interview-header"><div><button className="text-button back-button" onClick={onBack}><ArrowLeft size={14}/>Your workspace</button><h1>{mode.name}</h1><p>{session.topic || 'An open conversation to sharpen your thinking.'}</p></div><div className="interview-controls"><span className="session-target"><Clock3 size={15}/>{session.duration} min target</span>{session.status !== 'ended' && <><button className="button secondary small" onClick={() => onControl(session.status === 'paused' ? 'resume' : 'pause')}>{session.status === 'paused' ? <Play size={14}/> : <Pause size={14}/>} {session.status === 'paused' ? 'Resume' : 'Pause'}</button><button className="button secondary small" onClick={() => { if (window.confirm('End this interview and open its recap?')) onControl('end'); }}><Square size={13}/>End session</button></>}<a href={`/api/sessions/${session.id}/export`} download className="icon-button" aria-label="Export session"><Download size={18}/></a></div></div>
    <VoiceBar key={session.id} session={session} busy={busy||!!canRetry||!lastAssistant} onAnswer={onAnswer}/>
    <div className="interview-layout"><section className="conversation-panel"><div className="conversation-toolbar"><div className="tabs">{session.mode === 'dsa' && <button className={tab === 'workspace' ? 'active' : ''} onClick={() => setTab('workspace')}>Coding workspace</button>}<button className={tab === 'conversation' ? 'active' : ''} onClick={() => setTab('conversation')}>Conversation</button><button className={tab === 'feedback' ? 'active' : ''} onClick={() => setTab('feedback')}>Feedback <span>{feedback.length}</span></button>{session.status === 'ended' && <button className={tab === 'report' ? 'active' : ''} onClick={() => setTab('report')}>Report</button>}<button className={tab === 'timeline' ? 'active' : ''} onClick={() => setTab('timeline')}>Timeline <span>{session.events.length}</span></button></div><span className={`status-label ${session.status}`}>{session.status === 'ended' ? 'Completed' : session.status === 'paused' ? 'Paused' : phaseNames[session.phase] || 'In progress'}</span></div>
    {tab === 'workspace' ? <CodingWorkspace key={session.id} session={session} busy={conversationBusy} onBusy={setCodingBusy} onSessionUpdate={onSessionUpdate} onEvidence={showEvidence} onDiscuss={(text,draft) => {if(session.messages.length) onAnswer(text,draft); else onBegin(draft);}}/> : tab === 'feedback' || tab === 'report' ? <div className="assessment-panel">
      {tab === 'feedback' ? <><span className="eyebrow">LIVE FEEDBACK</span><h2>Learn from each answer.</h2><p className="help-text">Feedback appears after each completed model turn. It stays separate from the interviewer's spoken question.</p>{session.provider !== 'mock' && userAnswers.length > 0 && <div className="feedback-actions">{assessmentRunning ? <div role="status" className="report-progress"><LoaderCircle size={18} className="spin"/><p>{reportPreview || 'Checking assessment evidence…'}</p><button className="text-button" onClick={onCancelReport}>Stop assessment</button></div> : <button className="button secondary small" disabled={busy} onClick={onFeedback}>Repair latest answer feedback</button>}</div>}{feedback.length ? feedback.map(item => <section className="live-feedback-entry" key={item.id}><h3>Answer {userAnswers.findIndex(answer => answer.id === item.message_id)+1}</h3>{item.status !== 'complete' && <p className="help-text">{item.error || 'Assessment is in progress.'} Your answer is saved. You can continue the conversation independently.</p>}{item.content && <AssessmentView key={item.id} scope={item.evidence_scope} value={item.content} sessionId={session.id} assessmentId={item.id} sources={item.evidence_sources} onEvidence={showEvidence} answerIds={userAnswers.map(answer=>answer.id)}/>}</section>) : <p className="assessment-empty">{session.provider === 'mock' ? 'Practice demo does not assess your answers. Connect a model for live feedback.' : 'Answer a question to receive transcript-grounded feedback here.'}</p>}</> : <><span className="eyebrow">FINAL ASSESSMENT</span><h2>Your next step, with evidence.</h2>{busy ? <div role="status" className="report-progress"><LoaderCircle size={20} className="spin"/><p>{reportPreview || 'Reviewing your answers against the interview rubric…'}</p><button className="text-button" onClick={onCancelReport}>Stop report generation</button></div> : <><p className="help-text">{userAnswers.length} answers saved. Your transcript remains available if report generation needs a retry.</p>{latestReport && ['error','interrupted'].includes(latestReport.status) && <p className="inline-error" role="alert">{latestReport.error || 'The report was interrupted. Please retry.'}</p>}<button className="button primary" onClick={onReport}>{latestReport && ['error','interrupted'].includes(latestReport.status) ? 'Retry final report' : report ? 'Regenerate assessment' : 'Generate assessment'}</button></>}{session.mode==='dsa'&&report?.evidence_scope&&!report.evidence_scope.attempt_ids.length&&<p className="help-text">No code attempt was submitted. This report covers the conversation; working drafts are not graded as final submissions.</p>}{report?.content && <AssessmentView key={report.id} scope={report.evidence_scope} value={report.content} sessionId={session.id} assessmentId={report.id} sources={report.evidence_sources} onEvidence={showEvidence} answerIds={userAnswers.map(answer=>answer.id)}/>}</>}
      {session.provider === 'gateway' && (session.gateway_conversation_url ? <a className="text-button chat-binding" href={session.gateway_conversation_url} target="_blank" rel="noreferrer">Open this interview's ChatGPT conversation ↗</a> : <form className="chat-link-form" onSubmit={linkChat}><label className="field-label" htmlFor="chat-link">Link the original ChatGPT conversation</label><p className="help-text">Older sessions need their original chat link. No history will be copied into a new chat.</p><input id="chat-link" type="url" required value={chatLink} onChange={event=>setChatLink(event.target.value)} placeholder="https://chatgpt.com/c/…"/><button className="button secondary small" disabled={busy}>Save chat link</button>{linkError && <p className="inline-error">{linkError}</p>}</form>)}
    </div> : tab === 'timeline' ? <div className="event-timeline">{session.events.map(event => <div key={event.id} className="timeline-event"><span className="timeline-dot"/><div><strong>{event.type.replaceAll('_',' ')}</strong>{event.type === 'phase_changed' && <p>{String(event.data.from)} → {String(event.data.to)}</p>}{event.type === 'generation_error' && <p>{String(event.data.message)}</p>}<time>{time(event.created_at)}</time></div></div>)}</div> : <><div className="messages" aria-label="Interview transcript" aria-busy={busy}>
      <div className="session-intro"><span className="intro-mark"><ModeIcon mode={mode} size={21}/></span><div><strong>A little room to think.</strong><p>{session.level} practice · {providerNames[session.provider]} · Saved locally</p></div></div>
      {session.provider === 'mock' && <div className="demo-notice"><Sparkles size={14}/><span>Practice demo uses sample prompts and echoes your reasoning. Connect a model for adaptive interviewing.</span></div>}
      {session.messages.map(message => <article id={`message-${message.id}`} key={message.id} className={`message ${message.role} ${message.status}`}><div className="message-meta"><span className={`message-avatar ${message.role}`}>{message.role === 'assistant' ? <span className="mini-brand">r</span> : 'Y'}</span><strong>{message.role === 'assistant' ? 'Interviewer' : 'You'}</strong><time>{time(message.created_at)}</time>{['error','interrupted'].includes(message.status) && <span className="partial-label">Incomplete reply</span>}</div><div className="message-content">{message.content || (message.status === 'generating' ? <span className="thinking"><span/><span/><span/><span className="sr-only">Interviewer is responding</span></span> : <span className="muted">No response text was received.</span>)}</div></article>)}
      {!session.messages.length && <div className="begin-conversation"><p>Your session is saved. Take a breath, then begin.</p><button className="button primary" disabled={busy || session.status !== 'active'} onClick={()=>onBegin()}>Ask the first question <ArrowUpRight size={16}/></button></div>}
      {repeat && lastAssistant?.content && <div className="repeat-question"><strong>The question again</strong><p>{lastAssistant.content}</p></div>}
      {canRetry && <button className="button secondary retry-button" onClick={onRetry}><RotateCcw size={15}/>Retry interviewer response</button>}
      {session.status === 'ended' && <div className="session-recap"><span className="eyebrow">SESSION RECAP</span><h2>You made time to practise.</h2><p>{userAnswers.length} {userAnswers.length === 1 ? 'answer' : 'answers'} saved, with your transcript and event history. Open the Report tab for the final assessment and its transcript evidence.</p><h3>What you worked through</h3>{userAnswers.length ? userAnswers.map((message,index) => <div className="recap-answer" key={message.id}><span>{String(index+1).padStart(2,'0')}</span><p>{message.content.slice(0,350)}{message.content.length > 350 ? '…' : ''}</p></div>) : <p>No candidate answers were recorded in this session.</p>}</div>}
      <div ref={end}/></div>
      {session.status !== 'ended' && <form className="answer-form" onSubmit={submit}>{session.status === 'paused' ? <div className="paused-state"><Pause size={20}/><div><strong>Your place is saved.</strong><p>Resume whenever you’re ready to keep thinking.</p></div><button type="button" className="button primary small" onClick={() => onControl('resume')}><Play size={14}/>Resume</button></div> : <><label className="sr-only" htmlFor="answer">Your answer</label><textarea id="answer" maxLength={12000} placeholder={busy ? 'The interviewer is responding…' : 'Talk through your thinking. It doesn’t need to be perfect.'} value={answer} onChange={e => setAnswer(e.target.value)} disabled={busy || !lastAssistant || !!canRetry} onKeyDown={e => {if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {e.preventDefault();submit();}}} rows={3}/><div className="composer-bottom"><span><ShieldCheck size={12}/>Your answer is saved before the next reply.</span><div><kbd>Ctrl ↵</kbd><button className="send-button" type="submit" disabled={!answer.trim() || busy || !!canRetry} aria-label="Send answer">{busy ? <LoaderCircle size={18} className="spin"/> : <ArrowUp size={20}/>}</button></div></div></>}</form>}
    </>}
    </section><aside className="interview-context"><div className="context-section"><div className="eyebrow">SESSION COMPASS</div><h2>{phaseNames[session.phase] || 'Think it through'}</h2><p>{session.status === 'ended' ? 'Your transcript is ready to revisit.' : session.status === 'paused' ? 'A pause is part of the process.' : 'Explain the why behind your decisions. Ask questions when something is unclear.'}</p><dl><div><dt>Level</dt><dd>{session.level}</dd></div><div><dt>Answers</dt><dd>{userAnswers.length}</dd></div><div><dt>Interviewer</dt><dd>{providerNames[session.provider]}</dd></div></dl></div><div className="context-section"><div className="eyebrow">WAYS TO THINK DEEPER</div><ul className="rubric-list">{mode.rubric.map(item => <li key={item}><span/>{item}</li>)}</ul><small>Scores and evidence appear in Feedback and Report.</small></div><div className="context-section context-tip"><CircleHelp size={19}/><p>It’s okay to say “I’m not sure.” Explain what you would investigate next.</p>{lastAssistant && session.status !== 'ended' && <button className="text-button" onClick={() => {setRepeat(!repeat);setTab('conversation');}}><RotateCcw size={13}/>{repeat ? 'Hide repeated question' : 'Repeat the question'}</button>}</div><div className="tool-coming"><ModeIcon mode={mode} size={17}/><span>{nextTools[mode.id]}<small>{mode.id === 'dsa' ? 'Open Coding workspace to prepare a problem' : 'Coming in a later build'}</small></span></div></aside></div>
  </div>;
}
