import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const privateMarker = 'SYNTHETIC_INSPECTOR_PRIVATE_METADATA';
export const memoryStart = 'SYNTHETIC_MEMORY_START';
export const memoryEnd = 'SYNTHETIC_MEMORY_END';
export const editedMemoryEnd = 'SYNTHETIC_EDITED_MEMORY_END';
export const initialMemory = `${memoryStart}\n${'a'.repeat(255_000)}\n${memoryEnd}\n`;
export const editedMemory = `${memoryStart}\n${'b'.repeat(255_000)}\n${editedMemoryEnd}\n`;
export const memoryHash = text => createHash('sha256').update(text).digest('hex').slice(0, 32);

export function createInspectorFixture(home) {
  const bot = { id: 'bot-inspector', name: 'Synthetic Inspector Agent', description: 'Synthetic inspector fixture only.', symbol_name: 'sparkles', accent: 'teal', runner_id: 'runner-inspector', provider: 'deepseek', model: 'synthetic-model', thinking: '', instructions: privateMarker, workdir: privateMarker, permissions: { connections: {}, filesystem: 'none', shell: false, drafts: false } };
  const routine = { id: 'routine-inspector', bot_id: bot.id, name: 'Synthetic paused routine', prompt: 'Synthetic routine request; the mock never calls a model.', schedule: 'every 1h', schedule_text: 'Every hour', timezone: 'UTC', missed_run_policy: 'coalesce', is_enabled: false, is_running: false, state: 'paused', next_run_at: null, last_run_at: null, last_outcome: null, paused_reason: null, feedback_authorization_prompt: privateMarker };
  const snapshot = {
    version: 'synthetic-inspector', has_identity: true, is_identity_device: true, identity_id: 'synthetic-inspector-account', this_device_id: 'runner-inspector', relay_connected: false, relay_url: 'https://synthetic.example.invalid/', relay_update_required: false,
    bots: [bot], chats: [{ id: 'chat-inspector', kind: 'dm', title: null, bot_ids: [bot.id], created_at: 1791561600, messages: [], has_more: false }], running_turns: [], running_chat_ids: [], routines: [routine],
    devices: [{ id: 'runner-inspector', name: 'Synthetic Inspector Runner', os: 'linux', status: 'online', is_this_device: true, version: 'synthetic', plugins: [], machine_key: privateMarker }],
    providers: [{ kind: 'deepseek', name: 'Synthetic Provider', is_connected: true, detail: privateMarker, base_url: privateMarker }], models: [{ provider: 'deepseek', id: 'synthetic-model', name: 'Synthetic Model', levels: [] }], auto_review: { is_enabled: false, rules: [] }, shared_links: [{ url: `https://synthetic.example.invalid/#${privateMarker}` }],
  };
  let memory = initialMemory;
  const requests = [], uploadedAvatars = [];
  async function dispatch(method, params) {
    requests.push({ method, params: structuredClone(params) });
    if (method === 'bootstrap') return structuredClone(snapshot);
    if (method === 'ui.watching' || method === 'chats.mark_read') return null;
    if (method === 'chats.messages') return { messages: [], has_more: false };
    if (method === 'mcp.list') return { path: privateMarker, error: null, servers: [] };
    if (method === 'bots.permissions') { assert.equal(params.id, bot.id); return { connections: [{ id: 'plugin-inspector', name: 'Synthetic Plugin', tools: [{ name: 'synthetic_read', title: 'Synthetic Read', description: privateMarker, read_only: true, hidden: false, capability: 'read' }], config: privateMarker }] }; }
    if (method === 'bots.memory') {
      assert.equal(params.bot_id, bot.id);
      return { bot_id: bot.id, here: true, path: `/synthetic/${privateMarker}`, index: { text: memory, hash: memoryHash(memory), bytes: Buffer.byteLength(memory), lines: memory.split('\n').length - 1, truncated: true, max_lines: 200, max_bytes: 24000 }, topics: ['synthetic-topic.md'], logs: ['2026-10-10'] };
    }
    if (method === 'bots.memory.write') {
      assert.equal(params.bot_id, bot.id); assert.equal(params.expected_hash, memoryHash(memory));
      assert.equal(params.text, editedMemory); memory = params.text;
      return { hash: memoryHash(memory) };
    }
    if (method === 'bots.update') {
      assert.equal(params.id, bot.id); assert.deepEqual(Object.keys(params).sort(), ['avatar', 'id']);
      const avatar = params.avatar;
      assert.equal(avatar.name, 'avatar.png'); assert.equal(avatar.mime, 'image/png'); assert.equal(avatar.width, avatar.height); assert.ok(avatar.width <= 512);
      assert.match(avatar.id, /^att-[a-f0-9]{32}$/); assert.equal(path.basename(avatar.path), 'avatar.png'); assert.match(path.basename(path.dirname(avatar.path)), /^dots-agent-avatar-/);
      const bytes = await readFile(avatar.path);
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.equal(bytes.includes(Buffer.from(privateMarker)), false);
      uploadedAvatars.push({ path: avatar.path, bytes: Buffer.from(bytes) });
      await mkdir(path.join(home, 'files'), { recursive: true }); await writeFile(path.join(home, 'files', avatar.id), bytes);
      bot.avatar = { id: avatar.id, name: avatar.name, mime: avatar.mime, size: bytes.length, width: avatar.width, height: avatar.height };
      return { bot: structuredClone(bot) };
    }
    if (method === 'routines.run') { assert.deepEqual(params, { id: routine.id }); return null; }
    throw new Error(`Unexpected synthetic inspector method: ${method}`);
  }
  return { snapshot, requests, uploadedAvatars, dispatch, getMemory: () => memory };
}
