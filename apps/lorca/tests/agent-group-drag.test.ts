import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_GROUP_DRAG_MIME, createAgentGroupDragSession, type AgentGroupDragContext } from "../src/ui/agent-group-drag";
import { type AgentGroupEntityId, type AgentGroupsState } from "../src/ui/agent-groups";

const bot = (id: string): AgentGroupEntityId => ({ kind: "bot", id });
const chat = (id: string): AgentGroupEntityId => ({ kind: "chat", id });
const namespace = "synthetic-account";
const entities = [bot("same"), chat("same"), bot("other")];
const original: AgentGroupsState = { version: 1, groups: [
  { id: "source", name: "Source", collapsed: false, memberIds: [bot("same"), chat("same")], primaryIds: ["same"] },
  { id: "target", name: "Target", collapsed: true, memberIds: [bot("other")], primaryIds: ["other"] },
] };
const context = (patch: Partial<AgentGroupDragContext> = {}): AgentGroupDragContext => ({ namespace, state: original, entities, targetGroupId: "target", ...patch });
class Transfer {
  values = new Map<string, string>();
  extraTypes: string[] = [];
  files = { length: 0 };
  effectAllowed = "uninitialized";
  reads = 0;
  protected = false;
  get types() { return [...this.values.keys(), ...this.extraTypes]; }
  setData(type: string, value: string) { this.values.set(type, value); }
  getData(type: string) { this.reads++; return this.protected ? "" : this.values.get(type) ?? ""; }
}
const event = (type: string, dataTransfer: Transfer | null, isTrusted = true) => ({ type, dataTransfer, isTrusted });
const options = { randomToken: () => "01234567-89ab-4def-8123-456789abcdef" };
function start(entity = bot("same")) {
  const session = createAgentGroupDragSession(namespace, options), transfer = new Transfer();
  assert.equal(session.begin(event("dragstart", transfer), entity, entities), true);
  return { session, transfer };
}

test("trusted internal drag stores only an opaque token and moving a bot clears just its old primary", () => {
  const { session, transfer } = start();
  assert.deepEqual(transfer.types, [AGENT_GROUP_DRAG_MIME]);
  const token = transfer.getData(AGENT_GROUP_DRAG_MIME);
  assert.equal(token.includes(namespace), false); assert.equal(token.includes("same"), false);
  assert.equal(transfer.effectAllowed, "move");
  const result = session.drop(event("drop", transfer), context());
  assert.equal(result?.ok, true);
  assert.deepEqual(result?.state.groups[0].memberIds, [chat("same")]);
  assert.deepEqual(result?.state.groups[0].primaryIds, []);
  assert.deepEqual(result?.state.groups[1].memberIds, [bot("other"), bot("same")]);
  assert.deepEqual(result?.state.groups[1].primaryIds, ["other"]);
  assert.deepEqual(original.groups[0].memberIds, [bot("same"), chat("same")]);
  assert.equal(session.drop(event("drop", transfer), context()), null, "A consumed token cannot be replayed");
});

test("moving a chat only changes classification and cannot clear a bot with the same raw ID", () => {
  const { session, transfer } = start(chat("same"));
  const result = session.drop(event("drop", transfer), context());
  assert.equal(result?.ok, true);
  assert.deepEqual(result?.state.groups[0].memberIds, [bot("same")]);
  assert.deepEqual(result?.state.groups[0].primaryIds, ["same"]);
  assert.deepEqual(result?.state.groups[1].memberIds, [bot("other"), chat("same")]);
  assert.deepEqual(entities, [bot("same"), chat("same"), bot("other")]);
});

test("explicit ungrouped drops remove classification while blank space and unchanged targets do nothing", () => {
  const { session, transfer } = start();
  const result = session.drop(event("drop", transfer), context({ targetGroupId: null }));
  assert.equal(result?.ok, true);
  assert.deepEqual(result?.state.groups[0].memberIds, [chat("same")]);
  assert.deepEqual(result?.state.groups[0].primaryIds, []);
  for (const targetGroupId of [undefined, "source", "missing"]) {
    const { session, transfer } = start();
    assert.equal(session.drop(event("drop", transfer), context({ targetGroupId })), null);
    assert.equal(session.drop(event("drop", transfer), context()), null, "The ended drop cannot later be replayed onto a valid target");
  }
});

test("external text and forged custom MIME do not register a source or move a member", () => {
  const session = createAgentGroupDragSession(namespace, options), transfer = new Transfer();
  transfer.setData("text/plain", "bot:same");
  transfer.setData(AGENT_GROUP_DRAG_MIME, JSON.stringify({ kind: "bot", id: "same", namespace }));
  assert.equal(session.canDrop(event("dragover", transfer), context()), false);
  assert.equal(session.drop(event("drop", transfer), context()), null);
  const active = start();
  assert.equal(active.session.drop(event("drop", transfer), context()), null);
  assert.equal(active.session.drop(event("drop", active.transfer), context())?.ok, true);
});

test("only trusted dragstart of an existing typed entity can create a drag session", () => {
  for (const attempt of [
    { type: "dragstart", trusted: false, entity: bot("same"), transfer: new Transfer() },
    { type: "drop", trusted: true, entity: bot("same"), transfer: new Transfer() },
    { type: "dragstart", trusted: true, entity: bot("missing"), transfer: new Transfer() },
    { type: "dragstart", trusted: true, entity: bot(" same"), transfer: new Transfer() },
    { type: "dragstart", trusted: true, entity: { ...bot("same"), secret: "synthetic" }, transfer: new Transfer() },
    { type: "dragstart", trusted: true, entity: bot("same"), transfer: null },
  ]) {
    const session = createAgentGroupDragSession(namespace, options);
    assert.equal(session.begin(event(attempt.type, attempt.transfer, attempt.trusted), attempt.entity, entities), false);
    if (attempt.transfer) assert.deepEqual(attempt.transfer.types, []);
  }
});

