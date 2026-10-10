import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, truncate, utimes, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const { AttachmentSelections, MAX_ATTACHMENT_BYTES } = require('../native/attachments.cjs');
const { AttachmentImports, validateImport, MAX_IMPORT_BYTES } = require('../native/attachment-imports.cjs');
const guard = () => {};
const bytes = (name = 'clipboard.png', text = 'synthetic image') => ({ kind: 'bytes', name, size: Buffer.byteLength(text), mime: 'image/png', bytes: new Uint8Array(Buffer.from(text)) });
const payload = (...files: unknown[]) => ({ source: 'paste', files });
const deferred = () => {
  let resolve: (value: unknown) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dots-import-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const temporaryDirectory = path.join(directory, 'staged'); await mkdir(temporaryDirectory);
  const selections = new AttachmentSelections();
  const imports = new AttachmentImports(selections, { temporaryDirectory });
  const file = async (name = 'example.txt', content = 'synthetic file') => {
    const chosen = path.join(directory, name); await writeFile(chosen, content);
    const info = await stat(chosen);
    return { kind: 'path', name, size: info.size, mime: 'text/plain', path: chosen, lastModified: Math.trunc(info.mtimeMs) };
  };
  return { directory, temporaryDirectory, selections, imports, file };
}
function bridge(handler: (params: unknown) => Promise<unknown>) {
  return { getStatus: () => ({ status: 'connected', generation: 1, endpoint: 'synthetic' }), sendValidated: async (method: string, params: unknown) => { assert.equal(method, 'chats.send'); return handler(params); } };
}

test('import grants contain no native path and stage private snapshots without sending', async t => {
  const f = await fixture(t); const original = await f.file();
  const result = await f.imports.stage({ source: 'drop', files: [original, bytes()] }, guard);
  assert.equal(result.duplicates, 0);
  assert.deepEqual(result.attachments.map(({ id, ...value }: { id: string }) => { assert.match(id, /^[0-9a-f]{32}$/); return value; }), [
    { name: 'example.txt', size: original.size, mime: 'text/plain', previewMime: null, sourceIndex: 0 },
    { name: 'clipboard.png', size: 15, mime: 'image/png', previewMime: null, sourceIndex: 1 },
  ]);
  assert.equal(JSON.stringify(result).includes(f.directory), false);
  for (const selected of result.attachments) {
    const record = f.selections.files.get(selected.id);
    assert.notEqual(record.path, original.path);
    assert.equal((await stat(record.path)).isFile(), true);
    if (process.platform !== 'win32') {
      assert.equal((await stat(record.path)).mode & 0o777, 0o600);
      assert.equal((await stat(path.dirname(record.path))).mode & 0o777, 0o700);
    }
  }
  await writeFile(original.path, 'original changed after staging');
  assert.equal(await readFile(f.selections.files.get(result.attachments[0].id).path, 'utf8'), 'synthetic file');
  await f.imports.clear(); assert.deepEqual(await readdir(f.temporaryDirectory), []);
});

test('content deduplication spans a batch and retained grants but preserves source indexes', async t => {
  const f = await fixture(t);
  const first = await f.imports.stage(payload(bytes('one.png', 'same'), bytes('two.png', 'same'), bytes('three.png', 'different')), guard);
  assert.equal(first.duplicates, 1); assert.deepEqual(first.attachments.map((item: { sourceIndex: number }) => item.sourceIndex), [0, 2]);
  const repeat = await f.imports.stage(payload(bytes('again.png', 'same')), guard);
  assert.equal(repeat.duplicates, 1); assert.deepEqual(repeat.attachments, []); assert.equal(f.selections.files.size, 2);
  await f.imports.release([first.attachments[0].id]);
  const readded = await f.imports.stage(payload(bytes('again.png', 'same')), guard);
  assert.equal(readded.duplicates, 0); assert.equal(readded.attachments.length, 1);
  await f.imports.clear();
});

test('import boundary rejects arbitrary shapes, paths, sparse files and invalid type or size metadata', () => {
  const good = bytes();
  for (const value of [null, [], {}, { ...payload(good), extra: true }, { source: 'poll', files: [good] }, payload(), payload(...Array(11).fill(good)), { source: 'drop', files: new Array(1) }, payload({ ...good, path: '/private' }), payload({ ...good, bytes: [1] }), payload({ ...good, size: 1 }), payload({ ...good, mime: 'text/html;secret=private' }), payload({ ...good, name: '../private' }), payload({ ...good, name: 'bad\nname' }), payload({ ...good, size: MAX_ATTACHMENT_BYTES + 1 }), payload({ ...good, bytes: new Uint8Array(new SharedArrayBuffer(good.size)) }), payload({ kind: 'path', path: 'relative', name: 'relative', size: 0, mime: '', lastModified: 0 })]) {
    assert.throws(() => validateImport(value));
  }
  const large = { kind: 'path', path: '/synthetic/file', name: 'file', size: MAX_ATTACHMENT_BYTES, mime: '', lastModified: 0 };
  assert.throws(() => validateImport(payload(large, large, large)), /250 MiB/);
});

