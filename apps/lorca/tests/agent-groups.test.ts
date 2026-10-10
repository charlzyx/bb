import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_GROUP_LIMITS, agentGroupEntityKey, assignAgentGroup, createAgentGroup, deleteAgentGroup, emptyAgentGroups,
  loadAgentGroups, parseAgentGroups, projectAgentGroups, renameAgentGroup, saveAgentGroups,
  setAgentGroupCollapsed, setAgentGroupPrimary,
  type AgentGroup, type AgentGroupEntityId, type AgentGroupsMutation, type AgentGroupsState, type AgentGroupsStorage,
} from "../src/ui/agent-groups";

class MemoryStorage implements AgentGroupsStorage {
  values = new Map<string, string>();
  reads: string[] = [];
  writes: { key: string; value: string }[] = [];
  getItem(key: string) { this.reads.push(key); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes.push({ key, value }); this.values.set(key, value); }
}
const bot = (id: string): AgentGroupEntityId => ({ kind: "bot", id });
const chat = (id: string): AgentGroupEntityId => ({ kind: "chat", id });
const group = (id = "group-one", patch: Partial<AgentGroup> = {}): AgentGroup => ({ id, name: "Research", collapsed: false, memberIds: [].map(bot), primaryIds: [], ...patch });
const state = (...groups: AgentGroup[]): AgentGroupsState => ({ version: 1, groups });
const applied = (result: AgentGroupsMutation) => { assert.equal(result.ok, true); return result.state; };
const failed = (result: AgentGroupsMutation, error: string) => { assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error, error); };
const agents = [
  { kind: "bot" as const, id: "a", label: "Writer", appearance: { accent: "teal" } },
  { kind: "bot" as const, id: "b", label: "Researcher", appearance: { accent: "blue" } },
  { kind: "bot" as const, id: "c", label: "Planner", appearance: { accent: "rose" } },
];

test("create and rename produce independent state with trimmed names and caller-supplied stable IDs", () => {
  const original = Object.freeze({ version: 1 as const, groups: Object.freeze([]) });
  const created = applied(createAgentGroup(original, "stable-id", "  Work  "));
  assert.deepEqual(original, emptyAgentGroups());
  assert.deepEqual(created.groups, [group("stable-id", { name: "Work" })]);
  const renamed = applied(renameAgentGroup(created, "stable-id", "  Personal  "));
  assert.equal(created.groups[0].name, "Work");
  assert.equal(renamed.groups[0].name, "Personal");
  assert.equal(renamed.groups[0].id, "stable-id");
  assert.notEqual(renamed.groups, created.groups);
});

test("group IDs stay unique while duplicate human labels remain safe", () => {
  const original = state(group("one"));
  failed(createAgentGroup(original, "one", "Other"), "duplicate-group");
  assert.equal(applied(createAgentGroup(original, "two", "Research")).groups.length, 2);
  failed(renameAgentGroup(original, "missing", "Name"), "group-not-found");
});

test("names, IDs and collapse input are bounded without accepting control characters", () => {
  for (const name of ["", "   ", "x".repeat(81), "bad\nname", "bad\0name"]) failed(createAgentGroup(emptyAgentGroups(), "one", name), "invalid-name");
  for (const id of ["", " ", " leading", "trailing ", "x".repeat(257), "bad\rvalue"]) failed(createAgentGroup(emptyAgentGroups(), id, "Name"), "invalid-id");
  assert.equal(applied(createAgentGroup(emptyAgentGroups(), "x".repeat(256), "界".repeat(80))).groups.length, 1);
  failed(setAgentGroupCollapsed(state(group()), "missing", true), "group-not-found");
});

test("assignment moves an agent to exactly one group and clears its former primary role", () => {
  const original = state(group("one", { memberIds: ["a", "b"].map(bot), primaryIds: ["a"] }), group("two", { memberIds: ["c"].map(bot), primaryIds: ["c"] }));
  const moved = applied(assignAgentGroup(original, bot("a"), "two"));
  assert.deepEqual(moved.groups[0].memberIds, ["b"].map(bot));
  assert.deepEqual(moved.groups[0].primaryIds, []);
  assert.deepEqual(moved.groups[1].memberIds, ["c", "a"].map(bot));
  assert.deepEqual(moved.groups[1].primaryIds, ["c"]);
  assert.deepEqual(original.groups[0].memberIds, ["a", "b"].map(bot));
});

