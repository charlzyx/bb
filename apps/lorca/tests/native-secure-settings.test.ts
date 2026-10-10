import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { createSecureSettingsEditor } = require('../native/secure-settings.cjs');

class FakeSession extends EventEmitter {
  clears = 0;
  request: ((details: { url: string }, callback: (value: { cancel: boolean }) => void) => void) | null = null;
  webRequest = { onBeforeRequest: (handler: typeof this.request) => { this.request = handler; } };
  setPermissionRequestHandler() {}
  setPermissionCheckHandler() {}
  async clearStorageData() { this.clears++; }
  async clearCache() { this.clears++; }
}
class FakeContents extends EventEmitter {
  mainFrame = { url: '' };
  session = new FakeSession();
  setWindowOpenHandler() {}
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
function setup() {
  FakeWindow.instances = [];
  const bridge = new EventEmitter(); const parent = new FakeWindow();
  const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
  const ipcMain = { handle: (name: string, handler: (event: unknown, value?: unknown) => unknown) => handlers.set(name, handler) };
  const manager = createSecureSettingsEditor({ BrowserWindow: FakeWindow, ipcMain, bridge, getParent: () => parent, getIcon: () => undefined });
  const invoke = (name: string, window: FakeWindow, value?: unknown) => handlers.get(`lorca:secure-settings-${name}`)?.({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, value);
  return { manager, bridge, parent, handlers, invoke, child: () => FakeWindow.instances.at(-1)! };
}
const spec = { title: 'Secret entry', description: 'Synthetic only', fields: [{ key: 'apiKey', type: 'password', label: 'API 密钥', value: '' }] };

test('secure editor binds each input session to its exact window/frame and fixed local resource allowlist', async () => {
  const ctx = setup();
  const pending = ctx.manager.edit(spec, () => {}, (value: unknown) => value);
  const child = ctx.child();
  assert.throws(() => ctx.invoke('init', ctx.parent));
  assert.equal(child.destroyed, false);
  assert.deepEqual(ctx.invoke('init', child), spec);
  const preferences = child.options.webPreferences as Record<string, unknown>;
  assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
  assert.match(String(preferences.partition), /^dots-settings-/); assert.equal(String(preferences.partition).startsWith('persist:'), false);
  const session = child.webContents.session;
  let cancelled = false;
  session.request?.({ url: child.webContents.mainFrame.url }, value => { cancelled = value.cancel; }); assert.equal(cancelled, false);
  for (const url of ['https://example.com', 'file:///tmp/private-token', `${child.webContents.mainFrame.url}?token=private`, 'data:text/html,secret']) { session.request?.({ url }, value => { cancelled = value.cancel; }); assert.equal(cancelled, true); }
  assert.throws(() => ctx.handlers.get('lorca:secure-settings-submit')?.({ sender: child.webContents, senderFrame: { url: child.webContents.mainFrame.url } }, {}));
  assert.equal(child.destroyed, false);
  assert.deepEqual(ctx.invoke('submit', child, { apiKey: 'synthetic-input' }), { ok: true });
  assert.deepEqual(await pending, { apiKey: 'synthetic-input' });
  assert.equal(child.destroyed, true); assert.equal(session.clears, 2);
  assert.throws(() => ctx.invoke('submit', child, { apiKey: 'replay' }));
  assert.equal(ctx.bridge.listenerCount('event'), 0); assert.equal(ctx.bridge.listenerCount('status'), 0);
});

test('expired trusted input closes the secure window while a forged frame cannot invalidate it', async () => {
  const ctx = setup(); let expired = false;
  const pending = ctx.manager.edit(spec, () => { if (expired) throw new Error('Expired synthetic fence'); }, (value: unknown) => value);
  const child = ctx.child(); expired = true;
  assert.throws(() => ctx.invoke('cancel', ctx.parent)); assert.equal(child.destroyed, false);
  const rejection = assert.rejects(pending, /账号或连接已变化/);
  assert.throws(() => ctx.invoke('submit', child, { apiKey: 'must-not-send' }), /账号或连接已变化/);
  await rejection; assert.equal(child.destroyed, true); assert.equal(child.webContents.session.clears, 2);
});

test('secure editor validates without exposing error text and closes on account change or explicit cancellation', async () => {
  const ctx = setup(); let current = true;
  const pending = ctx.manager.edit(spec, () => { if (!current) throw new Error('Account changed'); }, () => { throw new Error('PRIVATE_VALIDATION_SENTINEL'); });
  const child = ctx.child();
  const failure = ctx.invoke('submit', child, {}) as { ok: boolean; error: string };
  assert.equal(failure.ok, false); assert.equal(failure.error.includes('PRIVATE_VALIDATION_SENTINEL'), false); assert.equal(child.destroyed, false);
  current = false;
  const rejection = assert.rejects(pending, /账号或连接已变化/);
  ctx.bridge.emit('event', { event: 'identity.changed' }); await rejection; assert.equal(child.destroyed, true);
  const cancelled = ctx.manager.edit(spec, () => {}, (value: unknown) => value);
  const replacement = ctx.child(); ctx.invoke('cancel', replacement);
  assert.equal(await cancelled, null); assert.equal(replacement.destroyed, true);
});

test('an idle expired secure editor closes and clears input storage without any renderer or bridge activity', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const ctx = setup(); let expired = false;
  const pending = ctx.manager.edit(spec, () => { if (expired) throw new Error('Expired synthetic ticket'); }, (value: unknown) => value);
  const child = ctx.child();
  context.mock.timers.tick(1000); assert.equal(child.destroyed, false);
  expired = true; const rejection = assert.rejects(pending, /账号或连接已变化/);
  context.mock.timers.tick(1000); await rejection;
  assert.equal(child.destroyed, true); assert.equal(child.webContents.session.clears, 2);
  context.mock.timers.tick(5000); assert.equal(child.webContents.session.clears, 2);
});
