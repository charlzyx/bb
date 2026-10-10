export function installInspectorFixture({ theme = "light" } = {}) {
  localStorage.setItem("bb-lorca.appearance", theme);
  const calls = [], events = new Set(), statuses = new Set(), profileTickets = new Map(), capabilityTickets = new Map();
  let endpoint = "ws://127.0.0.1:4862/ws";
  let identity = "synthetic-inspector-account-one", generation = 1, connected = true, sequence = 0, nextOutcome = null, capabilitiesFail = false;
  let profiles, routines, grants, versions, chats, pendingBootstrap = null, holdNextBootstrap = false;
  const copy = value => structuredClone(value);
  const devices = [{ id: "runner-mac", name: "合成 Mac Runner", os: "macos", status: "online" }, { id: "runner-linux", name: "合成 Linux Runner", os: "linux", status: "offline" }, { id: "phone-only", name: "合成手机设备", os: "ios", status: "online" }];
  const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
  const context = canvas.getContext("2d"); context.fillStyle = "#76888b"; context.fillRect(0, 0, 32, 32); context.fillStyle = "#f4eee4"; context.fillRect(8, 8, 16, 16);
  const avatar = canvas.toDataURL("image/png");
  const avatarVariants = new Map([["synthetic-inspector-avatar", avatar]]);
  const initialRoutine = (botId, index) => ({ id: `${botId}-routine-${index}`, botId, name: `合成例行任务 ${index + 1}`, prompt: `只处理合成记录 ${index + 1}，不访问真实服务。`, schedule: "0 9 * * 1-5", scheduleText: "工作日 09:00", timezone: "Asia/Shanghai", missedRunPolicy: "coalesce", enabled: true, running: false, state: "on", nextRunAt: 1_900_000_000, lastRunAt: null, lastOutcome: null, pausedReason: null, hasCheck: index === 3, triggerKind: "schedule", editable: index !== 3 });
  function seed() {
    const suffix = identity.endsWith("two") ? " · 账号二" : "";
    profiles = [
      { id: "inspector-alpha", name: `合成研究助手${suffix}`, description: "这是合成的智能体资料，用于验证右侧检查器。", provider: "synthetic-provider", model: "synthetic-one", thinking: "high", runnerId: "runner-mac", symbolName: "sparkles", accent: "teal", hasAvatar: true, avatarVersion: "synthetic-inspector-avatar" },
      { id: "inspector-beta", name: `合成核对助手${suffix}`, description: "另一位合成智能体。", provider: "synthetic-provider", model: "synthetic-two", thinking: "", runnerId: "runner-linux", symbolName: "checkmark", accent: "purple", hasAvatar: false, avatarVersion: null },
    ];
    versions = Object.fromEntries(profiles.map(profile => [profile.id, { profile: 1, capabilities: 1 }]));
    routines = Object.fromEntries(profiles.map(profile => [profile.id, Array.from({ length: 4 }, (_, index) => initialRoutine(profile.id, index))]));
    grants = Object.fromEntries(profiles.map(profile => [profile.id, { capabilities: ["read"], allowedTools: ["lookup"] }]));
    const stamp = Math.floor(Date.now() / 1000);
    chats = [{ id: "inspector-dm", kind: "dm", title: "合成检查器私聊", bot_ids: ["inspector-alpha"] }, { id: "inspector-group", kind: "group", title: "合成检查器群聊", bot_ids: ["inspector-alpha", "inspector-beta"] }].map((chat, i) => ({ ...chat, created_at: stamp - i, has_more: false, messages: Array.from({ length: 24 }, (_, n) => ({ id: `${chat.id}-message-${n}`, chat_id: chat.id, author: { kind: "bot", bot_id: chat.bot_ids[n % chat.bot_ids.length] }, body: { kind: "text", text: `合成阅读段落 ${n + 1}\n\n${"只用于验证独立滚动与资料操作，内容不来自真实聊天。".repeat(8)}` }, state: { kind: "complete" }, created_at: stamp - i })) }));
  }
  seed();
  const status = () => ({ status: connected ? "connected" : "disconnected", endpoint, authMode: "token", generation, detail: "合成检查器测试" });
  const current = () => { if (!connected) throw new Error("Synthetic fixture is disconnected"); };
  const record = (method, params = {}) => { current(); calls.push({ method, params: copy(params) }); };
  const ticket = (map, botId) => { const value = `synthetic-ticket-${++sequence}`; map.clear(); map.set(value, { botId, identity, generation }); return value; };
  const consume = (map, revision) => { const value = map.get(revision); if (!value || value.identity !== identity || value.generation !== generation) throw new Error("Synthetic stale ticket"); map.delete(revision); return value.botId; };
  const outcome = (fallback = "applied") => { const value = nextOutcome ?? { status: fallback, persist: fallback === "applied" }; nextOutcome = null; return value; };
  const bootstrap = () => ({ version: "synthetic-inspector", has_identity: true, identity_id: identity, relay_connected: false, devices: copy(devices), bots: profiles.map(profile => ({ id: profile.id, name: profile.name, runner_id: profile.runnerId, has_avatar: profile.hasAvatar, avatar_version: profile.avatarVersion, symbol_name: profile.symbolName, accent: profile.accent })), chats: copy(chats), running_turns: [], running_chat_ids: [] });
  window.__inspectorUiTest = {
    calls, avatar,
    holdNextBootstrap() { if (holdNextBootstrap || pendingBootstrap) throw new Error("Synthetic bootstrap gate is already armed"); holdNextBootstrap = true; },
    isBootstrapHeld: () => pendingBootstrap !== null,
    releaseBootstrap() { if (!pendingBootstrap) throw new Error("No synthetic bootstrap is waiting"); const release = pendingBootstrap; pendingBootstrap = null; release(); },
    setNextOutcome(status, persist = status === "applied") { if (!["applied", "cancelled", "unknownOutcome"].includes(status)) throw new Error("Invalid synthetic outcome"); nextOutcome = { status, persist }; },
    setCapabilitiesFailure(value) { capabilitiesFail = value; },
    changeProfile(botId, patch) { Object.assign(profiles.find(profile => profile.id === botId), patch); versions[botId].profile++; },
    changeIdentity(value) { identity = value; profileTickets.clear(); capabilityTickets.clear(); seed(); for (const listener of events) listener({ event: "identity.changed", data: { has_identity: true } }); },
    changeEndpoint() { endpoint = "ws://127.0.0.1:4863/ws"; generation++; profileTickets.clear(); capabilityTickets.clear(); for (const listener of statuses) listener(status()); },
    setConnected(value) { connected = value; if (value) generation++; profileTickets.clear(); capabilityTickets.clear(); for (const listener of statuses) listener(status()); },
    profile: botId => copy(profiles.find(profile => profile.id === botId)),
  };
  window.lorca = {
    getStatus: async () => status(),
    connect: async () => { throw new Error("Synthetic inspector cannot connect to a service"); },
    request: async (method, params) => { record(method, params); if (method !== "bootstrap") throw new Error(`Unexpected synthetic wire method: ${method}`); if (holdNextBootstrap) { holdNextBootstrap = false; await new Promise(resolve => { pendingBootstrap = resolve; }); current(); } return bootstrap(); },
    onEvent: listener => { events.add(listener); return () => events.delete(listener); },
    onStatus: listener => { statuses.add(listener); return () => statuses.delete(listener); },
    getBotAvatar: async (id, version) => profiles.some(profile => profile.id === id && profile.hasAvatar && profile.avatarVersion === version) ? avatarVariants.get(version) ?? null : null,
    closeAgentDetails: async () => { calls.push({ method: "closeAgentDetails", params: {} }); profileTickets.clear(); capabilityTickets.clear(); },
    getAgentDetails: async (params = {}) => {
      record("getAgentDetails", params); const bot = params.botId ? profiles.find(profile => profile.id === params.botId) : null;
      if (params.botId && !bot) throw new Error("Unknown synthetic bot");
      return { revision: ticket(profileTickets, bot?.id ?? null), version: bot ? `${identity}:${bot.id}:profile-${versions[bot.id].profile}` : `${identity}:create`, bot: copy(bot),
        runners: devices.filter(device => ["macos", "linux", "windows"].includes(device.os)).map(device => ({ id: device.id, name: device.name, os: device.os, online: device.status === "online" })),
        providers: [{ id: "synthetic-provider", name: "合成服务商", connected: true }], models: [{ provider: "synthetic-provider", id: "synthetic-one", name: "合成模型一", levels: ["high", "low"] }, { provider: "synthetic-provider", id: "synthetic-two", name: "合成模型二", levels: [] }], canCreate: bot === null, canEditAvatar: bot !== null };
    },
    getAgentMemorySummary: async params => { record("getAgentMemorySummary", params); if (!profileTickets.has(params.revision)) throw new Error("Stale memory summary"); return { status: "ready", lines: 12, bytes: 1024, maxLines: 200, maxBytes: 24_000, topicCount: 3, logCount: 2, canEdit: true }; },
    openAgentMemory: async params => { record("openAgentMemory", params); const botId = consume(profileTickets, params.revision); return { status: "cancelled", botId }; },
    agentDetailsAction: async action => {
      record("agentDetailsAction", action); const botId = consume(profileTickets, action.revision), result = outcome(action.kind.startsWith("avatar.") ? "cancelled" : "applied");
      if (action.kind === "agent.create") {
        if (botId !== null || !devices.some(device => device.id === action.profile.runnerId && ["macos", "linux", "windows"].includes(device.os))) throw new Error("Invalid synthetic Runner");
        const created = "inspector-created", chatId = "inspector-created-dm";
        if (result.persist) { profiles.push({ id: created, ...copy(action.profile), symbolName: "sparkles", accent: "indigo", hasAvatar: false, avatarVersion: null }); versions[created] = { profile: 1, capabilities: 1 }; routines[created] = []; grants[created] = { capabilities: [], allowedTools: [] }; chats.push({ id: chatId, title: action.profile.name, kind: "dm", bot_ids: [created], messages: [], has_more: false, created_at: Date.now() / 1000 }); }
        return { status: result.status, botId: created, ...(result.status === "applied" ? { chatId } : {}) };
      }
      if (!botId) throw new Error("No synthetic selected bot");
      if (action.kind === "profile.save" && result.persist) { Object.assign(profiles.find(profile => profile.id === botId), copy(action.patch)); versions[botId].profile++; }
      if (action.kind.startsWith("avatar.") && result.persist) {
        const selected = profiles.find(profile => profile.id === botId); versions[botId].profile++;
        if (action.kind === "avatar.replace") {
          const version = `synthetic-inspector-avatar-${versions[botId].profile}`;
          context.fillStyle = "#b09372"; context.fillRect(0, 0, 32, 32); context.fillStyle = "#f4eee4"; context.fillRect(4, 4, 12, 12);
          avatarVariants.set(version, canvas.toDataURL("image/png")); Object.assign(selected, { hasAvatar: true, avatarVersion: version });
        } else Object.assign(selected, { hasAvatar: false, avatarVersion: null });
      }
      if (!["profile.save", "avatar.replace", "avatar.remove"].includes(action.kind)) throw new Error("Unexpected synthetic profile action");
      return { status: result.status, botId };
    },
    getAgentCapabilities: async params => {
      record("getAgentCapabilities", params); if (capabilitiesFail) throw new Error("Synthetic capabilities unavailable");
      const bot = profiles.find(profile => profile.id === params.botId); if (!bot) throw new Error("Unknown synthetic bot");
      return { revision: ticket(capabilityTickets, bot.id), version: `${identity}:${bot.id}:capabilities-${versions[bot.id].capabilities}`, botId: bot.id, botName: bot.name, runnerId: bot.runnerId, routines: copy(routines[bot.id]),
        plugins: [{ id: "synthetic-mail", name: "合成邮件插件", tools: [{ name: "lookup", title: "查询合成记录", capability: "read" }, { name: "compose", title: "准备合成草稿", capability: "draft" }, { name: "send", title: "提交合成操作", capability: "write" }], ...copy(grants[bot.id]) }],
        permissions: { allConnections: false, filesystem: "read", shell: false, drafts: true }, capabilities: { canCreateRoutine: routines[bot.id].length < 20, canEditPlugins: true } };
    },
    agentCapabilitiesAction: async action => {
      record("agentCapabilitiesAction", action); const botId = consume(capabilityTickets, action.revision), result = outcome(); let routineId = action.routineId;
      if (!botId) throw new Error("No synthetic capabilities bot");
      if (result.persist) {
        if (action.kind === "routine.create") { routineId = `${botId}-created-routine-${sequence}`; routines[botId].push({ ...initialRoutine(botId, 0), ...copy(action.draft), id: routineId, scheduleText: action.draft.schedule, state: action.draft.enabled ? "on" : "paused" }); }
        else if (action.kind === "plugin.setAccess") grants[botId] = { capabilities: copy(action.capabilities), allowedTools: copy(action.tools) };
        else {
          const selected = routines[botId].find(item => item.id === routineId); if (!selected) throw new Error("Unknown synthetic routine");
          if (action.kind === "routine.edit") Object.assign(selected, copy(action.patch), action.patch.schedule ? { scheduleText: action.patch.schedule } : {});
          else if (action.kind === "routine.setEnabled") Object.assign(selected, { enabled: action.enabled, state: action.enabled ? "on" : "paused" });
          else if (action.kind === "routine.run") Object.assign(selected, { running: true, state: "running" });
          else if (action.kind === "routine.delete") routines[botId] = routines[botId].filter(item => item.id !== routineId);
          else throw new Error("Unexpected synthetic capability action");
        }
        versions[botId].capabilities++;
      }
      return { status: result.status, botId, ...(routineId ? { routineId } : {}), ...(action.kind === "routine.run" && result.status === "applied" ? { requested: true } : {}) };
    },
  };
}
