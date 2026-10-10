const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { botPresentation, rasterHeader, MAX_BYTES: MAX_AVATAR_BYTES } = require('./bot-avatars.cjs');

const INVALID = '智能体编辑参数或响应无效，请刷新后重试';
const STALE = '智能体资料已变化或编辑已过期，请刷新后重新编辑';
const CHANGED = '智能体所属账号、连接或选择已变化，请重新打开详情';
const READ_ERROR = '无法读取智能体详情，请检查连接和运行设备后重试';
const WRITE_ERROR = '无法完成智能体编辑，未发送变更，请刷新后重试';
const CONFLICT = '记忆已变化，请重新读取并合并修改；未覆盖现有内容';
const MEMORY_SIZE = '记忆正文不完整或超过 256 KiB，无法安全编辑';
const BUSY = '另一项智能体操作仍在进行，请等待结果';
const AVATAR_ERROR = '无法处理头像，请选择不超过 4 MiB、边长不超过 2048 像素的 PNG、JPEG 或 WebP 普通图片';
const AVATAR_CLEANUP = '头像操作已结束，但私有暂存文件尚未清理完成；请稍后关闭详情重试清理';
const MAX_MEMORY_BYTES = 256 * 1024;
const ACCENTS = new Set(['indigo', 'blue', 'teal', 'green', 'orange', 'pink', 'purple', 'red']);
const PROFILE_KEYS = ['name', 'description', 'symbolName', 'accent', 'provider', 'model', 'thinking', 'runnerId'];
const SAFE_ERRORS = new Set([INVALID, STALE, CHANGED, READ_ERROR, WRITE_ERROR, CONFLICT, MEMORY_SIZE, BUSY, AVATAR_ERROR]);
const WIRE_KEYS = { symbolName: 'symbol_name', runnerId: 'runner_id' };
function fail(message = INVALID) { throw new Error(message); }
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || (allowed && Object.keys(value).some(key => !allowed.includes(key)))) fail();
  return value;
}
function text(value, maximum = 256, empty = false) {
  if (typeof value !== 'string' || value.length > maximum || /[\0\r]/.test(value) || (!empty && !value.trim())) fail();
  return value;
}
function id(value) { const result = text(value); if (result !== result.trim() || result.includes('\n')) fail(); return result; }
function description(value) { if (typeof value !== 'string' || value.length > 20_000 || value.includes('\0')) fail(); return value; }
function list(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) fail();
  return Array.from(value, item => { if (item === undefined) fail(); return item; });
}
function unique(values) { if (new Set(values.map(value => value.id)).size !== values.length) fail(); return values; }
function flag(value) { if (typeof value !== 'boolean') fail(); return value; }
function count(value, maximum = MAX_MEMORY_BYTES) { if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(); return value; }
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function memoryHash(value) { return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32); }
function memoryText(value) {
  if (typeof value !== 'string' || value.length > MAX_MEMORY_BYTES || value.includes('\0') || Buffer.byteLength(value, 'utf8') > MAX_MEMORY_BYTES || Buffer.from(value, 'utf8').toString('utf8') !== value) fail(MEMORY_SIZE);
  return value;
}
function hashValue(value) { if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) fail(); return value; }
function visible(value) { return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, value => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`); }
function profile(value, scope) {
  const input = object(value), look = botPresentation(input, scope);
  return { id: id(input.id), name: text(input.name), description: description(input.description ?? ''), symbolName: look.symbol_name, accent: look.accent,
    provider: input.provider == null ? null : id(input.provider), model: input.model == null ? null : text(input.model, 256, true), thinking: input.thinking == null ? null : text(input.thinking, 256, true),
    runnerId: input.runner_id === '' ? '' : id(input.runner_id), hasAvatar: look.has_avatar, avatarVersion: look.avatar_version };
}
function roster(value) {
  const input = object(value);
  if (input.has_identity !== true) fail(READ_ERROR);
  id(input.identity_id);
  const runners = unique(list(input.devices, 128).filter(value => {
    const device = object(value); return device.unknown !== true && ['macos', 'linux', 'windows'].includes(device.os);
  }).map(value => {
    if (!['online', 'offline'].includes(value.status)) fail();
    return { id: id(value.id), name: text(value.name), os: value.os, online: value.status === 'online' };
  }));
  const rawProviders = list(input.providers, 128).map(value => object(value));
  const providers = unique(rawProviders.filter(value => !['system-one', 'decisions'].includes(value.api)).map(value => ({ id: id(value.kind), name: text(value.name ?? value.kind), connected: flag(value.is_connected) })));
  const models = new Map();
  const add = value => {
    const item = object(value);
    if (item.decides === true || !providers.some(provider => provider.id === item.provider)) return;
    const model = { provider: id(item.provider), id: id(item.id), name: text(item.name ?? item.id), levels: list(item.levels ?? [], 32).map(id) };
    models.set(`${model.provider}\0${model.id}`, model);
    if (models.size > 1000) fail();
  };
  list(input.models ?? [], 1000).forEach(add);
  for (const provider of rawProviders) for (const model of list(provider.models ?? [], 1000)) add({ ...object(model), provider: provider.kind });
  const bots = unique(list(input.bots, 1024).map(value => profile(value, `true:${input.identity_id}`)));
  return { bots, runners, providers, models: [...models.values()] };
}
function patch(value, create = false) {
  const input = object(value, PROFILE_KEYS), result = {};
  if (Object.keys(input).length === 0) fail();
  for (const key of PROFILE_KEYS) if (Object.hasOwn(input, key)) {
    if (key === 'name') result[key] = text(input[key]).trim();
    else if (key === 'description') result[key] = description(input[key]).trim();
    else if (key === 'symbolName') { if (typeof input[key] !== 'string' || !/^[A-Za-z0-9.]{1,80}$/.test(input[key])) fail(); result[key] = input[key]; }
    else if (key === 'accent') { if (!ACCENTS.has(input[key])) fail(); result[key] = input[key]; }
    else if (['model', 'thinking'].includes(key)) result[key] = text(input[key], 256, true).trim();
    else result[key] = id(input[key]);
  }
  if (create) {
    if (!result.name || !result.runnerId) fail();
    return { description: '', symbolName: 'sparkles', accent: 'indigo', provider: 'deepseek', model: '', thinking: '', ...result };
  }
  return result;
}
function validateAgentAction(value) {
  const input = object(value), kind = input.kind;
  if (kind === 'profile.save') { object(input, ['kind', 'revision', 'patch']); return { kind, revision: id(input.revision), patch: patch(input.patch) }; }
  if (kind === 'agent.create') { object(input, ['kind', 'revision', 'profile']); return { kind, revision: id(input.revision), profile: patch(input.profile, true) }; }
  if (['avatar.replace', 'avatar.remove'].includes(kind)) { object(input, ['kind', 'revision']); return { kind, revision: id(input.revision) }; }
  if (kind === 'memory.save') {
    object(input, ['kind', 'revision', 'text', 'expectedHash']);
    const content = memoryText(input.text);
    return { kind, revision: id(input.revision), text: content, expectedHash: hashValue(input.expectedHash) };
  }
  fail();
}
function memory(value, bot) {
  const input = object(value), index = object(input.index);
  if (id(input.bot_id) !== bot.id) fail();
  const content = memoryText(index.text);
  if (index.bytes !== Buffer.byteLength(content, 'utf8') || hashValue(index.hash) !== memoryHash(content)) fail(MEMORY_SIZE);
  const result = { botId: bot.id, runnerId: bot.runnerId, text: content, hash: index.hash, lines: count(index.lines), bytes: count(index.bytes), truncated: flag(index.truncated), maxLines: count(index.max_lines), maxBytes: count(index.max_bytes),
    topics: list(input.topics, 2048).map(value => text(value, 128)), logs: list(input.logs, 4096).map(value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(); return value; }) };
  if (result.maxLines === 0 || result.maxBytes === 0) fail();
  return result;
}
function configuration(bot) { return hash(bot); }
function selectionContext(status) { return JSON.stringify([status.endpoint ?? null, status.authMode]); }
function sameFile(before, after) { return after.isFile() && !after.isSymbolicLink() && after.nlink === 1 && before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs; }
async function readAvatarFile(filePath, check) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.length > 32768 || filePath.includes('\0')) fail(AVATAR_ERROR);
  const original = await fs.lstat(filePath); check();
  if (!original.isFile() || original.isSymbolicLink() || original.nlink !== 1 || original.size < 1 || original.size > MAX_AVATAR_BYTES) fail(AVATAR_ERROR);
  const realPath = await fs.realpath(filePath); check();
  const visible = await fs.lstat(realPath); check();
  if (!sameFile(original, visible)) fail(AVATAR_ERROR);
  const handle = await fs.open(realPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    check();
    const before = await handle.stat(); check();
    if (!sameFile(visible, before)) fail(AVATAR_ERROR);
    const bytes = Buffer.alloc(before.size + 1); let used = 0;
    while (used < bytes.length) {
      const part = await handle.read(bytes, used, bytes.length - used, used); check();
      if (!part.bytesRead) break;
      used += part.bytesRead;
    }
    const after = await handle.stat(); check();
    const finalVisible = await fs.lstat(realPath); check();
    const finalOriginal = await fs.lstat(filePath); check();
    const finalPath = await fs.realpath(filePath); check();
    if (used !== before.size || !sameFile(before, after) || !sameFile(before, finalVisible) || !sameFile(before, finalOriginal) || finalPath !== realPath) fail(AVATAR_ERROR);
    return bytes.subarray(0, used);
  } finally { await handle.close(); }
}
function encodedAvatar(bytes, nativeImage) {
  const header = rasterHeader(bytes), decoded = nativeImage.createFromBuffer(bytes);
  if (decoded.isEmpty()) fail(AVATAR_ERROR);
  const actual = decoded.getSize();
  if (actual.width !== header.width || actual.height !== header.height) fail(AVATAR_ERROR);
  const side = Math.min(actual.width, actual.height), outputSide = Math.min(side, 512);
  const image = decoded.crop({ x: Math.floor((actual.width - side) / 2), y: Math.floor((actual.height - side) / 2), width: side, height: side }).resize({ width: outputSide, height: outputSide, quality: 'good' });
  const png = image.toPNG();
  if (!Buffer.isBuffer(png) || png.length < 1 || png.length > 2 * 1024 * 1024) fail(AVATAR_ERROR);
  const output = rasterHeader(png);
  if (output.mime !== 'image/png' || output.width !== outputSide || output.height !== outputSide) fail(AVATAR_ERROR);
  return { png, width: outputSide, height: outputSide };
}
class AgentDetails {
  constructor(bridge, inventory, { confirm, chooseAvatar, reviewAvatar, nativeImage, temporaryDirectory = os.tmpdir(), now = Date.now } = {}) {
    this.bridge = bridge; this.inventory = inventory; this.confirm = confirm; this.now = now; this.entries = new Map(); this.epoch = 0; this.busy = false; this.disposed = false;
    if (typeof temporaryDirectory !== 'string' || !path.isAbsolute(temporaryDirectory)) fail();
    this.chooseAvatar = chooseAvatar; this.reviewAvatar = reviewAvatar; this.nativeImage = nativeImage; this.temporaryDirectory = temporaryDirectory; this.avatarFiles = new Map(); this.cleanupWarning = null; this.whenIdle = Promise.resolve();
  }
  invalidate() { ++this.epoch; this.entries.clear(); }
  dispose() { this.disposed = true; this.invalidate(); return this.whenIdle.then(() => this.cleanupAvatars()); }
  canEditAvatar() { return typeof this.confirm === 'function' && typeof this.chooseAvatar === 'function' && typeof this.reviewAvatar === 'function' && typeof this.nativeImage?.createFromBuffer === 'function'; }
  getCleanupWarning() { return this.cleanupWarning; }
  async cleanupAvatars() {
    for (const [nonce, file] of this.avatarFiles) if (!file.active) {
      try { await fs.rm(file.directory, { recursive: true, force: true }); this.avatarFiles.delete(nonce); }
      catch { this.cleanupWarning = AVATAR_CLEANUP; }
    }
    if (this.avatarFiles.size === 0) this.cleanupWarning = null;
  }
  async releaseAvatar(file) { if (file) file.active = false; await this.cleanupAvatars(); }
  async prepareAvatar(entry, trusted) {
    const check = () => this.guard(entry, trusted);
    check(); await this.cleanupAvatars(); check();
    if (this.avatarFiles.size > 0 || !this.canEditAvatar()) fail(AVATAR_ERROR);
    const chosen = object(await this.chooseAvatar(check)); check();
    if (chosen.canceled === true) return null;
    if (chosen.canceled !== false || !Array.isArray(chosen.filePaths) || chosen.filePaths.length !== 1) fail(AVATAR_ERROR);
    let file;
    try {
      const bytes = await readAvatarFile(chosen.filePaths[0], check); check();
      const encoded = encodedAvatar(bytes, this.nativeImage); check();
      const directory = await fs.mkdtemp(path.join(this.temporaryDirectory, 'dots-agent-avatar-'));
      file = { nonce: randomUUID(), directory, path: path.join(directory, 'avatar.png'), active: true, png: encoded.png, width: encoded.width, height: encoded.height, digest: createHash('sha256').update(encoded.png).digest('hex') };
      this.avatarFiles.set(file.nonce, file); check();
      await fs.chmod(directory, 0o700); check();
      const handle = await fs.open(file.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { check(); await handle.writeFile(encoded.png); check(); } finally { await handle.close(); }
      check(); return file;
    } catch (error) {
      await this.releaseAvatar(file);
      if (SAFE_ERRORS.has(error?.message)) throw error;
      fail(AVATAR_ERROR);
    }
  }
  async verifyAvatar(file, entry, trusted) {
    const check = () => this.guard(entry, trusted);
    check();
    if (!file?.active || this.avatarFiles.get(file.nonce) !== file) fail(STALE);
    const content = await readAvatarFile(file.path, check); check();
    if (createHash('sha256').update(content).digest('hex') !== file.digest) fail(AVATAR_ERROR);
  }
  capture() {
    const fence = this.inventory.capture(), status = this.inventory.check(fence);
    if (!['token', 'legacy'].includes(status.authMode)) fail(CHANGED);
    return { fence, context: selectionContext(status), epoch: this.epoch, expires: this.now() + 5 * 60_000 };
  }
  guard(entry, trusted) {
    try {
      if (this.disposed || entry.epoch !== this.epoch) fail(CHANGED);
      trusted();
      const status = this.inventory.check(entry.fence);
      if (selectionContext(status) !== entry.context) fail(CHANGED);
    } catch { fail(CHANGED); }
    if (this.now() >= entry.expires) fail(STALE);
  }
  entry(revision) { const entry = this.entries.get(revision); if (!entry) fail(STALE); return entry; }
  check(revision, trusted = () => {}) { this.guard(this.entry(id(revision)), trusted); }
  ticket(entry) { const revision = randomUUID(); while (this.entries.size >= 4) this.entries.delete(this.entries.keys().next().value); this.entries.set(revision, entry); return revision; }
  async read(entry, trusted) {
    this.guard(entry, trusted);
    const raw = await this.bridge.sendValidated('bootstrap', {});
    this.guard(entry, trusted); this.inventory.observeSnapshot(raw); this.guard(entry, trusted);
    return roster(raw);
  }
  target(entry, state) {
    if (!entry.bot) return null;
    const bot = state.bots.find(bot => bot.id === entry.bot.id);
    if (!bot || configuration(bot) !== entry.version) fail(STALE);
    return bot;
  }
  async get(params = {}, trusted = () => {}) {
    object(params, ['botId']); const botId = params.botId === undefined ? null : id(params.botId);
    if (this.busy) fail(BUSY);
    this.busy = true; this.invalidate();
    try {
      const entry = this.capture(), state = await this.read(entry, trusted);
      const bot = botId === null ? null : state.bots.find(bot => bot.id === botId);
      if (botId !== null && !bot) fail(STALE);
      entry.bot = bot; entry.version = configuration(bot); entry.kind = 'profile';
      return { revision: this.ticket(entry), version: entry.version, bot, runners: state.runners, providers: state.providers, models: state.models, canCreate: bot === null && state.runners.length > 0, canEditAvatar: bot !== null && this.canEditAvatar() };
    } catch (error) { if (SAFE_ERRORS.has(error?.message)) throw error; fail(READ_ERROR); }
    finally { this.busy = false; }
  }
  async readMemory(entry, trusted) {
    const state = await this.read(entry, trusted), bot = this.target(entry, state);
    if (!bot || !state.runners.some(runner => runner.id === bot.runnerId)) fail(STALE);
    this.guard(entry, trusted);
    const raw = await this.bridge.sendValidated('bots.memory', { bot_id: bot.id });
    this.guard(entry, trusted);
    const result = memory(raw, bot);
    const latest = await this.read(entry, trusted);
    this.target(entry, latest);
    if (!latest.runners.some(runner => runner.id === bot.runnerId)) fail(STALE);
    return result;
  }
  async getMemory(params, trusted = () => {}) {
    object(params, ['revision']); const entry = this.entry(id(params.revision));
    if (entry.kind !== 'profile' || !entry.bot) fail();
    if (this.busy) fail(BUSY);
    this.busy = true;
    try {
      const result = await this.readMemory(entry, trusted);
      const memoryEntry = { ...entry, kind: 'memory', memory: result };
      return { ...result, revision: this.ticket(memoryEntry), version: hash([result.botId, result.runnerId, result.hash]) };
    } catch (error) { if (SAFE_ERRORS.has(error?.message)) throw error; fail(READ_ERROR); }
    finally { this.busy = false; }
  }
  validateProfile(change, entry, state, create) {
    const bot = this.target(entry, state);
    if (create ? bot !== null : bot === null) fail();
    const effective = { ...bot, ...change };
    const runners = [];
    if (create || Object.hasOwn(change, 'runnerId')) {
      const runner = state.runners.find(value => value.id === effective.runnerId);
      if (!runner) fail(INVALID);
      runners.push(runner);
      if (bot && bot.runnerId !== runner.id) { const previous = state.runners.find(value => value.id === bot.runnerId); if (previous) runners.push(previous); }
    }
    let provider = null, models = [];
    if (create || ['provider', 'model', 'thinking'].some(key => Object.hasOwn(change, key))) {
      provider = state.providers.find(value => value.id === effective.provider);
      models = state.models.filter(value => value.provider === effective.provider);
      if (!provider || models.length === 0) fail();
      const model = effective.model ? models.find(value => value.id === effective.model) : models[0];
      if (!model || (effective.thinking && !model.levels.includes(effective.thinking))) fail();
    }
    return { bot, effective, reviewVersion: hash({ runners, provider, models }) };
  }
  async apply(value, trusted = () => {}) {
    const action = validateAgentAction(value), entry = this.entry(action.revision);
    if (this.busy) fail(BUSY);
    if (typeof this.confirm !== 'function') fail(WRITE_ERROR);
    if ((action.kind === 'memory.save') !== (entry.kind === 'memory') || (action.kind === 'agent.create') !== (entry.bot === null)) fail();
    this.guard(entry, trusted); this.entries.delete(action.revision); this.busy = true;
    let submitted = false, avatar, finish;
    this.whenIdle = new Promise(resolve => { finish = resolve; });
    const botId = entry.bot?.id ?? `bot-${randomUUID()}`;
    try {
      let mutation, reviewVersion, detail;
      const state = await this.read(entry, trusted);
      if (action.kind.startsWith('avatar.')) {
        if (!this.canEditAvatar() || !this.target(entry, state)) fail(AVATAR_ERROR);
        if (action.kind === 'avatar.replace') {
          avatar = await this.prepareAvatar(entry, trusted);
          if (!avatar) return { status: 'cancelled', botId };
          const saved = await this.reviewAvatar({ title: '更换智能体头像', botId, botName: entry.bot.name, previewDataUrl: `data:image/png;base64,${avatar.png.toString('base64')}`, width: avatar.width, height: avatar.height, size: avatar.png.length }, () => this.guard(entry, trusted));
          this.guard(entry, trusted);
          if (saved !== true) return { status: 'cancelled', botId };
          mutation = { method: 'bots.update', params: { id: botId, avatar: { id: `att-${randomUUID().replaceAll('-', '')}`, path: avatar.path, name: 'avatar.png', mime: 'image/png', width: avatar.width, height: avatar.height } } };
          detail = `将更换智能体 ${JSON.stringify(entry.bot.name)}（${botId}）的头像，影响所有使用此智能体的聊天，并同步至同账号的配对设备。仅上传隔离预览中的 ${avatar.width} × ${avatar.height} PNG（${avatar.png.length} 字节），不上传原始图片或原文件名。后端先上传图片再更新资料；后一步失败也可能留下图片副本，无法承诺整体回滚。`;
        } else {
          if (!entry.bot.hasAvatar) fail(STALE);
          mutation = { method: 'bots.update', params: { id: botId, avatar: null } };
          detail = `将移除智能体 ${JSON.stringify(entry.bot.name)}（${botId}）的自定义头像，恢复图标与颜色外观，影响所有使用此智能体的聊天，并同步至同账号的配对设备。后端可能删除不再使用的头像副本。`;
        }
      } else if (action.kind === 'memory.save') {
        if (action.expectedHash !== entry.memory.hash) fail(CONFLICT);
        const current = await this.readMemory(entry, trusted);
        if (current.hash !== entry.memory.hash) fail(CONFLICT);
        detail = `将修改智能体 ${JSON.stringify(entry.bot.name)}（${botId}）在执行器 ${entry.bot.runnerId} 的 MEMORY.md，影响该智能体的所有聊天。超出加载预算的部分不会在每轮自动载入；不会迁移其他执行器的记忆。\n\n保存前完整正文：\n${current.text}\n\n拟保存完整正文：\n${action.text}`;
        mutation = { method: 'bots.memory.write', params: { bot_id: botId, text: action.text, expected_hash: entry.memory.hash } };
      } else {
        const create = action.kind === 'agent.create', change = create ? action.profile : action.patch;
        const checked = this.validateProfile(change, entry, state, create); reviewVersion = checked.reviewVersion;
        const labels = { name: '名称', description: '说明', symbolName: '图标', accent: '颜色', provider: '服务商', model: '模型', thinking: '推理强度', runnerId: '执行器' };
        const show = (key, value) => {
          if (['model', 'thinking'].includes(key) && !value) return '默认';
          if (key === 'runnerId') { const runner = state.runners.find(runner => runner.id === value); return runner ? `${JSON.stringify(runner.name)}（${runner.id}，${runner.online ? '在线' : '离线'}）` : JSON.stringify(value || '未分配'); }
          if (key === 'provider') { const provider = state.providers.find(provider => provider.id === value); return provider ? `${JSON.stringify(provider.name)}（${provider.id}，${provider.connected ? '已连接' : '未连接'}）` : JSON.stringify(value || '默认'); }
          return JSON.stringify(value ?? '默认');
        };
        detail = create ? `将创建智能体 ${JSON.stringify(change.name)}（${botId}）及其私聊。创建本身不发送消息。新智能体沿用后端默认完整访问权限，可能读取或修改文件、调用工具或运行程序；依自动审查规则处理，不保证每次再次询问。` : `将修改智能体 ${JSON.stringify(entry.bot.name)}（${botId}），影响所有使用此智能体的聊天。执行器变更不会迁移正在运行的任务、工作区文件或记忆。`;
        detail += `\n\n${Object.keys(change).map(key => `${labels[key]}：${create ? '' : `${show(key, entry.bot[key])} → `}${show(key, change[key])}`).join('\n')}`;
        mutation = { method: create ? 'bots.create' : 'bots.update', params: { id: botId, ...Object.fromEntries(Object.entries(change).map(([key, value]) => [WIRE_KEYS[key] ?? key, value])) } };
      }
      if (this.bridge.getStatus().authMode === 'legacy') detail += '\n\n本地兼容连接不校验令牌，无法认证本机服务，请仅继续使用你信任的服务。';
      detail += '\n\n仅提交一次；结果未知时不会自动重发。';
      const confirmed = await this.confirm({ title: '确认智能体变更', message: visible(action.kind === 'agent.create' ? `创建 ${action.profile.name}？` : `保存 ${entry.bot.name} 的变更？`), detail: visible(detail) }, () => this.guard(entry, trusted));
      this.guard(entry, trusted);
      if (confirmed !== true) return { status: 'cancelled', botId };
      if (avatar) await this.verifyAvatar(avatar, entry, trusted);
      const latest = await this.read(entry, trusted);
      if (action.kind.startsWith('avatar.')) {
        this.target(entry, latest);
      } else if (action.kind === 'memory.save') {
        this.target(entry, latest);
        const current = await this.readMemory(entry, trusted);
        if (current.hash !== entry.memory.hash) fail(CONFLICT);
      } else if (this.validateProfile(action.kind === 'agent.create' ? action.profile : action.patch, entry, latest, action.kind === 'agent.create').reviewVersion !== reviewVersion) fail(STALE);
      this.guard(entry, trusted); submitted = true;
      const result = await this.bridge.sendValidated(mutation.method, mutation.params);
      this.guard(entry, trusted); object(result);
      if (action.kind === 'memory.save') hashValue(result.hash);
      else if (id(object(result.bot).id) !== botId) fail();
      const chatId = action.kind === 'agent.create' ? id(result.chat_id) : undefined;
      this.entries.clear();
      return { status: 'applied', botId, ...(chatId ? { chatId } : {}) };
    } catch (error) {
      if (submitted) {
        this.entries.clear();
        if (action.kind === 'memory.save' && error?.code === 'LORCA_REMOTE_ERROR' && error.message === 'MEMORY.md changed since you opened it. Reload it and apply only your change.') fail(CONFLICT);
        return { status: 'unknownOutcome', botId };
      }
      if (SAFE_ERRORS.has(error?.message)) throw error;
      fail(WRITE_ERROR);
    } finally { await this.releaseAvatar(avatar); this.busy = false; finish(); }
  }
}
module.exports = { AgentDetails, validateAgentAction, MAX_MEMORY_BYTES };
