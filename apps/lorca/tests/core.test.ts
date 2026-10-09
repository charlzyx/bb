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
import { demoRuntimeSettings, demoSnapshot } from "../src/core/demo";
import { LorcaController } from "../src/core/controller";
import { parseRuntimeSettings } from "../src/core/settings";
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
  getSettings?: LorcaBridge["getSettings"];
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
test("account snapshots never reuse another identity's history or accept its buffered snapshot", () => {
  const accountOne = { ...snapshot(), identity_id: "account-one" };
  accountOne.chats[0].messages = [message("shared-anchor", "Account one message")];
  accountOne.chats[0].has_more = true;
  let model = applySnapshot(emptyModel(), accountOne);
  model = appendOlder(model, "chat-demo", [message("private-prefix", "Account one private history")], false);

  const accountTwo = structuredClone(accountOne);
  accountTwo.identity_id = "account-two";
  accountTwo.chats[0].messages = [message("shared-anchor", "Account two message")];
  model = applySnapshot(model, accountTwo);
  assert.equal(model.identityId, "account-two");
  assert.deepEqual(model.chats.get("chat-demo")?.messages.map((item) => item.id), ["shared-anchor"]);
  assert.equal(model.chats.get("chat-demo")?.has_more, true);

  const authoritative = model;
  model = applyBufferedEvent(model, { event: "snapshot", data: accountOne });
  assert.deepEqual(model, authoritative);

  const currentSnapshot = structuredClone(accountTwo);
  currentSnapshot.chats[0].messages = [message("shared-anchor", "Updated account two message")];
  model = applyBufferedEvent(model, { event: "snapshot", data: currentSnapshot });
  const body = model.chats.get("chat-demo")?.messages[0].body;
  assert.equal(body?.kind === "text" && body.text, "Updated account two message");
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
    /message\.chat_id 与 chat_id 不一致/,
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
  await assert.rejects(send, /账号或连接发生了变化/);
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
  await assert.rejects(Promise.resolve(controller.actions.onSend("must stay local")),/完成同步/);
  assert.equal(bridge.calls.some(call=>call.method==="chats.send"),false);controller.dispose();
});
test("buffered old stream and permission states cannot regress terminal snapshot rows",()=>{
  const snap=snapshot();snap.chats[0].messages=[message("msg","Hello world")];let model=applySnapshot(emptyModel(),snap);
  model=applyBufferedEvent(model,{event:"message.updated",data:{chat_id:"chat-demo",message:{...message("msg","Hello"),state:"streaming"}}});
  const body=model.chats.get("chat-demo")?.messages[0].body;assert.equal(body?.kind==="text"&&body.text,"Hello world");
});

for (const endpoint of [
  "ws://127.0.0.1:4862/ws",
  "ws://localhost:4862/ws",
]) {
  test(`saving the connected endpoint ${endpoint} preserves chats and refreshes`, async () => {
    const bridge = new FakeBridge(),
      controller = new LorcaController(bridge);
    try {
      await controller.start();
      await tick();
      controller.actions.onSelectConversation("chat-demo");
      const before = controller.getSnapshot();
      let resolve!: (value: unknown) => void;
      bridge.handler = () => new Promise((r) => (resolve = r));

      const saving = controller.actions.onSaveEndpoint(endpoint);
      await tick();
      assert.equal(controller.getSnapshot().activeConversationId, "chat-demo");
      assert.deepEqual(controller.getSnapshot().conversations, before.conversations);
      assert.deepEqual(controller.getSnapshot().agents, before.agents);
      assert.equal(controller.getSnapshot().draftScope, before.draftScope);
      assert.equal(
        bridge.calls.filter((call) => call.method === "bootstrap").length,
        2,
      );

      const refreshed = structuredClone(demoSnapshot);
      refreshed.bots[0].name = "Refreshed bot";
      resolve(refreshed);
      await saving;
      assert.equal(controller.getSnapshot().agents[0].label, "Refreshed bot");
      assert.equal(controller.getSnapshot().activeConversationId, "chat-demo");
    } finally {
      controller.dispose();
    }
  });
}

