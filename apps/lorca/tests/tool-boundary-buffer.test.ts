import assert from "node:assert/strict";
import test from "node:test";
import type { BridgeStatus, LorcaBridge } from "../src/core/bridge";
import { LorcaController } from "../src/core/controller";
import { demoSnapshot } from "../src/core/demo";
import { parseEvent, parseSnapshot, type WireEvent } from "../src/core/protocol";
import { applyBufferedEvent, applySnapshot, emptyModel, type Model } from "../src/core/store";
import { groupToolRecords, type ToolMessage } from "../src/ui/tool-groups";

const rawTool = (id: string, state = "complete", running = false) => ({
  id, chat_id: "chat-demo", author: { kind: "bot", bot_id: "bot-demo" }, created_at: 1,
  state: { kind: state },
  body: { kind: "tool", name: "read", summary: "Synthetic read", detail: running ? "Stale partial output" : `Final output ${id}`, is_running: running, is_error: false },
});
const snapshot = () => ({
  ...demoSnapshot,
  chats: [{ ...demoSnapshot.chats[0], messages: [rawTool("tool-a"), rawTool("tool-b")] }],
  running_turns: [], running_chat_ids: [],
});
const job = (event: "job.started" | "job.finished", jobId: string): WireEvent => ({
  event, data: { chat_id: "chat-demo", job_id: jobId, bot_id: "bot-demo" },
});
const added = (id: string, state = "complete", running = false): WireEvent => parseEvent({
  event: "message.added", data: { chat_id: "chat-demo", message: rawTool(id, state, running) },
});
const boundary = (model: Model, id: string) => model.messageActivityBoundaries.get(`chat-demo:${id}`);
const replay = (model: Model, state = "complete", running = false): Model => [
  job("job.started", "job-a"), added("tool-a", state, running),
  job("job.finished", "job-a"), job("job.started", "job-b"), added("tool-b", state, running),
].reduce(applyBufferedEvent, model);
const groups = (model: Model) => {
  const messages: ToolMessage[] = model.chats.get("chat-demo")!.messages.map(message => ({
    kind: "tool", id: message.id, authorId: message.author.bot_id,
    observedBoundary: boundary(model, message.id) ?? null, name: "Synthetic read", status: "complete",
  }));
  return groupToolRecords(messages).map(entry => entry.kind === "tools" ? entry.messages.map(message => message.id) : entry.message.id);
};

test("buffered additions retain observed lifecycle boundaries when bootstrap already contains both records", () => {
  const before = applySnapshot(emptyModel(), parseSnapshot(snapshot()));
  assert.equal(before.messageActivityBoundaries.size, 0);
  const after = replay(before);
  assert.ok(boundary(after, "tool-a"));
  assert.ok(boundary(after, "tool-b"));
  assert.notEqual(boundary(after, "tool-a"), boundary(after, "tool-b"));
  assert.deepEqual(groups(after), [["tool-a"], ["tool-b"]]);
  assert.equal(before.messageActivityBoundaries.size, 0);
});

for (const state of ["streaming", "complete"]) {
  test(`buffered ${state} running additions preserve boundary evidence without replacing authoritative completed output`, () => {
    const before = applySnapshot(emptyModel(), parseSnapshot(snapshot()));
    const after = replay(before, state, true);
    assert.deepEqual(groups(after), [["tool-a"], ["tool-b"]]);
    assert.deepEqual(after.chats.get("chat-demo")!.messages, before.chats.get("chat-demo")!.messages);
    const original = boundary(after, "tool-a");
    const later = applyBufferedEvent(applyBufferedEvent(after, job("job.finished", "job-b")), added("tool-a", state, true));
    assert.equal(boundary(later, "tool-a"), original);
    assert.deepEqual(groups(later), [["tool-a"], ["tool-b"]]);
  });
}

test("controller preserves buffered lifecycle separation through an in-flight bootstrap and later refresh", async context => {
  const status: BridgeStatus = { status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token" };
  const events = new Set<(event: unknown) => void>();
  let resolveBootstrap!: (value: unknown) => void;
  const pending = new Promise<unknown>(resolve => { resolveBootstrap = resolve; });
  let requestCount = 0;
  const bridge: LorcaBridge = {
    getStatus: async () => status, connect: async () => status,
    request: async method => { assert.equal(method, "bootstrap"); return ++requestCount === 1 ? pending : snapshot(); },
    onEvent: callback => { events.add(callback); return () => { events.delete(callback); }; },
    onStatus: () => () => {},
  };
  const controller = new LorcaController(bridge);
  context.after(() => controller.dispose());
  await controller.start();
  assert.equal(controller.getSnapshot().loading, true);
  for (const event of [
    job("job.started", "job-a"),
    { event: "message.added", data: { chat_id: "chat-demo", message: rawTool("tool-a", "streaming", true) } },
    job("job.finished", "job-a"), job("job.started", "job-b"),
    { event: "message.added", data: { chat_id: "chat-demo", message: rawTool("tool-b", "streaming", true) } },
  ]) for (const callback of events) callback(event);
  resolveBootstrap(snapshot());
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.actions.onSelectConversation("chat-demo");
  const messages = controller.getSnapshot().messages;
  assert.equal(controller.getSnapshot().loading, false);
  assert.equal(groupToolRecords(messages).length, 2);
  for (const message of messages) {
    assert.equal(message.kind, "tool");
    if (message.kind !== "tool") throw new Error("Expected a tool record");
    assert.equal(message.status, "complete");
    assert.equal(message.output, `Final output ${message.id}`);
    assert.ok(message.observedBoundary);
  }
  await controller.refresh();
  assert.deepEqual(controller.getSnapshot().messages, messages);
});
