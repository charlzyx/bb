const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function icnsFromPng(png) {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.readUInt32BE(16) !== 256 || png.readUInt32BE(20) !== 256) throw new Error('dots 图标必须为 256 × 256 PNG');
  const result = Buffer.alloc(16 + png.length);
  result.write('icns'); result.writeUInt32BE(result.length, 4);
  result.write('ic08', 8); result.writeUInt32BE(png.length + 8, 12);
  png.copy(result, 16);
  return result;
}
function bundleMetadata(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('产品版本必须为三个数字段');
  return { CFBundleName: 'dots', CFBundleDisplayName: 'dots', CFBundleIdentifier: 'local.dots.desktop.dev', CFBundleExecutable: 'dots', CFBundleIconFile: 'dots.icns', CFBundleShortVersionString: version, CFBundleVersion: version };
}
function assemble({ sourceApp, electronApp, wsDirectory, output, run }) {
  if (fs.existsSync(output)) throw new Error(`目标已存在，请使用新的输出目录：${output}`);
  for (const file of ['dist/index.html', 'native/main.cjs', 'public/dots.png', 'package.json']) {
    if (!fs.statSync(path.join(sourceApp, file)).isFile()) throw new Error(`缺少构建输入：${file}`);
  }
  const metadata = bundleMetadata(JSON.parse(fs.readFileSync(path.join(sourceApp, 'package.json'), 'utf8')).version);
  if (!fs.statSync(path.join(electronApp, 'Contents/MacOS/Electron')).isFile()) throw new Error('需要当前 Mac 架构的 Electron.app');
  if (JSON.parse(fs.readFileSync(path.join(wsDirectory, 'package.json'), 'utf8')).name !== 'ws') throw new Error('WebSocket 依赖无效');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.cpSync(electronApp, output, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
  const contents = path.join(output, 'Contents');
  const resources = path.join(contents, 'Resources');
  const app = path.join(resources, 'app');
  if (fs.existsSync(app)) throw new Error('Electron 模板已包含 app，拒绝覆盖');
  fs.mkdirSync(app);
  for (const directory of ['native', 'dist', 'public']) fs.cpSync(path.join(sourceApp, directory), path.join(app, directory), { recursive: true, dereference: true });
  fs.copyFileSync(path.resolve(sourceApp, '../../LICENSE'), path.join(app, 'LICENSE'));
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'dots', productName: 'dots', version: metadata.CFBundleVersion, main: 'native/main.cjs', private: true }));
  fs.cpSync(wsDirectory, path.join(app, 'node_modules/ws'), { recursive: true, dereference: true });
  fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
  fs.writeFileSync(path.join(resources, 'dots.icns'), icnsFromPng(fs.readFileSync(path.join(sourceApp, 'public/dots.png'))));
  fs.renameSync(path.join(contents, 'MacOS/Electron'), path.join(contents, 'MacOS/dots'));
  const plist = path.join(contents, 'Info.plist');
  for (const [key, value] of Object.entries(metadata)) run('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
  run('/usr/bin/plutil', ['-lint', plist]);
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', output]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', output]);
  return output;
}
function main() {
  if (process.platform !== 'darwin') throw new Error('此脚本只在 Mac 本机生成开发包');
  const sourceApp = path.resolve(__dirname, '..');
  const modules = path.join(sourceApp, 'toolchain/node_modules');
  const electronApp = path.join(path.dirname(require.resolve('electron/package.json', { paths: [modules] })), 'dist/Electron.app');
  const wsDirectory = path.dirname(require.resolve('ws/package.json', { paths: [modules] }));
  const release = fs.mkdtempSync(path.join(sourceApp, 'dots-macos-dev-'));
  const output = path.join(release, 'dots.app');
  const run = (command, args) => {
    const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} 失败；保留生成目录供检查：${release}`);
  };
  assemble({ sourceApp, electronApp, wsDirectory, output, run });
  console.log(`本地开发包：${output}\n无 Developer ID 签名或公证；仅使用本地 ad-hoc 签名，不可作为正式安装包分发。\n启动："${output}/Contents/MacOS/dots"\n默认使用本地令牌认证。本地兼容连接（不校验令牌）需显式添加 LORCA_ALLOW_LEGACY=1。`);
}
module.exports = { icnsFromPng, bundleMetadata, assemble };
if (require.main === module) main();