test("assigning to the same group is idempotent and preserves primary selection", () => {
  const original = state(group("one", { memberIds: ["a"].map(bot), primaryIds: ["a"] }));
  assert.deepEqual(applied(assignAgentGroup(original, bot("a"), "one")), original);
  const ungrouped = applied(assignAgentGroup(original, bot("a"), null));
  assert.deepEqual(ungrouped.groups[0].memberIds, [].map(bot));
  assert.deepEqual(ungrouped.groups[0].primaryIds, []);
  assert.deepEqual(applied(assignAgentGroup(ungrouped, bot("a"), null)), ungrouped);
});

test("moving to a missing or full target does not detach the original membership", () => {
  const original = state(group("source", { memberIds: ["a"].map(bot), primaryIds: ["a"] }), group("full", { memberIds: Array.from({ length: 512 }, (_, index) => bot(`other-${index}`)) }));
  const missing = assignAgentGroup(original, bot("a"), "missing");
  failed(missing, "group-not-found");
  assert.deepEqual(missing.state, original);
  const full = assignAgentGroup(original, bot("a"), "full");
  failed(full, "member-limit");
  assert.deepEqual(full.state, original);
});

test("primary status allows zero or one and choosing a new bot replaces the previous primary", () => {
  const original = state(group("one", { memberIds: ["a", "b", "c"].map(bot), primaryIds: ["a"] }));
  const selected = applied(setAgentGroupPrimary(original, "one", ["b"]));
  assert.deepEqual(selected.groups[0].primaryIds, ["b"]);
  assert.deepEqual(original.groups[0].primaryIds, ["a"]);
  failed(setAgentGroupPrimary(selected, "one", ["a", "b"]), "primary-limit");
  failed(setAgentGroupPrimary(selected, "one", ["a", "a"]), "primary-limit");
  failed(setAgentGroupPrimary(selected, "one", ["outside"]), "primary-membership");
  assert.deepEqual(applied(setAgentGroupPrimary(selected, "one", [])).groups[0].primaryIds, []);
  assert.deepEqual(selected.groups[0].memberIds, original.groups[0].memberIds);
  assert.equal(Object.hasOwn(selected.groups[0], "announcement"), false);
});

test("collapse changes only display state and deleting a group never deletes agents", () => {
  const original = state(group("one", { memberIds: ["a", "b"].map(bot), primaryIds: ["a"] }));
  const collapsed = applied(setAgentGroupCollapsed(original, "one", true));
  assert.deepEqual(collapsed.groups[0], { ...original.groups[0], collapsed: true });
  const removed = applied(deleteAgentGroup(collapsed, "one"));
  assert.deepEqual(removed, emptyAgentGroups());
  assert.deepEqual(projectAgentGroups(removed, agents).ungrouped, agents);
  assert.deepEqual(original.groups[0].memberIds, ["a", "b"].map(bot));
  failed(deleteAgentGroup(removed, "one"), "group-not-found");
});

test("mutation helpers accept frozen nested state without changing any original arrays", () => {
  const original = Object.freeze({ version: 1 as const, groups: Object.freeze([Object.freeze({ id: "one", name: "Work", collapsed: false, memberIds: Object.freeze([bot("a")]), primaryIds: Object.freeze(["a"]) })]) });
  for (const result of [renameAgentGroup(original, "one", "Renamed"), assignAgentGroup(original, bot("a"), null), setAgentGroupPrimary(original, "one", []), setAgentGroupCollapsed(original, "one", true), deleteAgentGroup(original, "one")]) assert.equal(result.ok, true);
  assert.deepEqual(original.groups[0].memberIds, ["a"].map(bot));
  assert.deepEqual(original.groups[0].primaryIds, ["a"]);
});

