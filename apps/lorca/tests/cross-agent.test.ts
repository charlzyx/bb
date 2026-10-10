import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BridgeStatus, LorcaBridge } from "../src/core/bridge";
import { LorcaController } from "../src/core/controller";
import { parseEvent, parseMessage } from "../src/core/protocol";
import { TranscriptItem } from "../src/ui/Transcript";
import type { LorcaMessage } from "../src/ui/types";

const require = createRequire(import.meta.url);
const { sanitizeRendererEvent } = require("../native/settings.cjs");
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPIiL/7HwAFewKko95aIwAAAABJRU5ErkJggg==";
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const bot = (id: string) => ({ id, name: `Synthetic ${id}`, runner_id: "runner", symbol_name: "terminal", accent: "teal", has_avatar: true, avatar_version: `version-${id}` });
const message = (body: Record<string, unknown>, id = "cross-message", state = "complete") => ({
  id, chat_id: "chat", author: { kind: "bot", bot_id: "source" }, body, state: { kind: state }, created_at: 1,
});
const tool = (patch: Record<string, unknown> = {}) => ({
  kind: "tool", name: "message_bot", summary: "Messaged untrusted label", detail: "Synthetic first line\nSynthetic full detail", is_running: false, is_error: false, target_bot_id: "target", ...patch,
});
const handoff = (from = "source", to = "target") => ({ kind: "handoff", from, to, reason: "Synthetic request\nSynthetic second line" });
const snapshot = () => ({
  version: "synthetic", has_identity: true, identity_id: "synthetic-account", relay_connected: false,
  bots: [bot("source"), bot("target")], running_turns: [], running_chat_ids: [],
  chats: [{ id: "chat", kind: "dm", title: "Synthetic chat", bot_ids: ["target"], created_at: 1, has_more: false, messages: [message(handoff())] }],
});

