import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway } from '../gateway-server.mjs';

async function setup(t, options) {
  const { server, wss } = createGateway(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  await once(ws, 'open');
  t.after(async () => {
    for (const client of wss.clients) client.terminate();
    ws.terminate();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    wss.close();
  });
  const post = body => fetch(base + '/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Question' }], ...body }),
  });
  return { base, ws, post };
}
const send = (ws, body) => ws.send(JSON.stringify(body));

test('interview keys reuse their own bound chat and isolate another interview', async t => {
  const { ws, post } = await setup(t);
  send(ws, { type: 'hello', version: '1.0.8', protocol: 3 });
  const requests = [];
  ws.on('message', raw => {
    const message = JSON.parse(raw);
    if (message.type !== 'chat') return;
    requests.push(message);
    const suffix = message.conversationKey === 'interview-a' ? 'chat-a' : 'chat-b';
    send(ws, { type: 'conversation', requestId: message.requestId, binding: { tabId: 12, documentId: 'doc', url: `https://chatgpt.com/c/${suffix}` } });
    send(ws, { type: 'response', requestId: message.requestId, ok: true, content: 'A question?', conversationUrl: `https://chatgpt.com/c/${suffix}` });
  });
  const first = await (await post({ stream: true, conversation_key: 'interview-a' })).text();
  assert.match(first, /event: conversation/);
  assert.match(first, /https:\/\/chatgpt.com\/c\/chat-a/);
  await (await post({ conversation_key: 'interview-a', new_conversation: false })).json();
  await (await post({ conversation_key: 'interview-b' })).json();
  assert.equal(requests[0].newConversation, true);
  assert.equal(requests[1].newConversation, false);
  assert.equal(requests[1].conversationBinding.url, 'https://chatgpt.com/c/chat-a');
  assert.equal(requests[2].newConversation, true);
  assert.equal(requests[2].conversationBinding, null);
  const mismatch = await post({ conversation_key: 'interview-a', conversation_url: 'https://chatgpt.com/c/other' });
  assert.equal(mismatch.status, 409);
  assert.equal(requests.length, 3);
});

test('missing interview binding and old extension never silently start a new chat', async t => {
  const { ws, post } = await setup(t);
  assert.equal((await post({conversation_key:'one'})).status, 503);
  send(ws, { type:'hello', version:'1.0.8', protocol:3 });
  assert.equal((await post({conversation_key:'missing',new_conversation:false})).status,409);
  assert.equal((await post({conversation_key:'invalid key'})).status,400);
  assert.equal((await post({conversation_key:'one',conversation_url:'https://unrelated.example/c/one'})).status,400);
});

test('saved chat binding survives a relay restart and rejects a different response chat', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'interview-binding-'));
  const bindingPath = join(folder, 'bindings.json');
  t.after(() => rmSync(folder, {recursive:true,force:true}));
  const first = await setup(t, {bindingPath});
  send(first.ws, {type:'hello',version:'1.0.8',protocol:3});
  first.ws.on('message', raw => {
    const message = JSON.parse(raw);
    if (message.type !== 'chat') return;
    send(first.ws,{type:'conversation',requestId:message.requestId,binding:{tabId:7,documentId:'original',url:'https://chatgpt.com/c/persisted'}});
    send(first.ws,{type:'response',requestId:message.requestId,ok:true,content:'Opening?'});
  });
  await (await first.post({conversation_key:'persisted-interview'})).json();
  // A fresh relay instance must reload the on-disk binding.
  const resumed = await setup(t, {bindingPath});
  send(resumed.ws,{type:'hello',version:'1.0.8',protocol:3});
  resumed.ws.on('message',raw=>{
    const message=JSON.parse(raw);
    if(message.type==='cancel') {send(resumed.ws,{type:'cancelled',requestId:message.requestId});return;}
    if(message.type!=='chat') return;
    assert.equal(message.newConversation,false);
    assert.equal(message.conversationBinding.url,'https://chatgpt.com/c/persisted');
    send(resumed.ws,{type:'progress',requestId:message.requestId,conversationUrl:'https://chatgpt.com/c/unrelated',content:'Wrong chat answer'});
  });
  const output=await (await resumed.post({conversation_key:'persisted-interview',new_conversation:false,stream:true})).text();
  assert.match(output,/event: error/);
  assert.ok(!output.includes('Wrong chat answer'));
  assert.ok(!output.includes('[DONE]'));
});

test('streams incremental content before completion, then DONE', async t => {
  const { ws, post } = await setup(t);
  const request = once(ws, 'message');
  const response = await post({ stream: true });
  const message = JSON.parse((await request)[0]);
  const reader = response.body.getReader();
  let output = new TextDecoder().decode((await reader.read()).value);
  send(ws, { type: 'progress', requestId: message.requestId, content: 'Hello' });
  while (!output.includes('Hello')) output += new TextDecoder().decode((await reader.read()).value);
  assert.ok(!output.includes('[DONE]'));
  send(ws, { type: 'response', requestId: message.requestId, ok: true, content: 'Hello there.' });
  for (;;) { const part = await reader.read(); if (part.done) break; output += new TextDecoder().decode(part.value); }
  assert.match(output, /"content":" there\."/);
  assert.match(output, /"finish_reason":"stop"/);
  assert.match(output, /data: \[DONE\]/);
});

