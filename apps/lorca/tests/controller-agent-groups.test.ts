import test from "node:test";
import assert from "node:assert/strict";
import { LorcaController } from "../src/core/controller";
import type { BridgeStatus, LorcaBridge } from "../src/core/bridge";

const snapshot = (identity: string | null = "synthetic-account-a") => ({
  version: "synthetic-groups", has_identity: Boolean(identity), identity_id: identity,
  bots: [{ id: "alpha", name: "Alpha", runner_id: "runner" }, { id: "beta", name: "Beta", runner_id: "runner" }],
  devices: [], running_turns: [], running_chat_ids: [], relay_connected: false,
  chats: [{ id: "dm-alpha", kind: "dm", bot_ids: ["alpha"], created_at: 1, messages: [], has_more: false }],
});
class Fixture implements LorcaBridge {
  status: BridgeStatus = { status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token" };
  value = snapshot();
  failed = false;
  calls: string[] = [];
  picked: { id: string; name: string }[] = [];
  released: string[][] = [];
  events = new Set<(event: unknown) => void>();
  statuses = new Set<(status: BridgeStatus) => void>();
  getStatus = async () => this.status;
  connect = async () => this.status;
  pickAttachments = async () => this.picked;
  releaseAttachments = async (ids: string[]) => { this.released.push(ids); };
  sendAttachments = async () => { assert.fail("Agent group selection must not send attachments"); };
  request = async (method: string) => {
    this.calls.push(method);
    assert.equal(method, "bootstrap", "Group navigation must never create chats or send messages");
    if (this.failed) throw new Error("Synthetic snapshot failure");
    return structuredClone(this.value);
  };
  onEvent = (listener: (event: unknown) => void) => { this.events.add(listener); return () => { this.events.delete(listener); }; };
  onStatus = (listener: (status: BridgeStatus) => void) => { this.statuses.add(listener); return () => { this.statuses.delete(listener); }; };
  changed(status: Partial<BridgeStatus>) { this.status = { ...this.status, ...status }; for (const callback of this.statuses) callback(this.status); }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("Local groups expose a stable namespace only after the current account snapshot succeeds", async () => {
  const bridge = new Fixture(), controller = new LorcaController(bridge);
  assert.equal(controller.getSnapshot().localGroupNamespace, undefined);
  await controller.start();
  const original = controller.getSnapshot().localGroupNamespace;
  assert.ok(original);
  await controller.refresh();
  assert.equal(controller.getSnapshot().localGroupNamespace, original);
  bridge.failed = true;
  bridge.changed({ generation: 2 });
  assert.equal(controller.getSnapshot().localGroupNamespace, undefined);
  await tick();
  assert.equal(controller.getSnapshot().localGroupNamespace, undefined);
  bridge.failed = false;
  await controller.refresh();
  assert.equal(controller.getSnapshot().localGroupNamespace, original);
  bridge.value = snapshot("synthetic-account-b");
  for (const callback of bridge.events) callback({ event: "identity.changed", data: {} });
  assert.equal(controller.getSnapshot().localGroupNamespace, undefined);
  await tick();
  assert.notEqual(controller.getSnapshot().localGroupNamespace, original);
  bridge.value = snapshot(null);
  await controller.refresh();
  assert.equal(controller.getSnapshot().localGroupNamespace, undefined);
  controller.dispose();
});

test("Agent tree selection opens the existing DM or a local selected-agent draft without RPC writes", async () => {
  const bridge = new Fixture(), controller = new LorcaController(bridge);
  await controller.start();
  const before = bridge.calls.slice();
  controller.actions.onOpenAgentChat?.("alpha");
  assert.equal(controller.getSnapshot().activeConversationId, "dm-alpha");
  controller.actions.onOpenAgentChat?.("beta");
  assert.equal(controller.getSnapshot().activeConversationId, null);
  assert.equal(controller.getSnapshot().selectedAgentId, "beta");
  controller.actions.onOpenAgentChat?.("missing");
  assert.equal(controller.getSnapshot().selectedAgentId, "beta");
  assert.deepEqual(bridge.calls, before);
  assert.equal(controller.getSnapshot().conversations.length, 1);
  controller.dispose();
});

for (const target of ["alpha", "beta"]) {
  test(`reopening the current ${target === "alpha" ? "DM" : "agent draft"} preserves its unsent attachment`, async context => {
    const bridge = new Fixture(), controller = new LorcaController(bridge);
    context.after(() => controller.dispose());
    await controller.start();
    controller.actions.onOpenAgentChat?.(target);
    bridge.picked = [{ id: "a".repeat(32), name: "synthetic-unsent.txt" }];
    controller.actions.onPickAttachments?.();
    await tick();
    const before = controller.getSnapshot();
    assert.deepEqual(before.pendingAttachments, bridge.picked);
    const calls = bridge.calls.slice();
    controller.actions.onOpenAgentChat?.(target);
    const after = controller.getSnapshot();
    assert.equal(after.activeConversationId, target === "alpha" ? "dm-alpha" : null);
    assert.equal(after.selectedAgentId, target);
    assert.deepEqual(after.pendingAttachments, before.pendingAttachments);
    assert.deepEqual(bridge.released, []);
    assert.deepEqual(bridge.calls, calls);
  });
}

test("Group namespaces distinguish daemon destinations even when identity identifiers match", async () => {
  const bridge = new Fixture(), controller = new LorcaController(bridge);
  await controller.start();
  const original = controller.getSnapshot().localGroupNamespace;
  bridge.changed({ endpoint: "ws://127.0.0.1:5862/ws", generation: 2 });
  assert.equal(controller.getSnapshot().localGroupNamespace, undefined);
  await tick();
  assert.ok(controller.getSnapshot().localGroupNamespace);
  assert.notEqual(controller.getSnapshot().localGroupNamespace, original);
  controller.dispose();
});
