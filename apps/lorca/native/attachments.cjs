const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { validateRequest } = require('./bridge.cjs');

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
class AttachmentSelections {
  constructor() { this.files = new Map(); this.epoch = 0; }
  clear() { this.epoch++; this.files.clear(); }
  release(ids) {
    if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))) throw new Error('附件选择标识无效');
    for (const id of ids) if (!this.files.get(id)?.busy) this.files.delete(id);
  }
  async add(paths) {
    const epoch = this.epoch;
    if (!Array.isArray(paths) || paths.length > 10) throw new Error('最多可选择十个文件');
    if (this.files.size + paths.length > 50) throw new Error('已选文件过多，请重新连接以清除未使用的选择');
    const added = [];
    for (const chosen of paths) {
      const realPath = await fs.realpath(chosen);
      const stat = await fs.stat(realPath);
      if (!stat.isFile() || stat.size > MAX_ATTACHMENT_BYTES) throw new Error('每个附件必须是普通文件，且不超过 100 MiB');
      const id = randomBytes(16).toString('hex');
      const name = path.basename(chosen);
      const record = { id, name, path: realPath, size: stat.size, ino: stat.ino, dev: stat.dev, mtimeMs: stat.mtimeMs, busy: false };
      added.push(record);
    }
    if (epoch !== this.epoch) throw new Error('附件选择已变化，请重新选择文件');
    for (const record of added) this.files.set(record.id, record);
    return added.map(({ id, name, size }) => ({ id, name, size }));
  }
  async send(bridge, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('附件消息无效');
    const epoch = this.epoch;
    const connection = bridge.getStatus();
    if (connection.status !== 'connected') throw new Error('尚未连接 Lorca，文件未发送');
    const { selection_ids: ids, ...base } = input;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) throw new Error('请选择一到十个不同的附件');
    const text = base.text ?? '';
    const empty = typeof text === 'string' && !text.trim();
    const params = validateRequest('chats.send', { ...base, text: empty ? '[attachment]' : text });
    if (empty) params.text = '';
    const records = ids.map(id => {
      const record = this.files.get(id);
      if (!record || record.busy) throw new Error('此附件选择已不可用，请重新选择文件');
      return record;
    });
    for (const record of records) record.busy = true;
    try {
      for (const record of records) {
        const stat = await fs.stat(record.path);
        if (!stat.isFile() || stat.size !== record.size || stat.size > MAX_ATTACHMENT_BYTES || stat.ino !== record.ino || stat.dev !== record.dev || stat.mtimeMs !== record.mtimeMs) throw new Error('所选文件已变化，请重新选择后再发送');
      }
      if (epoch !== this.epoch) throw new Error('附件选择已变化，文件未发送');
      const current = bridge.getStatus();
      if (current.generation !== connection.generation || current.endpoint !== connection.endpoint || current.status !== 'connected') throw new Error('Lorca 连接已变化，文件未发送');
      const result = await bridge.sendValidated('chats.send', { ...params, attachments: records.map(record => ({ path: record.path, name: record.name, id: `att-${record.id}` })) });
      for (const record of records) this.files.delete(record.id);
      return result;
    } finally { for (const record of records) record.busy = false; }
  }
}
module.exports = { AttachmentSelections, MAX_ATTACHMENT_BYTES };
