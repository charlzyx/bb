import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
const source = await readFile(new URL('../native/preload.cjs', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve: (value: unknown) => void = () => {}; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
type Imported = { scope: string; attachments: { id: string; previewUrl?: string }[]; duplicates: number; error?: string };
type API = { setAttachmentScope: (scope: string | null) => Promise<void>; onAttachmentImport: (listener: (value: Imported) => void) => () => void; onAttachmentText: (listener: (text: string) => void) => () => void; pickAttachments: () => Promise<unknown>; releaseAttachments: (ids: string[]) => Promise<unknown>; sendAttachments: (value: unknown) => Promise<unknown> };
class Target {
  enabled = true;
  inside = true;
  closest(selector: string) { if (selector === '[data-attachment-composer]') return this.inside ? this : null; return this.enabled ? null : this; }
  getAttribute() { return this.enabled ? null : 'true'; }
}
async function fixture() {
  const listeners = new Map<string, ((event?: unknown) => void)[]>();
  const calls: { channel: string; args: unknown[] }[] = [];
  const paths = new WeakMap<File, string>();
  const revoked: string[] = [], blobs: Blob[] = [];
  const imports: Imported[] = [], texts: string[] = [];
  const id = 'b'.repeat(32), ticket = 'a'.repeat(64);
  let api: API | undefined;
  let handler = async (channel: string, _args: unknown[]): Promise<unknown> => channel === 'lorca:set-attachment-scope' ? { ticket } : channel === 'lorca:import-attachments' || channel === 'lorca:pick-attachments' ? { attachments: [{ id, name: 'image.png', size: 3, mime: 'image/png', previewMime: 'image/png', previewBytes: new Uint8Array([1, 2, 3]) }], duplicates: 0 } : null;
  const window = { addEventListener: (name: string, callback: (event?: unknown) => void) => { const current = listeners.get(name) ?? []; current.push(callback); listeners.set(name, current); } };
  runInNewContext(source, {
    window, process: { platform: 'linux' }, document: { documentElement: { dataset: {} } }, Element: Target, File, Blob, Uint8Array,
    URL: { createObjectURL: (blob: Blob) => { blobs.push(blob); return `blob:synthetic-${blobs.length}`; }, revokeObjectURL: (value: string) => revoked.push(value) },
    require: (name: string) => { assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld: (_name: string, value: API) => { api = value; } }, ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => { calls.push({ channel, args }); return handler(channel, args); } }, webUtils: { getPathForFile: (file: File) => { assert.ok(file instanceof File); return paths.get(file) ?? ''; } } }; },
  });
  for (const listener of listeners.get('DOMContentLoaded') ?? []) listener();
  assert.ok(api); const exposed = api;
  exposed.onAttachmentImport(value => imports.push(value)); exposed.onAttachmentText(text => texts.push(text));
  const emit = (type: 'paste' | 'drop' | 'dragover', options: { files?: File[]; text?: string; trusted?: boolean; target?: Target } = {}) => {
    const transfer = { files: options.files ?? [], types: options.files?.length ? ['Files', 'text/plain'] : ['text/plain'], getData: (kind: string) => kind === 'text/plain' ? options.text ?? '' : '', dropEffect: 'none' };
    const event = { type, isTrusted: options.trusted ?? true, target: options.target ?? new Target(), clipboardData: transfer, dataTransfer: transfer, prevented: false, preventDefault() { this.prevented = true; } };
    for (const listener of listeners.get(type) ?? []) listener(event);
    return event;
  };
  return { api: exposed, calls, paths, revoked, blobs, imports, texts, id, ticket, emit, listeners, setHandler: (next: typeof handler) => { handler = next; } };
}

