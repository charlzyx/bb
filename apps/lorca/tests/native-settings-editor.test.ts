import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { demoSnapshot } from '../src/core/demo';

const require = createRequire(import.meta.url);
const { SettingsInventory } = require('../native/settings.cjs');
const { SettingsEditor, validateSettingsAction, providerSubmission, mcpSubmission } = require('../native/settings-editor.cjs');
const { RPC_METHODS } = require('../native/bridge.cjs');
const secret = 'NEVER_ECHO_EXISTING_SYNTHETIC_KEY';
const makeBootstrap = () => ({
  ...structuredClone(demoSnapshot), has_identity: true, identity_id: 'account-one',
  devices: [
    { id: 'runner-one', name: 'First Runner', os: 'macos', version: 'fixture', status: 'online', is_this_device: true, plugins: [] },
    { id: 'runner-two', name: 'Other Runner', os: 'linux', version: 'fixture', status: 'offline', is_this_device: false, plugins: [] },
    { id: 'phone', name: 'Phone', os: 'ios', version: 'fixture', status: 'online', is_this_device: false, plugins: [] },
  ],
  providers: [
    { kind: 'deepseek', is_connected: true, detail: secret, base_url: 'https://provider.example/v1' },
    { kind: 'custom:one', name: 'Custom One', api: 'responses', is_connected: true, detail: secret, models: [{ id: 'custom-model', name: 'Custom Model', levels: [] }] },
    { kind: 'custom:review', name: 'Review only', api: 'decisions', is_connected: true, models: [{ id: 'decision', levels: [] }] },
  ],
  models: [{ provider: 'deepseek', id: 'old-model', name: 'Old Model', levels: ['high'], decides: false }, { provider: 'deepseek', id: 'new-model', name: 'New Model', levels: [], decides: false }],
  bots: [{ id: 'bot-one', name: 'Actual Bot', runner_id: 'runner-one', provider: 'deepseek', model: 'old-model', thinking: 'high' }],
  auto_review: { is_enabled: false, rules: [{ id: 'old-rule', text: 'Ask before writing', behavior: 'ask', tool: 'shell.run' }], provider: 'custom:review', models: { 'custom:review': 'decision' } },
});
const makeMcp = () => ({ path: secret, error: null, servers: [{ name: 'server-one', transport: 'stdio', enabled: true, problem: null, status: null, tool_count: 3,
  config: { command: 'node', args: [secret], env: { TOKEN: secret }, headers: { Authorization: secret }, extension: { secret }, oauth: { clientSecret: secret } },
}] });
class FakeBridge extends EventEmitter {
  status = { status: 'connected', generation: 1, authMode: 'token' };
  bootstrap = makeBootstrap(); mcp = makeMcp(); credentials: { api_key: string; base_url: string | null } = { api_key: secret, base_url: 'https://provider.example/v1' };
  calls: { method: string; params: Record<string, unknown> }[] = [];
  getStatus = () => ({ ...this.status });
  handler: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | null = null;
  sendValidated = async (method: string, params: Record<string, unknown>) => {
    this.calls.push({ method, params: structuredClone(params) });
    if (this.handler) return this.handler(method, params);
    if (method === 'bootstrap') return structuredClone(this.bootstrap);
    if (method === 'mcp.list') return structuredClone(this.mcp);
    if (method === 'providers.api_key') return structuredClone(this.credentials);
    return { raw: secret };
  };
}
type Prompt = { title: string; message: string; detail: string };
type Form = { title: string; description: string; fields: { key: string; type: string; value: string }[] };
const mutations = (bridge: FakeBridge) => bridge.calls.filter(call => !['bootstrap', 'mcp.list', 'providers.api_key'].includes(call.method));
async function setup(options: Record<string, unknown> = {}) {
  const bridge = new FakeBridge(); const inventory = new SettingsInventory(bridge); const prompts: Prompt[] = [];
  const editor = new SettingsEditor(bridge, inventory, { confirm: async (prompt: Prompt) => { prompts.push(prompt); return true; }, ...options });
  inventory.editor = editor;
  const settings = await inventory.get({ runnerId: 'runner-one' }); bridge.calls = [];
  return { bridge, inventory, editor, prompts, settings, revision: settings.editor.revision, dispose: () => { editor.dispose(); inventory.dispose(); } };
}