test("an invalid endpoint save rejects and leaves the current conversation intact", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  try {
    await controller.start();
    await tick();
    controller.actions.onSelectConversation("chat-demo");
    const before = controller.getSnapshot();
    bridge.connect = async () => {
      throw new Error("Only a loopback endpoint with an explicit port is allowed");
    };

    await assert.rejects(controller.actions.onSaveEndpoint("ws://localhost/ws"));
    const after = controller.getSnapshot();
    assert.equal(after.activeConversationId, before.activeConversationId);
    assert.deepEqual(after.conversations, before.conversations);
    assert.deepEqual(after.messages, before.messages);
    assert.deepEqual(after.agents, before.agents);
    assert.equal(after.draftScope, before.draftScope);
  } finally {
    controller.dispose();
  }
});

test("a rejected connection status makes endpoint save reject without discarding the model", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  try {
    await controller.start();
    await tick();
    controller.actions.onSelectConversation("chat-demo");
    const before = controller.getSnapshot();
    bridge.connect = async () => ({
      ...bridge.status,
      status: "error",
      detail: "Synthetic endpoint refused the connection",
    });

    await assert.rejects(controller.actions.onSaveEndpoint(before.connection.endpoint));
    const after = controller.getSnapshot();
    assert.equal(after.activeConversationId, before.activeConversationId);
    assert.deepEqual(after.conversations, before.conversations);
    assert.deepEqual(after.messages, before.messages);
    assert.deepEqual(after.agents, before.agents);
    assert.equal(after.draftScope, before.draftScope);
  } finally {
    controller.dispose();
  }
});

test("a thrown same-endpoint connection failure preserves the current model and rejects save", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  try {
    await controller.start();
    await tick();
    controller.actions.onSelectConversation("chat-demo");
    const before = controller.getSnapshot();
    bridge.connect = async () => {
      throw new Error("Synthetic bridge connection failed");
    };

    await assert.rejects(
      controller.actions.onSaveEndpoint(before.connection.endpoint),
      /Synthetic bridge connection failed/,
    );
    const after = controller.getSnapshot();
    assert.equal(after.activeConversationId, before.activeConversationId);
    assert.deepEqual(after.conversations, before.conversations);
    assert.deepEqual(after.messages, before.messages);
    assert.deepEqual(after.agents, before.agents);
    assert.equal(after.draftScope, before.draftScope);
  } finally {
    controller.dispose();
  }
});

test("status events during endpoint save cannot let an older bootstrap replace the final result", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  try {
    await controller.start();
    await tick();
    const endpoint = "ws://127.0.0.1:4863/ws";
    const resolves: ((value: unknown) => void)[] = [];
    bridge.handler = () => new Promise((resolve) => resolves.push(resolve));
    const previousRefresh = controller.refresh();
    await tick();
    assert.equal(resolves.length, 1);
    bridge.connect = async () => {
      bridge.status = { ...bridge.status, endpoint };
      bridge.change(2, "connecting");
      bridge.change(2, "connected");
      return bridge.status;
    };

    const saving = controller.actions.onSaveEndpoint(endpoint);
    await tick();
    assert.equal(resolves.length, 2, "Endpoint status events start exactly one replacement bootstrap");
    const latest = structuredClone(demoSnapshot);
    latest.bots[0].name = "Latest endpoint bot";
    bridge.event({
      event: "message.updated",
      data: {
        chat_id: "chat-demo",
        message: {
          ...latest.chats[0].messages[0],
          body: { kind: "text", text: "Update buffered during endpoint synchronization" },
        },
      },
    });
    resolves.at(-1)!(latest);
    await saving;
    const stale = structuredClone(demoSnapshot);
    stale.bots[0].name = "Stale endpoint bot";
    for (const resolve of resolves.slice(0, -1)) resolve(stale);
    await previousRefresh;

    assert.equal(controller.getSnapshot().agents[0].label, "Latest endpoint bot");
    assert.equal(controller.getSnapshot().connection.endpoint, endpoint);
    assert.equal(controller.getSnapshot().error, null);
    controller.actions.onSelectConversation("chat-demo");
    const first = controller.getSnapshot().messages[0];
    assert.equal(
      first.kind === "message" && first.text,
      "Update buffered during endpoint synchronization",
    );
  } finally {
    controller.dispose();
  }
});

