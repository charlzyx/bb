import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { AgentCapabilities, validateCapabilityAction } = require('../native/agent-capabilities.cjs');
const { SettingsInventory } = require('../native/settings.cjs');
const { RPC_METHODS } = require('../native/bridge.cjs');
const secret = 'SYNTHETIC_SECRET_NOT_FOR_RENDERER';
type Data = Record<string, any>;
const routine = (extra: Data = {}) => ({ id: 'rt-one', bot_id: 'bot-one', name: 'Daily summary', prompt: 'Synthetic updates', schedule: '0 9 * * 1-5', schedule_text: 'Weekdays at 9', timezone: 'Asia/Shanghai', missed_run_policy: 'coalesce', is_enabled: true, is_running: false, state: 'on', next_run_at: 1_800_000_000, last_run_at: null, last_outcome: null, paused_reason: null, feedback_authorization_prompt: secret, ...extra });
class Bridge extends EventEmitter {
  status = { status: 'connected', generation: 1, endpoint: 'ws://127.0.0.1:4862/ws', authMode: 'token' };
  bootstrap: Data = { has_identity: true, identity_id: 'account-one', credentials: secret,
    bots: [{ id: 'bot-one', name: 'Research Agent', runner_id: 'runner-one', instructions: secret, permissions: { connections: { plugin: { capabilities: ['read'], tools: ['lookup'] }, hidden: { capabilities: ['draft'], tools: ['saved'] } }, filesystem: 'read', shell: false, drafts: true } }, { id: 'bot-two', name: 'Other', runner_id: 'runner-one' }],
    routines: [routine(), routine({ id: 'other-routine', bot_id: 'bot-two' })], devices: [{ id: 'runner-one', name: 'Synthetic Runner', status: 'online', os: 'macos', detail: secret }] };
  catalog: Data = { connections: [{ id: 'plugin', name: 'Synthetic Mail', auth: secret, tools: [{ name: 'lookup', title: 'Look up', capability: 'read', description: secret }, { name: 'send', title: null, capability: 'write', schema: secret }] }, { id: 'second', name: 'Other plugin', tools: [] }] };
  calls: { method: string; params: Data }[] = [];
  handler: ((method: string, params: Data) => Promise<unknown>) | null = null;
  getStatus = () => ({ ...this.status });
  sendValidated = async (method: string, params: Data): Promise<unknown> => { this.calls.push({ method, params: structuredClone(params) }); return this.handler ? this.handler(method, params) : this.reply(method, params); };
  reply(method: string, params: Data): unknown {
    if (method === 'bootstrap') return structuredClone(this.bootstrap);
    if (method === 'bots.permissions') return structuredClone(this.catalog);
    if (method === 'routines.describe') return { ...params, text: 'Synthetic schedule', next_run_at: 1_800_000_000 };
    if (method === 'bots.update') { this.bootstrap.bots[0].permissions = structuredClone(params.permissions); return { bot: structuredClone(this.bootstrap.bots[0]), secret }; }
    if (method === 'routines.create') { const item = routine({ id: 'rt-new', ...params, is_enabled: params.enabled }); this.bootstrap.routines.push(item); return { routine: structuredClone(item), secret }; }
    if (method === 'routines.update') { const item = this.bootstrap.routines.find((item: Data) => item.id === params.id); Object.assign(item, params); if ('enabled' in params) item.is_enabled = params.enabled; return { routine: structuredClone(item), secret }; }
    if (method === 'routines.delete') { this.bootstrap.routines = this.bootstrap.routines.filter((item: Data) => item.id !== params.id); return null; }
    if (method === 'routines.run') { this.bootstrap.routines[0].is_running = true; this.bootstrap.routines[0].state = 'running'; return null; }
    throw new Error(`Unexpected ${method}`);
  }
}
const writes = (bridge: Bridge) => bridge.calls.filter(call => !['bootstrap', 'bots.permissions', 'routines.describe'].includes(call.method));
async function setup(options: Data = {}) {
  const bridge = new Bridge(), inventory = new SettingsInventory(bridge), prompts: Data[] = [];
  const capabilities = new AgentCapabilities(bridge, inventory, { confirm: async (prompt: Data) => { prompts.push(prompt); return true; }, ...options });
  const initial = await capabilities.get({ botId: 'bot-one' }); bridge.calls = [];
  return { bridge, inventory, capabilities, initial, prompts, dispose: () => { capabilities.dispose(); inventory.dispose(); } };
}
const create = (revision: string, extra: Data = {}) => ({ kind: 'routine.create', revision, draft: { name: 'New summary', prompt: 'Synthetic task', schedule: 'every 30m', timezone: 'Asia/Shanghai', missedRunPolicy: 'coalesce', enabled: false, ...extra } });
const grant = (revision: string, extra: Data = {}) => ({ kind: 'plugin.setAccess', revision, connectionId: 'plugin', capabilities: ['read', 'write'], tools: ['lookup', 'send'], ...extra });

