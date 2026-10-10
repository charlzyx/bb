import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
const require = createRequire(import.meta.url);
const { icnsFromPng, icnsFromPngs, applicationIcon, bundleMetadata, assemble } = require('../scripts/package-macos.cjs');
const png = readFileSync(new URL('../public/dots.png', import.meta.url));
const svg = readFileSync(new URL('../public/dots.svg', import.meta.url), 'utf8');

test('macOS icon contains the owned 256px PNG in an ICNS ic08 chunk', () => {
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
    write(path.join(sourceApp, 'public/dots.png'), png);
    write(path.join(sourceApp, 'public/dots.svg'), svg);
    write(path.join(sourceApp, '.env'), 'must-not-copy');
    write(path.join(electronApp, 'Contents/MacOS/Electron'), 'original-runtime');
    write(path.join(electronApp, 'Contents/Info.plist'), 'original-plist');
    write(path.join(electronApp, 'Contents/Resources/default_app.asar'), 'default');
    write(path.join(wsDirectory, 'package.json'), JSON.stringify({ name: 'ws' }));
    const calls: { command: string; args: string[] }[] = [];
    assemble({ sourceApp, electronApp, wsDirectory, output, run: (command: string, args: string[]) => calls.push({ command, args }) });
    assert.equal(readFileSync(path.join(electronApp, 'Contents/MacOS/Electron'), 'utf8'), 'original-runtime');
    assert.equal(readFileSync(path.join(electronApp, 'Contents/Info.plist'), 'utf8'), 'original-plist');
    assert.ok(existsSync(path.join(output, 'Contents/MacOS/dots')));
    assert.ok(existsSync(path.join(output, 'Contents/Resources/app/node_modules/ws/package.json')));
    assert.ok(!existsSync(path.join(output, 'Contents/Resources/app/.env')));
    assert.ok(!existsSync(path.join(output, 'Contents/Resources/default_app.asar')));
    assert.equal(JSON.parse(readFileSync(path.join(output, 'Contents/Resources/app/package.json'), 'utf8')).version, '0.1.0');
    assert.ok(calls.every(call => call.args.at(-1)?.startsWith(output)));
    assert.deepEqual(calls.at(-2)?.args, ['--force', '--deep', '--sign', '-', output]);
    assert.deepEqual(calls.at(-1)?.args, ['--verify', '--deep', '--strict', output]);
    assert.throws(() => assemble({ sourceApp, electronApp, wsDirectory, output, run: () => {} }), /已存在/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('macOS icon carries seven raster resolutions with matching optical bounds and four dots', () => {
  const icon = applicationIcon(svg);
  assert.equal(icon.readUInt32BE(4), icon.length);
  const expected = new Map([['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]);
  for (let offset = 8; offset < icon.length;) {
    const kind = icon.toString('ascii', offset, offset + 4);
    const length = icon.readUInt32BE(offset + 4);
    const size = expected.get(kind);
    assert.ok(size);
    expected.delete(kind);
    const bytes = icon.subarray(offset + 8, offset + length);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
    const compressed: Buffer[] = [];
    for (let p = 8; p < bytes.length;) {
      const count = bytes.readUInt32BE(p);
      if (bytes.toString('ascii', p + 4, p + 8) === 'IDAT') compressed.push(bytes.subarray(p + 8, p + 8 + count));
      p += count + 12;
    }
    const rows = inflateSync(Buffer.concat(compressed), { maxOutputLength: (size * 4 + 1) * size });
    const rgba = (x: number, y: number) => [...rows.subarray(y * (size * 4 + 1) + 1 + x * 4, y * (size * 4 + 1) + 5 + x * 4)];
    const visible = Array.from({ length: size }, (_, x) => x).filter(x => rgba(x, size / 2)[3]! > 0);
    assert.ok(Math.abs(visible[0]! - size * 100 / 1024) <= 1);
    assert.equal(visible.at(-1), size - 1 - visible[0]!);
    assert.equal(rgba(0, size / 2)[3], 0);
    assert.equal(rgba(size / 2, 0)[3], 0);
    for (const cx of [10, 22]) for (const cy of [10, 22]) {
      const x = Math.floor(size * (100 / 1024 + cx / 32 * 824 / 1024));
      const y = Math.floor(size * (100 / 1024 + cy / 32 * 824 / 1024));
      assert.deepEqual(rgba(x, y), [36, 36, 34, 255]);
    }
    offset += length;
  }
  assert.equal(expected.size, 0);
  assert.throws(() => icnsFromPngs([png, png]), /重复/);
  assert.throws(() => icnsFromPngs([]));
});
