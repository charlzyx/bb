import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import type { BridgeStatus, LorcaBridge } from '../src/core/bridge';
import { LorcaController } from '../src/core/controller';
import { demoRuntimeSettings } from '../src/core/demo';
import { parseEvent, parseSnapshot } from '../src/core/protocol';
import { applyEvent, applySnapshot, emptyModel } from '../src/core/store';
const require = createRequire(import.meta.url);
const { sanitizeRendererEvent, sanitizeRendererResult } = require('../native/settings.cjs');
const secret = 'SYNTHETIC_DEVICE_PRIVATE_FIELDS';
const tick = () => new Promise(resolve => setImmediate(resolve));
const bot = (id: string, runner_id = 'runner-a') => ({ id, name: id, runner_id });
const device = (id: string, name = id, status = 'online') => ({ id, name, status, machine_key: secret, detail: secret, url: secret, plugins: [{ env: { KEY: secret } }] });
const snapshot = () => ({
  version: 'synthetic', has_identity: true, identity_id: 'account-one', relay_connected: false,
  devices: [device('runner-a', 'Actual Mac'), device('runner-b', 'Remote PC', 'offline')],
  bots: [bot('bot-a'), bot('bot-b', 'runner-b')],
  chats: [{ id: 'chat', kind: 'group', title: 'Chat', bot_ids: ['bot-a', 'bot-b'], created_at: 1, has_more: false, messages: [] }],
  running_turns: [], running_chat_ids: [],
});

