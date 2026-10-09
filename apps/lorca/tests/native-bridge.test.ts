import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');
const { LorcaBridge, validateEndpoint, validateRequest, validateCopyText, isTrustedSender } = require('../native/bridge.cjs');
const { AttachmentSelections } = require('../native/attachments.cjs');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean) { const end = Date.now() + 2000; while (!check()) { if (Date.now() > end) throw new Error('Condition did not arrive'); await delay(5); } }
interface RequestFrame { id: number; method: string; params: Record<string, unknown> }
interface Socket { send(text: string): void; terminate(): void; emit(event: string, ...args: unknown[]): void; on(event: string, cb: (...args: any[]) => void): void }
async function fixture(t: { after: (cb: () => Promise<void>) => void }, options: { reject?: boolean; legacy?: boolean; timeoutMs?: number } = {}) {
  const home = await mkdtemp(path.join(tmpdir(), 'bb-lorca-native-test-'));
  const token = 'fake-test-token-never-production';
  await writeFile(path.join(home, 'serve-token'), token, { mode: 0o600 });
  const server = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const headers: Record<string, string | string[] | undefined>[] = [];
  const sockets: Socket[] = [];
  const requests: RequestFrame[] = [];
  const unexpectedRejectionErrors: Error[] = [];
  let handler: (socket: Socket, request: RequestFrame) => void = (socket, request) => socket.send(JSON.stringify({ id: request.id, result: null }));
  server.on('upgrade', (request, socket, head) => {
    headers.push(request.headers);
    if (request.headers.origin || options.reject || (!options.legacy && request.headers.authorization !== `Bearer ${token}`)) {
      socket.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'ECONNRESET') unexpectedRejectionErrors.push(error); });
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n', () => socket.destroy());
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws: Socket) => wss.emit('connection', ws));
  });
  wss.on('connection', (socket: Socket) => {
    sockets.push(socket);
    socket.on('message', (bytes: Buffer) => { const request = JSON.parse(bytes.toString()) as RequestFrame; requests.push(request); handler(socket, request); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const endpoint = `ws://127.0.0.1:${address.port}/ws`;
  const bridge = new LorcaBridge({ home, endpoint, legacy: options.legacy ?? false, timeoutMs: options.timeoutMs ?? 1000, retryMinimumMs: 20, retryMaximumMs: 60, handshakeTimeoutMs: 200 });
  t.after(async () => { bridge.close(); for (const socket of sockets) socket.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); await rm(home, { recursive: true, force: true }); assert.deepEqual(unexpectedRejectionErrors, []); });
  return { home, token, bridge, endpoint, headers, sockets, requests, handle: (fn: typeof handler) => { handler = fn; } };
}

test('native boundary accepts only canonical loopback WebSocket endpoints and bounded methods', () => {
  assert.equal(validateEndpoint('ws://localhost:4862/ws'), 'ws://127.0.0.1:4862/ws');
  for (const endpoint of ['ws://evil.example:4862/ws', 'wss://127.0.0.1:4862/ws', 'ws://127.0.0.1:0/ws', 'ws://127.0.0.1:65536/ws', 'ws://127.1:4862/ws', 'ws://2130706433:4862/ws', 'ws://127.0.0.1:4862/ws?token=x', 'ws://user@127.0.0.1:4862/ws', 'ws://127.0.0.1:4862/ws#x', 'ws://[::1]:4862/ws']) assert.throws(() => validateEndpoint(endpoint));
  assert.deepEqual(validateRequest('chats.send', { chat_id: 'c', text: 'hello', message_id: 'm' }), { chat_id: 'c', text: 'hello', message_id: 'm' });
  for (const method of ['identity.create', 'identity.restore', 'providers.api_key', 'files.path', 'config.set', 'bash.stdin', 'bots.update', '__proto__']) assert.throws(() => validateRequest(method, {}));
  assert.throws(() => validateRequest('chats.send', { chat_id: 'c', text: 'hi', attachments: [{ path: '/private' }] }));
  assert.throws(() => validateRequest('chats.send', { chat_id: 'c', text: 'x'.repeat(200001) }));
  assert.throws(() => validateRequest('chats.messages', { chat_id: 'c', limit: 201 }));
  assert.throws(() => validateRequest('chats.create', { bot_ids: ['a', 'a'] }));
  assert.throws(() => validateRequest('chats.permission', { chat_id: 'c', message_id: 'm', decision: 'expired' }));
  assert.throws(() => validateRequest('chats.pin', { chat_id: 'c' }));
});

test('IPC trust requires exact webContents, main frame, and loaded local document', () => {
  const mainFrame = { url: 'file:///app/dist/index.html' };
  const contents = { mainFrame };
  assert.equal(isTrustedSender({ sender: contents, senderFrame: mainFrame }, contents, mainFrame.url), true);
  assert.equal(isTrustedSender({ sender: {}, senderFrame: mainFrame }, contents, mainFrame.url), false);
  assert.equal(isTrustedSender({ sender: contents, senderFrame: { ...mainFrame } }, contents, mainFrame.url), false);
  assert.equal(isTrustedSender({ sender: contents, senderFrame: mainFrame }, contents, 'file:///app/dist/other.html'), false);
  mainFrame.url = 'https://evil.example';
  assert.equal(isTrustedSender({ sender: contents, senderFrame: mainFrame }, contents, 'file:///app/dist/index.html'), false);
});

test('authenticated connection omits Origin and maps out-of-order replies and full events', async t => {
  const f = await fixture(t);
  const status = await f.bridge.connect(f.endpoint); assert.equal(status.status, 'connected'); assert.equal(status.authMode, 'token');
  assert.equal(f.headers[0]?.authorization, `Bearer ${f.token}`); assert.equal(f.headers[0]?.origin, undefined);
  assert.ok(!JSON.stringify(status).includes(f.token)); assert.ok(!JSON.stringify(status).includes(f.home));
  const pending: RequestFrame[] = [];
  f.handle((socket, frame) => { pending.push(frame); if (pending.length === 2) { socket.send(JSON.stringify({ event: 'message.updated', data: { chat_id: 'c', message: { id: 'm', queued: true } } })); socket.send(JSON.stringify({ id: pending[1]!.id, result: { second: true } })); socket.send(JSON.stringify({ id: pending[0]!.id, result: { first: true } })); } });
  const events: unknown[] = []; f.bridge.on('event', (event: unknown) => events.push(event));
  const first = f.bridge.request('hello', {}); const second = f.bridge.request('chats.messages', { chat_id: 'c' });
  assert.deepEqual(await second, { second: true }); assert.deepEqual(await first, { first: true });
  assert.deepEqual(events, [{ event: 'message.updated', data: { chat_id: 'c', message: { id: 'm', queued: true } } }]);
});

test('timeout makes mutations unknown without replay, and preserves late reply safety', async t => {
  const f = await fixture(t, { timeoutMs: 25 }); await f.bridge.connect(f.endpoint);
  f.handle(() => {});
  await assert.rejects(f.bridge.request('chats.send', { chat_id: 'c', text: 'hello', message_id: 'm' }), /结果尚不确定.*未被自动重发/);
  assert.equal(f.requests.length, 1);
  f.sockets[0]!.send(JSON.stringify({ id: f.requests[0]!.id, result: { message: {} } }));
  await delay(10); assert.equal(f.bridge.getStatus().status, 'connected'); assert.equal(f.requests.length, 1);
  await assert.rejects(f.bridge.request('hello', {}), error => error instanceof Error && !error.message.includes('结果尚不确定'));
});

test('dropped mutation is never replayed, reconnect rereads token, stale socket cannot publish', async t => {
  const f = await fixture(t); await f.bridge.connect(f.endpoint);
  let oldSocket: Socket | null = null;
  f.handle((socket, frame) => { if (frame.method === 'chats.send') { oldSocket = f.bridge.socket; socket.terminate(); } });
  await assert.rejects(f.bridge.request('chats.send', { chat_id: 'c', text: 'once', message_id: 'm' }), /结果尚不确定/);
  await until(() => f.sockets.length === 2 && f.bridge.getStatus().status === 'connected');
  assert.equal(f.requests.length, 1); assert.equal(f.headers[1]?.authorization, `Bearer ${f.token}`);
  const events: unknown[] = []; f.bridge.on('event', (event: unknown) => events.push(event));
  assert.ok(oldSocket);
  (oldSocket as Socket).emit('message', Buffer.from(JSON.stringify({ event: 'identity.changed', data: { has_identity: false } })), false);
  assert.deepEqual(events, []);
});

test('401 never downgrades authentication', async t => {
  const f = await fixture(t, { reject: true }); const status = await f.bridge.connect(f.endpoint);
  assert.equal(status.status, 'error'); assert.match(status.detail, /serve-token/);
  await until(() => f.headers.length >= 2 && f.bridge.getStatus().status === 'error');
  for (const headers of f.headers) { assert.equal(headers.authorization, `Bearer ${f.token}`); assert.equal(headers.origin, undefined); }
  assert.equal(f.bridge.getStatus().authMode, 'token');
});

test('explicit legacy mode is visible and never reads an account token', async t => {
  const f = await fixture(t, { legacy: true });
  f.bridge.readToken = () => { throw new Error('must not read'); };
  const status = await f.bridge.connect(f.endpoint);
  assert.equal(status.status, 'connected'); assert.equal(status.authMode, 'legacy'); assert.match(status.detail, /未启用身份验证/);
  assert.equal(f.headers[0]?.authorization, undefined); assert.equal(f.headers[0]?.origin, undefined);
});

test('missing token fails closed and malformed protocol stops reconnect until explicit retry', async t => {
  const f = await fixture(t); await rm(path.join(f.home, 'serve-token'));
  const status = await f.bridge.connect(f.endpoint); assert.equal(status.status, 'error'); assert.match(status.detail, /无法读取/); assert.equal(f.headers.length, 0);
  f.bridge.close(); await writeFile(path.join(f.home, 'serve-token'), f.token); await f.bridge.connect(f.endpoint);
  f.handle(socket => socket.send('{broken json'));
  await assert.rejects(f.bridge.request('hello', {}), /Lorca 响应不兼容/);
  const count = f.headers.length; await delay(80); assert.equal(f.headers.length, count); assert.equal(f.bridge.getStatus().status, 'error');
});

test('server error and null result stay distinct', async t => {
  const f = await fixture(t); await f.bridge.connect(f.endpoint);
  f.handle((socket, frame) => socket.send(JSON.stringify(frame.method === 'chats.permission' ? { id: frame.id, error: { message: 'Unknown message' } } : { id: frame.id, result: null })));
  assert.equal(await f.bridge.request('chats.stop', { chat_id: 'c' }), null);
  await assert.rejects(f.bridge.request('chats.permission', { chat_id: 'c', message_id: 'm', decision: 'allow' }), /Unknown message/);
});

test('native file selections reveal opaque IDs only, and support attachment-only sends', async t => {
  const f = await fixture(t); await f.bridge.connect(f.endpoint);
  const selectedFile = path.join(f.home, 'example.txt'); await writeFile(selectedFile, 'test');
  const registry = new AttachmentSelections(); const selected = await registry.add([selectedFile]);
  assert.equal(selected[0].name, 'example.txt'); assert.equal(selected[0].size, 4); assert.equal(selected[0].path, undefined);
  assert.ok(!JSON.stringify(selected).includes(f.home));
  f.handle((socket, frame) => socket.send(JSON.stringify({ id: frame.id, result: { message: { id: 'm' } } })));
  await assert.rejects(registry.send(f.bridge, { chat_id: 'c', text: '', selection_ids: ['/etc/passwd'] }), /不可用/);
  assert.deepEqual(await registry.send(f.bridge, { chat_id: 'c', text: '', message_id: 'm', selection_ids: [selected[0].id] }), { message: { id: 'm' } });
  const sent = f.requests[0]!; assert.equal(sent.method, 'chats.send'); assert.equal(sent.params.text, '');
  assert.deepEqual(sent.params.attachments, [{ path: selectedFile, name: 'example.txt', id: `att-${selected[0].id}` }]);
  await assert.rejects(registry.send(f.bridge, { chat_id: 'c', text: 'again', selection_ids: [selected[0].id] }), /不可用/);
  const next = await registry.add([selectedFile]); await writeFile(selectedFile, 'changed');
  await assert.rejects(registry.send(f.bridge, { chat_id: 'c', text: '', selection_ids: [next[0].id] }), /文件已变化/);
});

test('Electron preload has no raw IPC or filesystem export and main keeps security isolation', async () => {
  const preload = await readFile(new URL('../native/preload.cjs', import.meta.url), 'utf8');
  const main = await readFile(new URL('../native/main.cjs', import.meta.url), 'utf8');
  assert.match(preload, /exposeInMainWorld\('lorca'/); assert.doesNotMatch(preload, /exposeInMainWorld\('(?:ipcRenderer|fs|require)'/);
  for (const required of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', "action: 'deny'", "contents.on('will-navigate'", 'ensureSender(event)']) assert.ok(main.includes(required), required);
  assert.doesNotMatch(main, /shell\.openExternal|exec\(|spawn\(/);
});

test('connection replacement fences an in-progress native file send', async t => {
  const f = await fixture(t); await f.bridge.connect(f.endpoint);
  const selectedFile = path.join(f.home, 'selected.txt'); await writeFile(selectedFile, 'test');
  const registry = new AttachmentSelections(); const selected = await registry.add([selectedFile]);
  const send = registry.send(f.bridge, { chat_id: 'c', text: '  ', selection_ids: [selected[0].id] });
  f.bridge.close();
  await assert.rejects(send, /连接已变化/);
  assert.equal(f.requests.length, 0);
});

test('reconnect reloads changed fake token and close cancels scheduled retries', async t => {
  const f = await fixture(t); await f.bridge.connect(f.endpoint);
  const newToken = 'different-fake-token'; await writeFile(path.join(f.home, 'serve-token'), newToken);
  f.sockets[0]!.terminate();
  await until(() => f.headers.length >= 2 && f.bridge.getStatus().status === 'error');
  assert.equal(f.headers[1]?.authorization, `Bearer ${newToken}`);
  f.bridge.close(); const count = f.headers.length; await delay(100); assert.equal(f.headers.length, count);
  assert.equal(f.bridge.getStatus().status, 'disconnected');
});

test('identity clear invalidates in-flight file reads without needing a socket generation change', async t => {
  const f = await fixture(t); await f.bridge.connect(f.endpoint);
  const selectedFile = path.join(f.home, 'selected.txt'); await writeFile(selectedFile, 'test');
  const registry = new AttachmentSelections();
  const adding = registry.add([selectedFile]); registry.clear();
  await assert.rejects(adding, /附件选择已变化/); assert.equal(registry.files.size, 0);
  const selected = await registry.add([selectedFile]);
  const send = registry.send(f.bridge, { chat_id: 'c', text: '', selection_ids: [selected[0].id] });
  registry.clear();
  await assert.rejects(send, /附件选择已变化/); assert.equal(f.requests.length, 0);
});

test('renderer cannot invoke unused destructive or membership methods', () => {
  for (const method of ['chats.delete', 'chats.add_bot', 'chats.remove_bot', 'chats.set_owner', 'chats.rename', 'chats.set_description', 'chats.pin', 'chats.dm']) assert.throws(() => validateRequest(method, { chat_id: 'chat-existing', bot_id: 'bot-existing', title: 'new title', pinned: true }));
});


test('native copy is text-only and bounded without clipboard reads', () => {
  assert.equal(validateCopyText('code to copy'), 'code to copy');
  for (const value of [null, 1, {}, 'x'.repeat(200001), 'unsafe\0text']) assert.throws(() => validateCopyText(value));
});
