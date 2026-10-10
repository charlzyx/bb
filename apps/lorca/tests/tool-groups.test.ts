import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LorcaController } from "../src/core/controller";
import type { BridgeStatus, LorcaBridge } from "../src/core/bridge";
import { demoSnapshot } from "../src/core/demo";
import { parseMessage, parseSnapshot } from "../src/core/protocol";
import { appendOlder, applyEvent, applySnapshot, emptyModel, type Model } from "../src/core/store";
import { groupToolRecords, rememberToolExpansion, stableToolGroupIds, toolGroupExpanded, type ToolMessage } from "../src/ui/tool-groups";
import { Transcript } from "../src/ui/Transcript";
import type { LorcaMessage } from "../src/ui/types";

const tool = (id: string, patch: Partial<ToolMessage> = {}): ToolMessage => ({ kind: "tool", id, authorId: "bot-a", name: "Read file", status: "complete", output: "Synthetic result", ...patch });
const toolIds = (messages: readonly LorcaMessage[]) => groupToolRecords(messages).map(entry => entry.kind === "tools" ? entry.messages.map(message => message.id) : entry.message.id);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

class ToolBridge implements LorcaBridge {
  status: BridgeStatus = { status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token" };
  snapshot: unknown = structuredClone(demoSnapshot);
  events = new Set<(event: unknown) => void>();
  getStatus = async () => this.status;
  connect = async () => this.status;
  request = async (method: string) => { assert.equal(method, "bootstrap"); return this.snapshot; };
  onEvent = (callback: (event: unknown) => void) => { this.events.add(callback); return () => { this.events.delete(callback); }; };
  onStatus = () => () => {};
  event(value: unknown) { for (const callback of this.events) callback(value); }
}

const rawTool = (id: string, body: Record<string, unknown> = {}, state: Record<string, unknown> = { kind: "complete" }) => ({
  id, chat_id: "chat-demo", author: { kind: "bot", bot_id: "bot-a" }, created_at: 1, state,
  body: { kind: "tool", name: "read", summary: "Read file", detail: "Synthetic detail", is_running: false, is_error: false, ...body },
});

function render(messages: readonly LorcaMessage[]) {
  const controller = new LorcaController(new ToolBridge());
  return renderToStaticMarkup(createElement(Transcript, { messages, actions: controller.actions, disabled: false }));
}

test("seven consecutive completed records form one display group without claiming a turn", () => {
  const rows = Array.from({ length: 7 }, (_, index) => tool(`tool-${index}`));
  assert.deepEqual(toolIds(rows), [rows.map(row => row.id)]);
  assert.equal(toolGroupExpanded(rows, new Map()), false);
  const markup = render(rows);
  assert.match(markup, /data-tool-count="7"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /lorca-tool-group-items" hidden=""/);
  assert.doesNotMatch(markup, /同一轮|回合|turn|job-/);
});

test("every non-tool message is a hard display boundary", () => {
  const boundaries: LorcaMessage[] = [
    { kind: "message", id: "assistant", role: "assistant", text: "An explanation" },
    { kind: "message", id: "user", role: "user", text: "Another request" },
    { kind: "message", id: "empty-assistant", role: "assistant", text: "", streaming: true },
    { kind: "approval", id: "approval", title: "Permission", detail: "Synthetic command", status: "pending", canAlways: true },
    { kind: "notice", id: "notice", text: "Notice", tone: "info" },
    { kind: "cross-agent", id: "handoff", direction: "incoming", from: null, to: null, text: "Incoming message" },
  ];
  for (const boundary of boundaries) assert.deepEqual(toolIds([tool("before"), boundary, tool("after")]), [["before"], boundary.id, ["after"]]);
});

test("different authors and a known versus unknown author do not merge", () => {
  assert.deepEqual(toolIds([tool("a"), tool("b", { authorId: "bot-b" }), tool("unknown", { authorId: null }), tool("a-again")]), [["a"], ["b"], ["unknown"], ["a-again"]]);
});

test("observed display boundaries split groups without synthesizing a turn identifier", () => {
  assert.deepEqual(toolIds([
    tool("history-a"), tool("history-b"),
    tool("live-a", { observedBoundary: "observed:1" }), tool("live-b", { observedBoundary: "observed:1" }),
    tool("next", { observedBoundary: "observed:2" }), tool("unknown", { observedBoundary: null }),
  ]), [["history-a", "history-b"], ["live-a", "live-b"], ["next"], ["unknown"]]);
});

test("duplicate summaries use message IDs for expansion instead of names", () => {
  const rows = [tool("one"), tool("two")];
  const choices = rememberToolExpansion(new Map(), ["one"], true);
  assert.equal(choices.get("one"), true);
  assert.equal(choices.has("two"), false);
  assert.equal(toolGroupExpanded(rows, choices), true);
  assert.equal(groupToolRecords(rows).length, 1);
  const markup = render(rows);
  assert.match(markup, /data-tool-id="one"/);
  assert.match(markup, /data-tool-id="two"/);
});

test("manual expansion survives output updates, appended records and historical prepend", () => {
  const original = [tool("one", { status: "running" }), tool("two")];
  const choices = rememberToolExpansion(new Map(), original.map(row => row.id), true);
  const completed = [tool("one", { output: "Updated output" }), tool("two")];
  for (const rows of [completed, [...completed, tool("three")], [tool("older"), ...completed]]) assert.equal(toolGroupExpanded(rows, choices), true);
  assert.equal(groupToolRecords([tool("older"), ...completed])[0].kind, "tools");
  assert.equal(choices.has("older"), false);
});

test("manual collapse is not undone by streaming updates or a new adjacent record", () => {
  const choices = rememberToolExpansion(new Map(), ["one", "two"], false);
  assert.equal(toolGroupExpanded([tool("one", { status: "running", output: "Changed" }), tool("two"), tool("three")], choices), false);
  assert.equal(toolGroupExpanded([tool("one"), tool("two", { status: "error" })], choices), false);
});

test("mixed choices preserve an explicitly expanded member after regrouping", () => {
  let choices = rememberToolExpansion(new Map(), ["one"], false);
  choices = rememberToolExpansion(choices, ["two"], true);
  assert.equal(toolGroupExpanded([tool("one"), tool("two")], choices), true);
  assert.equal(toolGroupExpanded([tool("one")], choices), false);
  assert.equal(toolGroupExpanded([tool("two")], choices), true);
});

test("expansion memory is bounded and refreshing a choice keeps it most recent", () => {
  const original = new Map(Array.from({ length: 4000 }, (_, index) => [`id-${index}`, false] as const));
  const recent = rememberToolExpansion(original, ["id-0"], true);
  const bounded = rememberToolExpansion(recent, ["new"], true);
  assert.equal(original.size, 4000);
  assert.equal(original.get("id-0"), false);
  assert.equal(bounded.size, 4000);
  assert.equal(bounded.get("id-0"), true);
  assert.equal(bounded.has("id-1"), false);
});

test("group keys retain the original member anchor after history prepend, stream append and output update", () => {
  const anchors = new Map<string, string>();
  const stable = (messages: LorcaMessage[]) => stableToolGroupIds(groupToolRecords(messages), anchors);
  const first = stable([tool("one"), tool("two")]);
  assert.equal(first[0].kind === "tools" && first[0].id, "one");
  const changed = stable([tool("older"), tool("one", { output: "Changed" }), tool("two"), tool("three")]);
  assert.equal(changed[0].kind === "tools" && changed[0].id, "one");
  assert.ok(["older", "one", "two", "three"].every(id => anchors.get(id) === "one"));
});

test("splitting a prepended group never reuses its anchor key twice", () => {
  const anchors = new Map<string, string>();
  stableToolGroupIds(groupToolRecords([tool("one"), tool("two")]), anchors);
  stableToolGroupIds(groupToolRecords([tool("older"), tool("one"), tool("two")]), anchors);
  const messages: LorcaMessage[] = [tool("older"), { kind: "message", id: "separator", role: "assistant", text: "Boundary" }, tool("one"), tool("two")];
  const split = stableToolGroupIds(groupToolRecords(messages), anchors);
  const keys = split.flatMap(entry => entry.kind === "tools" ? [entry.id] : []);
  assert.equal(keys.length, 2);
  assert.equal(new Set(keys).size, 2);
  assert.deepEqual(stableToolGroupIds(groupToolRecords(messages), anchors).flatMap(entry => entry.kind === "tools" ? [entry.id] : []), keys);
});

test("ordinary splits and later merges preserve an existing key without losing member choices", () => {
  const anchors = new Map<string, string>();
  const all = [tool("one"), tool("two"), tool("three")];
  const choices = rememberToolExpansion(new Map(), ["two"], true);
  stableToolGroupIds(groupToolRecords(all), anchors);
  const split = stableToolGroupIds(groupToolRecords([all[0], { kind: "notice", id: "notice", text: "Boundary", tone: "info" }, ...all.slice(1)]), anchors);
  assert.deepEqual(split.flatMap(entry => entry.kind === "tools" ? [entry.id] : []), ["one", "two"]);
  const merged = stableToolGroupIds(groupToolRecords(all), anchors);
  assert.equal(merged[0].kind === "tools" && merged[0].id, "one");
  assert.equal(toolGroupExpanded(all, choices), true);
});

test("group anchor metadata remains bounded for large histories", () => {
  const anchors = new Map<string, string>();
  stableToolGroupIds(groupToolRecords(Array.from({ length: 4005 }, (_, index) => tool(`record-${index}`))), anchors);
  assert.equal(anchors.size, 4000);
  assert.equal(anchors.has("record-0"), false);
  assert.equal(anchors.has("record-4004"), true);
});

test("running status is visible outside a collapsed group and uses only daemon summary", () => {
  const markup = render([tool("done"), tool("running", { status: "running", name: "Synthetic live status" })]);
  assert.match(markup, /aria-expanded="false"/);
  const live = markup.indexOf('class="lorca-tool-live"');
  const details = markup.indexOf('class="lorca-tool-group-items"');
  assert.ok(live >= 0 && live < details);
  assert.match(markup.slice(live, details), /Synthetic live status/);
  assert.doesNotMatch(markup, /\d+%|正在分析你的|预计/);
});

test("errors default open with a visible alert while approval actions remain outside groups", () => {
  const markup = render([
    tool("done"), tool("error", { status: "error", name: "Synthetic failure", output: "Failure detail" }),
    { kind: "approval", id: "approve", title: "Permission", detail: "Synthetic command", status: "pending", canAlways: true },
    tool("after"),
  ]);
  assert.match(markup, /aria-expanded="true"/);
  assert.match(markup, /role="alert">失败：Synthetic failure/);
  assert.match(markup, /data-tool-id="error" data-tool-status="error"/);
  assert.match(markup, /Failure detail/);
  assert.equal((markup.match(/class="lorca-tool-group"/g) ?? []).length, 2);
  assert.match(markup, /lorca-approval-actions/);
  assert.match(markup, /仅允许一次|允许一次/);
});

test("tool strings remain escaped and never become HTML or external image requests", () => {
  const markup = render([tool("escaped", { status: "error", name: "<img src=https://synthetic.invalid>", output: "<script>run()</script>" })]);
  assert.match(markup, /&lt;img/);
  assert.match(markup, /&lt;script/);
  assert.doesNotMatch(markup, /<script>|<img src="https:\/\/synthetic/);
});

test("controller preserves message-level failures and command waiting states", async context => {
  const bridge = new ToolBridge(), controller = new LorcaController(bridge);
  context.after(() => controller.dispose());
  const messages = [
    rawTool("failed", {}, { kind: "failed", error: "Synthetic message failure" }),
    rawTool("body-error", { is_error: true }),
    ...["waiting", "running", "checking"].map(state => rawTool(state, { run: { state, command: "synthetic" } })),
    rawTool("asking", { run: { state: "asking", command: "synthetic", rule: "Synthetic allow rule" } }),
    rawTool("failed-asking", { run: { state: "asking", command: "synthetic", rule: "Synthetic allow rule" } }, { kind: "failed", error: "Synthetic terminal failure" }),
  ];
  bridge.snapshot = { ...demoSnapshot, chats: [{ ...demoSnapshot.chats[0], id: "chat-demo", messages }], running_turns: [], running_chat_ids: [] };
  await controller.start(); await tick(); controller.actions.onSelectConversation("chat-demo");
  const rows = controller.getSnapshot().messages;
  assert.equal(rows.length, 7);
  assert.equal(rows[0].kind === "tool" && rows[0].status, "error");
  assert.match(rows[0].kind === "tool" ? rows[0].output ?? "" : "", /Synthetic message failure/);
  assert.equal(rows[1].kind === "tool" && rows[1].status, "error");
  for (const row of rows.slice(2, 5)) assert.equal(row.kind === "tool" && row.status, "running");
  assert.equal(rows[5].kind, "approval");
  assert.equal(rows[6].kind === "tool" && rows[6].status, "error");
});

const storeSnapshot = (ids: string[] = []) => parseSnapshot({
  ...demoSnapshot, identity_id: "synthetic-account",
  chats: [{ ...demoSnapshot.chats[0], id: "chat-demo", has_more: true, messages: ids.map(id => rawTool(id)) }],
  running_turns: [], running_chat_ids: [],
});
const addRecord = (model: Model, id: string, event: "message.added" | "message.updated" = "message.added") => applyEvent(model, { event, data: { chat_id: "chat-demo", message: parseMessage(rawTool(id)) } });
const boundary = (model: Model, id: string) => model.messageActivityBoundaries.get(`chat-demo:${id}`);
const jobEvent = (model: Model, event: "job.started" | "job.finished", jobId = "actual-job-id") => applyEvent(model, { event, data: { chat_id: "chat-demo", bot_id: "bot-a", job_id: jobId } });

test("snapshot and paginated history receive no inferred activity boundary even while a job runs", () => {
  const snapshot = storeSnapshot(["history"]);
  snapshot.running_turns = [{ chat_id: "chat-demo", bot_id: "bot-a", job_id: "job-running-during-snapshot" }];
  let model = applySnapshot(emptyModel(), snapshot);
  assert.equal(boundary(model, "history"), undefined);
  model = appendOlder(model, "chat-demo", [parseMessage(rawTool("older"))], false);
  assert.equal(boundary(model, "older"), undefined);
  model = addRecord(model, "unknown-update", "message.updated");
  assert.equal(boundary(model, "unknown-update"), undefined);
});

test("observed start and finish events split newly arriving records without assigning job ownership", () => {
  let model = applySnapshot(emptyModel(), storeSnapshot());
  model = addRecord(model, "before-start");
  model = jobEvent(model, "job.started");
  model = addRecord(model, "during");
  model = jobEvent(model, "job.finished");
  model = addRecord(model, "after-finish");
  assert.notEqual(boundary(model, "before-start"), boundary(model, "during"));
  assert.notEqual(boundary(model, "during"), boundary(model, "after-finish"));
  for (const value of model.messageActivityBoundaries.values()) {
    assert.match(value, /^observed:\d+$/);
    assert.doesNotMatch(value, /actual-job-id/);
  }
});

test("late old records carry only arrival-boundary metadata and updates never reassign it", () => {
  let model = jobEvent(applySnapshot(emptyModel(), storeSnapshot()), "job.started", "old-job");
  model = addRecord(model, "old-record");
  const original = boundary(model, "old-record");
  model = jobEvent(model, "job.finished", "old-job");
  model = jobEvent(model, "job.started", "new-job");
  model = addRecord(model, "late-record-from-old-job");
  model = addRecord(model, "current-record");
  assert.equal(boundary(model, "late-record-from-old-job"), boundary(model, "current-record"));
  assert.notEqual(boundary(model, "current-record"), original);
  model = addRecord(model, "old-record", "message.updated");
  model = addRecord(model, "old-record");
  assert.equal(boundary(model, "old-record"), original);
  assert.ok([...model.messageActivityBoundaries.values()].every(value => !value.includes("job")));
});

test("fresh snapshots advance the arrival boundary while preserving retained record metadata", () => {
  let model = addRecord(applySnapshot(emptyModel(), storeSnapshot()), "retained");
  const previous = boundary(model, "retained");
  model = applySnapshot(model, storeSnapshot(["retained", "new-history"]));
  assert.equal(boundary(model, "retained"), previous);
  assert.equal(boundary(model, "new-history"), undefined);
  model = addRecord(model, "after-snapshot");
  assert.notEqual(boundary(model, "after-snapshot"), previous);
  model = applySnapshot(model, { ...storeSnapshot(["retained"]), identity_id: "other-account" });
  assert.equal(boundary(model, "retained"), undefined);
  assert.equal(model.messageActivityBoundaries.size, 0);
});

test("removed messages and chats discard their observed boundary metadata", () => {
  let model = addRecord(addRecord(applySnapshot(emptyModel(), storeSnapshot()), "one"), "two");
  model = applyEvent(model, { event: "message.removed", data: { chat_id: "chat-demo", message_id: "one" } });
  assert.equal(boundary(model, "one"), undefined);
  assert.ok(boundary(model, "two"));
  model = applyEvent(model, { event: "chat.removed", data: { chat_id: "chat-demo" } });
  assert.equal(model.messageActivityBoundaries.size, 0);
  assert.equal(model.activityBoundaries.has("chat-demo"), false);
});
