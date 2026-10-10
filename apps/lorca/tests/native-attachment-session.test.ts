import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const { AttachmentSelections } = require('../native/attachments.cjs');
const { AttachmentSession, scopeValue } = require('../native/attachment-session.cjs');
const trusted = () => {};
const bytes = (value = 'synthetic') => ({ source: 'paste', files: [{ kind: 'bytes', name: 'image.png', size: value.length, mime: 'image/png', bytes: new Uint8Array(Buffer.from(value)) }] });
const deferred = () => {
  let resolve: (value: unknown) => void = () => {};
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dots-attachment-session-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const temporaryDirectory = path.join(directory, 'staged'); await mkdir(temporaryDirectory);
  const status = { status: 'connected', generation: 1, endpoint: 'synthetic' };
  const inventory = { epoch: 0, capture() { return { epoch: this.epoch, generation: status.generation }; }, check(fence: { epoch: number; generation: number }) { if (status.status !== 'connected' || fence.epoch !== this.epoch || fence.generation !== status.generation) throw new Error('changed'); return status; } };
  const requests: unknown[] = [];
  const bridge = { getStatus: () => status, sendValidated: async (_method: string, params: unknown): Promise<unknown> => { requests.push(params); return { message: { id: 'synthetic' } }; } };
  const selected: string[] = [];
  const selections = new AttachmentSelections();
  const session = new AttachmentSession({ selections, bridge, inventory, temporaryDirectory, chooseFiles: async () => ({ canceled: false, filePaths: selected }) });
  return { directory, temporaryDirectory, session, selections, inventory, bridge, requests, status, selected };
}

test('session issues private tickets for bounded opaque draft scope and rejects missing or foreign tickets', async t => {
  const f = await fixture(t); const scope = JSON.stringify(['ws://127.0.0.1:4862/ws', 'token', 1, 0, 2]);
  assert.equal(scopeValue(scope), scope);
  for (const value of [undefined, {}, '', 'x'.repeat(513), 'line\nbreak']) assert.throws(() => scopeValue(value));
  const issued = await f.session.setScope(scope, trusted); assert.match(issued.ticket, /^[a-f0-9]{64}$/);
  assert.deepEqual(await f.session.setScope(scope, trusted), issued);
  for (const ticket of [null, '', 'x'.repeat(64)]) assert.throws(() => f.session.stage(scope, ticket, bytes(), trusted));
  assert.throws(() => f.session.stage(scope, issued.ticket, bytes(), () => { throw new Error('untrusted frame'); }));
  const staged = await f.session.stage(scope, issued.ticket, bytes(), trusted);
  assert.equal(staged.attachments.length, 1); assert.equal(f.requests.length, 0);
  await f.session.shutdown(); assert.deepEqual(await readdir(f.temporaryDirectory), []);
});

test('tickets retain their issued account and bridge fence even without an explicit invalidation event', async t => {
  for (const change of ['identity', 'generation']) {
    const f = await fixture(t); const { ticket } = await f.session.setScope('draft', trusted);
    const staged = await f.session.stage('draft', ticket, bytes(), trusted);
    if (change === 'identity') f.inventory.epoch++; else f.status.generation++;
    assert.throws(() => f.session.stage('draft', ticket, bytes(), trusted), /changed/);
    assert.throws(() => f.session.send('draft', ticket, { chat_id: 'chat', text: '', selection_ids: [staged.attachments[0].id] }, trusted), /changed/);
    await assert.rejects(f.session.setScope('draft', trusted), /changed/);
    assert.equal(f.requests.length, 0); await f.session.shutdown();
  }
});

test('scope replacement clears grants and fences asynchronous staging', async t => {
  const f = await fixture(t); const old = await f.session.setScope('old', trusted);
  const staging = f.session.stage('old', old.ticket, bytes(), trusted);
  const next = f.session.setScope('next', trusted);
  await assert.rejects(staging); const current = await next;
  assert.notEqual(current.ticket, old.ticket); assert.equal(f.selections.files.size, 0);
  assert.throws(() => f.session.stage('old', old.ticket, bytes(), trusted));
  const result = await f.session.stage('next', current.ticket, bytes(), trusted);
  await f.session.release(result.attachments.map((item: { id: string }) => item.id), trusted);
  assert.deepEqual(await readdir(f.temporaryDirectory), []); await f.session.shutdown();
});