test('preload exposes only scope and subscriptions, never native tickets or path/byte import methods', async () => {
  const f = await fixture();
  const scope = JSON.stringify(['ws://127.0.0.1:4862/ws', 'token', 1, 0, 1]);
  assert.equal(await f.api.setAttachmentScope(scope), undefined);
  assert.equal(Object.keys(f.api).some(key => /path|stage|ticket|bytes/i.test(key)), false);
  const file = new File(['abc'], 'image.png', { type: 'image/png', lastModified: 1000 }); f.paths.set(file, '/synthetic/image.png');
  f.emit('drop', { files: [file] }); await tick();
  const call = f.calls.find(item => item.channel === 'lorca:import-attachments'); assert.ok(call);
  assert.equal(call.args[0], scope); assert.equal(call.args[1], f.ticket);
  assert.equal(JSON.stringify(f.imports).includes('/synthetic'), false); assert.equal(JSON.stringify(f.imports).includes(f.ticket), false);
  assert.equal(f.imports[0].attachments[0].previewUrl, 'blob:synthetic-1');
  assert.equal(JSON.stringify(f.imports).includes('previewBytes'), false);
});

test('ordinary text paste is untouched, mixed paste inserts text once synchronously and never sends', async () => {
  const f = await fixture(); await f.api.setAttachmentScope('draft');
  const text = f.emit('paste', { text: 'ordinary' }); assert.equal(text.prevented, false); assert.deepEqual(f.texts, []);
  const mixed = f.emit('paste', { files: [new File(['abc'], 'image.png')], text: 'mixed text' });
  assert.equal(mixed.prevented, true); assert.deepEqual(f.texts, ['mixed text']); assert.equal(f.imports.length, 0);
  await tick(); assert.equal(f.imports.length, 1); assert.deepEqual(f.texts, ['mixed text']);
  assert.equal(f.calls.some(item => item.channel === 'lorca:send-attachments' || item.channel === 'lorca:request'), false);
});

test('mixed paste over the text limit reports a content-free error without importing files or inserting text', async () => {
  const f = await fixture(); await f.api.setAttachmentScope('draft');
  const marker = 'SYNTHETIC_PRIVATE_PASTE';
  const text = marker.padEnd(200_001, 'x');
  const event = f.emit('paste', { files: [new File(['abc'], 'image.png')], text });
  assert.equal(event.prevented, true);
  assert.deepEqual(f.texts, []);
  assert.equal(f.imports.length, 1);
  assert.equal(f.imports[0].scope, 'draft');
  assert.equal(f.imports[0].attachments.length, 0);
  assert.equal(f.imports[0].duplicates, 0);
  assert.equal(f.imports[0].error, '混合粘贴的文字超过 200,000 字符，本次文字和附件均未添加；请缩短文字或分开粘贴');
  assert.equal(JSON.stringify(f.imports).includes(marker), false);
  await tick();
  assert.deepEqual(f.calls.map(call => call.channel), ['lorca:set-attachment-scope']);
  assert.equal(f.imports.length, 1);
});

test('mixed paste accepts the exact text limit while plain text over that limit keeps its default handling', async () => {
  const f = await fixture(); await f.api.setAttachmentScope('draft');
  const plain = f.emit('paste', { text: 'x'.repeat(200_001) });
  assert.equal(plain.prevented, false);
  assert.deepEqual(f.texts, []);
  assert.equal(f.imports.length, 0);
  const text = 'x'.repeat(200_000);
  const mixed = f.emit('paste', { files: [new File(['abc'], 'image.png')], text });
  assert.equal(mixed.prevented, true);
  assert.deepEqual(f.texts, [text]);
  await tick();
  assert.equal(f.calls.filter(call => call.channel === 'lorca:import-attachments').length, 1);
  assert.equal(f.imports.length, 1);
  assert.equal(f.imports[0].error, undefined);
});

test('untrusted events and disabled or outside composers cannot grant files; whole-window file drops cannot navigate', async () => {
  const f = await fixture(); await f.api.setAttachmentScope('draft'); const file = new File(['abc'], 'image.png');
  const outside = new Target(); outside.inside = false;
  const disabled = new Target(); disabled.enabled = false;
  assert.equal(f.emit('drop', { files: [file], target: outside }).prevented, true);
  f.emit('paste', { files: [file], trusted: false }); f.emit('drop', { files: [file], target: disabled });
  assert.equal(f.emit('dragover', { files: [file], target: outside }).prevented, true);
  await tick(); assert.equal(f.calls.filter(item => item.channel === 'lorca:import-attachments').length, 0);
});