test('DOM revisions emit replacement snapshots and duplicate updates are ignored', async t => {
  const { ws, post } = await setup(t);
  ws.on('message', raw => {
    const { requestId } = JSON.parse(raw);
    for (const content of ['One', 'One', 'Two']) send(ws, { type: 'progress', requestId, content });
    send(ws, { type: 'response', requestId, ok: true, content: 'Two' });
  });
  const output = await (await post({ stream: true })).text();
  assert.equal((output.match(/"content":"One"/g) || []).length, 1);
  assert.match(output, /event: snapshot/);
  assert.match(output, /"content":"Two"/);
});

test('non-streaming remains compatible and ignores another request ID', async t => {
  const { ws, post } = await setup(t);
  ws.on('message', raw => {
    const { requestId } = JSON.parse(raw);
    send(ws, { type: 'response', requestId: 'stale', ok: true, content: 'Wrong' });
    send(ws, { type: 'response', requestId, ok: true, content: 'Correct' });
  });
  const result = await (await post({})).json();
  assert.equal(result.choices[0].message.content, 'Correct');
});

test('rejects overlapping turns without sending them to the browser', async t => {
  const { ws, post } = await setup(t);
  const request = once(ws, 'message');
  const first = await post({ stream: true });
  const { requestId } = JSON.parse((await request)[0]);
  assert.equal((await post({})).status, 409);
  send(ws, { type: 'response', requestId, ok: true, content: 'Done' });
  await first.text();
});

test('timeout emits an error without successful DONE, waits for cancel acknowledgement', async t => {
  const { ws, post, base } = await setup(t, { defaultTimeout: 40 });
  let acknowledged;
  const cancelled = new Promise(resolve => { acknowledged = resolve; });
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.type === 'chat') send(ws, { type: 'progress', requestId: msg.requestId, content: 'Partial' });
    if (msg.type === 'cancel') {
      send(ws, { type: 'cancelled', requestId: msg.requestId });
      acknowledged();
    }
  });
  const output = await (await post({ stream: true })).text();
  assert.match(output, /event: error/);
  assert.ok(!output.includes('[DONE]'));
  await cancelled;
  // A health request is processed after the earlier WebSocket acknowledgement.
  for (let i = 0; i < 20; i++) {
    if ((await (await fetch(base + '/health')).json()).pendingRequests === 0) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Cancellation did not release turn');
});

test('extension disconnect closes the stream with an explicit error', async t => {
  const { ws, post } = await setup(t);
  ws.on('message', () => ws.close());
  const output = await (await post({ stream: true })).text();
  assert.match(output, /extension disconnected/);
  assert.ok(!output.includes('[DONE]'));
});

test('client abort requests browser cancellation', async t => {
  const { ws, base } = await setup(t);
  let resolveCancel;
  const cancelled = new Promise(resolve => { resolveCancel = resolve; });
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.type === 'cancel') {
      send(ws, { type: 'cancelled', requestId: msg.requestId });
      resolveCancel(msg.requestId);
    }
  });
  const controller = new AbortController();
  const response = await fetch(base + '/v1/chat/completions', {
    method: 'POST', signal: controller.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }], stream: true }),
  });
  await response.body.getReader().read();
  controller.abort();
  assert.equal(typeof await cancelled, 'string');
});

test('invalid input and absent extension return useful errors', async t => {
  const { ws, post } = await setup(t);
  assert.equal((await post({ messages: [] })).status, 400);
  assert.equal((await post({ timeout: -1 })).status, 400);
  assert.equal((await post({ stream: 'yes' })).status, 400);
  const closed = once(ws, 'close');
  ws.close(); await closed;
  assert.equal((await post({})).status, 503);
});

test('extension popup health and preflight work without opening access to websites', async t => {
  const { base } = await setup(t);
  const origin = 'chrome-extension://jbhgccfhgpagmadjnenmkjnnnedkcolg';
  const health = await fetch(base + '/health', { headers: { Origin: origin } });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), origin);
  const preflight = await fetch(base + '/v1/chat/completions', {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(preflight.status, 204);
  const blocked = await fetch(base + '/health', { headers: { Origin: 'https://example.com' } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
});

test('idle browser relay receives application keepalives', async t => {
  const { ws } = await setup(t, { heartbeatMs: 20 });
  const [raw] = await once(ws, 'message');
  assert.deepEqual(JSON.parse(raw), { type: 'keepalive' });
});

test('read-only diagnostics ask the extension to inspect without sending a chat', async t => {
  const { ws, base } = await setup(t);
  ws.on('message', raw => {
    const message = JSON.parse(raw);
    assert.equal(message.type, 'inspect');
    send(ws, { type: 'inspection', requestId: message.requestId, ok: true,
      data: { extensionVersion: '1.0.1', diagnostics: { composers: [], buttons: [] } } });
  });
  const response = await fetch(base + '/diagnostics');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).extensionVersion, '1.0.1');
  assert.equal((await (await fetch(base + '/health')).json()).pendingRequests, 0);
});

test('health exposes the connected extension version', async t => {
  const { ws, base } = await setup(t);
  send(ws, { type: 'hello', version: '1.0.1', protocol: 2 });
  let health;
  for (let attempt = 0; attempt < 20; attempt++) {
    health = await (await fetch(base + '/health')).json();
    if (health.extensionInfo) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.deepEqual(health.extensionInfo, { version: '1.0.1', protocol: 2 });
});
