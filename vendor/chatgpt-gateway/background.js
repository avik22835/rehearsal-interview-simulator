// ChatGPT Gateway — Background service worker
// Connects to local gateway server via WebSocket
"use strict";

if (!globalThis.GatewayTabs) importScripts('tab-readiness.js');

const GATEWAY_URL = "ws://127.0.0.1:18790/ws";
let ws = null;
let reconnectTimer = null;
let activeTab = null;
let activeRequest = null;
let lastFailure = null;
let tabLease = null;
function restoreTabLease() {
  const lease = tabLease; tabLease = null;
  if (lease?.restore) chrome.tabs.update(lease.id, {autoDiscardable:true}).catch(() => {});
}
async function keepTabAvailable(tab) {
  tabLease = {id:tab.id,restore:tab.autoDiscardable !== false};
  try { await chrome.tabs.update(tab.id,{autoDiscardable:false}); } catch { /* optional browser capability */ }
}
// Worker timers are independent of the ChatGPT page's hidden-tab timer budget.
setInterval(() => {
  if (activeRequest && activeTab !== null) chrome.tabs.sendMessage(activeTab, {type:'tick',requestId:activeRequest}).catch(() => {});
}, 500);

function log(...args) {
  console.log("[Gateway BG]", ...args);
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  try {
    ws = new WebSocket(GATEWAY_URL);
  } catch (err) {
    log("WebSocket constructor failed:", err.message);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    log("Connected to gateway server");
    sendToServer({ type: 'hello', version: chrome.runtime.getManifest().version, protocol: 4 });
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      log("Invalid JSON from server");
      return;
    }

    if (msg.type === 'inspect') {
      try {
        const { tab, response } = await GatewayTabs.selectReady();
        sendToServer({ type: 'inspection', requestId: msg.requestId, ok: true, data: {
          extensionVersion: chrome.runtime.getManifest().version,
          tabId: tab.id, activeTab, activeRequest, documentId: response.documentId,
          diagnostics: response.diagnostics, lastFailure,
        } });
      } catch (error) {
        sendToServer({ type: 'inspection', requestId: msg.requestId, ok: false, error: error.message });
      }
      return;
    }
    if (msg.type === "cancel") {
      if (activeTab !== null && activeRequest === msg.requestId) {
        const tabToCancel = activeTab;
        activeRequest = null;
        activeTab = null;
        try {
          await chrome.tabs.sendMessage(tabToCancel, { type: "cancel", requestId: msg.requestId });
          restoreTabLease();
          sendToServer({ type: "cancelled", requestId: msg.requestId });
        } catch {
          // No acknowledgement: server keeps the relay unavailable until reconnect.
        }
      } else {
        if (activeRequest === msg.requestId) activeRequest = null;
        sendToServer({ type: "cancelled", requestId: msg.requestId });
      }
      return;
    }
    if (msg.type === "chat") {
      await handleChatMessage(msg);
    }
  };

  ws.onclose = () => {
    restoreTabLease();
    if (activeTab !== null) {
      chrome.tabs.sendMessage(activeTab, { type: "cancel", requestId: activeRequest }).catch(() => {});
    }
    activeRequest = null;
    activeTab = null;
    log("Disconnected from gateway server");
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after this
    ws?.close();
  };
}

function scheduleReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setInterval(connect, 5000);
  }
}

function sendToServer(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

async function handleChatMessage(msg) {
  const lastUser = [...(msg.messages || [])].reverse().find(m => m.role === "user");
  activeRequest = msg.requestId;
  try {
    if (!lastUser?.content) throw new Error("No user message in request");
    let { tab } = msg.conversationBinding
      ? await GatewayTabs.selectBound(msg.conversationBinding, () => activeRequest === msg.requestId)
      : await GatewayTabs.selectReady();
    // Cancellation or disconnect during readiness must not submit a late prompt.
    if (activeRequest !== msg.requestId) return;
    activeTab = tab.id;
    await keepTabAvailable(tab);
    if (!msg.conversationBinding && msg.newConversation !== false) {
      log('Preparing a fresh ChatGPT page', tab.id);
      tab = await GatewayTabs.prepareNewChat(tab, () => activeRequest === msg.requestId);
    }
    if (activeRequest !== msg.requestId) return;
    let ready = await GatewayTabs.ensureReady(tab);
    if (ready.activeTurnId && ready.activeTurnId !== msg.requestId) {
      // A previous relay disconnect may have left the page holding a stale turn.
      await Promise.race([
        chrome.tabs.sendMessage(tab.id,{type:'cancel',requestId:ready.activeTurnId}),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('The previous browser turn could not be stopped. Refresh this ChatGPT tab once.')),5000)),
      ]);
      ready = await GatewayTabs.ensureReady(tab);
      if (ready.activeTurnId) throw new Error('The previous browser turn is still stopping; no new prompt was submitted.');
    }
    if (msg.conversationBinding?.url && GatewayTabs.conversationUrl(ready.url) !== msg.conversationBinding.url) throw new Error('The interview tab changed to another chat before submission. No prompt was sent.');
    sendToServer({ type: 'conversation', requestId: msg.requestId, binding: {
      tabId: tab.id, documentId: ready.documentId, url: GatewayTabs.conversationUrl(ready.url),
    } });
    log("Using ready ChatGPT tab", tab.id);
    // Once dispatched, never retry another tab: delivery could be ambiguous.
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "chat", requestId: msg.requestId, timeout: msg.timeout,
      model: msg.model, userMessage: lastUser.content,
      conversationUrl: msg.conversationBinding?.url || null,
      newConversation: msg.newConversation !== false,
    });
    if (!response?.accepted) throw new Error(response?.error || 'ChatGPT content script did not acknowledge the request. Reload the extension and refresh the tab.');
    // The final result arrives as a runtime message; do not hold sendMessage
    // open across generation or clear the active turn after this short ACK.
  } catch (err) {
    if (activeRequest === msg.requestId) {
      sendToServer({ type: "response", requestId: msg.requestId, ok: false, error: err.message });
      restoreTabLease();
      activeTab = null; activeRequest = null;
    }
  }
}

// Connect on startup
connect();

// Reconnect on service worker events
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);

// Keep service worker alive with periodic alarm
chrome.alarms.create("keepAlive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepAlive") {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connect();
    }
  }
});

log("Service worker started");

// Forward snapshots only from the selected tab and current turn.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if ((msg.type === "progress" || msg.type === "response") && sender.tab?.id === activeTab && msg.requestId === activeRequest) {
    if (msg.type === 'response' && !msg.ok) lastFailure = msg.diagnostics || { error: msg.error };
    sendToServer({ ...msg, conversationUrl: GatewayTabs.conversationUrl(msg.conversationUrl || sender.tab?.url) });
    sendResponse({ received: true });
    if (msg.type === 'response') { restoreTabLease(); activeTab = null; activeRequest = null; }
  }
});
