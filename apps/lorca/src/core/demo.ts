import type { RuntimeSettings } from "../ui/types";
import type { BridgeStatus, LorcaBridge } from "./bridge";
import { appZh } from "../locale/app.zh-CN";

const epoch = 1791561600;
const text = (id: string, role: string, body: string, offset: number) => ({
  id,
  chat_id: "chat-demo",
  author:
    role === "you" ? { kind: "you" } : { kind: "bot", bot_id: "bot-demo" },
  body: { kind: "text", text: body },
  state: { kind: "complete" },
  created_at: epoch + offset,
});
export const demoSnapshot = {
  version: "synthetic-preview",
  has_identity: true,
  identity_id: "synthetic-account",
  relay_connected: false,
  relay_update_required: false,
  bots: [{ id: "bot-demo", name: "示例助手", runner_id: "runner-demo", symbol_name: "sparkles", accent: "indigo", has_avatar: false, avatar_version: null }],
  chats: [
    {
      id: "chat-demo",
      kind: "dm",
      title: null,
      bot_ids: ["bot-demo"],
      created_at: epoch,
      has_more: false,
      messages: [
        text(
          "msg-demo-1",
          "you",
          "Help me make a little more room for the things that matter this week.",
          0,
        ),
        text(
          "msg-demo-2",
          "bot",
          "Of course. Let's start with a simple plan.\n\n### Three things to keep\n\n- **A quiet morning** for your most important work\n- **A small window for errands**, so they don't take over the day\n- **One evening with no plans at all**\n\nThe rest can fit around those. What would you most like to make time for?",
          1,
        ),
        {
          id: "msg-demo-tool",
          chat_id: "chat-demo",
          author: { kind: "bot", bot_id: "bot-demo" },
          body: {
            kind: "tool",
            name: "read_notes",
            summary: "Reviewed the weekly plan",
            detail: "Synthetic activity for the interface preview.",
            is_running: false,
            is_error: false,
          },
          state: { kind: "complete" },
          created_at: epoch + 2,
        },
        text(
          "msg-demo-3",
          "you",
          "A long walk, and time to finish the project I've been putting off.",
          3,
        ),
        text(
          "msg-demo-4",
          "bot",
          "Then let's protect a focused block for the project first, and leave the walk open-ended. A little breathing room goes a long way.\n\nThis is a **synthetic preview**. Nothing has been read, scheduled, or sent to an agent.",
          4,
        ),
      ],
    },
    {
      id: "chat-demo-notes",
      kind: "group",
      title: "Ideas for the weekend",
      bot_ids: ["bot-demo"],
      created_at: epoch - 86400,
      has_more: false,
      messages: [],
    },
    {
      id: "chat-demo-writing",
      kind: "group",
      title: "A note worth keeping",
      bot_ids: ["bot-demo"],
      created_at: epoch - 172800,
      has_more: false,
      messages: [],
    },
  ],
  running_turns: [],
  running_chat_ids: [],
};
const previewChat = {
  id: "chat-demo-activity",
  kind: "dm",
  title: "Approval and activity preview",
  bot_ids: ["bot-demo"],
  created_at: epoch + 10,
  has_more: false,
  messages: [
    text(
      "msg-preview-code",
      "bot",
      "A small, readable helper:\n\n```ts\nexport function greet(name: string) {\n  return `Hello, ${name}!`;\n}\n```",
      10,
    ),
    {
      id: "msg-preview-permission",
      chat_id: "chat-demo-activity",
      author: { kind: "bot", bot_id: "bot-demo" },
      body: {
        kind: "permission",
        plugin_id: "computer",
        plugin_name: "Demo Runner",
        tool: "bash",
        summary: "Run the local formatter",
        decision: "pending",
        rule: "Allow the formatter in this synthetic demo",
        command: "npm run format",
        reason: "Synthetic permission card. No command will run.",
      },
      state: { kind: "complete" },
      created_at: epoch + 11,
    },
    {
      ...text(
        "msg-preview-queued",
        "you",
        "Please keep the changes small.",
        12,
      ),
      queued: true,
    },
  ].map((message) => ({ ...message, chat_id: "chat-demo-activity" })),
};
export const activitySnapshot = {
  ...demoSnapshot,
  chats: [...demoSnapshot.chats, previewChat],
  running_turns: [
    { job_id: "job-demo", chat_id: "chat-demo-activity", bot_id: "bot-demo" },
  ],
  running_chat_ids: ["chat-demo-activity"],
};
export const demoRuntimeSettings: RuntimeSettings = {
  editor: {
    revision: "synthetic-revision-1", canUpdateBots: true, canAddProvider: true, canManageMcp: true,
    models: [{ provider: "demo-provider", id: "synthetic-model", name: "示例模型", levels: ["low", "high"] }, { provider: "demo-provider", id: "synthetic-model-fast", name: "示例快速模型", levels: [] }],
    bots: [{ id: "bot-demo", thinking: null }],
    providers: [{ id: "demo-provider", canConfigure: true, canDisconnect: true }, { id: "demo-unconfigured", canConfigure: true, canDisconnect: false }],
    autoReview: { status: "ready", isEnabled: false, rules: [{ id: "synthetic-rule", text: "修改文件前先询问", behavior: "ask", tool: null }] },
  },
  version: "synthetic-preview", hasIdentity: true, relayConnected: false,
  updateRequired: false, authMode: "token",
  devices: [
    { id: "runner-demo", name: "Demo desktop", os: "macos", version: "synthetic-preview", online: true, isThisDevice: true,
      plugins: [{ id: "notes", name: "Demo notes", state: "ready", toolCount: null }] },
    { id: "runner-second", name: "Demo workstation", os: "linux", version: "synthetic-preview", online: false, isThisDevice: false, plugins: [] },
  ],
  providers: [{ id: "demo-provider", name: "Demo provider", connected: true }, { id: "demo-unconfigured", name: "Unconfigured provider", connected: false }],
  bots: [{ id: "bot-demo", name: "示例助手", runnerId: "runner-demo", provider: "demo-provider", model: "synthetic-model" }],
  mcp: { status: "ready", runnerId: "runner-demo", hasConfigError: false,
    servers: [
      { name: "Demo notes", transport: "stdio", enabled: true, state: "ready", toolCount: 3, hiddenToolCount: null, hasError: false },
      { name: "Demo calendar", transport: "http", enabled: true, state: "needs_auth", toolCount: 0, hiddenToolCount: null, hasError: false },
      { name: "Paused demo", transport: "stdio", enabled: false, state: "disabled", toolCount: 0, hiddenToolCount: null, hasError: false },
    ],
  },
};
export function createDemoBridge(): LorcaBridge {
  const inventory = structuredClone(demoRuntimeSettings);
  let revision = 1;
  let status: BridgeStatus = {
    status: "disconnected",
    endpoint: "ws://127.0.0.1:4862/ws",
    generation: 0,
    authMode: "token",
  };
  const statusListeners = new Set<(status: BridgeStatus) => void>();
  return {
    getStatus: async () => status,
    getSettings: async ({ runnerId }) => {
      const settings = structuredClone(inventory);
      if (runnerId && runnerId !== "runner-demo") {
        settings.mcp = { status: "unavailable", runnerId, hasConfigError: false, servers: [] };
        if (settings.editor) settings.editor.canManageMcp = false;
      }
      return settings;
    },
    settingsAction: async action => {
      const editor = inventory.editor!;
      if (action.revision !== editor.revision) throw new Error("示例设置已变化，请刷新后重试。");
      if (action.kind === "provider.configure" || action.kind === "mcp.configure") throw new Error("此处为合成演示；安全配置窗口仅在 dots 桌面应用中可用。");
      if (action.kind === "bot.update") {
        const bot = inventory.bots.find(bot => bot.id === action.botId);
        if (!bot) throw new Error("示例机器人不存在。");
        if (action.provider !== undefined) bot.provider = action.provider;
        if (action.model !== undefined) bot.model = action.model || null;
        if (action.runnerId !== undefined) bot.runnerId = action.runnerId;
        if (action.thinking !== undefined) editor.bots.find(bot => bot.id === action.botId)!.thinking = action.thinking || null;
      } else if (action.kind === "provider.disconnect") {
        const provider = inventory.providers.find(provider => provider.id === action.providerId);
        if (provider) provider.connected = false;
      } else if (action.kind === "autoReview.set") {
        editor.autoReview = { status: "ready", isEnabled: action.isEnabled, rules: action.rules.map((rule, index) => ({ ...rule, id: rule.id ?? `synthetic-rule-${index}`, tool: rule.tool ?? null })) };
      } else if (action.kind === "mcp.remove") {
        inventory.mcp.servers = inventory.mcp.servers.filter(server => server.name !== action.name);
      } else if (action.kind === "mcp.setEnabled") {
        const server = inventory.mcp.servers.find(server => server.name === action.name);
        if (server) { server.enabled = action.enabled; server.state = action.enabled ? "ready" : "disabled"; }
      }
      editor.revision = `synthetic-revision-${++revision}`;
      return { status: "applied" };
    },
    connect: async () => {
      status = {
        ...status,
        status: "connected",
        generation: status.generation + 1,
        detail: appZh.demoStatus,
      };
      for (const cb of statusListeners) cb(status);
      return status;
    },
    request: async (method) => {
      if (method === "bootstrap") return structuredClone(activitySnapshot);
      throw new Error(
        appZh.demoReadOnly,
      );
    },
    onEvent: () => () => {},
    onStatus: (callback) => {
      statusListeners.add(callback);
      return () => statusListeners.delete(callback);
    },
  };
}