test('capabilities project only selected safe data and keep independent one-use revisions', async () => {
  const f = await setup(), value = f.initial;
  assert.equal(value.botId, 'bot-one'); assert.equal(value.routines.length, 1); assert.equal(value.routines[0].editable, true); assert.equal(value.routines[0].lastRunAt, null);
  assert.deepEqual(value.plugins[0].capabilities, ['read']); assert.deepEqual(value.plugins[0].allowedTools, ['lookup']);
  assert.deepEqual(value.permissions, { allConnections: false, filesystem: 'read', shell: false, drafts: true });
  assert.equal(JSON.stringify(value).includes(secret), false); assert.equal(JSON.stringify(value).includes('other-routine'), false);
  for (const method of ['routines.create', 'routines.update', 'routines.run', 'routines.delete', 'bots.permissions', 'bots.update']) assert.equal(RPC_METHODS.includes(method), false);
  const next = await f.capabilities.get({ botId: 'bot-one' }); assert.equal(next.version, value.version); assert.notEqual(next.revision, value.revision);
  await assert.rejects(f.capabilities.apply({ kind: 'routine.run', revision: value.revision, routineId: 'rt-one' })); f.dispose();
});

test('strict schemas reject hidden fields, wrong types, empty edits, combined enable, scripts and advanced schedules', () => {
  for (const value of [null, {}, { kind: 'routine.run', revision: 'r', routineId: 'rt-one', script: secret }, { kind: 'routine.edit', revision: 'r', routineId: 'rt-one', patch: {} }, { kind: 'routine.edit', revision: 'r', routineId: 'rt-one', patch: { enabled: true } }, { kind: 'routine.edit', revision: 'r', routineId: 'rt-one', patch: { check: 'read()' } }, { kind: 'routine.edit', revision: 'r', routineId: 'rt-one', patch: { prompt: '' } }, create('r', { schedule: '15m before events' }), create('r', { enabled: 'yes' }), create('r', { name: 'x'.repeat(61) }), grant('r', { capabilities: ['admin'] }), grant('r', { capabilities: ['read', 'read'] }), grant('r', { tools: ['lookup', 'lookup'] }), grant('r', { filesystem: 'write' }), grant('r', { connectionId: 'plugin\0secret' })]) assert.throws(() => validateCapabilityAction(value));
});

test('create previews exact plan and sends one mutation with verified persistent readback', async () => {
  const f = await setup(); assert.deepEqual(await f.capabilities.apply(create(f.initial.revision)), { status: 'applied', botId: 'bot-one', routineId: 'rt-new' });
  assert.deepEqual(writes(f.bridge), [{ method: 'routines.create', params: { bot_id: 'bot-one', name: 'New summary', prompt: 'Synthetic task', schedule: 'every 30m', timezone: 'Asia/Shanghai', missed_run_policy: 'coalesce', enabled: false } }]);
  for (const term of ['Research Agent', 'Synthetic Runner', 'Asia/Shanghai', 'Synthetic task', '费用', '外部操作', '没有原子版本比较']) assert.ok(f.prompts[0].detail.includes(term));
  assert.equal(f.prompts[0].detail.includes(secret), false); f.dispose();
});

