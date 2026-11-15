// ChatGPT Gateway — Content script
// Injected into chatgpt.com, handles DOM automation
(function () {
  "use strict";

  // Recovery injection must not attach duplicate listeners to the same page.
  if (globalThis.__interviewGatewayContentLoaded) return;
  globalThis.__interviewGatewayContentLoaded = true;
  const documentId = `${Date.now()}-${Math.random()}`;

  const POLL_INTERVAL = 250;
  let activeTurn = null;
  let pendingCancellation = null;
  let networkState = null;
  let wireShapes = [];
  let responseSample = null;
  const sleepers = new Set();
  const transportMarker = 'interview-gateway-response-v1';
  window.addEventListener?.('message', event => {
    if (event.source !== window || event.data?.source !== transportMarker || !activeTurn || event.data.token !== activeTurn.token) return;
    if (event.data.kind === 'shape') { wireShapes.push({transport:event.data.transport,shape:event.data.shape}); return; }
    networkState = { text: typeof event.data.text === 'string' ? event.data.text : '', done: !!event.data.done,
      url: event.data.conversationUrl, transport: event.data.transport };
    responseSample?.('network');
  });
  function checkCancelled() {
    if (activeTurn?.cancelled) throw new Error("Request cancelled");
  }
  const MAX_WAIT = 180_000; // 3 minutes
  function stage(name, details = {}) {
    globalThis.__interviewGatewayDiagnostics = { name, ...details };
  }
  async function deliver(message) {
    // Retrying the same snapshot is safe: the relay de-duplicates snapshots.
    // Surface delivery errors in diagnostics instead of silently swallowing them.
    for (let attempt = 0; attempt < 3; attempt++) {
      checkCancelled();
      try {
        const acknowledgement = await chrome.runtime.sendMessage(message);
        if (!acknowledgement?.received) throw new Error('Background did not acknowledge the result');
        return;
      } catch (error) {
        checkCancelled();
        stage('delivery_failed', { error: error.message, messageType: message.type });
        if (attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────

  const sleep = async (ms) => {
    checkCancelled();
    await new Promise(resolve => {
      let timer;
      const waiter = {deadline:Date.now()+ms,finish() {
        sleepers.delete(waiter);
        if (timer !== undefined) globalThis.clearTimeout?.(timer);
        resolve();
      }};
      sleepers.add(waiter);
      timer = setTimeout(() => waiter.finish(), ms);
    });
    checkCancelled();
  };

  function findInput() {
    const selectors = [
      "#prompt-textarea",
      'div[contenteditable="true"][id="prompt-textarea"]',
      "textarea",
      '[contenteditable="true"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function findSendButton() {
    const selectors = [
      '[data-testid="send-button"]',
      "#composer-submit-button",
      'button[aria-label="Send prompt"]',
      'button[aria-label*="Send"]',
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled) return btn;
    }
    return null;
  }

  // ── Actions ──────────────────────────────────────────────

  async function selectModel(modelSlug) {
    if (!modelSlug || modelSlug === 'auto') return;

    // Try clicking the model picker
    const pickerSelectors = [
      '[data-testid="model-switcher"]',
      'button[aria-haspopup="listbox"]',
      'button[aria-haspopup="menu"]',
    ];

    let picker = null;
    for (const sel of pickerSelectors) {
      picker = document.querySelector(sel);
      if (picker) break;
    }

    if (!picker) return; // No model picker found, proceed with default

    picker.click();
    await sleep(800);

    // Find model option
    const options = document.querySelectorAll(
      '[role="option"], [role="menuitemradio"], [role="menuitem"]'
    );
    const slug = modelSlug.toLowerCase();
    for (const opt of options) {
      const text = (opt.textContent || "").toLowerCase();
      if (text.includes(slug) || text.includes(slug.replace(/-/g, " "))) {
        opt.click();
        await sleep(500);
        return;
      }
    }
    // Close picker if model not found
    document.body.click();
    await sleep(300);
  }

  function inputText(input) {
    if (!input) return '';
    const rich = input.isContentEditable || input.contentEditable === 'true' || input.contentEditable === 'plaintext-only';
    return (rich ? input.innerText || input.textContent || '' : input.value || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  }

  async function typeMessage(text) {
    const expected = text.trim();
    for (let attempt = 0; attempt < 5; attempt++) {
      checkCancelled();
      const input = findInput();
      if (!input) { await sleep(400); continue; }
      input.focus();
      await sleep(150);
      if (findInput() !== input || input.isConnected === false) continue;
      const rich = input.isContentEditable || input.contentEditable === 'true' || input.contentEditable === 'plaintext-only';
      if (rich) {
        // Scope the selection to the actual editor. Never select the entire page.
        if (document.createRange && window.getSelection) {
          const range = document.createRange();
          range.selectNodeContents(input);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        } else document.execCommand('selectAll');
        // Let the rich editor process a real editing command rather than
        // mutating textContent behind its internal document state.
        document.execCommand('insertText', false, text);
      } else {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
        if (setter) setter.call(input, text); else input.value = text;
      }
      if (input.dispatchEvent) input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(450);
      const current = findInput();
      stage('verifying_prompt', { attempt: attempt + 1, expectedCharacters: expected.length,
        liveCharacters: inputText(current).length, editorReplaced: current !== input });
      if (current === input && inputText(current) === expected) {
        await sleep(500);
        if (findInput() === current && inputText(current) === expected) return;
      }
      await sleep(400);
    }
    throw new Error('Prompt did not persist in the live ChatGPT editor after retries; the page may still be loading.');
  }

  async function clickSend() {
    // Wait a moment for the send button to become enabled
    for (let i = 0; i < 10; i++) {
      const btn = findSendButton();
      if (btn && !btn.disabled) {
        btn.click();
        return;
      }
      await sleep(300);
    }
    throw new Error("Send button not found or disabled");
  }

  async function waitForNewResponse(baseline, requestId, timeout = MAX_WAIT) {
    let lastText = '';
    let stableCount = 0;
    let updates = 0;
    let lastUpdateSource = null;
    let delivery = Promise.resolve();
    let watchError = null;
    function sample(source) {
      checkCancelled();
      const dom = GatewayResponseReader.read();
      const fromNetwork = networkState?.text;
      const domCaughtUp = fromNetwork && dom.text && dom.text.startsWith(fromNetwork) && !dom.streaming;
      const current = fromNetwork && !domCaughtUp
        ? {node:networkState,count:baseline.count+1,text:networkState.text,selector:'response-stream-'+networkState.transport,streaming:!networkState.done}
        : dom;
      const fresh = current.node && !(current.node === baseline.node && current.text === baseline.text);
      if (fresh && current.text && current.text !== lastText) {
        lastText = current.text;
        stableCount = 0;
        updates++;
        lastUpdateSource = source;
        const content = current.text;
        delivery = delivery.then(() => deliver({ type: 'progress', requestId, content, conversationUrl: networkState?.url || window.location.href }))
          .catch(error => { watchError = error; });
      }
      stage('reading_answer', { selector: current.selector, count: current.count,
        characters: current.text.length, updates, lastUpdateSource, hidden:document.hidden, networkCharacters:networkState?.text.length || 0, networkDone:!!networkState?.done, transport:networkState?.transport || null, wireShapes });
      return { ...current, fresh };
    }
    responseSample = source => { try { sample(source); } catch(error) { watchError = error; } };
    const observer = globalThis.MutationObserver ? new MutationObserver(() => {
      try { sample('mutation'); } catch (error) { watchError = error; }
    }) : null;
    observer?.observe(document.documentElement || document.body, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['aria-label', 'data-testid', 'disabled'],
    });
    try {
      sample('initial');
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL);
        if (watchError) throw watchError;
        const previous = lastText;
        const current = sample('poll');
        await delivery;
        if (watchError) throw watchError;
        if (!current.fresh || !current.text) continue;
        if (current.text === previous) stableCount++;
        if (networkState?.done && current.text === networkState.text) return current.text;
        if (!current.streaming && stableCount >= 8) return current.text;
      }
      throw new Error('Timeout: response did not complete; partial text is incomplete');
    } finally {
      responseSample = null;
      observer?.disconnect();
      await delivery;
    }
  }

  // ── Message handler ──────────────────────────────────────

  async function handleChatRequest(msg) {
    try {
      stage('selecting_model');
      // The background prepares a fresh page before dispatching this request.
      // This script must never navigate while processing a turn.
      await selectModel(msg.model);

      // Count AFTER resetting the chat; old message counts cannot identify a new turn.
      const baseline = GatewayResponseReader.read();
      checkCancelled();
      stage('typing_prompt');
      await typeMessage(msg.userMessage);
      stage('sending_prompt');
      await clickSend();
      stage('waiting_for_answer');

      const response = await waitForNewResponse(baseline, msg.requestId, msg.timeout);

      return { ok: true, content: response, conversationUrl: networkState?.url || window.location.href };
    } catch (err) {
      // A timeout is not completion; request that browser generation stop too.
      const stop = document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop"]');
      stop?.click();
      stage('operation_failed', { error: err.message });
      return { ok: false, error: err.message, diagnostics: GatewayResponseReader.inspect() };
    }
  }

  // ── Listen for messages from background script ───────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'tick') {
      if (activeTurn?.id === msg.requestId) {
        for (const waiter of [...sleepers]) if (Date.now() >= waiter.deadline) waiter.finish();
        responseSample?.('worker');
      }
      sendResponse({ok:true});
      return;
    }
    if (msg.type === "ping") {
      sendResponse({ ok: true, url: window.location.href, documentId, activeTurnId: activeTurn?.id || null, composerReady: !!findInput(), diagnostics: GatewayResponseReader.inspect() });
      return;
    }

    if (msg.type === "cancel") {
      if (activeTurn?.id === msg.requestId) {
        activeTurn.cancelled = true;
        for (const waiter of [...sleepers]) waiter.finish();
        const stop = document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop"]');
        stop?.click();
        pendingCancellation = sendResponse;
        return true;
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "chat") {
      if (activeTurn) {
        sendResponse({ ok: false, error: "Browser turn already active" });
        return;
      }
      networkState = null;
      wireShapes = [];
      activeTurn = { id: msg.requestId, cancelled: false, token:msg.requestId+':'+Date.now()+':'+Math.random() };
      window.postMessage?.({source:transportMarker+'-control',type:'arm',token:activeTurn.token,conversationUrl:msg.conversationUrl || null},window.location.origin || 'https://chatgpt.com');
      // Acknowledge receipt immediately. Progress/final results use runtime
      // events, avoiding an asynchronous sendResponse channel for a long turn.
      sendResponse({ accepted: true, requestId: msg.requestId });
      handleChatRequest(msg).then(async result => {
        // Finish all browser work before acknowledging cancellation.
        const cancelled = activeTurn?.cancelled;
        window.postMessage?.({source:transportMarker+'-control',type:'stop',token:activeTurn?.token},window.location.origin || 'https://chatgpt.com');
        activeTurn = null;
        if (cancelled) {
          // Background has already released this request ID; its final-response
          // channel cannot acknowledge another result. ACK the cancellation itself.
          if (pendingCancellation) pendingCancellation({ ok: true });
          pendingCancellation = null;
          stage('cancelled');
          return;
        }
        try {
          await deliver({ type: 'response', requestId: msg.requestId, ...result });
          stage(result.ok ? 'completed' : 'failed', result.ok ? {} : { error: result.error });
        } catch (error) { console.error('Gateway result delivery failed:', error.message); }
        if (pendingCancellation) {
          pendingCancellation({ ok: true });
          pendingCancellation = null;
        }
      }).catch(async error => {
        // Even diagnostic/DOM failures must release the content-script turn.
        // Otherwise every subsequent request is stuck behind an orphan.
        activeTurn = null;
        responseSample = null;
        if (pendingCancellation) { pendingCancellation({ok:true}); pendingCancellation = null; }
        try { await deliver({type:'response',requestId:msg.requestId,ok:false,error:'Browser operation failed: '+error.message}); } catch { /* relay may already be gone */ }
        stage('operation_failed',{error:error.message});
      });
      return;
    }
  });

  console.log("[ChatGPT Gateway] Content script loaded on", window.location.href);
})();
