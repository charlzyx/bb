import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentInspector, agentNativeOutcomeMessage, agentProfilePatch } from "./inspector/AgentInspector";
import { pluginAccessSummary } from "./inspector/CapabilitiesPanel";
import type { AgentCapabilitiesSnapshot, AgentDetailsSnapshot, AgentInspectorProps } from "./inspector/types";

const snapshot: AgentDetailsSnapshot = {
  revision: "synthetic-ticket", version: "synthetic-content-version",
  bot: { id: "inspector-bot", name: "合成资料助手", description: "用于独立界面验证 <script>不执行</script>", symbolName: "star", accent: "indigo", provider: "fixture-provider", model: "fixture-model", thinking: "high", runnerId: "fixture-runner", hasAvatar: false, avatarVersion: null },
  runners: [{ id: "fixture-runner", name: "合成桌面", os: "macos", online: true }],
  providers: [{ id: "fixture-provider", name: "合成服务商", connected: true }],
  models: [{ provider: "fixture-provider", id: "fixture-model", name: "合成模型", levels: ["low", "high"] }],
  canCreate: false, canEditAvatar: false,
};
function render(overrides: Partial<AgentInspectorProps> = {}) {
  let calls = 0;
  const noop = () => { calls++; };
  const html = renderToStaticMarkup(<AgentInspector open scope="synthetic-scope" agentId="inspector-bot" agents={[{ id: "inspector-bot", label: "合成资料助手" }]} details={snapshot} memory={{ status: "ready", lines: 9, bytes: 3482, maxLines: 200, maxBytes: 24576, topicCount: 2, logCount: 3, canEdit: true }} onClose={noop} onSelectAgent={noop} onRefresh={noop} onAction={async () => { calls++; return { status: "applied", botId: "inspector-bot" }; }} onOpenMemory={async () => { calls++; }} {...overrides} />);
  return { html, calls };
}

test("Inspector renders supplied profile and memory counts without native operations or memory text", () => {
  const { html, calls } = render();
  for (const heading of ["查看智能体", "资料", "运行方式", "记忆", "例行任务", "插件"]) assert.ok(html.includes(heading));
  assert.match(html, /9 行 · 3\.4 KiB \/ 24 KiB/);
  assert.match(html, /2 个主题 · 3 天日志/);
  assert.match(html, /&lt;script&gt;不执行&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /记忆正文只在独立编辑窗口中读取与保存/);
  assert.match(html, /当前连接尚不支持修改头像/);
  assert.equal(calls, 0);
});

test("Unknown metadata remains unreported and absent native capabilities stay unavailable", () => {
  const { html } = render({ memory: { status: "unavailable", lines: null, bytes: null, maxLines: null, maxBytes: null, topicCount: null, logCount: null, canEdit: false }, onOpenMemory: undefined, onOpenPlugins: undefined });
  assert.match(html, /尚未读取/);
  assert.doesNotMatch(html, /0 行|0 天日志|0 个主题/);
  assert.match(html, /disabled=""[^>]*>编辑…/);
  assert.match(html, /disabled=""[^>]*>查看 Runner 的插件/);
});

test("Create mode requires fresh runner selection and shows no existing bot identity", () => {
  const { html, calls } = render({ agentId: null, agents: [], details: { ...snapshot, bot: null, canCreate: true } });
  assert.match(html, /新建智能体/);
  assert.match(html, /<option value="" disabled="" selected="">未分配/);
  assert.match(html, /本次不发送消息/);
  assert.match(html, /可能包含完整访问/);
  assert.doesNotMatch(html, /查看智能体|修改头像|合成资料助手/);
  assert.equal(calls, 0);
  const unavailable = render({ agentId: null, agents: [], details: { ...snapshot, bot: null, runners: [], canCreate: false } }).html;
  assert.match(unavailable, /当前没有可用于创建智能体的 Runner/);
  assert.match(unavailable, /<fieldset disabled=""/);
});

test("Profile patches clear provider-dependent configuration and contain only explicit changes", () => {
  const bot = snapshot.bot!;
  const draft = { name: bot.name, description: bot.description, provider: bot.provider!, model: bot.model!, thinking: bot.thinking!, runnerId: bot.runnerId };
  assert.deepEqual(agentProfilePatch(bot, draft), {});
  assert.deepEqual(agentProfilePatch(bot, { ...draft, name: "修改后的合成名称" }), { name: "修改后的合成名称" });
  assert.deepEqual(agentProfilePatch(bot, { ...draft, provider: "other-provider", model: "", thinking: "" }), { provider: "other-provider", model: "", thinking: "" });
  assert.deepEqual(agentProfilePatch(bot, { ...draft, model: "other-model", thinking: "" }), { model: "other-model", thinking: "" });
  assert.deepEqual(agentProfilePatch(bot, { ...draft, runnerId: "other-runner" }), { runnerId: "other-runner" });
});

test("A snapshot for another bot is never shown under the requested identity", () => {
  const { html } = render({ agentId: "different-bot", agents: [], loading: true });
  assert.doesNotMatch(html, /合成资料助手|用于独立界面验证/);
  assert.match(html, /正在读取智能体详情/);
});


