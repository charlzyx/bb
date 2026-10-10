export function installFooterFixture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgb(0, 190, 240)";
  context.fillRect(0, 0, 64, 64);
  const avatar = canvas.toDataURL("image/png");
  const epoch = Math.floor(Date.now() / 1000);
  const bot = { id: "footer-photo", name: "合成滚动助手", runner_id: "footer-runner", has_avatar: true, avatar_version: "synthetic-footer-1" };
  const chats = Array.from({ length: 36 }, (_, index) => ({
    id: `footer-chat-${index}`,
    kind: "dm",
    title: `合成滚动对话 ${String(index + 1).padStart(2, "0")}`,
    bot_ids: [bot.id],
    created_at: epoch - index,
    has_more: false,
    messages: [{ id: `footer-message-${index}`, chat_id: `footer-chat-${index}`, author: { kind: "bot", bot_id: bot.id }, body: { kind: "text", text: "仅用于滚动与键盘测试，不连接真实服务。" }, state: { kind: "complete" }, created_at: epoch - index }],
  }));
  window.lorca = {
    getStatus: async () => ({ status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token", detail: "仅用于合成侧栏测试" }),
    connect: async () => { throw new Error("Synthetic footer fixtures cannot connect to services"); },
    request: async (method) => {
      if (method === "bootstrap") return { version: "synthetic-footer-fixture", identity_id: "synthetic-footer-identity", has_identity: true, relay_connected: false, bots: [bot], chats, running_turns: [], running_chat_ids: [] };
      throw new Error(`Unexpected synthetic footer request: ${method}`);
    },
    getSettings: async () => ({ version: "synthetic-footer-fixture", hasIdentity: true, relayConnected: false, updateRequired: false, authMode: "token", devices: [], providers: [], bots: [], mcp: { status: "unavailable", runnerId: null, hasConfigError: false, servers: [] } }),
    getBotAvatar: async (botId, version) => botId === bot.id && version === bot.avatar_version ? avatar : null,
    onEvent: () => () => {},
    onStatus: () => () => {},
  };
}