test('native editor inventory offers custom chat models without leaking provider or MCP secrets', async () => {
  const ctx = await setup();
  assert.equal(JSON.stringify(ctx.settings).includes(secret), false);
  assert.ok(ctx.settings.editor.models.some((model: { id: string }) => model.id === 'custom-model'));
  assert.equal(ctx.settings.editor.models.some((model: { id: string }) => model.id === 'decision'), false);
  assert.equal(ctx.settings.editor.providers.find((provider: { id: string }) => provider.id === 'custom:review').canConfigure, false);
  assert.equal(ctx.settings.editor.autoReview.status, 'ready'); assert.equal(ctx.settings.editor.canManageMcp, true);
  for (const method of ['bots.update', 'providers.api_key', 'providers.connect_custom', 'mcp.save', 'auto_review.set']) assert.equal(RPC_METHODS.includes(method), false);
  ctx.dispose();
});

test('action schema rejects raw configuration, unknown fields, coercions and accidental allow defaults before I/O', () => {
  for (const action of [null, [], {}, { kind: 'provider.configure', revision: 'r', apiKey: secret }, { kind: 'mcp.configure', revision: 'r', runnerId: 'runner-one', config: {} }, { kind: 'bot.update', revision: 'r', botId: 'bot-one' }, { kind: 'bot.update', revision: 'r', botId: 'bot-one', model: null }, { kind: 'bot.update', revision: 'r', botId: 'bot-one', provider: ' ' }, { kind: 'mcp.setEnabled', revision: 'r', runnerId: 'runner-one', name: 'server-one', enabled: 'false' }, { kind: 'autoReview.set', revision: 'r', isEnabled: true, rules: [{ text: 'Anything', behavior: 'ALLOW' }] }, { kind: 'autoReview.set', revision: 'r', isEnabled: false, rules: [{ text: '   ', behavior: 'ask' }] }]) assert.throws(() => validateSettingsAction(action));
});

test('bot changes show exact old and new scope and send only dirty fields once', async () => {
  const ctx = await setup();
  const result = await ctx.editor.apply({ kind: 'bot.update', revision: ctx.revision, botId: 'bot-one', model: 'new-model', thinking: '', runnerId: 'runner-two' });
  assert.deepEqual(result, { status: 'applied' });
  assert.deepEqual(mutations(ctx.bridge), [{ method: 'bots.update', params: { id: 'bot-one', model: 'new-model', thinking: '', runner_id: 'runner-two' } }]);
  const confirmation = JSON.stringify(ctx.prompts);
  for (const value of ['Actual Bot', 'bot-one', 'old-model', 'new-model', 'runner-one', 'runner-two', '离线', '所有使用此机器人', '不会迁移']) assert.ok(confirmation.includes(value), value);
  await assert.rejects(ctx.editor.apply({ kind: 'bot.update', revision: ctx.revision, botId: 'bot-one', model: '' }), /刷新/);
  ctx.dispose();
});

test('Runner-only updates allow an unavailable provider but phone assignments and incompatible retained thinking are rejected', async () => {
  const ctx = await setup();
  await assert.rejects(ctx.editor.apply({ kind: 'bot.update', revision: ctx.revision, botId: 'bot-one', model: 'new-model' }));
  await assert.rejects(ctx.editor.apply({ kind: 'bot.update', revision: ctx.revision, botId: 'bot-one', runnerId: 'phone' }));
  assert.equal(mutations(ctx.bridge).length, 0);
  ctx.bridge.bootstrap.providers[0].is_connected = false; ctx.bridge.bootstrap.models = [];
  assert.deepEqual(await ctx.editor.apply({ kind: 'bot.update', revision: ctx.revision, botId: 'bot-one', runnerId: 'runner-two' }), { status: 'applied' });
  assert.deepEqual(mutations(ctx.bridge)[0].params, { id: 'bot-one', runner_id: 'runner-two' }); ctx.dispose();
});