class RunnerBridge implements LorcaBridge {
  status: BridgeStatus = { status: 'connected', authMode: 'token', generation: 1, endpoint: 'ws://127.0.0.1:4862/ws' };
  source = snapshot();
  calls: { method: string; params: unknown }[] = [];
  settingsCalls: unknown[] = [];
  listeners = new Set<(value: unknown) => void>();
  statusListeners = new Set<(value: BridgeStatus) => void>();
  getStatus = async () => this.status;
  connect = async () => this.status;
  request = async (method: string, params: unknown) => { this.calls.push({ method, params }); assert.equal(method, 'bootstrap'); return sanitizeRendererResult('bootstrap', structuredClone(this.source)); };
  getSettings = async (params: unknown) => { this.settingsCalls.push(params); return structuredClone(demoRuntimeSettings); };
  onEvent = (listener: (value: unknown) => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  onStatus = (listener: (value: BridgeStatus) => void) => { this.statusListeners.add(listener); return () => { this.statusListeners.delete(listener); }; };
  event(value: unknown) { const projected = sanitizeRendererEvent(value); for (const listener of this.listeners) listener(projected); }
  offline() { this.status = { ...this.status, status: 'disconnected' }; for (const listener of this.statusListeners) listener(this.status); }
}
async function setup() { const bridge = new RunnerBridge(), controller = new LorcaController(bridge); await controller.start(); await tick(); controller.actions.onSelectConversation('chat'); return { bridge, controller }; }

test('device projection only crosses bounded id, name and online fields for snapshot and roster', () => {
  const raw = snapshot();
  const projected = sanitizeRendererResult('bootstrap', raw);
  assert.deepEqual(projected.devices, [{ id: 'runner-a', name: 'Actual Mac', online: true }, { id: 'runner-b', name: 'Remote PC', online: false }]);
  assert.equal(JSON.stringify(projected).includes(secret), false);
  assert.deepEqual(parseSnapshot(projected), parseSnapshot(raw));
  const event = sanitizeRendererEvent({ event: 'roster.changed', data: raw });
  assert.deepEqual(event.data.devices, projected.devices); assert.equal(JSON.stringify(event).includes(secret), false);
  assert.deepEqual(parseEvent(event), parseEvent({ event: 'roster.changed', data: raw }));
  const absent = { ...raw, devices: undefined };
  assert.deepEqual(sanitizeRendererResult('bootstrap', absent).devices, []);
  assert.equal(Object.hasOwn(sanitizeRendererEvent({ event: 'roster.changed', data: absent }).data, 'devices'), false);
});

test('device boundaries reject malformed, duplicated, unbounded or sparse records without copying unknown fields', () => {
  const raw = snapshot();
  for (const devices of [null, {}, new Array(1), [device('same'), device('same')], [device('')], [device('x', 'x'.repeat(257))], [device('x', 'name', 'unknown')], Array.from({ length: 129 }, (_, index) => device(String(index)))]) assert.throws(() => sanitizeRendererResult('bootstrap', { ...raw, devices }));
  for (const devices of [null, new Array(1), [{ id: 'x', name: 'Device', online: 'yes' }], [{ id: 'x', name: 'Device' }], [{ id: '', name: 'Device', online: true }], [{ id: 'x', name: 'x'.repeat(257), online: true }], [{ id: 'x', name: 'Device', online: true }, { id: 'x', name: 'Other', online: false }]]) assert.throws(() => parseSnapshot({ ...raw, devices }));
  assert.deepEqual(parseSnapshot({ ...raw, devices: undefined }).devices, []);
});

test('device state replaces on authoritative snapshots and present rosters, preserves omitted roster fields and clears on identity change', () => {
  const raw = snapshot(); let model = applySnapshot(emptyModel(), parseSnapshot(raw));
  model = applyEvent(model, parseEvent({ event: 'roster.changed', data: { bots: raw.bots, chats: raw.chats } }));
  assert.equal(model.devices.get('runner-a')?.name, 'Actual Mac');
  model = applyEvent(model, parseEvent({ event: 'roster.changed', data: { ...raw, devices: [device('runner-b', 'Renamed PC', 'online')] } }));
  assert.equal(model.devices.has('runner-a'), false); assert.equal(model.devices.get('runner-b')?.online, true);
  model = applyEvent(model, parseEvent({ event: 'identity.changed', data: { has_identity: true } })); assert.equal(model.devices.size, 0);
  model = applySnapshot(model, parseSnapshot(raw));
  model = applySnapshot(model, parseSnapshot({ ...raw, devices: undefined })); assert.equal(model.devices.size, 0);
});

test('composer summary uses every current chat bot and backend device status without extra requests', async () => {
  const { bridge, controller } = await setup();
  try {
    assert.deepEqual(controller.getSnapshot().runnerSummary, { kind: 'multiple' });
    bridge.source.bots[1].runner_id = 'runner-a'; bridge.event({ event: 'roster.changed', data: bridge.source });
    assert.deepEqual(controller.getSnapshot().runnerSummary, { kind: 'single', device: { id: 'runner-a', name: 'Actual Mac', online: true } });
    bridge.source.devices[0].status = 'offline'; bridge.event({ event: 'roster.changed', data: bridge.source });
    assert.deepEqual(controller.getSnapshot().runnerSummary, { kind: 'single', device: { id: 'runner-a', name: 'Actual Mac', online: false } });
    controller.actions.onSelectAgent('bot-b');
    assert.equal(controller.getSnapshot().runnerSummary?.kind, 'single');
    assert.deepEqual(bridge.calls.map(call => call.method), ['bootstrap']); assert.deepEqual(bridge.settingsCalls, []);
  } finally { controller.dispose(); }
});

test('new chat summary uses the selected bot and never follows the settings inspection scope', async () => {
  const { bridge, controller } = await setup();
  try {
    controller.actions.onNewConversation(); controller.actions.onSelectAgent('bot-b');
    const expected = { kind: 'single', device: { id: 'runner-b', name: 'Remote PC', online: false } };
    assert.deepEqual(controller.getSnapshot().runnerSummary, expected);
    controller.actions.onRefreshSettings('unrelated-inspection-runner'); await tick();
    assert.deepEqual(controller.getSnapshot().runnerSummary, expected);
    controller.actions.onSelectAgent('bot-a');
    assert.deepEqual(controller.getSnapshot().runnerSummary, { kind: 'single', device: { id: 'runner-a', name: 'Actual Mac', online: true } });
    assert.equal(bridge.calls.length, 1); assert.equal(bridge.settingsCalls.length, 1);
  } finally { controller.dispose(); }
});

test('unknown or partially unassigned groups never masquerade as a known single device', async () => {
  for (const scenario of ['missing-bot', 'missing-device', 'blank-name', 'one-empty', 'all-empty']) {
    const { bridge, controller } = await setup();
    try {
      if (scenario === 'missing-bot') bridge.source.bots.pop();
      if (scenario === 'missing-device') bridge.source.devices.pop();
      if (scenario === 'blank-name') bridge.source.devices[1].name = '';
      if (scenario === 'one-empty') bridge.source.bots[1].runner_id = '';
      if (scenario === 'all-empty') for (const bot of bridge.source.bots) bot.runner_id = '';
      bridge.event({ event: 'roster.changed', data: bridge.source });
      assert.deepEqual(controller.getSnapshot().runnerSummary, { kind: scenario === 'all-empty' ? 'unassigned' : 'unknown' }, scenario);
      assert.equal(bridge.calls.length, 1);
    } finally { controller.dispose(); }
  }
});

test('explicit empty single assignments show unassigned and disconnected snapshots never claim live runner status', async () => {
  const { bridge, controller } = await setup();
  try {
    controller.actions.onNewConversation(); controller.actions.onSelectAgent('bot-a');
    bridge.source.bots[0].runner_id = ''; bridge.event({ event: 'roster.changed', data: bridge.source });
    assert.deepEqual(controller.getSnapshot().runnerSummary, { kind: 'unassigned' });
    bridge.offline(); assert.deepEqual(controller.getSnapshot().runnerSummary, { kind: 'unknown' });
    assert.equal(bridge.calls.length, 1);
  } finally { controller.dispose(); }
});
