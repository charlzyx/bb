import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { createPairingFlow, parsePairingString } = require('../native/pairing.cjs');
const { SettingsInventory } = require('../native/settings.cjs');
const { validateRequest } = require('../native/bridge.cjs');
const marker = 'SYNTHETIC_PAIR_SECRET_MUST_NOT_ESCAPE';
const nonce = Buffer.alloc(16, 3).toString('base64url');
const code = `lorca://pair?relay=${encodeURIComponent('https://synthetic.invalid/relay')}&id=${Buffer.alloc(32, 1).toString('base64url')}&ek=${Buffer.alloc(32, 2).toString('base64url')}&n=${nonce}`;
const identityId = parsePairingString(code).identityId;
const source = (joined = true) => ({ has_identity: joined, identity_id: joined ? identityId : null, this_device_id: joined ? 'local-device' : null, relay_url: joined ? 'https://synthetic.invalid/relay' : null, relay_connected: false });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve: (value: unknown) => void = () => {}; let reject: (value: unknown) => void = () => {}; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class FakeSession extends EventEmitter {
  clears = 0;
  request: ((value: { url: string }, callback: (result: { cancel: boolean }) => void) => void) | null = null;
  webRequest = { onBeforeRequest: (handler: typeof this.request) => { this.request = handler; } };
  setPermissionRequestHandler() {}
  setPermissionCheckHandler() {}
  async clearStorageData() { this.clears++; }
  async clearCache() { this.clears++; }
}
class FakeContents extends EventEmitter {
  mainFrame = { url: '' };
  session = new FakeSession();
  updates: { channel: string; value: unknown }[] = [];
  setWindowOpenHandler() {}
  send(channel: string, value: unknown) { this.updates.push({ channel, value: structuredClone(value) }); }
}
class FakeWindow extends EventEmitter {
  static instances: FakeWindow[] = [];
  webContents = new FakeContents();
  destroyed = false;
  constructor(readonly options: Record<string, unknown> = {}) { super(); FakeWindow.instances.push(this); }
  isDestroyed() { return this.destroyed; }
  setMenuBarVisibility() {}
  show() {}
  destroy() { this.destroyed = true; this.emit('closed'); }
  async loadFile(file: string) { this.webContents.mainFrame.url = pathToFileURL(file).href; }
}
class FakeBridge extends EventEmitter {
  status = { status: 'connected', authMode: 'token', generation: 1, endpoint: 'ws://127.0.0.1:4862/ws' };
  bootstrap = source();
  calls: { method: string; params: Record<string, unknown>; options: unknown }[] = [];
  handler: (method: string, params: Record<string, unknown>) => Promise<unknown> = async method => {
    if (method === 'bootstrap') return structuredClone(this.bootstrap);
    if (method === 'pair.start') return { nonce, pairing_string: code };
    if (method === 'pair.status') return { state: 'waiting' };
    return null;
  };
  getStatus = () => ({ ...this.status });
  sendValidated = async (method: string, params: Record<string, unknown>, options: unknown) => { this.calls.push({ method, params: structuredClone(params), options }); return this.handler(method, params); };
}
function setup(joined = true) {
  FakeWindow.instances = [];
  const bridge = new FakeBridge(); bridge.bootstrap = source(joined);
  const inventory = new SettingsInventory(bridge), parent = new FakeWindow();
  const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
  const prompts: Record<string, unknown>[] = [];
  let response = 1, time = 0, trusted = true;
  const dialog = { showMessageBox: async (_window: unknown, spec: Record<string, unknown>) => { prompts.push(spec); return { response }; } };
  const flow = createPairingFlow({ BrowserWindow: FakeWindow, ipcMain: { handle: (key: string, value: (event: unknown, values?: unknown) => unknown) => handlers.set(key, value) }, dialog, bridge, inventory, getParent: () => parent, getIcon: () => undefined, now: () => time });
  const invoke = (name: string, child: FakeWindow, values?: unknown) => handlers.get(`lorca:secure-pairing-${name}`)?.({ sender: child.webContents, senderFrame: child.webContents.mainFrame }, values);
  const begin = async (mode = joined ? 'invite' : 'join') => { const pending = flow.open(mode, () => { if (!trusted) throw new Error(marker); }); await tick(); return { pending, child: FakeWindow.instances.at(-1)! }; };
  return { flow, bridge, inventory, parent, prompts, dialog, handlers, invoke, begin, response: (value: number) => { response = value; }, time: (value: number) => { time = value; }, untrust: () => { trusted = false; }, dispose: () => { flow.close(); inventory.dispose(); } };
}
const writes = (bridge: FakeBridge) => bridge.calls.filter(call => !['bootstrap', 'pair.status'].includes(call.method));