test('memory bytes are copied at validation so later renderer mutation cannot replace staged data', async t => {
  const f = await fixture(t); const input = bytes('copy.png', 'original');
  const staging = f.imports.stage(payload(input), guard); input.bytes.fill(0);
  const result = await staging;
  assert.equal(await readFile(f.selections.files.get(result.attachments[0].id).path, 'utf8'), 'original');
  await f.imports.clear();
});

test('invalid file or later scope change rolls back the complete import with no leaked path', async t => {
  const f = await fixture(t); const missing = await f.file(); await rm(missing.path);
  await assert.rejects(f.imports.stage(payload(bytes(), missing), guard), (error: Error) => /无法暂存/.test(error.message) && !error.message.includes(f.directory));
  assert.equal(f.selections.files.size, 0); assert.deepEqual(await readdir(f.temporaryDirectory), []);
  let checks = 0;
  await assert.rejects(f.imports.stage(payload(bytes()), () => { if (++checks === 5) throw new Error(`secret ${f.directory}`); }), /所属草稿、账号或连接已变化/);
  assert.equal(f.selections.files.size, 0); assert.deepEqual(await readdir(f.temporaryDirectory), []);
});

test('directories, changed metadata and replacement symlinks never become attachment grants', async t => {
  const f = await fixture(t); const original = await f.file();
  const directoryInfo = await stat(f.temporaryDirectory);
  await assert.rejects(f.imports.stage(payload({ ...original, path: f.temporaryDirectory, name: 'staged', size: directoryInfo.size, lastModified: Math.trunc(directoryInfo.mtimeMs) }), guard), /无法暂存/);
  await assert.rejects(f.imports.stage(payload({ ...original, size: original.size + 1 }), guard), /无法暂存/);
  await assert.rejects(f.imports.stage(payload({ ...original, lastModified: 0 }), guard), /无法暂存/);
  let checks = 0;
  const replacement = path.join(f.directory, 'replacement.txt'); await writeFile(replacement, 'replacement');
  await assert.rejects(f.imports.stage(payload(original), () => {
    if (++checks === 6) { f.selections.clear(); }
  }), /所属草稿、账号或连接已变化/);
  await rm(original.path); await symlink(replacement, original.path);
  await assert.rejects(f.imports.stage(payload(original), guard), /无法暂存/);
  assert.equal(f.selections.files.size, 0); assert.deepEqual(await readdir(f.temporaryDirectory), []);
});

test('same-size same-timestamp symlink replacement still cannot become a file grant', async t => {
  const f = await fixture(t); const original = await f.file('picked.txt', 'original');
  const replacement = path.join(f.directory, 'replacement.txt'); await writeFile(replacement, 'changed!');
  const timestamp = new Date(1_600_000_000_000); await utimes(original.path, timestamp, timestamp); await utimes(replacement, timestamp, timestamp);
  original.lastModified = Math.trunc((await stat(original.path)).mtimeMs);
  await rm(original.path); await symlink(replacement, original.path);
  assert.equal((await stat(original.path)).size, original.size); assert.equal(Math.trunc((await stat(original.path)).mtimeMs), original.lastModified);
  await assert.rejects(f.imports.stage(payload(original), guard), /无法暂存/);
  assert.equal(f.selections.files.size, 0); assert.deepEqual(await readdir(f.temporaryDirectory), []);
});

test('only validated bounded raster content gets a preview hint regardless of declared MIME', async t => {
  const f = await fixture(t);
  const png = await readFile(new URL('../public/app-icon/64.png', import.meta.url));
  const result = await f.imports.stage(payload(
    { kind: 'bytes', name: 'image.png', size: png.length, mime: 'application/octet-stream', bytes: new Uint8Array(png) },
    bytes('vector.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>synthetic()</script></svg>'),
    bytes('document.html', '<html><script>synthetic()</script></html>'),
  ), guard);
  assert.deepEqual(result.attachments.map((item: { previewMime: string | null }) => item.previewMime), ['image/png', null, null]);
  await f.imports.clear();
});