test("failed first send stays in the new-chat composer after chat creation", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  try {
    await controller.start();
    await tick();
    let reject!: (error: Error) => void;
    bridge.handler = async (method) => {
      if (method === "chats.create")
        return {
          chat: {
            id: "new-chat",
            kind: "dm",
            bot_ids: ["bot-demo"],
            title: null,
            created_at: 1,
          },
        };
      if (method === "chats.send")
        return new Promise((_resolve, fail) => (reject = fail));
      throw new Error(`Unexpected request: ${method}`);
    };

    const sending = Promise.resolve(controller.actions.onSend("Keep this draft"));
    await tick();
    assert.equal(controller.getSnapshot().activeConversationId, null);
    const rejected = assert.rejects(sending, /Synthetic send failed/);
    reject(new Error("Synthetic send failed"));
    await rejected;
    assert.equal(controller.getSnapshot().activeConversationId, null);
    assert.match(controller.getSnapshot().error ?? "", /Synthetic send failed/);
    assert.equal(bridge.calls.filter((call) => call.method === "chats.create").length, 1);
    assert.equal(bridge.calls.filter((call) => call.method === "chats.send").length, 1);
  } finally {
    controller.dispose();
  }
});

test("successful first send returns its chat without navigating before the UI selects it", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  try {
    await controller.start();
    await tick();
    let resolve!: (value: unknown) => void;
    let sent: Record<string, unknown> | undefined;
    bridge.handler = async (method, params) => {
      if (method === "chats.create")
        return {
          chat: {
            id: "new-chat",
            kind: "dm",
            bot_ids: ["bot-demo"],
            title: null,
            created_at: 1,
          },
        };
      if (method === "chats.send") {
        sent = params;
        return new Promise((r) => (resolve = r));
      }
      throw new Error(`Unexpected request: ${method}`);
    };

    const sending = controller.actions.onSend("First message");
    await tick();
    assert.equal(controller.getSnapshot().activeConversationId, null);
    assert.ok(sent);
    resolve({
      message: {
        id: sent.message_id,
        chat_id: sent.chat_id,
        author: { kind: "you" },
        body: { kind: "text", text: sent.text },
        state: { kind: "complete" },
        created_at: 2,
      },
    });
    assert.deepEqual(await sending, { chatId: "new-chat" });
    assert.equal(controller.getSnapshot().activeConversationId, null);

    controller.actions.onSelectConversation("new-chat");
    assert.equal(controller.getSnapshot().activeConversationId, "new-chat");
    const first = controller.getSnapshot().messages[0];
    assert.equal(first.kind === "message" && first.text, "First message");
  } finally {
    controller.dispose();
  }
});

test("bootstrap identity changes isolate draft scope and discard another account's older prefix", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  const initial = { ...structuredClone(demoSnapshot), identity_id: "account-one" };
  initial.chats[0].has_more = true;
  let current = initial;
  bridge.handler = async (method) => {
    if (method === "bootstrap") return structuredClone(current);
    if (method === "chats.messages")
      return {
        messages: [
          {
            ...initial.chats[0].messages[0],
            id: "account-one-older-message",
            body: { kind: "text", text: "Older private message from account one" },
          },
        ],
        has_more: false,
      };
    throw new Error(`Unexpected request: ${method}`);
  };
  try {
    await controller.start();
    await tick();
    controller.actions.onSelectConversation("chat-demo");
    controller.actions.onLoadOlder();
    await tick();
    assert.equal(controller.getSnapshot().messages[0].id, "account-one-older-message");
    const originalScope = controller.getSnapshot().draftScope;
    assert.ok(typeof originalScope === "number");

    await controller.refresh();
    assert.equal(controller.getSnapshot().draftScope, originalScope);
    assert.equal(controller.getSnapshot().messages[0].id, "account-one-older-message");

    current = { ...initial, identity_id: "account-two" };
    await controller.refresh();
    assert.equal(controller.getSnapshot().draftScope, originalScope + 1);
    controller.actions.onSelectConversation("chat-demo");
    assert.deepEqual(
      controller.getSnapshot().messages.map((item) => item.id),
      initial.chats[0].messages.map((item) => item.id),
    );
    assert.equal(controller.getSnapshot().hasMore, true);
  } finally {
    controller.dispose();
  }
});

