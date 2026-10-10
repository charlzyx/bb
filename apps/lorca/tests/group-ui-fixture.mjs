export function installGroupFixture({ theme = "light" } = {}) {
  localStorage.setItem("bb-lorca.appearance", theme);
  let identity = "synthetic-group-account-one";
  let blockStorage = false;
  const requests = [];
  const events = new Set();
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (blockStorage && key.startsWith("dots.agent-groups.v1:")) throw new Error("Synthetic local storage is unavailable");
    return originalSetItem.call(this, key, value);
  };
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  context.fillStyle = "#8d7789";
  context.fillRect(0, 0, 32, 32);
  context.fillStyle = "#eee9df";
  context.fillRect(9, 8, 14, 16);
  context.fillStyle = "#51434f";
  context.fillRect(12, 13, 3, 3);
  context.fillRect(18, 13, 3, 3);
  const avatar = canvas.toDataURL("image/png");
  const epoch = Math.floor(Date.now() / 1000);
  const bots = [
    { id: "group-writer", name: "合成写作助手", runner_id: "group-runner", has_avatar: true, avatar_version: "synthetic-group-avatar", symbol_name: "star", accent: "pink" },
    { id: "group-code", name: "合成代码助手", runner_id: "group-runner", symbol_name: "terminal", accent: "green" },
    { id: "group-review", name: "合成核对助手", runner_id: "group-runner", symbol_name: "globe", accent: "indigo" },
    { id: "group-free", name: "合成备用助手", runner_id: "group-runner", symbol_name: "folder", accent: "purple" },
  ];
  const chats = [{ id: "group-existing-dm", kind: "dm", title: "合成分组 · 已有私聊", bot_ids: ["group-writer"], created_at: epoch, has_more: false, messages: [{ id: "group-notice", chat_id: "group-existing-dm", author: { kind: "bot", bot_id: "group-writer" }, body: { kind: "text", text: "本页仅使用合成智能体、头像和聊天。分组与主力标记保存为本地分类偏好，不创建团队、不调度智能体，也不访问真实服务。" }, state: { kind: "complete" }, created_at: epoch }] }];
  chats.push(...[
    { id: "group-writer", title: "合成讨论群聊", bot_ids: ["group-writer", "group-review"] },
    { id: "group-room", title: "合成备用群聊", bot_ids: ["group-code", "group-free"] },
  ].map((chat, index) => ({ ...chat, kind: "group", created_at: epoch - index - 1, has_more: false, messages: [{ id: `${chat.id}-intro`, chat_id: chat.id, author: { kind: "bot", bot_id: chat.bot_ids[0] }, body: { kind: "text", text: "这是已有合成群聊。分类菜单不会改动群成员，不会设置群聊为主力，也不创建新聊天。" }, state: { kind: "complete" }, created_at: epoch - index - 1 }] })));
  window.__groupUiTest = {
    requests,
    avatar,
    blockStorage(value) { blockStorage = value; },
    changeIdentity(value) {
      identity = value;
      for (const listener of events) listener({ event: "identity.changed", data: { has_identity: true } });
    },
    stored: () => Object.fromEntries(Object.keys(localStorage).filter((key) => key.startsWith("dots.agent-groups.v1:")).map((key) => [key, JSON.parse(localStorage.getItem(key))])),
  };
  window.lorca = {
    getStatus: async () => ({ status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token", detail: "仅用于合成分组交互测试" }),
    connect: async () => { throw new Error("Synthetic group fixtures cannot connect to services"); },
    request: async (method, params) => {
      requests.push({ method, params: structuredClone(params) });
      if (method === "bootstrap") return { version: "synthetic-agent-groups", identity_id: identity, has_identity: true, relay_connected: false, devices: [{ id: "group-runner", name: "合成分组 Runner", status: "online" }], bots: structuredClone(bots), chats: structuredClone(chats), running_turns: [], running_chat_ids: [] };
      throw new Error(`Unexpected synthetic grouping request: ${method}`);
    },
    getBotAvatar: async (botId, version) => botId === "group-writer" && version === "synthetic-group-avatar" ? avatar : null,
    onEvent: (listener) => { events.add(listener); return () => events.delete(listener); },
    onStatus: () => () => {},
  };
}
