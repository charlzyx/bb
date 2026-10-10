const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { MAX_ATTACHMENT_BYTES } = require('./attachments.cjs');
const { rasterHeader, MAX_BYTES: MAX_PREVIEW_BYTES } = require('./bot-avatars.cjs');

const MAX_IMPORT_FILES = 10;
const MAX_IMPORT_BYTES = 250 * 1024 * 1024;
const CHANGED = '附件所属草稿、账号或连接已变化，请重新添加';
const INVALID = '附件格式无效，请通过粘贴或拖放添加普通文件';
const UNREADABLE = '无法暂存附件，文件可能已变化或不可读取，请重新添加';
const CLEANUP = '附件已撤销，但本地暂存清理未完成，请稍后关闭草稿重试';
function invalid(message = INVALID) { throw new Error(message); }
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !keys.includes(key))) invalid();
  return value;
}
function ids(value) {
  if (!Array.isArray(value) || value.length > 50) invalid('附件选择标识无效');
  return Array.from(value, id => {
    if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) invalid('附件选择标识无效');
    return id;
  });
}
function validateImport(value) {
  const input = object(value, ['source', 'files']);
  if (!['paste', 'drop', 'picker'].includes(input.source) || !Array.isArray(input.files) || input.files.length < 1 || input.files.length > MAX_IMPORT_FILES) invalid('每次最多添加十个文件');
  let total = 0;
  const files = Array.from(input.files, value => {
    const item = object(value, ['kind', 'name', 'size', 'mime', 'path', 'lastModified', 'bytes']);
    if (typeof item.name !== 'string' || item.name.length < 1 || item.name.length > 255 || /[\x00-\x1f\x7f/\\]/.test(item.name) || ['.', '..'].includes(item.name)) invalid('附件文件名无效');
    if (!Number.isSafeInteger(item.size) || item.size < 0 || item.size > MAX_ATTACHMENT_BYTES) invalid('每个附件必须不超过 100 MiB');
    total += item.size;
    if (total > MAX_IMPORT_BYTES) invalid('待发送附件总大小必须不超过 250 MiB');
    if (typeof item.mime !== 'string' || item.mime.length > 128 || (item.mime !== '' && !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(item.mime))) invalid('附件类型无效');
    if (item.kind === 'path') {
      if (item.bytes !== undefined || typeof item.path !== 'string' || !path.isAbsolute(item.path) || item.path.length > 32768 || item.path.includes('\0') || path.basename(item.path) !== item.name || !Number.isSafeInteger(item.lastModified) || item.lastModified < 0) invalid();
      return { kind: item.kind, name: item.name, size: item.size, mime: item.mime, path: item.path, lastModified: item.lastModified };
    }
    if (item.kind !== 'bytes' || item.path !== undefined || item.lastModified !== undefined || !(item.bytes instanceof Uint8Array) || item.bytes.byteLength !== item.size || item.bytes.buffer instanceof SharedArrayBuffer) invalid();
    return { kind: item.kind, name: item.name, size: item.size, mime: item.mime, bytes: item.bytes };
  });
  return { source: input.source, files };
}
function sameFile(before, after) {
  return after.isFile() && before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}