test("strict parsing rejects unknown fields, secrets, invalid versions and duplicate assignments", () => {
  const valid = state(group("one", { memberIds: ["a"].map(bot), primaryIds: ["a"] }));
  const invalid: unknown[] = [
    null, [], {}, { ...valid, version: 2 }, { ...valid, token: "SYNTHETIC_SECRET" },
    { ...valid, groups: [{ ...valid.groups[0], announcement: "Hidden broadcast" }] },
    { ...valid, groups: [{ ...valid.groups[0], members: ["a"] }] },
    state(group("one", { memberIds: ["a", "a"].map(bot) })),
    state(group("one", { primaryIds: ["a"] })),
    state(group("one", { memberIds: ["a"].map(bot) }), group("two", { memberIds: ["a"].map(bot) })),
    state(group("one"), group("one")),
    state(group("one", { primaryIds: ["a", "b", "c"], memberIds: ["a", "b", "c"].map(bot) })),
    { version: 1, groups: [{ ...group(), collapsed: "false" }] },
    { version: 1, groups: [{ ...group(), primaryIds: null }] },
    Object.create(valid),
  ];
  for (const value of invalid) assert.equal(parseAgentGroups(value), null);
  const parsed = parseAgentGroups(valid)!;
  assert.deepEqual(parsed, valid);
  assert.notEqual(parsed.groups[0], valid.groups[0]);
  assert.notEqual(parsed.groups[0].memberIds, valid.groups[0].memberIds);
});

test("group, member and aggregate data limits are enforced before persistence", () => {
  const full = state(...Array.from({ length: 64 }, (_, index) => group(`group-${index}`)));
  assert.ok(parseAgentGroups(full));
  failed(createAgentGroup(full, "extra", "Extra"), "group-limit");
  assert.equal(parseAgentGroups(state(group("one", { memberIds: Array.from({ length: 513 }, (_, index) => bot(`member-${index}`)) }))), null);
  const aggregate = state(...Array.from({ length: 8 }, (_, groupIndex) => group(`g${groupIndex}`, { memberIds: Array.from({ length: 512 }, (_, index) => bot(`m${groupIndex}-${index}`)) })));
  assert.equal(parseAgentGroups(aggregate), null);
  assert.ok(JSON.stringify(aggregate).length > AGENT_GROUP_LIMITS.storageBytes);
  assert.equal(parseAgentGroups(state(...aggregate.groups, group("extra", { memberIds: ["overflow"].map(bot) }))), null);
  const unicode = state(group("unicode", { memberIds: Array.from({ length: 110 }, (_, index) => bot(`${"界".repeat(200)}${index}`)) }));
  assert.ok(JSON.stringify(unicode).length < AGENT_GROUP_LIMITS.storageBytes);
  assert.equal(parseAgentGroups(unicode), null);
});

test("projection ignores deleted IDs and leaves every current unassigned agent visible", () => {
  const configured = state(group("one", { memberIds: ["deleted", "b"].map(bot), primaryIds: ["deleted"] }));
  const result = projectAgentGroups(configured, agents);
  assert.deepEqual(result.groups[0].memberIds, ["b"].map(bot));
  assert.deepEqual(result.groups[0].members, [agents[1]]);
  assert.deepEqual(result.groups[0].primaryIds, []);
  assert.deepEqual(result.groups[0].primaries, []);
  assert.deepEqual(result.ungrouped, [agents[0], agents[2]]);
  assert.deepEqual(configured.groups[0].memberIds, ["deleted", "b"].map(bot));
});

test("search finds collapsed members and matching group labels without mutating collapse preferences", () => {
  const configured = state(group("one", { name: "Work group", collapsed: true, memberIds: ["a", "b"].map(bot), primaryIds: ["a"] }));
  assert.equal(projectAgentGroups(configured, agents).groups[0].showMembers, false);
  const byMember = projectAgentGroups(configured, agents, "  RESEARCH  ");
  assert.equal(byMember.groups[0].showMembers, true);
  assert.deepEqual(byMember.groups[0].members, [agents[1]]);
  assert.equal(byMember.groups[0].totalMembers, 2);
  assert.deepEqual(byMember.groups[0].primaries, [agents[0]]);
  assert.deepEqual(projectAgentGroups(configured, agents, "work").groups[0].members, agents.slice(0, 2));
  assert.equal(configured.groups[0].collapsed, true);
  assert.deepEqual(projectAgentGroups(configured, agents, "planner"), { groups: [], ungrouped: [agents[2]] });
  assert.deepEqual(projectAgentGroups(configured, agents, "not-found"), { groups: [], ungrouped: [] });
});