test('cancellation, stale target edits, renamed bots and full-policy conflicts never mutate', async () => {
  const cancelled = await setup({ confirm: async () => false });
  assert.deepEqual(await cancelled.editor.apply({ kind: 'bot.update', revision: cancelled.revision, botId: 'bot-one', runnerId: 'runner-two' }), { status: 'cancelled' });
  assert.equal(mutations(cancelled.bridge).length, 0); cancelled.dispose();
  for (const phase of ['before', 'confirmation']) {
    const ctx = await setup();
    const rename = () => { ctx.bridge.bootstrap.bots[0].name = 'Renamed elsewhere'; };
    if (phase === 'before') rename(); else ctx.editor.confirm = async () => { rename(); return true; };
    await assert.rejects(ctx.editor.apply({ kind: 'bot.update', revision: ctx.revision, botId: 'bot-one', runnerId: 'runner-two' }), /其他位置变化/);
    assert.equal(mutations(ctx.bridge).length, 0); ctx.dispose();
  }
  const ctx = await setup(); ctx.editor.confirm = async () => { ctx.bridge.bootstrap.auto_review.rules.push({ id: 'external', text: 'Other client rule', behavior: 'ask', tool: 'write' }); return true; };
  await assert.rejects(ctx.editor.apply({ kind: 'autoReview.set', revision: ctx.revision, isEnabled: true, rules: [] }), /其他位置变化/);
  assert.equal(mutations(ctx.bridge).length, 0); ctx.dispose();
});

test('account, connection, sender and expiry fences remain active across confirmation awaits', async () => {
  for (const change of ['generation', 'identity', 'sender', 'expiry']) {
    let now = 0; let trusted = true;
    const ctx = await setup({ now: () => now });
    ctx.editor.confirm = async () => {
      if (change === 'generation') ctx.bridge.status.generation++;
      if (change === 'identity') ctx.bridge.emit('event', { event: 'identity.changed', data: { has_identity: true } });
      if (change === 'sender') trusted = false;
      if (change === 'expiry') now = 300_001;
      return true;
    };
    await assert.rejects(ctx.editor.apply({ kind: 'bot.update', revision: ctx.revision, botId: 'bot-one', runnerId: 'runner-two' }, () => { if (!trusted) throw new Error(secret); }), error => error instanceof Error && !error.message.includes(secret));
    assert.equal(mutations(ctx.bridge).length, 0); ctx.dispose();
  }
});

test('unknown mutation outcomes are safe, invalidate revisions and are never replayed', async () => {
  const ctx = await setup();
  ctx.bridge.handler = async method => { if (method === 'bootstrap') return structuredClone(ctx.bridge.bootstrap); throw new Error(secret); };
  const action = { kind: 'bot.update', revision: ctx.revision, botId: 'bot-one', runnerId: 'runner-two' };
  assert.deepEqual(await ctx.editor.apply(action), { status: 'unknownOutcome' });
  await assert.rejects(ctx.editor.apply(action)); assert.equal(mutations(ctx.bridge).length, 1); ctx.dispose();
});

test('provider credentials stay native, blank inputs preserve them and explicit destination appears only in native confirmation', async () => {
  let form: Form | null = null;
  const ctx = await setup({ openSecureEditor: async (spec: Form, guard: () => void, validate: (value: unknown) => unknown) => { form = spec; guard(); return validate({ baseUrl: '', apiKey: '' }); } });
  ctx.bridge.status.authMode = 'legacy';
  assert.deepEqual(await ctx.editor.apply({ kind: 'provider.configure', revision: ctx.revision, providerId: 'deepseek' }), { status: 'applied' });
  assert.equal(JSON.stringify(form).includes(secret), false); assert.equal(JSON.stringify(ctx.prompts).includes(secret), false);
  assert.ok(JSON.stringify(ctx.prompts).includes('https://provider.example')); assert.ok(JSON.stringify(ctx.prompts).includes('未进行身份验证'));
  assert.deepEqual(mutations(ctx.bridge), [{ method: 'providers.connect_deepseek', params: { api_key: secret, base_url: 'https://provider.example/v1' } }]); ctx.dispose();
});

test('provider unknown destinations and credential changes while editing do not send writes', async () => {
  const ctx = await setup({ openSecureEditor: async (_spec: Form, _guard: () => void, validate: (value: unknown) => unknown) => validate({ baseUrl: '', apiKey: '' }) });
  ctx.bridge.credentials.base_url = null;
  await assert.rejects(ctx.editor.apply({ kind: 'provider.configure', revision: ctx.revision, providerId: 'deepseek' })); assert.equal(mutations(ctx.bridge).length, 0);
  ctx.bridge.credentials.base_url = 'https://provider.example/v1';
  ctx.editor.confirm = async () => { ctx.bridge.credentials.api_key = 'CHANGED_SYNTHETIC_KEY'; return true; };
  await assert.rejects(ctx.editor.apply({ kind: 'provider.configure', revision: ctx.revision, providerId: 'deepseek' }), /其他位置变化/); assert.equal(mutations(ctx.bridge).length, 0); ctx.dispose();
});

