const { createHash, randomUUID } = require('node:crypto');

const INVALID = '例行任务或插件参数无效，请刷新后重试';
const STALE = '智能体、执行器或配置已变化，请刷新后重新确认';
const CHANGED = '账号、连接或当前智能体已变化，请重新打开详情';
const READ_ERROR = '无法读取例行任务与插件，请检查连接后重试';
const WRITE_ERROR = '未能提交操作，请刷新后重试';
const BUSY = '另一项智能体操作正在进行，请等待结果';
const ADVANCED = '此任务使用检查脚本或高级触发器，本界面不支持修改其配置；可暂停、运行或删除';
const SAFE = new Set([INVALID, STALE, CHANGED, READ_ERROR, WRITE_ERROR, BUSY, ADVANCED]);
const CAPS = ['read', 'draft', 'write'];
const STATES = ['running', 'blocked', 'paused', 'waiting_for_runner', 'failed', 'on'];
const EDIT_KEYS = ['name', 'prompt', 'schedule', 'timezone', 'missedRunPolicy'];
const WIRE_KEYS = { missedRunPolicy: 'missed_run_policy' };
function fail(message = INVALID) { throw new Error(message); }
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || (keys && Object.keys(value).some(key => !keys.includes(key)))) fail();
  return value;
}
function text(value, max = 256, empty = false) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (!empty && !value.trim())) fail();
  return value;
}
function id(value) { const result = text(value); if (result !== result.trim() || /[\x00-\x1f\x7f]/.test(result) || Buffer.byteLength(result) > 256) fail(); return result; }
function flag(value) { if (typeof value !== 'boolean') fail(); return value; }
function list(value, max = 1000) { if (!Array.isArray(value) || value.length > max || Array.from(value).some(item => item === undefined)) fail(); return value; }
function unique(values, key = value => value) { if (new Set(values.map(key)).size !== values.length) fail(); return values; }
function choice(value, allowed) { if (!allowed.includes(value)) fail(); return value; }
function timestamp(value) { if (value == null) return null; if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12) fail(); return value; }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
function hash(value) { const serialized = JSON.stringify(canonical(value)); if (Buffer.byteLength(serialized) > 512 * 1024) fail(); return createHash('sha256').update(serialized).digest('hex'); }
function visible(value) { return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, value => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`); }
function grants(value) { return unique(list(value, 3).map(value => choice(value, CAPS))).sort(); }
function toolNames(value) { return value === null ? null : unique(list(value).map(id)).sort(); }
function policy(value) {
  if (value == null) return { connections: null, filesystem: 'write', shell: true, drafts: true };
  const input = object(value, ['connections', 'filesystem', 'shell', 'drafts']);
  let connections = null;
  if (input.connections != null) {
    const entries = Object.entries(object(input.connections)); if (entries.length > 1000) fail();
    connections = Object.fromEntries(entries.map(([key, value]) => {
      id(key); const grant = object(value, ['capabilities', 'tools']);
      return [key, { capabilities: grants(grant.capabilities === undefined ? [] : grant.capabilities), tools: toolNames(grant.tools ?? null) }];
    }));
  }
  return { connections, filesystem: choice(input.filesystem === undefined ? 'write' : input.filesystem, ['none', 'read', 'write']), shell: flag(input.shell === undefined ? true : input.shell), drafts: flag(input.drafts === undefined ? true : input.drafts) };
}
function wirePolicy(value) {
  return { ...value, connections: value.connections === null ? null : Object.fromEntries(Object.entries(value.connections).map(([key, grant]) => [key, { capabilities: grant.capabilities, ...(grant.tools === null ? {} : { tools: grant.tools }) }])) };
}
function routine(value, botId) {
  const input = object(value); if (id(input.bot_id) !== botId) fail();
  const hasCheck = input.check != null && text(input.check, 8000, true).trim().length > 0;
  const triggerKind = input.pull_request != null ? 'pull_request' : input.calendar != null ? 'calendar' : 'schedule';
  return { id: id(input.id), botId, name: text(input.name), prompt: text(input.prompt, 20_000), schedule: text(input.schedule, 256), scheduleText: text(input.schedule_text, 1000), timezone: text(input.timezone, 128),
    missedRunPolicy: choice(input.missed_run_policy, ['coalesce', 'skip']), enabled: flag(input.is_enabled), running: flag(input.is_running), state: choice(input.state, STATES),
    nextRunAt: timestamp(input.next_run_at), lastRunAt: timestamp(input.last_run_at), lastOutcome: input.last_outcome == null ? null : choice(input.last_outcome, ['sent', 'pass', 'error']),
    pausedReason: input.paused_reason == null ? null : ['away', 'authentication'].includes(input.paused_reason) ? input.paused_reason : 'other', hasCheck, triggerKind, editable: !hasCheck && triggerKind === 'schedule' };
}
function snapshot(value, botId) {
  const input = object(value); if (input.has_identity !== true) fail(CHANGED); id(input.identity_id);
  const bots = list(input.bots, 1024), matches = bots.filter(value => object(value).id === botId); if (matches.length !== 1) fail(STALE);
  const bot = matches[0], runnerId = id(bot.runner_id), name = text(bot.name), permissions = policy(bot.permissions);
  const rawRoutines = list(input.routines, 20480).filter(value => object(value).bot_id === botId);
  const routines = unique(rawRoutines.map(value => routine(value, botId)), value => value.id);
  const runner = list(input.devices, 128).find(value => object(value).id === runnerId);
  const runnerName = runner ? text(runner.name) : runnerId;
  const configs = rawRoutines.map(value => Object.fromEntries(['id', 'bot_id', 'name', 'prompt', 'feedback_authorization_prompt', 'schedule', 'timezone', 'missed_run_policy', 'is_enabled', 'check', 'pull_request', 'calendar'].map(key => [key, value[key] ?? null])));
  const version = hash({ bot, configs });
  return { botId, botName: name, runnerId, runnerName, routines, permissions, version };
}
function catalog(value) {
  const input = object(value);
  return unique(list(input.connections).map(value => {
    const input = object(value);
    const tools = unique(list(input.tools).map(value => {
      const tool = object(value);
      return { name: id(tool.name), title: tool.title == null ? null : text(tool.title, 1000, true), capability: choice(tool.capability, CAPS) };
    }), value => value.name);
    return { id: id(input.id), name: text(input.name), tools };
  }), value => value.id);
}
function schedule(value) {
  const result = text(value, 256).trim();
  if (/event/i.test(result) || !(/^(every\s|@|once\s)/i.test(result) || result.split(/\s+/).length === 5)) fail(ADVANCED);
  return result;
}
function edit(value, create = false) {
  const input = object(value, create ? [...EDIT_KEYS, 'enabled'] : EDIT_KEYS), output = {};
  if (!Object.keys(input).length || (create && [...EDIT_KEYS, 'enabled'].some(key => !Object.hasOwn(input, key)))) fail();
  for (const [key, value] of Object.entries(input)) {
    if (key === 'name') { const name = text(value).trim().replace(/\s+/g, ' '); if ([...name].length > 60) fail(); output[key] = name; }
    if (key === 'prompt') output[key] = text(value, 20_000).trim();
    if (key === 'schedule') output[key] = schedule(value);
    if (key === 'timezone') output[key] = text(value, 128).trim();
    if (key === 'missedRunPolicy') output[key] = choice(value, ['coalesce', 'skip']);
    if (key === 'enabled') output[key] = flag(value);
  }
  return output;
}
function validateCapabilityAction(value) {
  const input = object(value), kind = input.kind, revision = id(input.revision);
  if (kind === 'routine.create') { object(input, ['kind', 'revision', 'draft']); return { kind, revision, draft: edit(input.draft, true) }; }
  if (kind === 'routine.edit') { object(input, ['kind', 'revision', 'routineId', 'patch']); return { kind, revision, routineId: id(input.routineId), patch: edit(input.patch) }; }
  if (kind === 'routine.setEnabled') { object(input, ['kind', 'revision', 'routineId', 'enabled']); return { kind, revision, routineId: id(input.routineId), enabled: flag(input.enabled) }; }
  if (['routine.run', 'routine.delete'].includes(kind)) { object(input, ['kind', 'revision', 'routineId']); return { kind, revision, routineId: id(input.routineId) }; }
  if (kind === 'plugin.setAccess') { object(input, ['kind', 'revision', 'connectionId', 'capabilities', 'tools']); return { kind, revision, connectionId: id(input.connectionId), capabilities: grants(input.capabilities), tools: toolNames(input.tools) }; }
  fail();
}
class AgentCapabilities {
  constructor(bridge, inventory, { confirm, now = Date.now } = {}) { this.bridge = bridge; this.inventory = inventory; this.confirm = confirm; this.now = now; this.entries = new Map(); this.epoch = 0; this.busy = false; this.disposed = false; }
  invalidate() { ++this.epoch; this.entries.clear(); }
  dispose() { this.disposed = true; this.invalidate(); }
  capture(botId) { const fence = this.inventory.capture(), status = this.inventory.check(fence); if (!['token', 'legacy'].includes(status.authMode)) fail(CHANGED); return { botId, fence, context: JSON.stringify([status.endpoint, status.authMode]), epoch: this.epoch, expires: this.now() + 300_000 }; }
  guard(entry, trusted) {
    try { trusted(); const status = this.inventory.check(entry.fence); if (this.disposed || entry.epoch !== this.epoch || entry.context !== JSON.stringify([status.endpoint, status.authMode])) fail(); } catch { fail(CHANGED); }
    if (this.now() >= entry.expires) fail(STALE);
  }
  async read(entry, trusted) {
    this.guard(entry, trusted); const raw = await this.bridge.sendValidated('bootstrap', {}); this.guard(entry, trusted);
    this.inventory.observeSnapshot(raw); this.guard(entry, trusted); return snapshot(raw, entry.botId);
  }
  async readCatalog(entry, trusted) { this.guard(entry, trusted); const raw = await this.bridge.sendValidated('bots.permissions', { id: entry.botId }); this.guard(entry, trusted); return catalog(raw); }
  target(entry, state) { if (state.version !== entry.version) fail(STALE); }
  async get(params, trusted = () => {}) {
    const botId = id(object(params, ['botId']).botId); if (this.busy) fail(BUSY);
    this.busy = true; this.invalidate();
    try {
      const entry = this.capture(botId), state = await this.read(entry, trusted); let plugins = null;
      try { plugins = await this.readCatalog(entry, trusted); } catch { this.guard(entry, trusted); }
      const latest = await this.read(entry, trusted); if (latest.version !== state.version) fail(STALE);
      entry.version = state.version; entry.catalog = plugins; entry.catalogVersion = plugins === null ? null : hash(plugins);
      const revision = randomUUID(); this.entries.set(revision, entry);
      return { revision, version: state.version, botId, botName: state.botName, runnerId: state.runnerId, routines: latest.routines,
        plugins: (plugins ?? []).map(plugin => { const grant = state.permissions.connections === null ? { capabilities: [...CAPS], tools: null } : Object.hasOwn(state.permissions.connections, plugin.id) ? state.permissions.connections[plugin.id] : { capabilities: [], tools: [] }; return { ...plugin, capabilities: grant.capabilities, allowedTools: grant.tools }; }),
        permissions: { allConnections: state.permissions.connections === null, filesystem: state.permissions.filesystem, shell: state.permissions.shell, drafts: state.permissions.drafts },
        capabilities: { canCreateRoutine: typeof this.confirm === 'function' && state.routines.length < 20, canEditPlugins: typeof this.confirm === 'function' && plugins !== null } };
    } catch (error) { if (SAFE.has(error?.message)) throw error; fail(READ_ERROR); } finally { this.busy = false; }
  }
  async describe(entry, trusted, value) {
    const params = { schedule: schedule(value.schedule), timezone: value.timezone, missed_run_policy: value.missedRunPolicy };
    this.guard(entry, trusted); const result = object(await this.bridge.sendValidated('routines.describe', params)); this.guard(entry, trusted);
    const output = { schedule: schedule(result.schedule), text: text(result.text, 1000), timezone: text(result.timezone, 128), missedRunPolicy: choice(result.missed_run_policy, ['coalesce', 'skip']), nextRunAt: timestamp(result.next_run_at) };
    if (output.timezone !== value.timezone || output.missedRunPolicy !== value.missedRunPolicy || (/^once\s/i.test(output.schedule) && output.missedRunPolicy === 'skip')) fail();
    return output;
  }
  async mutation(action, entry, state, trusted) {
    this.target(entry, state);
    const scope = `智能体 ${JSON.stringify(state.botName)}（${state.botId}），执行器 ${JSON.stringify(state.runnerName)}（${state.runnerId}）。变更会同步至账号内的配对设备。`;
    if (action.kind === 'plugin.setAccess') {
      if (entry.catalog === null) fail(READ_ERROR);
      const plugins = await this.readCatalog(entry, trusted); if (hash(plugins) !== entry.catalogVersion) fail(STALE);
      const plugin = plugins.find(value => value.id === action.connectionId); if (!plugin) fail();
      if (action.tools !== null && action.tools.some(name => !plugin.tools.some(tool => tool.name === name))) fail();
      const before = state.permissions, connections = before.connections === null ? Object.fromEntries(plugins.map(plugin => [plugin.id, { capabilities: [...CAPS], tools: null }])) : { ...before.connections };
      const previous = Object.hasOwn(connections, plugin.id) ? connections[plugin.id] : { capabilities: [], tools: [] };
      Object.defineProperty(connections, plugin.id, { value: { capabilities: action.capabilities, tools: action.tools }, enumerable: true, writable: true, configurable: true });
      const next = { ...before, connections };
      return { method: 'bots.update', params: { id: state.botId, permissions: wirePolicy(next) }, expectedPolicy: next,
        detail: `${scope}\n将修改此智能体所有聊天、例行任务及正在运行任务后续工具调用的插件权限。权限不是自动审查批准，仍受后端规则约束；不会安装、卸载插件或修改凭据。\n插件：${JSON.stringify(plugin.name)}（${plugin.id}）\n原授权：${JSON.stringify(previous)}\n新授权：${JSON.stringify(connections[plugin.id])}\nread、draft、write 是独立授权；null 工具范围表示允许该实例当前及未来的所有工具。增加权限可能允许访问数据或执行外部操作，不保证每次再次询问。\n保留文件访问 ${before.filesystem}、Shell ${before.shell}、消息草稿 ${before.drafts}。${before.connections === null ? '\n将当前插件从全部开放改为明确列表；以后新安装的插件默认不获授权。' : ''}` };
    }
    const current = action.routineId ? state.routines.find(value => value.id === action.routineId) : null;
    if (action.routineId && !current) fail(STALE);
    if (action.kind === 'routine.create' || action.kind === 'routine.edit') {
      if (current && !current.editable) fail(ADVANCED);
      if (!current && state.routines.length >= 20) fail();
      const change = current ? action.patch : action.draft, effective = { ...current, ...change };
      if (state.routines.some(value => value.id !== current?.id && value.name.toLowerCase() === effective.name.toLowerCase())) fail();
      const described = await this.describe(entry, trusted, effective);
      const wire = Object.fromEntries(Object.entries(change).map(([key, value]) => [WIRE_KEYS[key] ?? key, value]));
      if (Object.hasOwn(wire, 'schedule')) wire.schedule = described.schedule;
      return { method: current ? 'routines.update' : 'routines.create', params: { ...(current ? { id: current.id } : { bot_id: state.botId }), ...wire }, expectedRoutine: { ...effective, schedule: described.schedule },
        detail: `${scope}\n${current ? '修改' : '创建'}持续保存的例行任务，按所选智能体现有权限与自动审查规则执行，可能产生模型费用及外部操作，不保证每次再次询问。\n${current ? `原配置：${JSON.stringify(Object.fromEntries(EDIT_KEYS.map(key => [key, current[key]])))}\n` : ''}拟保存：${JSON.stringify({ ...effective, schedule: described.schedule })}\n计划：${described.text}\n时区：${described.timezone}\n下一计划时间（Unix 秒）：${described.nextRunAt ?? '未提供'}\n修改计划或时区会重新计算调度起点；不会取消正在运行的任务。` };
    }
    if (action.kind === 'routine.setEnabled') return { method: 'routines.update', params: { id: current.id, enabled: action.enabled }, expectedRoutine: { ...current, enabled: action.enabled }, detail: `${scope}\n${action.enabled ? '恢复' : '暂停'}任务 ${JSON.stringify(current.name)}（${current.id}）。${action.enabled ? '恢复后会持续自动执行，按现有权限与自动审查规则处理，可能产生费用或外部操作。恢复会从现在重新计算计划；工作流审阅等后端门槛仍适用。' : '仅暂停今后调度，不取消已运行任务。'}` };
    if (action.kind === 'routine.delete') return { method: 'routines.delete', params: { id: current.id }, detail: `${scope}\n永久删除任务 ${JSON.stringify(current.name)}（${current.id}）及其配置，无法在此恢复。历史聊天仍保留，已运行任务不会取消。` };
    if (current.running || current.state === 'waiting_for_runner' || current.pausedReason === 'authentication') fail(STALE);
    return { method: 'routines.run', params: { id: current.id }, detail: `${scope}\n立即请求运行任务 ${JSON.stringify(current.name)}（${current.id}），即使其定时计划已暂停。\n任务正文：\n${current.prompt}\n可能创建该智能体的私聊、调用模型并按已有权限访问文件、运行程序或操作外部服务。不保证每次再次询问。确认仅表示请求运行，完成状态需后续查看。` };
  }
  async apply(value, trusted = () => {}) {
    const action = validateCapabilityAction(value), entry = this.entries.get(action.revision); if (!entry) fail(STALE);
    if (this.busy) fail(BUSY); if (typeof this.confirm !== 'function') fail(WRITE_ERROR);
    this.guard(entry, trusted); this.entries.delete(action.revision); this.busy = true; let submitted = false;
    try {
      const state = await this.read(entry, trusted), mutation = await this.mutation(action, entry, state, trusted);
      let detail = mutation.detail + '\n\n仅提交一次；结果未知时不会自动重发。后端无条件更新接口没有原子版本比较，确认后的外部并发编辑仍可能冲突。';
      if (this.bridge.getStatus().authMode === 'legacy') detail += '\n本机兼容连接没有令牌认证，仅继续使用你信任的本机服务。';
      const confirmed = await this.confirm({ title: '确认例行任务或插件变更', message: visible(`确认 ${state.botName} 的操作？`), detail: visible(detail) }, () => this.guard(entry, trusted));
      this.guard(entry, trusted); if (confirmed !== true) return { status: 'cancelled', botId: entry.botId };
      const latest = await this.read(entry, trusted), checked = await this.mutation(action, entry, latest, trusted);
      if (hash(checked.params) !== hash(mutation.params)) fail(STALE);
      this.guard(entry, trusted); submitted = true;
      const response = await this.bridge.sendValidated(mutation.method, mutation.params); this.guard(entry, trusted);
      let routineId = action.routineId;
      if (mutation.method === 'bots.update') { if (id(object(object(response).bot).id) !== entry.botId) fail(); }
      else if (['routines.create', 'routines.update'].includes(mutation.method)) {
        const returned = routine(object(response).routine, entry.botId); routineId = returned.id;
        if (action.routineId && returned.id !== action.routineId) fail();
      } else if (response !== null) fail();
      const after = await this.read(entry, trusted);
      if (after.runnerId !== state.runnerId) fail();
      if (action.kind === 'plugin.setAccess') { if (hash(after.permissions) !== hash(mutation.expectedPolicy)) fail(); }
      else if (action.kind === 'routine.delete') { if (after.routines.some(value => value.id === routineId)) fail(); }
      else if (action.kind !== 'routine.run') {
        const found = after.routines.find(value => value.id === routineId), expected = mutation.expectedRoutine;
        if (!found || [...EDIT_KEYS, 'enabled'].some(key => found[key] !== expected[key])) fail();
      }
      return { status: 'applied', botId: entry.botId, ...(routineId ? { routineId } : {}), ...(action.kind === 'routine.run' ? { requested: true } : {}) };
    } catch (error) {
      if (submitted) return { status: 'unknownOutcome', botId: entry.botId, ...(action.routineId ? { routineId: action.routineId } : {}) };
      if (SAFE.has(error?.message)) throw error; fail(WRITE_ERROR);
    } finally { this.entries.clear(); this.busy = false; }
  }
}
module.exports = { AgentCapabilities, validateCapabilityAction };