test('parallel staging and clear during an awaited import fail closed', async t => {
  const f = await fixture(t);
  const pending = f.imports.stage(payload(bytes()), guard);
  await assert.rejects(f.imports.stage(payload(bytes()), guard), /另一批附件/);
  await f.imports.clear();
  await assert.rejects(pending, /所属草稿、账号或连接已变化/);
  assert.equal(f.selections.files.size, 0); assert.deepEqual(await readdir(f.temporaryDirectory), []);
});

test('retained and in-flight imports count toward bounded storage and selection limits', async t => {
  const f = await fixture(t);
  await f.imports.stage(payload(...Array.from({ length: 10 }, (_, index) => bytes(`${index}.png`, `content ${index}`))), guard);
  await assert.rejects(f.imports.stage(payload(bytes('extra.png', 'extra')), guard), /最多十个/);
  assert.equal(f.selections.files.size, 10);
  await f.imports.clear();
  const orphan = { directory: 'synthetic-no-file', size: MAX_IMPORT_BYTES };
  f.imports.cleanupRecords.set(orphan.directory, orphan);
  await assert.rejects(f.imports.stage(payload(bytes()), guard), /250 MiB/);
  f.imports.cleanupRecords.clear();
});

test('ordinary picker grants share the imported count and total-byte budget', async t => {
  const f = await fixture(t); const chosen = await f.file();
  await f.selections.add(Array(10).fill(chosen.path));
  await assert.rejects(f.imports.stage(payload(bytes()), guard), /最多十个/);
  await f.imports.clear();
  const huge = path.join(f.directory, 'large.bin'); await writeFile(huge, ''); await truncate(huge, MAX_ATTACHMENT_BYTES);
  await f.selections.add([huge, huge, huge]);
  await assert.rejects(f.imports.stage(payload(bytes()), guard), /250 MiB/);
  await f.imports.clear();
});

test('release and scope clear preserve busy temporary bytes until the send result settles', async t => {
  for (const revoke of ['release', 'clear']) {
    const f = await fixture(t); const staged = await f.imports.stage(payload(bytes()), guard); const selected = staged.attachments[0];
    const pending = deferred(), entered = deferred();
    const stagedPath = f.selections.files.get(selected.id).path;
    const sending = f.imports.send(bridge(async params => { entered.resolve(params); return pending.promise; }), { chat_id: 'chat-one', text: '', selection_ids: [selected.id] }, guard);
    await entered.promise;
    if (revoke === 'release') await f.imports.release([selected.id]); else await f.imports.clear();
    assert.equal(await readFile(stagedPath, 'utf8'), 'synthetic image');
    pending.resolve({ message: { id: 'synthetic' } }); await sending;
    assert.deepEqual(await readdir(f.temporaryDirectory), []); assert.equal(f.selections.files.size, 0);
  }
});

test('unknown sends consume grants exactly once without replay and remove settled temporary data', async t => {
  const f = await fixture(t); const staged = await f.imports.stage(payload(bytes()), guard); const selected = staged.attachments[0];
  let calls = 0;
  const runtime = bridge(async () => { calls++; throw new Error('outcome unknown'); });
  const input = { chat_id: 'chat-one', text: '', selection_ids: [selected.id] };
  await assert.rejects(f.imports.send(runtime, input, guard), /outcome unknown/);
  await assert.rejects(f.imports.send(runtime, input, guard), /不可用/);
  assert.equal(calls, 1); assert.equal(f.selections.files.size, 0); assert.deepEqual(await readdir(f.temporaryDirectory), []);
});

test('successful sends use staged content and release temporary grants; malformed sends make no RPC', async t => {
  const f = await fixture(t); const original = await f.file();
  const staged = await f.imports.stage(payload(original), guard); const selected = staged.attachments[0];
  await truncate(original.path, 0);
  const requests: unknown[] = [];
  const runtime = bridge(async params => { requests.push(params); return { message: { id: 'synthetic' } }; });
  await f.imports.send(runtime, { chat_id: 'chat-one', text: '', selection_ids: [selected.id] }, guard);
  assert.equal(requests.length, 1); assert.deepEqual(await readdir(f.temporaryDirectory), []);
  const fresh = await f.imports.stage(payload(bytes()), guard);
  await assert.rejects(f.imports.send(runtime, { chat_id: 'chat-one', text: '', selection_ids: [fresh.attachments[0].id], attachments: [{ path: '/private' }] }, guard));
  assert.equal(requests.length, 1); assert.equal(f.selections.files.size, 1);
  await f.imports.clear(); assert.deepEqual(await readdir(f.temporaryDirectory), []);
});