test('edit sends only given fields and does not implicitly enable or drop stored configuration', async () => {
  const f = await setup(); assert.equal((await f.capabilities.apply({ kind: 'routine.edit', revision: f.initial.revision, routineId: 'rt-one', patch: { name: 'Renamed', prompt: 'New task' } })).status, 'applied');
  assert.deepEqual(writes(f.bridge)[0], { method: 'routines.update', params: { id: 'rt-one', name: 'Renamed', prompt: 'New task' } }); assert.equal(f.bridge.bootstrap.routines[0].feedback_authorization_prompt, secret); f.dispose();
});

test('toggle and delete are single writes, disclose active work continues and delete is irreversible', async () => {
  for (const kind of ['routine.setEnabled', 'routine.delete']) { const f = await setup();
    assert.equal((await f.capabilities.apply({ kind, revision: f.initial.revision, routineId: 'rt-one', ...(kind === 'routine.setEnabled' ? { enabled: false } : {}) })).status, 'applied');
    assert.equal(writes(f.bridge).length, 1); assert.ok(/不取消|不会取消/.test(f.prompts[0].detail)); if (kind === 'routine.delete') assert.ok(f.prompts[0].detail.includes('无法在此恢复')); f.dispose(); }
});

test('paused Run Now reports requested rather than completed', async () => {
  const f = await setup(); f.bridge.bootstrap.routines[0].is_enabled = false; f.bridge.bootstrap.routines[0].state = 'paused'; const fresh = await f.capabilities.get({ botId: 'bot-one' }); f.bridge.calls = [];
  assert.deepEqual(await f.capabilities.apply({ kind: 'routine.run', revision: fresh.revision, routineId: 'rt-one' }), { status: 'applied', botId: 'bot-one', routineId: 'rt-one', requested: true });
  assert.equal(writes(f.bridge).length, 1); assert.ok(f.prompts[0].detail.includes('可能创建')); assert.ok(f.prompts[0].detail.includes('不保证每次再次询问')); f.dispose();
});

test('running, authentication-blocked and offline states prevent an immediate run', async () => {
  for (const extra of [{ is_running: true }, { paused_reason: 'authentication' }, { state: 'waiting_for_runner' }]) { const f = await setup(); Object.assign(f.bridge.bootstrap.routines[0], extra); const fresh = await f.capabilities.get({ botId: 'bot-one' });
    await assert.rejects(f.capabilities.apply({ kind: 'routine.run', revision: fresh.revision, routineId: 'rt-one' })); assert.equal(writes(f.bridge).length, 0); f.dispose(); }
});

test('check and advanced trigger configurations are visible read-only while pause remains supported', async () => {
  for (const extra of [{ check: 'return syntheticRead()' }, { pull_request: { repo: 'example/repo', number: 1 } }, { calendar: { account: 'Synthetic account' } }]) { const f = await setup(); Object.assign(f.bridge.bootstrap.routines[0], extra); let fresh = await f.capabilities.get({ botId: 'bot-one' });
    assert.equal(fresh.routines[0].editable, false); assert.equal(JSON.stringify(fresh).includes('syntheticRead'), false);
    await assert.rejects(f.capabilities.apply({ kind: 'routine.edit', revision: fresh.revision, routineId: 'rt-one', patch: { name: 'Change' } }), /检查脚本或高级/);
    assert.equal(writes(f.bridge).length, 0); fresh = await f.capabilities.get({ botId: 'bot-one' }); assert.equal((await f.capabilities.apply({ kind: 'routine.setEnabled', revision: fresh.revision, routineId: 'rt-one', enabled: false })).status, 'applied'); f.dispose(); }
});

test('plugin grants preserve files, shell, drafts, other instances and independent capability semantics', async () => {
  const f = await setup(); assert.equal((await f.capabilities.apply(grant(f.initial.revision, { capabilities: ['write'], tools: null }))).status, 'applied');
  assert.equal(writes(f.bridge).length, 1); assert.deepEqual(writes(f.bridge)[0].params.permissions, { connections: { plugin: { capabilities: ['write'] }, hidden: { capabilities: ['draft'], tools: ['saved'] } }, filesystem: 'read', shell: false, drafts: true });
  for (const term of ['所有聊天', '例行任务', '正在运行', '独立授权', '未来的所有工具', '不会安装', '增加权限']) assert.ok(f.prompts[0].detail.includes(term)); f.dispose();
});

