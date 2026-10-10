export interface AgentGroupEntityId {
  readonly kind: "bot" | "chat";
  readonly id: string;
}

export interface AgentGroup {
  readonly id: string;
  readonly name: string;
  readonly collapsed: boolean;
  readonly memberIds: readonly AgentGroupEntityId[];
  readonly primaryIds: readonly string[];
}

export interface AgentGroupsState {
  readonly version: 1;
  readonly groups: readonly AgentGroup[];
}

export interface AgentGroupsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type AgentGroupsError = "missing-account" | "storage-unavailable" | "corrupt-data" | "invalid-state" | "invalid-id" | "invalid-name" | "invalid-collapse" | "duplicate-group" | "group-not-found" | "group-limit" | "member-limit" | "primary-limit" | "primary-membership";
export type AgentGroupsMutation = { ok: true; state: AgentGroupsState } | { ok: false; state: AgentGroupsState; error: AgentGroupsError; message: string };
export type AgentGroupsLoad = { ok: true; state: AgentGroupsState; source: "empty" | "saved" } | { ok: false; state: AgentGroupsState; error: AgentGroupsError; message: string };
export type AgentGroupsSave = { ok: true } | { ok: false; error: AgentGroupsError; message: string };

export const AGENT_GROUP_LIMITS = Object.freeze({ groups: 64, membersPerGroup: 512, totalMembers: 4096, primaryPerGroup: 2, nameLength: 80, idLength: 256, storageBytes: 65536 });

const messages: Record<AgentGroupsError, string> = {
  "missing-account": "尚未确认账号，未读取或保存本地分组。",
  "storage-unavailable": "本地存储不可用，本地分组未能读取或保存。",
  "corrupt-data": "已保存的本地分组格式无效，暂以未分组显示；原数据未被覆盖。",
  "invalid-state": "本地分组数据无效，未应用更改。",
  "invalid-id": "智能体、群聊或分组标识无效。",
  "invalid-name": "分组名称须为 1 至 80 个字符，且不能包含控制字符。",
  "invalid-collapse": "分组折叠状态无效。",
  "duplicate-group": "此分组标识已存在。",
  "group-not-found": "此分组已不存在，请刷新后重试。",
  "group-limit": "本地分组最多 64 个。",
  "member-limit": "分组成员数量或本地分组数据大小已达上限。",
  "primary-limit": "每个分组最多设置 2 个主力智能体。",
  "primary-membership": "主力只能选择当前分组的智能体，不能选择群聊或重复选择。",
};

type MutableGroup = { id: string; name: string; collapsed: boolean; memberIds: AgentGroupEntityId[]; primaryIds: string[] };
const controls = /[\x00-\x1f\x7f]/;
const idValue = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= AGENT_GROUP_LIMITS.idLength && value === value.trim() && !controls.test(value);
const nameValue = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= AGENT_GROUP_LIMITS.nameLength && value === value.trim() && !controls.test(value);
const normalizeName = (value: string): string => typeof value === "string" ? value.trim() : "";
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
}
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
function identifiers(value: unknown, limit: number): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every(idValue) && new Set(value).size === value.length;
}
function entityValue(value: unknown): value is AgentGroupEntityId {
  return record(value) && keys(value, ["kind", "id"]) && (value.kind === "bot" || value.kind === "chat") && idValue(value.id);
}
export function agentGroupEntityKey(entity: AgentGroupEntityId): string { return `${entity.kind}:${entity.id}`; }
function entities(value: unknown, limit: number): value is AgentGroupEntityId[] {
  return Array.isArray(value) && value.length <= limit && value.every(entityValue) && new Set(value.map(agentGroupEntityKey)).size === value.length;
}
export function emptyAgentGroups(): AgentGroupsState { return { version: 1, groups: [] }; }

export function parseAgentGroups(value: unknown): AgentGroupsState | null {
  if (!record(value) || !keys(value, ["version", "groups"]) || value.version !== 1 || !Array.isArray(value.groups) || value.groups.length > AGENT_GROUP_LIMITS.groups) return null;
  const groupIds = new Set<string>(), memberIds = new Set<string>();
  const groups: AgentGroup[] = [];
  for (const group of value.groups) {
    if (!record(group) || !keys(group, ["id", "name", "collapsed", "memberIds", "primaryIds"]) || !idValue(group.id) || groupIds.has(group.id) || !nameValue(group.name) || typeof group.collapsed !== "boolean" || !entities(group.memberIds, AGENT_GROUP_LIMITS.membersPerGroup) || !identifiers(group.primaryIds, AGENT_GROUP_LIMITS.primaryPerGroup)) return null;
    const members = group.memberIds;
    if (group.primaryIds.some(id => !members.some(member => member.kind === "bot" && member.id === id)) || members.some(member => memberIds.has(agentGroupEntityKey(member)))) return null;
    groupIds.add(group.id);
    for (const member of group.memberIds) memberIds.add(agentGroupEntityKey(member));
    if (memberIds.size > AGENT_GROUP_LIMITS.totalMembers) return null;
    groups.push({ id: group.id, name: group.name, collapsed: group.collapsed, memberIds: group.memberIds.map(member => ({ ...member })), primaryIds: [...group.primaryIds] });
  }
  const state: AgentGroupsState = { version: 1, groups };
  return byteLength(JSON.stringify(state)) <= AGENT_GROUP_LIMITS.storageBytes ? state : null;
}

