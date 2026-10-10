const { EventEmitter } = require('node:events');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const WebSocket = require('ws');

const RPC_METHODS = Object.freeze(['hello', 'bootstrap', 'chats.create', 'chats.send', 'chats.stop', 'chats.send_now', 'chats.messages', 'chats.search', 'chats.permission']);
const RENDERER_EVENTS = new Set(['snapshot', 'roster.changed', 'identity.changed', 'relay.status', 'job.started', 'job.finished', 'message.added', 'message.updated', 'message.removed', 'chat.removed']);
const READ_METHODS = new Set(['hello', 'bootstrap', 'chats.messages', 'chats.search', 'mcp.list', 'mcp.get', 'providers.api_key', 'bots.memory', 'bots.permissions', 'routines.describe']);
const MAX_TEXT = 200_000;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} 无效`);
  return value;
}
function fields(value, allowed) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`不支持的参数：${key}`);
}
function string(value, key, maximum = 200, optional = false) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0') || (!optional && value.trim().length === 0)) throw new Error(`${key} 无效`);
  return value;
}
function strings(value, key, maximum = 6) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${key} 无效`);
  return value.map(item => string(item, key));
}
function validateEndpoint(value) {
  if (typeof value !== 'string' || value.length > 160) throw new Error('请使用本机 Lorca 连接地址，例如 ws://127.0.0.1:4862/ws');
  const match = /^ws:\/\/(127\.0\.0\.1|localhost):([0-9]{1,5})\/ws$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) throw new Error('仅允许 ws://127.0.0.1:<port>/ws 或 ws://localhost:<port>/ws');
  return `ws://127.0.0.1:${Number(match[2])}/ws`;
}
function validateRequest(method, input) {
  string(method, 'method', 64);
  if (!RPC_METHODS.includes(method)) throw new Error('此客户端不支持该方法');
  const params = object(input ?? {}, 'parameters');
  let allowed;
  if (method === 'hello' || method === 'bootstrap') allowed = [];
  else if (method === 'chats.stop') allowed = ['chat_id'];
  else if (method === 'chats.create') {
    allowed = ['id', 'kind', 'bot_ids', 'title', 'owner_bot_id', 'description'];
    string(params.id, 'id', 200, true);
    if (params.kind !== undefined && !['dm', 'group'].includes(params.kind)) throw new Error('会话类型无效');
    const ids = strings(params.bot_ids, 'bot_ids');
    if (!ids.length || new Set(ids).size !== ids.length || (params.kind === 'dm' && ids.length !== 1)) throw new Error('私聊请选择一个智能体；群聊请选择一到六个不同的智能体');
    string(params.title, 'title', 300, true); string(params.description, 'description', 20_000, true); string(params.owner_bot_id, 'owner_bot_id', 200, true);
    if (params.owner_bot_id !== undefined && !ids.includes(params.owner_bot_id)) throw new Error('负责人必须是群聊成员');
  } else if (method === 'chats.send') {
    allowed = ['chat_id', 'text', 'message_id', 'mentions', 'reply_to'];
    string(params.text, 'text', MAX_TEXT, true); string(params.message_id, 'message_id', 200, true); string(params.reply_to, 'reply_to', 200, true);
    if (!params.text?.trim()) throw new Error('请先输入消息再发送');
    if (params.mentions !== undefined) strings(params.mentions, 'mentions');
  } else if (method === 'chats.send_now') { allowed = ['chat_id', 'message_id']; string(params.message_id, 'message_id'); }
  else if (method === 'chats.permission') {
    allowed = ['chat_id', 'message_id', 'decision']; string(params.message_id, 'message_id');
    if (!['allow', 'always', 'deny'].includes(params.decision)) throw new Error('decision 只能是 allow、always 或 deny');
  } else if (method === 'chats.messages') {
    allowed = ['chat_id', 'before', 'limit']; string(params.before, 'before', 200, true);
    if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 200)) throw new Error('每页消息数量必须在 1 到 200 之间');
  } else if (method === 'chats.search') {
    allowed = ['query', 'limit']; string(params.query, 'query', 2000);
    if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 50)) throw new Error('搜索结果数量必须在 1 到 50 之间');
  } else throw new Error(`此客户端不支持方法：${method}`);
  fields(params, allowed);
  if (allowed.includes('chat_id')) string(params.chat_id, 'chat_id');
  return { ...params };
}
function validateCopyText(value) {
  if (typeof value !== 'string' || value.length > MAX_TEXT || value.includes('\0')) throw new Error('复制的文本不能超过 200,000 个字符');
  return value;
}
function isTrustedSender(event, webContents, trustedURL) {
  if (!event || !webContents || event.sender !== webContents || !event.senderFrame || event.senderFrame !== webContents.mainFrame) return false;
  try {
    const actual = new URL(event.senderFrame.url);
    const expected = new URL(trustedURL);
    actual.hash = ''; expected.hash = '';
    return actual.href === expected.href;
  } catch { return false; }
}
function outcomeError(method, reason) {
  return new Error(READ_METHODS.has(method) ? reason : `${reason}。操作结果尚不确定，请先检查会话再决定是否重试。此操作未被自动重发。`);
}

class LorcaBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.home = options.home ?? process.env.LORCA_HOME ?? path.join(os.homedir(), '.lorca');
    this.legacy = options.legacy ?? process.env.LORCA_ALLOW_LEGACY === '1';
    this.readToken = options.readToken ?? (() => readFile(path.join(this.home, 'serve-token'), 'utf8'));
    this.WebSocket = options.WebSocket ?? WebSocket;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5000;
    this.retryMinimumMs = options.retryMinimumMs ?? 500;
    this.retryMaximumMs = options.retryMaximumMs ?? 10_000;
    this.retryDelay = this.retryMinimumMs;
    this.pending = new Map(); this.nextId = 1; this.socket = null; this.timer = null; this.wants = false;
    this.status = { status: 'disconnected', endpoint: validateEndpoint(options.endpoint ?? 'ws://127.0.0.1:4862/ws'), generation: 0, authMode: this.legacy ? 'legacy' : 'token' };
    this.attemptResolve = null;
  }
  getStatus() { return { ...this.status }; }
  setStatus(status, detail) {
    this.status = { ...this.status, status };
    delete this.status.detail;
    const warning = this.legacy ? '本地兼容连接（不校验令牌）。仅连接你信任的本机服务。' : '';
    if (detail || warning) this.status.detail = [detail, warning].filter(Boolean).join(' ');
    this.emit('status', this.getStatus());
  }
  connect(endpoint = this.status.endpoint) {
    const parsed = validateEndpoint(endpoint);
    if (this.wants && parsed === this.status.endpoint && this.status.status === 'connected') return Promise.resolve(this.getStatus());
    this.stopSession('连接已切换');
    this.status.endpoint = parsed; this.wants = true; this.retryDelay = this.retryMinimumMs;
    return this.open();
  }
  async open() {
    if (!this.wants) return this.getStatus();
    const generation = ++this.status.generation;
    this.setStatus('connecting');
    let headers = {};
    if (!this.legacy) {
      let token;
      try {
        if (!path.isAbsolute(this.home)) throw new Error('home');
        token = (await this.readToken()).trim();
        if (!token || token.length > 4096 || /[\r\n\0]/.test(token)) throw new Error('token');
      } catch {
        if (generation !== this.status.generation || !this.wants) return this.getStatus();
        this.setStatus('error', '无法读取 Lorca 的 serve-token。请先启动 Lorca，并将 LORCA_HOME 指向该服务现有的数据目录');
        this.schedule(); return this.getStatus();
      }
      if (generation !== this.status.generation || !this.wants) return this.getStatus();
      headers = { Authorization: `Bearer ${token}` };
    }
    return new Promise(resolve => {
      this.attemptResolve = resolve;
      let socket;
      try { socket = new this.WebSocket(this.status.endpoint, { headers, handshakeTimeout: this.handshakeTimeoutMs, followRedirects: false, maxPayload: 64 * 1024 * 1024 }); }
      catch { this.fail(generation, '无法建立本地 Lorca 连接'); return; }
      this.socket = socket;
      socket.on('open', () => {
        if (generation !== this.status.generation || !this.wants) { socket.terminate(); return; }
        this.retryDelay = this.retryMinimumMs; this.setStatus('connected'); this.resolveAttempt();
      });
      socket.on('message', (data, binary) => {
        if (generation !== this.status.generation || socket !== this.socket) return;
        if (binary) { this.fail(generation, 'Lorca 响应不兼容：应为 JSON 文本', false); return; }
        this.handle(data.toString(), generation);
      });
      socket.on('unexpected-response', (request, response) => {
        const code = response.statusCode; response.destroy(); request.destroy();
        this.fail(generation, code === 401 ? 'Lorca 拒绝了这个数据目录的 serve-token。请检查 LORCA_HOME 和连接地址' : code === 403 ? 'Lorca 拒绝了本地连接，安全检查仍已启用' : `Lorca WebSocket 握手失败（${code ?? '未知状态'}）`);
      });
      socket.on('error', () => this.fail(generation, '无法连接本地 Lorca 服务。请检查端口，并确认服务正在运行'));
      socket.on('close', () => this.fail(generation, '本地 Lorca 连接已关闭'));
    });
  }
  resolveAttempt() { const resolve = this.attemptResolve; this.attemptResolve = null; if (resolve) resolve(this.getStatus()); }
  fail(generation, detail, retry = true) {
    if (generation !== this.status.generation) return;
    ++this.status.generation;
    const socket = this.socket; this.socket = null;
    this.rejectPending(detail);
    this.setStatus('error', detail); this.resolveAttempt();
    if (socket) socket.terminate();
    if (retry) this.schedule(); else this.wants = false;
  }
  schedule() {
    if (!this.wants || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.open(); }, this.retryDelay);
    this.timer.unref?.(); this.retryDelay = Math.min(this.retryMaximumMs, this.retryDelay * 2);
  }
  handle(text, generation) {
    let frame;
    try {
      frame = object(JSON.parse(text), 'Lorca response');
      if (Object.hasOwn(frame, 'event')) {
        string(frame.event, 'event name', 100);
        if (!Object.hasOwn(frame, 'data') || Object.hasOwn(frame, 'id') || Object.hasOwn(frame, 'result') || Object.hasOwn(frame, 'error')) throw new Error('event envelope');
        if (!RENDERER_EVENTS.has(frame.event)) return;
        object(frame.data, 'event data'); this.emit('event', { event: frame.event, data: frame.data }); return;
      }
      if (!Number.isSafeInteger(frame.id) || frame.id < 1 || Object.hasOwn(frame, 'result') === Object.hasOwn(frame, 'error')) throw new Error('response envelope');
      if (Object.hasOwn(frame, 'error')) string(object(frame.error, 'error').message, 'error message', 16_000);
    } catch {
      this.fail(generation, 'Lorca 响应不兼容：消息格式无效', false); return;
    }
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    this.pending.delete(frame.id); clearTimeout(pending.timer);
    if (frame.error) { const error = new Error(frame.error.message); error.code = 'LORCA_REMOTE_ERROR'; pending.reject(error); } else pending.resolve(frame.result);
  }
  request(method, input = {}) {
    let params;
    try { params = validateRequest(method, input); } catch (error) { return Promise.reject(error); }
    return this.sendValidated(method, params);
  }
  sendValidated(method, params, options) {
    if (options !== undefined && (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.keys(options).length !== 1 || method !== 'pair.accept' || options.timeoutMs !== 610_000)) return Promise.reject(new Error('请求时限无效'));
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    if (this.status.status !== 'connected' || !this.socket) return Promise.reject(new Error('尚未连接 Lorca，此操作未发送'));
    if (this.pending.size >= 100) return Promise.reject(new Error('待处理的 Lorca 请求过多，此操作未发送'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (!this.pending.delete(id)) return; reject(outcomeError(method, 'Lorca 未及时回复')); }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.socket.send(JSON.stringify({ id, method, params }), error => {
          const pending = this.pending.get(id);
          if (!error || !pending) return;
          this.pending.delete(id); clearTimeout(pending.timer); reject(outcomeError(method, '发送过程中连接中断'));
        });
      } catch {
        this.pending.delete(id); clearTimeout(timer); reject(outcomeError(method, '发送过程中连接中断'));
      }
    });
  }
  rejectPending(reason) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(outcomeError(pending.method, reason)); }
    this.pending.clear();
  }
  stopSession(reason) {
    this.wants = false; clearTimeout(this.timer); this.timer = null; ++this.status.generation;
    const socket = this.socket; this.socket = null; this.rejectPending(reason);
    this.setStatus('disconnected'); this.resolveAttempt(); if (socket) socket.terminate();
  }
  close() { this.stopSession('连接已关闭'); }
}

module.exports = { RPC_METHODS, LorcaBridge, validateEndpoint, validateRequest, validateCopyText, isTrustedSender };
