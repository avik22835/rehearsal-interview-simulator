import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { WebSocketServer } from 'ws';

// One browser turn at a time. Busy requests fail explicitly rather than
// allowing concurrent requests to type into the same composer.
export function createGateway({ defaultTimeout = 180000, cancelGrace = 5000,
  heartbeatMs = 20000, logger = () => {}, bindingPath = null } = {}) {
  let extension = null;
  let extensionInfo = null;
  let active = null;
  const inspections = new Map();
  const bindings = new Map(bindingPath && existsSync(bindingPath) ? Object.entries(JSON.parse(readFileSync(bindingPath, 'utf8'))) : []);
  function conversationUrl(value) {
    try { const u = new URL(value); return u.origin === 'https://chatgpt.com' && /^\/c\/[a-zA-Z0-9-]+$/.test(u.pathname) ? u.origin + u.pathname : null; } catch { return null; }
  }
  function saveBinding(turn, binding) {
    if (!turn.conversationKey) return;
    const previous = bindings.get(turn.conversationKey) || {};
    const next = { ...previous, ...binding, url: conversationUrl(binding.url) || previous.url || null };
    // A bound interview must never move to another ChatGPT conversation.
    if (previous.url && binding.url && previous.url !== binding.url) throw new Error('The browser returned another conversation; the interview binding was preserved.');
    bindings.set(turn.conversationKey, next);
    if (bindingPath) {
      mkdirSync(dirname(bindingPath), { recursive: true });
      writeFileSync(bindingPath + '.tmp', JSON.stringify(Object.fromEntries(bindings)), 'utf8');
      renameSync(bindingPath + '.tmp', bindingPath);
    }
    if (JSON.stringify(previous) !== JSON.stringify(next) && turn.streaming) event(turn, { conversation_key: turn.conversationKey, conversation_url: next.url }, 'conversation');
  }
  const wss = new WebSocketServer({ noServer: true });
  const isExtensionOrigin = origin => /^chrome-extension:\/\/[a-p]{32}$/.test(origin || '') ||
    /^moz-extension:\/\/[a-zA-Z0-9-]+$/.test(origin || '');
  const json = (res, status, body) => {
    if (!res.destroyed && !res.writableEnded) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    }
  };
  function event(turn, body, name) {
    if (turn.res.destroyed || turn.res.writableEnded) return;
    if (name) turn.res.write(`event: ${name}\n`);
    turn.res.write(`data: ${typeof body === 'string' ? body : JSON.stringify(body)}\n\n`);
  }
  function chunk(turn, delta, finish = null) {
    return { id: `chatcmpl-${turn.id}`, object: 'chat.completion.chunk',
      created: turn.created, model: turn.model,
      choices: [{ index: 0, delta, finish_reason: finish }] };
  }
  function release(turn) {
    clearTimeout(turn.timer);
    clearInterval(turn.heartbeat);
    clearTimeout(turn.cancelTimer);
    if (active === turn) active = null;
  }
  function fail(turn, message, status = 502) {
    if (turn.streaming) {
      event(turn, { error: { message, type: 'gateway_error' } }, 'error');
      turn.res.end();
    } else json(turn.res, status, { error: message });
  }
  function cancel(turn, reason, status) {
    if (turn.cancelled || active !== turn) return;
    turn.cancelled = true;
    logger('request_cancelled', { requestId: turn.id, reason });
    clearTimeout(turn.timer);
    clearInterval(turn.heartbeat);
    fail(turn, reason, status);
    if (extension?.readyState === 1) {
      extension.send(JSON.stringify({ type: 'cancel', requestId: turn.id }));
      // Never accept a new turn while the old browser operation might still run.
      turn.cancelTimer = setTimeout(() => {
        extension?.close(1011, 'Cancellation acknowledgement timed out');
      }, cancelGrace);
    } else release(turn);
  }
  function snapshot(turn, text) {
    if (typeof text !== 'string' || text === turn.text || turn.cancelled) return;
    if (turn.streaming) {
      if (text.startsWith(turn.text)) {
        event(turn, chunk(turn, { content: text.slice(turn.text.length) }));
      } else {
        // DOM text can be rewritten. Consumers must replace their draft on this
        // event, not append it or speak it as a new sentence.
        event(turn, { requestId: turn.id, content: text }, 'snapshot');
      }
    }
    turn.text = text;
  }
  wss.on('connection', ws => {
    if (extension && extension.readyState === 1) {
      ws.close(1008, 'An extension is already connected');
      return;
    }
    extension = ws;
    logger('extension_connected');
    // Application messages keep an MV3 worker active during long browser turns.
    // TCP/WebSocket protocol pings alone do not exercise its JS message handler.
    const keepalive = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'keepalive' }));
    }, heartbeatMs);
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'hello') {
        extensionInfo = { version: message.version, protocol: message.protocol };
        logger('extension_version', extensionInfo);
        return;
      }
      if (message.type === 'inspection' && inspections.has(message.requestId)) {
        const entry = inspections.get(message.requestId);
        inspections.delete(message.requestId);
        clearTimeout(entry.timer);
        json(entry.res, message.ok ? 200 : 502, message.ok ? message.data : { error: message.error });
        return;
      }
      const turn = active;
      if (!turn || message.requestId !== turn.id) return;
      if (message.type === 'cancelled') {
        if (turn.cancelled) release(turn);
        return;
      }
      if (turn.cancelled) return;
      try {
        if (message.type === 'conversation') {
          saveBinding(turn, message.binding || {});
          return;
        }
        if (message.conversationUrl) saveBinding(turn, { url: message.conversationUrl });
      } catch (error) {
        cancel(turn, error.message || 'Could not preserve the interview conversation binding', 502);
        return;
      }
      if (message.type === 'progress') {
        snapshot(turn, message.content);
      } else if (message.type === 'response') {
        logger('request_finished', { requestId: turn.id, ok: !!message.ok,
          error: message.ok ? undefined : message.error });
        if (!message.ok) fail(turn, message.error || 'Browser request failed');
        else if (typeof message.content !== 'string' || !message.content.trim()) {
          fail(turn, 'Browser returned an empty response');
        } else {
          snapshot(turn, message.content);
          if (turn.streaming) {
            event(turn, chunk(turn, {}, 'stop'));
            event(turn, '[DONE]');
            turn.res.end();
          } else json(turn.res, 200, {
            id: `chatcmpl-${turn.id}`, object: 'chat.completion',
            created: turn.created, model: turn.model,
            choices: [{ index: 0, message: { role: 'assistant', content: turn.text }, finish_reason: 'stop' }],
            conversation_url: bindings.get(turn.conversationKey)?.url || null,
            conversation_key: turn.conversationKey,
          });
        }
        release(turn);
      }
    });
    ws.on('error', () => ws.close());
    ws.on('close', (code, reason) => {
      clearInterval(keepalive);
      logger('extension_disconnected', { code, reason: reason.toString() });
      if (extension !== ws) return;
      extension = null;
      extensionInfo = null;
      for (const entry of inspections.values()) {
        clearTimeout(entry.timer);
        json(entry.res, 503, { error: 'Extension disconnected during inspection' });
      }
      inspections.clear();
      if (active) {
        fail(active, 'Browser extension disconnected');
        release(active);
      }
    });
  });
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    // Permit the extension popup, while keeping ordinary websites out.
    if (origin && !isExtensionOrigin(origin)) return json(res, 403, { error: 'Browser origin not allowed' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, { status: 'ok', extensionConnected: extension?.readyState === 1,
        pendingRequests: active ? 1 : 0, streaming: true, snapshotEvents: true, conversationBinding: extensionInfo?.protocol >= 3,
        backgroundTransport: extensionInfo?.protocol >= 4, extensionInfo });
    }
    if (req.method === 'GET' && req.url === '/diagnostics') {
      if (!extension || extension.readyState !== 1) return json(res, 503, { error: 'Extension not connected' });
      if (inspections.size >= 2) return json(res, 429, { error: 'Inspection already pending' });
      const requestId = `inspect-${randomUUID()}`;
      const timer = setTimeout(() => {
        inspections.delete(requestId);
        json(res, 504, { error: 'Extension inspection timed out. Reload version 1.0.1 of the extension.' });
      }, 10000);
      inspections.set(requestId, { res, timer });
      res.on('close', () => { clearTimeout(timer); inspections.delete(requestId); });
      extension.send(JSON.stringify({ type: 'inspect', requestId }));
      return;
    }
    if (req.method === 'DELETE' && req.url?.startsWith('/v1/requests/')) {
      const turn = active;
      const matches = turn?.id === req.url.split('/').pop();
      if (matches) cancel(turn, 'Request cancelled', 499);
      return json(res, 200, { cancelled: !!matches });
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      return json(res, 404, { error: 'Not found' });
    }
    let payload;
    try {
      let body = '';
      for await (const part of req) {
        body += part;
        if (Buffer.byteLength(body) > 2 * 1024 * 1024) {
          json(res, 413, { error: 'Request exceeds 2 MiB' });
          return;
        }
      }
      payload = JSON.parse(body);
    } catch { return json(res, 400, { error: 'Invalid JSON or interrupted request' }); }
    if (!payload || !Array.isArray(payload.messages) || !payload.messages.length ||
      payload.messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') ||
      !payload.messages.some(m => m.role === 'user' && m.content.trim())) {
      return json(res, 400, { error: 'messages must contain text messages and a non-empty user message' });
    }
    if (payload.stream !== undefined && typeof payload.stream !== 'boolean') {
      return json(res, 400, { error: 'stream must be boolean' });
    }
    if (payload.conversation_key !== undefined && (typeof payload.conversation_key !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.conversation_key))) return json(res, 400, { error: 'Invalid conversation_key' });
    if (payload.conversation_url && !conversationUrl(payload.conversation_url)) return json(res, 400, { error: 'Invalid ChatGPT conversation URL' });
    const timeout = payload.timeout ?? defaultTimeout;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 1200000) {
      return json(res, 400, { error: 'timeout must be an integer between 1 and 1200000 milliseconds' });
    }
    if (!extension || extension.readyState !== 1) return json(res, 503, { error: 'Browser extension not connected' });
    if (payload.conversation_key && !(extensionInfo?.protocol >= 3)) return json(res, 503, { error: 'Reload ChatGPT Gateway version 1.0.8 or later for saved interview conversations.' });
    let binding = bindings.get(payload.conversation_key);
    if (binding?.url && payload.conversation_url && binding.url !== payload.conversation_url) return json(res, 409, { error: 'Interview conversation does not match its saved binding' });
    if (!binding && payload.conversation_url) binding = { url: conversationUrl(payload.conversation_url) };
    if (payload.conversation_key && !binding && payload.new_conversation === false) return json(res, 409, { error: 'Original interview binding is unavailable; no new conversation was created.' });
    if (active) return json(res, 409, { error: 'Gateway busy; wait for the current browser turn to finish' });
    const turn = { id: randomUUID(), res, streaming: payload.stream === true,
      model: payload.model || 'auto', created: Math.floor(Date.now() / 1000), text: '', cancelled: false, conversationKey: payload.conversation_key || null };
    active = turn;
    logger('request_started', { requestId: turn.id, stream: turn.streaming });
    if (turn.streaming) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      event(turn, chunk(turn, { role: 'assistant', content: '' }));
      turn.heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n');
      }, 15000);
    }
    turn.timer = setTimeout(() => cancel(turn, 'Timeout waiting for ChatGPT; partial output is incomplete', 504), timeout);
    // IncomingMessage close fires after reading a normal request too. Observe
    // the outgoing response to detect actual client cancellation instead.
    res.on('close', () => { if (!res.writableEnded) cancel(turn, 'Client disconnected', 499); });
    extension.send(JSON.stringify({ type: 'chat', requestId: turn.id, model: turn.model,
      messages: payload.messages, newConversation: !binding && payload.new_conversation !== false,
      conversationBinding: binding || null, conversationKey: turn.conversationKey, timeout }));
  });
  server.on('upgrade', (req, socket, head) => {
    // Browser pages must not open the unauthenticated local relay cross-origin.
    const origin = req.headers.origin;
    if (req.url !== '/ws' || (origin && !isExtensionOrigin(origin))) {
      socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  server.on('close', () => { if (active) release(active); });
  return { server, wss };
}