test("runtime inventory loads through the read-only bridge without issuing mutation RPCs", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  const options: { runnerId?: string }[] = [];
  let resolve!: (value: unknown) => void;
  bridge.getSettings = async (value) => {
    options.push(value);
    return new Promise((done) => (resolve = done));
  };
  try {
    await controller.start();
    await tick();
    controller.actions.onSelectConversation("chat-demo");
    const before = controller.getSnapshot();
    const refresh = controller.actions.onRefreshSettings;
    assert.ok(refresh);

    refresh();
    assert.equal(controller.getSnapshot().settingsLoading, true);
    assert.equal(controller.getSnapshot().runtimeSettings, undefined);
    assert.equal(controller.getSnapshot().settingsError, undefined);
    assert.deepEqual(options, [{}]);
    resolve(structuredClone(demoRuntimeSettings));
    await tick();

    const after = controller.getSnapshot();
    assert.equal(after.settingsLoading, false);
    assert.equal(after.settingsError, undefined);
    assert.deepEqual(after.runtimeSettings, parseRuntimeSettings(demoRuntimeSettings));
    assert.deepEqual(after.messages, before.messages);
    assert.equal(after.activeConversationId, before.activeConversationId);
    assert.deepEqual(bridge.calls.map((call) => call.method), ["bootstrap"]);
  } finally {
    controller.dispose();
  }
});

for (const staleOutcome of ["success", "rejection", "malformed response"] as const) {
  test(`runtime inventory keeps the latest runner after a stale ${staleOutcome}`, async () => {
    const bridge = new FakeBridge(),
      controller = new LorcaController(bridge);
    const pending: {
      options: { runnerId?: string };
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }[] = [];
    bridge.getSettings = (options) => new Promise((resolve, reject) => pending.push({ options, resolve, reject }));
    try {
      await controller.start();
      await tick();
      const refresh = controller.actions.onRefreshSettings;
      assert.ok(refresh);
      refresh("runner-demo");
      refresh("runner-second");
      assert.deepEqual(pending.map((item) => item.options), [
        { runnerId: "runner-demo" },
        { runnerId: "runner-second" },
      ]);

      const latest = structuredClone(demoRuntimeSettings);
      latest.mcp = { status: "unavailable", runnerId: "runner-second", hasConfigError: false, servers: [] };
      pending[1].resolve(latest);
      await tick();
      assert.equal(controller.getSnapshot().runtimeSettings?.mcp.runnerId, "runner-second");
      if (staleOutcome === "rejection") pending[0].reject(new Error("Older runner is unavailable"));
      else pending[0].resolve(staleOutcome === "malformed response" ? { mcp: null } : structuredClone(demoRuntimeSettings));
      await tick();

      assert.deepEqual(controller.getSnapshot().runtimeSettings, parseRuntimeSettings(latest));
      assert.equal(controller.getSnapshot().settingsLoading, false);
      assert.equal(controller.getSnapshot().settingsError, undefined);
      assert.ok(bridge.calls.every((call) => call.method === "bootstrap"));
    } finally {
      controller.dispose();
    }
  });
}

