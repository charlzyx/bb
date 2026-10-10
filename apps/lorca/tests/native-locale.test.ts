import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { iconSizes, iconPath, decodeIcon, checkOpticalBounds, sha256 } from './icon-assets';
const require = createRequire(import.meta.url);
const { applicationMenuTemplate } = require('../native/menu.cjs');
const { helpText } = require('../native/cli.cjs');
const { RPC_METHODS } = require('../native/bridge.cjs');
const { APP_NAME, APP_VERSION, ICON_PATH, configureApplicationName, configureApplicationBranding } = require('../native/branding.cjs');

test('Chinese native menus preserve standard editing roles without debug or external actions', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const template = applicationMenuTemplate(platform);
    assert.deepEqual(template.map((item: { label: string }) => item.label), ['应用', '编辑', '窗口']);
    const items = template.flatMap((item: { submenu: { label?: string; role?: string; type?: string; click?: unknown; accelerator?: string }[] }) => item.submenu);
    const roles = items.map((item: { role?: string }) => item.role);
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'selectAll', 'close', 'quit']) assert.ok(roles.includes(role), role);
    assert.equal(roles.includes('toggleDevTools'), false);
    assert.equal(roles.includes('reload'), false);
    assert.equal(roles.includes('hide'), platform === 'darwin');
    assert.equal(items.find((item: { role?: string }) => item.role === 'about').label, '关于 dots');
    assert.equal(items.find((item: { role?: string }) => item.role === 'quit').label, '退出 dots');
    for (const item of items) {
      assert.equal(item.click, undefined);
      assert.equal(item.accelerator, undefined);
      if (item.type !== 'separator') assert.match(item.label, /[\u4e00-\u9fff]/);
    }
  }
});

test('Chinese CLI guidance preserves command, protocol and environment variable names', () => {
  const help = helpText();
  assert.ok(help.startsWith('dots 本地命令行（Lorca 协议）'));
  assert.match(help, /用法：/); assert.match(help, /只读配置概览/); assert.match(help, /不会自动重发/);
  assert.match(help, /本地令牌认证/); assert.match(help, /本地兼容连接（不校验令牌）/);
  assert.doesNotMatch(help, /旧版|新版|新协议|旧协议/);
  for (const command of RPC_METHODS) assert.ok(help.includes(command), command);
  for (const key of ['settings', 'runnerId', 'bootstrap', 'mcp.list', 'LORCA_ENDPOINT', 'LORCA_PORT', 'LORCA_HOME', 'LORCA_ALLOW_LEGACY=1', 'serve-token']) assert.ok(help.includes(key), key);
});

test('dots app naming keeps existing launch-specific data, session and log directories', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dots-brand-test-'));
  try {
    let name = '@bb/lorca';
    const paths = new Map<string, string>();
    const original = Object.fromEntries(['userData', 'sessionData', 'logs'].map(key => [key, path.join(temporary, name, key)]));
    const app = {
      getPath: (key: string) => paths.get(key) ?? path.join(temporary, name, key),
      setPath: (key: string, value: string) => { paths.set(key, value); },
      setName: (value: string) => { name = value; },
    };
    configureApplicationName(app);
    assert.equal(name, 'dots');
    for (const [key, value] of Object.entries(original)) { assert.equal(app.getPath(key), value); assert.ok((await stat(value)).isDirectory()); }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('native icon assets match the selected Ghost original, mask provenance and decoded pixel manifest', async () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('artwork/icon-manifest.json', root), 'utf8'));
  assert.equal(manifest.artwork, 'Ghost — ipaslogo.com');
  assert.equal(manifest.original, 'artwork/ghost-original.png');
  assert.equal(manifest.mask, 'artwork/macos-style-mask.svg');
  const original = await readFile(new URL(manifest.original, root));
  assert.equal(sha256(original), '4ab06f6c35f5ab49f1c0c6b406f225b3ded473dd1f1b1679e90a719a0a27cac3');
  assert.equal(sha256(original), manifest.originalSha256);
  assert.equal(original.readUInt32BE(16), 1024); assert.equal(original.readUInt32BE(20), 1024);
  const mask = await readFile(new URL(manifest.mask, root));
  assert.equal(sha256(mask), manifest.maskSha256);
  assert.match(mask.toString(), /viewBox="0 0 1024 1024"/); assert.match(mask.toString(), /translate\(100 100\)/);
  assert.deepEqual(manifest.maskGenerator, { name: 'figma-squircle', version: '1.1.0', width: 824, height: 824, cornerRadius: 184, cornerSmoothing: 0.6, preserveSmoothing: true, inset: 100, canvas: 1024 });
  const tools = JSON.parse(await readFile(new URL('icon-tools/package.json', root), 'utf8'));
  assert.equal(manifest.renderer.sharp, '0.35.4'); assert.equal(tools.dependencies.sharp, manifest.renderer.sharp);
  for (const name of ['vips', 'rsvg']) assert.match(manifest.renderer[name], /^\d+(?:\.\d+){1,3}$/);
  assert.deepEqual(manifest.images.map((item: { size: number }) => item.size), iconSizes);
  for (const item of manifest.images) {
    assert.equal(item.path, iconPath(item.size));
    const bytes = await readFile(new URL(item.path, root)); const decoded = decodeIcon(bytes);
    assert.equal(decoded.width, item.size); assert.equal(decoded.height, item.size);
    assert.equal(sha256(bytes), item.sha256); assert.equal(sha256(decoded.pixels), item.pixelSha256);
  }
  const actual = await readFile(ICON_PATH); const decoded = decodeIcon(actual);
  assert.equal(decoded.width, 256); checkOpticalBounds(256, decoded.pixels);
  const colors = new Set<number>();
  for (let pixel = 0; pixel < decoded.pixels.length; pixel += 4) if (decoded.pixels[pixel + 3] > 127) colors.add(decoded.pixels.readUIntBE(pixel, 3));
  assert(colors.size > 1000, 'The selected ceramic artwork must retain its tonal detail');
  const license = await readFile(new URL('artwork/LICENSE.figma-squircle', root), 'utf8');
  assert.match(license, /MIT License/); assert.match(license, /Copyright \(c\) 2021 Tien Pham/);
  assert.match(license, /Permission is hereby granted, free of charge/); assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
  const notice = await readFile(new URL('artwork/NOTICE.md', root), 'utf8');
  assert.match(notice, /https:\/\/cdn\.ipaslogo\.com\/logos\/4ab06f6c35f5ab49-ghost-7\.png/);
  assert.match(notice, /commercial use/); assert.match(notice, /not claimed to be MIT-licensed/);
  assert.match(notice, /figma-squircle 1\.1\.0/); assert.match(notice, /LICENSE\.figma-squircle/);
  assert.match(notice, /not an Apple template/);
});

