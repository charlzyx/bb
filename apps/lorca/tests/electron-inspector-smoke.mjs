import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { WebSocketServer } from 'ws';
import { createInspectorFixture, editedMemory, editedMemoryEnd, initialMemory, memoryEnd, memoryHash, memoryStart, privateMarker } from './electron-inspector-fixture.mjs';

const require = createRequire(import.meta.url);
const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screenshotDirectory = path.resolve(process.env.LORCA_INSPECTOR_SCREENSHOTS || path.join(appDirectory, '../../docs/lorca-screenshots'));
async function deadline(promise, milliseconds, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function until(check, label) {
  const end = Date.now() + 10_000;
  while (!await check()) { if (Date.now() >= end) throw new Error(`${label} timed out`); await new Promise(resolve => setTimeout(resolve, 25)); }
}
function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12); chunk.writeUInt32BE(data.length); chunk.write(type, 4); data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4); return chunk;
}
function syntheticPng() {
  const header = Buffer.alloc(13); header.writeUInt32BE(32); header.writeUInt32BE(24, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((32 * 4 + 1) * 24);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) { const offset = y * 129 + 1 + x * 4; pixels.set([40 + x * 4, 90 + y * 4, 170, 255], offset); }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header), pngChunk('tEXt', Buffer.from(`Comment\0${privateMarker}`)), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}