test("an older runner response cannot stop a newer inventory request's loading state", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  const resolves: ((value: unknown) => void)[] = [];
  bridge.getSettings = () => new Promise((resolve) => resolves.push(resolve));
  try {
    await controller.start();
    await tick();
    const refresh = controller.actions.onRefreshSettings;
    assert.ok(refresh);
    refresh("runner-demo");
    refresh("runner-second");
    resolves[0](structuredClone(demoRuntimeSettings));
    await tick();
    assert.equal(controller.getSnapshot().settingsLoading, true);
    assert.equal(controller.getSnapshot().runtimeSettings, undefined);
    assert.equal(controller.getSnapshot().settingsError, undefined);

    const latest = structuredClone(demoRuntimeSettings);
    latest.mcp = { status: "unavailable", runnerId: "runner-second", hasConfigError: false, servers: [] };
    resolves[1](latest);
    await tick();
    assert.equal(controller.getSnapshot().settingsLoading, false);
    assert.equal(controller.getSnapshot().runtimeSettings?.mcp.runnerId, "runner-second");
  } finally {
    controller.dispose();
  }
});

for (const boundary of ["identity event", "bootstrap identity", "endpoint", "reconnect"] as const) {
  test(`runtime inventory ignores a response preceding ${boundary} changes`, async () => {
    const bridge = new FakeBridge(),
      controller = new LorcaController(bridge);
    bridge.handler = async () => ({ ...structuredClone(demoSnapshot), identity_id: "account-one" });
    let resolve!: (value: unknown) => void;
    bridge.getSettings = () => new Promise((done) => (resolve = done));
    try {
      await controller.start();
      await tick();
      const refresh = controller.actions.onRefreshSettings;
      assert.ok(refresh);
      refresh("runner-demo");
      assert.equal(controller.getSnapshot().settingsLoading, true);

      if (boundary === "identity event") {
        bridge.event({ event: "identity.changed", data: { has_identity: true } });
      } else if (boundary === "bootstrap identity") {
        bridge.handler = async () => ({ ...structuredClone(demoSnapshot), identity_id: "account-two" });
        await controller.refresh();
      } else if (boundary === "endpoint") {
        const endpoint = "ws://127.0.0.1:4863/ws";
        bridge.connect = async () => {
          bridge.status = { ...bridge.status, endpoint };
          bridge.change(2, "connecting");
          bridge.change(2, "connected");
          return bridge.status;
        };
        await controller.actions.onSaveEndpoint(endpoint);
      } else {
        bridge.change(2, "connecting");
        bridge.change(2, "connected");
      }
      await tick();
      assert.equal(controller.getSnapshot().settingsLoading, false);
      assert.equal(controller.getSnapshot().runtimeSettings, undefined);
      resolve(structuredClone(demoRuntimeSettings));
      await tick();

      assert.equal(controller.getSnapshot().runtimeSettings, undefined);
      assert.equal(controller.getSnapshot().settingsLoading, false);
      assert.equal(controller.getSnapshot().settingsError, undefined);
      bridge.getSettings = async () => structuredClone(demoRuntimeSettings);
      refresh("runner-demo");
      await tick();
      assert.deepEqual(controller.getSnapshot().runtimeSettings, parseRuntimeSettings(demoRuntimeSettings));
      assert.ok(bridge.calls.every((call) => call.method === "bootstrap"));
    } finally {
      controller.dispose();
    }
  });
}

test("malformed runtime inventory clears stale results, reports a settings error, and permits a clean retry", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  bridge.getSettings = async () => structuredClone(demoRuntimeSettings);
  try {
    await controller.start();
    await tick();
    const refresh = controller.actions.onRefreshSettings;
    assert.ok(refresh);
    refresh();
    await tick();
    assert.ok(controller.getSnapshot().runtimeSettings);

    bridge.getSettings = async () => ({ ...structuredClone(demoRuntimeSettings), devices: "not a device list" });
    refresh();
    assert.equal(controller.getSnapshot().runtimeSettings, undefined);
    await tick();
    assert.equal(controller.getSnapshot().settingsLoading, false);
    assert.match(controller.getSnapshot().settingsError ?? "", /设置数据格式不兼容/);
    assert.equal(controller.getSnapshot().runtimeSettings, undefined);
    assert.equal(controller.getSnapshot().error, null);

    bridge.getSettings = async () => structuredClone(demoRuntimeSettings);
    refresh();
    assert.equal(controller.getSnapshot().settingsError, undefined);
    await tick();
    assert.deepEqual(controller.getSnapshot().runtimeSettings, parseRuntimeSettings(demoRuntimeSettings));
    assert.equal(controller.getSnapshot().settingsLoading, false);
    assert.equal(controller.getSnapshot().settingsError, undefined);
    assert.ok(bridge.calls.every((call) => call.method === "bootstrap"));
  } finally {
    controller.dispose();
  }
});

