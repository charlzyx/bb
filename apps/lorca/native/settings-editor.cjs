const { createHash, randomUUID } = require('node:crypto');
const { projectSettingsBootstrap } = require('./settings.cjs');

const INVALID = '设置参数无效，请刷新后重试';
const STALE = '设置已在其他位置变化，请刷新后重新编辑';
const UNAVAILABLE = '此设置当前不可编辑，请刷新并检查本地服务';
const KEY_PROVIDERS = Object.freeze({ deepseek: 'providers.connect_deepseek', anthropic: 'providers.connect_anthropic', opencode: 'providers.connect_opencode', 'opencode-go': 'providers.connect_opencode_go' });
const CUSTOM_APIS = ['chat-completions', 'responses', 'messages'];
const ACTION_FIELDS = Object.freeze({
  'bot.update': ['botId', 'provider', 'model', 'thinking', 'runnerId'],
  'provider.configure': ['providerId'], 'provider.disconnect': ['providerId'],
  'mcp.configure': ['runnerId', 'name'], 'mcp.setEnabled': ['runnerId', 'name', 'enabled'],
  'mcp.remove': ['runnerId', 'name'], 'mcp.reconnect': ['runnerId', 'name'], 'mcp.reload': ['runnerId'],
  'autoReview.set': ['isEnabled', 'rules'],
});
function invalid() { throw new Error(INVALID); }
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid(); return value; }
function keys(value, allowed) { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(); }
function text(value, maximum = 256, empty = false) { if (typeof value !== 'string' || value.length > maximum || /[\0\r]/.test(value) || (!empty && !value.trim())) invalid(); return value; }
function id(value) { const result = text(value); if (result !== result.trim() || result.includes('\n')) invalid(); return result; }
function list(value, maximum = 1000) { if (!Array.isArray(value) || value.length > maximum) invalid(); return value; }
function flag(value) { if (typeof value !== 'boolean') invalid(); return value; }
function label(value) { return text(value, 256, true).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 160); }
function visibleConfirmation(value) { return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, value => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function hash(value) { const serialized = JSON.stringify(canonical(value)); if (serialized.length > 2_000_000) invalid(); return createHash('sha256').update(serialized).digest('hex'); }
function rule(value, output = false) {
  const input = object(value); keys(input, ['id', 'text', 'behavior', 'tool']);
  if (!['allow', 'ask'].includes(input.behavior)) invalid();
  const result = { text: text(input.text, 8000).trim(), behavior: input.behavior };
  if (input.id !== undefined) result.id = id(input.id); else if (output) invalid();
  if (input.tool != null) result.tool = id(input.tool); else if (output) result.tool = null;
  return result;
}
function policy(value) {
  try { const input = object(value); return { status: 'ready', isEnabled: flag(input.is_enabled), rules: list(input.rules, 200).map(value => rule(value, true)) }; }
  catch { return { status: 'unavailable', isEnabled: null, rules: [] }; }
}
function botConfig(value) { const input = object(value); return { id: id(input.id), name: text(input.name), provider: input.provider ?? null, model: input.model ?? null, thinking: input.thinking ?? null, runner_id: input.runner_id }; }
function providerConfig(value) { const input = object(value); return { kind: id(input.kind), name: input.name ?? null, api: input.api ?? null, models: input.models ?? null, base_url: input.base_url ?? null }; }
function mcpConfig(value) { const input = object(value); return { name: id(input.name), enabled: flag(input.enabled), config: object(input.config) }; }
function runnerConfig(value) { const input = object(value); return { id: id(input.id), name: text(input.name), os: text(input.os), status: text(input.status), is_this_device: input.is_this_device === true }; }
function configurableProvider(provider) { return Object.hasOwn(KEY_PROVIDERS, provider.kind) || (provider.kind.startsWith('custom:') && CUSTOM_APIS.includes(provider.api)); }
function modelCatalog(bootstrap) {
  const catalog = new Map();
  const add = item => {
    object(item);
    if (item.decides === true || ['system-one', 'decisions'].includes(bootstrap.providers.find(provider => provider.kind === item.provider)?.api)) return;
    const model = { provider: id(item.provider), id: id(item.id), name: text(item.name ?? item.id), levels: list(item.levels ?? [], 32).map(id) };
    catalog.set(`${model.provider}\0${model.id}`, model);
  };
  list(bootstrap.models ?? []).forEach(add);
  for (const provider of bootstrap.providers) for (const model of list(provider.models ?? [])) add({ ...object(model), provider: provider.kind });
  if (catalog.size > 1000) invalid();
  return [...catalog.values()];
}
function validateSettingsAction(value) {
  const input = object(value); const kind = id(input.kind);
  if (!Object.hasOwn(ACTION_FIELDS, kind)) invalid();
  keys(input, ['kind', 'revision', ...ACTION_FIELDS[kind]]);
  const result = { kind, revision: id(input.revision) };
  for (const key of ['botId', 'providerId', 'runnerId', 'name']) if (input[key] !== undefined) result[key] = id(input[key]);
  if (kind === 'bot.update') {
    id(input.botId);
    for (const key of ['provider', 'model', 'thinking']) if (input[key] !== undefined) result[key] = key === 'provider' ? id(input[key]) : text(input[key], 256, true).trim();
    if (Object.keys(result).length < 4) invalid();
  } else if (kind === 'provider.disconnect') id(input.providerId);
  else if (kind.startsWith('mcp.')) {
    id(input.runnerId);
    if (!['mcp.configure', 'mcp.reload'].includes(kind)) id(input.name);
    if (kind === 'mcp.setEnabled') result.enabled = flag(input.enabled);
  } else if (kind === 'autoReview.set') {
    result.isEnabled = flag(input.isEnabled); result.rules = list(input.rules, 200).map(value => rule(value));
    const ids = result.rules.flatMap(item => item.id ? [item.id] : []);
    if (new Set(ids).size !== ids.length || JSON.stringify(result.rules).length > 200_000) invalid();
  }
  return result;
}
function validateURL(value) {
  const raw = text(value, 2000).trim(); let url;
  try { url = new URL(raw); } catch { invalid(); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search || !url.hostname) invalid();
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('远程连接地址必须使用 HTTPS；HTTP 仅允许本机地址');
  return raw;
}
function field(key, title, type = 'text', value = '', options) { return { key, label: title, type, value, ...(options ? { options } : {}) }; }
function providerForm(provider) {
  const custom = !provider || provider.kind.startsWith('custom:');
  return { title: provider ? '编辑服务商连接' : '添加自定义服务商', description: '密钥只在此隔离窗口输入，不回显现有密钥。留空保留原值；若服务没有明确保存的连接地址，必须填写具体 URL。URL 不接受查询参数。保存会验证连接并持久保存到当前账号。', fields: [
    ...(custom ? [field('name', '显示名称', 'text', provider?.name ?? ''), field('api', '接口格式', 'select', provider?.api ?? 'chat-completions', CUSTOM_APIS)] : []),
    field('baseUrl', 'HTTPS 连接地址（留空保留原值）'), field('apiKey', 'API 密钥（留空保留原值）', 'password'),
    ...(custom ? [field('clearApiKey', '清除已有密钥', 'select', 'no', ['no', 'yes']), field('models', '模型 ID，每行一个（留空保留现有目录）', 'textarea')] : []),
  ] };
}
function providerSubmission(value, provider, credentials) {
  const input = object(value); const custom = !provider || provider.kind.startsWith('custom:');
  keys(input, custom ? ['name', 'api', 'baseUrl', 'apiKey', 'clearApiKey', 'models'] : ['baseUrl', 'apiKey']);
  const enteredKey = text(input.apiKey, 16_000, true).trim();
  const enteredURL = text(input.baseUrl, 2000, true).trim();
  const previousKey = credentials?.api_key == null ? '' : text(credentials.api_key, 16_000, true);
  const previousURL = credentials?.base_url == null ? null : text(credentials.base_url, 2000);
  const apiKey = enteredKey || previousKey;
  if (custom) {
    if (!CUSTOM_APIS.includes(input.api) || !['no', 'yes'].includes(input.clearApiKey)) invalid();
    const name = text(input.name, 40).trim();
    const models = text(input.models, 20_000, true).trim();
    const ids = models ? models.split(/[\n,]/).map(value => id(value.trim())) : list(provider?.models ?? []).map(value => id(object(value).id));
    if (ids.length > 256 || new Set(ids).size !== ids.length || (input.clearApiKey === 'yes' && enteredKey)) invalid();
    return { method: 'providers.connect_custom', keyChange: input.clearApiKey === 'yes' ? '清除密钥' : enteredKey ? '新增或替换密钥' : previousKey ? '保留密钥' : '不使用 API 密钥', params: { ...(provider ? { kind: provider.kind } : {}), name, api: input.api, base_url: validateURL(enteredURL || previousURL), api_key: input.clearApiKey === 'yes' ? '' : apiKey, models: ids } };
  }
  if (!apiKey.trim()) invalid();
  const baseURL = validateURL(enteredURL || previousURL);
  return { method: KEY_PROVIDERS[provider.kind], keyChange: enteredKey ? '新增或替换密钥' : '保留密钥', params: { api_key: apiKey, base_url: baseURL } };
}
function mcpSubmission(value, previous) {
  const input = object(value); keys(input, ['name', 'patch']);
  const name = text(input.name, 128).trim(); const raw = text(input.patch, 100_000, Boolean(previous));
  let patch;
  try { patch = raw.trim() ? JSON.parse(raw) : {}; } catch { invalid(); }
  object(patch); keys(patch, ['type', 'command', 'args', 'env', 'cwd', 'url', 'headers', 'description', 'disabled', 'oauth']);
  const config = { ...(previous?.config ?? {}) };
  for (const [key, value] of Object.entries(patch)) { if (value === null) delete config[key]; else config[key] = value; }
  if (Object.hasOwn(patch, 'type') && patch.type !== null && !['stdio', 'http', 'sse'].includes(patch.type)) invalid();
  for (const key of ['command', 'cwd', 'description']) if (Object.hasOwn(patch, key) && patch[key] !== null) text(patch[key], 8000, key === 'description');
  if (Object.hasOwn(patch, 'args') && patch.args !== null) list(patch.args, 256).forEach(value => text(value, 8000, true));
  for (const key of ['env', 'headers']) if (Object.hasOwn(patch, key) && patch[key] !== null) {
    const entries = Object.entries(object(patch[key])); if (entries.length > 128) invalid();
    for (const [name, value] of entries) { if (['__proto__', 'constructor', 'prototype'].includes(name)) invalid(); id(name); text(value, 16_000, true); }
  }
  if (Object.hasOwn(patch, 'disabled') && patch.disabled !== null) flag(patch.disabled);
  if (Object.hasOwn(patch, 'oauth') && patch.oauth !== false) throw new Error('此编辑器只允许关闭 OAuth；新增授权请在本地服务中手动完成');
  const command = config.command ?? null; const url = config.url ?? null;
  if (Boolean(command) === Boolean(url)) invalid();
  if (command) text(command, 8000); else validateURL(url);
  if (JSON.stringify(config).length > 200_000) invalid();
  return { method: 'mcp.save', params: { name, config, ...(previous ? { previous_name: previous.name } : {}) } };
}
class SettingsEditor {
  constructor(bridge, inventory, { confirm, openSecureEditor, now = Date.now } = {}) {
    this.bridge = bridge; this.inventory = inventory; this.confirm = confirm; this.openSecureEditor = openSecureEditor; this.now = now; this.revisions = new Map(); this.busy = false; this.disposed = false;
  }
  dispose() { this.disposed = true; this.revisions.clear(); }
  snapshot(bootstrap, mcp, runnerId, fence) {
    if (this.disposed) throw new Error(UNAVAILABLE);
    const revision = randomUUID();
    let models = []; try { models = modelCatalog(bootstrap); } catch {}
    const autoReview = policy(bootstrap.auto_review);
    const providers = bootstrap.providers.map(provider => ({ id: id(provider.kind), canConfigure: configurableProvider(provider), canDisconnect: Boolean(provider.is_connected) || provider.kind.startsWith('custom:') }));
    let canManageMcp = false;
    try { canManageMcp = Boolean(runnerId && !object(mcp).error && list(mcp.servers, 512).map(mcpConfig)); } catch {}
    const entry = { fence, expires: this.now() + 5 * 60_000, runnerId, runners: new Map(bootstrap.devices.map(value => [value.id, hash(runnerConfig(value))])), bots: new Map(bootstrap.bots.map(value => [value.id, hash(botConfig(value))])), providers: new Map(bootstrap.providers.map(value => [value.kind, hash(providerConfig(value))])), providerNames: hash(bootstrap.providers.map(value => ({ id: value.kind, name: value.name ?? null }))), autoReview: hash(bootstrap.auto_review ?? null), mcp: new Map(), mcpAll: null };
    if (canManageMcp) { const servers = mcp.servers.map(mcpConfig); entry.mcp = new Map(servers.map(value => [value.name, hash(value)])); entry.mcpAll = hash(servers); }
    while (this.revisions.size >= 8) this.revisions.delete(this.revisions.keys().next().value);
    this.revisions.set(revision, entry);
    return { revision, canUpdateBots: bootstrap.bots.length > 0, models, bots: bootstrap.bots.map(value => ({ id: id(value.id), thinking: value.thinking == null ? null : text(value.thinking) })), providers, canAddProvider: true, canManageMcp, autoReview };
  }
  guard(entry, trusted) { if (this.disposed) throw new Error(UNAVAILABLE); trusted(); this.inventory.check(entry.fence); if (this.now() > entry.expires) throw new Error(STALE); }
  async read(action, entry, trusted) {
    this.guard(entry, trusted);
    const bootstrap = await this.bridge.sendValidated('bootstrap', {});
    this.guard(entry, trusted); this.inventory.observeSnapshot(bootstrap); this.guard(entry, trusted);
    const safe = projectSettingsBootstrap(bootstrap, this.bridge.getStatus().authMode);
    if (!safe.hasIdentity) throw new Error(UNAVAILABLE);
    if (action.runnerId && entry.runners.get(action.runnerId) !== hash(runnerConfig(bootstrap.devices.find(value => value.id === action.runnerId)))) throw new Error(STALE);
    let mcp = null;
    if (action.kind.startsWith('mcp.')) {
      if (entry.runnerId !== action.runnerId || !safe.devices.some(value => value.id === action.runnerId && value.online && ['macos', 'linux', 'windows'].includes(value.os))) throw new Error(UNAVAILABLE);
      mcp = await this.bridge.sendValidated('mcp.list', { runner_id: action.runnerId }); this.guard(entry, trusted);
      if (object(mcp).error) throw new Error(UNAVAILABLE);
      list(object(mcp).servers, 512).map(mcpConfig);
    }
    const fresh = { bootstrap, safe, mcp };
    this.checkBaseline(action, entry, fresh);
    return fresh;
  }
  checkBaseline(action, entry, { bootstrap, mcp }) {
    let expected, actual;
    if (action.kind === 'bot.update') { expected = entry.bots.get(action.botId); actual = hash(botConfig(bootstrap.bots.find(value => value.id === action.botId))); }
    else if (action.kind.startsWith('provider.')) {
      if (action.providerId) { expected = entry.providers.get(action.providerId); actual = hash(providerConfig(bootstrap.providers.find(value => value.kind === action.providerId))); }
      else { expected = entry.providerNames; actual = hash(bootstrap.providers.map(value => ({ id: value.kind, name: value.name ?? null }))); }
    } else if (action.kind === 'autoReview.set') { expected = entry.autoReview; actual = hash(bootstrap.auto_review ?? null); }
    else {
      if (action.name) { expected = entry.mcp.get(action.name); actual = hash(mcpConfig(mcp.servers.find(value => value.name === action.name))); }
      else { expected = entry.mcpAll; actual = hash(mcp.servers.map(mcpConfig)); }
      if (action.kind === 'mcp.remove' && entry.autoReview !== hash(bootstrap.auto_review ?? null)) throw new Error(STALE);
    }
    if (!expected || expected !== actual) throw new Error(STALE);
  }
  botMutation(action, fresh) {
    const bot = fresh.bootstrap.bots.find(value => value.id === action.botId);
    if (['provider', 'model', 'thinking'].some(key => Object.hasOwn(action, key))) {
      const provider = action.provider ?? bot.provider; const model = action.model ?? bot.model ?? '';
      const catalog = modelCatalog(fresh.bootstrap).filter(value => value.provider === provider);
      if (!fresh.bootstrap.providers.some(value => value.kind === provider && value.is_connected && !['system-one', 'decisions'].includes(value.api)) || catalog.length === 0 || (model && !catalog.some(value => value.id === model))) throw new Error(UNAVAILABLE);
      const thinking = action.thinking ?? bot.thinking ?? '';
      if (thinking && !catalog.find(value => value.id === (model || catalog[0].id))?.levels.includes(thinking)) invalid();
    }
    if (action.runnerId && !fresh.safe.devices.some(value => value.id === action.runnerId && ['macos', 'linux', 'windows'].includes(value.os))) throw new Error(UNAVAILABLE);
    return { method: 'bots.update', params: { id: action.botId, ...Object.fromEntries(['provider', 'model', 'thinking'].filter(key => Object.hasOwn(action, key)).map(key => [key, action[key]])), ...(action.runnerId ? { runner_id: action.runnerId } : {}) } };
  }
  async apply(value, trusted = () => {}) {
    const action = validateSettingsAction(value);
    if (this.busy) throw new Error('已有设置操作正在进行，请先完成或取消');
    if (typeof this.confirm !== 'function') throw new Error(UNAVAILABLE);
    const entry = this.revisions.get(action.revision); if (!entry) throw new Error(STALE);
    this.busy = true; let submitted = false;
    try {
      const fresh = await this.read(action, entry, trusted);
      let mutation, credentialHash = null, detail, target;
      if (action.kind === 'bot.update') {
        const bot = fresh.bootstrap.bots.find(value => value.id === action.botId);
        mutation = this.botMutation(action, fresh); target = `机器人「${label(bot.name)}」（${bot.id}）`;
        const delta = [];
        for (const [key, title] of [['provider', '服务商'], ['model', '模型'], ['thinking', '推理强度']]) if (Object.hasOwn(action, key)) delta.push(`${title}：${JSON.stringify(bot[key] || '默认')} → ${JSON.stringify(action[key] || '默认')}`);
        if (action.runnerId) {
          const describe = id => { const runner = fresh.safe.devices.find(value => value.id === id); return `${JSON.stringify(runner?.name || id)}（${id}，${runner?.online ? '在线' : '离线'}）`; };
          delta.push(`执行器：${describe(bot.runner_id)} → ${describe(action.runnerId)}`);
        }
        detail = `${delta.join('\n')}\n\n影响所有使用此机器人的私聊、群聊及后续任务，不是仅当前会话。不会迁移已经开始执行的任务。`;
      } else if (action.kind === 'autoReview.set') {
        if (policy(fresh.bootstrap.auto_review).status !== 'ready') throw new Error(UNAVAILABLE);
        mutation = { method: 'auto_review.set', params: { is_enabled: action.isEnabled, rules: action.rules } }; target = '当前账号的自动审批策略';
        const describeRules = rules => rules.length ? rules.map((value, index) => `${index + 1}. ${value.behavior === 'allow' ? '允许' : '每次询问'}\n规则 ID：${JSON.stringify(value.id ?? '新增')}\n工具：${JSON.stringify(value.tool ?? '所有工具')}\n完整规则文本：\n${value.text}`).join('\n\n') : '无规则';
        detail = `${action.isEnabled ? '将启用模型审核及允许规则，部分操作可能不再逐次询问。' : '将关闭自动审批，Shell 和有副作用的插件操作逐次询问。'}\n整份规则列表将替换，未出现在新列表的旧规则会删除。策略会同步到此账号的所有配对设备。\n\n现有规则：\n${describeRules(fresh.bootstrap.auto_review.rules)}\n\n替换后的完整规则：\n${describeRules(action.rules)}`;
      } else if (action.kind.startsWith('provider.')) {
        const provider = action.providerId ? fresh.bootstrap.providers.find(value => value.kind === action.providerId) : null;
        target = provider ? `服务商「${label(provider.name ?? provider.kind)}」（${provider.kind}）` : '新的自定义服务商';
        if (action.kind === 'provider.disconnect') { mutation = { method: 'providers.disconnect', params: { kind: action.providerId } }; detail = '将移除此服务商的账号级连接；自定义服务商会被删除，使用它的机器人或审批功能可能无法继续运行。部分服务商会撤销登录令牌。'; }
        else {
          if ((provider && !configurableProvider(provider)) || typeof this.openSecureEditor !== 'function') throw new Error(UNAVAILABLE);
          let credentials = null;
          if (provider) { credentials = object(await this.bridge.sendValidated('providers.api_key', { kind: provider.kind })); this.guard(entry, trusted); credentialHash = hash(credentials); }
          mutation = await this.openSecureEditor(providerForm(provider), () => this.guard(entry, trusted), value => providerSubmission(value, provider, credentials));
          this.guard(entry, trusted); if (mutation === null) return { status: 'cancelled' };
          const destination = new URL(mutation.params.base_url);
          detail = `${mutation.keyChange}。将向 ${destination.origin} 验证连接并保存账号级凭据。${destination.protocol === 'http:' ? '注意：此本机连接使用明文 HTTP。' : ''}\n配置会同步到此账号的所有配对设备，后续请求继续使用此配置。现有密钥不会回显。${mutation.params.name ? `\n保存名称：${JSON.stringify(mutation.params.name)}\n接口：${mutation.params.api}` : ''}`;
        }
      } else {
        const runner = fresh.safe.devices.find(value => value.id === action.runnerId);
        target = `执行器「${label(runner.name || runner.id)}」（${runner.id}，${runner.isThisDevice ? '本机' : '远程设备'}）${action.name ? `的 MCP「${label(action.name)}」` : '的 MCP 配置'}`;
        detail = '这会修改执行器配置；保存、启用、重连或重新加载可能启动本地程序并访问网络，程序拥有该执行器的权限。';
        if (action.kind === 'mcp.configure') {
          if (typeof this.openSecureEditor !== 'function') throw new Error(UNAVAILABLE);
          const previous = action.name ? fresh.mcp.servers.find(value => value.name === action.name) : null;
          mutation = await this.openSecureEditor({ title: previous ? '编辑 MCP 配置' : '添加 MCP 服务', description: '现有配置和密钥不回显。JSON 仅更新填写的顶层字段；env、headers 整项替换，null 删除字段。支持 command、args、env、cwd、url、headers、type、description、disabled 和 oauth:false。', fields: [field('name', '服务名称', 'text', action.name ?? ''), field('patch', '配置更新 JSON（留空保留原值）', 'textarea')] }, () => this.guard(entry, trusted), value => mcpSubmission(value, previous));
          this.guard(entry, trusted); if (mutation === null) return { status: 'cancelled' };
          if (fresh.mcp.servers.some(value => value.name === mutation.params.name && value.name !== action.name)) invalid();
        } else if (action.kind === 'mcp.setEnabled') mutation = { method: 'mcp.set_enabled', params: { name: action.name, enabled: action.enabled } };
        else if (action.kind === 'mcp.reconnect') mutation = { method: 'mcp.reconnect', params: { name: action.name, fresh: false } };
        else if (action.kind === 'mcp.remove') { mutation = { method: 'mcp.remove', params: { name: action.name } }; detail = '将删除此 MCP 服务的配置、插件目录、已保存凭据和关联的自动审批规则。此操作无法由客户端自动恢复。'; }
        else mutation = { method: 'mcp.reload', params: {} };
        if (!['mcp.remove', 'mcp.reload'].includes(action.kind)) {
          const servers = [{ name: mutation.params.name ?? action.name, config: mutation.params.config ?? fresh.mcp.servers.find(value => value.name === action.name)?.config }];
          const descriptions = servers.map(server => {
            const config = object(server.config); const enabled = action.kind === 'mcp.setEnabled' ? action.enabled : config.disabled !== true;
            const transport = config.url ? `HTTP，目标 ${new URL(validateURL(config.url)).origin}` : `stdio，命令 ${JSON.stringify(config.command)}`;
            const env = Object.keys(object(config.env ?? {})); const headers = Object.keys(object(config.headers ?? {}));
            return `MCP ${JSON.stringify(server.name)}：${enabled ? '启用，可能立即启动' : '停用'}\n${transport}\n环境变量 ${env.length} 项：${env.map(value => JSON.stringify(value)).join('、') || '无'}\n请求头 ${headers.length} 项：${headers.map(value => JSON.stringify(value)).join('、') || '无'}\n参数与凭据值不显示。${config.url ? '现有或新输入的请求头值将随连接发送给上述目标。' : '现有或新输入的环境变量将交给上述程序。'}`;
          });
          detail += `\n\n目标的当前缓存或拟提交配置（不是完整执行范围）：\n${descriptions.join('\n\n')}`;
        }
        if (['mcp.configure', 'mcp.setEnabled', 'mcp.remove', 'mcp.reload'].includes(action.kind)) detail = `重要：将应用该执行器整个 MCP 文件的当前磁盘内容。其他客户端或文件编辑器的未加载变更也可能一起生效并启动程序；当前列表无法完整预览这些变化。\n\n${detail}`;
        mutation.params.runner_id = action.runnerId;
      }
      if (fresh.safe.authMode === 'legacy') detail = `当前使用本地兼容连接（不校验令牌），请确认这是你信任的本机服务。\n\n${detail}`;
      this.guard(entry, trusted);
      const confirmed = await this.confirm({ title: '确认设置变更', message: visibleConfirmation(`是否更改${target}？`), detail: visibleConfirmation(detail) }, () => this.guard(entry, trusted));
      this.guard(entry, trusted); if (confirmed !== true) return { status: 'cancelled' };
      const latest = await this.read(action, entry, trusted);
      if (action.kind === 'bot.update') mutation = this.botMutation(action, latest);
      if (action.kind === 'mcp.configure' && latest.mcp.servers.some(value => value.name === mutation.params.name && value.name !== action.name)) throw new Error(STALE);
      if (credentialHash !== null) { const credentials = await this.bridge.sendValidated('providers.api_key', { kind: action.providerId }); this.guard(entry, trusted); if (hash(credentials) !== credentialHash) throw new Error(STALE); }
      this.guard(entry, trusted); submitted = true;
      await this.bridge.sendValidated(mutation.method, mutation.params); this.guard(entry, trusted);
      this.revisions.clear(); return { status: 'applied' };
    } catch (error) {
      if (submitted) { this.revisions.clear(); return { status: 'unknownOutcome' }; }
      if ([INVALID, STALE, UNAVAILABLE].includes(error?.message) || error?.message === 'Lorca 账号或连接已变化，请刷新后再继续') throw error;
      throw new Error('无法完成设置操作，未发送变更；请检查连接并刷新后重试');
    } finally { this.busy = false; }
  }
}
module.exports = { SettingsEditor, validateSettingsAction, providerSubmission, mcpSubmission };