test('provider secure forms reject unsafe destinations, repair old URLs, and never silently clear a whitespace key', () => {
  const provider = { kind: 'custom:one', name: 'Custom One', api: 'responses', models: [{ id: 'custom-model' }] };
  const values = { name: 'Custom One', api: 'responses', baseUrl: 'https://safe.example/v1', apiKey: '   ', clearApiKey: 'no', models: '' };
  const result = providerSubmission(values, provider, { api_key: secret, base_url: 'http://old-remote.example/?key=old' });
  assert.equal(result.params.api_key, secret); assert.equal(result.keyChange, '保留密钥'); assert.deepEqual(result.params.models, ['custom-model']);
  for (const url of ['https://user:pass@example.com', 'https://example.com/?key=private', 'https://example.com/#fragment', 'http://remote.example.com', 'file:///private']) assert.throws(() => providerSubmission({ ...values, baseUrl: url }, provider, null));
  assert.equal(providerSubmission({ ...values, clearApiKey: 'yes' }, provider, { api_key: secret, base_url: null }).params.api_key, '');
  assert.equal(providerSubmission({ ...values, baseUrl: 'http://127.0.0.1:8080/v1' }, provider, null).params.base_url, 'http://127.0.0.1:8080/v1');
});

test('MCP editing preserves native-only unknown configuration and secrets while confirmation identifies execution scope', async () => {
  let form: Form | null = null;
  const ctx = await setup({ openSecureEditor: async (spec: Form, _guard: () => void, validate: (value: unknown) => unknown) => { form = spec; return validate({ name: 'server-one', patch: '{"description":"Updated description"}' }); } });
  assert.deepEqual(await ctx.editor.apply({ kind: 'mcp.configure', revision: ctx.revision, runnerId: 'runner-one', name: 'server-one' }), { status: 'applied' });
  assert.equal(JSON.stringify(form).includes(secret), false); assert.equal(JSON.stringify(ctx.prompts).includes(secret), false);
  for (const value of ['runner-one', '本机', 'stdio', 'node', 'TOKEN', 'Authorization', '启用']) assert.ok(JSON.stringify(ctx.prompts).includes(value), value);
  const mutation = mutations(ctx.bridge)[0]; assert.equal(mutation.method, 'mcp.save');
  assert.deepEqual(mutation.params, { name: 'server-one', previous_name: 'server-one', runner_id: 'runner-one', config: { ...ctx.bridge.mcp.servers[0].config, description: 'Updated description' } }); ctx.dispose();
});

test('MCP toggles state explicitly, removal warns about credentials and rules, and runner mismatch cannot write', async () => {
  const ctx = await setup();
  await assert.rejects(ctx.editor.apply({ kind: 'mcp.remove', revision: ctx.revision, runnerId: 'runner-two', name: 'server-one' }));
  assert.equal(mutations(ctx.bridge).length, 0);
  assert.deepEqual(await ctx.editor.apply({ kind: 'mcp.setEnabled', revision: ctx.revision, runnerId: 'runner-one', name: 'server-one', enabled: false }), { status: 'applied' });
  assert.ok(ctx.prompts[0].detail.includes('停用')); assert.equal(mutations(ctx.bridge)[0].params.enabled, false);
  const settings = await ctx.inventory.get({ runnerId: 'runner-one' });
  await ctx.editor.apply({ kind: 'mcp.remove', revision: settings.editor.revision, runnerId: 'runner-one', name: 'server-one' });
  for (const value of ['删除', '凭据', '自动审批规则', '无法']) assert.ok(ctx.prompts[1].detail.includes(value)); ctx.dispose();
});

test('MCP secret editor rejects invalid patches and OAuth expansion without echoing prior values', () => {
  const previous = makeMcp().servers[0];
  for (const patch of ['[]', '{"oauth":true}', '{"alwaysAllow":["*"]}', '{"env":{"constructor":"x"}}', '{"args":"--bad"}', '{"url":"https://example.com"}']) assert.throws(() => mcpSubmission({ name: 'server-one', patch }, previous));
  const result = mcpSubmission({ name: 'new-name', patch: '{"command":null,"args":null,"url":"https://mcp.example/service","type":"http"}' }, previous);
  assert.equal(result.params.previous_name, 'server-one'); assert.equal(result.params.config.command, undefined); assert.deepEqual(result.params.config.env, previous.config.env);
});

