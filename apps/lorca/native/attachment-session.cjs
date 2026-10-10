const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { AttachmentImports } = require('./attachment-imports.cjs');

const CHANGED = '附件所属草稿、账号或连接已变化，请重新添加';
const BUSY = '另一项附件操作正在处理，请稍候';
function scopeValue(value) {
  if (value !== null && (typeof value !== 'string' || value.length < 1 || value.length > 512 || /[\x00-\x1f\x7f]/.test(value))) throw new Error('附件草稿标识无效');
  return value;
}
class AttachmentSession {
  constructor({ selections, bridge, inventory, chooseFiles, temporaryDirectory }) {
    this.imports = new AttachmentImports(selections, { temporaryDirectory });
    this.bridge = bridge;
    this.inventory = inventory;
    this.chooseFiles = chooseFiles;
    this.scope = null;
    this.ticket = null;
    this.scopeFence = null;
    this.epoch = 0;
    this.originEpoch = 0;
    this.busy = false;
    this.cleaning = Promise.resolve();
    this.operation = null;
  }
  invalidate(sourceChanged = true) {
    if (sourceChanged) ++this.originEpoch;
    this.scope = null; this.ticket = null; this.scopeFence = null; ++this.epoch;
    this.cleaning = this.imports.clear().catch(() => {});
    return this.cleaning;
  }
  async setScope(value, trusted) {
    trusted(); scopeValue(value);
    if (value === this.scope && (value === null || this.ticket)) {
      if (value !== null) this.inventory.check(this.scopeFence);
      return value === null ? null : { ticket: this.ticket };
    }
    const clearing = this.invalidate(false), epoch = this.epoch;
    if (value === null) { await clearing; trusted(); return null; }
    const fence = this.inventory.capture(); this.inventory.check(fence);
    await clearing; trusted(); this.inventory.check(fence);
    if (epoch !== this.epoch) throw new Error(CHANGED);
    this.scope = value; this.ticket = randomBytes(32).toString('hex'); this.scopeFence = fence;
    return { ticket: this.ticket };
  }
  guard(scope, ticket, trusted) {
    trusted();
    const fence = this.scopeFence, epoch = this.epoch, endpoint = this.bridge.getStatus().endpoint;
    const check = () => {
      trusted(); if (!fence) throw new Error(CHANGED); this.inventory.check(fence);
      if (!scope || scope !== this.scope || typeof ticket !== 'string' || ticket !== this.ticket || epoch !== this.epoch || this.bridge.getStatus().endpoint !== endpoint) throw new Error(CHANGED);
    };
    check(); return check;
  }
  exclusive(action) {
    if (this.busy) throw new Error(BUSY);
    this.busy = true;
    this.operation = Promise.resolve().then(action).finally(() => { this.busy = false; this.operation = null; });
    return this.operation;
  }
  stage(scope, ticket, value, trusted) {
    const check = this.guard(scope, ticket, trusted);
    if (!value || !['paste', 'drop'].includes(value.source)) throw new Error('附件导入来源无效');
    return this.exclusive(async () => { check(); return this.imports.stage(value, check); });
  }
  pick(scope, ticket, trusted) {
    const check = this.guard(scope, ticket, trusted);
    return this.exclusive(async () => {
      check();
      const result = await this.chooseFiles(); check();
      if (result.canceled) return { attachments: [], duplicates: 0 };
      if (!Array.isArray(result.filePaths) || result.filePaths.length > 10) throw new Error('每次最多添加十个文件');
      const files = [];
      for (const chosen of result.filePaths) {
        let info;
        try { info = await fs.lstat(chosen); } catch { throw new Error('无法读取所选附件，请重新选择普通文件'); }
        check();
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('附件必须是普通文件，不支持文件夹或符号链接');
        files.push({ kind: 'path', path: chosen, name: path.basename(chosen), size: info.size, mime: '', lastModified: Math.trunc(info.mtimeMs) });
      }
      check();
      return files.length ? this.imports.stage({ source: 'picker', files }, check) : { attachments: [], duplicates: 0 };
    });
  }
  release(ids, trusted) { trusted(); return this.imports.release(ids); }
  send(scope, ticket, params, trusted) {
    const check = this.guard(scope, ticket, trusted);
    const fence = this.scopeFence, originEpoch = this.originEpoch, endpoint = this.bridge.getStatus().endpoint;
    const completed = () => {
      trusted(); this.inventory.check(fence);
      if (originEpoch !== this.originEpoch || this.bridge.getStatus().endpoint !== endpoint) throw new Error(CHANGED);
    };
    return this.exclusive(() => this.imports.send(this.bridge, params, check, completed));
  }
  warning() { return this.imports.getCleanupWarning(); }
  async shutdown() {
    await this.invalidate();
    if (this.operation) { try { await this.operation; } catch {} }
    await this.imports.clear();
  }
}
module.exports = { AttachmentSession, scopeValue };