test('native picker and imports share one lock through dialogs, draft changes and duplicate file staging', async t => {
  const f = await fixture(t); const chosen = path.join(f.directory, 'picked.txt'); await writeFile(chosen, 'synthetic');
  const { ticket } = await f.session.setScope('draft', trusted);
  const dialog = deferred(); f.session.chooseFiles = () => dialog.promise;
  const picking = f.session.pick('draft', ticket, trusted); await Promise.resolve();
  assert.throws(() => f.session.stage('draft', ticket, bytes(), trusted), /另一项附件/);
  const next = await f.session.setScope('next', trusted);
  assert.throws(() => f.session.pick('next', next.ticket, trusted), /另一项附件/);
  dialog.resolve({ canceled: false, filePaths: [chosen] }); await assert.rejects(picking);
  f.session.chooseFiles = async () => ({ canceled: false, filePaths: [chosen] });
  const picked = await f.session.pick('next', next.ticket, trusted); assert.equal(picked.attachments.length, 1);
  const duplicate = await f.session.stage('next', next.ticket, bytes(), trusted);
  assert.equal(duplicate.duplicates, 1); assert.equal(duplicate.attachments.length, 0);
  assert.equal(f.requests.length, 0); await f.session.shutdown();
});

test('picker cannot exceed imported quantity or bypass ordinary-file validation', async t => {
  const f = await fixture(t); const { ticket } = await f.session.setScope('draft', trusted);
  for (let index = 0; index < 10; index++) await f.session.stage('draft', ticket, bytes(`synthetic ${index}`), trusted);
  const chosen = path.join(f.directory, 'picked.txt'); await writeFile(chosen, 'extra'); f.selected.push(chosen);
  await assert.rejects(f.session.pick('draft', ticket, trusted), /最多十个/);
  assert.equal(f.selections.files.size, 10);
  f.selected[0] = f.directory; await assert.rejects(f.session.pick('draft', ticket, trusted), /普通文件/);
  await f.session.shutdown();
});

test('shutdown invalidates pending work, waits for its rollback and leaves no staged files', async t => {
  const f = await fixture(t); const { ticket } = await f.session.setScope('draft', trusted);
  const staging = f.session.stage('draft', ticket, bytes(), trusted);
  const quitting = f.session.shutdown(); await assert.rejects(staging); await quitting;
  assert.equal(f.session.scope, null); assert.equal(f.session.ticket, null); assert.equal(f.selections.files.size, 0);
  assert.deepEqual(await readdir(f.temporaryDirectory), []);
});

test('draft navigation cannot replace an already acknowledged send result, while source replacement still fences it', async t => {
  for (const boundary of ['draft', 'source']) {
    const f = await fixture(t); const { ticket } = await f.session.setScope('old', trusted);
    const staged = await f.session.stage('old', ticket, bytes(), trusted);
    const entered = deferred(), response = deferred();
    f.bridge.sendValidated = async (_method: string, params: unknown) => { f.requests.push(params); entered.resolve(null); return response.promise; };
    const sending = f.session.send('old', ticket, { chat_id: 'old-chat', text: '', selection_ids: [staged.attachments[0].id] }, trusted);
    await entered.promise;
    if (boundary === 'draft') await f.session.setScope('new', trusted); else await f.session.invalidate();
    const confirmed = { message: { id: 'acknowledged', chat_id: 'old-chat' } }; response.resolve(confirmed);
    if (boundary === 'draft') assert.deepEqual(await sending, confirmed); else await assert.rejects(sending, /发送结果尚不确定.*未被自动重发/);
    assert.equal(f.requests.length, 1); assert.deepEqual(await readdir(f.temporaryDirectory), []);
    await f.session.shutdown();
  }
});

test('draft invalidation before a queued picker action does not open a native dialog', async t => {
  const f = await fixture(t); const { ticket } = await f.session.setScope('old', trusted);
  let dialogs = 0; f.session.chooseFiles = async () => { dialogs++; return { canceled: true, filePaths: [] }; };
  const picking = f.session.pick('old', ticket, trusted); const clearing = f.session.invalidate();
  await assert.rejects(picking); await clearing;
  assert.equal(dialogs, 0); await f.session.shutdown();
});

test('private preview bytes are the validated staged copy, not a later source read', async t => {
  const f = await fixture(t); const { ticket } = await f.session.setScope('draft', trusted);
  const png = await readFile(new URL('../public/app-icon/64.png', import.meta.url));
  const chosen = path.join(f.directory, 'picked.png'); await writeFile(chosen, png); f.selected.push(chosen);
  const result = await f.session.pick('draft', ticket, trusted);
  await writeFile(chosen, '<svg><script>synthetic()</script></svg>');
  assert.equal(result.attachments[0].previewMime, 'image/png');
  assert.deepEqual(Buffer.from(result.attachments[0].previewBytes), png);
  assert.equal(f.session.imports.records.get(result.attachments[0].id).previewBytes, undefined);
  await f.session.shutdown();
});
