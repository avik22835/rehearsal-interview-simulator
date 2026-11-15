import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../response-reader.js', import.meta.url), 'utf8');
const node = (text, user = false, markdown = []) => ({
  innerText: text, textContent: text,
  closest: () => user ? {} : null,
  querySelector: () => markdown.length ? markdown[0] : null,
  querySelectorAll: () => markdown,
});
function reader(map, streaming = false) {
  const context = vm.createContext({ document: {
    querySelectorAll: selector => map[selector] || [],
    querySelector: () => streaming ? {} : null,
  } });
  vm.runInContext(source, context);
  return context.GatewayResponseReader;
}

test('reads assistant markdown without surrounding controls', () => {
  const api = reader({ '[data-message-author-role="assistant"]': [node('Answer Copy Share', false, [node('Answer')])] });
  assert.equal(api.read().text, 'Answer');
});

test('falls back when author role markers are absent', () => {
  const api = reader({ 'main .markdown': [node('Old answer'), node('New answer')] });
  assert.equal(api.read().text, 'New answer');
  assert.equal(api.inspect().selector, 'main .markdown');
});

test('does not return user content as an assistant answer', () => {
  const api = reader({ 'main .markdown': [node('Private user prompt', true)] });
  assert.equal(api.read().text, '');
  assert.equal(api.inspect().assistantCount, 0);
});

test('preserves paragraphs and exposes diagnostics without answer text', () => {
  const api = reader({ '[data-turn="assistant"]': [node('First sentence.\n\nSecond sentence.')] }, true);
  assert.equal(api.read().text, 'First sentence.\n\nSecond sentence.');
  assert.equal(api.inspect().streaming, true);
  assert.equal(api.inspect().answerCharacters, 33);
  assert.equal(api.inspect().text, undefined);
});

test('reads current virtualized answer blocks without legacy author or markdown markers', () => {
  const prompt = node('User question', true);
  const answer = node('The actual answer.');
  const api = reader({ 'main [data-virtualized-turn-content]': [prompt, answer] });
  assert.equal(api.read().text, 'The actual answer.');
  assert.equal(api.read().count, 1);
});

test('observed action-control layout returns answer sibling rather than action labels', () => {
  const answer = { ...node('Gateway response received.'),
    classList: { contains: () => false }, contains: () => false };
  const controls = { classList: { contains: name => name === 'turn-action-controls' },
    closest: () => null, previousElementSibling: answer };
  const group = { classList: { contains: name => name === 'group' }, children: [answer, controls], closest: () => null };
  controls.parentElement = group;
  const api = reader({ 'main .turn-action-controls': [controls] });
  assert.equal(api.read().text, 'Gateway response received.');
});