test("runtime inspection on an unsupported desktop bridge fails without a fallback mutation", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  try {
    await controller.start();
    await tick();
    controller.actions.onSelectConversation("chat-demo");
    const before = controller.getSnapshot();
    const refresh = controller.actions.onRefreshSettings;
    assert.ok(refresh);
    refresh();
    await tick();

    const after = controller.getSnapshot();
    assert.match(after.settingsError ?? "", /更新桌面桥接组件/);
    assert.equal(after.settingsLoading, false);
    assert.equal(after.runtimeSettings, undefined);
    assert.equal(after.error, null);
    assert.deepEqual(after.messages, before.messages);
    assert.equal(after.activeConversationId, before.activeConversationId);
    assert.deepEqual(bridge.calls.map((call) => call.method), ["bootstrap"]);
  } finally {
    controller.dispose();
  }
});

test("offline runtime inspection does not invoke the settings bridge", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  let calls = 0;
  bridge.getSettings = async () => {
    calls++;
    return structuredClone(demoRuntimeSettings);
  };
  try {
    await controller.start();
    await tick();
    bridge.change(2, "disconnected");
    const refresh = controller.actions.onRefreshSettings;
    assert.ok(refresh);
    refresh();
    await tick();
    assert.equal(calls, 0);
    assert.match(controller.getSnapshot().settingsError ?? "", /请先连接 Lorca/);
    assert.equal(controller.getSnapshot().settingsLoading, false);
    assert.equal(controller.getSnapshot().runtimeSettings, undefined);
  } finally {
    controller.dispose();
  }
});

test("runtime settings parser accepts ready and unavailable inventories with detached typed values", () => {
  const source = structuredClone(demoRuntimeSettings);
  const parsed = parseRuntimeSettings(source);
  assert.deepEqual(structuredClone(parsed), source);
  source.devices[0].plugins[0].name = "Changed source plugin";
  assert.equal(parsed.devices[0].plugins[0].name, "Demo notes");
  assert.deepEqual(
    parseRuntimeSettings({
      ...demoRuntimeSettings,
      authMode: "legacy",
      devices: [],
      providers: [],
      bots: [],
      mcp: { status: "unavailable", runnerId: null, hasConfigError: true, servers: [] },
    }).mcp,
    { status: "unavailable", runnerId: null, hasConfigError: true, servers: [] },
  );
  const unknownConfiguration = parseRuntimeSettings({
    ...demoRuntimeSettings,
    bots: [{ ...demoRuntimeSettings.bots[0], provider: null, model: null }],
    mcp: {
      ...demoRuntimeSettings.mcp,
      servers: [{ ...demoRuntimeSettings.mcp.servers[0], toolCount: null, hiddenToolCount: null }],
    },
  });
  assert.equal(unknownConfiguration.bots[0].provider, null);
  assert.equal(unknownConfiguration.bots[0].model, null);
  assert.equal(unknownConfiguration.mcp.servers[0].toolCount, null);
  assert.equal(unknownConfiguration.mcp.servers[0].hiddenToolCount, null);
});