test('default-all becomes a disclosed explicit current inventory without silently granting future plugins', async () => {
  const f = await setup(); delete f.bridge.bootstrap.bots[0].permissions; const fresh = await f.capabilities.get({ botId: 'bot-one' }); assert.equal(fresh.permissions.allConnections, true);
  await f.capabilities.apply(grant(fresh.revision, { capabilities: [], tools: [] }));
  assert.deepEqual(writes(f.bridge)[0].params.permissions, { connections: { plugin: { capabilities: [], tools: [] }, second: { capabilities: ['read', 'draft', 'write'] } }, filesystem: 'write', shell: true, drafts: true }); assert.ok(f.prompts[0].detail.includes('以后新安装')); f.dispose();
});

test('unavailable catalog permits routine reads but never plugin edits or raw errors', async () => {
  const f = await setup(); f.bridge.handler = async (method, params) => { if (method === 'bots.permissions') throw new Error(secret); return f.bridge.reply(method, params); };
  const fresh = await f.capabilities.get({ botId: 'bot-one' }); assert.equal(fresh.capabilities.canEditPlugins, false); assert.equal(fresh.plugins.length, 0); assert.equal(fresh.routines.length, 1);
  await assert.rejects(f.capabilities.apply(grant(fresh.revision)), error => error instanceof Error && !error.message.includes(secret)); assert.equal(writes(f.bridge).length, 0); f.dispose();
});

test('unknown connection and tool names cannot acquire grants', async () => {
  for (const extra of [{ connectionId: 'unknown' }, { tools: ['not-catalogued'] }]) { const f = await setup(); await assert.rejects(f.capabilities.apply(grant(f.initial.revision, extra))); assert.equal(writes(f.bridge).length, 0); f.dispose(); }
});

for (const mode of ['identity', 'generation', 'endpoint', 'authMode', 'selection', 'trusted', 'expiry', 'disposed', 'runner', 'catalog', 'permissions']) test(`confirmation fences ${mode}`, async () => {
  let now = 0, trusted = true; const f = await setup({ now: () => now }); f.capabilities.confirm = async () => {
    if (mode === 'identity') f.bridge.bootstrap.identity_id = 'account-two';
    if (mode === 'generation') f.bridge.status.generation++;
    if (mode === 'endpoint') f.bridge.status.endpoint = 'ws://127.0.0.1:4863/ws';
    if (mode === 'authMode') f.bridge.status.authMode = 'legacy';
    if (mode === 'selection') f.capabilities.invalidate();
    if (mode === 'trusted') trusted = false;
    if (mode === 'expiry') now = 300_000;
    if (mode === 'disposed') f.capabilities.dispose();
    if (mode === 'runner') f.bridge.bootstrap.bots[0].runner_id = 'new-runner';
    if (mode === 'catalog') f.bridge.catalog.connections[0].tools.push({ name: 'new', capability: 'write' });
    if (mode === 'permissions') f.bridge.bootstrap.bots[0].permissions.shell = true;
    return true;
  }; await assert.rejects(f.capabilities.apply(grant(f.initial.revision), () => { if (!trusted) throw new Error(secret); })); assert.equal(writes(f.bridge).length, 0); f.dispose();
});

test('cancellation consumes the one-use ticket without writing', async () => {
  const f = await setup({ confirm: async () => false }), action = create(f.initial.revision);
  assert.deepEqual(await f.capabilities.apply(action), { status: 'cancelled', botId: 'bot-one' }); assert.equal(writes(f.bridge).length, 0); await assert.rejects(f.capabilities.apply(action)); f.dispose();
});

