import assert from "node:assert/strict";
import { test } from "node:test";
import { LorcaController } from "../src/core/controller";
import { demoSnapshot } from "../src/core/demo";
import type { BridgeStatus, LorcaBridge } from "../src/core/bridge";
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const row = (id: string, chatId = "chat-demo") => ({ id, chat_id: chatId, author: { kind: "you" }, body: { kind: "text", text: id }, state: { kind: "complete" }, created_at: 1 });
class FakeBridge implements LorcaBridge {
  status: BridgeStatus = { status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token" };
  snapshot = structuredClone(demoSnapshot);
  pages: ReturnType<typeof deferred>[] = [];
  pageRequests: Record<string, unknown>[] = [];
  events = new Set<(value: unknown) => void>();
  statuses = new Set<(status: BridgeStatus) => void>();
  getStatus = async () => this.status;
  connect = async () => this.status;
  request = async (method: string, params: Record<string, unknown>) => {
    if (method === "bootstrap") return structuredClone(this.snapshot);
    if (method === "chats.mark_read") return null;
    assert.equal(method, "chats.messages"); this.pageRequests.push(params); const pending = deferred(); this.pages.push(pending); return pending.promise;
  };
  onEvent = (callback: (value: unknown) => void) => { this.events.add(callback); return () => { this.events.delete(callback); }; };
  onStatus = (callback: (status: BridgeStatus) => void) => { this.statuses.add(callback); return () => { this.statuses.delete(callback); }; };
  change() { this.status = { ...this.status, generation: this.status.generation + 1 }; for (const callback of this.statuses) callback(this.status); }
  identity() { this.snapshot.identity_id = "replacement-account"; for (const callback of this.events) callback({ event: "identity.changed", data: { has_identity: true } }); }
}

test("switching chats releases the old history request and lets the selected chat load immediately", async context => {
  const bridge = new FakeBridge();
  const [first, second] = bridge.snapshot.chats;
  first.has_more = true;
  second.has_more = true;
  const controller = new LorcaController(bridge);
  context.after(() => controller.dispose());
  await controller.start();
  await tick();
  controller.actions.onSelectConversation(first.id);
  controller.actions.onLoadOlder();
  assert.equal(bridge.pages.length, 1);
  controller.actions.onSelectConversation(second.id);
  assert.equal(controller.getSnapshot().loadingOlder, false);
  controller.actions.onLoadOlder();
  assert.equal(bridge.pages.length, 2);
  assert.deepEqual(bridge.pageRequests.map(request => request.chat_id), [first.id, second.id]);
  assert.equal(bridge.pageRequests[1].before, second.messages[0]?.id);
  bridge.pages[0].resolve({ messages: [row("first-chat-old-row", first.id)], has_more: false });
  await tick();
  assert.equal(controller.getSnapshot().activeConversationId, second.id);
  assert.equal(controller.getSnapshot().loadingOlder, true);
  assert.equal(controller.getSnapshot().hasMore, true);
  assert.equal(controller.getSnapshot().messages.some(message => message.id === "first-chat-old-row"), false);
  controller.actions.onLoadOlder();
  assert.equal(bridge.pages.length, 2);
  bridge.pages[1].resolve({ messages: [row("second-chat-old-row", second.id)], has_more: false });
  await tick();
  assert.equal(controller.getSnapshot().loadingOlder, false);
  assert.equal(controller.getSnapshot().messages[0].id, "second-chat-old-row");
  assert.equal(controller.getSnapshot().hasMore, false);
});

for (const destination of ["another chat", "new conversation"] as const) {
  test(`an old history failure cannot leak into ${destination}`, async context => {
    const bridge = new FakeBridge();
    const [first, second] = bridge.snapshot.chats;
    first.has_more = true;
    const controller = new LorcaController(bridge);
    context.after(() => controller.dispose());
    await controller.start();
    await tick();
    controller.actions.onSelectConversation(first.id);
    controller.actions.onLoadOlder();
    assert.equal(controller.getSnapshot().loadingOlder, true);
    if (destination === "another chat") controller.actions.onSelectConversation(second.id);
    else controller.actions.onNewConversation();
    assert.equal(controller.getSnapshot().loadingOlder, false);
    const before = controller.getSnapshot();
    bridge.pages[0].reject(new Error("Only the previous chat's historical page failed"));
    await tick();
    const after = controller.getSnapshot();
    assert.equal(after.activeConversationId, destination === "another chat" ? second.id : null);
    assert.equal(after.loadingOlder, false);
    assert.equal(after.error, null);
    assert.deepEqual(after.messages, before.messages);
    assert.equal(after.hasMore, before.hasMore);
  });
}

test("history in the same conversation prepends rows once and adopts the page boundary", async context => {
  const bridge = new FakeBridge();
  const chat = bridge.snapshot.chats[0];
  chat.has_more = true;
  const controller = new LorcaController(bridge);
  context.after(() => controller.dispose());
  await controller.start();
  await tick();
  controller.actions.onSelectConversation(chat.id);
  const previous = controller.getSnapshot().messages;
  const anchor = chat.messages[0];
  controller.actions.onLoadOlder();
  assert.deepEqual(bridge.pageRequests, [{ chat_id: chat.id, before: anchor.id, limit: 60 }]);
  bridge.pages[0].resolve({ messages: [row("older-history-row", chat.id), anchor], has_more: false });
  await tick();
  const after = controller.getSnapshot();
  assert.equal(after.loadingOlder, false);
  assert.equal(after.error, null);
  assert.equal(after.hasMore, false);
  assert.deepEqual(after.messages.map(message => message.id), ["older-history-row", ...previous.map(message => message.id)]);
  assert.deepEqual(after.messages.slice(1), previous);
  controller.actions.onLoadOlder();
  assert.equal(bridge.pages.length, 1);
});
for (const boundary of ["reconnect", "account", "same-session refresh"] as const) {
  for (const outcome of ["success", "failure"] as const) {
    test(`old page ${outcome} after ${boundary} cannot clear a newer page loading flag or allow a duplicate request`, async context => {
      const bridge = new FakeBridge(); bridge.snapshot.chats[0].has_more = true;
      const controller = new LorcaController(bridge); context.after(() => controller.dispose());
      await controller.start(); await tick(); controller.actions.onSelectConversation("chat-demo");
      controller.actions.onLoadOlder(); assert.equal(bridge.pages.length, 1);
      if (boundary === "reconnect") bridge.change();
      if (boundary === "account") bridge.identity();
      if (boundary === "same-session refresh") await controller.refresh();
      await tick(); controller.actions.onSelectConversation("chat-demo");
      controller.actions.onLoadOlder(); assert.equal(bridge.pages.length, 2); assert.equal(controller.getSnapshot().loadingOlder, true);
      if (outcome === "success") bridge.pages[0].resolve({ messages: [row("stale-page-row")], has_more: false });
      else bridge.pages[0].reject(new Error("Stale connection failed"));
      await tick();
      assert.equal(controller.getSnapshot().loadingOlder, true);
      assert.equal(controller.getSnapshot().error, null);
      assert.equal(controller.getSnapshot().messages.some(message => message.id === "stale-page-row"), false);
      assert.equal(controller.getSnapshot().hasMore, true);
      controller.actions.onLoadOlder(); assert.equal(bridge.pages.length, 2);
      bridge.pages[1].resolve({ messages: [row("current-page-row")], has_more: false }); await tick();
      assert.equal(controller.getSnapshot().loadingOlder, false);
      assert.equal(controller.getSnapshot().messages[0].id, "current-page-row");
      assert.equal(controller.getSnapshot().hasMore, false);
    });
  }
}