async function copyGrantedFile(item, output, check) {
  const original = await fs.lstat(item.path); check();
  if (!original.isFile() || original.isSymbolicLink()) invalid(UNREADABLE);
  const realPath = await fs.realpath(item.path); check();
  const visible = await fs.lstat(realPath); check();
  if (!sameFile(original, visible) || visible.isSymbolicLink() || visible.size !== item.size || Math.trunc(visible.mtimeMs) !== item.lastModified) invalid(UNREADABLE);
  const handle = await fs.open(realPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    check();
    const before = await handle.stat(); check();
    if (!sameFile(visible, before)) invalid(UNREADABLE);
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(Math.min(64 * 1024, item.size + 1));
    let used = 0;
    while (true) {
      const read = await handle.read(buffer, 0, Math.min(buffer.length, item.size - used + 1), used); check();
      if (!read.bytesRead) break;
      used += read.bytesRead;
      if (used > item.size) invalid(UNREADABLE);
      const bytes = buffer.subarray(0, read.bytesRead);
      hash.update(bytes);
      await output.writeFile(bytes); check();
    }
    const after = await handle.stat(); check();
    const finalVisible = await fs.lstat(realPath); check();
    const finalOriginal = await fs.lstat(item.path); check();
    const finalPath = await fs.realpath(item.path); check();
    if (used !== item.size || !sameFile(before, after) || !sameFile(before, finalVisible) || finalOriginal.isSymbolicLink() || !sameFile(before, finalOriginal) || finalPath !== realPath) invalid(UNREADABLE);
    return hash.digest('hex');
  } finally { await handle.close(); }
}
class AttachmentImports {
  constructor(selections, { temporaryDirectory = os.tmpdir() } = {}) {
    if (!selections || typeof selections.add !== 'function' || typeof selections.release !== 'function' || typeof selections.send !== 'function' || typeof selections.clear !== 'function' || !path.isAbsolute(temporaryDirectory)) invalid();
    this.selections = selections;
    this.temporaryDirectory = temporaryDirectory;
    this.records = new Map();
    this.cleanupRecords = new Map();
    this.epoch = 0;
    this.staging = false;
    this.cleanupWarning = null;
  }
  accountedRecords() {
    return [...this.records.values(), ...this.cleanupRecords.values(), ...this.selections.files.values()].filter((record, index, records) => record.id === undefined || records.findIndex(other => other.id === record.id) === index);
  }
  getCleanupWarning() { return this.cleanupWarning; }
  async stage(value, guard) {
    if (typeof guard !== 'function') invalid();
    try { guard(); } catch { invalid(CHANGED); }
    if (this.staging) invalid('另一批附件正在添加，请稍候');
    const input = validateImport(value);
    if (this.accountedRecords().reduce((total, record) => total + record.size, input.files.reduce((total, item) => total + item.size, 0)) > MAX_IMPORT_BYTES) invalid('待发送附件总大小必须不超过 250 MiB');
    for (const item of input.files) if (item.kind === 'bytes') item.bytes = Buffer.from(item.bytes);
    const epoch = this.epoch, selectionEpoch = this.selections.epoch;
    const check = () => { try { guard(); } catch { invalid(CHANGED); } if (epoch !== this.epoch || selectionEpoch !== this.selections.epoch) invalid(CHANGED); };
    const prepared = [], added = [];
    let duplicates = 0;
    this.staging = true;
    try {
      for (const [sourceIndex, item] of input.files.entries()) {
        check();
        const directory = await fs.mkdtemp(path.join(this.temporaryDirectory, 'dots-attachment-')); prepared.push({ directory }); this.cleanupRecords.set(directory, { directory, size: item.size }); check();
        await fs.chmod(directory, 0o700); check();
        const stagedPath = path.join(directory, item.name);
        const output = await fs.open(stagedPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        let digest;
        try {
          check();
          if (item.kind === 'path') digest = await copyGrantedFile(item, output, check);
          else {
            await output.writeFile(item.bytes); check();
            digest = createHash('sha256').update(item.bytes).digest('hex');
          }
        } finally { await output.close(); }
        check();
        let previewMime = null;
        let previewBytes;
        if (item.size <= MAX_PREVIEW_BYTES) {
          const content = await fs.readFile(stagedPath); check();
          try { previewMime = rasterHeader(content).mime; previewBytes = new Uint8Array(content); } catch {}
        }
        if ([...this.records.values(), ...added].some(record => !record.released && record.digest === digest)) {
          duplicates++;
          await this.cleanup(directory); check();
          continue;
        }
        const existing = this.accountedRecords().filter(record => !this.cleanupRecords.has(record.directory));
        if (existing.length + added.length >= MAX_IMPORT_FILES) invalid('待发送附件最多十个，请先移除部分附件');
        if ([...existing, ...added].reduce((total, record) => total + record.size, item.size) > MAX_IMPORT_BYTES) invalid('待发送附件总大小必须不超过 250 MiB');
        added.push({ directory, stagedPath, digest, sourceIndex, name: item.name, size: item.size, mime: item.mime, previewMime, previewBytes, busy: false, released: false });
      }
      check();
      const selected = added.length ? await this.selections.add(added.map(record => record.stagedPath)) : [];
      for (let index = 0; index < selected.length; index++) added[index].id = selected[index].id;
      check();
      for (const record of added) { this.records.set(record.id, record); this.cleanupRecords.delete(record.directory); }
      const result = { attachments: added.map(({ id, name, size, mime, previewMime, previewBytes, sourceIndex }) => ({ id, name, size, mime, previewMime, ...(previewBytes ? { previewBytes } : {}), sourceIndex })), duplicates };
      for (const record of added) delete record.previewBytes;
      return result;
    } catch (error) {
      const selected = added.filter(record => record.id).map(record => record.id);
      if (selected.length) this.selections.release(selected);
      const cleanup = await Promise.allSettled(prepared.map(({ directory }) => this.cleanup(directory)));
      if (cleanup.some(result => result.status === 'rejected')) throw new Error(CLEANUP);
      if ([INVALID, UNREADABLE, CHANGED, '附件文件名无效', '附件类型无效', '每次最多添加十个文件', '每个附件必须不超过 100 MiB', '待发送附件总大小必须不超过 250 MiB', '待发送附件最多十个，请先移除部分附件'].includes(error?.message)) throw error;
      throw new Error(UNREADABLE);
    } finally { this.staging = false; }
  }
  async cleanup(directory) {
    try { await fs.rm(directory, { recursive: true, force: true }); }
    catch { this.cleanupWarning = CLEANUP; throw new Error(CLEANUP); }
    this.cleanupRecords.delete(directory);
  }
  async remove(record) {
    await this.cleanup(record.directory);
    this.records.delete(record.id);
    if (!this.cleanupRecords.size && ![...this.records.values()].some(record => record.released)) this.cleanupWarning = null;
  }
  async release(value) {
    const selected = ids(value);
    this.selections.release(selected);
    await Promise.all(selected.map(async id => {
      const record = this.records.get(id);
      if (!record) return;
      record.released = true;
      if (!record.busy) await this.remove(record);
    }));
  }
  async clear() {
    ++this.epoch;
    this.selections.clear();
    await Promise.all([...this.records.values()].map(async record => {
      record.released = true;
      if (!record.busy) await this.remove(record);
    }).concat(this.staging ? [] : [...this.cleanupRecords.keys()].map(directory => this.cleanup(directory))));
    if (!this.cleanupRecords.size && ![...this.records.values()].some(record => record.released)) this.cleanupWarning = null;
  }
  async send(bridge, input, guard, completionGuard = guard) {
    if (typeof guard !== 'function' || typeof completionGuard !== 'function') invalid();
    try { guard(); } catch { invalid(CHANGED); }
    const selected = ids(input?.selection_ids);
    const records = selected.map(id => this.records.get(id)).filter(Boolean);
    if (records.some(record => record.busy || record.released)) invalid('此附件选择已不可用，请重新添加');
    for (const record of records) record.busy = true;
    let dispatched = false;
    try {
      const result = await this.selections.send({ getStatus: () => bridge.getStatus(), sendValidated: (method, params) => {
        try { guard(); } catch { invalid(CHANGED); }
        dispatched = true;
        return bridge.sendValidated(method, params);
      } }, input);
      try { completionGuard(); } catch { invalid('发送结果尚不确定，请先检查原对话；请求未被自动重发'); }
      return result;
    } catch (error) {
      if (!dispatched && (typeof error?.path === 'string' || typeof error?.syscall === 'string' || (typeof error?.code === 'string' && /^E[A-Z0-9]+$/.test(error.code)))) throw new Error(UNREADABLE);
      throw error;
    } finally {
      for (const record of records) record.busy = false;
      const released = dispatched ? selected : records.filter(record => record.released).map(record => record.id);
      if (released.length) {
        try { await this.release(released); }
        catch { this.cleanupWarning = CLEANUP; }
      }
    }
  }
}
module.exports = { AttachmentImports, validateImport, MAX_IMPORT_FILES, MAX_IMPORT_BYTES };