for (const mode of ['timeout', 'readback', 'malformedAck', 'accountAfterAck']) test(`submitted ${mode} is unknown and never replayed`, async () => {
  const f = await setup(); let submitted = false; f.bridge.handler = async (method, params) => {
    if (method === 'routines.run') { submitted = true; if (mode === 'timeout') throw new Error(secret); if (mode === 'malformedAck') return { secret }; if (mode === 'accountAfterAck') f.bridge.bootstrap.identity_id = 'account-two'; return f.bridge.reply(method, params); }
    if (method === 'bootstrap' && submitted && mode === 'readback') throw new Error(secret); return f.bridge.reply(method, params);
  }; const action = { kind: 'routine.run', revision: f.initial.revision, routineId: 'rt-one' };
  assert.deepEqual(await f.capabilities.apply(action), { status: 'unknownOutcome', botId: 'bot-one', routineId: 'rt-one' }); assert.equal(writes(f.bridge).length, 1); await assert.rejects(f.capabilities.apply(action)); assert.equal(writes(f.bridge).length, 1); f.dispose();
});

test('valid ACK without matching readback is not success', async () => {
  const f = await setup(); f.bridge.handler = async (method, params) => method === 'routines.update' ? { routine: routine({ name: params.name }) } : f.bridge.reply(method, params);
  assert.equal((await f.capabilities.apply({ kind: 'routine.edit', revision: f.initial.revision, routineId: 'rt-one', patch: { name: 'Renamed' } })).status, 'unknownOutcome'); f.dispose();
});

test('one-time skip, duplicate names and the twenty-routine limit are blocked before writing', async () => {
  const f = await setup(); await assert.rejects(f.capabilities.apply(create(f.initial.revision, { schedule: 'once 2030-01-01 09:00', missedRunPolicy: 'skip' })));
  let fresh = await f.capabilities.get({ botId: 'bot-one' }); await assert.rejects(f.capabilities.apply(create(fresh.revision, { name: 'daily SUMMARY' })));
  f.bridge.bootstrap.routines = Array.from({ length: 20 }, (_, i) => routine({ id: `rt-${i}`, name: `Task ${i}` })); fresh = await f.capabilities.get({ botId: 'bot-one' });
  assert.equal(fresh.capabilities.canCreateRoutine, false); await assert.rejects(f.capabilities.apply(create(fresh.revision))); assert.equal(writes(f.bridge).length, 0); f.dispose();
});

test('native confirmation escapes bidi without rewriting user data', async () => {
  const f = await setup(), name = 'Task\u202Eabc'; await f.capabilities.apply(create(f.initial.revision, { name })); assert.equal(writes(f.bridge)[0].params.name, name);
  assert.equal(f.prompts[0].detail.includes('\u202E'), false); assert.ok(f.prompts[0].detail.includes('\\u202e')); f.dispose();
});

test('unknown pause reasons are generic and do not disclose raw backend text', async () => {
  const f = await setup(); f.bridge.bootstrap.routines[0].paused_reason = secret;
  const result = await f.capabilities.get({ botId: 'bot-one' }); assert.equal(result.routines[0].pausedReason, 'other'); assert.equal(JSON.stringify(result).includes(secret), false); f.dispose();
});

test('sparse actions and malformed nullable policies fail closed', async () => {
  assert.throws(() => validateCapabilityAction(grant('r', { capabilities: Array(1) })));
  assert.throws(() => validateCapabilityAction(grant('r', { tools: Array(1) })));
  for (const key of ['filesystem', 'shell', 'drafts']) { const f = await setup(); f.bridge.bootstrap.bots[0].permissions[key] = null; await assert.rejects(f.capabilities.get({ botId: 'bot-one' })); assert.equal(writes(f.bridge).length, 0); f.dispose(); }
});

test('prototype-shaped plugin IDs remain exact own keys and cannot inherit phantom grants', async () => {
  const f = await setup(); f.bridge.catalog.connections[0].id = '__proto__';
  const fresh = await f.capabilities.get({ botId: 'bot-one' }); assert.deepEqual(fresh.plugins[0].capabilities, []);
  assert.equal((await f.capabilities.apply(grant(fresh.revision, { connectionId: '__proto__' }))).status, 'applied');
  assert.ok(Object.hasOwn(writes(f.bridge)[0].params.permissions.connections, '__proto__')); assert.deepEqual(writes(f.bridge)[0].params.permissions.connections.__proto__.capabilities, ['read', 'write']); f.dispose();
});