test('dots About uses the product version, retains attribution and follows platform icon support', () => {
  assert.equal(APP_NAME, 'dots');
  assert.equal(APP_VERSION, require('../package.json').version);
  for (const platform of ['darwin', 'linux', 'win32']) for (const empty of [false, true]) {
    let about: { applicationName: string; applicationVersion: string; version?: string; copyright: string; iconPath?: string } | undefined;
    let dockIcon: unknown;
    const icon = { isEmpty: () => empty };
    const app = { getVersion: () => '41.10.7', setAboutPanelOptions: (value: typeof about) => { about = value; }, dock: { setIcon: (value: unknown) => { dockIcon = value; } } };
    const nativeImage = { createFromPath: (value: string) => { assert.equal(value, ICON_PATH); return icon; } };
    assert.equal(configureApplicationBranding(app, nativeImage, platform), icon);
    assert.ok(about); assert.equal(about.applicationName, 'dots');
    assert.equal(about.applicationVersion, APP_VERSION); assert.notEqual(about.applicationVersion, app.getVersion());
    assert.equal(about.version, platform === 'darwin' ? APP_VERSION : undefined);
    assert.equal(about.iconPath, platform === 'darwin' ? undefined : ICON_PATH);
    assert.match(about.copyright, /BB.*MIT.*2026 Michael Yong/);
    assert.match(about.copyright, /App icon: Ghost \/ ipaslogo\.com/);
    assert.equal(dockIcon, platform === 'darwin' && !empty ? icon : undefined);
  }
});

test('preload sets only the native layout marker after DOM readiness without adding window-control capabilities', async () => {
  const source = await readFile(new URL('../native/preload.cjs', import.meta.url), 'utf8');
  for (const platform of ['darwin', 'linux', 'win32']) {
    const dataset: Record<string, string> = {};
    let ready: (() => void) | undefined;
    let api: Record<string, unknown> | undefined;
    runInNewContext(source, {
      process: { platform }, document: { documentElement: { dataset } },
      window: { addEventListener: (event: string, callback: () => void, options: { once: boolean }) => { assert.equal(event, 'DOMContentLoaded'); assert.equal(options.once, true); ready = callback; } },
      require: (name: string) => {
        assert.equal(name, 'electron');
        return { contextBridge: { exposeInMainWorld: (name: string, value: typeof api) => { assert.equal(name, 'lorca'); api = value; } }, ipcRenderer: {} };
      },
    });
    assert.deepEqual(dataset, {}); assert.ok(ready); ready();
    assert.deepEqual(dataset, { lorcaPlatform: platform }); assert.ok(api); assert.equal(Object.isFrozen(api), true);
    assert.deepEqual(Object.keys(api).sort(), ['connect', 'copyText', 'getBotAvatar', 'getSettings', 'getStatus', 'onEvent', 'onStatus', 'openPairing', 'pickAttachments', 'releaseAttachments', 'request', 'sendAttachments', 'setWatchingChat', 'settingsAction']);
  }
});

test('preload removes Electron error framing while preserving the localized guidance and source data', async () => {
  const source = await readFile(new URL('../native/preload.cjs', import.meta.url), 'utf8');
  let api: { getSettings: () => Promise<unknown> } | undefined;
  let failure: unknown = new Error("Error invoking remote method 'lorca:get-settings': Error: 无法读取 Lorca 设置，请重新连接后重试");
  runInNewContext(source, { window: { addEventListener() {} }, require: (name: string) => {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld: (name: string, value: typeof api) => { assert.equal(name, 'lorca'); api = value; } }, ipcRenderer: { invoke: async () => { throw failure; } } };
  } });
  assert.ok(api);
  await assert.rejects(api.getSettings(), error => typeof error === 'object' && error !== null && 'message' in error && error.message === '无法读取 Lorca 设置，请重新连接后重试');
  failure = new Error('Source-provided fixture text');
  await assert.rejects(api.getSettings(), error => typeof error === 'object' && error !== null && 'message' in error && error.message === 'Source-provided fixture text');
  failure = null;
  await assert.rejects(api.getSettings(), error => typeof error === 'object' && error !== null && 'message' in error && error.message === '本地请求失败，请重试');
});