test('renderer text callbacks cannot retarget a captured trusted paste into a new draft', async () => {
  const f = await fixture(); await f.api.setAttachmentScope('old');
  f.api.onAttachmentText(() => { void f.api.setAttachmentScope('new'); });
  f.emit('paste', { files: [new File(['abc'], 'image.png')], text: 'switch draft' }); await tick();
  assert.equal(f.calls.some(item => item.channel === 'lorca:import-attachments'), false);
  assert.deepEqual(f.texts, ['switch draft']);
});

test('capture waits for its private scope ticket and late results release grants instead of attaching to another draft', async () => {
  const f = await fixture(); const scopeReady = deferred(), stageReady = deferred();
  f.setHandler(async (channel, args) => channel === 'lorca:set-attachment-scope' ? args[0] === 'old' ? scopeReady.promise : { ticket: f.ticket } : channel === 'lorca:import-attachments' ? stageReady.promise : null);
  const ready = f.api.setAttachmentScope('old'); f.emit('drop', { files: [new File(['abc'], 'image.png')] });
  await tick(); assert.equal(f.calls.some(item => item.channel === 'lorca:import-attachments'), false);
  scopeReady.resolve({ ticket: f.ticket }); await ready; await tick();
  assert.equal(f.calls.filter(item => item.channel === 'lorca:import-attachments').length, 1);
  await f.api.setAttachmentScope('new');
  stageReady.resolve({ attachments: [{ id: f.id, name: 'image.png', size: 3, mime: '', previewMime: null }], duplicates: 0 }); await tick();
  assert.equal(f.imports.length, 0); assert.equal(f.calls.some(item => item.channel === 'lorca:release-attachments'), true);
});

test('safe preview URLs are owned and revoked by preload on removal, scope change and page teardown', async () => {
  const f = await fixture(); await f.api.setAttachmentScope('draft');
  f.emit('drop', { files: [new File(['not preview bytes'], 'image.png')] }); await tick();
  assert.deepEqual([...new Uint8Array(await f.blobs[0].arrayBuffer())], [1, 2, 3]); assert.equal(f.blobs[0].type, 'image/png');
  await f.api.releaseAttachments([f.id]); assert.deepEqual(f.revoked, ['blob:synthetic-1']);
  f.emit('drop', { files: [new File(['abc'], 'image.png')] }); await tick();
  await f.api.setAttachmentScope('next'); assert.ok(f.revoked.includes('blob:synthetic-2'));
  f.emit('drop', { files: [new File(['abc'], 'image.png')] }); await tick();
  for (const listener of f.listeners.get('pagehide') ?? []) listener();
  assert.ok(f.revoked.includes('blob:synthetic-3'));
});

test('declared image MIME never authorizes HTML or SVG preview and oversized files fail before native staging', async () => {
  const f = await fixture(); await f.api.setAttachmentScope('draft');
  f.setHandler(async channel => channel === 'lorca:import-attachments' ? { attachments: [{ id: f.id, name: 'bad.svg', size: 3, mime: 'image/png', previewMime: 'image/svg+xml', previewBytes: new Uint8Array([1, 2, 3]) }], duplicates: 0 } : null);
  f.emit('drop', { files: [new File(['abc'], 'bad.svg', { type: 'image/png' })] }); await tick();
  assert.equal(f.blobs.length, 0); assert.equal(f.imports[0].attachments[0].previewUrl, undefined);
  const huge = new File(['a'], 'huge.bin'); Object.defineProperty(huge, 'size', { value: 100 * 1024 * 1024 + 1 });
  f.emit('paste', { files: [huge], text: 'text survives' }); await tick();
  assert.equal(f.calls.filter(item => item.channel === 'lorca:import-attachments').length, 1);
  assert.match(f.imports.at(-1)!.error!, /100 MiB/); assert.deepEqual(f.texts, ['text survives']);
});
