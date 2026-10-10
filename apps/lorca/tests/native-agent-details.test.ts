import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { link, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { AgentDetails, validateAgentAction, MAX_MEMORY_BYTES } = require('../native/agent-details.cjs');
const { SettingsInventory } = require('../native/settings.cjs');
const { RPC_METHODS } = require('../native/bridge.cjs');
const { botPresentation } = require('../native/bot-avatars.cjs');
const nativeFs: typeof import('node:fs/promises') = require('node:fs/promises');
const secret = 'SYNTHETIC_PRIVATE_METADATA';
const memoryHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32);
const makeBot = () => ({ id: 'bot-one', name: 'Research Agent', description: 'Summarize findings', symbol_name: 'sparkles', accent: 'indigo', provider: 'deepseek', model: 'first', thinking: 'high', runner_id: 'runner-one', instructions: secret, workdir: secret, permissions: { secret }, avatar: { id: 'att-synthetic', mime: 'image/png', size: 100, width: 16, height: 16 } });
const makeBootstrap = () => ({
  has_identity: true, identity_id: 'account-one', this_device_id: 'runner-one', relay_url: `https://synthetic.invalid/${secret}`,
  bots: [makeBot(), { ...makeBot(), id: 'bot-two', name: 'Second Agent' }],
  devices: [
    { id: 'runner-one', name: 'Local Runner', os: 'macos', status: 'online', machine_key: secret },
    { id: 'runner-two', name: 'Offline Runner', os: 'linux', status: 'offline' },
    { id: 'phone', name: 'Phone', os: 'ios', status: 'online' },
    { id: 'tablet', name: 'Tablet', os: 'ipados', status: 'online' },
    { id: 'unknown', name: 'Unknown', os: 'windows', status: 'online', unknown: true },
  ],
  providers: [
    { kind: 'deepseek', name: 'DeepSeek', is_connected: true, detail: secret, base_url: secret },
    { kind: 'custom:one', name: 'Custom', is_connected: true, models: [{ id: 'custom-model', name: 'Custom Model', levels: [] }] },
    { kind: 'custom:decisions', name: 'Review only', api: 'decisions', is_connected: true, models: [{ id: 'decision', levels: [] }] },
  ],
  models: [{ provider: 'deepseek', id: 'first', name: 'First', levels: ['high'], decides: false }, { provider: 'deepseek', id: 'second', name: 'Second', levels: [], decides: false }],
  shared_links: [{ url: `https://synthetic.invalid/#${secret}` }],
});
function makeMemory(text = 'Known fact\n') {
  return { bot_id: 'bot-one', here: true, runner: 'Local Runner', path: `/synthetic/${secret}`, index: { text, hash: memoryHash(text), bytes: Buffer.byteLength(text), lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0), truncated: false, max_lines: 200, max_bytes: 24_000 }, topics: ['longer-notes.md'], logs: ['2026-10-10'], private: secret };
}
class FakeBridge extends EventEmitter {
  status = { status: 'connected', generation: 1, authMode: 'token', endpoint: 'ws://127.0.0.1:4862/ws' };
  bootstrap = makeBootstrap(); memory = makeMemory();
  calls: { method: string; params: Record<string, unknown> }[] = [];
  handler: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | null = null;
  getStatus = () => ({ ...this.status });
  sendValidated = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    this.calls.push({ method, params: structuredClone(params) });
    if (this.handler) return this.handler(method, params);
    return this.reply(method, params);
  };
  reply(method: string, params: Record<string, unknown>): unknown {
    if (method === 'bootstrap') return structuredClone(this.bootstrap);
    if (method === 'bots.memory') return structuredClone(this.memory);
    if (method === 'bots.memory.write') return { hash: memoryHash(`${params.text}\n`), private: secret };
    if (method === 'bots.update') return { bot: { ...makeBot(), ...params }, private: secret };
    if (method === 'bots.create') return { bot: { ...makeBot(), ...params }, chat_id: 'new-direct-chat', private: secret };
    throw new Error('Unexpected method');
  }
}
type Prompt = { title: string; message: string; detail: string };
const writes = (bridge: FakeBridge) => bridge.calls.filter(call => !['bootstrap', 'bots.memory'].includes(call.method));
const deferred = () => { let resolve: (value: unknown) => void = () => {}; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function setup(options: Record<string, unknown> = {}, create = false) {
  const bridge = new FakeBridge(), inventory = new SettingsInventory(bridge), prompts: Prompt[] = [];
  const details = new AgentDetails(bridge, inventory, { confirm: async (spec: Prompt) => { prompts.push(spec); return true; }, ...options });
  const initial = await details.get(create ? {} : { botId: 'bot-one' });
  bridge.calls = [];
  return { bridge, inventory, details, prompts, initial, dispose: () => { details.dispose(); inventory.dispose(); } };
}

test('details return only selected profile and safe candidates with stable content version and distinct one-use tickets', async () => {
  const f = await setup(); const next = await f.details.get({ botId: 'bot-one' });
  assert.equal(next.version, f.initial.version); assert.notEqual(next.revision, f.initial.revision);
  assert.equal(next.bot.id, 'bot-one'); assert.equal(next.canEditAvatar, false); assert.equal(next.canCreate, false);
  assert.equal(next.bot.avatarVersion, botPresentation(f.bridge.bootstrap.bots[0], 'true:account-one').avatar_version);
  assert.deepEqual(next.runners.map((value: { id: string }) => value.id), ['runner-one', 'runner-two']);
  assert.equal(next.runners[1].online, false);
  assert.ok(next.models.some((value: { id: string }) => value.id === 'custom-model'));
  assert.equal(next.providers.some((value: { id: string }) => value.id === 'custom:decisions'), false);
  assert.equal(JSON.stringify(next).includes(secret), false); assert.equal(JSON.stringify(next).includes('bot-two'), false);
  for (const method of ['bots.update', 'bots.create', 'bots.memory', 'bots.memory.write']) assert.equal(RPC_METHODS.includes(method), false);
  await assert.rejects(f.details.apply({ kind: 'profile.save', revision: f.initial.revision, patch: { name: 'New' } }), /过期/);
  f.dispose();
});

test('schemas reject paths, credentials, permissions, wrong types and empty profile patches before I/O', () => {
  for (const value of [null, {}, { kind: 'profile.save', revision: 'x', patch: {} }, { kind: 'profile.save', revision: 'x', patch: { name: '' } }, { kind: 'profile.save', revision: 'x', patch: { model: null } }, { kind: 'profile.save', revision: 'x', patch: { avatar: { path: secret } } }, { kind: 'profile.save', revision: 'x', patch: { permissions: {} } }, { kind: 'agent.create', revision: 'x', profile: { name: 'New' } }, { kind: 'agent.create', revision: 'x', profile: { name: 'New', runnerId: 'runner-one', template_id: 'template' } }, { kind: 'memory.save', revision: 'x', text: 'x' }, { kind: 'memory.save', revision: 'x', text: 'x', expectedHash: 'x', path: secret }]) assert.throws(() => validateAgentAction(value));
  assert.equal(validateAgentAction({ kind: 'profile.save', revision: 'r', patch: { description: '', model: '', thinking: '' } }).patch.description, '');
});

test('profile save confirms full exact deltas and all-chat scope then submits only changed fields once', async () => {
  const f = await setup(); const description = `Detailed description ${'x'.repeat(5000)} END_MARKER`;
  const result = await f.details.apply({ kind: 'profile.save', revision: f.initial.revision, patch: { name: 'Renamed', description, symbolName: 'star.fill', accent: 'teal' } });
  assert.deepEqual(result, { status: 'applied', botId: 'bot-one' });
  assert.deepEqual(writes(f.bridge), [{ method: 'bots.update', params: { id: 'bot-one', name: 'Renamed', description, symbol_name: 'star.fill', accent: 'teal' } }]);
  for (const value of ['Research Agent', 'bot-one', '所有使用此智能体的聊天', 'Summarize findings', 'Renamed', description]) assert.ok(f.prompts[0].detail.includes(value));
  await assert.rejects(f.details.apply({ kind: 'profile.save', revision: f.initial.revision, patch: { name: 'Again' } }), /过期/);
  f.dispose();
});

test('profile-only edits do not depend on connected providers or a current model catalog', async () => {
  const f = await setup(); f.bridge.bootstrap.providers[0].is_connected = false; f.bridge.bootstrap.models = [];
  assert.equal((await f.details.apply({ kind: 'profile.save', revision: f.initial.revision, patch: { name: 'Renamed' } })).status, 'applied');
  f.dispose();
});

test('multiline profile descriptions preserve CRLF and do not block another selected agent', async () => {
  const f = await setup(); f.bridge.bootstrap.bots[1].description = 'Other bot\r\nWindows notes';
  const fresh = await f.details.get({ botId: 'bot-one' });
  await f.details.apply({ kind: 'profile.save', revision: fresh.revision, patch: { description: ' New first line\r\nSecond line ' } });
  assert.equal(writes(f.bridge)[0].params.description, 'New first line\r\nSecond line'); f.dispose();
});

test('runtime changes validate model and effective thinking, including custom provider catalogs', async () => {
  const f = await setup();
  await assert.rejects(f.details.apply({ kind: 'profile.save', revision: f.initial.revision, patch: { model: 'second' } }), /参数/);
  assert.equal(writes(f.bridge).length, 0);
  const fresh = await f.details.get({ botId: 'bot-one' });
  await f.details.apply({ kind: 'profile.save', revision: fresh.revision, patch: { provider: 'custom:one', model: 'custom-model', thinking: '' } });
  assert.deepEqual(writes(f.bridge)[0].params, { id: 'bot-one', provider: 'custom:one', model: 'custom-model', thinking: '' }); f.dispose();
});

test('cancel consumes the ticket without writing and new target selection invalidates prior details', async () => {
  const f = await setup({ confirm: async () => false });
  assert.deepEqual(await f.details.apply({ kind: 'profile.save', revision: f.initial.revision, patch: { name: 'New' } }), { status: 'cancelled', botId: 'bot-one' });
  assert.equal(writes(f.bridge).length, 0);
  const first = await f.details.get({ botId: 'bot-one' }); await f.details.get({ botId: 'bot-two' });
  await assert.rejects(f.details.apply({ kind: 'profile.save', revision: first.revision, patch: { name: 'New' } }), /过期/); f.dispose();
});

for (const phase of ['before', 'confirmation']) test(`profile changes ${phase} invalidate edit instead of overwriting`, async () => {
  const f = await setup(); const change = () => { f.bridge.bootstrap.bots[0].description = 'Changed elsewhere'; };
  if (phase === 'before') change(); else f.details.confirm = async () => { change(); return true; };
  await assert.rejects(f.details.apply({ kind: 'profile.save', revision: f.initial.revision, patch: { name: 'New' } }), /资料已变化/);
  assert.equal(writes(f.bridge).length, 0); f.dispose();
});

for (const mode of ['generation', 'identity', 'snapshot', 'endpoint', 'authMode', 'trusted', 'expiry', 'closed']) test(`confirmation await fences ${mode}`, async () => {
  let now = 0, trusted = true; const f = await setup({ now: () => now });
  f.details.confirm = async () => {
    if (mode === 'generation') f.bridge.status.generation++;
    if (mode === 'identity') f.bridge.emit('event', { event: 'identity.changed', data: { has_identity: true } });
    if (mode === 'snapshot') f.bridge.bootstrap.identity_id = 'account-two';
    if (mode === 'endpoint') f.bridge.status.endpoint = 'ws://127.0.0.1:4863/ws';
    if (mode === 'authMode') f.bridge.status.authMode = 'legacy';
    if (mode === 'trusted') trusted = false;
    if (mode === 'expiry') now = 300_000;
    if (mode === 'closed') f.details.invalidate();
    return true;
  };
  await assert.rejects(f.details.apply({ kind: 'profile.save', revision: f.initial.revision, patch: { name: 'New' } }, () => { if (!trusted) throw new Error(secret); }));
  assert.equal(writes(f.bridge).length, 0); f.dispose();
});

test('create only targets fresh known desktop Runners and never sends a chat message', async () => {
  const f = await setup({}, true);
  assert.equal(f.initial.canCreate, true); assert.equal(f.initial.bot, null);
  const result = await f.details.apply({ kind: 'agent.create', revision: f.initial.revision, profile: { name: 'New Agent', runnerId: 'runner-two' } });
  assert.equal(result.status, 'applied'); assert.equal(result.chatId, 'new-direct-chat');
  assert.equal(writes(f.bridge).length, 1); assert.equal(writes(f.bridge)[0].method, 'bots.create');
  assert.equal(writes(f.bridge)[0].params.runner_id, 'runner-two');
  for (const value of ['Offline Runner', '离线', '私聊', '完整访问权限', '不保证每次再次询问', '创建本身不发送消息']) assert.ok(f.prompts[0].detail.includes(value));
  f.dispose();
});

for (const runnerId of ['phone', 'tablet', 'unknown', 'missing']) test(`create rejects non-Runner ${runnerId} before confirmation or mutation`, async () => {
  const f = await setup({}, true);
  await assert.rejects(f.details.apply({ kind: 'agent.create', revision: f.initial.revision, profile: { name: 'New', runnerId } }));
  assert.equal(writes(f.bridge).length, 0); assert.equal(f.prompts.length, 0); f.dispose();
});

test('Runner reassignment rechecks OS after confirmation and displays exact original and destination scope', async () => {
  const f = await setup(); f.details.confirm = async (spec: Prompt) => { f.prompts.push(spec); f.bridge.bootstrap.devices[1].os = 'android'; return true; };
  await assert.rejects(f.details.apply({ kind: 'profile.save', revision: f.initial.revision, patch: { runnerId: 'runner-two' } }));
  for (const value of ['Local Runner', 'runner-one', 'Offline Runner', 'runner-two', '不会迁移', '记忆']) assert.ok(f.prompts[0].detail.includes(value));
  assert.equal(writes(f.bridge).length, 0); f.dispose();
});

test('memory DTO has complete text, correct short hash and budget flag without private path or metadata', async () => {
  const f = await setup(); f.bridge.memory = makeMemory('Long note\r\n'.repeat(220)); f.bridge.memory.index.truncated = true;
  const result = await f.details.getMemory({ revision: f.initial.revision });
  assert.equal(result.text, f.bridge.memory.index.text); assert.equal(result.hash.length, 32); assert.equal(result.truncated, true);
  assert.equal(JSON.stringify(result).includes(secret), false); assert.equal('path' in result, false);
  const again = await f.details.getMemory({ revision: f.initial.revision });
  assert.equal(result.version, again.version); assert.notEqual(result.revision, again.revision);
  const saved = await f.details.apply({ kind: 'memory.save', revision: again.revision, text: 'Updated\r\n', expectedHash: again.hash });
  assert.equal(saved.status, 'applied'); assert.deepEqual(writes(f.bridge)[0], { method: 'bots.memory.write', params: { bot_id: 'bot-one', text: 'Updated\r\n', expected_hash: again.hash } });
  for (const value of ['完整正文', f.bridge.memory.index.text, 'Updated\r\n', 'bot-one', 'runner-one', '所有聊天']) assert.ok(f.prompts[0].detail.includes(value)); f.dispose();
});

for (const invalid of ['oversized', 'bytes', 'hash', 'bot']) test(`memory ${invalid} response cannot create a save ticket`, async () => {
  const f = await setup();
  if (invalid === 'oversized') f.bridge.memory = makeMemory('字'.repeat(MAX_MEMORY_BYTES / 3 + 1));
  if (invalid === 'bytes') f.bridge.memory.index.bytes++;
  if (invalid === 'hash') f.bridge.memory.index.hash = 'a'.repeat(32);
  if (invalid === 'bot') f.bridge.memory.bot_id = 'bot-two';
  await assert.rejects(f.details.getMemory({ revision: f.initial.revision })); assert.equal(writes(f.bridge).length, 0); f.dispose();
});

test('memory writes require matching native hash, reject UTF-8 oversize, and preserve draft on stale content', async () => {
  assert.throws(() => validateAgentAction({ kind: 'memory.save', revision: 'r', text: '字'.repeat(100_000), expectedHash: 'a'.repeat(32) }), /256 KiB/);
  const f = await setup(); let loaded = await f.details.getMemory({ revision: f.initial.revision });
  await assert.rejects(f.details.apply({ kind: 'memory.save', revision: loaded.revision, text: 'New', expectedHash: 'a'.repeat(32) }), /未覆盖/);
  loaded = await f.details.getMemory({ revision: f.initial.revision });
  f.bridge.memory = makeMemory('Changed by another writer\n');
  await assert.rejects(f.details.apply({ kind: 'memory.save', revision: loaded.revision, text: 'New', expectedHash: loaded.hash }), /未覆盖/);
  assert.equal(writes(f.bridge).length, 0); f.dispose();
});

test('maximum-sized memory reviews retain full old and new text including both end sentinels', async () => {
  const bounded = (marker: string) => `${marker}_HEAD\n${'x'.repeat(MAX_MEMORY_BYTES - 2 * marker.length - 13)}\n${marker}_TAIL\n`;
  const f = await setup(); const oldText = bounded('OLD'), newText = bounded('NEW');
  assert.equal(Buffer.byteLength(oldText), MAX_MEMORY_BYTES); assert.equal(Buffer.byteLength(newText), MAX_MEMORY_BYTES);
  f.bridge.memory = makeMemory(oldText); f.bridge.memory.index.truncated = true;
  const loaded = await f.details.getMemory({ revision: f.initial.revision });
  const result = await f.details.apply({ kind: 'memory.save', revision: loaded.revision, text: newText, expectedHash: loaded.hash });
  assert.equal(result.status, 'applied'); assert.ok(f.prompts[0].detail.length > 500_000);
  assert.ok(f.prompts[0].detail.includes(oldText)); assert.ok(f.prompts[0].detail.includes(newText));
  assert.equal(writes(f.bridge)[0].params.text, newText); f.dispose();
});

test('memory content changes during confirmation fail without writing, and backend conflict is generic', async () => {
  const f = await setup(); const loaded = await f.details.getMemory({ revision: f.initial.revision });
  f.details.confirm = async () => { f.bridge.memory = makeMemory('Concurrent update\n'); return true; };
  await assert.rejects(f.details.apply({ kind: 'memory.save', revision: loaded.revision, text: 'New', expectedHash: loaded.hash }), /未覆盖/);
  assert.equal(writes(f.bridge).length, 0);
  f.details.confirm = async () => true;
  const next = await f.details.getMemory({ revision: f.initial.revision });
  f.bridge.handler = async (method, params) => { if (method === 'bots.memory.write') throw Object.assign(new Error('MEMORY.md changed since you opened it. Reload it and apply only your change.'), { code: 'LORCA_REMOTE_ERROR' }); return f.bridge.reply(method, params); };
  await assert.rejects(f.details.apply({ kind: 'memory.save', revision: next.revision, text: 'New', expectedHash: next.hash }), /未覆盖/);
  assert.equal(writes(f.bridge).length, 1); f.dispose();
});

test('pending memory reads cannot silently move to a newly assigned Runner', async () => {
  const f = await setup(); f.bridge.handler = async (method, params) => {
    if (method === 'bots.memory') { f.bridge.bootstrap.bots[0].runner_id = 'runner-two'; return structuredClone(f.bridge.memory); }
    return f.bridge.reply(method, params);
  };
  await assert.rejects(f.details.getMemory({ revision: f.initial.revision }), /资料已变化/);
  assert.equal(writes(f.bridge).length, 0); f.dispose();
});

test('write timeouts and post-dispatch account changes are unknown, consume tickets and never echo remote errors or retry', async () => {
  for (const outcome of ['timeout', 'account', 'malformed']) {
    const f = await setup();
    f.bridge.handler = async (method, params) => {
      if (method !== 'bots.update') return f.bridge.reply(method, params);
      if (outcome === 'timeout') throw new Error(secret);
      if (outcome === 'account') f.bridge.emit('event', { event: 'identity.changed', data: { has_identity: true } });
      return outcome === 'malformed' ? { private: secret } : f.bridge.reply(method, params);
    };
    const result = await f.details.apply({ kind: 'profile.save', revision: f.initial.revision, patch: { name: 'New' } });
    assert.deepEqual(result, { status: 'unknownOutcome', botId: 'bot-one' });
    await assert.rejects(f.details.apply({ kind: 'profile.save', revision: f.initial.revision, patch: { name: 'New' } }), /过期/);
    assert.equal(writes(f.bridge).length, 1); assert.equal(JSON.stringify(result).includes(secret), false); f.dispose();
  }
});

test('concurrent actions cannot create duplicate confirmations or requests', async () => {
  const waiting = deferred(); const f = await setup({ confirm: async () => waiting.promise });
  const first = f.details.apply({ kind: 'profile.save', revision: f.initial.revision, patch: { name: 'New' } });
  await assert.rejects(f.details.get({ botId: 'bot-two' }), /仍在进行/);
  waiting.resolve(true); assert.equal((await first).status, 'applied'); assert.equal(writes(f.bridge).length, 1); f.dispose();
});

test('confirmation escapes direction controls and warns for explicit compatibility mode without changing written text', async () => {
  const f = await setup(); f.bridge.status.authMode = 'legacy'; const fresh = await f.details.get({ botId: 'bot-one' });
  const name = 'Name\u202e\u061c\u200e';
  await f.details.apply({ kind: 'profile.save', revision: fresh.revision, patch: { name } });
  assert.ok(f.prompts[0].detail.includes('不校验令牌')); assert.equal(f.prompts[0].detail.includes('\u202e'), false); assert.ok(f.prompts[0].detail.includes('\\u202e'));
  assert.equal(writes(f.bridge)[0].params.name, name); f.dispose();
});

test('read failures never return arbitrary daemon strings', async () => {
  const f = await setup(); f.bridge.handler = async () => { throw new Error(secret); };
  await assert.rejects(f.details.getMemory({ revision: f.initial.revision }), error => error instanceof Error && error.message.includes('无法读取') && !error.message.includes(secret)); f.dispose();
});

function png(width: number, height: number, metadata?: string) {
  const chunk = (name: string, data: Buffer) => {
    const kind = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length);
    let value = 0xffffffff;
    for (const byte of Buffer.concat([kind, data])) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
    crc.writeUInt32BE((value ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, kind, data, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...(metadata ? [chunk('tEXt', Buffer.from(`Comment\0${metadata}`))] : []), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
type AvatarPreview = { title: string; botId: string; botName: string; previewDataUrl: string; width: number; height: number; size: number };
type TestImage = { isEmpty: () => boolean; getSize: () => { width: number; height: number }; crop: (value: { x: number; y: number; width: number; height: number }) => TestImage; resize: (value: { width: number; height: number; quality: string }) => TestImage; toPNG: () => Buffer };
async function avatarSetup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dots-avatar-fixture-'));
  const selected = path.join(directory, 'SYNTHETIC_PRIVATE_FILENAME.png'); await writeFile(selected, png(800, 600, secret));
  const previews: AvatarPreview[] = [], transforms: unknown[] = [];
  let decoded = 0;
  const nativeImage = { createFromBuffer: (bytes: Buffer): TestImage => {
    decoded++; let width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    const image: TestImage = { isEmpty: () => false, getSize: () => ({ width, height }),
      crop: value => { transforms.push(value); width = value.width; height = value.height; return image; },
      resize: value => { transforms.push(value); width = value.width; height = value.height; return image; }, toPNG: () => png(width, height) };
    return image;
  } };
  const f = await setup({ temporaryDirectory: directory, nativeImage, chooseAvatar: async (guard: () => void) => { guard(); return { canceled: false, filePaths: [selected] }; }, reviewAvatar: async (spec: AvatarPreview, guard: () => void) => { guard(); previews.push(spec); return true; } });
  return { ...f, directory, selected, previews, transforms, nativeImage, decoded: () => decoded, staged: async () => (await readdir(directory)).filter(name => name.startsWith('dots-agent-avatar-')), cleanup: async () => { await f.details.dispose(); f.inventory.dispose(); await rm(directory, { recursive: true, force: true }); } };
}

test('avatar replacement uses native-only picker and preview, reencodes a private PNG and uploads only after save and confirmation', async () => {
  const f = await avatarSetup(); let uploaded: Buffer | undefined; let stagedPath = '';
  try {
    assert.equal(f.initial.canEditAvatar, true);
    f.bridge.handler = async (method, params) => {
      if (method === 'bots.update') {
        assert.equal(f.previews.length, 1); assert.equal(f.prompts.length, 1);
        const avatar = params.avatar as { path: string; name: string; mime: string; width: number; height: number };
        stagedPath = avatar.path; assert.notEqual(stagedPath, f.selected); assert.equal(avatar.name, 'avatar.png'); assert.equal(avatar.mime, 'image/png');
        assert.equal(avatar.width, 512); assert.equal(avatar.height, 512);
        uploaded = await readFile(stagedPath);
        assert.equal((await stat(stagedPath)).mode & 0o777, 0o600); assert.equal((await stat(path.dirname(stagedPath))).mode & 0o777, 0o700);
      }
      return f.bridge.reply(method, params);
    };
    const result = await f.details.apply({ kind: 'avatar.replace', revision: f.initial.revision });
    assert.deepEqual(result, { status: 'applied', botId: 'bot-one' }); assert.ok(uploaded); assert.deepEqual(uploaded, png(512, 512));
    assert.deepEqual(f.transforms, [{ x: 100, y: 0, width: 600, height: 600 }, { width: 512, height: 512, quality: 'good' }]);
    assert.equal(f.previews[0].previewDataUrl, `data:image/png;base64,${uploaded.toString('base64')}`);
    for (const value of [JSON.stringify(result), JSON.stringify(f.previews), JSON.stringify(f.prompts)]) { assert.equal(value.includes(f.selected), false); assert.equal(value.includes('SYNTHETIC_PRIVATE_FILENAME'), false); assert.equal(value.includes(secret), false); }
    for (const value of ['bot-one', '所有使用此智能体', '配对设备', '先上传图片再更新资料', '无法承诺整体回滚']) assert.ok(f.prompts[0].detail.includes(value));
    await assert.rejects(stat(stagedPath), { code: 'ENOENT' }); assert.deepEqual(await f.staged(), []); assert.equal(f.details.getCleanupWarning(), null);
    assert.equal(writes(f.bridge).length, 1);
  } finally { await f.cleanup(); }
});

test('avatar schema exposes no path, bytes, upload ID or preview input', () => {
  for (const key of ['path', 'bytes', 'id', 'previewDataUrl', 'avatar']) assert.throws(() => validateAgentAction({ kind: 'avatar.replace', revision: 'r', [key]: secret }));
  assert.deepEqual(validateAgentAction({ kind: 'avatar.remove', revision: 'r' }), { kind: 'avatar.remove', revision: 'r' });
});

for (const phase of ['picker', 'preview', 'confirmation']) test(`avatar cancellation during ${phase} never uploads and clears every staged file`, async () => {
  const f = await avatarSetup();
  try {
    if (phase === 'picker') f.details.chooseAvatar = async () => ({ canceled: true, filePaths: [] });
    if (phase === 'preview') f.details.reviewAvatar = async () => false;
    if (phase === 'confirmation') f.details.confirm = async () => false;
    assert.deepEqual(await f.details.apply({ kind: 'avatar.replace', revision: f.initial.revision }), { status: 'cancelled', botId: 'bot-one' });
    assert.equal(writes(f.bridge).length, 0); assert.deepEqual(await f.staged(), []);
  } finally { await f.cleanup(); }
});

test('no avatar mutation happens while the user is inspecting the isolated preview', async () => {
  const f = await avatarSetup(), shown = deferred(), choice = deferred();
  try {
    f.details.reviewAvatar = async (spec: AvatarPreview) => { shown.resolve(spec); return choice.promise; };
    const saving = f.details.apply({ kind: 'avatar.replace', revision: f.initial.revision });
    await shown.promise;
    assert.equal(writes(f.bridge).length, 0); assert.equal(f.prompts.length, 0); assert.equal((await f.staged()).length, 1);
    choice.resolve(false); assert.equal((await saving).status, 'cancelled'); assert.deepEqual(await f.staged(), []);
  } finally { choice.resolve(false); await f.cleanup(); }
});

for (const phase of ['picker', 'preview', 'confirmation']) test(`avatar ${phase} await rechecks identity, target and source before upload`, async () => {
  const f = await avatarSetup();
  try {
    if (phase === 'picker') f.details.chooseAvatar = async () => { f.bridge.emit('event', { event: 'identity.changed', data: { has_identity: true } }); return { canceled: false, filePaths: [f.selected] }; };
    if (phase === 'preview') f.details.reviewAvatar = async () => { f.details.invalidate(); return true; };
    if (phase === 'confirmation') f.details.confirm = async () => { f.bridge.bootstrap.bots[0].name = 'Renamed elsewhere'; return true; };
    await assert.rejects(f.details.apply({ kind: 'avatar.replace', revision: f.initial.revision }));
    assert.equal(writes(f.bridge).length, 0); assert.deepEqual(await f.staged(), []);
  } finally { await f.cleanup(); }
});

for (const invalid of ['svg', 'oversized', 'dimensions', 'decoder']) test(`avatar ${invalid} input cannot get a native preview or upload`, async () => {
  const f = await avatarSetup();
  try {
    if (invalid === 'svg') await writeFile(f.selected, '<svg xmlns="http://www.w3.org/2000/svg"><script>SECRET</script></svg>');
    if (invalid === 'oversized') await truncate(f.selected, 4 * 1024 * 1024 + 1);
    if (invalid === 'dimensions') await writeFile(f.selected, png(3000, 1));
    if (invalid === 'decoder') f.details.nativeImage = { createFromBuffer: () => ({ isEmpty: () => true }) };
    await assert.rejects(f.details.apply({ kind: 'avatar.replace', revision: f.initial.revision }), error => error instanceof Error && error.message.includes('4 MiB') && !error.message.includes(f.selected));
    assert.equal(f.previews.length, 0); assert.equal(writes(f.bridge).length, 0); assert.deepEqual(await f.staged(), []);
    if (invalid !== 'decoder') assert.equal(f.decoded(), 0);
  } finally { await f.cleanup(); }
});

test('avatar picker final symlinks cannot grant their target bytes', { skip: process.platform === 'win32' }, async () => {
  const f = await avatarSetup();
  try {
    const alias = path.join(f.directory, 'selected-alias.png'); await symlink(f.selected, alias);
    f.details.chooseAvatar = async () => ({ canceled: false, filePaths: [alias] });
    await assert.rejects(f.details.apply({ kind: 'avatar.replace', revision: f.initial.revision }), /4 MiB/);
    assert.equal(f.decoded(), 0); assert.equal(writes(f.bridge).length, 0);
  } finally { await f.cleanup(); }
});

test('avatar source hardlinks are refused before decoding or staging', async () => {
  const f = await avatarSetup();
  try {
    await link(f.selected, path.join(f.directory, 'hardlink.png'));
    await assert.rejects(f.details.apply({ kind: 'avatar.replace', revision: f.initial.revision }), /4 MiB/);
    assert.equal(f.decoded(), 0); assert.equal(writes(f.bridge).length, 0); assert.deepEqual(await f.staged(), []);
  } finally { await f.cleanup(); }
});

test('avatar source mutation after opening its file descriptor is detected before preview', async () => {
  const f = await avatarSetup(); const originalOpen = nativeFs.open; let changed = false;
  try {
    const selected = await realpath(f.selected);
    nativeFs.open = async (...args: Parameters<typeof nativeFs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] !== selected) return handle;
      return new Proxy(handle, { get(target, key) {
        if (key === 'read') return async (...readArgs: unknown[]) => {
          if (!changed) { changed = true; await writeFile(f.selected, png(800, 600, `${secret} changed during read`)); }
          return Reflect.apply(target.read, target, readArgs);
        };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    await assert.rejects(f.details.apply({ kind: 'avatar.replace', revision: f.initial.revision }), /4 MiB/);
    assert.equal(changed, true); assert.equal(f.decoded(), 0); assert.equal(f.previews.length, 0); assert.equal(writes(f.bridge).length, 0);
  } finally { nativeFs.open = originalOpen; await f.cleanup(); }
});

test('a staged avatar replaced during isolated review cannot differ from the pixels the user approved', async () => {
  const f = await avatarSetup();
  try {
    f.details.reviewAvatar = async () => { const [directory] = await f.staged(); await writeFile(path.join(f.directory, directory, 'avatar.png'), png(256, 256)); return true; };
    await assert.rejects(f.details.apply({ kind: 'avatar.replace', revision: f.initial.revision }), /4 MiB/);
    assert.equal(writes(f.bridge).length, 0); assert.deepEqual(await f.staged(), []);
  } finally { await f.cleanup(); }
});

test('target changes during final staged-file verification are rejected by the following fresh snapshot', async () => {
  const f = await avatarSetup();
  try {
    const verify = f.details.verifyAvatar.bind(f.details);
    f.details.verifyAvatar = async (...args: unknown[]) => { await verify(...args); f.bridge.bootstrap.bots[0].description = 'Changed during file verification'; };
    await assert.rejects(f.details.apply({ kind: 'avatar.replace', revision: f.initial.revision }), /资料已变化/);
    assert.equal(writes(f.bridge).length, 0); assert.deepEqual(await f.staged(), []);
  } finally { await f.cleanup(); }
});

test('avatar removal confirms account-wide scope and sends only avatar:null without picker or preview', async () => {
  const f = await avatarSetup();
  try {
    f.details.chooseAvatar = async () => { assert.fail('removal must not open a file picker'); };
    assert.deepEqual(await f.details.apply({ kind: 'avatar.remove', revision: f.initial.revision }), { status: 'applied', botId: 'bot-one' });
    assert.deepEqual(writes(f.bridge), [{ method: 'bots.update', params: { id: 'bot-one', avatar: null } }]);
    assert.match(f.prompts[0].detail, /移除.*自定义头像/); assert.match(f.prompts[0].detail, /恢复图标与颜色/); assert.equal(f.previews.length, 0);
  } finally { await f.cleanup(); }
});

for (const outcome of ['ack', 'unknown']) test(`avatar cleanup failure cannot replace the ${outcome} result and cleanup remains retryable`, async () => {
  const f = await avatarSetup(); const originalRm = nativeFs.rm;
  try {
    f.bridge.handler = async (method, params) => {
      if (method === 'bots.update') {
        nativeFs.rm = async () => { throw new Error(secret); };
        if (outcome === 'unknown') throw new Error(secret);
      }
      return f.bridge.reply(method, params);
    };
    const result = await f.details.apply({ kind: 'avatar.replace', revision: f.initial.revision });
    assert.equal(result.status, outcome === 'ack' ? 'applied' : 'unknownOutcome'); assert.equal(writes(f.bridge).length, 1);
    assert.equal(JSON.stringify(result).includes(secret), false); assert.match(f.details.getCleanupWarning(), /尚未清理/); assert.equal((await f.staged()).length, 1);
    nativeFs.rm = originalRm; await f.details.cleanupAvatars(); assert.deepEqual(await f.staged(), []); assert.equal(f.details.getCleanupWarning(), null);
    await assert.rejects(f.details.apply({ kind: 'avatar.replace', revision: f.initial.revision }), /过期/);
  } finally { nativeFs.rm = originalRm; await f.cleanup(); }
});

test('dispose invalidates pending avatar upload, waits for settlement, then removes private staging without retrying', async () => {
  const f = await avatarSetup(), submitted = deferred(), response = deferred();
  try {
    f.bridge.handler = async (method, params) => { if (method === 'bots.update') { submitted.resolve(null); return response.promise; } return f.bridge.reply(method, params); };
    const operation = f.details.apply({ kind: 'avatar.replace', revision: f.initial.revision }); await submitted.promise;
    let disposed = false; const shutdown = f.details.dispose().then(() => { disposed = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(disposed, false); assert.equal((await f.staged()).length, 1);
    response.resolve({ bot: { id: 'bot-one' } }); assert.equal((await operation).status, 'unknownOutcome'); await shutdown;
    assert.deepEqual(await f.staged(), []); assert.equal(writes(f.bridge).length, 1);
  } finally { response.resolve({ bot: { id: 'bot-one' } }); await f.cleanup(); }
});
