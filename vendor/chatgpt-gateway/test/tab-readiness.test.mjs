import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../tab-readiness.js', import.meta.url), 'utf8');
function helper(tabs, ping, inject = async () => {}) {
  const context = vm.createContext({ URL, setTimeout, chrome: {
    tabs: { query: async () => [...tabs], sendMessage: ping },
    scripting: { executeScript: inject },
  } });
  vm.runInContext(source, context);
  return context.GatewayTabs;
}

test('prefers active tab and probes without submitting a chat', async () => {
  const probed = [];
  const api = helper([{ id: 1 }, { id: 2, active: true }], async (id, msg) => {
    assert.equal(msg.type, 'ping'); probed.push(id); return { ok: true };
  });
  assert.equal((await api.selectReady()).tab.id, 2);
  assert.deepEqual(probed, [2]);
});

test('restores missing content script, then verifies it before selecting tab', async () => {
  let installed = false;
  const api = helper([{ id: 4 }], async () => {
    if (!installed) throw new Error('Could not establish connection. Receiving end does not exist.');
    return { ok: true };
  }, async options => {
    assert.equal(options.target.tabId, 4);
    assert.equal(options.files.join(','), 'response-reader.js,content.js');
    installed = true;
  });
  assert.equal((await api.selectReady()).tab.id, 4);
  assert.ok(installed);
});

test('skips inaccessible tab and finds another ready tab', async () => {
  const api = helper([{ id: 1, active: true }, { id: 2 }], async id => {
    if (id === 1) throw new Error('Tab closed');
    return { ok: true };
  }, async () => assert.fail('Do not inject for unrelated errors'));
  assert.equal((await api.selectReady()).tab.id, 2);
});

test('all failures report actual number checked and permission guidance', async () => {
  const api = helper([{ id: 1 }, { id: 2 }], async () => {
    throw new Error('Could not establish connection. Receiving end does not exist.');
  }, async () => { throw new Error('Cannot access contents of the page'); });
  await assert.rejects(api.selectReady(), /2 checked.*Allow this extension[\s\S]*Tab 1:[\s\S]*Tab 2:/);
});

test('reports no open ChatGPT tab clearly', async () => {
  await assert.rejects(helper([], async () => {}).selectReady(), /No ChatGPT tab open/);
});

test('saved interview selects its exact chat even when another tab is active', async () => {
  const probed = [];
  const api = helper([{id:1,active:true,url:'https://chatgpt.com/c/other'}, {id:2,url:'https://chatgpt.com/c/original'}],async id=>{
    probed.push(id); return {ok:true,url:'https://chatgpt.com/c/original',composerReady:true};
  });
  assert.equal((await api.selectBound({url:'https://chatgpt.com/c/original'})).tab.id,2);
  assert.deepEqual(probed,[2]);
  assert.equal(api.conversationUrl('https://chatgpt.com/c/original?tracking=1'),'https://chatgpt.com/c/original');
  assert.equal(api.conversationUrl('https://unrelated.example/c/original'),null);
});

test('prepares navigation and waits for a different ready document before dispatch', async () => {
  const actions = [];
  let navigated = false;
  const context = vm.createContext({ URL, setTimeout, Date, chrome: {
    tabs: {
      sendMessage: async (id, msg) => {
        actions.push(msg.type);
        return { ok: true, documentId: navigated ? 'new' : 'old',
          url: navigated ? 'https://chatgpt.com/' : 'https://chatgpt.com/c/old', composerReady: true };
      },
      update: async (id, options) => { actions.push('navigate'); navigated = true; assert.equal(options.url, 'https://chatgpt.com/'); },
      get: async id => ({ id, status: 'complete' }),
    }, scripting: {},
  } });
  vm.runInContext(source, context);
  assert.equal((await context.GatewayTabs.prepareNewChat({ id: 9 })).id, 9);
  assert.deepEqual(actions, ['ping', 'navigate', 'ping']);
});

test('cancellation before navigation does not change the browser page', async () => {
  const api = helper([], async () => ({ ok: true, documentId: 'old' }));
  await assert.rejects(api.prepareNewChat({ id: 1 }, () => false), /cancelled before navigation/);
});

