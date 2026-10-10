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
const codeFor = (url: string) => code.replace(encodeURIComponent('https://synthetic.invalid/relay'), encodeURIComponent(url));
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

test('pairing parser binds canonical keys, exact fields and allowed transport without accepting ambiguous URLs', () => {
  assert.match(identityId, /^[0-9a-f]{16}$/); assert.equal(parsePairingString(code).nonce, nonce);
  for (const value of [null, '', `prefix${code}`, `${code}&id=extra`, `${code}&secret=${marker}`, `${code}#fragment`, code.replace('https%3A', 'http%3A'), code.replace('synthetic.invalid', 'user%40synthetic.invalid'), code.replace('synthetic.invalid', 'synthetic.invalid%3Fkey%3Dsecret'), code.replace(nonce, 'bad'), code.replace('&ek=', '&ek=%00'), `${code}${'x'.repeat(8192)}`]) assert.throws(() => parsePairingString(value));
  for (const method of ['pair.start', 'pair.accept', 'pair.status', 'pair.cancel', 'pair.abort']) assert.throws(() => validateRequest(method, {}));
});

test('capabilities permit explicit legacy loopback transport without claiming method support or relay connectivity', () => {
  const ctx = setup();
  assert.deepEqual(ctx.flow.capabilities(source()), { invite: true, join: false, inviteReasons: [], joinReasons: ['already_has_identity'] });
  assert.deepEqual(ctx.flow.capabilities(source(false)), { invite: false, join: true, inviteReasons: ['identity_required', 'relay_missing'], joinReasons: [] });
  ctx.bridge.status.authMode = 'legacy'; assert.deepEqual(ctx.flow.capabilities(source()), { invite: true, join: false, inviteReasons: [], joinReasons: ['already_has_identity'] });
  ctx.bridge.status.authMode = 'token'; ctx.bridge.status.status = 'disconnected'; assert.deepEqual(ctx.flow.capabilities(source(false)), { invite: false, join: false, inviteReasons: ['not_connected', 'identity_required', 'relay_missing'], joinReasons: ['not_connected'] });
  assert.deepEqual(ctx.flow.capabilities({ has_identity: 'yes' }), { invite: false, join: false, inviteReasons: ['not_connected', 'identity_fields_missing'], joinReasons: ['not_connected', 'identity_fields_missing'] }); ctx.dispose();
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


test('capabilities reject nonlocal bridge transport and public HTTP relay without exposing either address', async () => {
  const ctx = setup(); ctx.bridge.status.authMode = 'legacy'; ctx.bridge.status.endpoint = 'ws://192.168.1.50:4862/ws';
  ctx.bridge.bootstrap.relay_url = `http://synthetic.invalid/${marker}`;
  const capabilities = ctx.flow.capabilities(ctx.bridge.bootstrap);
  assert.deepEqual(capabilities.inviteReasons, ['local_transport_required', 'relay_transport_required']);
  assert.equal(capabilities.invite, false); assert.equal(capabilities.join, false);
  assert.equal(JSON.stringify(capabilities).includes(marker), false);
  const result = await ctx.flow.open('invite'); assert.deepEqual(result, { status: 'failed' });
  assert.equal(ctx.bridge.calls.length, 0); assert.equal(FakeWindow.instances.length, 1); ctx.dispose();
});

test('capabilities explain missing identity fields, relay and unknown-result lock without changing gates', async () => {
  const ctx = setup();
  assert.ok(ctx.flow.capabilities({ ...source(), identity_id: null }).inviteReasons.includes('identity_fields_missing'));
  assert.ok(ctx.flow.capabilities({ ...source(), this_device_id: null, relay_url: null }).inviteReasons.includes('relay_missing'));
  const original = ctx.bridge.handler; ctx.bridge.handler = async (method, params) => { if (method === 'pair.start') throw new Error(marker); return original(method, params); };
  const { pending, child } = await ctx.begin(); await ctx.invoke('submit', child, {}); ctx.invoke('close', child); await pending;
  assert.deepEqual(ctx.flow.capabilities(source()).inviteReasons, ['unknown_outcome']); ctx.dispose();
});

test('HTTP relay admission accepts literal loopback and private LAN ranges while preserving the actual code', () => {
  for (const url of ['http://127.0.0.1:4860', 'http://127.255.255.254/relay', 'http://10.0.0.1:3000/relay', 'http://172.16.0.1', 'http://172.31.255.254:8080', 'http://192.168.1.10/relay', 'http://[::1]:4860', 'http://[0:0:0:0:0:0:0:1]/relay', 'http://[fc00::1]:8080', 'http://[fd12:3456:789a::1]/relay', 'https://synthetic.invalid/relay']) {
    const input = codeFor(url), parsed = parsePairingString(input);
    assert.equal(parsed.code, input, 'Admission never rewrites the code or silently changes the relay');
    assert.equal(parsed.relay, new URL(url).href, url);
    assert.equal(parsed.origin, new URL(url).origin, url);
    assert.equal(parsed.identityId, identityId);
  }
});

test('HTTP relay admission rejects public and ambiguous hosts without DNS or network activity', () => {
  for (const url of ['http://8.8.8.8', 'http://172.15.255.255', 'http://172.32.0.1', 'http://192.169.0.1', 'http://100.64.0.1', 'http://169.254.1.1', 'http://169.254.169.254', 'http://0.0.0.0', 'http://[::]', 'http://[fe80::1]', 'http://[2001:db8::1]', 'http://[::ffff:127.0.0.1]', 'http://[::ffff:10.0.0.1]', 'http://localhost', 'http://LOCALHOST:3000', 'http://router.local', 'http://localhost.evil.invalid', 'http://localhost.', 'http://127.0.0.1.evil.invalid', 'http://synthetic.invalid', 'http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://0177.0.0.1', 'http://192.168.001.1', 'http://%31%32%37.0.0.1', 'http://user@127.0.0.1', 'http://127.0.0.1?token=secret', 'http://127.0.0.1#fragment', 'http://127.0.0.1\\@synthetic.invalid', 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'ftp://127.0.0.1', 'file:///tmp/synthetic', 'http://[fe80::1%25en0]']) assert.throws(() => parsePairingString(codeFor(url)), url);
});

test('token and explicit legacy capabilities permit private HTTP without probing or mutating a daemon', () => {
  const ctx = setup();
  for (const authMode of ['token', 'legacy']) {
    ctx.bridge.status.authMode = authMode;
    for (const endpoint of ['ws://127.0.0.1:4862/ws', 'ws://localhost:4862/ws']) {
      ctx.bridge.status.endpoint = endpoint;
      assert.equal(ctx.flow.capabilities({ ...source(), relay_url: 'http://192.168.1.20:3000' }).invite, true);
      assert.equal(ctx.flow.capabilities(source(false)).join, true);
    }
  }
  for (const authMode of ['none', '', 'automatic']) {
    ctx.bridge.status.authMode = authMode;
    assert.deepEqual(ctx.flow.capabilities(source()).inviteReasons, ['local_transport_required']);
  }
  assert.deepEqual(ctx.bridge.calls, []);
  ctx.dispose();
});

test('legacy HTTPS invitation requires native confirmation and explicitly discloses the missing local token', async () => {
  const ctx = setup(); ctx.bridge.status.authMode = 'legacy'; ctx.response(0);
  const { pending, child } = await ctx.begin();
  assert.notEqual(child, ctx.parent);
  await ctx.invoke('submit', child, {});
  assert.equal(writes(ctx.bridge).length, 0);
  assert.match(String(ctx.prompts[0].detail), /没有本机 serve-token 认证/);
  assert.match(String(ctx.prompts[0].detail), /本机其他进程/);
  assert.match(String(ctx.prompts[0].detail), /网页也可能操作服务/);
  assert.match(String(ctx.prompts[0].detail), /不能补回服务缺失的认证/);
  assert.match(String(ctx.prompts[0].detail), /DEK/);
  assert.doesNotMatch(String(ctx.prompts[0].detail), /此中继使用 HTTP，没有 TLS/);
  ctx.invoke('close', child); assert.deepEqual(await pending, { status: 'cancelled' }); ctx.dispose();
});

test('private HTTP invitation reveals transport risks but no key or nonce and sends only after confirmation', async () => {
  for (const authMode of ['token', 'legacy']) {
    const ctx = setup(); ctx.bridge.status.authMode = authMode; ctx.bridge.bootstrap.relay_url = 'http://192.168.1.20:3000/relay';
    const lanCode = codeFor(ctx.bridge.bootstrap.relay_url), original = ctx.bridge.handler;
    ctx.bridge.handler = async (method, params) => method === 'pair.start' ? { nonce, pairing_string: lanCode } : original(method, params);
    const { pending, child } = await ctx.begin();
    assert.deepEqual(writes(ctx.bridge), []);
    await ctx.invoke('submit', child, {});
    assert.equal((ctx.invoke('init', child) as { phase: string }).phase, 'waiting');
    assert.equal(writes(ctx.bridge).length, 1);
    const detail = String(ctx.prompts[0].detail);
    assert.match(detail, /没有 TLS 保护/); assert.match(detail, /中继访问令牌/); assert.match(detail, /窃听、篡改或冒用/); assert.match(detail, /代理或重定向/);
    assert.equal(detail.includes('没有本机 serve-token 认证'), authMode === 'legacy');
    assert.equal(detail.includes(lanCode), false); assert.equal(detail.includes(nonce), false);
    assert.equal(detail.includes(Buffer.alloc(32, 2).toString('base64url')), false);
    ctx.invoke('close', child); await pending; await tick();
    assert.deepEqual(writes(ctx.bridge).map(call => call.method), ['pair.start', 'pair.cancel']); ctx.dispose();
  }
});

test('legacy private HTTP joining preserves the isolated long-running operation and authoritative completion checks', async () => {
  const ctx = setup(false); ctx.bridge.status.authMode = 'legacy';
  const relayUrl = 'http://10.0.0.8:3000/relay', lanCode = codeFor(relayUrl), original = ctx.bridge.handler;
  ctx.bridge.handler = async (method, params) => {
    if (method !== 'pair.accept') return original(method, params);
    ctx.bridge.bootstrap = { ...source(), relay_url: relayUrl, this_device_id: 'joined-device' };
    ctx.bridge.emit('event', { event: 'identity.changed', data: { has_identity: true } });
    ctx.bridge.emit('event', { event: 'snapshot', data: ctx.bridge.bootstrap });
    return { id: 'joined-device', name: 'Synthetic PC', os: 'linux', identity_id: identityId };
  };
  const { pending, child } = await ctx.begin();
  await ctx.invoke('submit', child, { pairingString: lanCode, deviceName: 'Synthetic PC' });
  const request = writes(ctx.bridge)[0];
  assert.equal(request.method, 'pair.accept'); assert.equal(request.params.pairing_string, lanCode);
  assert.deepEqual(request.options, { timeoutMs: 610000 });
  const detail = String(ctx.prompts[0].detail);
  assert.match(detail, /持久保存/); assert.match(detail, /没有本机 serve-token 认证/); assert.match(detail, /没有 TLS 保护/); assert.match(detail, /不保证每次都在本机再次询问/);
  assert.equal(detail.includes(lanCode), false);
  ctx.invoke('close', child);
  assert.deepEqual(await pending, { status: 'completed', device: { id: 'joined-device', name: 'Synthetic PC', os: 'linux' } }); ctx.dispose();
});

test('public HTTP joining is rejected before confirmation or mutation with a transport-specific safe error', async () => {
  const ctx = setup(false); ctx.bridge.status.authMode = 'legacy';
  const { pending, child } = await ctx.begin();
  const response = await ctx.invoke('submit', child, { pairingString: codeFor(`http://synthetic.invalid/${marker}`) });
  assert.match((response as { error: string }).error, /HTTPS.*私有局域网/);
  assert.equal(JSON.stringify(response).includes(marker), false);
  assert.equal(ctx.prompts.length, 0); assert.equal(writes(ctx.bridge).length, 0);
  ctx.invoke('close', child); assert.deepEqual(await pending, { status: 'cancelled' }); ctx.dispose();
});

test('same-generation auth-mode and loopback-endpoint changes invalidate consent before invitation', async () => {
  for (const change of ['auth', 'endpoint']) {
    const ctx = setup(); ctx.bridge.status.authMode = 'legacy';
    ctx.dialog.showMessageBox = async () => {
      if (change === 'auth') ctx.bridge.status.authMode = 'token';
      else ctx.bridge.status.endpoint = 'ws://127.0.0.1:4863/ws';
      return { response: 1 };
    };
    const { pending, child } = await ctx.begin(); await ctx.invoke('submit', child, {});
    assert.equal(writes(ctx.bridge).length, 0, change);
    ctx.flow.close(); assert.deepEqual(await pending, { status: 'failed' }); ctx.dispose();
  }
});

test('late legacy invite results cannot cancel or display secrets in a changed endpoint or auth mode', async () => {
  for (const change of ['auth', 'endpoint']) {
    const ctx = setup(), late = deferred(), original = ctx.bridge.handler; ctx.bridge.status.authMode = 'legacy';
    ctx.bridge.handler = async (method, params) => method === 'pair.start' ? late.promise : original(method, params);
    const { pending, child } = await ctx.begin(); const submitting = ctx.invoke('submit', child, {}); await tick();
    if (change === 'auth') ctx.bridge.status.authMode = 'token';
    else ctx.bridge.status.endpoint = 'ws://127.0.0.1:4863/ws';
    ctx.bridge.emit('status', ctx.bridge.getStatus());
    assert.deepEqual(await pending, { status: 'unknownOutcome' });
    late.resolve({ nonce, pairing_string: code }); await submitting;
    assert.deepEqual(writes(ctx.bridge).map(call => call.method), ['pair.start']);
    assert.equal(JSON.stringify(child.webContents.updates).includes(code), false); ctx.dispose();
  }
});
