import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const { createAgentDetailsUI } = require('../native/agent-details-ui.cjs');
const { validateSecurePreview } = require('../native/secure-settings.cjs');
const LIMIT = 262144;
const privateMarker = 'SYNTHETIC_MEMORY_OR_PATH_MUST_NOT_ESCAPE';
const png = readFileSync(new URL('../public/app-icon/64.png', import.meta.url));
const preview = { dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: 64, height: 64, alt: '合成头像' };
type Values = Record<string, unknown>;
type Guard = () => void;
type Field = { key: string; type: string; label: string; value: string };
type Spec = { title: string; description: string; fields: Field[]; review?: boolean; submitLabel?: string; preview?: typeof preview };
type Edit = (spec: Spec, guard: Guard, validate: (value: unknown) => unknown) => Promise<unknown>;
function fixture(content = '合成记忆\n') {
  const specs: Spec[] = [], actions: Values[] = [], prompts: Values[] = [];
  let valid = true;
  const loaded = { revision: 'memory-ticket', botId: 'bot-one', runnerId: 'runner-one', text: content, hash: 'a'.repeat(32), truncated: false, path: `/synthetic/${privateMarker}` };
  const guard = () => { if (!valid) throw new Error('智能体所属账号、连接或选择已变化，请重新打开详情'); };
  const details = {
    getMemory: async (value: Values, trusted: Guard) => { assert.deepEqual(value, { revision: 'profile-ticket' }); trusted(); return loaded; },
    check: (revision: string, trusted: Guard) => { assert.equal(revision, 'memory-ticket'); trusted(); guard(); },
    apply: async (value: Values, trusted: Guard): Promise<Values> => { trusted(); actions.push(value); return { status: 'applied', botId: 'bot-one', text: privateMarker, path: loaded.path }; },
  };
  const editor: { edit: Edit } = { edit: async (spec, trusted) => { specs.push(spec); trusted(); return null; } };
  const parent = { isDestroyed: () => false };
  const dialog = { showMessageBox: async (_parent: unknown, spec: Values) => { prompts.push(spec); return { response: 1 }; } };
  const ui = createAgentDetailsUI({ secureSettings: editor, dialog, getParent: () => parent, getDetails: () => details });
  return { ui, details, editor, dialog, parent, specs, actions, prompts, loaded, guard, invalidate: () => { valid = false; } };
}

test('memory host displays the complete 256 KiB only in the isolated editor and returns a minimal outcome', async () => {
  const original = `${privateMarker}${'x'.repeat(LIMIT - privateMarker.length - 9)}OLD_END!!`;
  const updated = `${'y'.repeat(LIMIT - 9)}NEW_END!!`;
  const f = fixture(original); f.loaded.truncated = true;
  f.editor.edit = async (spec, guard, validate) => {
    assert.equal(f.ui.isActive(), true); guard(); f.specs.push(spec);
    assert.equal(spec.fields[0].type, 'memory'); assert.equal(spec.fields[0].value, original);
    assert.match(spec.description, /完整正文/); assert.equal(JSON.stringify(spec).includes(f.loaded.path), false);
    return validate({ memory: updated });
  };
  assert.deepEqual(await f.ui.openMemory('profile-ticket', f.guard), { status: 'applied', botId: 'bot-one' });
  assert.deepEqual(f.actions, [{ kind: 'memory.save', revision: 'memory-ticket', text: updated, expectedHash: 'a'.repeat(32) }]);
  assert.equal(f.ui.isActive(), false);
});

test('unchanged browser-normalized memory preserves original CRLF bytes and explicit empty text remains editable', async () => {
  for (const [original, typed, expected] of [['one\r\ntwo\r\n', 'one\ntwo\n', 'one\r\ntwo\r\n'], ['one\n', '', '']]) {
    const f = fixture(original);
    f.editor.edit = async (_spec, _guard, validate) => validate({ memory: typed });
    await f.ui.openMemory('profile-ticket'); assert.equal(f.actions[0].text, expected);
  }
});

