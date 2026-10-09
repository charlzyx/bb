const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { validateRequest } = require('./bridge.cjs');

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
class AttachmentSelections {
  constructor() { this.files = new Map(); this.epoch = 0; }
  clear() { this.epoch++; this.files.clear(); }
  async add(paths) {
    const epoch = this.epoch;
    if (!Array.isArray(paths) || paths.length > 10) throw new Error('Choose up to ten files');
    if (this.files.size + paths.length > 50) throw new Error('Too many selected files. Reconnect to clear unused selections.');
    const added = [];
    for (const chosen of paths) {
      const realPath = await fs.realpath(chosen);
      const stat = await fs.stat(realPath);
      if (!stat.isFile() || stat.size > MAX_ATTACHMENT_BYTES) throw new Error('Each attachment must be a regular file no larger than 100 MiB');
      const id = randomBytes(16).toString('hex');
      const name = path.basename(chosen);
      const record = { id, name, path: realPath, size: stat.size, ino: stat.ino, dev: stat.dev, mtimeMs: stat.mtimeMs, busy: false };
      added.push(record);
    }
    if (epoch !== this.epoch) throw new Error('The attachment selection changed. Choose the files again.');
    for (const record of added) this.files.set(record.id, record);
    return added.map(({ id, name, size }) => ({ id, name, size }));
  }
  async send(bridge, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid attachment message');
    const epoch = this.epoch;
    const connection = bridge.getStatus();
    if (connection.status !== 'connected') throw new Error('Lorca is not connected. The files were not sent.');
    const { selection_ids: ids, ...base } = input;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) throw new Error('Choose one to ten distinct attachments');
    const text = base.text ?? '';
    const empty = typeof text === 'string' && !text.trim();
    const params = validateRequest('chats.send', { ...base, text: empty ? '[attachment]' : text });
    if (empty) params.text = '';
    const records = ids.map(id => {
      const record = this.files.get(id);
      if (!record || record.busy) throw new Error('This attachment selection is unavailable. Choose the file again.');
      return record;
    });
    for (const record of records) record.busy = true;
    try {
      for (const record of records) {
        const stat = await fs.stat(record.path);
        if (!stat.isFile() || stat.size !== record.size || stat.size > MAX_ATTACHMENT_BYTES || stat.ino !== record.ino || stat.dev !== record.dev || stat.mtimeMs !== record.mtimeMs) throw new Error('A selected file changed. Choose it again before sending.');
      }
      if (epoch !== this.epoch) throw new Error('The attachment selection changed. The files were not sent.');
      const current = bridge.getStatus();
      if (current.generation !== connection.generation || current.endpoint !== connection.endpoint || current.status !== 'connected') throw new Error('The Lorca connection changed. The files were not sent.');
      const result = await bridge.sendValidated('chats.send', { ...params, attachments: records.map(record => ({ path: record.path, name: record.name, id: `att-${record.id}` })) });
      for (const record of records) this.files.delete(record.id);
      return result;
    } finally { for (const record of records) record.busy = false; }
  }
}
module.exports = { AttachmentSelections, MAX_ATTACHMENT_BYTES };
