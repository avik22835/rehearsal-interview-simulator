// DOM-only reader shared by interview polling and local diagnostics.
// No browser/API credentials or page network traffic are accessed here.
globalThis.GatewayResponseReader = {
  candidates() {
    const collected = [];
    const add = (node, selector) => {
      if (!collected.some(entry => entry.node === node)) collected.push({ node, selector });
    };
    const strategies = [
      '[data-message-author-role="assistant"]',
      '[data-turn="assistant"]',
      'article[data-testid^="conversation-turn-"]',
      'main [data-virtualized-turn-content]',
      'main [class*="data-virtualized-turn-content"] [class~="group"][class~="flex-col"] > div:first-child',
      'main [class~="group"][class~="flex-col"] > [class~="flex-col"]:first-child',
      'main .markdown',
    ];
    for (const selector of strategies) {
      const nodes = [...document.querySelectorAll(selector)].filter(node => {
        if (node.closest('[data-message-author-role="user"], [data-turn="user"], form, nav, aside')) return false;
        if (selector === 'main [data-virtualized-turn-content]' &&
            (node.closest('[class~="group/user-message"]') || node.querySelector('[class~="group/user-message"]'))) return false;
        // Generic turn wrappers include user turns; accept only rendered answer
        // content, never the entire article (which includes action buttons).
        if (selector.startsWith('article') && (!node.querySelector('.markdown') ||
            (node.querySelector('[data-message-author-role="user"], [data-turn="user"]') &&
             !node.querySelector('[data-message-author-role="assistant"], [data-turn="assistant"]')))) return false;
        return true;
      });
      for (const node of nodes) add(node, selector);
    }
    // Observed current ChatGPT layout: answer content and .turn-action-controls
    // are siblings inside a literal .group container. User bubbles instead use
    // group/user-message. Read only the answer sibling, excluding action labels.
    const answerNodes = [];
    for (const controls of document.querySelectorAll('main .turn-action-controls')) {
      if (controls.closest('[class~="group/user-message"]')) continue;
      const group = controls.parentElement;
      if (!group?.classList.contains('group')) continue;
      const body = controls.previousElementSibling;
      if (body && !answerNodes.includes(body)) answerNodes.push(body);
    }
    for (const node of answerNodes) add(node, 'main .turn-action-controls -> answer sibling');
    // A stronger selector can match an older turn while a new, streaming turn
    // uses a different wrapper. Never stop at the first non-empty strategy.
    collected.sort((a, b) => {
      const position = a.node.compareDocumentPosition?.(b.node) || 0;
      return position & 4 ? -1 : position & 2 ? 1 : 0;
    });
    return { selector: collected[collected.length - 1]?.selector || null,
      nodes: collected.map(entry => entry.node) };
  },
  read() {
    const { selector, nodes } = this.candidates();
    const node = nodes[nodes.length - 1];
    if (!node) return { selector, node: null, count: 0, text: '', streaming: this.streaming() };
    const markdown = [...node.querySelectorAll('.markdown')];
    const parts = markdown.length ? markdown : [node];
    const text = parts.map(part => {
      // innerText retains paragraph boundaries; cloning lets us strip hidden
      // math duplicates without touching the actual ChatGPT document.
      if (!part.cloneNode) return (part.innerText || part.textContent || '').trim();
      const copy = part.cloneNode(true);
      copy.querySelectorAll('.katex-mathml, button, [aria-hidden="true"], .sr-only, .screen-reader-only, [class~="group/user-message"], .turn-action-controls').forEach(item => item.remove());
      // Detached innerText is inconsistent across browsers. Walk block tags to
      // retain spoken paragraph boundaries after removing hidden/UI content.
      const block = /^(P|DIV|LI|PRE|H[1-6]|SECTION|ARTICLE|BLOCKQUOTE|TR)$/;
      function plain(node) {
        if (node.nodeType === 3) return node.nodeValue || '';
        if (node.tagName === 'BR') return '\n';
        const value = [...node.childNodes].map(plain).join('');
        return block.test(node.tagName || '') ? `\n${value}\n` : value;
      }
      return plain(copy).replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n').trim();
    }).filter(Boolean).join('\n\n').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    return { selector, node, count: nodes.length, text, streaming: this.streaming() };
  },
  streaming() {
    return !!document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop" i]');
  },
  inspect() {
    const value = this.read();
    const attributes = node => ({
      tag: node.tagName || null, id: node.id || null,
      role: node.getAttribute('role'), testId: node.getAttribute('data-testid'),
      label: node.getAttribute('aria-label'), type: node.getAttribute('type'),
      editable: node.getAttribute('contenteditable'), isContentEditable: !!node.isContentEditable,
      disabled: !!node.disabled, ariaDisabled: node.getAttribute('aria-disabled'),
      visible: !!(node.getClientRects?.().length), connected: !!node.isConnected,
      textCharacters: (typeof node.value === 'string' ? node.value : node.innerText || node.textContent || '').length,
    });
    const describe = node => ({
      ...attributes(node), classes: typeof node.className === 'string' ? node.className.slice(0, 700) : null,
      children: [...(node.children || [])].slice(0, 12).map(child => ({
        tag: child.tagName, role: child.getAttribute('role'), testId: child.getAttribute('data-testid'),
        classes: typeof child.className === 'string' ? child.className.slice(0, 350) : null,
        textCharacters: (child.innerText || child.textContent || '').length,
      })),
    });
    const roots = [...document.querySelectorAll('article, [role="article"], main, [role="main"], .markdown, [class*="markdown"], [data-message-id], [data-testid*="conversation"], [data-testid*="message"]')].slice(-30).map(describe);
    const answerActions = [...document.querySelectorAll('button')].filter(node =>
      /copy|read aloud|good response|bad response/i.test(node.getAttribute('aria-label') || '')
    ).slice(-8).map(button => {
      const ancestors = [];
      let current = button.parentElement;
      for (let level = 0; current && level < 6; level++, current = current.parentElement) ancestors.push(describe(current));
      return { action: button.getAttribute('aria-label'), ancestors };
    });
    return {
      diagnosticVersion: 3, documentReadyState: document.readyState || null,
      selector: value.selector, assistantCount: value.count, answerCharacters: value.text.length,
      streaming: value.streaming,
      roleMarkers: document.querySelectorAll('[data-message-author-role="assistant"]').length,
      markdownBlocks: document.querySelectorAll('main .markdown').length,
      stage: globalThis.__interviewGatewayDiagnostics || null,
      responseStructure: roots, answerActions,
      // Attributes and lengths only. Never capture draft text, HTML, cookies,
      // account data, or unrelated page content in diagnostics.
      composers: [...document.querySelectorAll('#prompt-textarea, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')].slice(0, 12).map(attributes),
      buttons: [...document.querySelectorAll('button')].filter(node =>
        node.closest('form, [data-type="unified-composer"]') ||
        /send|submit|stop|voice/i.test(`${node.id} ${node.getAttribute('data-testid')} ${node.getAttribute('aria-label')}`)
      ).slice(0, 30).map(attributes),
    };
  },
};
