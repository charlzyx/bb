const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_DIMENSION = 2048;
const MAX_PIXELS = 4 * 1024 * 1024;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const ACCENTS = new Set(['indigo', 'blue', 'teal', 'green', 'orange', 'pink', 'purple', 'red']);
const MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const CHANGED = '头像所属账号、连接或机器人已变化';
function dimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) throw new Error('头像尺寸不受支持');
  return { width, height };
}
function avatarDescriptor(value, scope = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { id, mime, size, width, height } = value;
  if (typeof id !== 'string' || !/^att-[A-Za-z0-9-]+$/.test(id) || id.length > 48 || !MIME.has(mime) || !Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES) return null;
  if (width != null && (!Number.isInteger(width) || width < 1 || width > MAX_DIMENSION)) return null;
  if (height != null && (!Number.isInteger(height) || height < 1 || height > MAX_DIMENSION)) return null;
  if (width != null && height != null && width * height > MAX_PIXELS) return null;
  const attachment = { id, mime, size, width: width ?? null, height: height ?? null };
  return { ...attachment, version: createHash('sha256').update(`${scope}\0${JSON.stringify(attachment)}`).digest('hex').slice(0, 24) };
}
function botPresentation(value, scope = '') {
  const avatar = avatarDescriptor(value.avatar, scope);
  return {
    symbol_name: typeof value.symbol_name === 'string' && /^[A-Za-z0-9.]{1,80}$/.test(value.symbol_name) ? value.symbol_name : 'sparkles',
    accent: ACCENTS.has(value.accent) ? value.accent : 'indigo',
    has_avatar: avatar !== null,
    avatar_version: avatar?.version ?? null,
  };
}
function rasterHeader(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.length > MAX_BYTES) throw new Error('头像文件不受支持');
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (bytes.length < 33 || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('头像文件不受支持');
    const size = dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    let offset = 8, chunks = 0, hasPixels = false;
    while (offset + 12 <= bytes.length && ++chunks <= 4096) {
      const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
      if (length > bytes.length - offset - 12 || !/^[A-Za-z]{4}$/.test(kind) || ['acTL', 'fcTL', 'fdAT'].includes(kind) || (kind === 'IHDR' && offset !== 8)) break;
      if (kind === 'IDAT') hasPixels = true;
      offset += length + 12;
      if (kind === 'IEND') {
        if (length !== 0 || !hasPixels || offset !== bytes.length) break;
        return { mime: 'image/png', ...size };
      }
    }
    throw new Error('头像文件不受支持');
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2, size = null;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) throw new Error('头像文件不受支持');
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9) break;
      if (marker === 0xda) {
        if (!size) break;
        return { mime: 'image/jpeg', ...size };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (![0xc0, 0xc1, 0xc2].includes(marker) || size || length < 8) break;
        size = dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
      }
      offset += length;
    }
    throw new Error('头像文件不受支持');
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    if (bytes.readUInt32LE(4) !== bytes.length - 8) throw new Error('头像文件不受支持');
    let offset = 12, canvas = null, size = null, chunks = 0;
    while (offset + 8 <= bytes.length && ++chunks <= 256) {
      const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8;
      if (length > bytes.length - start) throw new Error('头像文件不受支持');
      if (kind === 'VP8X') {
        if (canvas || length !== 10 || (bytes[start] & 2)) throw new Error('头像文件不受支持');
        canvas = dimensions(bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1);
      } else if (kind === 'VP8 ') {
        if (size || length < 10 || (bytes[start] & 1) || bytes.toString('hex', start + 3, start + 6) !== '9d012a') throw new Error('头像文件不受支持');
        size = dimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff);
      } else if (kind === 'VP8L') {
        if (size || length < 5 || bytes[start] !== 0x2f) throw new Error('头像文件不受支持');
        const bits = bytes.readUInt32LE(start + 1);
        size = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      } else if (!['ALPH', 'ICCP', 'EXIF', 'XMP '].includes(kind)) throw new Error('头像文件不受支持');
      offset = start + length + (length & 1);
    }
    if (offset !== bytes.length || !size || (canvas && (canvas.width !== size.width || canvas.height !== size.height))) throw new Error('头像文件不受支持');
    return { mime: 'image/webp', ...size };
  }
  throw new Error('头像文件不受支持');
}
async function readCachedAvatar(home, attachment, check) {
  if (typeof home !== 'string' || !path.isAbsolute(home)) return null;
  const root = await fs.realpath(home); check();
  const directory = path.join(root, 'files');
  const directoryStat = await fs.lstat(directory); check();
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || await fs.realpath(directory) !== directory) return null;
  check();
  const expected = path.join(directory, attachment.id);
  if (await fs.realpath(expected) !== expected) return null;
  check();
  const initial = await fs.lstat(expected); check();
  if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1) return null;
  const handle = await fs.open(expected, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    check();
    const before = await handle.stat(); check();
    if (!before.isFile() || before.nlink !== 1 || before.size !== attachment.size || before.size < 1 || before.size > MAX_BYTES) return null;
    const bytes = Buffer.alloc(before.size + 1);
    let used = 0;
    while (used < bytes.length) {
      const result = await handle.read(bytes, used, bytes.length - used, used); check();
      if (!result.bytesRead) break;
      used += result.bytesRead;
    }
    const after = await handle.stat(); check();
    const visible = await fs.lstat(expected); check();
    const actual = await fs.realpath(expected); check();
    if (used !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || actual !== expected || visible.isSymbolicLink() || visible.ino !== before.ino || visible.dev !== before.dev) return null;
    return bytes.subarray(0, used);
  } finally { await handle.close(); }
}
class BotAvatars {
  constructor(bridge, nativeImage) {
    this.bridge = bridge; this.nativeImage = nativeImage;
    this.epoch = 0; this.identity = undefined; this.bots = new Map(); this.cache = new Map(); this.pending = new Map(); this.cacheBytes = 0; this.activeLoads = 0;
    this.generation = bridge.getStatus().generation;
    this.onEvent = event => {
      if (event.event === 'identity.changed') this.clear();
      else if (event.event === 'snapshot') this.observeSnapshot(event.data);
      else if (event.event === 'roster.changed') this.observeBots(event.data?.bots);
    };
    this.onStatus = status => {
      if (status.status !== 'connected' || status.generation !== this.generation) this.clear();
      this.generation = status.generation;
    };
    bridge.on('event', this.onEvent); bridge.on('status', this.onStatus);
  }
  clear() { this.epoch++; this.identity = undefined; this.bots.clear(); this.cache.clear(); this.pending.clear(); this.cacheBytes = 0; }
  dispose() { this.clear(); this.bridge.removeListener('event', this.onEvent); this.bridge.removeListener('status', this.onStatus); }
  observeSnapshot(value) {
    const identity = `${value?.has_identity === true}:${typeof value?.identity_id === 'string' ? value.identity_id : ''}`;
    if (this.identity !== undefined && this.identity !== identity) this.clear();
    this.identity = identity;
    this.observeBots(value?.has_identity === true ? value.bots : []);
  }
  observeBots(bots) {
    if (!Array.isArray(bots) || bots.length > 1024) { this.clear(); return; }
    const next = new Map();
    for (const bot of bots) {
      if (bot && typeof bot.id === 'string' && bot.id.length > 0 && bot.id.length <= 256) next.set(bot.id, avatarDescriptor(bot.avatar, this.identity ?? ''));
    }
    this.bots = next;
    for (const [key, item] of this.cache) if (next.get(key)?.version !== item.version) { this.cache.delete(key); this.cacheBytes -= item.bytes; }
  }
  async get(botId, expectedAvatarVersion, guard = () => {}) {
    guard();
    if (typeof expectedAvatarVersion !== 'string' || !/^[a-f0-9]{24}$/.test(expectedAvatarVersion) || typeof botId !== 'string' || !botId.trim() || botId.length > 256 || /[\0\r\n]/.test(botId)) throw new Error('机器人头像请求无效');
    const attachment = this.bots.get(botId);
    if (!attachment || attachment.version !== expectedAvatarVersion) return null;
    const generation = this.bridge.getStatus().generation, epoch = this.epoch;
    const check = () => {
      guard();
      const status = this.bridge.getStatus();
      if (status.status !== 'connected' || status.generation !== generation || epoch !== this.epoch || this.bots.get(botId)?.version !== attachment.version) throw new Error(CHANGED);
    };
    check();
    const cached = this.cache.get(botId);
    if (cached?.version === attachment.version && cached.expiresAt > Date.now()) { this.cache.delete(botId); this.cache.set(botId, cached); return cached.data; }
    if (cached) { this.cache.delete(botId); this.cacheBytes -= cached.bytes; }
    const key = `${botId}\0${attachment.version}`;
    let pending = this.pending.get(key);
    if (!pending) {
      if (this.activeLoads >= 4) return null;
      this.activeLoads++;
      pending = this.load(attachment, check).catch(() => { check(); return null; }).finally(() => { this.activeLoads--; });
      this.pending.set(key, pending);
    }
    try {
      const data = await pending; check();
      if (!this.cache.has(botId)) {
        const bytes = data ? Buffer.byteLength(data) : 0;
        while (this.cache.size >= 64 || this.cacheBytes + bytes > MAX_CACHE_BYTES) {
          const oldest = this.cache.keys().next().value;
          if (oldest === undefined) return null;
          this.cacheBytes -= this.cache.get(oldest).bytes; this.cache.delete(oldest);
        }
        this.cache.set(botId, { version: attachment.version, data, bytes, expiresAt: Date.now() + (data ? 60_000 : 5000) }); this.cacheBytes += bytes;
      }
      return data;
    } catch { check(); return null; }
    finally { if (this.pending.get(key) === pending) this.pending.delete(key); }
  }
  async load(attachment, check) {
    const bytes = await readCachedAvatar(this.bridge.home, attachment, check); check();
    if (!bytes) return null;
    const header = rasterHeader(bytes);
    if (header.mime !== attachment.mime || (attachment.width !== null && attachment.width !== header.width) || (attachment.height !== null && attachment.height !== header.height)) return null;
    const decoded = this.nativeImage.createFromBuffer(bytes);
    if (decoded.isEmpty()) return null;
    const size = decoded.getSize();
    dimensions(size.width, size.height);
    if (size.width !== header.width || size.height !== header.height) return null;
    const scale = Math.min(1, 256 / Math.max(size.width, size.height));
    const image = decoded.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' });
    const png = image.toPNG();
    if (png.length > 512 * 1024) return null;
    const output = rasterHeader(png);
    if (output.mime !== 'image/png' || output.width > 256 || output.height > 256) return null;
    check();
    return `data:image/png;base64,${png.toString('base64')}`;
  }
}
module.exports = { BotAvatars, avatarDescriptor, botPresentation, rasterHeader, MAX_BYTES };
