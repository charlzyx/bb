export function installLayoutToolsFixture() {
  const epoch = Math.floor(Date.now() / 1000);
  const listeners = new Set();
  const requests = [];
  let serial = 0;
  const message = (chat, id, body, author = "layout-a") => ({ id, chat_id: chat, author: author === "you" ? { kind: "you" } : { kind: "bot", bot_id: author }, body, state: { kind: "complete" }, created_at: epoch + serial++ });
  const tool = (chat, id, { author = "layout-a", running = false, error = false, summary = `Synthetic ${id}`, detail = `Synthetic output for ${id}` } = {}) => message(chat, id, { kind: "tool", name: "synthetic_read", summary, detail, is_running: running, is_error: error }, author);
  const text = (chat, id, value, author) => message(chat, id, { kind: "text", text: value }, author);
  const tools = [
    ...Array.from({ length: 7 }, (_, index) => tool("tools-chat", `normal-${index + 1}`)),
    text("tools-chat", "text-boundary", "合成文字分界：下面是两项工具记录，其中一项失败。"),
    tool("tools-chat", "error-one"),
    tool("tools-chat", "error-two", { error: true, summary: "Synthetic permission failure", detail: "合成错误详情，必须清晰可见。" }),
    message("tools-chat", "approval-boundary", { kind: "permission", plugin_id: "synthetic", plugin_name: "Synthetic local fixture", tool: "read", summary: "Synthetic approval remains available", decision: "pending", reason: "This fixture never executes the action." }),
    text("tools-chat", "user-boundary", "请继续检查另一组工具。", "you"),
    tool("tools-chat", "after-user"),
    tool("tools-chat", "other-author", { author: "layout-b" }),
    tool("tools-chat", "running-one"),
    tool("tools-chat", "running-two", { running: true, summary: "Synthetic fetch /lookup", detail: "Waiting for a synthetic result" }),
  ];
  const layout = [];
  for (let index = 0; index < 24; index++) {
    layout.push(text("layout-chat", `layout-text-${index}`, `合成布局段落 ${index + 1}\n\n${"这段内容只验证宽屏与阅读模式的换行、滚动锚点和输入框对齐，不连接真实服务。".repeat(9)}`));
    if (index % 4 === 3) for (let item = 0; item < 3; item++) layout.push(tool("layout-chat", `layout-tool-${index}-${item}`));
  }
  const chats = [
    { id: "tools-chat", kind: "dm", title: "工具显示回归", bot_ids: ["layout-a"], created_at: epoch, has_more: true, messages: tools },
    { id: "layout-chat", kind: "dm", title: "宽度布局回归", bot_ids: ["layout-a"], created_at: epoch - 1, has_more: false, messages: layout },
  ];
  const emit = (event) => { for (const listener of listeners) listener(structuredClone(event)); };
  const add = (entry) => { tools.push(entry); emit({ event: "message.added", data: { chat_id: "tools-chat", message: entry } }); };
  window.__layoutToolsUiTest = {
    requests,
    update(id, changes) {
      const index = tools.findIndex((entry) => entry.id === id);
      tools[index] = { ...tools[index], body: { ...tools[index].body, ...changes } };
      chats[0].messages = tools;
      emit({ event: "message.updated", data: { chat_id: "tools-chat", message: tools[index] } });
    },
    startLiveGroup() {
      add(tool("tools-chat", "live-one"));
      add(tool("tools-chat", "live-two", { running: true, summary: "Synthetic live fetch", detail: "Synthetic live output" }));
    },
    appendLiveGroup() { add(tool("tools-chat", "live-three")); },
    appendObservedBoundaries() {
      for (const suffix of ["one", "two"]) {
        const turn = { chat_id: "tools-chat", bot_id: "layout-a", job_id: `synthetic-observed-${suffix}` };
        emit({ event: "job.started", data: turn });
        add(tool("tools-chat", `observed-${suffix}`));
        emit({ event: "job.finished", data: turn });
      }
    },
  };
  window.lorca = {
    getStatus: async () => ({ status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token", detail: "Synthetic layout and tool fixtures" }),
    connect: async () => { throw new Error("Synthetic layout fixtures never connect to services"); },
    request: async (method, params) => {
      requests.push({ method, params: structuredClone(params) });
      if (method === "bootstrap") return { version: "synthetic-layout-tools", identity_id: "synthetic-layout-identity", has_identity: true, relay_connected: false, devices: [{ id: "fixture-runner", name: "Synthetic layout Runner", status: "online" }], bots: [{ id: "layout-a", name: "合成布局助手", runner_id: "fixture-runner" }, { id: "layout-b", name: "合成核对助手", runner_id: "fixture-runner" }], chats: structuredClone(chats), running_turns: [], running_chat_ids: [] };
      if (method === "chats.messages" && params.chat_id === "tools-chat" && params.before === "normal-1") return { messages: [tool("tools-chat", "older-one"), tool("tools-chat", "older-two")].map((entry, index) => ({ ...entry, created_at: epoch - 2 + index })), has_more: false };
      throw new Error(`Unexpected synthetic layout request: ${method}`);
    },
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    onStatus: () => () => {},
  };
}