test('memory cancel, malformed input, UTF-8 overflow and isolated-surrogate text never apply', async () => {
  const cancelled = fixture();
  assert.deepEqual(await cancelled.ui.openMemory('profile-ticket'), { status: 'cancelled', botId: 'bot-one' });
  assert.deepEqual(cancelled.actions, []);
  for (const value of [{ memory: 'valid', revision: 'forged' }, {}, { memory: '字'.repeat(100000) }, { memory: 'bad\0text' }, { memory: '\ud800' }]) {
    const f = fixture(); f.editor.edit = async (_spec, _guard, validate) => validate(value);
    await assert.rejects(f.ui.openMemory('profile-ticket'));
    assert.deepEqual(f.actions, []); assert.equal(f.ui.isActive(), false);
  }
});

test('memory checks scope while open, rejects duplicate opens and does not disclose arbitrary errors', async () => {
  const f = fixture(); let resolve: (value: unknown) => void = () => {}; let activeGuard: Guard = () => {};
  f.editor.edit = async (_spec, guard) => { activeGuard = guard; return new Promise(done => { resolve = done; }); };
  const pending = f.ui.openMemory('profile-ticket'); await new Promise(setImmediate);
  await assert.rejects(f.ui.openMemory('profile-ticket'), /已有记忆/);
  f.invalidate(); assert.throws(activeGuard, /账号、连接/); resolve(null);
  await assert.rejects(pending, /账号、连接/); assert.deepEqual(f.actions, []);
  const bad = fixture(); bad.details.getMemory = async () => { throw new Error(privateMarker); };
  await assert.rejects(bad.ui.openMemory('profile-ticket'), error => error instanceof Error && !error.message.includes(privateMarker));
});

test('memory unknown outcomes stay unknown without automatic replay or returning content', async () => {
  const f = fixture(privateMarker); f.editor.edit = async (_spec, _guard, validate) => validate({ memory: 'changed' });
  f.details.apply = async action => { f.actions.push(action); return { status: 'unknownOutcome', botId: 'bot-one', text: privateMarker }; };
  assert.deepEqual(await f.ui.openMemory('profile-ticket'), { status: 'unknownOutcome', botId: 'bot-one' });
  assert.equal(f.actions.length, 1);
});

test('large confirmation reviews every character before a cancellation-default OS prompt', async () => {
  const f = fixture(); const detail = `${'a'.repeat(LIMIT)}OLD_END\n${'b'.repeat(LIMIT)}NEW_END`;
  f.editor.edit = async (spec, guard, validate) => { guard(); f.specs.push(spec); assert.equal(spec.review, true); assert.equal(spec.fields[0].value, detail); return validate({}); };
  assert.equal(await f.ui.confirm({ title: '确认', message: '保存智能体？', detail }, f.guard), true);
  assert.equal(f.prompts.length, 1); assert.equal(f.prompts[0].defaultId, 0); assert.equal(f.prompts[0].cancelId, 0);
  assert.deepEqual(f.prompts[0].buttons, ['取消', '应用变更']); assert.match(String(f.prompts[0].detail), /执行刚才复核的完整变更范围/);
  assert.equal(String(f.prompts[0].detail).includes('OLD_END'), false);
  const cancel = fixture(); assert.equal(await cancel.ui.confirm({ title: '确认', message: '保存？', detail }, cancel.guard), false);
  assert.deepEqual(cancel.prompts, []);
});

test('confirmation fences scope after review and after native consent without echoing sensitive input', async () => {
  const f = fixture(); f.editor.edit = async (_spec, _guard, validate) => { f.invalidate(); return validate({}); };
  await assert.rejects(f.ui.confirm({ title: '确认', message: '保存？', detail: 'x'.repeat(3000) }, f.guard));
  assert.deepEqual(f.prompts, []);
  const changed = fixture(); changed.dialog.showMessageBox = async () => { changed.invalidate(); return { response: 1 }; };
  await assert.rejects(changed.ui.confirm({ title: '确认', message: '保存？', detail: 'short' }, changed.guard));
  assert.equal(changed.ui.isActive(), false);
});

