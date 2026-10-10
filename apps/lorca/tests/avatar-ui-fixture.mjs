export function installAvatarFixture() {
  const drawAvatar = (color) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    context.fillStyle = color;
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = "#ffffff";
    context.fillRect(15, 18, 34, 28);
    context.fillStyle = color;
    context.fillRect(22, 27, 6, 6);
    context.fillRect(36, 27, 6, 6);
    context.fillRect(26, 38, 12, 3);
    return canvas.toDataURL("image/png");
  };
  const images = [drawAvatar("#4263c7"), drawAvatar("#8756b4")];
  let imageIndex = 0;
  let identity = "synthetic-avatar-identity";
  const calls = [];
  const listeners = new Set();
  const epoch = Math.floor(Date.now() / 1000);
  const bots = [
    { id: "avatar-photo", name: "示例图片助手", runner_id: "fixture-runner", symbol_name: "sparkles", accent: "blue", has_avatar: true, avatar_version: "synthetic-photo-1" },
    { id: "avatar-symbol", name: "示例代码助手", runner_id: "fixture-runner", symbol_name: "terminal.fill", accent: "green", has_avatar: false, avatar_version: null },
    { id: "avatar-missing", name: "未缓存图片助手", runner_id: "fixture-runner", symbol_name: "globe", accent: "orange", has_avatar: true, avatar_version: "synthetic-missing" },
  ];
  const message = (chatId, id, author, text) => ({ id, chat_id: chatId, author, body: { kind: "text", text }, state: { kind: "complete" }, created_at: epoch });
  const chats = [
    { id: "avatar-dm", kind: "dm", title: "合成头像 · 单聊", bot_ids: ["avatar-photo"], created_at: epoch, has_more: false, messages: [
      message("avatar-dm", "avatar-you", { kind: "you" }, "检查头像在对话中的呈现。"),
      message("avatar-dm", "avatar-response", { kind: "bot", bot_id: "avatar-photo" }, "这是一段合成头像测试对话，不连接真实服务。\n\n侧栏、会话标题和回复共用机器人图片；你的消息使用用户图标。"),
    ] },
    { id: "avatar-group", kind: "group", title: "合成头像 · 群组", bot_ids: ["avatar-photo", "avatar-symbol"], created_at: epoch - 1, has_more: false, messages: [
      message("avatar-group", "avatar-group-photo", { kind: "bot", bot_id: "avatar-photo" }, "我使用合成图片头像。"),
      message("avatar-group", "avatar-group-symbol", { kind: "bot", bot_id: "avatar-symbol" }, "我没有图片，使用设置中的终端符号与绿色主题。"),
    ] },
    { id: "avatar-fallback", kind: "dm", title: "合成头像 · 缓存缺失", bot_ids: ["avatar-missing"], created_at: epoch - 2, has_more: false, messages: [
      message("avatar-fallback", "avatar-fallback-response", { kind: "bot", bot_id: "avatar-missing" }, "本地没有缓存图片时，保留地球图标，不请求远程头像。"),
    ] },
  ];
  window.__avatarUiTest = {
    calls,
    images,
    replace() {
      imageIndex = 1;
      bots[0].avatar_version = "synthetic-photo-2";
      for (const listener of listeners) listener({ event: "roster.changed", data: { bots: structuredClone(bots), chats: structuredClone(chats) } });
    },
    loseIdentity() {
      identity = null;
      bots[0].has_avatar = false;
      bots[0].avatar_version = null;
      for (const listener of listeners) listener({ event: "identity.changed", data: { has_identity: false } });
    },
  };
  window.lorca = {
    getStatus: async () => ({ status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token", detail: "仅用于合成头像测试" }),
    connect: async () => { throw new Error("Synthetic avatar fixtures cannot connect to services"); },
    request: async (method) => {
      if (method === "bootstrap") return { version: "synthetic-avatar-fixture", identity_id: identity, has_identity: identity !== null, relay_connected: false, bots: structuredClone(bots), chats: structuredClone(chats), running_turns: [], running_chat_ids: [] };
      throw new Error(`Unexpected synthetic request: ${method}`);
    },
    getBotAvatar: async (botId, expectedAvatarVersion) => {
      calls.push(botId);
      const bot = bots.find((candidate) => candidate.id === botId);
      if (!bot || bot.avatar_version !== expectedAvatarVersion) return null;
      return botId === "avatar-photo" ? images[imageIndex] : null;
    },
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    onStatus: () => () => {},
  };
}
