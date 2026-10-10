import type { AgentDetailsSnapshot, AgentInspectorAction, AgentInspectorResult, AgentMemorySummary, AgentCapabilitiesSnapshot, AgentCapabilitiesAction, AgentCapabilitiesResult, ToolCapability } from "../ui/inspector/types";

export interface AgentInspectorBridge {
  onEvent?(callback: (event: unknown) => void): () => void;
  getAgentDetails?(params: { botId?: string }): Promise<unknown>;
  getAgentMemorySummary?(params: { revision: string }): Promise<unknown>;
  agentDetailsAction?(action: unknown): Promise<unknown>;
  openAgentMemory?(params: { revision: string }): Promise<unknown>;
  closeAgentDetails?(): Promise<unknown>;
  getAgentCapabilities?(params: { botId: string }): Promise<unknown>;
  agentCapabilitiesAction?(action: AgentCapabilitiesAction): Promise<unknown>;
}
export interface AgentInspectorState { details?: AgentDetailsSnapshot; memory?: AgentMemorySummary; capabilities?: AgentCapabilitiesSnapshot; capabilitiesError?: string; capabilitiesLoading?: boolean; loading: boolean; applying: boolean; error: string | null }
const invalid = (): never => { throw new Error("智能体详情响应不兼容，请刷新后重试。"); };
const object = (v: unknown): Record<string, unknown> => !v || typeof v !== "object" || Array.isArray(v) ? invalid() : v as Record<string, unknown>;
const text = (v: unknown, limit = 256): string => typeof v !== "string" || v.length > limit || v.includes("\0") ? invalid() : v;
const identifier = (value: unknown): string => { const result = text(value); return !result.trim() || result !== result.trim() || /[\r\n]/.test(result) ? invalid() : result; };
const nullable = (v: unknown, limit = 256): string | null => v === null ? null : text(v, limit);
const flag = (v: unknown): boolean => typeof v !== "boolean" ? invalid() : v;
const list = (v: unknown, limit = 1024): unknown[] => !Array.isArray(v) || v.length > limit ? invalid() : v;
const count = (v: unknown): number | null => v === null ? null : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000 ? v : invalid();
export function parseAgentDetails(value: unknown): AgentDetailsSnapshot {
  const v = object(value), bot = v.bot === null ? null : object(v.bot);
  const revision = text(v.revision), version = text(v.version);
  if (!revision || !version) invalid();
  return { revision, version, bot: bot === null ? null : { id: text(bot.id), name: text(bot.name), description: text(bot.description, 20_000), symbolName: text(bot.symbolName), accent: text(bot.accent), provider: nullable(bot.provider), model: nullable(bot.model), thinking: nullable(bot.thinking), runnerId: text(bot.runnerId), hasAvatar: flag(bot.hasAvatar), avatarVersion: nullable(bot.avatarVersion) },
    runners: list(v.runners, 128).map(value => { const r = object(value); if (!["macos", "linux", "windows"].includes(String(r.os))) invalid(); return { id: text(r.id), name: text(r.name), os: text(r.os), online: flag(r.online) }; }),
    providers: list(v.providers, 128).map(value => { const p = object(value); return { id: text(p.id), name: text(p.name), connected: flag(p.connected) }; }),
    models: list(v.models, 1000).map(value => { const m = object(value); return { provider: text(m.provider), id: text(m.id), name: text(m.name), levels: list(m.levels, 32).map(value => text(value)) }; }),
    canCreate: flag(v.canCreate), canEditAvatar: flag(v.canEditAvatar) };
}
export function parseAgentMemorySummary(value: unknown): AgentMemorySummary {
  const v = object(value);
  if (v.status !== "ready" && v.status !== "unavailable") invalid();
  return { status: v.status as AgentMemorySummary["status"], lines: count(v.lines), bytes: count(v.bytes), maxLines: count(v.maxLines), maxBytes: count(v.maxBytes), topicCount: count(v.topicCount), logCount: count(v.logCount), canEdit: flag(v.canEdit) };
}
export function parseAgentInspectorResult(value: unknown): AgentInspectorResult {
  const v = object(value);
  if (!["applied", "cancelled", "unknownOutcome"].includes(String(v.status))) invalid();
  return { status: v.status as AgentInspectorResult["status"], botId: identifier(v.botId), ...(v.chatId === undefined ? {} : { chatId: identifier(v.chatId) }) };
}
const capability = (v: unknown): ToolCapability => ["read", "draft", "write"].includes(String(v)) ? v as ToolCapability : invalid();
const stamp = (v: unknown): number | null => v === null ? null : typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : invalid();
export function parseAgentCapabilities(value: unknown): AgentCapabilitiesSnapshot {
  const v = object(value), permissions = object(v.permissions), capabilities = object(v.capabilities);
  if (!["none", "read", "write"].includes(String(permissions.filesystem))) invalid();
  return { revision: text(v.revision), version: text(v.version), botId: text(v.botId), botName: text(v.botName), runnerId: text(v.runnerId),
    permissions: { allConnections: flag(permissions.allConnections), filesystem: permissions.filesystem as "none" | "read" | "write", shell: flag(permissions.shell), drafts: flag(permissions.drafts) },
    capabilities: { canCreateRoutine: flag(capabilities.canCreateRoutine), canEditPlugins: flag(capabilities.canEditPlugins) },
    routines: list(v.routines, 1000).map(value => {
      const r = object(value);
      if (!["coalesce", "skip"].includes(String(r.missedRunPolicy)) || !["running", "blocked", "paused", "waiting_for_runner", "failed", "on"].includes(String(r.state)) || !["schedule", "pull_request", "calendar"].includes(String(r.triggerKind)) || ![null, "sent", "pass", "error"].includes(r.lastOutcome as string | null)) invalid();
      return { id: text(r.id), botId: text(r.botId), name: text(r.name), prompt: text(r.prompt, 100_000), schedule: text(r.schedule, 1000), timezone: text(r.timezone), missedRunPolicy: r.missedRunPolicy as "coalesce" | "skip", enabled: flag(r.enabled), scheduleText: text(r.scheduleText, 1000), running: flag(r.running), state: r.state as AgentCapabilitiesSnapshot["routines"][number]["state"], nextRunAt: stamp(r.nextRunAt), lastRunAt: stamp(r.lastRunAt), lastOutcome: r.lastOutcome as "sent" | "pass" | "error" | null, pausedReason: nullable(r.pausedReason), hasCheck: flag(r.hasCheck), triggerKind: r.triggerKind as "schedule" | "pull_request" | "calendar", editable: flag(r.editable) };
    }),
    plugins: list(v.plugins, 512).map(value => { const p = object(value); return { id: text(p.id), name: text(p.name), tools: list(p.tools, 4096).map(value => { const t = object(value); return { name: text(t.name), title: nullable(t.title, 1000), capability: capability(t.capability) }; }), capabilities: list(p.capabilities, 3).map(capability), allowedTools: p.allowedTools === null ? null : list(p.allowedTools, 4096).map(value => text(value)) }; }),
  };
}
const empty = (): AgentInspectorState => ({ loading: false, applying: false, error: null });
const unavailableMemory = (): AgentMemorySummary => ({ status: "unavailable", lines: null, bytes: null, maxLines: null, maxBytes: null, topicCount: null, logCount: null, canEdit: false });
export class AgentInspectorSession {
  private state = empty();
  private listeners = new Set<() => void>();
  private generation = 0;
  private scope: string | undefined;
  private botId: string | null = null;
  private open = false;
  private disposed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private stopEvents?: () => void;
  private eventTimer?: ReturnType<typeof setTimeout>;
  constructor(private bridge: AgentInspectorBridge) {
    this.stopEvents = bridge.onEvent?.(event => {
      if (!this.open || !this.scope || this.disposed || this.state.applying || !event || typeof event !== "object") return;
      const v = event as { event?: unknown; data?: { bot_id?: unknown } };
      if (v.event !== "roster.changed" && !(["job.started", "job.finished"].includes(String(v.event)) && v.data?.bot_id === this.botId)) return;
      clearTimeout(this.eventTimer);
      this.eventTimer = setTimeout(() => { this.eventTimer = undefined; if (this.open && this.scope && !this.state.applying && !this.disposed) void this.refresh(); }, 200);
    });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(next: AgentInspectorState) { this.state = next; for (const listener of this.listeners) listener(); }
  private current(generation: number) { return !this.disposed && this.open && Boolean(this.scope) && generation === this.generation; }
  private queued<T>(work: () => Promise<T>): Promise<T> { const next = this.tail.then(work, work); this.tail = next.catch(() => undefined); return next; }
  select(scope: string | undefined, botId: string | null, open: boolean) {
    if (this.scope === scope && this.botId === botId && this.open === open) return;
    clearTimeout(this.eventTimer); this.eventTimer = undefined;
    ++this.generation; this.scope = scope; this.botId = botId; this.open = open;
    void this.bridge.closeAgentDetails?.().catch(() => undefined);
    this.emit(empty());
    if (open && scope) void this.refresh();
  }
  async refresh() {
    const generation = ++this.generation, botId = this.botId;
    if (!this.current(generation)) return;
    this.emit({ ...this.state, loading: true, error: null });
    return this.queued(async () => {
      if (!this.current(generation)) return;
      try {
        if (!this.bridge.getAgentDetails) throw new Error();
        const details = parseAgentDetails(await this.bridge.getAgentDetails(botId === null ? {} : { botId }));
        if (!this.current(generation)) return;
        if ((details.bot?.id ?? null) !== botId) invalid();
        this.emit({ details, loading: false, applying: false, error: null });
        if (details.bot && this.bridge.getAgentCapabilities) {
          this.emit({ ...this.state, capabilitiesLoading: true });
          try {
            const capabilities = parseAgentCapabilities(await this.bridge.getAgentCapabilities({ botId: details.bot.id }));
            if (capabilities.botId !== details.bot.id) invalid();
            if (this.current(generation)) this.emit({ ...this.state, capabilities, capabilitiesLoading: false });
          } catch { if (this.current(generation)) this.emit({ ...this.state, capabilitiesLoading: false, capabilitiesError: "无法读取例行任务与插件权限，请刷新后重试。" }); }
          if (!this.current(generation)) return;
        }
        if (details.bot && this.bridge.getAgentMemorySummary) {
          let memory: AgentMemorySummary;
          try { memory = parseAgentMemorySummary(await this.bridge.getAgentMemorySummary({ revision: details.revision })); }
          catch { memory = unavailableMemory(); }
          if (this.current(generation)) this.emit({ ...this.state, memory });
        }
      } catch {
        if (this.current(generation)) this.emit({ ...empty(), error: "无法读取智能体详情，请检查连接后刷新。" });
      }
    });
  }
  private async mutate(operation: (revision: string) => Promise<unknown>): Promise<AgentInspectorResult> {
    const generation = this.generation, revision = this.state.details?.revision;
    if (!this.current(generation) || !revision || this.state.loading || this.state.applying || this.state.error) throw new Error("请先刷新智能体详情再继续。");
    this.emit({ ...this.state, applying: true, error: null });
    let result: AgentInspectorResult;
    try {
      result = await this.queued(async () => {
        if (!this.current(generation)) throw new Error();
        return parseAgentInspectorResult(await operation(revision));
      });
      if (!this.current(generation) || (this.botId !== null && result.botId !== this.botId) || (this.botId === null && result.status === "applied" && !result.chatId)) throw new Error();
      this.emit({ ...this.state, applying: false, error: result.status === "unknownOutcome" ? "无法确认变更结果。请刷新核对，避免重复提交。" : null });
      if (result.status !== "unknownOutcome") await this.refresh();
      return result;
    } catch {
      if (this.current(generation)) this.emit({ ...this.state, applying: false, error: "操作未能确认，请刷新核对后再继续；不会自动重发。" });
      throw new Error("智能体操作未能确认，请刷新核对。");
    }
  }
  apply = (action: AgentInspectorAction) => {
    if (action.revision !== this.state.details?.revision || !this.bridge.agentDetailsAction) return Promise.reject(new Error("编辑已过期，请刷新后重试。"));
    return this.mutate(() => this.bridge.agentDetailsAction!(action));
  };
  openMemory = () => this.mutate(revision => this.bridge.openAgentMemory ? this.bridge.openAgentMemory({ revision }) : Promise.reject(new Error()));
  editAvatar = () => this.mutate(revision => this.bridge.agentDetailsAction ? this.bridge.agentDetailsAction({ kind: "avatar.replace", revision }) : Promise.reject(new Error()));
  applyCapabilities = async (action: AgentCapabilitiesAction): Promise<AgentCapabilitiesResult> => {
    const generation = this.generation;
    if (!this.current(generation) || action.revision !== this.state.capabilities?.revision || !this.bridge.agentCapabilitiesAction || this.state.loading || this.state.applying || this.state.error) throw new Error("请刷新例行任务与插件后再继续。");
    this.emit({ ...this.state, applying: true, error: null });
    try {
      const raw = await this.queued(async () => { if (!this.current(generation)) throw new Error(); return object(await this.bridge.agentCapabilitiesAction!(action)); });
      const result: AgentCapabilitiesResult = { ...parseAgentInspectorResult(raw), ...(raw.routineId === undefined ? {} : { routineId: text(raw.routineId) }), ...(raw.requested === undefined ? {} : { requested: flag(raw.requested) }) };
      if (!this.current(generation) || result.botId !== this.botId) throw new Error();
      this.emit({ ...this.state, applying: false, error: result.status === "unknownOutcome" ? "无法确认变更结果。请刷新核对，避免重复提交。" : null });
      if (result.status !== "unknownOutcome") await this.refresh();
      return result;
    } catch {
      if (this.current(generation)) this.emit({ ...this.state, applying: false, error: "例行任务或插件操作未能确认，请刷新核对；不会自动重发。" });
      throw new Error("操作未能确认，请刷新核对。");
    }
  };
  removeAvatar = () => this.mutate(revision => this.bridge.agentDetailsAction ? this.bridge.agentDetailsAction({ kind: "avatar.remove", revision }) : Promise.reject(new Error()));
  dispose() { clearTimeout(this.eventTimer); this.stopEvents?.(); this.disposed = true; ++this.generation; this.listeners.clear(); void this.bridge.closeAgentDetails?.().catch(() => undefined); }
}
