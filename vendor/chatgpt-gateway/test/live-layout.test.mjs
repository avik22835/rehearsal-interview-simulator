import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Redacted structure captured from the user's live layout. No account data.
const fixture = `<html><body><main>
  <div class="[&_[data-virtualized-turn-content]]:[content-visibility:visible]">
    <div class="group/user-message"><div>User question</div><div class="turn-action-controls"><button aria-label="Copy message"></button></div></div>
    <div class="group flex flex-col">
      <div class="flex flex-col gap-3 browser:gap-1">
        <div class="sr-only">You said: User question. ChatGPT said:</div>
        <div><p>A hash map stores key-value pairs.</p><p>Keys identify values.</p></div>
      </div>
      <div class="turn-action-controls"><button aria-label="Copy"></button><button aria-label="Read aloud"></button></div>
      <div>Is this conversation helpful?</div>
    </div>
  </div>
</main></body></html>`;
function createReader(html = fixture) {
  const { document } = parseHTML(html);
  const context = vm.createContext({ document });
  vm.runInContext(readFileSync(new URL('../response-reader.js', import.meta.url), 'utf8'), context);
  return { reader: context.GatewayResponseReader, document };
}

test('observed layout excludes user text, accessibility transcript, and feedback UI', () => {
  const { reader } = createReader();
  const text = reader.read().text;
  assert.match(text, /A hash map stores key-value pairs\./);
  assert.match(text, /Keys identify values\./);
  assert.doesNotMatch(text, /You said|ChatGPT said|User question|helpful|Read aloud/);
  assert.match(text, /pairs\.\n+Keys/);
});

test('answer can be read incrementally before action buttons mount', () => {
  const { reader, document } = createReader();
  document.querySelector('.group.flex.flex-col .turn-action-controls').remove();
  document.querySelector('.group.flex.flex-col p').textContent = 'A hash';
  assert.match(reader.read().text, /^A hash\n/);
  document.querySelector('.group.flex.flex-col p').textContent = 'A hash map stores key-value pairs.';
  assert.match(reader.read().text, /^A hash map stores key-value pairs/);
});

test('action-based fallback selects only the answer immediately before controls', () => {
  const { reader, document } = createReader();
  document.querySelector('main > div').className = 'unrecognized-wrapper';
  assert.match(reader.read().text, /A hash map stores key-value pairs/);
  assert.doesNotMatch(reader.read().text, /User question|helpful/);
});

test('new live-layout answer wins over old answer matched by a legacy selector', () => {
  const { reader, document } = createReader(`<html><body><main>
    <div data-message-author-role="assistant"><p>Older answer.</p></div>
    <div><div class="group flex flex-col"><div class="flex flex-col"><p>New partial</p></div></div></div>
  </main></body></html>`);
  assert.equal(reader.read().text, 'New partial');
  document.querySelector('.group p').textContent = 'New partial answer grows.';
  assert.equal(reader.read().text, 'New partial answer grows.');
  assert.doesNotMatch(reader.read().text, /Older/);
});