const capabilities: AgentCapabilitiesSnapshot = {
  revision: "synthetic-capability-ticket", version: "synthetic-capability-version", botId: "inspector-bot", botName: "合成资料助手", runnerId: "fixture-runner",
  routines: [{ id: "routine-one", botId: "inspector-bot", name: "合成例行检查", prompt: "仅读取合成样本", schedule: "every 1h", scheduleText: "每小时", timezone: "UTC", missedRunPolicy: "coalesce", enabled: true, running: false, state: "on", nextRunAt: null, lastRunAt: null, lastOutcome: null, pausedReason: null, hasCheck: false, triggerKind: "schedule", editable: true }],
  plugins: [{ id: "synthetic-plugin", name: "合成插件", tools: [{ name: "inspect", title: "检查样本", capability: "read" }], capabilities: ["read"], allowedTools: ["inspect"] }],
  permissions: { allConnections: false, filesystem: "read", shell: false, drafts: false }, capabilities: { canCreateRoutine: true, canEditPlugins: true },
};

test("Routine and plugin summaries use reported state and expose only explicit native actions", () => {
  const { html, calls } = render({ capabilities, onCapabilitiesAction: async () => { assert.fail("Rendering must not perform capability actions"); } });
  assert.match(html, /合成例行检查/);
  assert.match(html, /每小时 · 已启用/);
  assert.match(html, /下次：未报告/);
  assert.match(html, /立即运行/);
  assert.match(html, /删除任务…/);
  assert.match(html, /暂停或删除计划不会取消正在运行的任务/);
  assert.match(html, /读取 · 1 项工具/);
  assert.match(html, /不卸载插件，也不更改账户连接/);
  assert.equal(calls, 0);
  assert.equal(pluginAccessSummary({ ...capabilities.plugins[0], allowedTools: [] }), "未授权工具");
  assert.equal(pluginAccessSummary({ ...capabilities.plugins[0], capabilities: [], allowedTools: null }), "未授权工具");
});

test("Advanced routines remain visibly read-only and all-connections scope is disclosed", () => {
  const html = render({ capabilities: { ...capabilities, routines: [{ ...capabilities.routines[0], editable: false, hasCheck: true }], permissions: { ...capabilities.permissions, allConnections: true } }, onCapabilitiesAction: async () => ({ status: "cancelled", botId: "inspector-bot" }) }).html;
  assert.match(html, /disabled=""[^>]*>编辑任务/);
  assert.match(html, /包含检查脚本或高级触发器/);
  assert.match(html, /所有现有及未来插件/);
  assert.match(html, /后续新插件不再自动获权/);
});

test("Independent capability read failures do not become a false empty list or hide the profile", () => {
  const html = render({ capabilitiesError: "合成：读取失败", contextNotice: "当前正在保留另一聊天的智能体草稿。" }).html;
  assert.match(html, /合成：读取失败/);
  assert.match(html, /重新读取例行任务与插件/);
  assert.match(html, /尚无法确认当前列表/);
  assert.doesNotMatch(html, /此智能体暂无例行任务/);
  assert.match(html, /合成资料助手/);
  assert.match(html, /当前正在保留另一聊天的智能体草稿/);
});

test("Avatar reset appears only for an actual custom avatar and never runs on render", () => {
  const html = render({ details: { ...snapshot, bot: { ...snapshot.bot!, hasAvatar: true }, canEditAvatar: true }, onRemoveAvatar: async () => { assert.fail("Avatar reset requires an explicit user action"); } }).html;
  assert.match(html, /恢复默认头像/);
  assert.doesNotMatch(render().html, /恢复默认头像/);
});

test("Known thinking levels use Chinese labels without changing submitted values", () => {
  const html = render({ details: { ...snapshot, models: [{ ...snapshot.models[0], levels: ["minimal", "low", "medium", "high", "xhigh", "custom-level"] }] } }).html;
  assert.match(html, /<option value="low">低<\/option>/);
  assert.match(html, /<option value="high" selected="">高<\/option>/);
  assert.match(html, /<option value="custom-level">custom-level<\/option>/);
});

test("Native editor feedback distinguishes applied, cancelled, unknown and open-only results", () => {
  assert.equal(agentNativeOutcomeMessage({ status: "applied", botId: "synthetic" }), "更改已应用。");
  assert.equal(agentNativeOutcomeMessage({ status: "cancelled", botId: "synthetic" }), "已取消操作。");
  assert.match(agentNativeOutcomeMessage({ status: "unknownOutcome", botId: "synthetic" })!, /结果尚不确定.*未自动重发/);
  assert.equal(agentNativeOutcomeMessage(undefined), null);
});

test("Unavailable routine runs are disabled and sanitized pause reasons are shown in Chinese", () => {
  for (const change of [{ running: true }, { state: "waiting_for_runner" as const }, { pausedReason: "authentication" }]) {
    const html = render({ capabilities: { ...capabilities, routines: [{ ...capabilities.routines[0], ...change }] }, onCapabilitiesAction: async () => ({ status: "cancelled", botId: "inspector-bot" }) }).html;
    assert.match(html, /disabled=""[^>]*>立即运行/);
    if (change.pausedReason) { assert.match(html, /需要重新认证后才能运行/); assert.doesNotMatch(html, />authentication</); }
  }
  const html = render({ capabilities: { ...capabilities, routines: [{ ...capabilities.routines[0], pausedReason: "away" }] }, onCapabilitiesAction: async () => ({ status: "cancelled", botId: "inspector-bot" }) }).html;
  assert.match(html, /智能体暂时离开，计划已暂停/);
  assert.doesNotMatch(html, /disabled=""[^>]*>立即运行/);
});
