import test from "node:test";
import assert from "node:assert/strict";
import { AgentInspectorSession, parseAgentDetails, parseAgentMemorySummary } from "../src/core/agent-inspector";
const snapshot = (id = "one", revision = "ticket") => ({ revision, version: "configuration-hash", bot: { id, name: "合成智能体", description: "合成说明", symbolName: "star", accent: "indigo", provider: "fixture", model: "model", thinking: "", runnerId: "runner", hasAvatar: false, avatarVersion: null }, runners: [{ id: "runner", name: "合成设备", os: "macos", online: true }], providers: [{ id: "fixture", name: "Fixture", connected: true }], models: [{ id: "model", name: "Model", provider: "fixture", levels: ["high"] }], canCreate: false, canEditAvatar: true });
const memory = { status: "ready", lines: 2, bytes: 12, maxLines: 200, maxBytes: 24_000, topicCount: 0, logCount: 1, canEdit: true };
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
test("Inspector projection contains only bounded presentation fields", () => {
  const raw = { ...snapshot(), secret: "never-project", path: "/private/fixture", token: "secret" };
  assert.equal(JSON.stringify(parseAgentDetails(raw)).includes("secret"), false);
  assert.equal(JSON.stringify(parseAgentMemorySummary({ ...memory, text: "never-project", path: "/private/fixture", hash: "secret" })).includes("never-project"), false);
  assert.throws(() => parseAgentDetails({ ...raw, runners: [{ id: "phone", name: "Phone", os: "ios", online: true }] }));
  assert.throws(() => parseAgentDetails({ ...raw, models: Array(1001).fill(raw.models[0]) }));
  assert.throws(() => parseAgentMemorySummary({ ...memory, bytes: -1 }));
});
test("Late profile results cannot enter another account or selection, and reads serialize", async () => {
  const old = deferred<unknown>(); const calls: string[] = [];
  const session = new AgentInspectorSession({ closeAgentDetails: async () => {}, getAgentDetails: async ({ botId }) => { calls.push(botId!); return botId === "one" ? old.promise : snapshot(botId); } });
  session.select("a", "one", true); await tick(); session.select("b", "two", true); await tick();
  assert.deepEqual(calls, ["one"]); old.resolve(snapshot()); await tick();
  assert.deepEqual(calls, ["one", "two"]); assert.equal(session.getSnapshot().details?.bot?.id, "two"); session.dispose();
});
test("Closing while a memory summary is pending cannot revive details", async () => {
  const pending = deferred<unknown>(); const session = new AgentInspectorSession({ getAgentDetails: async () => snapshot(), getAgentMemorySummary: () => pending.promise });
  session.select("a", "one", true); await tick(); assert.equal(session.getSnapshot().details?.bot?.id, "one");
  session.select("a", "one", false); pending.resolve(memory); await tick();
  assert.equal(session.getSnapshot().details, undefined); assert.equal(session.getSnapshot().memory, undefined); session.dispose();
});
test("Memory failure leaves a usable profile and safe unavailable summary", async () => {
  const session = new AgentInspectorSession({ getAgentDetails: async () => snapshot(), getAgentMemorySummary: async () => { throw new Error("raw secret/path"); } });
  session.select("a", "one", true); await tick(); assert.equal(session.getSnapshot().details?.bot?.id, "one"); assert.equal(session.getSnapshot().memory?.status, "unavailable");
  assert.equal(JSON.stringify(session.getSnapshot()).includes("secret"), false); session.dispose();
});
test("Unknown outcome blocks repeat mutation until explicit readback; no blind replay", async () => {
  let writes = 0, reads = 0;
  const session = new AgentInspectorSession({ getAgentDetails: async () => snapshot("one", `ticket-${++reads}`), agentDetailsAction: async () => { writes++; return { status: "unknownOutcome", botId: "one" }; } });
  session.select("a", "one", true); await tick(); const action = { kind: "profile.save" as const, revision: session.getSnapshot().details!.revision, patch: { name: "Changed" } };
  assert.equal((await session.apply(action)).status, "unknownOutcome"); await assert.rejects(session.apply(action)); assert.equal(writes, 1); assert.equal(reads, 1);
  await session.refresh(); assert.equal(reads, 2); assert.equal(writes, 1); session.dispose();
});
test("Cancelled mutation refreshes one-use ticket without claiming a saved change", async () => {
  let writes = 0, reads = 0;
  const session = new AgentInspectorSession({ getAgentDetails: async () => snapshot("one", `ticket-${++reads}`), agentDetailsAction: async () => { writes++; return { status: "cancelled", botId: "one" }; } });
  session.select("a", "one", true); await tick(); const version = session.getSnapshot().details!.version;
  const result = await session.apply({ kind: "profile.save", revision: session.getSnapshot().details!.revision, patch: { name: "Changed" } });
  assert.equal(result.status, "cancelled"); assert.equal(writes, 1); assert.equal(reads, 2); assert.equal(session.getSnapshot().details!.version, version); session.dispose();
});
test("Missing account scope and close state never fetch profile data", async () => {
  let reads = 0; const session = new AgentInspectorSession({ getAgentDetails: async () => { reads++; return snapshot(); } });
  session.select(undefined, "one", true); await tick(); await session.refresh(); assert.equal(reads, 0); session.select("a", "one", false); await tick(); assert.equal(reads, 0); session.dispose();
});
test("Concurrent clicks perform one mutation and late completion cannot enter another target", async () => {
  const pending = deferred<unknown>(); let writes = 0;
  const session = new AgentInspectorSession({ getAgentDetails: async ({ botId }) => snapshot(botId), agentDetailsAction: async () => { writes++; return pending.promise; } });
  session.select("a", "one", true); await tick(); const action = { kind: "profile.save" as const, revision: "ticket", patch: { name: "Changed" } };
  const operation = session.apply(action); await tick(); await assert.rejects(session.apply(action)); session.select("a", "two", true);
  pending.resolve({ status: "applied", botId: "one" }); await assert.rejects(operation); await tick();
  assert.equal(writes, 1); assert.equal(session.getSnapshot().details?.bot?.id, "two"); session.dispose();
});