test('pairing parser binds canonical keys, exact fields and HTTPS destination without accepting ambiguous URLs', () => {
  assert.match(identityId, /^[0-9a-f]{16}$/); assert.equal(parsePairingString(code).nonce, nonce);
  for (const value of [null, '', `prefix${code}`, `${code}&id=extra`, `${code}&secret=${marker}`, `${code}#fragment`, code.replace('https%3A', 'http%3A'), code.replace('synthetic.invalid', 'user%40synthetic.invalid'), code.replace('synthetic.invalid', 'synthetic.invalid%3Fkey%3Dsecret'), code.replace(nonce, 'bad'), code.replace('&ek=', '&ek=%00'), `${code}${'x'.repeat(8192)}`]) assert.throws(() => parsePairingString(value));
  for (const method of ['pair.start', 'pair.accept', 'pair.status', 'pair.cancel', 'pair.abort']) assert.throws(() => validateRequest(method, {}));
});

test('capabilities are local token-mode gates and never claim remote method support or relay connectivity', () => {
  const ctx = setup();
  assert.deepEqual(ctx.flow.capabilities(source()), { invite: true, join: false });
  assert.deepEqual(ctx.flow.capabilities(source(false)), { invite: false, join: true });
  ctx.bridge.status.authMode = 'legacy'; assert.deepEqual(ctx.flow.capabilities(source()), { invite: false, join: false });
  ctx.bridge.status.authMode = 'token'; ctx.bridge.status.status = 'disconnected'; assert.deepEqual(ctx.flow.capabilities(source(false)), { invite: false, join: false });
  assert.deepEqual(ctx.flow.capabilities({ has_identity: 'yes' }), { invite: false, join: false }); ctx.dispose();
});

test('invite requires explicit native confirmation before any mutation and cancellation is not success', async () => {
  const ctx = setup(); ctx.response(0);
  const { pending, child } = await ctx.begin();
  assert.deepEqual(writes(ctx.bridge), []);
  assert.deepEqual(await ctx.invoke('submit', child, { nonce: marker }), { ok: false, error: '配对参数无效。' });
  await ctx.invoke('submit', child, {});
  assert.equal(writes(ctx.bridge).length, 0); assert.equal(ctx.prompts.length, 1);
  assert.match(String(ctx.prompts[0].detail), /DEK/); assert.match(String(ctx.prompts[0].detail), /服务商凭据/); assert.match(String(ctx.prompts[0].detail), /没有第二次审批/); assert.match(String(ctx.prompts[0].detail), /注册本机并创建中继访问凭据/);
  assert.match(String(ctx.prompts[0].detail), /管理执行器功能/); assert.match(String(ctx.prompts[0].detail), /读取\/修改文件/);
  assert.equal(ctx.prompts[0].defaultId, 0);
  ctx.invoke('close', child); assert.deepEqual(await pending, { status: 'cancelled' }); assert.equal(ctx.flow.isActive(), false); ctx.dispose();
});

test('invite codes only reach the isolated window and completed results contain a bounded device summary', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const ctx = setup(), { pending, child } = await ctx.begin();
  await ctx.invoke('submit', child, {});
  const view = ctx.invoke('init', child) as { pairingString: string; phase: string };
  assert.equal(view.pairingString, code); assert.equal(view.phase, 'waiting');
  assert.equal(JSON.stringify(ctx.prompts).includes(code), false); assert.equal(JSON.stringify(ctx.prompts).includes(nonce), false);
  const original = ctx.bridge.handler;
  ctx.bridge.handler = async (method, params) => method === 'pair.status' ? { state: 'completed', device: { id: 'new-device', name: 'Test device', os: 'android', model: 'Phone', token: marker } } : original(method, params);
  ctx.time(1000); context.mock.timers.tick(1000); await tick();
  ctx.invoke('close', child);
  assert.deepEqual(await pending, { status: 'completed', device: { id: 'new-device', name: 'Test device', os: 'android', model: 'Phone' } });
  assert.equal(writes(ctx.bridge).filter(call => call.method === 'pair.start').length, 1);
  assert.equal(child.webContents.session.clears, 2); assert.equal(ctx.flow.isActive(), false); ctx.dispose();
});