class CrossAgentBridge implements LorcaBridge {
  status: BridgeStatus = { status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token" };
  snapshot = snapshot();
  calls: string[] = [];
  images: string[] = [];
  events = new Set<(event: unknown) => void>();
  getStatus = async () => this.status;
  connect = async () => this.status;
  request = async (method: string) => { this.calls.push(method); assert.equal(method, "bootstrap"); return structuredClone(this.snapshot); };
  getBotAvatar = async (id: string) => { this.images.push(id); return image; };
  onEvent = (callback: (event: unknown) => void) => { this.events.add(callback); return () => { this.events.delete(callback); }; };
  onStatus = () => () => {};
  event(value: unknown) { for (const callback of this.events) callback(value); }
}

function render(message: LorcaMessage) {
  const controller = new LorcaController(new CrossAgentBridge());
  return renderToStaticMarkup(createElement(TranscriptItem, { message, actions: controller.actions, disabled: false }));
}

test("tool target identity is bounded and typed at native and core boundaries without exposing unknown secrets", () => {
  const secret = "SYNTHETIC_SECRET_MUST_NOT_CROSS";
  const raw = message(tool({ arguments: { token: secret }, result: secret, token: secret, target_bot: { name: secret, avatar: secret } }));
  const projected = sanitizeRendererEvent({ event: "message.updated", data: { chat_id: "chat", message: raw } });
  assert.equal(projected.data.message.body.target_bot_id, "target");
  assert.equal(JSON.stringify(projected).includes(secret), false);
  const parsed = parseEvent(projected);
  assert.equal(parsed.event, "message.updated");
  if (parsed.event !== "message.updated") return;
  assert.equal(parsed.data.message.body.kind, "tool");
  if (parsed.data.message.body.kind !== "tool") return;
  assert.equal(parsed.data.message.body.target_bot_id, "target");
  for (const target of [undefined, null, "x".repeat(256)]) {
    const row = message(tool({ target_bot_id: target }));
    const native = sanitizeRendererEvent({ event: "message.added", data: { chat_id: "chat", message: row } });
    const body = parseMessage(native.data.message).body;
    assert.equal(body.kind === "tool" && body.target_bot_id, target ?? null);
  }
  for (const target of ["", " ", "x".repeat(257), "bad\0id", "bad\nid", "bad\rid", 2, {}, []]) {
    const row = message(tool({ target_bot_id: target }));
    assert.throws(() => sanitizeRendererEvent({ event: "message.added", data: { chat_id: "chat", message: row } }));
    assert.throws(() => parseMessage(row), /tool.target_bot_id/);
  }
});

test("handoff projection keeps author and direction IDs while stripping unrecognized fields", () => {
  const raw = message({ ...handoff(), secret: "SYNTHETIC_PRIVATE_FIELD" });
  const native = sanitizeRendererEvent({ event: "message.added", data: { chat_id: "chat", message: raw } });
  assert.deepEqual(native.data.message.body, handoff());
  assert.deepEqual(native.data.message.author, { kind: "bot", bot_id: "source" });
  assert.equal(JSON.stringify(native).includes("SYNTHETIC_PRIVATE_FIELD"), false);
});

test("incoming, outgoing and same-chat handoffs resolve roster names and loaded avatars without sending", async context => {
  const bridge = new CrossAgentBridge(), controller = new LorcaController(bridge);
  context.after(() => controller.dispose());
  bridge.snapshot.chats[0].messages.push(message(tool(), "sent"));
  await controller.start(); await tick(); controller.actions.onSelectConversation("chat"); await tick();
  const [incoming, outgoing] = controller.getSnapshot().messages;
  assert.equal(incoming.kind, "cross-agent");
  assert.equal(outgoing.kind, "cross-agent");
  if (incoming.kind !== "cross-agent" || outgoing.kind !== "cross-agent") return;
  assert.equal(incoming.direction, "incoming");
  assert.equal(incoming.from?.name, "Synthetic source");
  assert.equal(incoming.from?.image, image);
  assert.equal(outgoing.direction, "outgoing");
  assert.equal(outgoing.to?.name, "Synthetic target");
  assert.equal(outgoing.to?.image, image);
  assert.doesNotMatch(render(outgoing), /untrusted label/);
  bridge.snapshot.chats[0].kind = "group";
  bridge.snapshot.chats[0].bot_ids = ["source", "target"];
  await controller.refresh();
  const grouped = controller.getSnapshot().messages[0];
  assert.equal(grouped.kind === "cross-agent" && grouped.direction, "handoff");
  assert.deepEqual(bridge.calls, ["bootstrap", "bootstrap"]);
});

test("unknown and removed bots use an explicit neutral fallback rather than labels or avatars from raw IDs", async context => {
  const bridge = new CrossAgentBridge(), controller = new LorcaController(bridge);
  context.after(() => controller.dispose());
  bridge.snapshot.chats[0].messages = [message(handoff("unknown-raw-source")), message(tool({ target_bot_id: "unknown-raw-target", summary: "Messaged Forged identity" }), "sent")];
  await controller.start(); await tick(); controller.actions.onSelectConversation("chat");
  const [incoming, outgoing] = controller.getSnapshot().messages;
  assert.equal(incoming.kind === "cross-agent" && incoming.from, null);
  assert.equal(outgoing.kind === "cross-agent" && outgoing.to, null);
  const markup = render(incoming) + render(outgoing);
  assert.match(markup, /未知智能体/);
  assert.doesNotMatch(markup, /unknown-raw-source|unknown-raw-target|Forged identity|data-avatar-bot/);
  bridge.event({ event: "message.updated", data: { chat_id: "chat", message: message(handoff()) } });
  const known = controller.getSnapshot().messages[0];
  assert.equal(known.kind === "cross-agent" && known.from?.name, "Synthetic source");
  bridge.snapshot.bots = bridge.snapshot.bots.filter(value => value.id !== "source");
  bridge.event({ event: "roster.changed", data: bridge.snapshot });
  const removed = controller.getSnapshot().messages[0];
  assert.equal(removed.kind === "cross-agent" && removed.from, null);
});

test("running, failed, incomplete and unrelated tool calls never become a sent-message claim", async context => {
  const bridge = new CrossAgentBridge(), controller = new LorcaController(bridge);
  context.after(() => controller.dispose());
  bridge.snapshot.chats[0].messages = [
    message(tool({ is_running: true }), "running"),
    message(tool({ is_error: true }), "failed"),
    message(tool(), "streaming", "streaming"),
    message(tool(), "failed-state", "failed"),
    message(tool({ summary: "Queued target" }), "queued"),
    message(tool({ name: "read" }), "different-tool"),
  ];
  await controller.start(); await tick(); controller.actions.onSelectConversation("chat");
  const rows = controller.getSnapshot().messages;
  assert.equal(rows.length, 6);
  assert.ok(rows.every(row => row.kind === "tool"));
  assert.equal(rows[0].kind === "tool" && rows[0].status, "running");
  assert.equal(rows[1].kind === "tool" && rows[1].status, "error");
  for (const row of rows) assert.doesNotMatch(render(row), /已发消息给/);
});

test("compact rows use native disclosure, retain plain full detail, and escape names and message markup", () => {
  const from = { botId: "source", name: "<img onerror=attack>", symbolName: "terminal", accent: "teal", image };
  const markup = render({ kind: "cross-agent", id: "incoming", direction: "incoming", from, to: null, text: "First line\n<script>attack()</script>\nhttps://synthetic.invalid" });
  assert.match(markup, /<details class="lorca-cross-agent"><summary>/);
  assert.match(markup, /来自/);
  assert.match(markup, /data-avatar-bot="source"/);
  assert.match(markup, /data-avatar-image=""/);
  assert.match(markup, /lorca-cross-agent-preview[^>]*>· First line/);
  assert.match(markup, /&lt;script&gt;attack\(\)&lt;\/script&gt;/);
  assert.match(markup, /&lt;img onerror=attack&gt;/);
  assert.doesNotMatch(markup, /<script|<a |data-user-avatar|target="/);
});

test("visible cross-agent target avatars outrank roster filler within the existing bounded loader", async context => {
  const bridge = new CrossAgentBridge(), controller = new LorcaController(bridge);
  context.after(() => controller.dispose());
  bridge.snapshot.bots = [bot("source"), ...Array.from({ length: 70 }, (_, index) => bot(`filler-${index}`)), bot("target")];
  bridge.snapshot.chats[0].bot_ids = ["source"];
  bridge.snapshot.chats[0].messages = [message(tool())];
  await controller.start(); await tick();
  const initialLoads = bridge.images.length;
  assert.equal(initialLoads, 64);
  assert.equal(bridge.images.includes("target"), false);
  controller.actions.onSelectConversation("chat"); await tick();
  assert.deepEqual(bridge.images.slice(initialLoads), ["target"]);
  assert.ok(controller.getSnapshot().agents.filter(agent => agent.appearance?.image).length <= 64);
  const sent = controller.getSnapshot().messages[0];
  assert.equal(sent.kind === "cross-agent" && sent.to?.image, image);
});