const capabilities = { revision: "capability-ticket", version: "capability-configuration", botId: "one", botName: "合成智能体", runnerId: "runner", routines: [], plugins: [], permissions: { allConnections: false, filesystem: "read", shell: false, drafts: true }, capabilities: { canCreateRoutine: true, canEditPlugins: true } };
test("Capability read failure is isolated from profile and memory data", async () => {
  const session = new AgentInspectorSession({ getAgentDetails: async () => snapshot(), getAgentCapabilities: async () => { throw new Error("private-token"); }, getAgentMemorySummary: async () => memory });
  session.select("a", "one", true); await tick();
  assert.equal(session.getSnapshot().details?.bot?.id, "one"); assert.equal(session.getSnapshot().memory?.status, "ready");
  assert.match(session.getSnapshot().capabilitiesError!, /无法读取/); assert.equal(JSON.stringify(session.getSnapshot()).includes("private-token"), false); session.dispose();
});
test("Capability revisions are separate from profile tickets and run acknowledgements mean requested only", async () => {
  const actions: unknown[] = [];
  const session = new AgentInspectorSession({ getAgentDetails: async () => snapshot(), getAgentCapabilities: async () => capabilities, agentCapabilitiesAction: async action => { actions.push(action); return { status: "applied", botId: "one", routineId: "routine", requested: true }; } });
  session.select("a", "one", true); await tick();
  await assert.rejects(session.applyCapabilities({ kind: "routine.run", revision: "ticket", routineId: "routine" }));
  assert.equal(actions.length, 0);
  const result = await session.applyCapabilities({ kind: "routine.run", revision: "capability-ticket", routineId: "routine" });
  assert.equal(result.requested, true); assert.equal(Object.hasOwn(result, "completed"), false); assert.equal(actions.length, 1); session.dispose();
});
test("Capability unknown outcome is never automatically replayed", async () => {
  let writes = 0;
  const session = new AgentInspectorSession({ getAgentDetails: async () => snapshot(), getAgentCapabilities: async () => capabilities, agentCapabilitiesAction: async () => { writes++; return { status: "unknownOutcome", botId: "one", routineId: "routine" }; } });
  session.select("a", "one", true); await tick();
  const action = { kind: "routine.delete" as const, revision: "capability-ticket", routineId: "routine" };
  assert.equal((await session.applyCapabilities(action)).status, "unknownOutcome");
  await assert.rejects(session.applyCapabilities(action)); assert.equal(writes, 1); session.dispose();
});

test("An acknowledgement for another bot is not accepted as a profile save", async () => {
  const session = new AgentInspectorSession({ getAgentDetails: async () => snapshot(), agentDetailsAction: async () => ({ status: "applied", botId: "other" }) });
  session.select("a", "one", true); await tick();
  await assert.rejects(session.apply({ kind: "profile.save", revision: "ticket", patch: { name: "Changed" } }));
  assert.match(session.getSnapshot().error!, /未能确认/); session.dispose();
});
test("Only open relevant inspector events coalesce into readback, never into writes or endless polling", async () => {
  let listener: ((value: unknown) => void) | undefined, reads = 0, stopped = false;
  const session = new AgentInspectorSession({ getAgentDetails: async () => { reads++; return snapshot(); }, onEvent: callback => { listener = callback; return () => { stopped = true; }; } });
  session.select("a", "one", true); await tick();
  listener!({ event: "job.started", data: { bot_id: "other" } });
  listener!({ event: "roster.changed", data: {} }); listener!({ event: "job.finished", data: { bot_id: "one" } });
  await new Promise(resolve => setTimeout(resolve, 240)); assert.equal(reads, 2);
  await new Promise(resolve => setTimeout(resolve, 240)); assert.equal(reads, 2);
  listener!({ event: "roster.changed", data: {} }); session.select("a", "one", false);
  await new Promise(resolve => setTimeout(resolve, 240)); assert.equal(reads, 2); session.dispose(); assert.equal(stopped, true);
});