test("runtime settings parser rejects malformed inventory fields and bounded collections", () => {
  const device = demoRuntimeSettings.devices[0];
  const server = demoRuntimeSettings.mcp.servers[0];
  const malformed: unknown[] = [
    null,
    [],
    { ...demoRuntimeSettings, version: "x".repeat(501) },
    { ...demoRuntimeSettings, hasIdentity: "true" },
    { ...demoRuntimeSettings, authMode: "none" },
    { ...demoRuntimeSettings, devices: "wrong" },
    { ...demoRuntimeSettings, devices: Array.from({ length: 1001 }, () => device) },
    { ...demoRuntimeSettings, devices: [{ ...device, online: 1 }] },
    { ...demoRuntimeSettings, devices: [{ ...device, plugins: [{ ...device.plugins[0], toolCount: -1 }] }] },
    { ...demoRuntimeSettings, providers: [{ ...demoRuntimeSettings.providers[0], connected: null }] },
    { ...demoRuntimeSettings, bots: [{ ...demoRuntimeSettings.bots[0], runnerId: null }] },
    { ...demoRuntimeSettings, mcp: { ...demoRuntimeSettings.mcp, status: "loading" } },
    { ...demoRuntimeSettings, mcp: { ...demoRuntimeSettings.mcp, runnerId: 4 } },
    { ...demoRuntimeSettings, mcp: { ...demoRuntimeSettings.mcp, servers: [{ ...server, transport: "socket" }] } },
    { ...demoRuntimeSettings, mcp: { ...demoRuntimeSettings.mcp, servers: [{ ...server, transport: ["stdio"] }] } },
    { ...demoRuntimeSettings, mcp: { ...demoRuntimeSettings.mcp, servers: [{ ...server, toolCount: 0.5 }] } },
    { ...demoRuntimeSettings, mcp: { ...demoRuntimeSettings.mcp, servers: [{ ...server, hiddenToolCount: Number.MAX_SAFE_INTEGER + 1 }] } },
    { ...demoRuntimeSettings, mcp: { ...demoRuntimeSettings.mcp, servers: [{ ...server, hasError: "false" }] } },
  ];
  for (const [index, value] of malformed.entries())
    assert.throws(() => parseRuntimeSettings(value), Error, `Malformed fixture ${index} must be rejected`);
});

test("Chinese controller labels preserve original user text, tool content, and bot names", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  const opening = demoSnapshot.chats[0].messages[0];
  bridge.handler = async () => ({
    ...structuredClone(demoSnapshot),
    bots: [{ ...demoSnapshot.bots[0], name: "Original Bot Name" }],
    chats: [
      {
        ...demoSnapshot.chats[0],
        messages: [
          { ...opening, id: "original-user", body: { kind: "text", text: "Original user text stays in English." } },
          {
            ...opening,
            id: "command-approval",
            body: {
              kind: "tool",
              name: "Original Tool Name",
              summary: "Original tool summary",
              detail: "Original tool detail",
              is_running: false,
              run: {
                state: "asking",
                command: "printf 'Hello'",
                reason: "Original command reason",
                rule: "command.startsWith('printf')",
              },
            },
          },
          {
            ...opening,
            id: "connection-approval",
            body: {
              kind: "permission",
              plugin_id: "original-plugin",
              plugin_name: "Original Plugin Name",
              tool: "connect",
              summary: "Original permission summary",
              decision: "pending",
            },
          },
          { ...opening, id: "unsupported-message", body: { kind: "future.custom" } },
          { ...opening, id: "queued-notice", queued: true, body: { kind: "notice", text: "Original queued notice" } },
        ],
      },
      { ...demoSnapshot.chats[0], id: "unnamed-chat", bot_ids: [], messages: [] },
      { ...demoSnapshot.chats[0], id: "unknown-bot-chat", bot_ids: ["missing-bot"], messages: [] },
    ],
  });
  try {
    await controller.start();
    await tick();
    controller.actions.onSelectConversation("chat-demo");
    const state = controller.getSnapshot();
    assert.equal(state.agents[0].label, "Original Bot Name");
    assert.equal(state.conversations.find((chat) => chat.id === "chat-demo")?.title, "Original Bot Name");
    assert.equal(state.conversations.find((chat) => chat.id === "unnamed-chat")?.title, "对话");
    assert.equal(state.conversations.find((chat) => chat.id === "unknown-bot-chat")?.title, "机器人");
    const user = state.messages.find((item) => item.id === "original-user");
    assert.ok(user?.kind === "message");
    assert.equal(user.text, "Original user text stays in English.");
    const command = state.messages.find((item) => item.id === "command-approval");
    assert.ok(command?.kind === "approval");
    assert.equal(command.title, "运行命令");
    assert.equal(command.detail, "printf 'Hello'\n\nOriginal command reason\n\n始终允许规则：command.startsWith('printf')");
    const connection = state.messages.find((item) => item.id === "connection-approval");
    assert.ok(connection?.kind === "approval");
    assert.equal(connection.title, "Original Plugin Name · connect");
    assert.equal(connection.detail, "Original permission summary\n\n请在 Lorca 客户端中管理访问权限或登录。");
    const unsupported = state.messages.find((item) => item.id === "unsupported-message");
    assert.ok(unsupported?.kind === "notice");
    assert.equal(unsupported.text, "dots 暂不支持此消息类型（future.custom）。请在 Lorca 客户端中查看。");
    assert.equal(state.queue[0].text, "排队中的消息");
    assert.match(state.connection.detail ?? "", /中继离线/);
    bridge.event({ event: "relay.status", data: { connected: true } });
    assert.match(controller.getSnapshot().connection.detail ?? "", /中继已同步/);
    bridge.status = { ...bridge.status, authMode: "legacy" };
    bridge.change(bridge.status.generation);
    assert.equal(controller.getSnapshot().connection.detail, "dots · 旧版回环模式 · 本地连接未进行身份验证");
  } finally {
    controller.dispose();
  }
});

