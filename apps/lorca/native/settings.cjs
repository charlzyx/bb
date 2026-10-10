const { botPresentation } = require('./bot-avatars.cjs');
const SETTINGS_ERROR = '无法读取 Lorca 设置，请重新连接后重试';
const CHANGED_ERROR = 'Lorca 账号或连接已变化，请刷新后再继续';
const PLUGIN_STATES = new Set(['ready', 'needs_setup', 'needs_auth', 'connecting', 'error', 'disabled', 'insufficient_access']);
function invalid() { throw new Error('Lorca 响应不兼容，或设置参数无效'); }
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  return value;
}
function text(value, maximum = 256, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) invalid();
  return value;
}
function id(value) { const result = text(value); if (!result.trim() || /[\r\n]/.test(result)) invalid(); return result; }
function nullableText(value, maximum = 256) { return value == null ? null : text(value, maximum); }
function boolean(value, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'boolean') invalid();
  return value;
}
function number(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) invalid();
  return value;
}
function count(value) {
  if (value == null) return null;
  const result = number(value, 1_000_000);
  if (!Number.isInteger(result)) invalid();
  return result;
}
function array(value, maximum, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}
function state(value) { const result = text(value, 64); return PLUGIN_STATES.has(result) ? result : 'unknown'; }
function bounded(value, maximum = 1_000_000) { if (JSON.stringify(value).length > maximum) invalid(); return value; }
function hasError(value) { return nullableText(value, 16_000) !== null && value !== ''; }
function validateSettingsParams(value = {}) {
  const input = object(value);
  if (Object.keys(input).some(key => !['runnerId', 'includeMcp'].includes(key))) invalid();
  if (input.includeMcp !== undefined && typeof input.includeMcp !== 'boolean') invalid();
  if (input.includeMcp === false && input.runnerId !== undefined) invalid();
  return { ...(input.runnerId === undefined ? {} : { runnerId: id(input.runnerId) }), ...(input.includeMcp === undefined ? {} : { includeMcp: input.includeMcp }) };
}
function projectPlugin(value) {
  const item = object(value);
  return { id: id(item.id), name: text(item.name), state: state(item.state), toolCount: null };
}
function projectDevice(value) {
  const item = object(value);
  if (!['online', 'offline'].includes(item.status)) invalid();
  return {
    id: id(item.id), name: text(item.name), os: text(item.os, 64), version: text(item.version, 128, ''),
    role: item.unknown === true ? 'unknown' : ['macos', 'linux', 'windows'].includes(item.os) ? 'runner' : ['ios', 'ipados', 'android'].includes(item.os) ? 'device' : 'unknown',
    online: item.status === 'online', isThisDevice: boolean(item.is_this_device, false),
    plugins: array(item.plugins, 128, []).map(projectPlugin),
  };
}
function projectProvider(value) {
  const item = object(value);
  const kind = id(item.kind);
  return { id: kind, name: item.name == null ? kind : text(item.name), connected: boolean(item.is_connected) };
}
function projectSettingsBootstrap(value, authMode) {
  const input = object(value);
  if (!['token', 'legacy'].includes(authMode)) invalid();
  return {
    version: text(input.version, 128), hasIdentity: boolean(input.has_identity),
    relayConnected: boolean(input.relay_connected), updateRequired: boolean(input.relay_update_required, false), authMode,
    devices: array(input.devices, 128).map(projectDevice),
    providers: array(input.providers, 128).map(projectProvider),
    bots: array(input.bots, 1000).map(value => {
      const item = object(value);
      return { id: id(item.id), name: text(item.name), runnerId: item.runner_id === '' ? '' : id(item.runner_id), provider: item.provider == null ? null : id(item.provider), model: nullableText(item.model) };
    }),
  };
}
function projectMcp(value, runnerId) {
  const input = object(value);
  return {
    status: 'ready', runnerId, hasConfigError: hasError(input.error),
    servers: array(input.servers, 512).map(value => {
      const item = object(value);
      const problem = hasError(item.problem);
      const enabled = boolean(item.enabled);
      const status = item.status == null ? null : projectPlugin(item.status);
      const transport = item.transport == null ? 'unknown' : text(item.transport, 64);
      return {
        name: text(item.name), transport: ['stdio', 'http'].includes(transport) ? transport : 'unknown', enabled,
        state: !enabled ? 'disabled' : problem ? 'error' : status?.state ?? 'unknown',
        toolCount: count(item.tool_count), hiddenToolCount: null,
        hasError: problem || status?.state === 'error',
      };
    }),
  };
}
class SettingsInventory {
  constructor(bridge) {
    this.bridge = bridge;
    this.epoch = 0;
    this.identity = undefined;
    this.pending = 0;
    this.listener = event => {
      if (event.event === 'identity.changed') { ++this.epoch; this.identity = undefined; }
      if (event.event === 'snapshot') {
        try { this.observeSnapshot(event.data); } catch { ++this.epoch; this.identity = undefined; }
      }
    };
    bridge.on('event', this.listener);
  }
  dispose() { this.bridge.removeListener('event', this.listener); }
  capture() { return { generation: this.bridge.getStatus().generation, epoch: this.epoch }; }
  check(fence) {
    const status = this.bridge.getStatus();
    if (status.status !== 'connected' || status.generation !== fence.generation || this.epoch !== fence.epoch) throw new Error(CHANGED_ERROR);
    return status;
  }
  observeSnapshot(value) {
    const input = object(value);
    const identity = `${boolean(input.has_identity)}:${nullableText(input.identity_id) ?? ''}`;
    if (this.identity !== undefined && identity !== this.identity) ++this.epoch;
    this.identity = identity;
    this.onSnapshot?.(value);
  }
  projectResult(method, value, fence) {
    this.check(fence);
    const projected = sanitizeRendererResult(method, value);
    if (method === 'bootstrap') this.observeSnapshot(value);
    return projected;
  }
  async get(input = {}) {
    const params = validateSettingsParams(input);
    if (this.pending >= 4) throw new Error(SETTINGS_ERROR);
    ++this.pending;
    const fence = this.capture();
    try {
      this.check(fence);
      const bootstrap = await this.bridge.sendValidated('bootstrap', {});
      const status = this.check(fence);
      this.observeSnapshot(bootstrap);
      this.check(fence);
      const settings = projectSettingsBootstrap(bootstrap, status.authMode);
      const selected = params.runnerId;
      if (selected !== undefined && !settings.devices.some(device => device.id === selected && device.role === 'runner')) invalid();
      const runnerId = params.includeMcp === false ? null : selected ?? settings.devices.find(device => device.isThisDevice && device.role === 'runner')?.id ?? null;
      let rawMcp = null;
      let mcp = { status: 'unavailable', runnerId, hasConfigError: false, servers: [] };
      if (params.includeMcp !== false && runnerId !== null) try {
        const raw = await this.bridge.sendValidated('mcp.list', selected === undefined ? {} : { runner_id: selected });
        this.check(fence);
        mcp = projectMcp(raw, runnerId);
        rawMcp = raw;
      } catch {
        this.check(fence);
      }
      this.check(fence);
      let editor;
      if (this.editor) { try { editor = this.editor.snapshot(bootstrap, rawMcp, runnerId, fence); } catch {} }
      return bounded({ ...settings, mcp, ...(editor ? { editor } : {}) });
    } catch (error) {
      if (error instanceof Error && error.message === CHANGED_ERROR) throw error;
      throw new Error(SETTINGS_ERROR);
    } finally { --this.pending; }
  }
}
function wireBot(value, scope = '') {
  const item = object(value);
  return { id: id(item.id), name: text(item.name), runner_id: item.runner_id === '' ? '' : id(item.runner_id), ...botPresentation(item, scope) };
}
function wireMessage(value) {
  const item = object(value), author = object(item.author), source = object(item.body), status = object(item.state);
  const kind = text(source.kind, 64);
  let body = { kind };
  if (kind === 'text') body = {
    kind, text: text(source.text, 2_000_000),
    attachments: array(source.attachments, 128, []).map(value => {
      const item = object(value);
      return { id: id(item.id), name: text(item.name, 1024), mime: text(item.mime), size: number(item.size) };
    }),
  };
  else if (kind === 'tool') {
    const run = source.run == null ? null : object(source.run);
    body = { kind, name: text(source.name), summary: text(source.summary, 200_000, ''), detail: text(source.detail, 2_000_000, ''), is_running: boolean(source.is_running, false), is_error: boolean(source.is_error, false),
      target_bot_id: source.target_bot_id == null ? null : id(source.target_bot_id),
      run: run === null ? null : { state: text(run.state, 64), command: text(run.command, 200_000), output: nullableText(run.output, 2_000_000), reason: nullableText(run.reason, 200_000), rule: nullableText(run.rule, 200_000) } };
  } else if (kind === 'permission') body = {
    kind, plugin_id: id(source.plugin_id), plugin_name: text(source.plugin_name), tool: text(source.tool), summary: text(source.summary, 200_000), decision: text(source.decision, 64),
    reason: nullableText(source.reason, 200_000), rule: nullableText(source.rule, 200_000), command: nullableText(source.command, 200_000),
  };
  else if (kind === 'notice') body = { kind, text: text(source.text, 2_000_000) };
  else if (kind === 'handoff') body = { kind, from: text(source.from), to: text(source.to), reason: text(source.reason, 200_000) };
  return { id: id(item.id), chat_id: id(item.chat_id), author: { kind: text(author.kind, 64), bot_id: nullableText(author.bot_id) }, body,
    state: { kind: text(status.kind, 64), error: status.kind === 'failed' ? 'Lorca 未能完成这条消息，请检查本地运行服务' : null }, created_at: number(item.created_at), queued: boolean(item.queued, false) };
}
function wireChat(value, messages) {
  const item = object(value);
  const result = { id: id(item.id), kind: text(item.kind, 64), title: nullableText(item.title, 2000), bot_ids: array(item.bot_ids, 128).map(id), created_at: number(item.created_at) };
  if (messages) { result.messages = array(item.messages, 2000).map(wireMessage); result.has_more = boolean(item.has_more, false); }
  return result;
}
function wireTurn(value) { const item = object(value); return { chat_id: id(item.chat_id), bot_id: text(item.bot_id), job_id: id(item.job_id) }; }
function wireDevices(value) {
  const devices = Array.from(array(value, 128), value => {
    const item = object(value);
    if (!['online', 'offline'].includes(item.status)) invalid();
    return { id: id(item.id), name: text(item.name), online: item.status === 'online' };
  });
  if (new Set(devices.map(item => item.id)).size !== devices.length) invalid();
  return devices;
}
function wireSnapshot(value) {
  const item = object(value);
  return { version: text(item.version, 128), has_identity: boolean(item.has_identity), identity_id: nullableText(item.identity_id), is_identity_device: boolean(item.is_identity_device, false), this_device_id: nullableText(item.this_device_id),
    relay_connected: boolean(item.relay_connected), relay_update_required: boolean(item.relay_update_required, false),
    devices: item.devices === undefined ? [] : wireDevices(item.devices),
    bots: array(item.bots, 1024).map(bot => wireBot(bot, `${item.has_identity}:${item.identity_id ?? ''}`)), chats: array(item.chats, 2048).map(chat => wireChat(chat, true)),
    running_turns: array(item.running_turns, 1024, []).map(wireTurn), running_chat_ids: array(item.running_chat_ids, 1024, []).map(id) };
}
function sanitizeRendererEvent(value, scope = '') {
  const envelope = object(value), event = text(envelope.event, 100);
  if (!['snapshot', 'roster.changed', 'identity.changed', 'relay.status', 'job.started', 'job.finished', 'message.added', 'message.updated', 'message.removed', 'chat.removed'].includes(event)) return null;
  const input = object(envelope.data);
  let data;
  if (event === 'snapshot') data = wireSnapshot(input);
  else if (event === 'roster.changed') data = { ...(input.devices === undefined ? {} : { devices: wireDevices(input.devices) }), bots: array(input.bots, 1000).map(bot => wireBot(bot, scope)), chats: array(input.chats, 2048).map(chat => wireChat(chat, false)) };
  else if (event === 'identity.changed') data = { has_identity: boolean(input.has_identity) };
  else if (event === 'relay.status') data = { connected: boolean(input.connected), update_required: boolean(input.update_required, false) };
  else if (['job.started', 'job.finished'].includes(event)) data = wireTurn(input);
  else if (['message.added', 'message.updated'].includes(event)) {
    data = { chat_id: id(input.chat_id), message: wireMessage(input.message) };
    if (data.chat_id !== data.message.chat_id) invalid();
  } else if (event === 'message.removed') data = { chat_id: id(input.chat_id), message_id: id(input.message_id) };
  else if (event === 'chat.removed') data = { chat_id: id(input.chat_id) };
  else return null;
  return bounded({ event, data }, 16_000_000);
}
function sanitizeRendererResult(method, value) {
  let result;
  if (method === 'bootstrap') result = wireSnapshot(value);
  else if (method === 'hello') {
    const item = object(value);
    result = { version: text(item.version, 128), has_identity: boolean(item.has_identity), is_identity_device: boolean(item.is_identity_device, false), device_id: nullableText(item.device_id), relay_connected: boolean(item.relay_connected), relay_update_required: boolean(item.relay_update_required, false) };
  } else if (method === 'chats.create') result = { chat: wireChat(object(value).chat, false) };
  else if (method === 'chats.send') result = { message: wireMessage(object(value).message) };
  else if (method === 'chats.messages') { const item = object(value); result = { messages: array(item.messages, 200).map(wireMessage), has_more: boolean(item.has_more) }; }
  else if (method === 'chats.permission') result = { answered: boolean(object(value).answered) };
  else if (method === 'chats.send_now') result = { sent: boolean(object(value).sent) };
  else if (method === 'chats.stop') { if (value !== null) invalid(); result = null; }
  else if (method === 'chats.search') {
    const item = object(value);
    result = { chats: array(item.chats, 50).map(value => { const item = object(value); return { chat_id: id(item.chat_id), snippet: text(item.snippet, 20_000) }; }),
      messages: array(item.messages, 50).map(value => { const item = object(value), author = object(item.author); return { chat_id: id(item.chat_id), message_id: id(item.message_id), snippet: text(item.snippet, 20_000), author: { kind: text(author.kind, 64), bot_id: nullableText(author.bot_id) }, created_at: number(item.created_at) }; }) };
  } else invalid();
  return bounded(result, 16_000_000);
}
function safeRendererError(error) {
  if (error?.code === 'LORCA_REMOTE_ERROR') return new Error('Lorca 未能完成此请求。若涉及操作，请先检查会话再决定是否重试；请求未被自动重发。');
  if (['ENOENT', 'EACCES', 'EPERM', 'EISDIR'].includes(error?.code)) return new Error('无法读取本地文件，请重新选择文件后重试');
  return error;
}
module.exports = { SettingsInventory, validateSettingsParams, projectSettingsBootstrap, projectMcp, sanitizeRendererEvent, sanitizeRendererResult, safeRendererError };
