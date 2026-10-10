import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentGroupTree, type AgentGroupTreeProps } from "./AgentGroupTree";
import type { AgentGroupsState, AgentGroupsStorage } from "./agent-groups";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const agents: AgentGroupTreeProps["agents"] = [
  { id: "writer", label: "合成写作助手", appearance: { botId: "writer", name: "合成写作助手", symbolName: "star", accent: "pink", image } },
  { id: "code", label: "合成代码助手", status: "running", appearance: { botId: "code", name: "合成代码助手", symbolName: "terminal", accent: "green" } },
  { id: "review", label: "合成核对助手", status: "waiting" },
  { id: "free", label: "未分类 <script>智能体</script>" },
];
const configured: AgentGroupsState = {
  version: 1,
  groups: [
    { id: "work", name: "日常工作", collapsed: false, memberIds: [{ kind: "bot", id: "writer" }, { kind: "bot", id: "code" }], primaryIds: ["writer", "code"] },
    { id: "check", name: "交叉核对", collapsed: false, memberIds: [{ kind: "bot", id: "review" }], primaryIds: [] },
  ],
};

function fixture(state: AgentGroupsState = configured) {
  const reads: string[] = [];
  const writes: [string, string][] = [];
  const selections: string[] = [];
  const storage: AgentGroupsStorage = {
    getItem(key) { reads.push(key); return JSON.stringify(state); },
    setItem(key, value) { writes.push([key, value]); },
  };
  const render = (props: Partial<AgentGroupTreeProps> = {}) => renderToStaticMarkup(<AgentGroupTree namespace="synthetic-account-one" agents={agents} storage={storage} onSelectAgent={(id) => selections.push(id)} {...props} />);
  return { render, reads, writes, selections };
}

test("Agent groups render exactly two levels, named primaries and every ungrouped agent without starting a chat", () => {
  const f = fixture();
  const html = f.render({ selectedAgentId: "writer" });
  assert.match(html, /aria-label="智能体与群聊分组"/);
  assert.match(html, /data-agent-group="work"/);
  assert.match(html, /data-agent-group="check"/);
  for (const agent of agents) assert.equal(html.split(`data-agent-select="${agent.id}"`).length - 1, 1);
  assert.equal((html.match(/class="lorca-agent-primary"/g) ?? []).length, 2);
  assert.match(html, /未设主力/);
  assert.match(html, /aria-label="未分组项目"/);
  assert.match(html, /data-agent-select="writer" aria-current="page"/);
  assert.match(html, /未分类 &lt;script&gt;智能体&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /分组与主力标记仅用于本地整理/);
  assert.deepEqual(f.selections, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.reads, ["dots.agent-groups.v1:synthetic-account-one"]);
});

test("A collapsed group hides its members until a member or group search temporarily expands it", () => {
  const collapsed = { ...configured, groups: configured.groups.map((group) => ({ ...group, collapsed: true })) };
  const f = fixture(collapsed);
  const idle = f.render();
  assert.match(idle, /aria-expanded="false"/);
  assert.doesNotMatch(idle, /data-agent-select="writer"|data-agent-select="code"/);
  assert.match(idle, /data-agent-select="free"/);
  const memberMatch = f.render({ search: "代码" });
  assert.match(memberMatch, /aria-expanded="true"[^>]*disabled=""/);
  assert.match(memberMatch, /data-agent-select="code"/);
  assert.doesNotMatch(memberMatch, /data-agent-select="writer"|data-agent-select="free"|data-agent-group="check"/);
  const groupMatch = f.render({ search: "日常工作" });
  assert.match(groupMatch, /data-agent-select="writer"/);
  assert.match(groupMatch, /data-agent-select="code"/);
  assert.deepEqual(f.writes, []);
  assert.equal(collapsed.groups[0].collapsed, true);
});

test("Default groups are never invented and missing agents cannot appear as primary members", () => {
  const f = fixture({ version: 1, groups: [{ id: "missing", name: "保留的本地分类", collapsed: false, memberIds: [{ kind: "bot", id: "removed-agent" }], primaryIds: ["removed-agent"] }] });
  const html = f.render();
  assert.match(html, /未设主力/);
  assert.doesNotMatch(html, /class="lorca-agent-primary"|data-agent-select="removed-agent"/);
  for (const agent of agents) assert.match(html, new RegExp(`data-agent-select="${agent.id}"`));
  const fresh = fixture({ version: 1, groups: [] }).render();
  assert.doesNotMatch(fresh, /data-agent-group=/);
  assert.match(fresh, /aria-label="未分组项目"/);
});

test("No account namespace means no local storage access and no enabled grouping controls", () => {
  const f = fixture();
  const html = f.render({ namespace: undefined });
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.writes, []);
  assert.match(html, /尚未确认账号/);
  assert.match(html, /disabled=""[^>]*aria-label="创建分组"/);
  assert.match(html, /disabled=""[^>]*aria-label="整理智能体 合成写作助手"/);
  assert.doesNotMatch(html, /data-agent-group="work"/);
  assert.match(html, /data-agent-select="writer"/);
});

test("A storage failure is visibly reported without claiming the grouping was loaded or saved", () => {
  const f = fixture();
  const html = f.render({ storage: { getItem() { throw new Error("Synthetic blocked storage"); }, setItem() { assert.fail("Rendering never writes local preferences"); } } });
  assert.match(html, /role="alert">本地存储不可用/);
  assert.doesNotMatch(html, /data-agent-group=|已保存本地分组/);
  assert.match(html, /data-agent-select="writer"/);
});