test("empty groups remain editable and ungrouped search supports Unicode normalization", () => {
  const configured = state(group("empty", { name: "Empty group", collapsed: true }));
  const result = projectAgentGroups(configured, [{ kind: "bot" as const, id: "unicode", label: "ＡＧＥＮＴ" }], "agent");
  assert.equal(result.groups.length, 0);
  assert.equal(result.ungrouped.length, 1);
  assert.equal(projectAgentGroups(configured, agents).groups[0].totalMembers, 0);
  assert.equal(projectAgentGroups(configured, agents, "empty").groups[0].showMembers, true);
});

test("duplicate roster IDs are rendered once and prototype-like identifiers remain safe", () => {
  const configured = state(group("__proto__", { memberIds: ["constructor"].map(bot), primaryIds: ["constructor"] }));
  const roster = [{ kind: "bot" as const, id: "constructor", label: "Prototype-safe" }, { kind: "bot" as const, id: "constructor", label: "Duplicate" }, { kind: "bot" as const, id: "__proto__", label: "Another" }];
  const result = projectAgentGroups(configured, roster);
  assert.deepEqual(result.groups[0].members, [roster[0]]);
  assert.deepEqual(result.ungrouped, [roster[2]]);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
});

test("unknown identity never reads, writes or adopts an anonymous namespace", () => {
  const storage = new MemoryStorage();
  for (const namespace of [undefined, null, "", " ", "anonymous", "UNKNOWN", "null", "undefined", "bad\nscope", "x".repeat(513)]) {
    const loaded = loadAgentGroups(namespace, storage), saved = saveAgentGroups(namespace, state(group()), storage);
    assert.equal(loaded.ok, false);
    if (!loaded.ok) assert.equal(loaded.error, "missing-account");
    assert.deepEqual(loaded.state, emptyAgentGroups());
    assert.equal(saved.ok, false);
  }
  assert.deepEqual(storage.reads, []);
  assert.deepEqual(storage.writes, []);
});

test("distinct account namespaces persist independently and switching back restores only that account", () => {
  const storage = new MemoryStorage(), first = state(group("one", { memberIds: ["a"].map(bot), primaryIds: ["a"] }));
  assert.deepEqual(saveAgentGroups("account:one", first, storage), { ok: true });
  assert.deepEqual(loadAgentGroups("account:two", storage), { ok: true, state: emptyAgentGroups(), source: "empty" });
  const second = state(group("two", { name: "Other account" }));
  assert.deepEqual(saveAgentGroups("account:two", second, storage), { ok: true });
  assert.deepEqual(loadAgentGroups("account:one", storage), { ok: true, state: first, source: "saved" });
  assert.deepEqual(loadAgentGroups("account:two", storage), { ok: true, state: second, source: "saved" });
  assert.notEqual(storage.writes[0].key, storage.writes[1].key);
  assert.deepEqual(Object.keys(JSON.parse(storage.writes[0].value)), ["version", "groups"]);
});

test("encoded namespaces cannot collide through delimiters or percent-encoded text", () => {
  const storage = new MemoryStorage();
  for (const namespace of ["account/a", "account%2Fa", "account:a", "账号甲", "__proto__"]) assert.equal(saveAgentGroups(namespace, state(group()), storage).ok, true);
  assert.equal(new Set(storage.writes.map(write => write.key)).size, 5);
  assert.ok(storage.writes.every(write => write.key.startsWith("dots.agent-groups.v1:")));
});

test("corrupt or oversized storage returns an explicit empty fallback without overwriting the original", () => {
  const storage = new MemoryStorage();
  saveAgentGroups("account", state(group()), storage);
  const key = storage.writes[0].key;
  for (const serialized of ["{", "null", '{"version":2,"groups":[]}', JSON.stringify({ ...state(group()), token: "SYNTHETIC_SECRET" }), " ".repeat(65537), JSON.stringify({ version: 1, groups: [group("one"), group("one")] })]) {
    storage.values.set(key, serialized);
    const result = loadAgentGroups("account", storage);
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.error, "corrupt-data"); assert.match(result.message, /原数据未被覆盖/); }
    assert.deepEqual(result.state, emptyAgentGroups());
    assert.equal(storage.values.get(key), serialized);
  }
  assert.equal(storage.writes.length, 1);
});

