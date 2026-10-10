import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { iconSizes, iconPath, decodeIcon, checkOpticalBounds } from './icon-assets';
const require = createRequire(import.meta.url);
const { icnsFromPng, icnsFromPngs, applicationIcon, bundleMetadata, assemble } = require('../scripts/package-macos.cjs');
const png = readFileSync(new URL('../public/dots.png', import.meta.url));
const source = fileURLToPath(new URL('..', import.meta.url));
const icons = new Map(iconSizes.map(size => [size, readFileSync(path.join(source, iconPath(size)))]));
const notices = ['NOTICE.md', 'LICENSE.figma-squircle', 'icon-manifest.json'];

test('macOS icon contains the selected 256px PNG in an ICNS ic08 chunk', () => {
  const icon = icnsFromPng(png);
  assert.equal(icon.toString('ascii', 0, 4), 'icns');
  assert.equal(icon.readUInt32BE(4), icon.length);
  assert.equal(icon.toString('ascii', 8, 12), 'ic08');
  assert.deepEqual(icon.subarray(16), png);
  assert.throws(() => icnsFromPng(Buffer.from('invalid')));
  assert.throws(() => bundleMetadata('41.10.7-beta'));
  assert.equal(bundleMetadata('0.1.0').CFBundleName, 'dots');
});

test('local packaging copies only runtime inputs and modifies only its new bundle', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dots-package-'));
  try {
    const sourceApp = path.join(root, 'apps/lorca');
    const electronApp = path.join(root, 'Electron.app');
    const wsDirectory = path.join(root, 'ws');
    const output = path.join(root, 'output/dots.app');
    const write = (name: string, value: string | Buffer) => { mkdirSync(path.dirname(name), { recursive: true }); writeFileSync(name, value); };
    write(path.join(root, 'LICENSE'), 'MIT attribution');
    write(path.join(sourceApp, 'package.json'), JSON.stringify({ version: '0.1.0' }));
    write(path.join(sourceApp, 'dist/index.html'), '<title>dots</title>');
    write(path.join(sourceApp, 'native/main.cjs'), '');
    for (const size of iconSizes) write(path.join(sourceApp, iconPath(size)), icons.get(size)!);
    for (const file of notices) write(path.join(sourceApp, 'artwork', file), readFileSync(path.join(source, 'artwork', file)));
    write(path.join(sourceApp, 'artwork/ghost-original.png'), 'large source artwork must not ship');
    write(path.join(sourceApp, 'icon-tools/package.json'), 'optional build-only tools must not ship');
    write(path.join(sourceApp, '.env'), 'must-not-copy');
    write(path.join(electronApp, 'Contents/MacOS/Electron'), 'original-runtime');
    write(path.join(electronApp, 'Contents/Info.plist'), 'original-plist');
    write(path.join(electronApp, 'Contents/Resources/default_app.asar'), 'default');
    write(path.join(wsDirectory, 'package.json'), JSON.stringify({ name: 'ws' }));
    const calls: { command: string; args: string[] }[] = [];
    rmSync(path.join(sourceApp, iconPath(1024)));
    assert.throws(() => assemble({ sourceApp, electronApp, wsDirectory, output, run: () => assert.fail('Invalid icon inputs must not run platform tools') }), /缺少图标输入/);
    assert.equal(existsSync(output), false);
    write(path.join(sourceApp, iconPath(1024)), icons.get(1024)!);
    assemble({ sourceApp, electronApp, wsDirectory, output, run: (command: string, args: string[]) => calls.push({ command, args }) });
    assert.equal(readFileSync(path.join(electronApp, 'Contents/MacOS/Electron'), 'utf8'), 'original-runtime');
    assert.equal(readFileSync(path.join(electronApp, 'Contents/Info.plist'), 'utf8'), 'original-plist');
    assert.ok(existsSync(path.join(output, 'Contents/MacOS/dots')));
    assert.ok(existsSync(path.join(output, 'Contents/Resources/app/node_modules/ws/package.json')));
    assert.ok(!existsSync(path.join(output, 'Contents/Resources/app/.env')));
    assert.ok(!existsSync(path.join(output, 'Contents/Resources/app/artwork/ghost-original.png')));
    assert.ok(!existsSync(path.join(output, 'Contents/Resources/app/icon-tools')));
    for (const file of notices) assert.deepEqual(readFileSync(path.join(output, 'Contents/Resources/app/artwork', file)), readFileSync(path.join(source, 'artwork', file)));
    assert.deepEqual(readFileSync(path.join(output, 'Contents/Resources/dots.icns')), applicationIcon(sourceApp));
    assert.ok(!existsSync(path.join(output, 'Contents/Resources/default_app.asar')));
    assert.equal(JSON.parse(readFileSync(path.join(output, 'Contents/Resources/app/package.json'), 'utf8')).version, '0.1.0');
    assert.ok(calls.every(call => call.args.at(-1)?.startsWith(output)));
    assert.deepEqual(calls.at(-2)?.args, ['--force', '--deep', '--sign', '-', output]);
    assert.deepEqual(calls.at(-1)?.args, ['--verify', '--deep', '--strict', output]);
    assert.throws(() => assemble({ sourceApp, electronApp, wsDirectory, output, run: () => {} }), /已存在/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('macOS icon carries the exact seven generated Ghost PNGs with matching optical bounds', () => {
  const icon = applicationIcon(source);
  assert.equal(icon.readUInt32BE(4), icon.length);
  const expected = new Map([['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]);
  for (let offset = 8; offset < icon.length;) {
    const kind = icon.toString('ascii', offset, offset + 4);
    const length = icon.readUInt32BE(offset + 4);
    const size = expected.get(kind);
    assert.ok(size); assert(length > 8 && offset + length <= icon.length);
    expected.delete(kind);
    const bytes = icon.subarray(offset + 8, offset + length);
    const expectedPng = icons.get(size); assert.ok(expectedPng);
    assert.deepEqual(bytes, expectedPng);
    const decoded = decodeIcon(bytes);
    assert.equal(decoded.width, size); assert.equal(decoded.height, size);
    checkOpticalBounds(size, decoded.pixels);
    offset += length;
  }
  assert.equal(expected.size, 0);
  assert.throws(() => icnsFromPngs([png, png]), /重复/);
  assert.throws(() => icnsFromPngs([]));
});

test('packaging rejects missing or mislabeled generated icon sizes before making an output bundle', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dots-icon-inputs-'));
  try {
    for (const size of iconSizes) {
      const target = path.join(root, iconPath(size)); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, icons.get(size)!);
    }
    for (const size of iconSizes) {
      const target = path.join(root, iconPath(size)); rmSync(target);
      assert.throws(() => applicationIcon(root), /缺少图标输入/);
      writeFileSync(target, icons.get(size === 256 ? 128 : 256)!);
      assert.throws(() => applicationIcon(root), /图标尺寸不匹配/);
      writeFileSync(target, icons.get(size)!);
    }
    assert.deepEqual(applicationIcon(root), applicationIcon(source));
    assert.equal(existsSync(path.join(root, 'public/dots.svg')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
