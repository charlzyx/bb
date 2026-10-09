import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { inflateSync } from 'node:zlib';
const require = createRequire(import.meta.url);
const { applicationMenuTemplate } = require('../native/menu.cjs');
const { helpText } = require('../native/cli.cjs');
const { RPC_METHODS } = require('../native/bridge.cjs');
const { APP_NAME, ICON_PATH, configureApplicationName, configureApplicationBranding } = require('../native/branding.cjs');
const { renderIcon } = require('../scripts/render-icon.cjs');

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

test('dots icon is a reproducible nonempty PNG derived from the owned vector mark', async () => {
  const svg = await readFile(new URL('../public/dots.svg', import.meta.url), 'utf8');
  const actual = await readFile(ICON_PATH);
  assert.deepEqual(renderIcon(svg), actual);
  assert.deepEqual(actual.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const data: Buffer[] = [];
  let size = 0;
  for (let offset = 8; offset < actual.length;) {
    const length = actual.readUInt32BE(offset);
    const kind = actual.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IHDR') { size = actual.readUInt32BE(offset + 8); assert.equal(size, 256); assert.equal(actual.readUInt32BE(offset + 12), size); }
    if (kind === 'IDAT') data.push(actual.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(data));
  assert.equal(rows.length, (size * 4 + 1) * size);
  const pixel = (x: number, y: number) => [...rows.subarray(y * (size * 4 + 1) + 1 + x * 4, y * (size * 4 + 1) + 5 + x * 4)];
  for (const [x, y] of [[80, 80], [176, 80], [80, 176], [176, 176]]) assert.deepEqual(pixel(x, y), [36, 36, 34, 255]);
  assert.deepEqual(pixel(128, 128), [243, 243, 239, 255]);
  assert.equal(pixel(0, 0)[3], 0);
  assert.throws(() => renderIcon('<svg/>'));
});

test('dots About retains BB MIT attribution and only macOS receives the nonempty Dock icon', () => {
  assert.equal(APP_NAME, 'dots');
  for (const platform of ['darwin', 'linux', 'win32']) for (const empty of [false, true]) {
    let about: { applicationName: string; copyright: string; iconPath: string } | undefined;
    let dockIcon: unknown;
    const icon = { isEmpty: () => empty };
    const app = { setAboutPanelOptions: (value: typeof about) => { about = value; }, dock: { setIcon: (value: unknown) => { dockIcon = value; } } };
    const nativeImage = { createFromPath: (value: string) => { assert.equal(value, ICON_PATH); return icon; } };
    assert.equal(configureApplicationBranding(app, nativeImage, platform), icon);
    assert.ok(about); assert.equal(about.applicationName, 'dots'); assert.equal(about.iconPath, ICON_PATH);
    assert.match(about.copyright, /BB.*MIT.*2026 Michael Yong/);
    assert.equal(dockIcon, platform === 'darwin' && !empty ? icon : undefined);
  }
});

test('preload removes Electron error framing while preserving the localized guidance and source data', async () => {
  const source = await readFile(new URL('../native/preload.cjs', import.meta.url), 'utf8');
  let api: { getSettings: () => Promise<unknown> } | undefined;
  let failure: unknown = new Error("Error invoking remote method 'lorca:get-settings': Error: 无法读取 Lorca 设置，请重新连接后重试");
  runInNewContext(source, { require: (name: string) => {
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