test('reinjecting content script does not register duplicate listeners', () => {
  let listeners = 0;
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() { listeners++; } } } },
    window: { location: { href: 'https://chatgpt.com/' } }, console: { log() {} },
  });
  const content = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  vm.runInContext(content, context);
  vm.runInContext(content, context);
  assert.equal(listeners, 1);
});

test('content script survives editor replacement, ACKs immediately, and delivers the final answer as an event', async () => {
  let listener;
  let sent = false;
  const events = [];
  const initialInput = { offsetParent: {}, contentEditable: 'true', textContent: '', focus() {} };
  const input = { offsetParent: {}, contentEditable: 'true', textContent: '', focus() {} };
  let liveInput = initialInput;
  let editingAttempts = 0;
  const reusedNode = {};
  const context = vm.createContext({
    setTimeout: callback => queueMicrotask(callback),
    chrome: { runtime: {
      onMessage: { addListener(value) { listener = value; } },
      sendMessage: async value => { events.push(value); return { received: true }; },
    } },
    document: {
      querySelector(selector) {
        if (selector.includes('aria-haspopup')) assert.fail('auto must not open arbitrary menus');
        if (selector === '#prompt-textarea') return liveInput;
        if (selector === '[data-testid="send-button"]') return { disabled: false, click() { sent = true; } };
        return null;
      },
      querySelectorAll: () => sent ? [{ textContent: 'A hash map stores key value pairs.' }] : [],
      execCommand(command, unused, value) {
        if (command === 'insertText') {
          editingAttempts++;
          liveInput.textContent = value;
          if (liveInput === initialInput) liveInput = input;
        }
      },
    },
    GatewayResponseReader: {
      // Same wrapper and same count before/after, as with a reused React node.
      read: () => ({ node: reusedNode, count: 1, text: sent ? 'A hash map stores key value pairs.' : '', streaming: false }),
      inspect: () => ({}),
    },
    window: { location: { get href() { return 'https://chatgpt.com/'; }, set href(value) { assert.fail('Content must never navigate'); } } },
    console: { log() {} },
  });
  vm.runInContext(readFileSync(new URL('../content.js', import.meta.url), 'utf8'), context);
  let acknowledgement;
  const result = listener({ type: 'chat', requestId: 'turn', userMessage: 'Explain hash maps', model: 'auto', newConversation: true }, {}, value => { acknowledgement = value; });
  assert.notEqual(result, true);
  assert.equal(acknowledgement.accepted, true);
  await new Promise(resolve => setImmediate(resolve));
  const completed = events.find(event => event.type === 'response');
  assert.equal(completed.ok, true);
  assert.equal(completed.requestId, 'turn');
  assert.equal(completed.content, 'A hash map stores key value pairs.');
  assert.ok(events.some(event => event.type === 'progress'));
  assert.equal(editingAttempts, 2);
});

test('DOM mutations deliver ordered updates before the next polling tick, and cancellation disconnects the observer', async () => {
  let observer;
  let text = '';
  const answerNode = {};
  const events = [];
  const context = vm.createContext({
    setTimeout,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe() { this.connected = true; }
      disconnect() { this.connected = false; }
    },
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage: async event => {
      events.push(event); return { received: true };
    } } },
    document: { documentElement: {} },
    window: { location: { href: 'https://chatgpt.com/' } },
    GatewayResponseReader: { read: () => ({ node: answerNode, text, count: 1, streaming: true }) },
    console: { log() {} },
  });
  const content = readFileSync(new URL('../content.js', import.meta.url), 'utf8').replace(
    '  async function handleChatRequest(msg) {',
    '  globalThis.testWait = waitForNewResponse; globalThis.testCancel = () => { activeTurn = { cancelled: true }; };\n  async function handleChatRequest(msg) {'
  );
  vm.runInContext(content, context);
  const waiting = context.testWait({ node: answerNode, text: '' }, 'observer-test', 2000);
  text = 'First sentence.';
  observer.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, 1, 'Mutation should deliver without waiting 250 ms');
  text = 'First sentence. Second sentence.';
  observer.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events.map(event => event.content), ['First sentence.', 'First sentence. Second sentence.']);
  context.testCancel();
  await assert.rejects(waiting, /cancelled/);
  assert.equal(observer.connected, false);
});