function change(state: AgentGroupsState, edit: (groups: MutableGroup[]) => AgentGroupsError | null): AgentGroupsMutation {
  const parsed = parseAgentGroups(state);
  if (!parsed) return { ok: false, state: emptyAgentGroups(), error: "invalid-state", message: messages["invalid-state"] };
  const groups = parsed.groups.map(group => ({ ...group, memberIds: group.memberIds.map(member => ({ ...member })), primaryIds: [...group.primaryIds] }));
  const error = edit(groups);
  if (error) return { ok: false, state: parsed, error, message: messages[error] };
  const result = parseAgentGroups({ version: 1, groups });
  return result ? { ok: true, state: result } : { ok: false, state: parsed, error: "member-limit", message: messages["member-limit"] };
}

export function createAgentGroup(state: AgentGroupsState, id: string, name: string): AgentGroupsMutation {
  return change(state, groups => {
    const normalized = normalizeName(name);
    if (!idValue(id)) return "invalid-id";
    if (!nameValue(normalized)) return "invalid-name";
    if (groups.some(group => group.id === id)) return "duplicate-group";
    if (groups.length >= AGENT_GROUP_LIMITS.groups) return "group-limit";
    groups.push({ id, name: normalized, collapsed: false, memberIds: [], primaryIds: [] });
    return null;
  });
}

export function renameAgentGroup(state: AgentGroupsState, groupId: string, name: string): AgentGroupsMutation {
  return change(state, groups => {
    const normalized = normalizeName(name);
    if (!idValue(groupId)) return "invalid-id";
    if (!nameValue(normalized)) return "invalid-name";
    const group = groups.find(group => group.id === groupId);
    if (!group) return "group-not-found";
    group.name = normalized;
    return null;
  });
}

export function assignAgentGroup(state: AgentGroupsState, entity: AgentGroupEntityId, groupId: string | null): AgentGroupsMutation {
  return change(state, groups => {
    if (!entityValue(entity) || (groupId !== null && !idValue(groupId))) return "invalid-id";
    const target = groupId === null ? null : groups.find(group => group.id === groupId);
    if (groupId !== null && !target) return "group-not-found";
    const entityKey = agentGroupEntityKey(entity);
    if (target?.memberIds.some(member => agentGroupEntityKey(member) === entityKey)) return null;
    if (target && target.memberIds.length >= AGENT_GROUP_LIMITS.membersPerGroup) return "member-limit";
    for (const group of groups) {
      group.memberIds = group.memberIds.filter(member => agentGroupEntityKey(member) !== entityKey);
      if (entity.kind === "bot") group.primaryIds = group.primaryIds.filter(id => id !== entity.id);
    }
    target?.memberIds.push({ ...entity });
    return null;
  });
}

export function setAgentGroupPrimary(state: AgentGroupsState, groupId: string, primaryIds: readonly string[]): AgentGroupsMutation {
  return change(state, groups => {
    if (!idValue(groupId)) return "invalid-id";
    if (!Array.isArray(primaryIds) || primaryIds.length > AGENT_GROUP_LIMITS.primaryPerGroup) return "primary-limit";
    const group = groups.find(group => group.id === groupId);
    if (!group) return "group-not-found";
    if (!identifiers(primaryIds, AGENT_GROUP_LIMITS.primaryPerGroup) || primaryIds.some(id => !group.memberIds.some(member => member.kind === "bot" && member.id === id))) return "primary-membership";
    group.primaryIds = [...primaryIds];
    return null;
  });
}

export function setAgentGroupCollapsed(state: AgentGroupsState, groupId: string, collapsed: boolean): AgentGroupsMutation {
  return change(state, groups => {
    if (!idValue(groupId)) return "invalid-id";
    if (typeof collapsed !== "boolean") return "invalid-collapse";
    const group = groups.find(group => group.id === groupId);
    if (!group) return "group-not-found";
    group.collapsed = collapsed;
    return null;
  });
}

