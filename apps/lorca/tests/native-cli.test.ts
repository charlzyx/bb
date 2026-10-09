import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { runCli, resultJSON } = require('../native/cli.cjs');

function noIO() {
  const output: string[] = [], errors: string[] = [];
  return { output, errors, options: { stdout: (text: string) => output.push(text), stderr: (text: string) => errors.push(text), env: { LORCA_HOME: '/never/read/private-data' }, makeBridge: () => { throw new Error('No connection or credential reads are allowed'); } } };
}

test('CLI help/default does not create a connection or read credentials', async () => {
  for (const args of [[], ['--help'], ['-h']]) {
    const f = noIO(); assert.equal(await runCli(args, f.options), 0);
    assert.match(f.output.join(''), /用法：/); assert.match(f.output.join(''), /chats\.messages/);
    assert.equal(f.errors.length, 0); assert.ok(!f.output.join('').includes('/never/read'));
  }
});

test('CLI rejects invalid JSON, blocked methods, invalid endpoints, and path injection before I/O', async () => {
  for (const args of [['chats.send', '{bad-secret-json'], ['providers.api_key', '{}'], ['chats.send', '{"chat_id":"c","text":"hi","attachments":[{"path":"/private/key"}]}'], ['hello', '{}', 'unexpected']]) {
    const f = noIO(); assert.equal(await runCli(args, f.options), 2); assert.equal(f.output.length, 0);
    assert.ok(!f.errors.join('').includes('/private')); assert.ok(!f.errors.join('').includes('bad-secret'));
  }
  const f = noIO(); assert.equal(await runCli(['hello'], { ...f.options, env: { LORCA_ENDPOINT: 'ws://remote.example:4862/ws' } }), 2);
});

test('CLI runs exactly one explicit command, outputs safe JSON, and closes', async () => {
  const f = noIO(); const calls: unknown[] = []; let closed = false;
  const makeBridge = () => ({
    connect: async (endpoint: string) => { calls.push(['connect', endpoint]); return { status: 'connected', authMode: 'token' }; },
    request: async (method: string, params: unknown) => { calls.push([method, params]); return { version: 'test', has_identity: true, is_identity_device: true, device_id: 'runner', relay_connected: false, relay_update_required: false, relay_url: 'private-url', token: 'secret', nested: { path: '/native/private', workdir: '/native/work' } }; },
    close: () => { closed = true; },
  });
  assert.equal(await runCli(['hello'], { ...f.options, makeBridge }), 0);
  assert.deepEqual(calls, [['connect', 'ws://127.0.0.1:4862/ws'], ['hello', {}]]); assert.equal(closed, true);
  assert.deepEqual(JSON.parse(f.output.join('')), { version: 'test', has_identity: true, is_identity_device: true, device_id: 'runner', relay_connected: false, relay_update_required: false });
  assert.equal(f.errors.length, 0);
});

test('CLI failure never prints credential or native-path error text and still closes', async () => {
  const f = noIO(); let closed = false;
  const makeBridge = () => ({ connect: async () => ({ status: 'connected', authMode: 'legacy' }), request: async () => { throw new Error('secret token at /native/private'); }, close: () => { closed = true; } });
  assert.equal(await runCli(['chats.stop', '{"chat_id":"c"}'], { ...f.options, makeBridge }), 1); assert.equal(closed, true);
  assert.match(f.errors.join(''), /不带身份验证/); assert.match(f.errors.join(''), /结果可能尚不确定/);
  assert.ok(!f.errors.join('').includes('/native/private')); assert.ok(!f.errors.join('').includes('secret token'));
  assert.equal(resultJSON(null), 'null');
});
