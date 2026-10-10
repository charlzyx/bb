import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
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
  for (const key of ['frame', 'titleBarStyle', 'trafficLightPosition', 'transparent']) assert.equal(child.options[key], undefined, key);
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

test('secure editor permits only its fixed Ghost image without directory, query, or network access', async () => {
  const ctx = setup();
  const pending = ctx.manager.edit(spec, () => {}, (value: unknown) => value);
  const child = ctx.child();
  try {
    const pageURL = child.webContents.mainFrame.url;
    const html = await readFile(new URL(pageURL), 'utf8');
    assert.match(html, /<img class="brand-icon" src="\.\.\/public\/app-icon\/64\.png" alt="" width="32" height="32">/);
    const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
    assert.equal(policy, "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self' data:; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'");
    const iconURL = new URL('../public/app-icon/64.png', pageURL).href;
    const icon = await readFile(new URL(iconURL));
    assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(icon.readUInt32BE(16), 64); assert.equal(icon.readUInt32BE(20), 64);
    const allowed = [pageURL, new URL('secure-editor.js', pageURL).href, new URL('secure-editor.css', pageURL).href, iconURL];
    const denied = [
      new URL('../public/app-icon/32.png', pageURL).href,
      new URL('../public/dots.png', pageURL).href,
      new URL('../public/app-icon/', pageURL).href,
      new URL('../artwork/ghost-original.png', pageURL).href,
      `${iconURL}?token=synthetic`, `${iconURL}#synthetic`, `${iconURL}/private`,
      'file:///tmp/private-token', 'https://synthetic.example.invalid/64.png', 'data:image/png;base64,AA==',
    ];
    for (const url of [...allowed, ...denied]) {
      let cancelled: boolean | undefined;
      child.webContents.session.request?.({ url }, value => { cancelled = value.cancel; });
      assert.equal(cancelled, !allowed.includes(url), url);
    }
    assert.deepEqual(ctx.invoke('init', child), spec);
    assert.deepEqual([...ctx.handlers.keys()].sort(), ['lorca:secure-settings-cancel', 'lorca:secure-settings-init', 'lorca:secure-settings-submit']);
  } finally {
    ctx.invoke('cancel', child);
    assert.equal(await pending, null);
  }
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

test('an avatar preview resource is exact, session-bound and revoked when the isolated window closes', async () => {
  const ctx = setup();
  const bytes = await readFile(new URL('../public/app-icon/64.png', import.meta.url));
  const preview = { dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, width: 64, height: 64, alt: 'Synthetic preview' };
  const pending = ctx.manager.edit({ ...spec, preview }, () => {}, (value: unknown) => value);
  const child = ctx.child();
  const permits = (url: string) => { let permitted = false; child.webContents.session.request?.({ url }, value => { permitted = !value.cancel; }); return permitted; };
  assert.equal(permits(preview.dataUrl), true);
  for (const url of ['data:image/svg+xml,<svg/>', 'data:image/png;base64,AA==', `${preview.dataUrl}#fragment`, 'https://example.invalid/avatar.png']) assert.equal(permits(url), false);
  assert.throws(() => ctx.invoke('init', ctx.parent));
  ctx.invoke('cancel', child); assert.equal(await pending, null);
  assert.equal(permits(preview.dataUrl), false, 'The settled session cannot reload its old preview');
  const next = ctx.manager.edit(spec, () => {}, (value: unknown) => value);
  const replacement = ctx.child(); let cancelled = false;
  replacement.webContents.session.request?.({ url: preview.dataUrl }, value => { cancelled = value.cancel; }); assert.equal(cancelled, true);
  ctx.invoke('cancel', replacement); await next;
});

test('malformed or mismatched preview metadata cannot create an isolated window', async () => {
  for (const preview of [null, { dataUrl: 'https://example.invalid/photo.png', width: 64, height: 64, alt: '' }, { dataUrl: 'data:image/png;base64,AA==', width: 64, height: 64, alt: '' }]) {
    const ctx = setup();
    await assert.rejects(ctx.manager.edit({ ...spec, preview }, () => {}, () => true));
    assert.equal(FakeWindow.instances.length, 1);
    assert.equal(ctx.bridge.listenerCount('event'), 0);
  }
});
