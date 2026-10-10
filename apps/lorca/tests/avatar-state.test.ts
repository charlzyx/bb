import assert from "node:assert/strict";
import test from "node:test";
import { crc32 } from "node:zlib";
import type { BridgeStatus, LorcaBridge } from "../src/core/bridge";
import { LorcaController } from "../src/core/controller";
import { demoSnapshot } from "../src/core/demo";
import { parseBot, parseEvent, parseSnapshot } from "../src/core/protocol";
import { applyEvent, applySnapshot, emptyModel } from "../src/core/store";

const imageOne = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPIiL/7HwAFewKko95aIwAAAABJRU5ErkJggg==";
const imageTwo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMwW9D6HwAExgJbeku3ugAAAABJRU5ErkJggg==";
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const bot = (id = "bot-demo", version: string | null = "revision-one") => ({
  id, name: `Synthetic ${id}`, runner_id: "runner-demo", symbol_name: "terminal.fill",
  accent: "teal", has_avatar: true, avatar_version: version,
});
const snapshot = () => ({ ...structuredClone(demoSnapshot), bots: [bot()] });
function deferred() {
  let resolve!: (value: string | null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string | null>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class AvatarBridge implements LorcaBridge {
  status: BridgeStatus = { status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token" };
  snapshot = snapshot();
  calls: string[] = [];
  images: { botId: string; version: string; result: ReturnType<typeof deferred> }[] = [];
  events = new Set<(value: unknown) => void>();
  statuses = new Set<(status: BridgeStatus) => void>();
  getStatus = async () => this.status;
  connect = async (endpoint: string) => { this.change({ endpoint, generation: this.status.generation + 1 }); return this.status; };
  request = async (method: string) => {
    this.calls.push(method);
    assert.equal(method, "bootstrap");
    return structuredClone(this.snapshot);
  };
  getBotAvatar?: LorcaBridge["getBotAvatar"] = (botId, version) => {
    const result = deferred();
    this.images.push({ botId, version, result });
    return result.promise;
  };
  onEvent = (callback: (value: unknown) => void) => { this.events.add(callback); return () => { this.events.delete(callback); }; };
  onStatus = (callback: (status: BridgeStatus) => void) => { this.statuses.add(callback); return () => { this.statuses.delete(callback); }; };
  event(value: unknown) { for (const callback of this.events) callback(value); }
  roster() { this.event({ event: "roster.changed", data: this.snapshot }); }
  change(change: Partial<BridgeStatus>) {
    this.status = { ...this.status, ...change };
    for (const callback of this.statuses) callback(this.status);
  }
  identity() {
    this.snapshot.identity_id = "second-account";
    this.event({ event: "identity.changed", data: { has_identity: true } });
  }
}
const appearance = (controller: LorcaController, id = "bot-demo") => controller.getSnapshot().agents.find(agent => agent.id === id)?.appearance;

test("appearance metadata has backwards-compatible safe defaults and drops raw attachment information", () => {
  const basic = { id: "bot-one", name: "Synthetic bot", runner_id: "runner-one" };
  const defaults = { ...basic, symbol_name: "sparkles", accent: "indigo", has_avatar: false, avatar_version: null };
  assert.deepEqual(parseBot(basic), defaults);
  assert.deepEqual(parseBot({ ...basic, symbol_name: {}, accent: ["red"], has_avatar: "true", avatar_version: 42 }), defaults);
  assert.deepEqual(parseBot({ ...basic, symbol_name: "url(file:///private/avatar)", accent: "red;background:url(https://example.test)", has_avatar: 1, avatar_version: "" }), defaults);
  assert.deepEqual(parseBot({ ...basic, symbol_name: "s".repeat(81), accent: "unknown", avatar_version: "v".repeat(513), avatar: { path: "/private/avatar", key: "secret", id: "attachment" } }), defaults);
  assert.deepEqual(parseBot({ ...basic, symbol_name: "terminal.fill", accent: "purple", has_avatar: true, avatar_version: "opaque-version" }), { ...basic, symbol_name: "terminal.fill", accent: "purple", has_avatar: true, avatar_version: "opaque-version" });
});

test("snapshot and roster preserve parsed appearance metadata and conversation pages", () => {
  const raw = snapshot();
  let model = applySnapshot(emptyModel(), parseSnapshot(raw));
  assert.deepEqual(model.bots.get("bot-demo"), raw.bots[0]);
  raw.bots[0] = { ...raw.bots[0], symbol_name: "heart.fill", accent: "pink", avatar_version: "revision-two" };
  model = applyEvent(model, parseEvent({ event: "roster.changed", data: raw }));
  assert.deepEqual(model.bots.get("bot-demo"), raw.bots[0]);
  assert.equal(model.chats.get("chat-demo")?.messages.length, raw.chats[0].messages.length);
});

test("DM, group, agent and message avatars use matching bot metadata and original bot ordering", async context => {
  const bridge = new AvatarBridge();
  bridge.snapshot.bots.push({ ...bot("bot-two"), symbol_name: "heart.fill", accent: "pink" }, bot("bot-three"));
  bridge.snapshot.chats[1].bot_ids = ["bot-two", "bot-demo", "bot-three"];
  bridge.snapshot.chats[0].messages[1].author.bot_id = "bot-two";
  const controller = new LorcaController(bridge); context.after(() => controller.dispose());
  await controller.start(); await tick(); controller.actions.onSelectConversation("chat-demo");
  const state = controller.getSnapshot();
  assert.deepEqual(state.conversations.find(chat => chat.id === "chat-demo")?.avatars?.map(item => item.botId), ["bot-demo"]);
  assert.deepEqual(state.conversations.find(chat => chat.id === "chat-demo-notes")?.avatars?.map(item => item.botId), ["bot-two", "bot-demo", "bot-three"]);
  const assistant = state.messages[1], user = state.messages[0];
  assert.equal(assistant.kind === "message" && assistant.authorAvatar?.botId, "bot-two");
  assert.equal(assistant.kind === "message" && assistant.authorAvatar?.symbolName, "heart.fill");
  assert.equal(user.kind === "message" && user.authorAvatar, undefined);
  assert.deepEqual(appearance(controller, "bot-two"), { botId: "bot-two", name: "Synthetic bot-two", symbolName: "heart.fill", accent: "pink", image: undefined });
  bridge.images.find(request => request.botId === "bot-two")!.result.resolve(imageOne); await tick();
  const rendered = controller.getSnapshot().messages[1];
  assert.equal(rendered.kind === "message" && rendered.authorAvatar?.image, imageOne);
});

test("one avatar request serves all views and deduplicates repeated snapshots and rosters", async context => {
  const bridge = new AvatarBridge(), controller = new LorcaController(bridge);
  context.after(() => controller.dispose()); await controller.start(); await tick();
  controller.actions.onSelectConversation("chat-demo");
  await controller.refresh(); bridge.roster();
  assert.equal(bridge.images.length, 1);
  bridge.images[0].result.resolve(imageOne); await tick();
  bridge.snapshot.bots[0].name = "Renamed synthetic bot";
  bridge.roster(); await controller.refresh();
  assert.equal(bridge.images.length, 1);
  assert.equal(appearance(controller)?.image, imageOne);
  assert.equal(appearance(controller)?.name, "Renamed synthetic bot");
  assert.ok(controller.getSnapshot().conversations.every(chat => chat.avatars?.[0].image === imageOne));
  assert.equal(controller.getSnapshot().error, null);
});

for (const outcome of ["null", "rejected"] as const) {
  test(`avatar ${outcome} falls back silently and is cached until reconnect`, async context => {
    const bridge = new AvatarBridge(), controller = new LorcaController(bridge);
    context.after(() => controller.dispose()); await controller.start(); await tick();
    if (outcome === "null") bridge.images[0].result.resolve(null);
    else bridge.images[0].result.reject(new Error("Synthetic missing local image"));
    await tick(); await controller.refresh(); bridge.roster();
    assert.equal(bridge.images.length, 1);
    assert.equal(appearance(controller)?.image, undefined);
    assert.equal(appearance(controller)?.symbolName, "terminal.fill");
    assert.equal(controller.getSnapshot().error, null);
    bridge.change({ generation: 2 }); await tick();
    assert.equal(bridge.images.length, 2);
  });
}

test("avatar loading caps outstanding requests at four and drains in roster order", async context => {
  const bridge = new AvatarBridge();
  bridge.snapshot.bots = Array.from({ length: 9 }, (_, index) => bot(`bot-${index}`));
  const controller = new LorcaController(bridge); context.after(() => controller.dispose());
  await controller.start(); await tick();
  assert.deepEqual(bridge.images.map(request => request.botId), ["bot-0", "bot-1", "bot-2", "bot-3"]);
  bridge.images[0].result.resolve(imageOne); await tick();
  assert.equal(bridge.images.length, 5);
  bridge.images[1].result.reject(new Error("Synthetic fallback")); await tick();
  assert.equal(bridge.images.length, 6);
  for (let index = 2; index < 9; index++) {
    bridge.images[index].result.resolve(null); await tick();
    assert.ok(bridge.images.length <= index + 5);
  }
  assert.deepEqual(bridge.images.map(request => request.botId), bridge.snapshot.bots.map(item => item.id));
  assert.equal(controller.getSnapshot().error, null);
});

test("large rosters load at most 64 entries and navigation admits bots beyond the initial window", async context => {
  const bridge = new AvatarBridge();
  bridge.snapshot.bots = Array.from({ length: 80 }, (_, index) => bot(`bot-${index}`));
  bridge.snapshot.chats = bridge.snapshot.bots.map((entry, index) => ({
    ...structuredClone(demoSnapshot.chats[1]), id: `chat-${index}`, bot_ids: [entry.id], created_at: 1000 - index,
  }));
  bridge.snapshot.chats[79].messages = [{ ...structuredClone(demoSnapshot.chats[0].messages[1]), chat_id: "chat-79", author: { kind: "bot", bot_id: "bot-78" }, created_at: 0 }];
  const controller = new LorcaController(bridge); context.after(() => controller.dispose());
  await controller.start(); await tick();
  for (let index = 0; index < 64; index++) { bridge.images[index].result.resolve(imageOne); await tick(); }
  assert.equal(bridge.images.length, 64);
  assert.equal(controller.getSnapshot().agents.filter(agent => agent.appearance?.image).length, 64);
  controller.actions.onSelectConversation("chat-79"); await tick();
  assert.equal(bridge.images.length, 66);
  assert.equal(bridge.images[64].botId, "bot-79");
  assert.equal(bridge.images[65].botId, "bot-78");
  bridge.images[64].result.resolve(imageTwo); await tick();
  bridge.images[65].result.resolve(imageOne); await tick();
  assert.equal(appearance(controller, "bot-79")?.image, imageTwo);
  const message = controller.getSnapshot().messages[0];
  assert.equal(message.kind === "message" && message.authorAvatar?.image, imageOne);
  assert.equal(controller.getSnapshot().agents.filter(agent => agent.appearance?.image).length, 64);
  assert.equal(appearance(controller, "bot-63")?.image, undefined);
});

test("new sessions share the four-request concurrency cap while obsolete loads settle", async context => {
  const bridge = new AvatarBridge(); bridge.snapshot.bots = Array.from({ length: 6 }, (_, index) => bot(`bot-${index}`));
  const controller = new LorcaController(bridge); context.after(() => controller.dispose());
  await controller.start(); await tick();
  assert.equal(bridge.images.length, 4);
  bridge.change({ generation: 2 }); await tick();
  assert.equal(bridge.images.length, 4);
  bridge.images[0].result.resolve(imageOne); await tick();
  assert.equal(bridge.images.length, 5);
  assert.equal(appearance(controller, "bot-0")?.image, undefined);
  bridge.images[4].result.resolve(imageTwo); await tick();
  assert.equal(appearance(controller, "bot-0")?.image, imageTwo);
  assert.equal(bridge.images.length, 6);
});

test("navigation reuses an identical pending request when a bot leaves and reenters the bounded window", async context => {
  const bridge = new AvatarBridge();
  bridge.snapshot.bots = Array.from({ length: 80 }, (_, index) => bot(`bot-${index}`));
  bridge.snapshot.chats = bridge.snapshot.bots.map((entry, index) => ({
    ...structuredClone(demoSnapshot.chats[1]), id: `chat-${index}`, bot_ids: [entry.id], created_at: 1000 - index,
  }));
  const controller = new LorcaController(bridge); context.after(() => controller.dispose());
  await controller.start(); await tick();
  for (let index = 0; index < 64; index++) { bridge.images[index].result.resolve(imageOne); await tick(); }
  bridge.snapshot.bots[63].avatar_version = "revision-two"; bridge.roster();
  assert.equal(bridge.images[64].botId, "bot-63");
  controller.actions.onSelectConversation("chat-79");
  assert.equal(bridge.images.length, 66);
  controller.actions.onSelectConversation("chat-63");
  assert.equal(bridge.images.length, 66);
  bridge.images[64].result.resolve(imageTwo); await tick();
  assert.equal(appearance(controller, "bot-63")?.image, imageTwo);
});

test("renderer PNG cache stays below 8 MiB and prioritizes the active conversation", async context => {
  const original = Buffer.from(imageOne.split(",")[1], "base64"), data = Buffer.from("fixture\0" + "a".repeat(450000));
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length); chunk.write("tEXt", 4); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  const largeImage = "data:image/png;base64," + Buffer.concat([original.subarray(0, -12), chunk, original.subarray(-12)]).toString("base64");
  const bridge = new AvatarBridge();
  bridge.snapshot.bots = Array.from({ length: 12 }, (_, index) => bot(`bot-${index}`));
  bridge.snapshot.chats[0].bot_ids = ["bot-11"];
  const controller = new LorcaController(bridge); context.after(() => controller.dispose());
  await controller.start(); await tick();
  for (let index = 0; index < 12; index++) { bridge.images[index].result.resolve(largeImage); await tick(); }
  const imageBytes = () => controller.getSnapshot().agents.reduce((bytes, agent) => bytes + (agent.appearance?.image?.length ?? 0) * 2, 0);
  assert.ok(imageBytes() > 0 && imageBytes() <= 8 * 1024 * 1024);
  const evicted = controller.getSnapshot().agents.find(agent => !agent.appearance?.image)!;
  controller.actions.onNewConversation(); controller.actions.onSelectAgent(evicted.id); await tick();
  for (let index = 12; index < bridge.images.length; index++) { bridge.images[index].result.resolve(largeImage); await tick(); }
  assert.equal(appearance(controller, evicted.id)?.image, largeImage);
  assert.ok(imageBytes() <= 8 * 1024 * 1024);
});

test("negative avatar caching permits one explicit refresh retry after five seconds without loops", async context => {
  let now = 1000; context.mock.method(Date, "now", () => now);
  const bridge = new AvatarBridge(), controller = new LorcaController(bridge);
  context.after(() => controller.dispose()); await controller.start(); await tick();
  bridge.images[0].result.resolve(null); await tick();
  now += 4999; await controller.refresh();
  assert.equal(bridge.images.length, 1);
  now++; bridge.roster(); controller.actions.onSelectConversation("chat-demo"); await tick();
  assert.equal(bridge.images.length, 1);
  await controller.refresh();
  assert.equal(bridge.images.length, 2);
  bridge.images[1].result.reject(new Error("Synthetic unreadable cache")); await tick();
  now += 10000; await controller.refresh(); bridge.roster();
  assert.equal(bridge.images.length, 2);
  assert.equal(controller.getSnapshot().error, null);
});

test("roster avatar version changes discard a pending old image without replacing the newer one", async context => {
  const bridge = new AvatarBridge(), controller = new LorcaController(bridge);
  context.after(() => controller.dispose()); await controller.start(); await tick();
  bridge.snapshot.bots[0].avatar_version = "revision-two"; bridge.roster();
  assert.equal(bridge.images.length, 2);
  assert.deepEqual(bridge.images.map(request => request.version), ["revision-one", "revision-two"]);
  bridge.images[1].result.resolve(imageTwo); await tick();
  bridge.images[0].result.resolve(imageOne); await tick();
  assert.equal(appearance(controller)?.image, imageTwo);
  bridge.snapshot.bots[0].avatar_version = "revision-three"; bridge.roster();
  assert.equal(appearance(controller)?.image, undefined);
  assert.equal(bridge.images.length, 3);
});

test("removed bots are pruned and a re-added identical version cannot accept the old pending image", async context => {
  const bridge = new AvatarBridge(), controller = new LorcaController(bridge);
  context.after(() => controller.dispose()); await controller.start(); await tick();
  bridge.snapshot.bots = []; bridge.roster();
  assert.equal(appearance(controller), undefined);
  bridge.snapshot.bots = [bot()]; bridge.roster();
  assert.equal(bridge.images.length, 2);
  bridge.images[0].result.resolve(imageOne); await tick();
  assert.equal(appearance(controller)?.image, undefined);
  bridge.images[1].result.resolve(imageTwo); await tick();
  assert.equal(appearance(controller)?.image, imageTwo);
  bridge.snapshot.bots[0].has_avatar = false; bridge.roster();
  assert.equal(appearance(controller)?.image, undefined);
  assert.equal(bridge.images.length, 2);
});

for (const boundary of ["generation", "identity event", "identity snapshot", "endpoint status", "saved endpoint", "disconnect"] as const) {
  test(`avatar results are fenced across ${boundary} even when bot and revision match`, async context => {
    const bridge = new AvatarBridge(), controller = new LorcaController(bridge);
    context.after(() => controller.dispose()); await controller.start(); await tick();
    if (boundary === "generation") bridge.change({ generation: 2 });
    if (boundary === "identity event") bridge.identity();
    if (boundary === "identity snapshot") { bridge.snapshot.identity_id = "second-account"; await controller.refresh(); }
    if (boundary === "endpoint status") bridge.change({ endpoint: "ws://127.0.0.1:4863/ws" });
    if (boundary === "saved endpoint") await controller.actions.onSaveEndpoint("ws://127.0.0.1:4863/ws");
    if (boundary === "disconnect") {
      bridge.change({ status: "disconnected" });
      bridge.images[0].result.resolve(imageOne); await tick();
      assert.equal(appearance(controller)?.image, undefined);
      assert.equal(bridge.images.length, 1);
      bridge.change({ status: "connected" });
    }
    await tick();
    assert.equal(bridge.images.length, 2);
    bridge.images[1].result.resolve(imageTwo); await tick();
    if (boundary !== "disconnect") bridge.images[0].result.resolve(imageOne);
    await tick();
    assert.equal(appearance(controller)?.image, imageTwo);
    assert.equal(controller.getSnapshot().error, null);
  });
}

test("disconnect immediately removes loaded images and retries on reconnect", async context => {
  const bridge = new AvatarBridge(), controller = new LorcaController(bridge);
  context.after(() => controller.dispose()); await controller.start(); await tick();
  bridge.images[0].result.resolve(imageOne); await tick();
  bridge.change({ status: "disconnected" });
  assert.equal(appearance(controller)?.image, undefined);
  bridge.change({ status: "connected" }); await tick();
  assert.equal(bridge.images.length, 2);
});

test("disposed callbacks cannot emit state or start queued requests", async () => {
  const bridge = new AvatarBridge(); bridge.snapshot.bots = Array.from({ length: 5 }, (_, index) => bot(`bot-${index}`));
  const controller = new LorcaController(bridge); await controller.start(); await tick();
  let emissions = 0; controller.subscribe(() => { emissions++; });
  const callbacks = [...bridge.events], state = controller.getSnapshot();
  controller.dispose();
  bridge.images[0].result.resolve(imageOne);
  for (const callback of callbacks) callback({ event: "roster.changed", data: { bots: [], chats: [] } });
  await tick();
  assert.equal(controller.getSnapshot(), state);
  assert.equal(emissions, 0);
  assert.equal(bridge.images.length, 4);
});

test("legacy bridge and unavailable avatar metadata do not issue extra requests", async context => {
  for (const unavailable of ["bridge", "flag", "version"] as const) {
    const bridge = new AvatarBridge();
    if (unavailable === "bridge") bridge.getBotAvatar = undefined;
    if (unavailable === "flag") bridge.snapshot.bots[0].has_avatar = false;
    if (unavailable === "version") bridge.snapshot.bots[0].avatar_version = null;
    const controller = new LorcaController(bridge); context.after(() => controller.dispose());
    await controller.start(); await tick();
    controller.actions.onSelectConversation("chat-demo"); bridge.roster();
    assert.equal(bridge.images.length, 0);
    assert.deepEqual(bridge.calls, ["bootstrap"]);
    assert.equal(appearance(controller)?.image, undefined);
    assert.equal(controller.getSnapshot().error, null);
  }
});

test("only bounded canonical PNG data URLs with valid signature and dimensions reach views", async context => {
  const largeDimensions = Buffer.from(imageOne.split(",")[1], "base64"); largeDimensions.writeUInt32BE(257, 16);
  const malformedChunk = Buffer.from(imageOne.split(",")[1], "base64"); malformedChunk.writeUInt32BE(0xffffffff, 33);
  const invalid: unknown[] = [
    "https://example.test/avatar.png", "file:///private/avatar.png", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,PHN2Zy8+",
    "data:image/png;base64,!!!!", imageOne + "\n", imageOne.slice(0, -1), imageOne.replace("data:image/png", "data:image/PNG"),
    "data:image/png;charset=utf8;base64," + imageOne.split(",")[1], "data:image/png;base64," + "A".repeat(1024 * 1024),
    "data:image/png;base64," + largeDimensions.toString("base64"), "data:image/png;base64," + malformedChunk.toString("base64"),
    imageOne.slice(0, -8), 42, { image: imageOne },
  ];
  for (const value of invalid) {
    const bridge = new AvatarBridge();
    bridge.getBotAvatar = async () => value as string | null;
    const controller = new LorcaController(bridge); context.after(() => controller.dispose());
    await controller.start(); await tick();
    assert.equal(appearance(controller)?.image, undefined);
    assert.equal(controller.getSnapshot().error, null);
  }
});
