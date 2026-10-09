import test from "node:test";
import assert from "node:assert/strict";
import { parseEvent, parseMessage, parseSnapshot } from "../src/core/protocol";
import {
  appendOlder,
  applyEvent,
  applyBufferedEvent,
  applySnapshot,
  emptyModel,
  isRunning,
  upsertMessage,
} from "../src/core/store";
import { demoSnapshot } from "../src/core/demo";
import { LorcaController } from "../src/core/controller";
import type { BridgeStatus, LorcaBridge } from "../src/core/bridge";

const snapshot = () => parseSnapshot(structuredClone(demoSnapshot));
const message = (id: string, text: string, created_at = 1) =>
  parseMessage({
    id,
    chat_id: "chat-demo",
    author: { kind: "you" },
    body: { kind: "text", text },
    state: { kind: "complete" },
    created_at,
  });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
class FakeBridge implements LorcaBridge {
  status: BridgeStatus = {
    status: "connected",
    endpoint: "ws://127.0.0.1:4862/ws",
    generation: 1,
    authMode: "token",
  };
  events = new Set<(e: unknown) => void>();
  statuses = new Set<(s: BridgeStatus) => void>();
  calls: { method: string; params: Record<string, unknown> }[] = [];
  handler: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown> = async (method) => {
    if (method === "bootstrap") return structuredClone(demoSnapshot);
    return null;
  };
  getStatus = async () => this.status;
  connect = async () => this.status;
  request = async (method: string, params: Record<string, unknown>) => {
    this.calls.push({ method, params });
    return this.handler(method, params);
  };
  onEvent = (cb: (e: unknown) => void) => {
    this.events.add(cb);
    return () => this.events.delete(cb);
  };
  onStatus = (cb: (s: BridgeStatus) => void) => {
    this.statuses.add(cb);
    return () => this.statuses.delete(cb);
  };
  event(e: unknown) {
    for (const cb of this.events) cb(e);
  }
  change(generation: number, status: BridgeStatus["status"] = "connected") {
    this.status = { ...this.status, generation, status };
    for (const cb of this.statuses) cb(this.status);
  }
}

