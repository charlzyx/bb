import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { demoSnapshot } from '../src/core/demo';
import { parseSnapshot, parseEvent, parseMessage } from '../src/core/protocol';
const require = createRequire(import.meta.url);
const { SettingsInventory, validateSettingsParams, sanitizeRendererEvent, sanitizeRendererResult, safeRendererError } = require('../native/settings.cjs');
const { validateRequest } = require('../native/bridge.cjs');
const { runCli } = require('../native/cli.cjs');
const secret = 'DO_NOT_EXPOSE_SYNTHETIC_SECRET';
const sharedLinkSecret = 'SYNTHETIC_SHARED_SECRET';
const playbookSecret = 'SYNTHETIC_PRIVATE_PLAYBOOK';
const privateFields = { path: secret, env: { KEY: secret }, args: [secret], cwd: secret, headers: { Authorization: secret }, oauth: { clientSecret: secret }, url: secret, base_url: secret, detail: secret };
const bootstrap = () => ({
  ...structuredClone(demoSnapshot), identity_id: 'account-one', relay_url: secret, relay_error: secret,
  shared_links: [{ url: `https://synthetic.invalid/#${sharedLinkSecret}` }],
  playbooks: [{ id: 'synthetic-playbook', name: playbookSecret, instructions: playbookSecret }],
  devices: [{ id: 'runner-one', name: 'Test Runner', os: 'macos', version: 'fixture', status: 'online', is_this_device: true, ...privateFields,
    plugins: [{ id: 'plugin-one', name: 'Test plugin', state: 'ready', ...privateFields }] }],
  providers: [{ kind: 'test-provider', name: 'Test Provider', is_connected: true, ...privateFields }],
  bots: [{ id: 'bot-one', name: 'Test Bot', runner_id: 'runner-one', provider: 'test-provider', model: 'test-model', ...privateFields }],
});
const mcp = () => ({ path: secret, error: `Invalid config ${secret}`, config: privateFields,
  servers: [{ name: 'test-server', id: 'mcp-one', transport: 'http', enabled: true, config: privateFields, problem: secret, tool_count: 4,
    status: { id: 'mcp-one', name: 'Test server', state: 'error', ...privateFields }, ...privateFields }],
});
class FakeBridge extends EventEmitter {
  status = { status: 'connected', generation: 1, authMode: 'token' };
  calls: { method: string; params: unknown }[] = [];
  closed = false;
  handler: (method: string, params: unknown) => Promise<unknown> = async method => method === 'bootstrap' ? bootstrap() : mcp();
  getStatus = () => ({ ...this.status });
  connect = async () => this.getStatus();
  close = () => { this.closed = true; };
  sendValidated = async (method: string, params: unknown) => { this.calls.push({ method, params }); return this.handler(method, params); };
}
const deferred = () => {
  let resolve: (value: unknown) => void = () => {};
  const promise = new Promise<unknown>(done => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('settings inventory exposes bounded summaries and never configuration, URLs, credentials or raw errors', async () => {
  const bridge = new FakeBridge(); const settings = new SettingsInventory(bridge);
  const value = await settings.get({}); settings.dispose();
  assert.equal(JSON.stringify(value).includes(secret), false);
  assert.deepEqual(value.devices[0], { id: 'runner-one', name: 'Test Runner', os: 'macos', version: 'fixture', online: true, isThisDevice: true, plugins: [{ id: 'plugin-one', name: 'Test plugin', state: 'ready', toolCount: null }] });
  assert.deepEqual(value.providers, [{ id: 'test-provider', name: 'Test Provider', connected: true }]);
  assert.deepEqual(value.bots, [{ id: 'bot-one', name: 'Test Bot', runnerId: 'runner-one', provider: 'test-provider', model: 'test-model' }]);
  assert.deepEqual(value.mcp, { status: 'ready', runnerId: 'runner-one', hasConfigError: true, servers: [{ name: 'test-server', transport: 'http', enabled: true, state: 'error', toolCount: 4, hiddenToolCount: null, hasError: true }] });
  assert.deepEqual(bridge.calls, [{ method: 'bootstrap', params: {} }, { method: 'mcp.list', params: {} }]);
  assert.throws(() => validateRequest('mcp.list', {}));
});

test('settings targets only a selected known Runner and keeps unknown counts distinct from zero', async () => {
  const bridge = new FakeBridge(); const settings = new SettingsInventory(bridge);
  bridge.handler = async method => method === 'bootstrap' ? bootstrap() : { error: null, servers: [
    { name: 'unknown', transport: null, enabled: true, problem: null, status: null, tool_count: null },
    { name: 'empty', transport: 'stdio', enabled: false, problem: null, status: null, tool_count: 0 },
  ] };
  const value = await settings.get({ runnerId: 'runner-one' });
  assert.equal(value.mcp.runnerId, 'runner-one');
  assert.deepEqual(bridge.calls[1], { method: 'mcp.list', params: { runner_id: 'runner-one' } });
  assert.equal(value.mcp.servers[0].toolCount, null); assert.equal(value.mcp.servers[1].toolCount, 0);
  assert.equal(value.mcp.servers[0].transport, 'unknown'); assert.equal(value.mcp.servers[1].state, 'disabled');
  bridge.calls = []; await assert.rejects(settings.get({ runnerId: 'other-runner' })); assert.equal(bridge.calls.length, 1);
  settings.dispose();
});

test('invalid inventory fields fail closed and unavailable MCP never masquerades as a ready empty catalog', async () => {
  for (const params of [null, [], { runnerId: '' }, { runnerId: 'a'.repeat(257) }, { runner_id: 'runner-one' }, { runnerId: 'runner-one', config: secret }]) assert.throws(() => validateSettingsParams(params));
  const bridge = new FakeBridge(); const settings = new SettingsInventory(bridge);
  bridge.handler = async method => { if (method === 'bootstrap') return bootstrap(); throw new Error(secret); };
  const unavailable = await settings.get();
  assert.deepEqual(unavailable.mcp, { status: 'unavailable', runnerId: 'runner-one', hasConfigError: false, servers: [] });
  assert.equal(JSON.stringify(unavailable).includes(secret), false);
  bridge.handler = async method => method === 'bootstrap' ? bootstrap() : { error: null, servers: 'invalid' };
  assert.equal((await settings.get()).mcp.status, 'unavailable');
  bridge.handler = async () => ({ ...bootstrap(), devices: Array(129).fill(bootstrap().devices[0]) });
  await assert.rejects(settings.get(), error => error instanceof Error && !error.message.includes(secret));
  bridge.handler = async () => ({ ...bootstrap(), providers: [{ kind: 'x', is_connected: 'yes', detail: secret }] });
  await assert.rejects(settings.get()); settings.dispose();
});

test('account and connection changes fence every settings await and prevent follow-on requests', async () => {
  for (const change of ['generation', 'identity']) {
    const bridge = new FakeBridge(); const settings = new SettingsInventory(bridge); const pending = deferred();
    bridge.handler = async () => pending.promise;
    const result = settings.get();
    if (change === 'generation') bridge.status.generation++;
    else bridge.emit('event', { event: 'identity.changed', data: { has_identity: true } });
    pending.resolve(bootstrap()); await assert.rejects(result, /账号或连接已变化/);
    assert.equal(bridge.calls.length, 1); settings.dispose();
  }
  const bridge = new FakeBridge(); const settings = new SettingsInventory(bridge); const pending = deferred();
  bridge.handler = async method => method === 'bootstrap' ? bootstrap() : pending.promise;
  const result = settings.get(); await tick();
  bridge.emit('event', { event: 'snapshot', data: { ...bootstrap(), identity_id: 'account-two' } });
  pending.resolve(mcp()); await assert.rejects(result, /账号或连接已变化/); settings.dispose();
});

test('bootstrap identity changes fence inventory without relying on a separate identity event', async () => {
  const bridge = new FakeBridge(); const settings = new SettingsInventory(bridge);
  await settings.get(); bridge.calls = [];
  bridge.handler = async method => method === 'bootstrap' ? { ...bootstrap(), identity_id: 'account-two' } : mcp();
  await assert.rejects(settings.get(), /账号或连接已变化/); assert.equal(bridge.calls.length, 1);
  assert.equal((await settings.get()).hasIdentity, true); settings.dispose();
});

test('existing bootstrap, roster and events keep the chat contract but drop private metadata before IPC', () => {
  const raw = { ...bootstrap(), chats: structuredClone(demoSnapshot.chats) };
  const projected = sanitizeRendererResult('bootstrap', raw);
  assert.deepEqual(parseSnapshot(projected), parseSnapshot(raw));
  assert.equal(JSON.stringify(projected).includes(secret), false);
  for (const event of [
    { event: 'snapshot', data: raw },
    { event: 'roster.changed', data: raw },
    { event: 'relay.status', data: { connected: true, update_required: false, url: secret, error: secret } },
  ]) {
    const clean = sanitizeRendererEvent(event);
    assert.equal(JSON.stringify(clean).includes(secret), false);
    assert.deepEqual(parseEvent(clean), parseEvent(event));
  }
  for (const event of ['provider.auth', 'plugin.auth', 'provider.status', 'unknown.event']) assert.equal(sanitizeRendererEvent({ event, data: { url: secret } }), null);
  const message = { ...structuredClone(demoSnapshot.chats[0].messages[0]), config: privateFields };
  const clean = sanitizeRendererResult('chats.send', { message, provider: privateFields });
  assert.deepEqual(parseMessage(clean.message), parseMessage(message));
  assert.equal(JSON.stringify(clean).includes(secret), false);
  assert.throws(() => sanitizeRendererEvent({ event: 'message.updated', data: { chat_id: 'other', message } }));
});

test('new bootstrap and roster fields never expose shared-link fragment keys or private playbooks', () => {
  const raw = bootstrap();
  assert.ok(JSON.stringify(raw).includes(sharedLinkSecret)); assert.ok(JSON.stringify(raw).includes(playbookSecret));
  const projected = sanitizeRendererResult('bootstrap', raw);
  assert.deepEqual(parseSnapshot(projected), parseSnapshot(raw));
  for (const value of [projected, ...['snapshot', 'roster.changed'].map(event => {
    const clean = sanitizeRendererEvent({ event, data: raw });
    assert.deepEqual(parseEvent(clean), parseEvent({ event, data: raw }));
    return clean.data;
  })]) {
    assert.equal(Object.hasOwn(value, 'shared_links'), false); assert.equal(Object.hasOwn(value, 'playbooks'), false);
    assert.equal(JSON.stringify(value).includes(sharedLinkSecret), false); assert.equal(JSON.stringify(value).includes(playbookSecret), false);
  }
});

test('IPC distinguishes remote error text from helpful local bridge guidance', () => {
  const local = new Error('The action result is unknown; it was not replayed.');
  assert.equal(safeRendererError(local), local);
  const remote = Object.assign(new Error(secret), { code: 'LORCA_REMOTE_ERROR' });
  assert.equal(safeRendererError(remote).message.includes(secret), false);
  assert.match(safeRendererError(remote).message, /未被自动重发/);
});

test('settings CLI uses the same projection, bounded params and read-only requests', async () => {
  const bridge = new FakeBridge(); const output: string[] = []; const errors: string[] = [];
  const code = await runCli(['settings', '{"runnerId":"runner-one"}'], { makeBridge: () => bridge, stdout: (text: string) => output.push(text), stderr: (text: string) => errors.push(text), env: {} });
  assert.equal(code, 0); assert.deepEqual(errors, []); assert.equal(output.join('').includes(secret), false);
  assert.equal(JSON.parse(output.join('')).mcp.runnerId, 'runner-one'); assert.equal(bridge.closed, true);
  assert.deepEqual(bridge.calls.map(call => call.method), ['bootstrap', 'mcp.list']); assert.equal(bridge.listenerCount('event'), 0);
  let created = false;
  assert.equal(await runCli(['settings', '{"path":"private"}'], { makeBridge: () => { created = true; return new FakeBridge(); }, stderr: () => {}, stdout: () => {}, env: {} }), 2);
  assert.equal(created, false);
});

test('an authoritative bootstrap after an offline account swap is returned and invalidates older inventory', () => {
  const bridge = new FakeBridge(); const settings = new SettingsInventory(bridge);
  settings.observeSnapshot(bootstrap()); bridge.status.generation++;
  const fence = settings.capture();
  const result = settings.projectResult('bootstrap', { ...bootstrap(), identity_id: 'account-two' }, fence);
  assert.equal(parseSnapshot(result).identity_id, 'account-two');
  assert.throws(() => settings.check(fence), /账号或连接已变化/);
  assert.equal(settings.projectResult('bootstrap', { ...bootstrap(), identity_id: 'account-two' }, settings.capture()).identity_id, 'account-two');
  settings.dispose();
});

test('renderer projection preserves every existing message body and empty group-exchange bot IDs', () => {
  const base = structuredClone(demoSnapshot.chats[0].messages[0]);
  const bodies = [
    { kind: 'text', text: 'Attachment only', attachments: [{ id: 'a', name: 'file.txt', mime: 'text/plain', size: 42, path: secret }] },
    { kind: 'text', text: 'No attachments' },
    { kind: 'tool', name: 'bash', summary: 'Test command', detail: 'Output', is_running: false, run: { state: 'asking', command: 'echo hello', output: null, reason: 'Needs permission', rule: 'Read the test fixture', env: privateFields } },
    { kind: 'tool', name: 'test', summary: '', detail: '', is_running: false, is_error: true },
    { kind: 'permission', plugin_id: 'fixture', plugin_name: 'Fixture', tool: 'read', summary: 'Read the fixture', decision: 'pending', reason: 'Test', rule: 'Read test fixtures', command: 'cat fixture', code: secret, link: secret },
    { kind: 'notice', text: 'Notice' },
    { kind: 'handoff', from: 'one', to: 'two', reason: 'Test handoff' },
    { kind: 'future-kind', config: privateFields },
  ];
  for (const body of bodies) {
    const message = { ...base, body };
    const projected = sanitizeRendererResult('chats.send', { message });
    assert.deepEqual(parseMessage(projected.message), parseMessage(message));
    assert.equal(JSON.stringify(projected).includes(secret), false);
  }
  for (const chat of demoSnapshot.chats) for (const message of chat.messages) {
    assert.deepEqual(parseMessage(sanitizeRendererResult('chats.send', { message }).message), parseMessage(message));
  }
  const event = { event: 'job.started', data: { chat_id: 'group', bot_id: '', job_id: 'exchange' } };
  assert.deepEqual(parseEvent(sanitizeRendererEvent(event)), parseEvent(event));
  assert.equal(sanitizeRendererEvent({ event: 'future.event', data: null }), null);
});

test('legacy and unknown-device inventory preserves meaningful absence and known plugin state', async () => {
  const bridge = new FakeBridge(); bridge.status.authMode = 'legacy'; const settings = new SettingsInventory(bridge);
  bridge.handler = async method => method === 'bootstrap' ? { ...bootstrap(),
    devices: [{ id: 'unknown', name: '', os: '', status: 'offline', plugins: [] }, { ...bootstrap().devices[0], plugins: [{ id: 'p', name: 'P', state: 'insufficient_access' }] }],
    bots: [{ id: 'b', name: 'B', runner_id: 'runner-one' }], providers: [{ kind: 'provider', is_connected: false }],
  } : mcp();
  const value = await settings.get();
  assert.equal(value.authMode, 'legacy'); assert.equal(value.devices[0].version, ''); assert.equal(value.devices[0].isThisDevice, false);
  assert.equal(value.devices[1].plugins[0].state, 'insufficient_access'); assert.equal(value.bots[0].provider, null); assert.equal(value.bots[0].model, null);
  assert.equal(value.providers[0].name, 'provider'); settings.dispose();
});

test('default MCP inventory identifies only the actual local Runner', async () => {
  const bridge = new FakeBridge(); const settings = new SettingsInventory(bridge);
  const local = await settings.get(); assert.equal(local.mcp.runnerId, 'runner-one');
  assert.deepEqual(bridge.calls[1], { method: 'mcp.list', params: {} });
  bridge.handler = async method => method === 'bootstrap' ? { ...bootstrap(), devices: [
    { ...bootstrap().devices[0], is_this_device: false },
    { id: 'phone', name: 'Phone', os: 'ios', status: 'online', is_this_device: true, plugins: [] },
  ] } : mcp();
  assert.equal((await settings.get()).mcp.runnerId, null);
  await assert.rejects(settings.get({ runnerId: 'phone' })); settings.dispose();
});

test('the native bridge ignores unknown event data before validation but keeps known events strict', () => {
  const { LorcaBridge } = require('../native/bridge.cjs');
  const bridge = new LorcaBridge({ legacy: true });
  const events: unknown[] = []; bridge.on('event', (event: unknown) => events.push(event));
  const generation = bridge.getStatus().generation;
  bridge.handle(JSON.stringify({ event: 'future.event', data: null }), generation);
  bridge.handle(JSON.stringify({ event: 'provider.auth', data: { url: secret } }), generation);
  assert.equal(bridge.getStatus().generation, generation); assert.deepEqual(events, []);
  bridge.handle(JSON.stringify({ event: 'identity.changed', data: null }), generation);
  assert.equal(bridge.getStatus().status, 'error'); assert.ok(bridge.getStatus().generation > generation);
  assert.equal(JSON.stringify(bridge.getStatus()).includes(secret), false); bridge.close();
});

test('failed messages retain failure status while native projection removes raw provider errors', () => {
  const message = { ...structuredClone(demoSnapshot.chats[0].messages[0]), state: { kind: 'failed', error: secret } };
  for (const value of [
    sanitizeRendererResult('chats.send', { message }),
    sanitizeRendererResult('chats.messages', { messages: [message], has_more: false }),
    sanitizeRendererEvent({ event: 'message.updated', data: { chat_id: message.chat_id, message } }),
  ]) assert.equal(JSON.stringify(value).includes(secret), false);
  const parsed = parseMessage(sanitizeRendererResult('chats.send', { message }).message);
  assert.equal(parsed.state, 'failed');
  assert.equal(parsed.error, 'Lorca 未能完成这条消息，请检查本地运行服务');
});

test('latest upstream secret request metadata and answers cannot cross the ordinary renderer boundary', () => {
  const message = { ...demoSnapshot.chats[0].messages[0], body: { kind: 'permission', plugin_id: 'browser', plugin_name: 'Browser', tool: 'secret', summary: 'Enter sign-in details in the native client', decision: 'pending', secret: { use: 'browser', site: secret, fields: [{ name: secret, label: secret }] }, values: { password: secret } } };
  const result = sanitizeRendererResult('chats.send', { message });
  assert.equal(result.message.body.tool, 'secret');
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.throws(() => validateRequest('chats.permission', { chat_id: 'chat-demo', message_id: 'secret-request', decision: 'allow', values: { password: secret } }), /不支持的参数/);
  for (const method of ['secrets.list', 'secrets.set', 'secrets.delete']) assert.throws(() => validateRequest(method, {}), /不支持/);
});

test('outbound draft cards stay explicitly unsupported without exposing unreviewed draft payloads', () => {
  const message = { ...demoSnapshot.chats[0].messages[0], body: { kind: 'draft', review_id: secret, version: 1, state: 'pending', plugin_id: 'mail', account: secret, draft: { kind: 'email', to: [secret], body: secret }, direct: true } };
  const result = sanitizeRendererResult('chats.send', { message });
  assert.deepEqual(result.message.body, { kind: 'draft' });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(parseMessage(result.message).body, { kind: 'unsupported', originalKind: 'draft' });
});