test('automatic approval confirms complete old/new rule text and never writes latest-only review model fields', async () => {
  const ctx = await setup(); const text = `${'Detailed scope '.repeat(260)}FINAL_RULE_BOUNDARY`;
  await ctx.editor.apply({ kind: 'autoReview.set', revision: ctx.revision, isEnabled: true, rules: [{ text, behavior: 'allow', tool: 'shell.run' }] });
  const detail = ctx.prompts[0].detail;
  for (const value of ['Ask before writing', 'FINAL_RULE_BOUNDARY', 'shell.run', '允许', '删除', '所有配对设备']) assert.ok(detail.includes(value), value);
  assert.ok(detail.includes(text));
  assert.deepEqual(mutations(ctx.bridge)[0], { method: 'auto_review.set', params: { is_enabled: true, rules: [{ text, behavior: 'allow', tool: 'shell.run' }] } }); ctx.dispose();
});

test('secure window static boundary provides only dedicated input IPC and no raw daemon or network route', async () => {
  const preload = await readFile(new URL('../native/secure-settings-preload.cjs', import.meta.url), 'utf8');
  const window = await readFile(new URL('../native/secure-settings.cjs', import.meta.url), 'utf8');
  const html = await readFile(new URL('../native/secure-editor.html', import.meta.url), 'utf8');
  const page = await readFile(new URL('../native/secure-editor.js', import.meta.url), 'utf8');
  assert.match(preload, /dotsSecureSettings/); assert.doesNotMatch(preload, /sendValidated|readFile|lorca:request|connect:/);
  for (const value of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'devTools: false', 'partition: `dots-settings-', 'isTrustedSender', 'clearStorageData', 'resources.has(details.url)']) assert.ok(window.includes(value), value);
  assert.match(html, /connect-src 'none'/); assert.match(html, /form-action 'none'/);
  assert.match(page, /'password'/); assert.match(page, /autocomplete = 'off'/); assert.doesNotMatch(page, /innerHTML|localStorage|sessionStorage|fetch\(/);
});

test('every MCP file mutation warns about unpreviewable whole-file changes and reload does not promise cached execution scope', async () => {
  for (const kind of ['mcp.configure', 'mcp.setEnabled', 'mcp.remove', 'mcp.reload']) {
    const ctx = await setup({ openSecureEditor: async (_spec: Form, _guard: () => void, validate: (value: unknown) => unknown) => validate({ name: 'server-one', patch: '{}' }) });
    await ctx.editor.apply({ kind, revision: ctx.revision, runnerId: 'runner-one', ...(kind === 'mcp.reload' ? {} : { name: 'server-one' }), ...(kind === 'mcp.setEnabled' ? { enabled: false } : {}) });
    for (const value of ['整个 MCP 文件', '未加载变更', '启动程序', '无法完整预览']) assert.ok(ctx.prompts[0].detail.includes(value), `${kind}: ${value}`);
    if (kind === 'mcp.reload') { assert.equal(ctx.prompts[0].detail.includes('server-one'), false); assert.equal(ctx.prompts[0].detail.includes('node'), false); }
    ctx.dispose();
  }
});

test('native confirmation escapes bidirectional controls without changing rule data sent to the daemon', async () => {
  const ctx = await setup(); const text = 'Only this exact scope \u202e\u061c\u200e\u200f\u2066 shown visibly';
  await ctx.editor.apply({ kind: 'autoReview.set', revision: ctx.revision, isEnabled: false, rules: [{ text, behavior: 'ask' }] });
  for (const control of ['\u202e', '\u061c', '\u200e', '\u200f', '\u2066']) { assert.ok(ctx.prompts[0].detail.includes(`\\u${control.charCodeAt(0).toString(16).padStart(4, '0')}`)); assert.equal(ctx.prompts[0].detail.includes(control), false); }
  assert.deepEqual(mutations(ctx.bridge)[0].params.rules, [{ text, behavior: 'ask' }]); ctx.dispose();
});