test("wire state is an object, unknown fields tolerate upgrades, bad structural data fails", () => {
  assert.equal(snapshot().chats.length, 3);
  assert.throws(
    () =>
      parseMessage({ ...demoSnapshot.chats[0].messages[0], state: "complete" }),
    /message.state/,
  );
  assert.throws(() => parseSnapshot({ ...demoSnapshot, bots: "bad" }), /bots/);
  assert.equal(
    parseEvent({ event: "future.event", data: null }).event,
    "ignored",
  );
  const m = parseMessage({
    ...demoSnapshot.chats[0].messages[0],
    body: { kind: "future" },
  });
  assert.equal(m.body.kind, "unsupported");
});
test("message updates replace full text and keep stable position; no token concatenation", () => {
  let rows = [message("a", "Hello", 50), message("b", "There", 1)];
  rows = upsertMessage(rows, message("a", "Hello world", 60));
  assert.deepEqual(
    rows.map((m) => m.id),
    ["a", "b"],
  );
  assert.equal(
    rows[0].body.kind === "text" && rows[0].body.text,
    "Hello world",
  );
  rows = upsertMessage(rows, message("c", "Earlier clock", 0));
  assert.deepEqual(
    rows.map((m) => m.id),
    ["a", "b", "c"],
  );
});
test("snapshot preserves known earlier prefix by ID, not timestamps; roster keeps pages", () => {
  const snap = snapshot();
  snap.chats[0].messages = [message("b", "B", 1), message("c", "C", 0)];
  snap.chats[0].has_more = true;
  let model = applySnapshot(emptyModel(), snap);
  model = appendOlder(model, "chat-demo", [message("a", "A", 900)], false);
  model = applySnapshot(model, snap);
  assert.deepEqual(
    model.chats.get("chat-demo")?.messages.map((m) => m.id),
    ["a", "b", "c"],
  );
  assert.equal(model.chats.get("chat-demo")?.has_more, false);
  model = applyEvent(model, {
    event: "roster.changed",
    data: {
      bots: snap.bots,
      chats: snap.chats.map((c) => ({ ...c, messages: [], has_more: false })),
    },
  });
  assert.equal(model.chats.get("chat-demo")?.messages.length, 3);
});
test("snapshot cannot attach old history when anchor vanished", () => {
  const snap = snapshot();
  snap.chats[0].messages = [message("a", "A"), message("b", "B")];
  snap.chats[0].has_more = true;
  let model = applySnapshot(emptyModel(), snap);
  snap.chats[0].messages = [message("new", "New")];
  model = applySnapshot(model, snap);
  assert.deepEqual(
    model.chats.get("chat-demo")?.messages.map((m) => m.id),
    ["new"],
  );
});
test("multi-job group stays busy until every job finishes", () => {
  let model = applySnapshot(emptyModel(), snapshot());
  for (const job_id of ["group", "bot"])
    model = applyEvent(model, {
      event: "job.started",
      data: { chat_id: "chat-demo", bot_id: "", job_id },
    });
  model = applyEvent(model, {
    event: "job.finished",
    data: { chat_id: "chat-demo", bot_id: "", job_id: "bot" },
  });
  assert.equal(isRunning(model, "chat-demo"), true);
  model = applyEvent(model, {
    event: "job.finished",
    data: { chat_id: "chat-demo", bot_id: "", job_id: "group" },
  });
  assert.equal(isRunning(model, "chat-demo"), false);
});
test("paging deduplicates while newer message contents win", () => {
  let model = applySnapshot(emptyModel(), snapshot());
  model = appendOlder(
    model,
    "chat-demo",
    [message("older", "Old"), message("msg-demo-1", "Stale")],
    true,
  );
  assert.equal(model.chats.get("chat-demo")?.messages[0].id, "older");
  const body = model.chats.get("chat-demo")?.messages[1].body;
  assert.notEqual(body?.kind === "text" && body.text, "Stale");
});
test("bootstrap buffers events and applies them after the snapshot", async () => {
  const bridge = new FakeBridge();
  let resolve!: (v: unknown) => void;
  bridge.handler = () => new Promise((r) => (resolve = r));
  const controller = new LorcaController(bridge);
  await controller.start();
  bridge.event({
    event: "message.updated",
    data: {
      chat_id: "chat-demo",
      message: {
        ...demoSnapshot.chats[0].messages[0],
        body: { kind: "text", text: "Updated during bootstrap" },
      },
    },
  });
  resolve(structuredClone(demoSnapshot));
  await tick();
  controller.actions.onSelectConversation("chat-demo");
  const first = controller.getSnapshot().messages[0];
  assert.equal(
    first.kind === "message" && first.text,
    "Updated during bootstrap",
  );
  controller.dispose();
});
test("late snapshots from an old connection cannot overwrite current session", async () => {
  const bridge = new FakeBridge();
  const resolves: ((v: unknown) => void)[] = [];
  bridge.handler = () => new Promise((r) => resolves.push(r));
  const controller = new LorcaController(bridge);
  await controller.start();
  bridge.change(2);
  const latest = structuredClone(demoSnapshot);
  latest.bots[0].name = "New session";
  resolves[1](latest);
  await tick();
  resolves[0](structuredClone(demoSnapshot));
  await tick();
  assert.equal(controller.getSnapshot().agents[0].label, "New session");
  controller.dispose();
});
test("send response never overwrites an earlier queued update; double send is blocked", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  await controller.start();
  await tick();
  controller.actions.onSelectConversation("chat-demo");
  let resolve!: (v: unknown) => void;
  let raw: unknown;
  bridge.handler = async (method, params) => {
    if (method === "chats.send") {
      raw = {
        id: params.message_id,
        chat_id: "chat-demo",
        author: { kind: "you" },
        body: { kind: "text", text: params.text },
        state: { kind: "complete" },
        created_at: 100,
      };
      bridge.event({
        event: "message.updated",
        data: {
          chat_id: "chat-demo",
          message: { ...(raw as object), queued: true },
        },
      });
      return new Promise((r) => (resolve = r));
    }
    return structuredClone(demoSnapshot);
  };
  const first = controller.actions.onSend("hello");
  await tick();
  await controller.actions.onSend("duplicate");
  resolve({ message: raw });
  await first;
  assert.equal(bridge.calls.filter((c) => c.method === "chats.send").length, 1);
  assert.equal(controller.getSnapshot().queue.length, 1);
  controller.dispose();
});
test("unknown send outcome is surfaced and never retried automatically", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  await controller.start();
  await tick();
  controller.actions.onSelectConversation("chat-demo");
  bridge.handler = async () => {
    throw new Error(
      "Send outcome unknown. Check the conversation before retrying.",
    );
  };
  await assert.rejects(
    Promise.resolve(controller.actions.onSend("hello")),
    /outcome unknown/,
  );
  assert.equal(bridge.calls.filter((c) => c.method === "chats.send").length, 1);
  assert.match(controller.getSnapshot().error ?? "", /unknown/);
  controller.dispose();
});
test("identity change immediately clears old conversations", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  await controller.start();
  await tick();
  bridge.handler = () => new Promise(() => {});
  bridge.event({ event: "identity.changed", data: { has_identity: false } });
  assert.equal(controller.getSnapshot().conversations.length, 0);
  controller.dispose();
});
test("chat mismatch cannot contaminate another transcript", () => {
  assert.throws(
    () =>
      parseEvent({
        event: "message.added",
        data: { chat_id: "wrong", message: demoSnapshot.chats[0].messages[0] },
      }),
    /mismatch/,
  );
});
test("a connecting status followed by connected in the same generation reboots state", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  await controller.start();
  await tick();
  const replacement = structuredClone(demoSnapshot);
  replacement.bots[0].name = "After reconnect";
  bridge.handler = async () => replacement;
  bridge.change(2, "connecting");
  bridge.change(2, "connected");
  await tick();
  assert.equal(controller.getSnapshot().agents[0].label, "After reconnect");
  controller.dispose();
});
test("identity changes during chat creation prevent a second mutation and old chat insertion", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  await controller.start();
  await tick();
  let resolve!: (value: unknown) => void;
  bridge.handler = (method) =>
    method === "chats.create"
      ? new Promise((r) => (resolve = r))
      : new Promise(() => {});
  const send = Promise.resolve(
    controller.actions.onSend("Must not cross accounts"),
  );
  bridge.event({ event: "identity.changed", data: { has_identity: true } });
  resolve({
    chat: {
      id: "old-account",
      kind: "dm",
      bot_ids: ["bot-demo"],
      title: null,
      created_at: 1,
    },
  });
  await assert.rejects(send, /Account or connection changed/);
  assert.equal(
    bridge.calls.some((call) => call.method === "chats.send"),
    false,
  );
  assert.equal(controller.getSnapshot().conversations.length, 0);
  controller.dispose();
});
test("failed reconnect snapshot cannot authorize mutations with old identity state",async()=>{
  const bridge=new FakeBridge(),controller=new LorcaController(bridge);await controller.start();await tick();controller.actions.onSelectConversation("chat-demo");
  bridge.handler=async()=>{throw new Error("Invalid snapshot");};bridge.change(2,"connecting");bridge.change(2,"connected");await tick();
  await assert.rejects(Promise.resolve(controller.actions.onSend("must stay local")),/finish syncing/);
  assert.equal(bridge.calls.some(call=>call.method==="chats.send"),false);controller.dispose();
});
test("buffered old stream and permission states cannot regress terminal snapshot rows",()=>{
  const snap=snapshot();snap.chats[0].messages=[message("msg","Hello world")];let model=applySnapshot(emptyModel(),snap);
  model=applyBufferedEvent(model,{event:"message.updated",data:{chat_id:"chat-demo",message:{...message("msg","Hello"),state:"streaming"}}});
  const body=model.chats.get("chat-demo")?.messages[0].body;assert.equal(body?.kind==="text"&&body.text,"Hello world");
});