test("dots branding preserves an actual bot, conversation, and provider named Lorca", async () => {
  const bridge = new FakeBridge(),
    controller = new LorcaController(bridge);
  const source = structuredClone(demoSnapshot);
  source.bots[0].name = "Lorca";
  bridge.handler = async () => ({
    ...source,
    chats: source.chats.map((chat, index) => index === 0 ? { ...chat, title: "Lorca" } : chat),
  });
  try {
    await controller.start();
    await tick();
    controller.actions.onSelectConversation("chat-demo");
    const state = controller.getSnapshot();
    assert.equal(state.agents[0].label, "Lorca");
    assert.equal(state.conversations.find((chat) => chat.id === "chat-demo")?.title, "Lorca");
    const assistant = state.messages.find((item) => item.kind === "message" && item.role === "assistant");
    assert.ok(assistant?.kind === "message");
    assert.equal(assistant.authorName, "Lorca");
    assert.match(state.connection.detail ?? "", /^dots · 运行环境 /);
    const settings = parseRuntimeSettings({
      ...demoRuntimeSettings,
      providers: [{ ...demoRuntimeSettings.providers[0], name: "Lorca" }],
      bots: [{ ...demoRuntimeSettings.bots[0], name: "Lorca" }],
    });
    assert.equal(settings.providers[0].name, "Lorca");
    assert.equal(settings.bots[0].name, "Lorca");
  } finally {
    controller.dispose();
  }
});

test("Chinese parser diagnostics retain the offending protocol field identifiers", () => {
  assert.throws(
    () => parseSnapshot({ ...demoSnapshot, bots: "malformed" }),
    /^ProtocolError: Lorca 返回的数据不兼容：bots$/,
  );
  assert.throws(
    () => parseRuntimeSettings({ ...demoRuntimeSettings, authMode: "malformed" }),
    /^Error: 设置数据格式不兼容：authMode$/,
  );
  assert.throws(
    () => parseRuntimeSettings({
      ...demoRuntimeSettings,
      devices: [{ ...demoRuntimeSettings.devices[0], isThisDevice: "malformed" }],
    }),
    /^Error: 设置数据格式不兼容：devices\.isThisDevice$/,
  );
});