export function deleteAgentGroup(state: AgentGroupsState, groupId: string): AgentGroupsMutation {
  return change(state, groups => {
    if (!idValue(groupId)) return "invalid-id";
    const index = groups.findIndex(group => group.id === groupId);
    if (index < 0) return "group-not-found";
    groups.splice(index, 1);
    return null;
  });
}

function accountKey(namespace: string | null | undefined): string | null {
  if (typeof namespace !== "string" || !namespace.trim() || namespace !== namespace.trim() || namespace.length > 512 || controls.test(namespace) || /^(anonymous|unknown|null|undefined)$/i.test(namespace)) return null;
  try { return `dots.agent-groups.v1:${encodeURIComponent(namespace)}`; } catch { return null; }
}

export function loadAgentGroups(namespace: string | null | undefined, storage?: AgentGroupsStorage): AgentGroupsLoad {
  const key = accountKey(namespace);
  if (!key) return { ok: false, state: emptyAgentGroups(), error: "missing-account", message: messages["missing-account"] };
  let serialized: string | null;
  try { serialized = (storage ?? globalThis.localStorage).getItem(key); }
  catch { return { ok: false, state: emptyAgentGroups(), error: "storage-unavailable", message: messages["storage-unavailable"] }; }
  if (serialized === null) return { ok: true, state: emptyAgentGroups(), source: "empty" };
  let state: AgentGroupsState | null = null;
  if (typeof serialized === "string" && serialized.length <= AGENT_GROUP_LIMITS.storageBytes && byteLength(serialized) <= AGENT_GROUP_LIMITS.storageBytes) {
    try { state = parseAgentGroups(JSON.parse(serialized)); } catch {}
  }
  return state ? { ok: true, state, source: "saved" } : { ok: false, state: emptyAgentGroups(), error: "corrupt-data", message: messages["corrupt-data"] };
}

export function saveAgentGroups(namespace: string | null | undefined, state: AgentGroupsState, storage?: AgentGroupsStorage): AgentGroupsSave {
  const key = accountKey(namespace);
  if (!key) return { ok: false, error: "missing-account", message: messages["missing-account"] };
  const parsed = parseAgentGroups(state);
  if (!parsed) return { ok: false, error: "invalid-state", message: messages["invalid-state"] };
  try { (storage ?? globalThis.localStorage).setItem(key, JSON.stringify(parsed)); return { ok: true }; }
  catch { return { ok: false, error: "storage-unavailable", message: messages["storage-unavailable"] }; }
}

export interface ProjectedAgentGroup<T> extends AgentGroup {
  members: T[];
  primaries: T[];
  showMembers: boolean;
  totalMembers: number;
}

export function projectAgentGroups<T extends AgentGroupEntityId & { label: string }>(state: AgentGroupsState, entities: readonly T[], query = ""): { groups: ProjectedAgentGroup<T>[]; ungrouped: T[] } {
  const normalized = query.trim().normalize("NFKC").toLowerCase();
  const matches = (text: string) => text.normalize("NFKC").toLowerCase().includes(normalized);
  const current = new Map<string, T>();
  for (const entity of entities) if ((entity.kind === "bot" || entity.kind === "chat") && idValue(entity.id) && typeof entity.label === "string" && !current.has(agentGroupEntityKey(entity))) current.set(agentGroupEntityKey(entity), entity);
  const assigned = new Set<string>(), groups: ProjectedAgentGroup<T>[] = [];
  for (const group of parseAgentGroups(state)?.groups ?? []) {
    const members = group.memberIds.flatMap(id => { const member = current.get(agentGroupEntityKey(id)); return member ? [member] : []; });
    for (const member of members) assigned.add(agentGroupEntityKey(member));
    const primaryIds = group.primaryIds.filter(id => current.has(agentGroupEntityKey({ kind: "bot", id })));
    const visible = normalized && !matches(group.name) ? members.filter(member => matches(member.label)) : members;
    if (normalized && !matches(group.name) && !visible.length) continue;
    groups.push({ ...group, memberIds: members.map(member => ({ kind: member.kind, id: member.id })), primaryIds, members: visible, primaries: primaryIds.map(id => current.get(agentGroupEntityKey({ kind: "bot", id }))!), showMembers: Boolean(normalized) || !group.collapsed, totalMembers: members.length });
  }
  return { groups, ungrouped: [...current.values()].filter(agent => !assigned.has(agentGroupEntityKey(agent)) && (!normalized || matches(agent.label))) };
}
