export function installSettingsFixture() {
  let revision = 0;
  const requests = [];
  const pending = [];
  const readbacks = [];
  const eventListeners = new Set();
  const statusListeners = new Set();
  let holdReadback = false;
  let identity = "synthetic-identity";
  let hasIdentity = true;
  let generation = 1;
  const emitStatus = (status) => {
    for (const listener of statusListeners) listener({ status, endpoint: "ws://127.0.0.1:4862/ws", generation, authMode: "token" });
  };
  const snapshot = {
    version: "synthetic-settings-fixture",
    hasIdentity: true,
    relayConnected: false,
    updateRequired: false,
    authMode: "token",
    devices: [
      { id: "runner-one", name: "Synthetic desktop", os: "macos", version: "fixture", online: true, isThisDevice: true, plugins: [] },
      { id: "runner-two", name: "Synthetic workstation", os: "linux", version: "fixture", online: true, isThisDevice: false, plugins: [] },
    ],
    providers: [{ id: "provider-one", name: "Synthetic Provider One", connected: true }, { id: "provider-two", name: "Synthetic Provider Two", connected: true }],
    bots: [{ id: "bot-one", name: "Synthetic Bot", runnerId: "runner-one", provider: "provider-one", model: "model-one" }],
    mcp: { status: "ready", runnerId: "runner-one", hasConfigError: false, servers: [{ name: "Synthetic MCP", transport: "stdio", enabled: true, state: "ready", toolCount: 1, hiddenToolCount: null, hasError: false }] },
    editor: {
      revision: "fixture-0",
      models: [{ provider: "provider-one", id: "model-one", name: "Model One", levels: ["low", "high"] }, { provider: "provider-two", id: "model-two", name: "Model Two", levels: ["low"] }],
      bots: [{ id: "bot-one", thinking: "high" }],
      providers: [{ id: "provider-one", canConfigure: true, canDisconnect: true }, { id: "provider-two", canConfigure: true, canDisconnect: true }],
      canUpdateBots: true,
      canAddProvider: true,
      canManageMcp: true,
      autoReview: { status: "ready", isEnabled: false, rules: [{ id: "existing-rule", text: "Ask before external messages", behavior: "ask", tool: "messages/send" }] },
    },
  };
  const apply = (action) => {
    if (action.kind === "bot.update") {
      const bot = snapshot.bots.find((item) => item.id === action.botId);
      for (const key of ["provider", "model", "runnerId"]) if (key in action) bot[key] = action[key] || null;
      if ("thinking" in action) snapshot.editor.bots[0].thinking = action.thinking || null;
    }
    if (action.kind === "autoReview.set") snapshot.editor.autoReview = { status: "ready", isEnabled: action.isEnabled, rules: action.rules.map((rule, index) => ({ ...rule, id: rule.id || `new-rule-${index}`, tool: rule.tool ?? null })) };
    if (action.kind === "mcp.setEnabled") snapshot.mcp.servers[0].enabled = action.enabled;
    if (action.kind === "mcp.remove") snapshot.mcp.servers = [];
  };
  window.__settingsUiTest = {
    requests,
    pending,
    readbacks,
    holdReadback() { holdReadback = true; },
    releaseReadback() { holdReadback = false; for (const resolve of readbacks.splice(0)) resolve(); },
    disconnect() { emitStatus("disconnected"); },
    reconnect() { generation++; emitStatus("connecting"); emitStatus("connected"); },
    changeIdentity(nextIdentity = "synthetic-identity-two") {
      identity = nextIdentity;
      hasIdentity = nextIdentity !== null;
      snapshot.hasIdentity = hasIdentity;
      for (const listener of eventListeners) listener({ event: "identity.changed", data: { has_identity: hasIdentity } });
    },
    resolve(status = "applied") {
      const item = pending.shift();
      if (status === "applied") apply(item.action);
      item.resolve({ status });
    },
    reject() { pending.shift().reject(new Error("合成测试：保存失败")); },
    snapshot,
  };
  window.lorca = {
    getStatus: async () => ({ status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token", detail: "仅用于合成设置交互测试" }),
    connect: async () => { throw new Error("Synthetic fixtures cannot connect to services"); },
    request: async (method) => {
      if (method === "bootstrap") return { version: "synthetic-settings-fixture", identity_id: identity, has_identity: hasIdentity, relay_connected: false, bots: [{ id: "bot-one", name: "Synthetic Bot", runner_id: "runner-one" }], chats: [], running_turns: [], running_chat_ids: [] };
      throw new Error(`Unexpected synthetic request: ${method}`);
    },
    getSettings: async (options) => {
      if (holdReadback) await new Promise((resolve) => readbacks.push(resolve));
      snapshot.editor.revision = `fixture-${++revision}`;
      snapshot.mcp.runnerId = options?.runnerId || "runner-one";
      return structuredClone(snapshot);
    },
    settingsAction: async (action) => {
      requests.push(structuredClone(action));
      return new Promise((resolve, reject) => pending.push({ action, resolve, reject }));
    },
    onEvent: (listener) => { eventListeners.add(listener); return () => eventListeners.delete(listener); },
    onStatus: (listener) => { statusListeners.add(listener); return () => statusListeners.delete(listener); },
  };
}