test("dragover uses the live registered session in protected mode and validates token only at drop", () => {
  const { session, transfer } = start();
  transfer.protected = true;
  assert.equal(session.canDrop(event("dragover", transfer), context()), true);
  assert.equal(session.canDrop(event("dragenter", transfer), context()), true);
  assert.equal(transfer.reads, 0);
  assert.equal(session.canDrop(event("dragover", transfer), context({ targetGroupId: undefined })), false);
  assert.equal(session.canDrop(event("dragover", transfer), context({ targetGroupId: "missing" })), false);
  assert.equal(session.canDrop(event("dragover", transfer, false), context()), false);
  assert.equal(session.drop(event("drop", transfer), context()), null);
  transfer.protected = false;
  assert.equal(session.drop(event("drop", transfer), context())?.ok, true);
});

test("file drags are never consumed as internal classification even when custom MIME is also present", () => {
  for (const byFiles of [true, false]) {
    const external = new Transfer();
    if (byFiles) external.files.length = 1; else external.extraTypes = ["Files"];
    assert.equal(createAgentGroupDragSession(namespace, options).begin(event("dragstart", external), bot("same"), entities), false);
    const { session, transfer } = start();
    if (byFiles) transfer.files.length = 1; else transfer.extraTypes = ["Files"];
    assert.equal(session.canDrop(event("dragover", transfer), context()), false);
    assert.equal(session.drop(event("drop", transfer), context()), null);
  }
});

test("cross-account, missing identity, disposal and other tree sessions cannot reuse a token", () => {
  const { session, transfer } = start();
  assert.equal(session.drop(event("drop", transfer), context({ namespace: "another-account" })), null);
  assert.equal(session.drop(event("drop", transfer), context()), null, "Returning to the old account cannot restore a revoked token");
  for (const value of [undefined, null, "", "anonymous", "unknown", "bad\nscope", "\ud800"]) {
    const absent = createAgentGroupDragSession(value, options);
    assert.equal(absent.begin(event("dragstart", new Transfer()), bot("same"), entities), false);
  }
  const fresh = start(), otherTree = createAgentGroupDragSession(namespace, options);
  assert.equal(otherTree.drop(event("drop", fresh.transfer), context()), null);
  fresh.session.dispose();
  assert.equal(fresh.session.drop(event("drop", fresh.transfer), context()), null);
  assert.equal(fresh.session.begin(event("dragstart", new Transfer()), bot("same"), entities), false);
});

test("ending or beginning a later drag revokes old tokens even when random test bytes repeat", () => {
  const { session, transfer: old } = start();
  session.end();
  assert.equal(session.drop(event("drop", old), context()), null);
  const next = new Transfer();
  assert.equal(session.begin(event("dragstart", next), chat("same"), entities), true);
  assert.notEqual(old.getData(AGENT_GROUP_DRAG_MIME), next.getData(AGENT_GROUP_DRAG_MIME));
  assert.equal(session.drop(event("drop", old), context()), null);
  assert.equal(session.drop(event("drop", next), context())?.ok, true);
});

test("expired and clock-reversed tokens cannot be revived without a new genuine dragstart", () => {
  for (const delta of [60_001, -1]) {
    let now = 1000;
    const session = createAgentGroupDragSession(namespace, { ...options, now: () => now }), transfer = new Transfer();
    assert.equal(session.begin(event("dragstart", transfer), bot("same"), entities), true);
    now += delta;
    assert.equal(session.drop(event("drop", transfer), context()), null);
    now = 1000;
    assert.equal(session.drop(event("drop", transfer), context()), null);
  }
});

test("deleted entity or target and invalid state cannot move stale membership", () => {
  const gone = start();
  assert.equal(gone.session.drop(event("drop", gone.transfer), context({ entities: [chat("same")] })), null);
  assert.equal(gone.session.drop(event("drop", gone.transfer), context()), null);
  const invalid = start();
  assert.equal(invalid.session.drop(event("drop", invalid.transfer), context({ state: { version: 1, groups: [...original.groups, original.groups[0]] } })), null);
  const deleted = start();
  assert.equal(deleted.session.drop(event("drop", deleted.transfer), context({ state: { version: 1, groups: [original.groups[0]] } })), null);
});

test("full target returns a normal mutation failure without detaching or persisting the source", () => {
  const { session, transfer } = start();
  const full = { ...original, groups: [original.groups[0], { ...original.groups[1], memberIds: Array.from({ length: 512 }, (_, index) => bot(`full-${index}`)), primaryIds: [] }] };
  const result = session.drop(event("drop", transfer), context({ state: full }));
  assert.equal(result?.ok, false);
  if (result && !result.ok) assert.equal(result.error, "member-limit");
  assert.deepEqual(result?.state, full);
});

test("unavailable randomness and transfer failures fail closed with no active source", () => {
  for (const randomToken of [() => "not-a-token", () => { throw new Error("unavailable"); }]) {
    const session = createAgentGroupDragSession(namespace, { randomToken }), transfer = new Transfer();
    assert.equal(session.begin(event("dragstart", transfer), bot("same"), entities), false);
    assert.equal(session.drop(event("drop", transfer), context()), null);
  }
  const session = createAgentGroupDragSession(namespace, options), transfer = new Transfer();
  transfer.setData = () => { throw new Error("denied"); };
  assert.equal(session.begin(event("dragstart", transfer), bot("same"), entities), false);
  assert.equal(session.drop(event("drop", transfer), context()), null);
});