test('avatar review admits only the exact bounded PNG and requires explicit isolated acceptance', async () => {
  const spec = { title: '更换智能体头像', botId: 'bot-one', botName: '合成智能体', previewDataUrl: preview.dataUrl, width: 64, height: 64, size: png.length };
  const f = fixture(); f.editor.edit = async (value, guard, validate) => { guard(); f.specs.push(value); assert.equal(value.preview?.dataUrl, preview.dataUrl); assert.deepEqual(value.fields, []); assert.throws(() => validate({ source: '/synthetic/private' })); return validate({}); };
  assert.equal(await f.ui.reviewAvatar(spec, f.guard), true); assert.deepEqual(f.prompts, []);
  assert.equal(await fixture().ui.reviewAvatar(spec, () => {}), false);
  for (const patch of [{ previewDataUrl: 'https://example.invalid/photo.png' }, { previewDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' }, { width: 512 }, { size: png.length + 1 }, { previewDataUrl: 'data:image/png;base64,AA==' }]) await assert.rejects(f.ui.reviewAvatar({ ...spec, ...patch }, f.guard));
  assert.equal(validateSecurePreview(preview).dataUrl, preview.dataUrl);
});

class Element {
  children: Element[] = [];
  handlers = new Map<string, (event: { preventDefault(): void }) => unknown>();
  value = ''; textContent = ''; maxLength = -1; readOnly = false; disabled = true; src = ''; removed = false;
  id = ''; name = ''; autocomplete = ''; spellcheck = false; type = ''; htmlFor = ''; className = ''; alt = ''; width = 0; height = 0;
  constructor(readonly tagName: string) {}
  addEventListener(name: string, handler: (event: { preventDefault(): void }) => unknown) { this.handlers.set(name, handler); }
  append(...elements: Element[]) { this.children.push(...elements); }
  focus() {}
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
  remove() { this.removed = true; }
}
async function renderEditor(spec: Spec) {
  const nodes = new Map(['editor', 'fields', 'error', 'submit', 'cancel', 'title', 'description'].map(id => [`#${id}`, new Element(id === 'editor' ? 'FORM' : 'DIV')]));
  const windowEvents = new Map<string, () => void>();
  runInNewContext(readFileSync(new URL('../native/secure-editor.js', import.meta.url), 'utf8'), {
    document: { querySelector: (key: string) => nodes.get(key), createElement: (tag: string) => new Element(tag.toUpperCase()) },
    window: { addEventListener: (name: string, action: () => void) => windowEvents.set(name, action), dotsSecureSettings: { initialize: async () => spec, cancel: async () => {}, submit: async () => ({ ok: true }) } },
  });
  await new Promise(setImmediate);
  return { nodes, windowEvents };
}

test('secure renderer uses a full memory textarea, unlimited readonly review and wipes the preview on close', async () => {
  const review = `${'x'.repeat(530000)}REVIEW_END`;
  const f = await renderEditor({ title: 'Synthetic', description: '<img src=bad>', preview, fields: [{ key: 'memory', type: 'memory', label: '正文', value: 'Full memory\r\n' }, { key: 'review', type: 'review', label: '复核', value: review }] });
  const fields = f.nodes.get('#fields')!.children;
  const memory = fields.find(element => element.id === 'memory')!, readOnly = fields.find(element => element.id === 'review')!, image = fields.find(element => element.tagName === 'IMG')!;
  assert.equal(memory.tagName, 'TEXTAREA'); assert.equal(memory.maxLength, LIMIT); assert.equal(memory.readOnly, false);
  assert.equal(readOnly.value, review); assert.equal(readOnly.maxLength, -1); assert.equal(readOnly.readOnly, true);
  assert.equal(f.nodes.get('#description')!.textContent, '<img src=bad>'); assert.equal(image.src, preview.dataUrl);
  f.windowEvents.get('pagehide')!(); assert.equal(memory.value, ''); assert.equal(readOnly.value, ''); assert.equal(image.src, ''); assert.equal(image.removed, true);
});