test("storage access failures are visible and never report successful persistence or echo private errors", () => {
  const storage: AgentGroupsStorage = {
    getItem() { throw new Error("SYNTHETIC_PRIVATE_PATH"); },
    setItem() { throw new Error("SYNTHETIC_PRIVATE_PATH"); },
  };
  const loaded = loadAgentGroups("account", storage), saved = saveAgentGroups("account", state(group()), storage);
  assert.equal(loaded.ok, false);
  assert.equal(saved.ok, false);
  if (!loaded.ok) { assert.equal(loaded.error, "storage-unavailable"); assert.doesNotMatch(loaded.message, /SYNTHETIC_PRIVATE/); }
  if (!saved.ok) { assert.equal(saved.error, "storage-unavailable"); assert.doesNotMatch(saved.message, /SYNTHETIC_PRIVATE/); }
  assert.deepEqual(loaded.state, emptyAgentGroups());
});

test("an unavailable global storage getter is never touched without a verified account namespace", context => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let accessed = 0;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { accessed++; throw new Error("Synthetic denied storage getter"); } });
  context.after(() => { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); });
  assert.equal(loadAgentGroups(undefined).ok, false);
  assert.equal(saveAgentGroups(undefined, emptyAgentGroups()).ok, false);
  assert.equal(accessed, 0);
  assert.equal(loadAgentGroups("account").ok, false);
  assert.equal(saveAgentGroups("account", emptyAgentGroups()).ok, false);
  assert.equal(accessed, 2);
});

test("invalid typed state fails closed in mutations and projection still shows the complete current roster", () => {
  const invalid = state(group("one", { memberIds: ["a", "a"].map(bot) }));
  failed(renameAgentGroup(invalid, "one", "Rename"), "invalid-state");
  assert.deepEqual(projectAgentGroups(invalid, agents), { groups: [], ungrouped: agents });
  const storage = new MemoryStorage();
  assert.equal(saveAgentGroups("account", invalid, storage).ok, false);
  assert.deepEqual(storage.writes, []);
});

test("a failed write preserves the previous saved account state", () => {
  const memory = new MemoryStorage(), previous = state(group("original"));
  saveAgentGroups("account", previous, memory);
  const quota: AgentGroupsStorage = { getItem: key => memory.getItem(key), setItem() { throw new Error("quota exceeded"); } };
  assert.equal(saveAgentGroups("account", state(group("unsaved")), quota).ok, false);
  assert.deepEqual(loadAgentGroups("account", memory).state, previous);
});

test("assign then primary can be composed transactionally without mutating or partially saving", () => {
  const storage = new MemoryStorage(), original = state(group("one", { memberIds: ["a"].map(bot), primaryIds: ["a"] }), group("two", { memberIds: ["b", "c"].map(bot), primaryIds: ["b"] }));
  saveAgentGroups("account", original, storage);
  const moved = applied(assignAgentGroup(original, bot("a"), "two"));
  const rejected = setAgentGroupPrimary(moved, "two", ["a", "b", "c"]);
  failed(rejected, "primary-limit");
  assert.deepEqual(loadAgentGroups("account", storage).state, original);
  const accepted = applied(setAgentGroupPrimary(moved, "two", ["a"]));
  assert.deepEqual(saveAgentGroups("account", accepted, storage), { ok: true });
  assert.deepEqual(loadAgentGroups("account", storage).state, accepted);
  assert.equal(storage.writes.length, 2);
});

test("bot and chat IDs with identical raw strings have independent classification and React keys", () => {
  const original = state(group("bots", { memberIds: [bot("same")], primaryIds: ["same"] }), group("chats", { memberIds: [chat("same")] }));
  assert.ok(parseAgentGroups(original));
  assert.notEqual(agentGroupEntityKey(bot("same")), agentGroupEntityKey(chat("same")));
  assert.notEqual(agentGroupEntityKey(bot("chat:a")), agentGroupEntityKey(chat("bot:a")));
  const roster = [{ kind: "bot" as const, id: "same", label: "Writer" }, { kind: "chat" as const, id: "same", label: "Team chat", botIds: ["same", "another"] }];
  const result = projectAgentGroups(original, roster);
  assert.deepEqual(result.groups[0].members, [roster[0]]);
  assert.deepEqual(result.groups[1].members, [roster[1]]);
  assert.deepEqual(result.groups[0].primaries, [roster[0]]);
  assert.deepEqual(result.ungrouped, []);
});