test('closing a known invite makes one scope-checked best-effort cancellation but never claims revocation', async () => {
  const ctx = setup(), { pending, child } = await ctx.begin(); await ctx.invoke('submit', child, {});
  ctx.invoke('close', child); assert.deepEqual(await pending, { status: 'unknownOutcome' }); await tick();
  assert.deepEqual(writes(ctx.bridge).map(call => [call.method, call.params]), [['pair.start', {}], ['pair.cancel', { nonce }]]);
  ctx.flow.close(); assert.equal(writes(ctx.bridge).length, 2); assert.equal(ctx.flow.isActive(), false); ctx.dispose();
});

test('late start results after close only cancel their own nonce in the unchanged session and scope', async () => {
  for (const change of ['none', 'generation', 'identity', 'relay', 'device']) {
    const ctx = setup(), late = deferred(), original = ctx.bridge.handler;
    ctx.bridge.handler = async (method, params) => method === 'pair.start' ? late.promise : original(method, params);
    const { pending, child } = await ctx.begin(); const submitting = ctx.invoke('submit', child, {}); await tick();
    ctx.invoke('close', child); assert.deepEqual(await pending, { status: 'unknownOutcome' }); assert.equal(ctx.flow.isActive(), true);
    if (change === 'generation') ctx.bridge.status.generation++;
    if (change === 'identity') { ctx.bridge.bootstrap.identity_id = 'other-account'; ctx.inventory.observeSnapshot(ctx.bridge.bootstrap); }
    if (change === 'relay') ctx.bridge.bootstrap.relay_url = 'https://other.invalid/';
    if (change === 'device') ctx.bridge.bootstrap.this_device_id = 'other-local-device';
    late.resolve({ nonce, pairing_string: code }); await submitting;
    assert.equal(writes(ctx.bridge).filter(call => call.method === 'pair.cancel').length, change === 'none' ? 1 : 0, change);
    assert.equal(ctx.flow.isActive(), false); ctx.dispose();
  }
});

test('confirmation-time account, relay, device or trusted-sender changes send no invitation', async () => {
  for (const change of ['identity', 'relay', 'device', 'sender']) {
    const ctx = setup();
    ctx.dialog.showMessageBox = async () => {
      if (change === 'identity') { ctx.bridge.bootstrap.identity_id = 'other-account'; ctx.inventory.observeSnapshot(ctx.bridge.bootstrap); }
      if (change === 'relay') ctx.bridge.bootstrap.relay_url = 'https://other.invalid/';
      if (change === 'device') ctx.bridge.bootstrap.this_device_id = 'other-local-device';
      if (change === 'sender') ctx.untrust();
      return { response: 1 };
    };
    const { pending, child } = await ctx.begin(); await ctx.invoke('submit', child, {});
    assert.equal(writes(ctx.bridge).length, 0, change); ctx.flow.close(); assert.deepEqual(await pending, { status: 'failed' }); ctx.dispose();
  }
});

test('join succeeds only after matching response plus authoritative snapshot regardless of event ordering', async () => {
  for (const eventsFirst of [true, false]) {
    const ctx = setup(false), original = ctx.bridge.handler;
    ctx.bridge.handler = async (method, params) => {
      if (method !== 'pair.accept') return original(method, params);
      ctx.bridge.bootstrap = { ...source(), this_device_id: 'joined-device' };
      if (eventsFirst) { ctx.bridge.emit('event', { event: 'identity.changed', data: { has_identity: true } }); ctx.bridge.emit('event', { event: 'snapshot', data: ctx.bridge.bootstrap }); }
      return { id: 'joined-device', name: 'My PC', os: 'linux', identity_id: identityId, secret: marker };
    };
    const { pending, child } = await ctx.begin(); await ctx.invoke('submit', child, { pairingString: code, deviceName: 'My PC' });
    assert.match(String(ctx.prompts[0].detail), /取代.*其他客户端/); assert.match(String(ctx.prompts[0].detail), /若本机运行 Lorca 执行器/); assert.match(String(ctx.prompts[0].detail), /不保证每次都在本机再次询问/); assert.equal(JSON.stringify(ctx.prompts).includes(code), false);
    const accept = writes(ctx.bridge)[0]; assert.equal(accept.method, 'pair.accept'); assert.deepEqual(accept.options, { timeoutMs: 610000 });
    ctx.invoke('close', child); assert.deepEqual(await pending, { status: 'completed', device: { id: 'joined-device', name: 'My PC', os: 'linux' } }); ctx.dispose();
  }
});

