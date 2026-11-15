import type { SavedAssessment } from '@/components/assessment-view';
export type CodingDraft = {workspace_id:string;expected_revision:number;code:string};
export type Mode = { id: string; name: string; short: string; category: string; description: string; icon: string; number: string; tools: string; rubric: string[]; opening: string };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; status: 'complete' | 'generating' | 'interrupted' | 'error'; created_at: string; speech_complete?:boolean };
export type InterviewEvent = { id: number; type: string; data: Record<string, unknown>; created_at: string };
export type Session = { id: string; mode: string; title: string; topic: string; level: string; duration: number; provider: string; phase: string; status: 'active' | 'paused' | 'ended'; created_at: string; updated_at: string; remote_consent: boolean; messages: Message[]; events: InterviewEvent[]; answer_count?: number; assessments: SavedAssessment[]; gateway_conversation_url: string | null; gateway_bound: boolean; gateway_session_version: number };
export type Settings = { kind: 'mock' | 'gateway' | 'compatible'; base_url: string; model: string; timeout: number; stream: boolean; has_key: boolean };
export type ProviderCheck = { connected: boolean; message: string; capabilities: Record<string, string> };
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api' + path, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.detail === 'string' ? body.detail : Array.isArray(body.detail) ? body.detail.map((item: {msg: string}) => item.msg).join('. ') : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export async function streamTurn(id: string, body: { action: string; content?: string; coding_context?: CodingDraft }, signal: AbortSignal, onEvent: (event: { type: string; text?: string; message_id?: string; message?: string; session?: Session }) => void, endpoint: 'turns' | 'report' | 'feedback' | `coding/attempts/${string}/review` = 'turns') {
  const response = await fetch(`/api/sessions/${id}/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Could not start this turn.');
  }
  if (!response.body) throw new Error('This browser cannot read streamed responses.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const record = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = record.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const event = JSON.parse(data);
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'complete') finished = true;
        onEvent(event);
      }
    }
    if (!finished) throw new Error('The response was interrupted. Your work is saved; retry when ready.');
  } finally { reader.releaseLock(); }
}