async function loadPlaywright() {
  try { return await import('playwright'); }
  catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND' || !process.env.PLAYWRIGHT_MODULE) throw error; return import(process.env.PLAYWRIGHT_MODULE); }
}
async function sandbox(application, page, secure = false) {
  const handle = await application.browserWindow(page);
  const state = await handle.evaluate(async window => {
    const prefs = window.webContents.getLastWebPreferences();
    if (window.webContents.getURL().endsWith('/secure-editor.html')) { window.webContents.openDevTools({ mode: 'detach' }); await new Promise(resolve => setTimeout(resolve, 100)); }
    return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, webSecurity: prefs.webSecurity, devToolsOpened: window.webContents.isDevToolsOpened(), pid: window.webContents.getOSProcessId() };
  });
  await handle.dispose();
  assert.equal(state.sandbox, true); assert.equal(state.contextIsolation, true); assert.equal(state.nodeIntegration, false); assert.equal(state.webSecurity, true);
  if (secure) assert.equal(state.devToolsOpened, false);
  if (process.platform === 'linux') { const status = await readFile(`/proc/${state.pid}/status`, 'utf8'); assert.match(status, /^Seccomp:\s+2$/m); assert.match(status, /^NoNewPrivs:\s+1$/m); }
  const globals = await page.evaluate(() => ({ process: typeof window.process, require: typeof window.require, main: typeof window.lorca, secure: typeof window.dotsSecureSettings }));
  assert.deepEqual(globals, { process: 'undefined', require: 'undefined', main: secure ? 'undefined' : 'object', secure: secure ? 'object' : 'undefined' });
  if (secure) assert.deepEqual(await page.evaluate(() => Object.keys(window.dotsSecureSettings).sort()), ['cancel', 'initialize', 'submit']);
}
async function confirmWith(application, response) {
  await application.evaluate(({ dialog }, response) => { globalThis.inspectorConfirmResponse = response; dialog.showMessageBox = async (_parent, options) => { globalThis.inspectorConfirmations.push(options); return { response: globalThis.inspectorConfirmResponse, checkboxChecked: false }; }; }, response);
}
async function settle(pending) { const result = await deadline(pending, 15_000, 'Native operation result'); if (result.error) throw new Error(result.error); return result.value; }
async function openSecure(application, page, kind) {
  const nextWindow = application.waitForEvent('window', { timeout: 15_000 });
  const pending = page.evaluate(async kind => {
    const details = await window.lorca.getAgentDetails({ botId: 'bot-inspector' });
    return kind === 'memory' ? window.lorca.openAgentMemory({ revision: details.revision }) : window.lorca.agentDetailsAction({ kind: 'avatar.replace', revision: details.revision });
  }, kind).then(value => ({ value }), error => ({ error: error.message }));
  const secure = await Promise.race([nextWindow, pending.then(result => { throw new Error(result.error || `Native ${kind} operation completed before opening its window`); })]);
  secure.setDefaultTimeout(15_000); await secure.locator('#submit:not([disabled])').waitFor();
  await sandbox(application, secure, true); return { secure, pending };
}
async function assertSourceBoundary(application) {
  const results = await application.evaluate(async ({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().endsWith('/secure-editor.html'));
    const secure = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/secure-editor.html'));
    if (!main || !secure) throw new Error('Both native windows must exist');
    const denied = [];
    for (const [channel, sender, senderFrame, input] of [
      ['lorca:get-agent-details', secure.webContents, secure.webContents.mainFrame, { botId: 'bot-inspector' }],
      ['lorca:get-agent-memory-summary', main.webContents, secure.webContents.mainFrame, { revision: 'forged' }],
      ['lorca:secure-settings-init', main.webContents, main.webContents.mainFrame, undefined],
      ['lorca:secure-settings-submit', main.webContents, main.webContents.mainFrame, { memory: 'forged' }],
    ]) {
      try { await globalThis.inspectorHandlers.get(channel)({ sender, senderFrame }, input); denied.push(false); }
      catch (error) { denied.push(/来源不可信/.test(error.message)); }
    }
    return denied;
  });
  assert.deepEqual(results, [true, true, true, true]);
}
async function main() {
  await access(path.join(appDirectory, 'dist/index.html'));
  const { _electron } = await loadPlaywright();
  const executablePath = process.env.ELECTRON_PATH || require('electron'); assert.equal(typeof executablePath, 'string');
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dots-inspector-smoke-')));
  const home = path.join(temporary, 'lorca-fixture'), token = randomBytes(32).toString('base64url');
  const fixture = createInspectorFixture(home), failures = [], authenticated = [];
  const server = createServer((_request, response) => { response.writeHead(404); response.end(); });
  const wss = new WebSocketServer({ noServer: true });
  let application;
  try {
    await mkdir(home, { recursive: true }); await writeFile(path.join(home, 'serve-token'), token, { mode: 0o600 }); await mkdir(screenshotDirectory, { recursive: true });
    const avatarSource = path.join(temporary, 'synthetic-avatar.png'); await writeFile(avatarSource, syntheticPng());
    server.on('upgrade', (request, socket, head) => {
      const valid = request.url === '/ws' && request.headers.origin === undefined && request.headers.authorization === `Bearer ${token}`; authenticated.push(valid);
      if (!valid) { socket.on('error', error => { if (error.code !== 'ECONNRESET') failures.push(error.message); }); socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n', () => socket.destroy()); return; }
      wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client));
    });
    wss.on('connection', socket => {
      socket.on('error', error => failures.push(error.message));
      socket.on('message', bytes => { void (async () => {
        const request = JSON.parse(bytes.toString());
        try { const result = await fixture.dispatch(request.method, request.params); socket.send(JSON.stringify({ id: request.id, result })); }
        catch (error) { failures.push(error.message); socket.send(JSON.stringify({ id: request.id, error: { message: 'Unsupported synthetic inspector request' } })); }
      })().catch(error => { failures.push(error.message); socket.close(); }); });
    });
    server.listen(0, '127.0.0.1'); await deadline(once(server, 'listening'), 5000, 'Inspector mock startup');
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const env = {};
    for (const key of ['PATH', 'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'SystemRoot']) if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, { HOME: temporary, USERPROFILE: temporary, TMPDIR: temporary, TMP: temporary, TEMP: temporary, XDG_CONFIG_HOME: path.join(temporary, 'config'), XDG_CACHE_HOME: path.join(temporary, 'cache'), LORCA_HOME: home, LORCA_ENDPOINT: `ws://127.0.0.1:${address.port}/ws`, LORCA_ALLOW_LEGACY: '0' });
    const isolatedPaths = Object.fromEntries(['userData', 'sessionData', 'logs', 'crashDumps'].map(name => [name, path.join(temporary, name)]));
    const entry = path.join(temporary, 'inspector-main.cjs');
    await writeFile(entry, `const { app, ipcMain, dialog } = require('electron');\nconst { mkdirSync } = require('node:fs');\nfor (const [name, directory] of Object.entries(${JSON.stringify(isolatedPaths)})) { mkdirSync(directory, { recursive: true }); app.setPath(name, directory); }\nglobalThis.inspectorHandlers = new Map();\nglobalThis.inspectorConfirmations = [];\ndialog.showMessageBox = async (_parent, options) => { globalThis.inspectorConfirmations.push(options); return { response: 0, checkboxChecked: false }; };\nconst handle = ipcMain.handle.bind(ipcMain);\nipcMain.handle = (channel, handler) => { globalThis.inspectorHandlers.set(channel, handler); return handle(channel, handler); };\ndialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(avatarSource)}] });\nrequire(${JSON.stringify(path.join(appDirectory, 'native/main.cjs'))});\n`);
    application = await _electron.launch({ executablePath, args: [entry], cwd: appDirectory, env, chromiumSandbox: true, timeout: 30_000 });
    assert.equal(await application.evaluate(({ app }) => app.commandLine.hasSwitch('no-sandbox')), false);
    assert.deepEqual(await application.evaluate(({ app }) => Object.fromEntries(['userData', 'sessionData', 'logs', 'crashDumps'].map(name => [name, app.getPath(name)]))), isolatedPaths);
    const page = await application.firstWindow(); page.setDefaultTimeout(15_000);
    await until(() => page.evaluate(async () => Boolean(window.lorca) && (await window.lorca.getStatus()).status === 'connected'), 'Main renderer connected');
    await sandbox(application, page);
    await page.evaluate(() => window.lorca.request('bootstrap', {}));
    const details = await page.evaluate(() => window.lorca.getAgentDetails({ botId: 'bot-inspector' }));
    assert.equal(details.bot.id, 'bot-inspector'); assert.equal(details.canEditAvatar, true);
    const summary = await page.evaluate(revision => window.lorca.getAgentMemorySummary({ revision }), details.revision);
    assert.deepEqual(summary, { status: 'ready', lines: 3, bytes: Buffer.byteLength(initialMemory), maxLines: 200, maxBytes: 24000, topicCount: 1, logCount: 1, canEdit: true });
    for (const forbidden of [privateMarker, home, temporary, memoryStart, memoryEnd, token]) assert.equal(JSON.stringify({ details, summary }).includes(forbidden), false);
    for (const method of ['bots.memory', 'bots.memory.write', 'bots.update', 'bots.permissions', 'routines.run']) await assert.rejects(page.evaluate(method => window.lorca.request(method, {}), method), /不支持/);
    await assert.rejects(page.evaluate(revision => window.lorca.agentDetailsAction({ kind: 'memory.save', revision, text: 'forged', expectedHash: '0'.repeat(32) }), details.revision), /操作无效/);
    const cancelledMemory = await openSecure(application, page, 'memory');
    assert.equal(await cancelledMemory.secure.locator('#memory').inputValue(), initialMemory);
    assert.equal((await cancelledMemory.secure.evaluate(() => window.dotsSecureSettings.initialize())).fields[0].value, initialMemory);
    await assertSourceBoundary(application);
    assert.equal((await page.content()).includes(memoryStart), false);
    await cancelledMemory.secure.screenshot({ path: path.join(screenshotDirectory, 'electron-inspector-memory.png'), fullPage: true });
    await cancelledMemory.secure.locator('#cancel').click();
    assert.deepEqual(await settle(cancelledMemory.pending), { status: 'cancelled', botId: 'bot-inspector' });
    assert.equal(fixture.requests.filter(value => value.method === 'bots.memory.write').length, 0);
    assert.equal(await application.evaluate(() => globalThis.inspectorConfirmations.length), 0);
    await confirmWith(application, 1);
    const savedMemory = await openSecure(application, page, 'memory');
    await savedMemory.secure.locator('#memory').fill(editedMemory);
    const reviewWindow = application.waitForEvent('window', { timeout: 15_000 }).then(value => ({ value }), error => ({ error }));
    await savedMemory.secure.getByRole('button', { name: '复核并保存', exact: true }).click();
    const reviewOutcome = await reviewWindow; if (reviewOutcome.error) throw reviewOutcome.error;
    const review = reviewOutcome.value; review.setDefaultTimeout(15_000); await review.locator('#review').waitFor(); await sandbox(application, review, true);
    const fullReview = await review.locator('#review').inputValue();
    assert.ok(fullReview.length > 500_000); assert.ok(fullReview.includes(initialMemory)); assert.ok(fullReview.includes(editedMemory)); assert.ok(fullReview.includes(editedMemoryEnd));
    assert.equal(await review.locator('#review').getAttribute('maxlength'), null); assert.equal(await review.locator('#review').evaluate(element => element.readOnly), true);
    assert.equal((await page.content()).includes(editedMemoryEnd), false);
    await review.screenshot({ path: path.join(screenshotDirectory, 'electron-inspector-memory-review.png'), fullPage: true });
    await review.getByRole('button', { name: '已核对全部变更', exact: true }).click();
    assert.deepEqual(await settle(savedMemory.pending), { status: 'applied', botId: 'bot-inspector' });
    const memoryWrites = fixture.requests.filter(value => value.method === 'bots.memory.write');
    assert.equal(memoryWrites.length, 1); assert.deepEqual(memoryWrites[0].params, { bot_id: 'bot-inspector', text: editedMemory, expected_hash: memoryHash(initialMemory) });
    const cancelledAvatar = await openSecure(application, page, 'avatar');
    const preview = cancelledAvatar.secure.locator('img.avatar-preview');
    const pixels = await preview.evaluate(async image => { await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight, url: image.currentSrc }; });
    assert.deepEqual({ width: pixels.width, height: pixels.height }, { width: 24, height: 24 }); assert.match(pixels.url, /^data:image\/png;base64,/);
    assert.equal(Buffer.from(pixels.url.split(',')[1], 'base64').includes(Buffer.from(privateMarker)), false);
    assert.equal((await page.content()).includes(pixels.url), false);
    await cancelledAvatar.secure.screenshot({ path: path.join(screenshotDirectory, 'electron-inspector-avatar.png'), fullPage: true });
    await cancelledAvatar.secure.locator('#cancel').click();
    assert.deepEqual(await settle(cancelledAvatar.pending), { status: 'cancelled', botId: 'bot-inspector' }); assert.equal(fixture.uploadedAvatars.length, 0);
    assert.equal(await application.evaluate(() => globalThis.inspectorConfirmations.length), 1);
    const savedAvatar = await openSecure(application, page, 'avatar');
    await savedAvatar.secure.locator('img.avatar-preview').evaluate(image => image.decode());
    await savedAvatar.secure.getByRole('button', { name: '使用此头像', exact: true }).click();
    assert.deepEqual(await settle(savedAvatar.pending), { status: 'applied', botId: 'bot-inspector' });
    assert.equal(fixture.uploadedAvatars.length, 1); assert.equal(fixture.requests.filter(value => value.method === 'bots.update').length, 1);
    await assert.rejects(access(fixture.uploadedAvatars[0].path), error => error.code === 'ENOENT');
    const avatarResult = await page.evaluate(() => window.lorca.getAgentDetails({ botId: 'bot-inspector' }));
    assert.equal(avatarResult.bot.hasAvatar, true); assert.equal(JSON.stringify(avatarResult).includes(temporary), false);
    for (const response of [0, 1]) {
      await confirmWith(application, response);
      const outcome = await page.evaluate(async () => { const value = await window.lorca.getAgentCapabilities({ botId: 'bot-inspector' }); return { capabilities: value, result: await window.lorca.agentCapabilitiesAction({ kind: 'routine.run', revision: value.revision, routineId: 'routine-inspector' }) }; });
      assert.equal(JSON.stringify(outcome).includes(privateMarker), false); assert.equal(outcome.result.status, response ? 'applied' : 'cancelled');
      if (response) assert.deepEqual(outcome.result, { status: 'applied', botId: 'bot-inspector', routineId: 'routine-inspector', requested: true });
      assert.equal(fixture.requests.filter(value => value.method === 'routines.run').length, response);
    }
    const confirmations = await application.evaluate(() => globalThis.inspectorConfirmations);
    assert.equal(confirmations.length, 4); assert.ok(confirmations.some(value => value.detail.includes('完整变更已在隔离窗口展示'))); assert.ok(confirmations.some(value => value.detail.includes('无法承诺整体回滚'))); assert.ok(confirmations.some(value => value.detail.includes('确认仅表示请求运行')));
    for (const forbidden of [privateMarker, token, temporary, avatarSource, memoryStart]) assert.equal(JSON.stringify(confirmations).includes(forbidden), false);
    assert.equal(fixture.requests.some(value => value.method === 'chats.send' || value.method.startsWith('pair.') || value.method.startsWith('providers.')), false);
    assert.ok(authenticated.length > 0 && authenticated.every(Boolean)); assert.deepEqual(failures, []);
    process.stdout.write(`${JSON.stringify({ ok: true, strictSandbox: true, isolatedPaths: true, sourceFrameDenied: true, detailsSanitized: true, memorySummaryOnly: true, fullMemoryReview: true, memoryWrites: 1, avatarDecoded: true, avatarUploads: 1, syntheticRoutineRequests: 1 })}\n`);
  } finally {
    let shutdownFailure;
    if (application) {
      const child = application.process();
      try { await deadline(application.close(), 10_000, 'Inspector Electron shutdown'); } catch (error) { shutdownFailure = error; }
      finally { if (child.exitCode === null) { child.kill('SIGTERM'); try { await deadline(once(child, 'exit'), 5000, 'Inspector process exit'); } catch (error) { shutdownFailure ??= error; child.kill('SIGKILL'); } } }
    }
    try { for (const socket of wss.clients) socket.terminate(); await deadline(new Promise(resolve => wss.close(resolve)), 5000, 'Inspector socket shutdown'); if (server.listening) await deadline(new Promise(resolve => server.close(resolve)), 5000, 'Inspector HTTP shutdown'); }
    finally { await rm(temporary, { recursive: true, force: true }); }
    if (shutdownFailure) throw shutdownFailure;
  }
}
main().catch(error => { process.stderr.write(`Electron inspector smoke failed: ${error.stack ?? error.message}\n`); process.exitCode = 1; });
