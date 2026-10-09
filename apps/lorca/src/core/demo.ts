import type { BridgeStatus, LorcaBridge } from "./bridge";

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
  bots: [{ id: "bot-demo", name: "Lorca", runner_id: "runner-demo" }],
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
export function createDemoBridge(): LorcaBridge {
  let status: BridgeStatus = {
    status: "disconnected",
    endpoint: "ws://127.0.0.1:4862/ws",
    generation: 0,
    authMode: "token",
  };
  const statusListeners = new Set<(status: BridgeStatus) => void>();
  return {
    getStatus: async () => status,
    connect: async () => {
      status = {
        ...status,
        status: "connected",
        generation: status.generation + 1,
        detail: "Synthetic preview. No CLI connection.",
      };
      for (const cb of statusListeners) cb(status);
      return status;
    },
    request: async (method) => {
      if (method === "bootstrap") return structuredClone(activitySnapshot);
      throw new Error(
        "This is a read-only synthetic preview. Launch the desktop app to talk to Lorca.",
      );
    },
    onEvent: () => () => {},
    onStatus: (callback) => {
      statusListeners.add(callback);
      return () => statusListeners.delete(callback);
    },
  };
}
