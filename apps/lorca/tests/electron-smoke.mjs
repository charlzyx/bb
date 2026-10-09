import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const require = createRequire(import.meta.url);
const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function deadline(promise, milliseconds, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function loadPlaywright() {
  try { return await import('playwright'); }
  catch (error) {
    if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Install Playwright for the smoke test, or supply PLAYWRIGHT_MODULE for an explicitly configured module.');
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return import(process.env.PLAYWRIGHT_MODULE);
  }
}
const epoch = 1791561600;
const secretMarker = 'SYNTHETIC_SETTINGS_SECRET_MUST_NOT_REACH_RENDERER';
const privateSettings = { env: { KEY: secretMarker }, headers: { Authorization: secretMarker }, oauth: { clientSecret: secretMarker }, args: [secretMarker], cwd: secretMarker, url: secretMarker };
const message = (id, author, text, offset) => ({ id, chat_id: 'chat-smoke', author, body: { kind: 'text', text }, state: { kind: 'complete' }, created_at: epoch + offset });
const snapshot = {
  version: 'synthetic-electron-smoke', has_identity: true, is_identity_device: true,
  identity_id: 'account-smoke', this_device_id: 'runner-smoke', relay_connected: false,
  relay_url: null, relay_update_required: false, relay_error: null,
  bots: [{ id: 'bot-smoke', name: 'Fixture Bot', runner_id: 'runner-smoke', provider: 'fixture-provider', model: 'fixture-model', workdir: secretMarker }],
  chats: [{ id: 'chat-smoke', kind: 'dm', title: null, bot_ids: ['bot-smoke'], created_at: epoch, has_more: false,
    messages: [message('msg-fixture', { kind: 'bot', bot_id: 'bot-smoke' }, 'Synthetic Electron smoke fixture. No account or model is connected.', 0)] }],
  running_turns: [], running_chat_ids: [],
  devices: [{ id: 'runner-smoke', name: 'Synthetic Runner', os: 'linux', version: 'fixture', status: 'online', is_this_device: true, plugins: [{ id: 'plugin-smoke', name: 'Synthetic Plugin', state: 'ready', detail: secretMarker }] }],
  routines: [], providers: [{ kind: 'fixture-provider', name: 'Synthetic Provider', is_connected: true, detail: secretMarker, base_url: secretMarker }], models: [],
};

async function main() {
  await access(path.join(appDirectory, 'dist', 'index.html'));
  const { _electron } = await loadPlaywright();
  assert.ok(_electron?.launch, 'The configured Playwright module must provide _electron.launch');
  const executablePath = process.env.ELECTRON_PATH || require('electron');
  assert.equal(typeof executablePath, 'string', 'Resolve a normally installed Electron binary or set ELECTRON_PATH');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'bb-lorca-electron-smoke-'));
  const home = path.join(temporary, 'lorca-fixture');
  const token = randomBytes(32).toString('base64url');
  const server = createServer((_request, response) => { response.writeHead(404); response.end(); });
  const wss = new WebSocketServer({ noServer: true });
  const requests = [];
  const failures = [];
  const authenticated = [];
  let application;
  try {
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, 'serve-token'), token, { mode: 0o600 });
    server.on('upgrade', (request, socket, head) => {
      const valid = request.url === '/ws' && request.headers.origin === undefined && request.headers.authorization === `Bearer ${token}`;
      authenticated.push(valid);
      if (!valid) {
        socket.on('error', error => { if (error.code !== 'ECONNRESET') failures.push(error.message); });
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n', () => socket.destroy());
        return;
      }
      wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client));
    });
    wss.on('connection', socket => {
      socket.on('error', error => failures.push(error.message));
      socket.on('message', bytes => {
        try {
          const request = JSON.parse(bytes.toString()); requests.push(request);
          const reply = result => socket.send(JSON.stringify({ id: request.id, result }));
          const event = (name, data) => socket.send(JSON.stringify({ event: name, data }));
          if (request.method === 'bootstrap') reply(snapshot);
          else if (request.method === 'mcp.list') {
            reply({ path: secretMarker, error: null, servers: [{ name: 'Synthetic MCP', transport: 'http', enabled: true, tool_count: 3, problem: secretMarker, status: { id: 'mcp-smoke', name: 'Synthetic MCP', state: 'error', detail: secretMarker }, config: privateSettings }] });
            event('roster.changed', snapshot);
            event('relay.status', { connected: false, update_required: false, url: secretMarker, error: secretMarker });
            event('provider.auth', { kind: 'fixture-provider', url: secretMarker });
          }
          else if (request.method === 'chats.search') socket.send(JSON.stringify({ id: request.id, error: { message: secretMarker } }));
          else if (request.method === 'chats.messages') reply({ messages: snapshot.chats[0].messages, has_more: false });
          else if (request.method === 'chats.send' && request.params.chat_id === 'chat-smoke' && request.params.text === 'Synthetic smoke message') {
            const sent = message(request.params.message_id, { kind: 'you' }, request.params.text, 1);
            const answer = message('msg-smoke-reply', { kind: 'bot', bot_id: 'bot-smoke' }, 'Synthetic native bridge reply received.', 2);
            event('message.added', { chat_id: 'chat-smoke', message: sent });
            reply({ message: sent });
            event('job.started', { chat_id: 'chat-smoke', bot_id: 'bot-smoke', job_id: 'job-smoke' });
            event('message.added', { chat_id: 'chat-smoke', message: answer });
            event('job.finished', { chat_id: 'chat-smoke', bot_id: 'bot-smoke', job_id: 'job-smoke' });
          } else {
            failures.push(`Unexpected mock method: ${request.method}`);
            socket.send(JSON.stringify({ id: request.id, error: { message: 'Unsupported synthetic smoke request' } }));
          }
        } catch (error) { failures.push(error.message); socket.close(); }
      });
    });
    server.listen(0, '127.0.0.1'); await deadline(once(server, 'listening'), 5000, 'Mock server startup');
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const endpoint = `ws://127.0.0.1:${address.port}/ws`;
    const env = {};
    for (const key of ['PATH', 'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'SystemRoot']) if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, { HOME: temporary, USERPROFILE: temporary, XDG_CONFIG_HOME: path.join(temporary, 'config'), XDG_CACHE_HOME: path.join(temporary, 'cache'), LORCA_HOME: home, LORCA_ENDPOINT: endpoint, LORCA_ALLOW_LEGACY: '0' });
    const args = [path.join(appDirectory, 'native', 'main.cjs')];
    application = await _electron.launch({ executablePath, args, cwd: appDirectory, env, timeout: 30_000 });
    const page = await application.firstWindow();
    page.setDefaultTimeout(15_000);
    await page.getByText('Connected', { exact: true }).first().waitFor();
    await page.locator('.lorca-chat-item').filter({ hasText: 'Fixture Bot' }).click();
    await page.getByText('Synthetic Electron smoke fixture. No account or model is connected.', { exact: true }).waitFor();
    const renderer = await page.evaluate(async () => ({
      processType: typeof window.process, requireType: typeof window.require,
      keys: Object.keys(window.lorca).sort(), status: await window.lorca.getStatus(),
    }));
    assert.equal(renderer.processType, 'undefined'); assert.equal(renderer.requireType, 'undefined');
    assert.equal(renderer.status.status, 'connected'); assert.equal(renderer.status.authMode, 'token');
    assert.equal(JSON.stringify(renderer).includes(token), false); assert.equal(JSON.stringify(renderer).includes(home), false);
    assert.deepEqual(renderer.keys, ['connect', 'copyText', 'getSettings', 'getStatus', 'onEvent', 'onStatus', 'pickAttachments', 'request', 'sendAttachments']);
    const inventory = await page.evaluate(async () => {
      const events = [];
      const unsubscribe = window.lorca.onEvent(event => events.push(event));
      const bootstrap = await window.lorca.request('bootstrap', {});
      const settings = await window.lorca.getSettings({});
      let remoteError;
      try { await window.lorca.request('chats.search', { query: 'synthetic error fixture' }); } catch (error) { remoteError = error.message; }
      unsubscribe();
      return { bootstrap, settings, events, remoteError };
    });
    assert.equal(inventory.settings.mcp.status, 'ready');
    assert.equal(inventory.settings.mcp.servers[0].name, 'Synthetic MCP');
    assert.equal(inventory.settings.mcp.servers[0].toolCount, 3);
    assert.equal(inventory.settings.mcp.servers[0].hasError, true);
    assert.equal(inventory.settings.devices[0].name, 'Synthetic Runner');
    assert.equal(JSON.stringify(inventory).includes(secretMarker), false);
    assert.equal(inventory.events.some(event => event.event === 'provider.auth'), false);
    assert.ok(inventory.events.some(event => event.event === 'roster.changed'));
    assert.match(inventory.remoteError, /nothing was replayed/);
    const preferences = await application.evaluate(({ BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, sandbox: prefs.sandbox };
    });
    assert.deepEqual(preferences, { contextIsolation: true, nodeIntegration: false, sandbox: true });
    const blocked = await page.evaluate(async () => {
      try { await window.lorca.request('providers.api_key', { kind: 'deepseek' }); return false; } catch { return true; }
    });
    assert.equal(blocked, true);
    assert.equal(await page.evaluate(async () => { try { await window.lorca.request('mcp.list', {}); return false; } catch { return true; } }), true);
    await page.getByRole('textbox', { name: 'Message Lorca', exact: true }).fill('Synthetic smoke message');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('Synthetic native bridge reply received.', { exact: true }).waitFor();
    assert.equal(requests.filter(request => request.method === 'chats.send').length, 1);
    assert.ok(authenticated.length > 0 && authenticated.every(Boolean));
    assert.deepEqual(failures, []);
    assert.equal((await page.content()).includes(token), false);
    if (process.env.LORCA_SMOKE_SCREENSHOT) {
      const destination = path.resolve(process.env.LORCA_SMOKE_SCREENSHOT);
      await mkdir(path.dirname(destination), { recursive: true });
      await page.screenshot({ path: destination, fullPage: true });
      await page.locator('.lorca-workspace').click();
      await page.getByRole('button', { name: 'MCP', exact: true }).click();
      await page.getByText('Synthetic MCP', { exact: true }).waitFor();
      assert.equal((await page.content()).includes(secretMarker), false);
      await page.screenshot({ path: destination.replace(/\.png$/i, '') + '-settings.png', fullPage: true });
    }
    process.stdout.write(`${JSON.stringify({ ok: true, authenticated: true, rendererIsolated: true, settingsSanitized: true, syntheticSends: 1, sandboxEnabled: true })}\n`);
  } finally {
    let shutdownFailure;
    if (application) {
      const child = application.process();
      try { await deadline(application.close(), 10_000, 'Electron shutdown'); }
      catch (error) { shutdownFailure = error; }
      finally {
        if (child.exitCode === null) {
          child.kill('SIGTERM');
          try { await deadline(once(child, 'exit'), 5000, 'Electron process exit'); }
          catch (error) { shutdownFailure ??= error; child.kill('SIGKILL'); }
        }
      }
    }
    try {
      for (const socket of wss.clients) socket.terminate();
      await deadline(new Promise(resolve => wss.close(() => resolve())), 5000, 'Mock WebSocket shutdown');
      if (server.listening) await deadline(new Promise(resolve => server.close(() => resolve())), 5000, 'Mock HTTP shutdown');
    } finally { await rm(temporary, { recursive: true, force: true }); }
    if (shutdownFailure) throw shutdownFailure;
  }
}
main().catch(error => { process.stderr.write(`Electron smoke failed: ${error.message}\n`); process.exitCode = 1; });
