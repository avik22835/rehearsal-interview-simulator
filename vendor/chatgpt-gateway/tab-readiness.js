// Shared by the background relay and popup. Readiness probes never submit prompts.
globalThis.GatewayTabs = {
  conversationUrl(value) {
    try {
      const url = new URL(value);
      return url.origin === 'https://chatgpt.com' && /^\/c\/[a-zA-Z0-9-]+\/?$/.test(url.pathname)
        ? url.origin + url.pathname.replace(/\/$/, '') : null;
    } catch { return null; }
  },
  async selectBound(binding, stillActive = () => true) {
    const url = this.conversationUrl(binding.url);
    if (!url) {
      // An opening turn can be interrupted before ChatGPT assigns its chat URL.
      // Reuse only its exact document; never choose an unrelated active chat.
      const tab = await chrome.tabs.get(binding.tabId);
      const response = await this.ensureReady(tab);
      if (response.documentId !== binding.documentId) throw new Error('The original interview page changed before its chat URL was saved. Restore the original chat; no new chat was created.');
      return { tab, response };
    }
    const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*'] });
    let tab = tabs.find(item => this.conversationUrl(item.url) === url);
    if (tab) {
      const response = await this.ensureReady(tab);
      if (this.conversationUrl(response.url) !== url) throw new Error('The selected interview tab changed chats during readiness. No prompt was sent.');
      return { tab, response };
    }
    // Return to this interview even when the candidate switched chats or tabs.
    tab = (await this.selectReady()).tab;
    if (!stillActive()) throw new Error('Request cancelled before restoring the interview');
    await chrome.tabs.update(tab.id, { url });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (!stillActive()) throw new Error('Request cancelled while restoring the interview');
      try {
        tab = await chrome.tabs.get(tab.id);
        if (tab.status === 'complete') {
          const response = await this.ensureReady(tab);
          if (this.conversationUrl(response.url) === url && response.composerReady) return { tab, response };
        }
      } catch (error) {
        if (/No tab with id|Invalid tab ID/i.test(error.message || '')) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('The saved interview chat could not be restored. Check whether it is available in your ChatGPT account.');
  },
  async prepareNewChat(tab, stillActive = () => true) {
    // Navigate from the background BEFORE opening any content-script request.
    // A navigation from inside a long-lived message destroys its own receiver.
    const previous = await this.ensureReady(tab);
    if (!stillActive()) throw new Error('Request cancelled before navigation');
    await chrome.tabs.update(tab.id, { url: 'https://chatgpt.com/' });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (!stillActive()) throw new Error('Request cancelled while loading ChatGPT');
      try {
        const current = await chrome.tabs.get(tab.id);
        if (current.status === 'complete') {
          const ready = await this.ensureReady(current);
          // Do not mistake the old document for the new page after tabs.update.
          if (ready.documentId && ready.documentId !== previous.documentId && ready.composerReady &&
              new URL(ready.url).pathname === '/') return current;
        }
      } catch (error) {
        if (/No tab with id|Invalid tab ID/i.test(error.message || '')) throw error;
        // Navigation can briefly remove the receiver; wait for the new document.
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('ChatGPT page did not become ready within 30 seconds. Check sign-in or any page loading error.');
  },
  async ensureReady(tab) {
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: 'ping' });
    } catch (error) {
      if (!/Receiving end does not exist|Could not establish connection/i.test(error.message || '')) throw error;
      // Tabs opened before extension install/reload may have no content script.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['response-reader.js', 'content.js'] });
      response = await chrome.tabs.sendMessage(tab.id, { type: 'ping' });
    }
    if (!response?.ok) throw new Error('Content script did not acknowledge readiness');
    return response;
  },
  async selectReady() {
    const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
    if (!tabs.length) throw new Error('No ChatGPT tab open. Open chatgpt.com and sign in.');
    tabs.sort((a, b) => Number(!!b.active) - Number(!!a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
    const errors = [];
    for (const tab of tabs) {
      try { return { tab, response: await this.ensureReady(tab) }; }
      catch (error) { errors.push(`Tab ${tab.id}: ${error.message}`); }
    }
    throw new Error(`No ready ChatGPT tab (${tabs.length} checked). Allow this extension on chatgpt.com, then refresh the tab.\n${errors.join('\n')}`);
  },
};