test('cleanup failure never replaces a confirmed send result or an unknown-outcome error', async t => {
  for (const outcome of ['success', 'unknown']) {
    const f = await fixture(t); const staged = await f.imports.stage(payload(bytes()), guard);
    const fileSystem = require('node:fs/promises'); const originalRemove = fileSystem.rm;
    fileSystem.rm = async () => { throw new Error(`EPERM synthetic ${f.directory}`); };
    const result = { message: { id: 'confirmed' } }; const unknown = new Error('outcome unknown');
    try {
      const sending = f.imports.send(bridge(async () => { if (outcome === 'unknown') throw unknown; return result; }), { chat_id: 'chat-one', text: '', selection_ids: [staged.attachments[0].id] }, guard);
      if (outcome === 'success') assert.deepEqual(await sending, result); else await assert.rejects(sending, error => error === unknown);
      assert.match(f.imports.getCleanupWarning(), /清理未完成/);
      assert.equal(f.selections.files.size, 0); assert.equal(f.imports.records.size, 1);
    } finally { fileSystem.rm = originalRemove; }
    await f.imports.clear(); assert.equal(f.imports.getCleanupWarning(), null); assert.deepEqual(await readdir(f.temporaryDirectory), []);
  }
});

test('scope change while send awaits file metadata blocks the RPC and preserves the unsent grant', async t => {
  const f = await fixture(t); const staged = await f.imports.stage(payload(bytes()), guard);
  const selected = staged.attachments[0]; const stagedPath = f.selections.files.get(selected.id).path;
  const fileSystem = require('node:fs/promises'); const originalStat = fileSystem.stat;
  const entered = deferred(), pending = deferred();
  let current = true, calls = 0;
  fileSystem.stat = async (value: string) => { assert.equal(value, stagedPath); entered.resolve(null); return pending.promise; };
  try {
    const sending = f.imports.send(bridge(async () => { calls++; return {}; }), { chat_id: 'chat-one', text: '', selection_ids: [selected.id] }, () => { if (!current) throw new Error('scope changed'); });
    await entered.promise; current = false; pending.resolve(await originalStat(stagedPath));
    await assert.rejects(sending, /所属草稿、账号或连接已变化/);
    assert.equal(calls, 0); assert.equal(f.selections.files.has(selected.id), true);
    assert.equal(await readFile(stagedPath, 'utf8'), 'synthetic image');
  } finally { fileSystem.stat = originalStat; }
  await f.imports.clear();
});

test('unexpected filesystem send errors are redacted without consuming an unsent grant', async t => {
  const f = await fixture(t); const staged = await f.imports.stage(payload(bytes()), guard);
  const selected = staged.attachments[0]; const stagedPath = f.selections.files.get(selected.id).path;
  const fileSystem = require('node:fs/promises'); const originalStat = fileSystem.stat;
  fileSystem.stat = async () => { throw Object.assign(new Error(`EIO ${stagedPath}`), { code: 'EIO', path: stagedPath }); };
  let calls = 0;
  try {
    await assert.rejects(f.imports.send(bridge(async () => { calls++; return {}; }), { chat_id: 'chat-one', text: '', selection_ids: [selected.id] }, guard), (error: Error) => /无法暂存附件/.test(error.message) && !error.message.includes(stagedPath));
    assert.equal(calls, 0); assert.equal(f.selections.files.has(selected.id), true);
  } finally { fileSystem.stat = originalStat; }
  await f.imports.clear();
});

test('failed cleanup preserves native ownership for retry while hiding filesystem errors', async t => {
  const f = await fixture(t); const staged = await f.imports.stage(payload(bytes()), guard);
  const fileSystem = require('node:fs/promises'); const originalRemove = fileSystem.rm;
  fileSystem.rm = async () => { throw new Error(`EPERM synthetic ${f.directory}`); };
  try {
    await assert.rejects(f.imports.release([staged.attachments[0].id]), (error: Error) => /清理未完成/.test(error.message) && !error.message.includes(f.directory));
    assert.equal(f.imports.records.size, 1); assert.equal(f.selections.files.size, 0);
  } finally { fileSystem.rm = originalRemove; }
  await f.imports.clear(); assert.equal(f.imports.records.size, 0); assert.deepEqual(await readdir(f.temporaryDirectory), []);
  fileSystem.rm = async () => { throw new Error(`ENOSPC synthetic ${f.directory}`); };
  let checks = 0;
  try {
    await assert.rejects(f.imports.stage(payload(bytes()), () => { if (++checks === 4) throw new Error('scope changed'); }), /清理未完成/);
    assert.equal(f.imports.cleanupRecords.size, 1);
  } finally { fileSystem.rm = originalRemove; }
  await f.imports.clear(); assert.equal(f.imports.cleanupRecords.size, 0); assert.deepEqual(await readdir(f.temporaryDirectory), []);
});
