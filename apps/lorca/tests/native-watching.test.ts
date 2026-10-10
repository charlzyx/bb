import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { WatchingChat } = require('../native/watching.cjs');
const { validateRequest } = require('../native/bridge.cjs');
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Bridge extends EventEmitter {
  status = { status: 'connected', generation: 1 };
  calls: { method: string; params: { chat_id: string | null } }[] = [];
  handler: (method: string, params: { chat_id: string | null }) => Promise<unknown> = async () => null;
  getStatus() { return { ...this.status }; }
  sendValidated(method: string, params: { chat_id: string | null }) { this.calls.push({ method, params }); return this.handler(method, params); }
  connection(status: string, generation: number) { this.status = { status, generation }; this.emit('status', this.getStatus()); }
}
function fixture(context: { after: (callback: () => void) => void }) {
  const bridge = new Bridge();
  const watching = new WatchingChat(bridge);
  const snapshot = (identity = 'account-a') => ({ has_identity: true, identity_id: identity, chats: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
  watching.observeSnapshot(snapshot());
  context.after(() => watching.dispose());
  return { bridge, watching, snapshot };
}
const call = (method: string, id: string | null) => ({ method, params: { chat_id: id } });

test('watching starts only for a known selected foreground chat and never clears an unowned global slot', async context => {
  const { bridge, watching } = fixture(context);
  watching.select(null); watching.setForeground(true); watching.setForeground(false);
  await tick(); assert.deepEqual(bridge.calls, []);
  watching.select('a'); await tick(); assert.deepEqual(bridge.calls, []);
  watching.setForeground(true); await tick();
  assert.deepEqual(bridge.calls, [call('ui.watching', 'a'), call('chats.mark_read', 'a')]);
  watching.select('a'); watching.setForeground(true); await tick(); assert.equal(bridge.calls.length, 2);
  watching.setForeground(false); await tick();
  assert.deepEqual(bridge.calls.at(-1), call('ui.watching', null));
  watching.setForeground(true); await tick();
  assert.deepEqual(bridge.calls.slice(-2), [call('ui.watching', 'a'), call('chats.mark_read', 'a')]);
});

test('watch intent rejects malformed or unknown IDs and is not exposed through generic renderer RPC', context => {
  const { bridge, watching } = fixture(context);
  for (const id of [undefined, {}, 0, '', ' ', 'a\0', 'x'.repeat(201), 'unknown']) assert.throws(() => watching.select(id));
  for (const method of ['ui.watching', 'chats.mark_read']) assert.throws(() => validateRequest(method, { chat_id: 'a' }));
  watching.observeChats([{ id: 'evil\0id' }]); assert.throws(() => watching.select('a'));
  assert.deepEqual(bridge.calls, []);
});

test('watch changes are single flight and coalesce to the latest chat before any read acknowledgement', async context => {
  const { bridge, watching } = fixture(context); const pending = deferred();
  bridge.handler = async (_method, params) => params.chat_id === 'a' ? pending.promise : null;
  watching.setForeground(true); watching.select('a'); await tick(); watching.select('b'); watching.select('c');
  assert.deepEqual(bridge.calls, [call('ui.watching', 'a')]);
  pending.resolve(null); await tick();
  assert.deepEqual(bridge.calls, [call('ui.watching', 'a'), call('ui.watching', 'c'), call('chats.mark_read', 'c')]);
});

test('blur during a pending watch clears only after its successful ACK and never marks the hidden chat read', async context => {
  const { bridge, watching } = fixture(context); const pending = deferred();
  bridge.handler = async (_method, params) => params.chat_id === 'a' ? pending.promise : null;
  watching.setForeground(true); watching.select('a'); await tick(); watching.setForeground(false);
  assert.equal(bridge.calls.length, 1); pending.resolve(null); await tick();
  assert.deepEqual(bridge.calls, [call('ui.watching', 'a'), call('ui.watching', null)]);
});

test('a slow mark-read response never blocks blur from clearing the watch slot', async context => {
  const { bridge, watching } = fixture(context); const pending = deferred();
  bridge.handler = async method => method === 'chats.mark_read' ? pending.promise : null;
  watching.setForeground(true); watching.select('a'); await tick();
  watching.setForeground(false); await tick();
  assert.deepEqual(bridge.calls, [call('ui.watching', 'a'), call('chats.mark_read', 'a'), call('ui.watching', null)]);
  pending.reject(new Error('Synthetic read timeout')); await tick(); assert.equal(bridge.calls.length, 3);
});

test('a first unknown watch outcome gets one bounded clear without retrying the positive watch', async context => {
  const { bridge, watching } = fixture(context);
  bridge.handler = async () => { throw new Error('Synthetic unknown outcome'); };
  watching.setForeground(true); watching.select('a'); await tick();
  watching.select('a'); await tick();
  assert.deepEqual(bridge.calls, [call('ui.watching', 'a'), call('ui.watching', null)]);
  await tick(); assert.equal(bridge.calls.length, 2);
});

test('blur while an unacknowledged watch times out still compensates once with null', async context => {
  const { bridge, watching } = fixture(context); const pending = deferred();
  bridge.handler = async (_method, params) => params.chat_id === 'a' ? pending.promise : null;
  watching.setForeground(true); watching.select('a'); await tick(); watching.setForeground(false);
  pending.reject(new Error('Synthetic missing ACK')); await tick();
  assert.deepEqual(bridge.calls, [call('ui.watching', 'a'), call('ui.watching', null)]);
});

test('a failed later watch may clear only the slot previously claimed successfully in this connection', async context => {
  const { bridge, watching } = fixture(context);
  watching.setForeground(true); watching.select('a'); await tick();
  bridge.handler = async (_method, params) => { if (params.chat_id === 'b') throw new Error('Synthetic failure'); return null; };
  watching.select('b'); await tick();
  assert.deepEqual(bridge.calls.slice(-2), [call('ui.watching', 'b'), call('ui.watching', null)]);
  assert.equal(bridge.calls.some(item => item.method === 'chats.mark_read' && item.params.chat_id === 'b'), false);
});

test('reconnect forgets ownership and known chats, and a stale ACK cannot mark an old chat read', async context => {
  const { bridge, watching, snapshot } = fixture(context); const pending = deferred();
  bridge.handler = async (_method, params) => params.chat_id === 'a' ? pending.promise : null;
  watching.setForeground(true); watching.select('a'); await tick();
  bridge.connection('disconnected', 2); bridge.connection('connected', 3);
  assert.throws(() => watching.select('b'));
  watching.observeSnapshot(snapshot()); watching.select('b');
  pending.resolve(null); await tick();
  assert.deepEqual(bridge.calls, [call('ui.watching', 'a'), call('ui.watching', 'b'), call('chats.mark_read', 'b')]);
});

for (const boundary of ['connection', 'account']) test(`a stale failed watch never compensates by clearing the newer ${boundary} target`, async context => {
  const { bridge, watching, snapshot } = fixture(context); const pending = deferred();
  bridge.handler = async (_method, params) => params.chat_id === 'a' ? pending.promise : null;
  watching.setForeground(true); watching.select('a'); await tick();
  if (boundary === 'connection') { bridge.connection('disconnected', 2); bridge.connection('connected', 3); }
  watching.observeSnapshot(snapshot('replacement-account')); watching.select('b');
  pending.reject(new Error('Synthetic stale watch timeout')); await tick();
  assert.deepEqual(bridge.calls, [call('ui.watching', 'a'), call('ui.watching', 'b'), call('chats.mark_read', 'b')]);
});

for (const change of ['event', 'snapshot']) test(`account changes through ${change} clear selection and fence pending reads`, async context => {
  const { bridge, watching, snapshot } = fixture(context); const pending = deferred();
  bridge.handler = async (_method, params) => params.chat_id === 'a' ? pending.promise : null;
  watching.setForeground(true); watching.select('a'); await tick();
  if (change === 'event') bridge.emit('event', { event: 'identity.changed' });
  else watching.observeSnapshot(snapshot('account-b'));
  pending.resolve(null); await tick();
  assert.deepEqual(bridge.calls, [call('ui.watching', 'a'), call('ui.watching', null)]);
  if (change === 'event') assert.throws(() => watching.select('b'));
});

test('removing a visible chat clears the watch, while validated created chats can be selected', async context => {
  const { bridge, watching } = fixture(context);
  watching.setForeground(true); watching.select('a'); await tick();
  watching.observeChats([{ id: 'b' }]); await tick();
  assert.deepEqual(bridge.calls.at(-1), call('ui.watching', null)); assert.throws(() => watching.select('a'));
  watching.observeCreated({ id: 'new-chat' }); watching.select('new-chat'); await tick();
  assert.deepEqual(bridge.calls.slice(-2), [call('ui.watching', 'new-chat'), call('chats.mark_read', 'new-chat')]);
  watching.removeChat('new-chat'); await tick(); assert.deepEqual(bridge.calls.at(-1), call('ui.watching', null));
});

test('disposing watching removes listeners and a late acknowledgement cannot enqueue more RPCs', async context => {
  const { bridge, watching } = fixture(context); const pending = deferred();
  bridge.handler = async () => pending.promise;
  watching.setForeground(true); watching.select('a'); await tick(); watching.dispose();
  assert.equal(bridge.listenerCount('event'), 0); assert.equal(bridge.listenerCount('status'), 0);
  pending.resolve(null); await tick(); assert.equal(bridge.calls.length, 1);
  watching.select(null); assert.throws(() => watching.select('a'));
});