test('closed joining requests remain locked until settled and never abort or replay a daemon-global operation', async () => {
  const ctx = setup(false), late = deferred(), original = ctx.bridge.handler;
  ctx.bridge.handler = async (method, params) => method === 'pair.accept' ? late.promise : original(method, params);
  const { pending, child } = await ctx.begin(); const submitting = ctx.invoke('submit', child, { pairingString: code, deviceName: '' }); await tick();
  ctx.invoke('close', child); assert.deepEqual(await pending, { status: 'unknownOutcome' }); assert.equal(ctx.flow.isActive(), true);
  await assert.rejects(ctx.flow.open('join')); assert.equal(writes(ctx.bridge).length, 1);
  ctx.bridge.bootstrap = { ...source(), this_device_id: 'joined-device' };
  late.resolve({ id: 'joined-device', name: 'PC', os: 'linux', identity_id: identityId }); await submitting;
  assert.equal(ctx.flow.isActive(), false); assert.equal(writes(ctx.bridge).length, 1); ctx.dispose();
});

test('wrong identities and raw remote errors never become join success or leak secret text', async () => {
  for (const failure of ['response', 'snapshot', 'identity-event', 'error']) {
    const ctx = setup(false), original = ctx.bridge.handler;
    ctx.bridge.handler = async (method, params) => {
      if (method !== 'pair.accept') return original(method, params);
      if (failure === 'error') throw new Error(marker);
      ctx.bridge.bootstrap = { ...source(), this_device_id: 'joined-device', identity_id: failure === 'snapshot' ? 'wrong-identity' : identityId };
      if (failure === 'identity-event') ctx.bridge.emit('event', { event: 'identity.changed', data: { has_identity: false } });
      return { id: 'joined-device', name: 'PC', os: 'linux', identity_id: failure === 'response' ? 'wrong-identity' : identityId };
    };
    const { pending, child } = await ctx.begin(); const response = await ctx.invoke('submit', child, { pairingString: code });
    ctx.flow.close(); assert.deepEqual(await pending, { status: 'unknownOutcome' });
    assert.equal(JSON.stringify(response).includes(marker), false); assert.equal(JSON.stringify(child.webContents.updates).includes(marker), false); assert.equal(writes(ctx.bridge).length, 1); ctx.dispose();
  }
});

test('unknown start outcomes without nonce never cancel, retry, or display remote error details', async () => {
  const ctx = setup(), original = ctx.bridge.handler;
  ctx.bridge.handler = async (method, params) => { if (method === 'pair.start') throw new Error(marker); return original(method, params); };
  const { pending, child } = await ctx.begin(); const result = await ctx.invoke('submit', child, {});
  assert.equal(JSON.stringify(result).includes(marker), false); await ctx.invoke('submit', child, {});
  ctx.invoke('close', child); assert.deepEqual(await pending, { status: 'unknownOutcome' }); assert.deepEqual(writes(ctx.bridge).map(call => call.method), ['pair.start']); ctx.dispose();
});

