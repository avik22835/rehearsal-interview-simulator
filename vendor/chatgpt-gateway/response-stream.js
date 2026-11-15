// Passive, turn-scoped response observer. Never reads request bodies, cookies,
// authorization headers, or credentials; original fetch/WS behavior is preserved.
(() => {
  if (globalThis.__interviewResponseStream) return;
  globalThis.__interviewResponseStream = true;
  let turn = null;
  const marker = 'interview-gateway-response-v1';
  const urlOf = id => typeof id === 'string' && /^[a-zA-Z0-9-]+$/.test(id) ? `https://chatgpt.com/c/${id}` : null;
  function publish() {
    if (!turn || !turn.text || turn.publishQueued) return;
    const state = turn;
    state.publishQueued = true;
    Promise.resolve().then(() => {
      state.publishQueued = false;
      if (turn !== state) return;
      window.postMessage({ source: marker, token: state.token, text: state.text,
        done: state.done, conversationUrl: state.url, transport: state.transport }, location.origin);
    });
  }
  function patch(path, operation, value) {
    if (!turn || typeof path !== 'string') return;
    if (/\/message\/channel$/.test(path)) { turn.channel = value; return; }
    if (/\/message\/status$/.test(path) && value === 'finished_successfully' && turn.channel !== 'analysis') { turn.done = true; publish(); return; }
    if (!/\/message\/content\/parts\/0$/.test(path) || turn.channel === 'analysis' || !turn.assistant) return;
    if (typeof value !== 'string') return;
    turn.text = operation === 'append' || operation === 'add' ? turn.text + value : value;
    publish();
  }
  function consume(value, transport, depth = 0) {
    if (!turn || depth > 12 || value == null) return;
    if (Array.isArray(value)) { for (const entry of value) consume(entry, transport, depth + 1); return; }
    if (typeof value !== 'object') return;
    turn.transport = transport;
    if (value.conversation_id) {
      const url = urlOf(value.conversation_id);
      if (turn.expectedUrl && url && url !== turn.expectedUrl) return;
      if (url) turn.url = url;
    }
    const message = value.author ? value : value.message;
    if (message?.author?.role) turn.assistant = message.author.role === 'assistant';
    if (message?.author?.role === 'assistant') {
      turn.assistant = true;
      turn.channel = message.channel || 'final';
      if (turn.channel !== 'analysis' && message.content?.content_type === 'text' && Array.isArray(message.content.parts)) {
        turn.text = message.content.parts.filter(part => typeof part === 'string').join('');
        turn.done = message.status === 'finished_successfully';
        publish();
      }
    }
    // ChatGPT compact JSON patches can omit p/o after their first frame.
    if (typeof value.p === 'string') turn.path = value.p;
    if (typeof value.o === 'string') turn.operation = value.o;
    if ('v' in value) {
      if (typeof value.v === 'string' && turn.path) patch(turn.path, turn.operation, value.v);
      else consume(value.v, transport, depth + 1);
    }
    // Conduit messages wrap conversation events, sometimes as JSON strings.
    for (const key of ['data', 'payload', 'body', 'message', 'messages', 'updates']) {
      const item = value[key];
      if (typeof item === 'string' && /^[\[{]/.test(item.trim())) {
        try { consume(JSON.parse(item), transport, depth + 1); } catch { /* other channel */ }
      } else if (item && typeof item === 'object') consume(item, transport, depth + 1);
    }
  }
  function frame(raw, transport, token = turn?.token) {
    if (!turn || turn.token !== token || typeof raw !== 'string' || raw.length > 4 * 1024 * 1024) return;
    try {
      const value = JSON.parse(raw);
      if ((turn.frames || 0) < 8) {
        turn.frames = (turn.frames || 0) + 1;
        const shape = value && typeof value === 'object' ? Object.entries(value).slice(0,12).map(([key,item]) => ({key,kind:Array.isArray(item)?'array':typeof item,keys:item && typeof item==='object'?Object.keys(item).slice(0,10):undefined})) : [];
        window.postMessage({source:marker,token:turn.token,kind:'shape',shape,transport},location.origin);
      }
      consume(value, transport);
    } catch { /* control/heartbeat frames */ }
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== marker + '-control') return;
    const command = event.data;
    if (command.type === 'arm' && typeof command.token === 'string') {
      turn = { token: command.token, expectedUrl: command.conversationUrl || null,
        url: command.conversationUrl || null, text: '', assistant: false, channel: 'final', done: false };
    } else if (command.type === 'stop' && command.token === turn?.token) turn = null;
  });
  const originalFetch = globalThis.fetch;
  if (originalFetch) globalThis.fetch = async function(...args) {
    const requestedToken = turn?.token;
    const response = await Reflect.apply(originalFetch, this, args);
    if (!requestedToken || turn?.token !== requestedToken) return response;
    let url;
    try { url = new URL(response.url); } catch { return response; }
    if (url.origin !== location.origin || !/\/backend-api\/(?:f\/)?conversation\/?$/.test(url.pathname) ||
        !response.headers.get('content-type')?.includes('text/event-stream')) return response;
    const token = turn.token;
    // Observe a clone; never consume or replace the page's own response body.
    void (async () => {
      const reader = response.clone().body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '', bytes = 0;
      try {
        while (turn?.token === token) {
          const part = await reader.read();
          if (turn?.token !== token) break;
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 16 * 1024 * 1024) break;
          buffer += decoder.decode(part.value, {stream:true}).replace(/\r\n/g, '\n');
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const record = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = record.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (data && data !== '[DONE]') frame(data, 'fetch', token);
          }
        }
      } catch { /* DOM remains a fallback if this protocol changes. */ }
      finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    })();
    return response;
  };
  const OriginalSocket = globalThis.WebSocket;
  if (OriginalSocket) globalThis.WebSocket = new Proxy(OriginalSocket, {
    construct(Target, args, NewTarget) {
      const socket = Reflect.construct(Target, args, NewTarget);
      // Only the page's sockets are observed, only during an explicitly armed turn.
      let allowed = false;
      try {
        const url = new URL(args[0], location.origin);
        allowed = url.protocol === 'wss:' && (url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com') || url.hostname === 'chat.openai.com');
      } catch { /* Never observe local application/control sockets. */ }
      if (allowed) socket.addEventListener('message', event => { if (turn) frame(event.data, 'websocket', turn.token); });
      return socket;
    },
  });
})();