test("Corrupt stored groups remain visible as an error while the complete current roster stays available", () => {
  const html = fixture().render({ storage: { getItem: () => "{broken", setItem() { assert.fail("Rendering must preserve corrupt data"); } } });
  assert.match(html, /格式无效/);
  assert.match(html, /原数据未被覆盖/);
  for (const agent of agents) assert.match(html, new RegExp(`data-agent-select="${agent.id}"`));
});

test("Each account namespace reads its own groups without falling back to another account", () => {
  const storage: AgentGroupsStorage = {
    getItem: (key) => key.endsWith("synthetic-account-one") ? JSON.stringify(configured) : null,
    setItem() { assert.fail("Reading another account must not migrate stored groups"); },
  };
  const f = fixture();
  assert.match(f.render({ storage }), /data-agent-group="work"/);
  assert.doesNotMatch(f.render({ storage, namespace: "synthetic-account-two" }), /data-agent-group="work"|日常工作/);
});

test("Agent rows retain the real image and only report the supplied running or waiting state", () => {
  const html = fixture().render();
  assert.match(html, new RegExp(`src="${image}"`));
  assert.match(html, /data-avatar-bot="writer"/);
  assert.match(html, /aria-label="运行中"/);
  assert.match(html, /aria-label="等待审批"/);
  assert.equal((html.match(/class="lorca-agent-status /g) ?? []).length, 2);
  assert.match(html, /aria-label="管理分组 日常工作"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /aria-label="整理智能体 合成写作助手"[^>]*aria-haspopup="dialog"/);
});

test("An empty roster or unmatched search is explicit and performs no automatic selection", () => {
  const f = fixture({ version: 1, groups: [] });
  assert.match(f.render({ agents: [] }), /当前账号还没有智能体/);
  assert.match(f.render({ search: "不存在的合成名称" }), /没有匹配的分组、智能体或群聊/);
  assert.deepEqual(f.selections, []);
});

test("A group chat and a bot with the same raw ID render as distinct members and only the bot is primary", () => {
  const f = fixture({ version: 1, groups: [{ id: "mixed", name: "混合分类", collapsed: false, memberIds: [{ kind: "bot", id: "writer" }, { kind: "chat", id: "writer" }], primaryIds: ["writer"] }] });
  const selectedChats: string[] = [];
  const html = f.render({ conversations: [
    { kind: "group", id: "writer", title: "合成共享群聊", updatedAt: "2026-10-10", status: "idle", avatars: [agents[0].appearance!, agents[1].appearance!] },
    { kind: "dm", id: "dm", title: "私聊不能重复进入分类树", updatedAt: "2026-10-10", status: "idle" },
  ], selectedAgentId: "writer", selectedConversationId: "writer", onSelectConversation: (id) => selectedChats.push(id) });
  assert.match(html, /data-group-member="bot:writer"/);
  assert.match(html, /data-group-member="chat:writer"/);
  assert.match(html, /data-group-chat-select="writer" aria-current="page"/);
  assert.doesNotMatch(html, /data-agent-select="writer" aria-current="page"/);
  assert.equal((html.match(/class="lorca-agent-primary"/g) ?? []).length, 1);
  assert.match(html, /整理群聊 合成共享群聊/);
  assert.match(html, /lorca-avatar-stack/);
  assert.doesNotMatch(html, /私聊不能重复进入分类树/);
  assert.deepEqual(selectedChats, []);
  assert.deepEqual(f.writes, []);
});

test("A collapsed mixed group is searchable by its group-chat name without borrowing bot primary status", () => {
  const f = fixture({ version: 1, groups: [{ id: "mixed", name: "混合分类", collapsed: true, memberIds: [{ kind: "bot", id: "writer" }, { kind: "chat", id: "writer" }], primaryIds: ["writer"] }] });
  const conversations: AgentGroupTreeProps["conversations"] = [{ kind: "group", id: "writer", title: "合成共享群聊", updatedAt: "2026-10-10", status: "idle" }];
  const html = f.render({ conversations, onSelectConversation() {}, search: "共享群聊" });
  assert.match(html, /data-group-chat-select="writer"/);
  assert.doesNotMatch(html, /data-agent-select="writer"|class="lorca-agent-primary"/);
  assert.match(html, /aria-expanded="true"/);
  const missingBot = f.render({ agents: [], conversations, onSelectConversation() {}, search: "共享群聊" });
  assert.match(missingBot, /未设主力智能体/);
  assert.doesNotMatch(missingBot, /class="lorca-agent-primary"/);
});

test("Unassigned group chats remain available, while a missing open callback disables the chat action", () => {
  const html = fixture({ version: 1, groups: [] }).render({ conversations: [{ kind: "group", id: "group-only", title: "合成已有群聊", updatedAt: "2026-10-10", status: "waiting" }] });
  assert.match(html, /data-group-chat-select="group-only" disabled=""/);
  assert.match(html, /aria-label="整理群聊 合成已有群聊"/);
  assert.match(html, /class="lorca-agent-group-chat-label">群聊/);
});

test("Group styling confines its controls and removes the closing popover interaction layer without avatar filters", () => {
  const css = readFileSync(new URL("./agent-groups.css", import.meta.url), "utf8");
  assert.match(css, /\[data-state="closed"\]\s*\{\s*animation: none !important;/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /@scope|filter:|\.lorca-avatar\s*\{|#[0-9a-f]{3,8}\b/i);
});