test("chat moves are unique and never move its real participants or clear a colliding bot primary", () => {
  const original = state(group("one", { memberIds: [bot("same"), chat("same")], primaryIds: ["same"] }), group("two"));
  const moved = applied(assignAgentGroup(original, chat("same"), "two"));
  assert.deepEqual(moved.groups[0].memberIds, [bot("same")]);
  assert.deepEqual(moved.groups[0].primaryIds, ["same"]);
  assert.deepEqual(moved.groups[1].memberIds, [chat("same")]);
  assert.deepEqual(applied(assignAgentGroup(moved, chat("same"), "two")), moved);
  const unassigned = applied(assignAgentGroup(moved, chat("same"), null));
  assert.deepEqual(unassigned.groups[1].memberIds, []);
  assert.deepEqual(unassigned.groups[0], moved.groups[0]);
  const movedBot = applied(assignAgentGroup(original, bot("same"), "two"));
  assert.deepEqual(movedBot.groups[0].memberIds, [chat("same")]);
  assert.deepEqual(movedBot.groups[0].primaryIds, []);
});

test("a chat cannot become primary even when present and raw IDs are otherwise valid", () => {
  const original = state(group("one", { memberIds: [chat("shared"), bot("writer")] }));
  failed(setAgentGroupPrimary(original, "one", ["shared"]), "primary-membership");
  assert.equal(parseAgentGroups(state(group("one", { memberIds: [chat("shared")], primaryIds: ["shared"] }))), null);
  assert.deepEqual(applied(setAgentGroupPrimary(original, "one", ["writer"])).groups[0].primaryIds, ["writer"]);
});

test("strict typed entity parsing rejects bare IDs, bad kinds, extra secrets and duplicate chat assignments", () => {
  for (const member of ["legacy-bot", { kind: "channel", id: "one" }, { kind: "chat", id: "one", token: "SYNTHETIC_SECRET" }, { kind: "bot", id: "" }, { kind: "bot", id: "one", botIds: [] }]) {
    assert.equal(parseAgentGroups({ version: 1, groups: [{ ...group(), memberIds: [member] }] }), null);
  }
  assert.equal(parseAgentGroups(state(group("one", { memberIds: [chat("shared")] }), group("two", { memberIds: [chat("shared")] }))), null);
  assert.equal(parseAgentGroups(state(group("one", { memberIds: [bot("shared"), chat("shared")] })))?.groups[0].memberIds.length, 2);
});

test("mixed projection ignores missing entities by kind and searches collapsed chats and ungrouped bots", () => {
  const roster = [
    { kind: "chat" as const, id: "shared", label: "Planning room", botIds: ["a", "b", "c"] },
    { kind: "bot" as const, id: "shared", label: "Researcher" },
    { kind: "chat" as const, id: "free", label: "Free room", botIds: ["a", "c"] },
    { kind: "bot" as const, id: "free", label: "Free bot" },
  ];
  const original = state(group("one", { collapsed: true, memberIds: [chat("shared"), bot("missing"), chat("missing")], primaryIds: ["missing"] }));
  const projected = projectAgentGroups(original, roster);
  assert.deepEqual(projected.groups[0].memberIds, [chat("shared")]);
  assert.deepEqual(projected.groups[0].primaryIds, []);
  assert.deepEqual(projected.ungrouped, roster.slice(1));
  const search = projectAgentGroups(original, roster, "PLANNING");
  assert.equal(search.groups[0].showMembers, true);
  assert.strictEqual(search.groups[0].members[0], roster[0]);
  assert.deepEqual(projectAgentGroups(original, roster, "free").ungrouped, roster.slice(2));
  assert.deepEqual(projectAgentGroups(applied(deleteAgentGroup(original, "one")), roster).ungrouped, roster);
  assert.deepEqual(roster[0].botIds, ["a", "b", "c"]);
  assert.deepEqual(roster[2].botIds, ["a", "c"]);
});

test("typed membership is deep-cloned and mixed account storage keeps entity kinds", () => {
  const storage = new MemoryStorage(), member = chat("room"), original = state(group("one", { memberIds: [member, bot("room")], primaryIds: ["room"] }));
  const parsed = parseAgentGroups(original)!;
  assert.notEqual(parsed.groups[0].memberIds[0], member);
  assert.deepEqual(saveAgentGroups("mixed-account", original, storage), { ok: true });
  assert.deepEqual(loadAgentGroups("mixed-account", storage).state, original);
  assert.deepEqual(loadAgentGroups("other-account", storage).state, emptyAgentGroups());
});