test('secure pairing binds exact sender/frame and fixed resources, expires idle input and clears storage', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const ctx = setup(false), { pending, child } = await ctx.begin();
  assert.throws(() => ctx.invoke('init', ctx.parent));
  assert.throws(() => ctx.handlers.get('lorca:secure-pairing-init')?.({ sender: child.webContents, senderFrame: { url: child.webContents.mainFrame.url } }));
  assert.equal(child.destroyed, false);
  const preferences = child.options.webPreferences as Record<string, unknown>;
  assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.devTools, false);
  assert.match(String(preferences.partition), /^dots-pairing-/); assert.equal(String(preferences.partition).startsWith('persist:'), false);
  for (const url of ['https://synthetic.invalid/', 'file:///tmp/private', `${child.webContents.mainFrame.url}?key=private`, 'data:text/html,secret']) { let denied = false; child.webContents.session.request?.({ url }, value => { denied = value.cancel; }); assert.equal(denied, true); }
  const html = await readFile(new URL(child.webContents.mainFrame.url), 'utf8'); assert.match(html, /connect-src 'none'/); assert.match(html, /form-action 'none'/);
  ctx.time(300000); context.mock.timers.tick(1000); assert.deepEqual(await pending, { status: 'cancelled' });
  assert.equal(child.destroyed, true); assert.equal(child.webContents.session.clears, 2); assert.equal(writes(ctx.bridge).length, 0); ctx.dispose();
});


test('closing during expiry cleanup waits for the same cancellation rather than releasing its session early', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const ctx = setup(), { pending, child } = await ctx.begin(); await ctx.invoke('submit', child, {});
  const delayed = deferred(), original = ctx.bridge.handler;
  ctx.bridge.handler = async (method, params) => method === 'bootstrap' ? delayed.promise : original(method, params);
  ctx.time(600000); context.mock.timers.tick(1000); await tick();
  ctx.invoke('close', child); assert.deepEqual(await pending, { status: 'unknownOutcome' }); assert.equal(ctx.flow.isActive(), true);
  delayed.resolve(source()); await tick();
  assert.equal(writes(ctx.bridge).filter(call => call.method === 'pair.cancel').length, 1); assert.equal(ctx.flow.isActive(), false); ctx.dispose();
});


test('closing during initial bootstrap never creates a late orphan window', async () => {
  const ctx = setup(), delayed = deferred(); ctx.bridge.handler = async () => delayed.promise;
  const pending = ctx.flow.open('invite'); ctx.flow.close();
  delayed.resolve(source()); assert.deepEqual(await pending, { status: 'cancelled' });
  assert.equal(FakeWindow.instances.length, 1); assert.equal(ctx.flow.isActive(), false); assert.equal(writes(ctx.bridge).length, 0); ctx.dispose();
});

test('status failures erase the code and only close attempts one own-nonce cleanup without restarting', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  for (const throws of [false, true]) {
    const ctx = setup(), { pending, child } = await ctx.begin(); await ctx.invoke('submit', child, {});
    const original = ctx.bridge.handler;
    ctx.bridge.handler = async (method, params) => { if (method === 'pair.status') { if (throws) throw new Error(marker); return { state: 'failed', error: marker }; } return original(method, params); };
    ctx.time(1000); context.mock.timers.tick(1000); await tick();
    const state = ctx.invoke('init', child) as { pairingString: unknown };
    assert.equal(state.pairingString, null); assert.equal(JSON.stringify(state).includes(marker), false);
    await ctx.invoke('submit', child, {}); ctx.invoke('close', child); assert.deepEqual(await pending, { status: 'unknownOutcome' }); await tick();
    assert.deepEqual(writes(ctx.bridge).map(call => call.method), ['pair.start', 'pair.cancel']);
    assert.equal(ctx.flow.capabilities(source()).invite, false); await assert.rejects(ctx.flow.open('invite')); ctx.dispose();
  }
});


test('unknown outcomes lock only that daemon pairing mode without blocking ordinary settings or clearing on reconnect', async () => {
  const ctx = setup(), original = ctx.bridge.handler;
  ctx.bridge.handler = async (method, params) => { if (method === 'pair.start') throw new Error(marker); return original(method, params); };
  const { pending, child } = await ctx.begin(); await ctx.invoke('submit', child, {}); ctx.invoke('close', child); await pending;
  assert.equal(ctx.flow.isActive(), false); assert.equal(ctx.flow.capabilities(source()).invite, false);
  await assert.rejects(ctx.flow.open('invite'), /官方客户端核对设备/);
  ctx.bridge.status.generation++; assert.equal(ctx.flow.capabilities(source()).invite, false); await assert.rejects(ctx.flow.open('invite'));
  assert.equal(writes(ctx.bridge).length, 1);
  ctx.bridge.status.endpoint = 'ws://127.0.0.1:4863/ws'; assert.equal(ctx.flow.capabilities(source()).invite, true); ctx.dispose();
});
