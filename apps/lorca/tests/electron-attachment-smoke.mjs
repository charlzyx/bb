import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, truncate, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const require = createRequire(import.meta.url);
const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(check, label) {
  const end = Date.now() + 15_000;
  while (!await check()) { if (Date.now() > end) throw new Error(`${label} timed out`); await delay(25); }
}
async function deadline(promise, milliseconds, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function playwright() {
  try { return await import('playwright'); }
  catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND' || !process.env.PLAYWRIGHT_MODULE) throw error; return import(process.env.PLAYWRIGHT_MODULE); }
}
const snapshot = {
  version: 'synthetic-attachment-smoke', has_identity: true, is_identity_device: true, identity_id: 'synthetic-account', this_device_id: 'synthetic-runner', relay_connected: false,
  bots: [{ id: 'fixture-bot', name: 'Attachment Fixture', runner_id: 'synthetic-runner', provider: 'synthetic', model: 'synthetic' }],
  devices: [{ id: 'synthetic-runner', name: 'Synthetic Runner', os: 'linux', version: 'fixture', status: 'online', is_this_device: true, plugins: [] }],
  providers: [{ kind: 'synthetic', is_connected: true }], models: [], routines: [], running_chat_ids: [], running_turns: [],
  chats: [
    { id: 'chat-one', kind: 'dm', title: null, bot_ids: ['fixture-bot'], created_at: 1, has_more: false, messages: [] },
    { id: 'chat-two', kind: 'group', title: 'Synthetic second chat', bot_ids: ['fixture-bot'], created_at: 2, has_more: false, messages: [] },
  ],
};
async function main() {
  await access(path.join(appDirectory, 'dist/index.html'));
  const { _electron } = await playwright();
  const executablePath = process.env.ELECTRON_PATH || require('electron');
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dots-attachment-smoke-')));
  const home = path.join(temporary, 'lorca'), staging = path.join(temporary, 'tmp'), inputs = path.join(temporary, 'inputs');
  const token = randomBytes(32).toString('base64url');
  const requests = [], failures = [], sentFiles = [];
  const server = createServer((_request, response) => { response.writeHead(404); response.end(); });
  const wss = new WebSocketServer({ noServer: true });
  let application;
  try {
    await Promise.all([home, staging, inputs].map(directory => mkdir(directory, { recursive: true })));
    await writeFile(path.join(home, 'serve-token'), token, { mode: 0o600 });
    const isolatedPaths = Object.fromEntries(['userData', 'sessionData', 'logs', 'crashDumps'].map(name => [name, path.join(temporary, name)]));
    const entry = path.join(temporary, 'attachment-fixture-main.cjs');
    await writeFile(entry, `const { app } = require('electron');\nconst { mkdirSync } = require('node:fs');\nfor (const [name, directory] of Object.entries(${JSON.stringify(isolatedPaths)})) { mkdirSync(directory, { recursive: true }); app.setPath(name, directory); }\nrequire(${JSON.stringify(path.join(appDirectory, 'native/main.cjs'))});\n`);
    const png = path.join(inputs, 'synthetic.png'), text = path.join(inputs, 'synthetic.txt'), svg = path.join(inputs, 'synthetic.svg'), huge = path.join(inputs, 'oversized.bin');
    await writeFile(png, await readFile(path.join(appDirectory, 'public/app-icon/64.png')));
    await writeFile(text, 'Only synthetic attachment data'); await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"><script>throw new Error("must not render")</script></svg>');
    await writeFile(huge, ''); await truncate(huge, 100 * 1024 * 1024 + 1);
    server.on('upgrade', (request, socket, head) => {
      if (request.url !== '/ws' || request.headers.origin !== undefined || request.headers.authorization !== `Bearer ${token}`) { socket.on('error', () => {}); socket.destroy(); failures.push('Invalid synthetic authorization'); return; }
      wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client));
    });
    wss.on('connection', socket => {
      socket.on('error', error => failures.push(error.message));
      socket.on('message', bytes => { void (async () => {
        const request = JSON.parse(bytes.toString()); requests.push(request);
        const reply = result => socket.send(JSON.stringify({ id: request.id, result }));
        if (request.method === 'bootstrap') reply(snapshot);
        else if (['ui.watching', 'chats.mark_read'].includes(request.method)) reply(null);
        else if (request.method === 'chats.messages') reply({ messages: [], has_more: false });
        else if (request.method === 'chats.send') {
          assert.equal(request.params.chat_id, 'chat-one');
          assert.equal(request.params.attachments.length, 2);
          const attachments = [];
          for (const attachment of request.params.attachments) {
            const relative = path.relative(staging, attachment.path);
            assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Only the private staged copy can be sent');
            const content = await readFile(attachment.path); sentFiles.push({ name: attachment.name, bytes: content });
            attachments.push({ id: attachment.id, name: attachment.name, mime: attachment.name.endsWith('.png') ? 'image/png' : 'text/plain', size: content.length });
          }
          reply({ message: { id: request.params.message_id, chat_id: 'chat-one', author: { kind: 'you' }, body: { kind: 'text', text: request.params.text, attachments }, state: { kind: 'complete' }, created_at: 3 } });
        } else { failures.push(`Unexpected method ${request.method}`); socket.send(JSON.stringify({ id: request.id, error: { message: 'Unsupported synthetic request' } })); }
      })().catch(error => { failures.push(error.message); socket.close(); }); });
    });
    server.listen(0, '127.0.0.1'); await deadline(once(server, 'listening'), 5000, 'Mock startup');
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const env = {};
    for (const key of ['PATH', 'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'SystemRoot']) if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, { HOME: temporary, USERPROFILE: temporary, TMPDIR: staging, TMP: staging, TEMP: staging, XDG_CONFIG_HOME: path.join(temporary, 'config'), XDG_CACHE_HOME: path.join(temporary, 'cache'), LORCA_HOME: home, LORCA_ENDPOINT: `ws://127.0.0.1:${address.port}/ws`, LORCA_ALLOW_LEGACY: '0' });
    application = await _electron.launch({ executablePath, args: [entry], cwd: appDirectory, env, chromiumSandbox: true, timeout: 30_000 });
    assert.equal(await application.evaluate(({ app }) => app.commandLine.hasSwitch('no-sandbox')), false);
    assert.deepEqual(await application.evaluate(({ app }) => Object.fromEntries(['userData', 'sessionData', 'logs', 'crashDumps'].map(name => [name, app.getPath(name)]))), isolatedPaths);
    const page = await application.firstWindow(); page.setDefaultTimeout(15_000);
    await page.getByText('已连接', { exact: true }).first().waitFor();
    await page.locator('.lorca-chat-item').filter({ hasText: 'Attachment Fixture' }).click();
    await page.locator('[data-attachment-composer]:not([data-attachment-disabled])').waitFor();
    const security = await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; const prefs = window.webContents.getLastWebPreferences(); return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, pid: window.webContents.getOSProcessId() }; });
    assert.equal(security.sandbox, true); assert.equal(security.contextIsolation, true); assert.equal(security.nodeIntegration, false);
    if (process.platform === 'linux') { const status = await readFile(`/proc/${security.pid}/status`, 'utf8'); assert.match(status, /^Seccomp:\s+2$/m); assert.match(status, /^NoNewPrivs:\s+1$/m); }
    await page.evaluate(() => {
      window.dotsAttachmentAudit = { drops: [], dragovers: [], imports: [] };
      for (const type of ['dragover', 'drop']) window.addEventListener(type, event => {
        window.dotsAttachmentAudit[type === 'drop' ? 'drops' : 'dragovers'].push({
          trusted: event.isTrusted, prevented: event.defaultPrevented, dropEffect: event.dataTransfer.dropEffect,
          inComposer: event.target instanceof Element && Boolean(event.target.closest('[data-attachment-composer]')),
          types: [...event.dataTransfer.types], files: [...event.dataTransfer.files].map(file => file.name),
        });
      }, true);
      window.lorca.onAttachmentImport(value => window.dotsAttachmentAudit.imports.push(value));
    });
    const cdp = await page.context().newCDPSession(page);
    const drop = async (files, outside = false) => {
      const target = await page.locator(outside ? '.lorca-scroll' : '[data-attachment-composer]').boundingBox(); assert.ok(target);
      const x = target.x + target.width / 2, y = target.y + target.height / 2;
      assert.equal(await page.evaluate(({ x, y, outside }) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (outside ? hit.closest('.lorca-scroll') && !hit.closest('[data-attachment-composer]') : hit.closest('[data-attachment-composer]')));
      }, { x, y, outside }), true, 'File drag coordinates must hit the intended document region');
      const before = await page.evaluate(() => ({ drops: window.dotsAttachmentAudit.drops.length, dragovers: window.dotsAttachmentAudit.dragovers.length, imports: window.dotsAttachmentAudit.imports.length }));
      const data = { items: [], files, dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver']) await cdp.send('Input.dispatchDragEvent', { type, x, y, data });
      await until(() => page.evaluate(count => window.dotsAttachmentAudit.dragovers.length > count, before.dragovers), 'Trusted native file dragover');
      const over = await page.evaluate(() => window.dotsAttachmentAudit.dragovers.at(-1));
      assert.equal(over.trusted, true); assert.equal(over.prevented, true); assert.equal(over.inComposer, !outside);
      assert.ok(over.types.includes('Files')); assert.equal(over.dropEffect, outside ? 'none' : 'copy');
      await cdp.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
      if (outside) {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const after = await page.evaluate(() => window.dotsAttachmentAudit);
        assert.equal(after.imports.length, before.imports, 'A rejected outside drag must not start any import');
        for (const rejected of after.drops.slice(before.drops)) { assert.equal(rejected.trusted, true); assert.equal(rejected.prevented, true); assert.equal(rejected.inComposer, false); }
      } else {
        await until(() => page.evaluate(count => window.dotsAttachmentAudit.drops.length > count, before.drops), 'Trusted native file drop');
        const dropped = await page.evaluate(() => window.dotsAttachmentAudit.drops.at(-1));
        assert.equal(dropped.trusted, true); assert.equal(dropped.prevented, true); assert.equal(dropped.inComposer, true);
      }
    };
    const count = () => page.locator('[data-attachment-id]').count();
    const uploads = () => requests.filter(request => request.method === 'chats.send');
    await drop([png]); await until(async () => await count() === 1, 'Image staged');
    const image = page.locator('[data-attachment-id] img'); await image.waitFor();
    await until(() => image.evaluate(element => element.complete && element.naturalWidth === 64), 'Safe bitmap preview');
    const oldUrl = await image.getAttribute('src'); assert.ok(oldUrl?.startsWith('blob:'));
    assert.equal(uploads().length, 0);
    await drop([png]); await until(() => page.evaluate(() => window.dotsAttachmentAudit.imports.some(value => value.duplicates === 1)), 'Duplicate ignored'); assert.equal(await count(), 1);
    await page.getByRole('button', { name: '移除附件 synthetic.png', exact: true }).click(); await until(async () => await count() === 0, 'Removal');
    assert.equal(await page.evaluate(async url => { try { await fetch(url); return false; } catch { return true; } }, oldUrl), true);
    await drop([svg]); await until(async () => await count() === 1, 'SVG as ordinary file'); assert.equal(await page.locator('[data-attachment-id] img').count(), 0);
    await page.getByRole('button', { name: '移除附件 synthetic.svg', exact: true }).click();
    const originalUrl = page.url(); await drop([png], true); await delay(100); assert.equal(page.url(), originalUrl); assert.equal(await count(), 0);
    await drop([huge]); await until(() => page.evaluate(() => window.dotsAttachmentAudit.imports.some(value => value.error?.includes('100 MiB'))), 'Oversized file rejected'); assert.equal(await count(), 0);
    await drop([png]); await until(async () => await count() === 1, 'Navigation fixture staged');
    await page.locator('.lorca-chat-item').filter({ hasText: 'Synthetic second chat' }).click(); await until(async () => await count() === 0, 'Draft navigation clears attachments');
    await until(async () => !(await readdir(staging)).some(name => name.startsWith('dots-attachment-')), 'Native cleanup after navigation');
    await page.locator('.lorca-chat-item').filter({ hasText: 'Attachment Fixture' }).click();
    await drop([png, text]); await until(async () => await count() === 2, 'Final batch staged'); assert.equal(uploads().length, 0);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await until(() => uploads().length === 1 && sentFiles.length === 2, 'Explicit synthetic send'); await until(async () => await count() === 0, 'Send consumes selections');
    await until(async () => !(await readdir(staging)).some(name => name.startsWith('dots-attachment-')), 'Native cleanup after send');
    assert.deepEqual(sentFiles.map(file => file.name), ['synthetic.png', 'synthetic.txt']);
    assert.deepEqual(sentFiles[0].bytes, await readFile(png)); assert.equal(sentFiles[1].bytes.toString(), 'Only synthetic attachment data');
    const audit = await page.evaluate(() => window.dotsAttachmentAudit);
    assert.equal(JSON.stringify(audit).includes(temporary), false); assert.equal(JSON.stringify(audit).includes(token), false);
    assert.deepEqual(failures, []);
    process.stdout.write(`${JSON.stringify({ ok: true, sandboxEnabled: true, trustedNativeDrop: true, isolatedFileMapping: true, stagedPreview: true, duplicates: true, removal: true, navigationCleanup: true, unsafePreviewBlocked: true, sizeLimit: true, explicitSends: 1, clipboardTouched: false, pasteTested: false })}\n`);
  } finally {
    let failure;
    if (application) { try { await deadline(application.close(), 15_000, 'Electron shutdown'); } catch (error) { failure = error; const child = application.process(); if (child.exitCode === null) child.kill('SIGTERM'); } }
    for (const socket of wss.clients) socket.terminate();
    await deadline(new Promise(resolve => wss.close(() => resolve())), 5000, 'WebSocket shutdown');
    if (server.listening) await deadline(new Promise(resolve => server.close(() => resolve())), 5000, 'HTTP shutdown');
    await rm(temporary, { recursive: true, force: true });
    if (failure) throw failure;
  }
}
main().catch(error => { process.stderr.write(`Attachment Electron smoke failed: ${error.stack ?? error.message}\n`); process.exitCode = 1; });