test("typed membership changes accept only ID references and never persist entity payloads", () => {
  const original = state(group("one"));
  const entity = { kind: "chat" as const, id: "room", label: "Synthetic title", botIds: ["a", "b"], secret: "SYNTHETIC_SECRET" };
  failed(assignAgentGroup(original, entity, "one"), "invalid-id");
  const assigned = applied(assignAgentGroup(original, { kind: entity.kind, id: entity.id }, "one"));
  const storage = new MemoryStorage();
  assert.equal(saveAgentGroups("account", assigned, storage).ok, true);
  assert.doesNotMatch(storage.writes[0].value, /Synthetic title|SYNTHETIC_SECRET|botIds|label/);
  assert.deepEqual(entity.botIds, ["a", "b"]);
});

test("existing v1 two-primary storage keeps the first primary and every member without automatic writes", () => {
  const storage = new MemoryStorage();
  saveAgentGroups("existing-account", emptyAgentGroups(), storage);
  const key = storage.writes[0].key;
  const existing = state(
    group("work", { name: "Existing work", collapsed: true, memberIds: [bot("a"), chat("a"), bot("b"), bot("c")], primaryIds: ["b", "a"] }),
    group("other", { memberIds: [chat("room"), bot("d")], primaryIds: [] }),
  );
  const raw = JSON.stringify(existing);
  storage.values.set(key, raw);
  const loaded = loadAgentGroups("existing-account", storage);
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.equal(loaded.source, "saved");
  assert.deepEqual(loaded.state.groups, [{ ...existing.groups[0], primaryIds: ["b"] }, existing.groups[1]]);
  assert.equal(storage.values.get(key), raw);
  assert.equal(storage.writes.length, 1);
  assert.deepEqual(existing.groups[0].primaryIds, ["b", "a"]);
  const renamed = applied(renameAgentGroup(loaded.state, "other", "Renamed"));
  assert.equal(saveAgentGroups("existing-account", renamed, storage).ok, true);
  assert.deepEqual(loadAgentGroups("existing-account", storage).state, renamed);
  assert.deepEqual(renamed.groups[0].memberIds, existing.groups[0].memberIds);
});

test("v1 migration is stable and validates both old primary references before normalizing", () => {
  const existing = state(group("one", { memberIds: [bot("a"), bot("b"), chat("room")], primaryIds: ["b", "a"] }));
  const normalized = parseAgentGroups(existing)!;
  assert.deepEqual(normalized.groups[0].primaryIds, ["b"]);
  assert.deepEqual(parseAgentGroups(normalized), normalized);
  assert.equal(parseAgentGroups(state(group("one", { memberIds: existing.groups[0].memberIds, primaryIds: ["a", "room"] }))), null);
  assert.equal(parseAgentGroups(state(group("one", { memberIds: existing.groups[0].memberIds, primaryIds: ["a", "a"] }))), null);
  assert.equal(parseAgentGroups(state(group("one", { memberIds: [bot("a"), bot("b"), bot("c")], primaryIds: ["a", "b", "c"] }))), null);
  const projection = projectAgentGroups(existing, agents.filter(agent => agent.id !== "b"));
  assert.deepEqual(projection.groups[0].primaryIds, [], "A missing first primary is not silently replaced by the previous second one");
  assert.deepEqual(projection.groups[0].members, [agents[0]]);
});

test("missing identity and failed persistence never reset or rewrite preexisting two-primary data", () => {
  const storage = new MemoryStorage();
  saveAgentGroups("existing-account", emptyAgentGroups(), storage);
  const key = storage.writes[0].key;
  const existing = state(group("one", { memberIds: [bot("a"), bot("b")], primaryIds: ["a", "b"] }));
  const raw = JSON.stringify(existing);
  storage.values.set(key, raw);
  storage.reads = [];
  assert.equal(loadAgentGroups(undefined, storage).ok, false);
  assert.equal(saveAgentGroups(undefined, existing, storage).ok, false);
  assert.deepEqual(storage.reads, []);
  assert.equal(storage.writes.length, 1);
  const loaded = loadAgentGroups("existing-account", storage);
  const failing = { getItem: (key: string) => storage.getItem(key), setItem() { throw new Error("quota"); } };
  assert.equal(saveAgentGroups("existing-account", loaded.state, failing).ok, false);
  assert.equal(storage.values.get(key), raw);
});
