import {
  object,
  parseChat,
  parseEvent,
  parseMessage,
  parsePage,
  parseSnapshot,
  type WireEvent,
  type WireChat,
  type WireMessage,
  type WireSnapshot,
} from "./protocol";
import {
  appendOlder,
  applyEvent,
  applyBufferedEvent,
  applySnapshot,
  emptyModel,
  isRunning,
  upsertMessage,
  type Model,
} from "./store";
import type { AttachmentImportEvent, BridgeStatus, LorcaBridge, PickedAttachment } from "./bridge";
import type {
  LorcaShellState,
  LorcaBotAppearance,
  LorcaConversation,
  LorcaMessage,
  LorcaShellActions,
  RuntimeSettings,
  RunnerSummary,
  SettingsAction,
  SettingsActionResult,
} from "../ui/types";

import { parseRuntimeSettings } from "./settings";

function messageView(message: WireMessage, authorName: string | undefined, authorAvatar: LorcaBotAppearance | undefined, botIds: readonly string[], appearance: (id: string) => LorcaBotAppearance | undefined, observedBoundary: string | null): LorcaMessage {
  const body = message.body;
  switch (body.kind) {
    case "text":
      return {
        kind: "message",
        id: message.id,
        role: message.author.kind === "you" ? "user" : "assistant",
        authorName,
        authorAvatar,
        text: body.text,
        createdAt: new Date(message.created_at * 1000).toISOString(),
        error: message.error ?? undefined,
        streaming:
          message.state === "streaming" || message.state === "thinking",
        attachments: body.attachments.map((a) => ({
          id: a.id,
          name: a.name,
          mimeType: a.mime,
        })),
      };
    case "tool":
      if (body.name === "message_bot" && message.state === "complete" && !message.error && !body.is_running && !body.is_error && body.summary.startsWith("Messaged "))
        return {
          kind: "cross-agent",
          id: message.id,
          direction: "outgoing",
          from: authorAvatar ?? null,
          to: body.target_bot_id ? appearance(body.target_bot_id) ?? null : null,
          text: body.detail,
        };
      if (body.run?.state === "asking" && message.state !== "failed" && !message.error && !body.is_error)
        return {
          kind: "approval",
          id: message.id,
          title: "运行命令",
          detail: [body.run.command, body.run.reason, body.run.rule ? `始终允许规则：${body.run.rule}` : null]
            .filter(Boolean)
            .join("\n\n"),
          status: "pending",
          canAlways: Boolean(body.run.rule),
        };
      return {
        kind: "tool",
        id: message.id,
        authorId: message.author.bot_id,
        observedBoundary,
        name: body.summary || body.name,
        status: message.state === "failed" || Boolean(message.error) || body.is_error || body.run?.state === "failed"
          ? "error"
          : body.is_running || body.run?.state === "waiting" || body.run?.state === "running" || body.run?.state === "checking"
            ? "running"
            : "complete",
        output: [message.error, body.run?.output || body.detail].filter(Boolean).join("\n\n"),
      };
    case "permission":
      return {
        kind: "approval",
        id: message.id,
        title: `${body.plugin_name} · ${body.tool}`,
        detail: [
          body.summary,
          body.reason,
          body.command,
          body.rule ? `始终允许规则：${body.rule}` : null,
          body.tool === "secret"
            ? "此请求需要安全输入凭据，请在 Lorca 客户端中处理；dots 不接收或提交这些秘密值。"
            : body.tool === "access" || body.tool === "connect"
            ? "请在 Lorca 客户端中管理访问权限或登录。"
            : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
        status:
          body.decision === "pending"
            ? "pending"
            : body.decision === "expired"
              ? "expired"
              : body.decision === "denied"
                ? "denied"
                : ["allowed", "always", "connected"].includes(body.decision)
                  ? "approved"
                  : "expired",
        canAllow: !["access", "connect", "secret"].includes(body.tool),
        canAlways:
          body.tool !== "access" &&
          body.tool !== "connect" &&
          body.tool !== "secret" &&
          (body.plugin_id !== "computer" || Boolean(body.rule)),
      };
    case "handoff":
      return {
        kind: "cross-agent",
        id: message.id,
        direction: botIds.includes(body.to) && !botIds.includes(body.from) ? "incoming" : "handoff",
        from: appearance(body.from) ?? null,
        to: appearance(body.to) ?? null,
        text: body.reason,
      };
    case "notice":
      return { kind: "notice", id: message.id, text: body.text, tone: "info" };
    case "unsupported":
      return {
        kind: "notice",
        id: message.id,
        text: `dots 暂不支持此消息类型（${body.originalKind}）。请在 Lorca 客户端中查看。`,
        tone: "info",
      };
  }
}
function avatarImage(value: unknown): string | null {
  const prefix = "data:image/png;base64,";
  if (typeof value !== "string" || value.length > 1024 * 1024 || !value.startsWith(prefix)) return null;
  const payload = value.slice(prefix.length);
  if (payload.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return null;
  try {
    const binary = atob(payload);
    if (btoa(binary) !== payload) return null;
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (bytes.length < 57 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return null;
    const view = new DataView(bytes.buffer);
    let offset = 8;
    let hasData = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) return null;
      const kind = binary.slice(offset + 4, offset + 8);
      if (offset === 8) {
        if (kind !== "IHDR" || length !== 13) return null;
        const width = view.getUint32(offset + 8), height = view.getUint32(offset + 12);
        if (!width || !height || width > 256 || height > 256) return null;
      } else if (kind === "IHDR") return null;
      if (kind === "IDAT" && length) hasData = true;
      if (kind === "IEND") return hasData && length === 0 && offset + 12 === bytes.length ? value : null;
      offset += length + 12;
    }
  } catch {
    return null;
  }
  return null;
}
interface AvatarEntry {
  botId: string;
  version: string;
  scope: string;
  state: "queued" | "pending" | "settled";
  image: string | null;
  failedAt: number | null;
  retries: number;
  evicted: boolean;
  obsolete: boolean;
}
export class LorcaController {
  private model: Model = emptyModel();
  private runtimeSettings: RuntimeSettings | null = null;
  private settingsIncludeMcp: boolean | undefined;
  private settingsLoading = false;
  private settingsError: string | null = null;
  private settingsRequest = 0;
  private settingsRunner: string | undefined;
  private settingsApplying = false;
  private status: BridgeStatus = {
    status: "disconnected",
    endpoint: "ws://127.0.0.1:4862/ws",
    generation: 0,
    authMode: "token",
  };
  private listeners = new Set<() => void>();
  private unsubscribers: (() => void)[] = [];
  private generation = 0;
  private snapshotRequest = 0;
  private buffering: WireEvent[] | null = null;
  private activeId: string | null = null;
  private visibleChatId: string | null = null;
  private watchingKey = "";
  private selectedBot: string | null = null;
  private error: string | null = null;
  private loading = false;
  private synchronized = false;
  private loadingOlder = false;
  private olderRequest = 0;
  private sending = false;
  private navigation = 0;
  private accountEpoch = 0;
  private avatarEpoch = 0;
  private pendingAvatars = new Set<AvatarEntry>();
  private avatars = new Map<string, AvatarEntry>();
  private pendingActions = new Set<string>();
  private pendingAttachments: PickedAttachment[] = [];
  private sendingAttachmentIds = new Set<string>();
  private sendingAttachmentScope: { scope: string; generation: number; accountEpoch: number; endpoint: string; authMode: BridgeStatus["authMode"] } | null = null;
  private attachmentScope: string | null | undefined;
  private attachmentScopeFailed = false;
  private disposed = false;
  private state: LorcaShellState;
  constructor(
    private bridge: LorcaBridge,
    private demo = false,
  ) {
    this.state = this.makeState();
  }
  getSnapshot = (): LorcaShellState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private emit(): void {
    if (this.disposed) return;
    this.state = this.makeState();
    this.syncWatching();
    this.syncAttachmentScope();
    for (const listener of this.listeners) listener();
  }
  private syncWatching(): void {
    if (!this.bridge.setWatchingChat) return;
    const id = !this.disposed && this.status.status === "connected" && this.synchronized && !this.loading && this.model.hasIdentity && this.visibleChatId === this.activeId && this.visibleChatId && this.model.chats.has(this.visibleChatId) ? this.visibleChatId : null;
    const key = JSON.stringify([this.generation, this.accountEpoch, id]);
    if (key === this.watchingKey) return;
    this.watchingKey = key;
    void this.bridge.setWatchingChat(id).catch(() => {});
  }
  private supportsAttachmentImports(): boolean {
    return Boolean(this.bridge.setAttachmentScope && this.bridge.onAttachmentImport && this.bridge.releaseAttachments && this.bridge.sendAttachments);
  }
  private draftAttachmentScope(): string | null {
    if (!this.supportsAttachmentImports() || this.disposed || this.demo || this.status.status !== "connected" || !this.model.hasIdentity) return null;
    const sending = this.sendingAttachmentScope;
    if (sending && sending.generation === this.generation && sending.accountEpoch === this.accountEpoch && sending.endpoint === this.status.endpoint && sending.authMode === this.status.authMode) return sending.scope;
    if (!this.activeId && (!this.selectedBot || !this.model.bots.has(this.selectedBot))) return null;
    const scope = `g${this.generation}:a${this.accountEpoch}:n${this.navigation}`;
    return this.synchronized && !this.loading || this.attachmentScope === scope ? scope : null;
  }
  private syncAttachmentScope(): void {
    if (!this.supportsAttachmentImports()) return;
    const scope = this.draftAttachmentScope();
    if (scope === this.attachmentScope) return;
    this.attachmentScope = scope;
    this.attachmentScopeFailed = false;
    void this.bridge.setAttachmentScope!(scope).catch(() => {
      if (this.disposed || this.attachmentScope !== scope) return;
      this.attachmentScopeFailed = true;
      this.error = "无法启用当前草稿的附件导入，请重新连接后重试。";
      this.emit();
    });
  }
  private receiveAttachmentImport(event: AttachmentImportEvent): void {
    if (!event || typeof event !== "object") return;
    const files = Array.isArray(event.attachments) ? event.attachments : [];
    if (this.disposed || this.sending || this.loading || !this.synchronized || this.attachmentScopeFailed || typeof event.scope !== "string" || event.scope !== this.attachmentScope || event.scope !== this.draftAttachmentScope()) {
      this.releaseUnusedAttachments(files);
      return;
    }
    this.mergeAttachments(files, event.duplicates, event.error);
    this.emit();
  }
  private avatarScope(): string {
    return JSON.stringify([this.status.endpoint, this.generation, this.accountEpoch, this.avatarEpoch, this.model.identityId]);
  }
  private clearAvatars(): void {
    this.avatarEpoch++;
    this.avatars.clear();
  }
  private appearance(botId: string): LorcaBotAppearance | undefined {
    const bot = this.model.bots.get(botId);
    if (!bot) return undefined;
    const entry = this.avatars.get(botId);
    return {
      botId,
      name: bot.name,
      symbolName: bot.symbol_name,
      accent: bot.accent,
      image: entry && this.currentAvatar(entry) ? entry.image ?? undefined : undefined,
    };
  }
  private currentAvatar(entry: AvatarEntry): boolean {
    return this.avatars.get(entry.botId) === entry && this.matchingAvatar(entry);
  }
  private matchingAvatar(entry: AvatarEntry): boolean {
    const bot = this.model.bots.get(entry.botId);
    return !entry.obsolete && !this.disposed && this.status.status === "connected" && this.model.hasIdentity && entry.scope === this.avatarScope() && bot?.has_avatar === true && bot.avatar_version === entry.version;
  }
  private syncAvatars(retryFailures = false, retryEvicted = false): void {
    for (const entry of this.pendingAvatars) {
      if (!this.matchingAvatar(entry)) entry.obsolete = true;
    }
    for (const [botId, entry] of this.avatars) {
      if (!this.currentAvatar(entry)) this.avatars.delete(botId);
    }
    if (this.disposed || !this.bridge.getBotAvatar || this.status.status !== "connected" || !this.synchronized || !this.model.hasIdentity) return;
    const wanted = new Set<string>();
    const include = (id: string | null) => {
      if (!id || wanted.size >= 64) return;
      const bot = this.model.bots.get(id);
      if (bot?.has_avatar && bot.avatar_version) wanted.add(id);
    };
    const active = this.activeId ? this.model.chats.get(this.activeId) : undefined;
    for (const id of active?.bot_ids ?? []) include(id);
    for (const message of [...active?.messages ?? []].reverse()) {
      if (message.queued || message.author.kind === "you") continue;
      include(message.author.bot_id);
      if (message.body.kind === "handoff") { include(message.body.from); include(message.body.to); }
      else if (message.body.kind === "tool" && message.body.name === "message_bot") include(message.body.target_bot_id);
    }
    include(this.selectedBot);
    const recentChats = [...this.model.chats.values()].sort((a, b) => (b.messages.at(-1)?.created_at ?? b.created_at) - (a.messages.at(-1)?.created_at ?? a.created_at));
    for (const chat of recentChats) {
      if (wanted.size >= 64) break;
      for (const id of chat.bot_ids) include(id);
    }
    for (const id of this.model.bots.keys()) {
      if (wanted.size >= 64) break;
      include(id);
    }
    const next = new Map<string, AvatarEntry>();
    for (const id of wanted) {
      const bot = this.model.bots.get(id)!;
      const previous = this.avatars.get(id) ?? [...this.pendingAvatars].find(entry => entry.botId === id && this.matchingAvatar(entry));
      const entry = previous && this.matchingAvatar(previous)
        ? previous
        : { botId: id, version: bot.avatar_version!, scope: this.avatarScope(), state: "queued" as const, image: null, failedAt: null, retries: 0, evicted: false, obsolete: false };
      if (entry.state === "settled" && ((retryFailures && entry.failedAt !== null && Date.now() - entry.failedAt >= 5000 && entry.retries < 1) || (retryEvicted && entry.evicted))) {
        entry.state = "queued";
        entry.retries++;
        entry.failedAt = null;
        entry.evicted = false;
      }
      next.set(id, entry);
    }
    this.avatars = next;
    this.pumpAvatars();
  }
  private trimAvatarImages(): void {
    let bytes = 0;
    for (const entry of this.avatars.values()) {
      const size = (entry.image?.length ?? 0) * 2;
      if (bytes + size > 8 * 1024 * 1024) {
        entry.image = null;
        entry.evicted = true;
      } else bytes += size;
    }
  }
  private pumpAvatars(): void {
    if (this.disposed || !this.bridge.getBotAvatar || this.status.status !== "connected" || !this.synchronized || !this.model.hasIdentity) return;
    while (this.pendingAvatars.size < 4) {
      const entry = [...this.avatars.values()].find(candidate => candidate.state === "queued" && this.currentAvatar(candidate));
      if (!entry) return;
      entry.state = "pending";
      this.pendingAvatars.add(entry);
      void this.loadAvatar(entry);
    }
  }
  private async loadAvatar(entry: AvatarEntry): Promise<void> {
    let image: string | null = null;
    try {
      image = avatarImage(await this.bridge.getBotAvatar?.(entry.botId, entry.version));
    } catch {
      image = null;
    }
    this.pendingAvatars.delete(entry);
    if (this.currentAvatar(entry)) {
      entry.image = image;
      entry.state = "settled";
      entry.failedAt = image ? null : Date.now();
      this.trimAvatarImages();
      this.emit();
    }
    this.pumpAvatars();
  }
  private runnerSummary(chat: WireChat | undefined): RunnerSummary {
    if (this.status.status !== "connected" || !this.synchronized || !this.model.hasIdentity) return { kind: "unknown" };
    const botIds = chat ? chat.bot_ids : this.selectedBot ? [this.selectedBot] : [];
    if (!botIds.length) return { kind: "unknown" };
    const devices = new Map<string, { id: string; name: string; online: boolean }>();
    let unassigned = 0;
    for (const id of botIds) {
      const bot = this.model.bots.get(id);
      if (!bot) return { kind: "unknown" };
      if (bot.runner_id === "") { unassigned++; continue; }
      const device = this.model.devices.get(bot.runner_id);
      if (!device || !device.name.trim()) return { kind: "unknown" };
      devices.set(device.id, device);
    }
    if (unassigned) return { kind: unassigned === botIds.length ? "unassigned" : "unknown" };
    const device = devices.values().next().value;
    return devices.size === 1 && device ? { kind: "single", device: { ...device } } : { kind: "multiple" };
  }
  private makeState(): LorcaShellState {
    const chat = this.activeId
      ? this.model.chats.get(this.activeId)
      : undefined;
    const messages = chat?.messages ?? [];
    const detail =
      this.status.authMode === "legacy"
        ? "dots · 本地兼容连接（不校验令牌）"
        : this.status.status === "connected"
          ? `dots · 运行环境 ${this.model.version || "连接中"} · ${this.model.relayConnected ? "中继已连接" : "中继离线"}`
          : this.status.detail;
    return {
      draftScope: this.accountEpoch,
      localGroupNamespace: this.synchronized && this.status.status === "connected" && this.model.hasIdentity && this.model.identityId ? JSON.stringify([this.status.endpoint, this.model.identityId]) : undefined,
      runnerSummary: this.runnerSummary(chat),
      runtimeSettings: this.runtimeSettings ?? undefined,
      settingsLoading: this.settingsLoading,
      settingsApplying: this.settingsApplying,
      settingsError: this.settingsError ?? undefined,
      connection: {
        status: this.status.status,
        endpoint: this.status.endpoint,
        detail,
      },
      conversations: [...this.model.chats.values()]
        .map((c): LorcaConversation => ({
          id: c.id,
          kind: c.kind === "group" ? "group" as const : c.kind === "dm" ? "dm" as const : undefined,
          avatars: c.bot_ids.flatMap(id => {
            const appearance = this.appearance(id);
            return appearance ? [appearance] : [];
          }),
          title:
            c.title ||
            c.bot_ids
              .map((id) => this.model.bots.get(id)?.name ?? "智能体")
              .join(", ") ||
            "对话",
          updatedAt: new Date(
            (c.messages.at(-1)?.created_at ?? c.created_at) * 1000,
          ).toISOString(),
          status: c.messages.some(
            (m) =>
              (m.body.kind === "permission" && m.body.decision === "pending") ||
              (m.body.kind === "tool" && m.body.run?.state === "asking"),
          )
            ? "waiting"
            : isRunning(this.model, c.id)
              ? "running"
              : "idle",
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      activeConversationId: chat?.id ?? null,
      messages: messages.filter((m) => !m.queued).map((m) => messageView(m, m.author.bot_id ? this.model.bots.get(m.author.bot_id)?.name : undefined, m.author.kind !== "you" && m.author.bot_id ? this.appearance(m.author.bot_id) : undefined, chat?.bot_ids ?? [], id => this.appearance(id), this.model.messageActivityBoundaries.get(`${m.chat_id}:${m.id}`) ?? null)),
      agents: [...this.model.bots.values()].map((b) => ({
        id: b.id,
        label: b.name,
        appearance: this.appearance(b.id),
        status: [...this.model.chats.values()].some(c => c.messages.some(m => m.author.bot_id === b.id && ((m.body.kind === "permission" && m.body.decision === "pending") || (m.body.kind === "tool" && m.body.run?.state === "asking" && m.state !== "failed" && !m.error && !m.body.is_error)))) ? "waiting" as const : [...this.model.turns.values()].some(t => t.bot_id === b.id) ? "running" as const : undefined,
      })),
      selectedAgentId: this.selectedBot,
      busy: Boolean(chat && isRunning(this.model, chat.id)),
      loading: this.loading || this.sending,
      hasMore: chat?.has_more ?? false,
      loadingOlder: this.loadingOlder,
      error: this.error,
      queue: messages
        .filter((m) => m.queued)
        .map((m) => ({
          id: m.id,
          text: m.body.kind === "text" ? m.body.text : "排队中的消息",
          canSendNow: chat?.kind === "dm",
        })),
      demo: this.demo,
      pendingAttachments: this.pendingAttachments,
      attachmentsEnabled: Boolean(
        this.bridge.pickAttachments && this.bridge.sendAttachments,
      ),
    };
  }
  async start(): Promise<void> {
    this.disposed = false;
    this.unsubscribers.push(
      this.bridge.onEvent((event) => this.receive(event)),
      this.bridge.onStatus((status) => this.receiveStatus(status)),
    );
    if (this.supportsAttachmentImports()) this.unsubscribers.push(this.bridge.onAttachmentImport!(event => this.receiveAttachmentImport(event)));
    this.syncAttachmentScope();
    try {
      const status = await this.bridge.getStatus();
      if (this.disposed) return;
      this.receiveStatus(status);
      if (status.status !== "connected")
        await this.bridge.connect(status.endpoint);
    } catch (error) {
      this.fail(error);
    }
  }
  dispose(): void {
    this.disposed = true;
    this.navigation++;
    this.syncAttachmentScope();
    this.visibleChatId = null;
    this.syncWatching();
    this.clearAvatars();
    this.resetOlder();
    this.clearAttachments();
    this.clearSettings();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.listeners.clear();
    this.snapshotRequest++;
  }
  private receiveStatus(status: BridgeStatus): void {
    if (this.disposed) return;
    const newSession = status.generation !== this.generation || status.endpoint !== this.status.endpoint || status.authMode !== this.status.authMode;
    const becameConnected =
      status.status === "connected" && this.status.status !== "connected";
    this.status = status;
    if (newSession || status.status !== "connected") {
      this.clearAvatars();
      this.clearSettings();
      this.snapshotRequest++;
      this.synchronized = false;
      this.clearAttachments();
      this.buffering = null;
      this.loading = false;
      this.resetOlder();
    }
    if (newSession) {
      this.navigation++;
      if (this.model.version && !this.model.identityId) {
        this.clearSettings();
        this.accountEpoch++;
        this.navigation++;
        this.model = emptyModel();
        this.activeId = null;
      }
      this.generation = status.generation;
    }
    this.emit();
    if (
      status.status === "connected" &&
      (newSession || becameConnected || (!this.model.version && !this.loading))
    )
      void this.refresh();
  }
  private receive(value: unknown): void {
    if (this.disposed) return;
    try {
      const event = parseEvent(value);
      if (event.event === "identity.changed") {
        this.clearAvatars();
        this.clearSettings();
        this.accountEpoch++;
        this.navigation++;
        this.model = emptyModel();
        this.activeId = null;
        this.clearAttachments();
        void this.refresh();
        return;
      }
      if (this.buffering) {
        this.buffering.push(event);
        if (this.buffering.length > 10000)
          throw new Error(
            "同步期间收到的更新过多。请重新连接以刷新。",
          );
        return;
      }
      if (event.event === "snapshot") this.checkIdentity(event.data);
      this.model = applyEvent(this.model, event);
      this.syncAvatars();
      this.reconcileSelection();
      this.emit();
    } catch (error) {
      this.synchronized = false;
      this.snapshotRequest++;
      this.buffering = null;
      this.loading = false;
      this.fail(error);
    }
  }
  private checkIdentity(snapshot: WireSnapshot): boolean {
    if (this.model.version && this.model.identityId !== (snapshot.identity_id ?? null)) {
      this.clearAvatars();
      this.resetOlder();
      this.clearSettings();
      this.accountEpoch++;
      this.navigation++;
      this.model = emptyModel();
      this.activeId = null;
      this.clearAttachments();
      return true;
    }
    return false;
  }
  private reconcileSelection(): void {
    if (this.activeId && !this.model.chats.has(this.activeId)) {
      this.navigation++;
      this.clearAttachments();
      this.activeId = null;
    }
    if (!this.selectedBot || !this.model.bots.has(this.selectedBot)) {
      if (!this.activeId && this.selectedBot) { this.navigation++; this.clearAttachments(); }
      this.selectedBot = this.model.bots.keys().next().value ?? null;
    }
  }
  private refreshTask: Promise<void> | null = null;
  refresh(): Promise<void> {
    this.refreshTask = this.refreshSnapshot();
    return this.refreshTask;
  }
  private async refreshSnapshot(): Promise<void> {
    this.resetOlder();
    const request = ++this.snapshotRequest,
      generation = this.generation;
    this.buffering = [];
    this.synchronized = false;
    this.loading = true;
    this.error = null;
    this.emit();
    try {
      const raw = await this.bridge.request("bootstrap", {});
      if (
        this.disposed ||
        request !== this.snapshotRequest ||
        generation !== this.generation
      )
        return;
      const snapshot = parseSnapshot(raw);
      const accountChanged = this.checkIdentity(snapshot);
      let next = applySnapshot(this.model, snapshot);
      for (const event of accountChanged ? [] : this.buffering ?? []) next = applyBufferedEvent(next, event);
      this.model = next;
      this.synchronized = true;
      this.syncAvatars(true);
      this.buffering = null;
      this.reconcileSelection();
      if (!this.model.hasIdentity)
        this.error =
          "此设备尚未设置 Lorca 身份。请先通过 Lorca 命令行工具完成设置或配对。";
      else if (this.model.updateRequired)
        this.error =
          "中继要求更新版本的 Lorca 命令行工具。请更新 Lorca 后再同步。";
    } catch (error) {
      if (request === this.snapshotRequest) {
        this.buffering = null;
        this.fail(error);
      }
    } finally {
      if (request === this.snapshotRequest) {
        this.loading = false;
        this.emit();
      }
    }
  }
  private fail(error: unknown): void {
    this.error =
      error instanceof Error ? error.message : "dots 请求失败。";
    this.emit();
  }
  private requireReady(): void {
    if (this.status.status !== "connected" || this.loading || !this.synchronized)
      throw new Error("请等待本地 Lorca 连接完成同步。");
    if (!this.model.hasIdentity)
      throw new Error("请先在 Lorca 运行环境中设置身份。");
  }
  private async run(action: () => Promise<void>): Promise<void> {
    try {
      this.error = null;
      await action();
    } catch (error) {
      this.fail(error);
    } finally {
      this.emit();
    }
  }
  private async send(text: string): Promise<void | { chatId: string }> {
    if (this.sending) return;
    let sent: { chatId: string } | undefined;
    let sendError: Error | null = null;
    const perform = async () => {
      this.requireReady();
      if (!text.trim() && !this.pendingAttachments.length) return;
      if (this.pendingAttachments.length && !this.bridge.sendAttachments) throw new Error("此连接不支持发送附件，请移除附件后重试。");
      const selected = this.pendingAttachments.slice();
      if (selected.length && this.attachmentScope) this.sendingAttachmentScope = { scope: this.attachmentScope, generation: this.generation, accountEpoch: this.accountEpoch, endpoint: this.status.endpoint, authMode: this.status.authMode };
      const generation = this.generation,
        accountEpoch = this.accountEpoch;
      this.sendingAttachmentIds = new Set(selected.map(file => file.id));
      this.sending = true;
      this.emit();
      try {
        let chatId = this.activeId;
        if (!chatId) {
          if (!this.selectedBot)
            throw new Error(
              "请先在 Lorca 运行环境中创建智能体，再开始对话。",
            );
          const response = object(
            await this.bridge.request("chats.create", {
              kind: "dm",
              bot_ids: [this.selectedBot],
              id: `chat-${crypto.randomUUID()}`,
            }),
            "创建对话响应",
          );
          if (
            generation !== this.generation ||
            accountEpoch !== this.accountEpoch
          )
            throw new Error(
              "创建对话时，账号或连接发生了变化。请重新连接后再发送。",
            );
          const chat = parseChat(response.chat, false);
          if (!this.model.chats.has(chat.id))
            this.model = {
              ...this.model,
              chats: new Map(this.model.chats).set(chat.id, chat),
            };
          chatId = chat.id;

        }
        const messageId = `msg-${crypto.randomUUID()}`;
        this.pendingAttachments = this.pendingAttachments.filter(
          (file) => !selected.some((sent) => sent.id === file.id),
        );
        const response = object(
          selected.length && this.bridge.sendAttachments
            ? await this.bridge.sendAttachments({
                chat_id: chatId,
                text,
                message_id: messageId,
                selection_ids: selected.map((f) => f.id),
              })
            : await this.bridge.request("chats.send", {
                chat_id: chatId,
                text,
                message_id: messageId,
              }),
          "发送消息响应",
        );
        if (
          generation !== this.generation ||
          accountEpoch !== this.accountEpoch
        )
          throw new Error(
            "重新连接后无法确认消息是否已发送。请先检查对话，再决定是否重新发送。",
          );
        const message = parseMessage(response.message);
        if (message.chat_id !== chatId || message.id !== messageId)
          throw new Error(
            "Lorca 的发送响应不兼容：消息 ID 或对话不匹配。",
          );
        const chat = this.model.chats.get(chatId);
        if (chat && !chat.messages.some((m) => m.id === message.id))
          this.model = {
            ...this.model,
            chats: new Map(this.model.chats).set(chatId, {
              ...chat,
              messages: upsertMessage(chat.messages, message),
            }),
          };
        sent = { chatId };
      } finally {
        this.sendingAttachmentScope = null;
        this.sendingAttachmentIds.clear();
        this.releaseAttachments(selected.filter(file => !this.pendingAttachments.some(pending => pending.id === file.id)));
        this.sending = false;
      }
    };
    await this.run(async () => {
      try { await perform(); }
      catch (error) {
        sendError = error instanceof Error ? error : new Error("dots 请求失败。");
        throw sendError;
      }
    });
    if (sendError) throw sendError;
    return sent;
  }
  private async unique(
    key: string,
    action: () => Promise<void>,
  ): Promise<void> {
    if (this.pendingActions.has(key)) return;
    this.pendingActions.add(key);
    try {
      await this.run(action);
    } finally {
      this.pendingActions.delete(key);
    }
  }
  private releaseAttachments(files: PickedAttachment[]): void {
    const ids = [...new Set(files.filter(file => file && typeof file.id === "string" && file.id.length > 0 && file.id.length <= 256 && !/[\0\r\n]/.test(file.id) && !this.sendingAttachmentIds.has(file.id)).map(file => file.id))];
    if (ids.length && this.bridge.releaseAttachments) void this.bridge.releaseAttachments(ids).catch(() => {});
  }
  private releaseUnusedAttachments(files: PickedAttachment[]): void {
    const retained = new Set(this.pendingAttachments.map(file => file.id));
    this.releaseAttachments(files.filter(file => file && !retained.has(file.id)));
  }
  private mergeAttachments(files: PickedAttachment[], duplicateCount = 0, error?: string): void {
    const ids = new Set(this.pendingAttachments.map(file => file.id));
    let duplicates = Number.isSafeInteger(duplicateCount) && duplicateCount >= 0 ? Math.min(duplicateCount, 10000) : 0;
    let invalid = 0, overflow = 0;
    const rejected: PickedAttachment[] = [];
    for (const file of files) {
      if (!file || typeof file.id !== "string" || !file.id.trim() || file.id.length > 256 || /[\0\r\n]/.test(file.id) || typeof file.name !== "string" || !file.name.trim() || file.name.length > 1024 || /[\0\r\n]/.test(file.name)) {
        invalid++;
        rejected.push(file);
        continue;
      }
      if (ids.has(file.id)) { duplicates++; continue; }
      if (this.pendingAttachments.length >= 10) { overflow++; rejected.push(file); continue; }
      const selected: PickedAttachment = { id: file.id, name: file.name };
      if (typeof file.size === "number" && Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= 100 * 1024 * 1024) selected.size = file.size;
      if (typeof file.mime === "string" && file.mime.length <= 128 && !/[\0\r\n]/.test(file.mime)) selected.mime = file.mime;
      if (typeof file.previewUrl === "string" && file.previewUrl.startsWith("blob:") && file.previewUrl.length <= 2048 && !/[\0\r\n]/.test(file.previewUrl)) selected.previewUrl = file.previewUrl;
      ids.add(file.id);
      this.pendingAttachments = [...this.pendingAttachments, selected];
    }
    this.releaseUnusedAttachments(rejected);
    this.error = [
      typeof error === "string" && error ? error.slice(0, 2048) : null,
      duplicates ? `已跳过 ${duplicates} 个重复附件。` : null,
      overflow ? `附件最多 10 个，已忽略 ${overflow} 个超出数量的附件。` : null,
      invalid ? "部分附件信息无效，已忽略，请重新选择。" : null,
    ].filter(Boolean).join(" ") || null;
  }
  private clearAttachments(): void {
    const files = this.pendingAttachments;
    this.pendingAttachments = [];
    this.releaseAttachments(files);
  }
  private clearSettings(): void {
    this.settingsRequest++;
    this.runtimeSettings = null;
    this.settingsRunner = undefined;
    this.settingsLoading = false;
    this.settingsError = null;
  }
  private async refreshSettings(runnerId?: string, options?: { includeMcp?: boolean }): Promise<void> {
    const request = ++this.settingsRequest;
    this.settingsRunner = runnerId;
    this.settingsIncludeMcp = options?.includeMcp;
    const generation = this.generation, accountEpoch = this.accountEpoch;
    this.settingsLoading = true;
    this.settingsError = null;
    this.runtimeSettings = null;
    this.emit();
    try {
      if (this.status.status !== "connected") throw new Error("请先连接本地服务，再加载运行环境设置。");
      if (!this.bridge.getSettings) throw new Error("查看运行环境需要更新桌面桥接组件。");
      const settings = parseRuntimeSettings(await this.bridge.getSettings({ ...(runnerId ? { runnerId } : {}), ...(options?.includeMcp === undefined ? {} : { includeMcp: options.includeMcp }) }));
      if (request !== this.settingsRequest || generation !== this.generation || accountEpoch !== this.accountEpoch) return;
      this.runtimeSettings = this.bridge.openPairing ? settings : { ...settings, pairingCapabilities: {
        invite: false, join: false,
        inviteReasons: [...new Set([...(settings.pairingCapabilities?.inviteReasons ?? []), "bridge_unavailable" as const])],
        joinReasons: [...new Set([...(settings.pairingCapabilities?.joinReasons ?? []), "bridge_unavailable" as const])],
      } };
    } catch (error) {
      if (request === this.settingsRequest) this.settingsError = error instanceof Error ? error.message : "无法加载运行环境设置。";
    } finally {
      if (request === this.settingsRequest) {
        this.settingsLoading = false;
        this.emit();
      }
    }
  }
  private async openPairing(mode: "invite" | "join"): Promise<void> {
    if (mode !== "invite" && mode !== "join") throw new Error("配对方式无效。");
    if (this.disposed || this.status.status !== "connected" || this.settingsApplying || this.settingsLoading || !this.bridge.openPairing || !this.runtimeSettings?.pairingCapabilities?.[mode])
      throw new Error("设备配对当前不可用，请刷新设置并检查本地连接。");
    const generation = this.generation;
    this.settingsApplying = true;
    this.settingsError = null;
    this.emit();
    try {
      const raw = await this.bridge.openPairing(mode);
      if (this.disposed || generation !== this.generation || this.status.status !== "connected") return;
      const result = object(raw, "pairing");
      if (!["completed", "cancelled", "failed", "unknownOutcome"].includes(String(result.status))) throw new Error("配对结果尚不确定，请核对设备列表。");
      await this.refreshSettings(undefined, { includeMcp: false });
      if (this.disposed || generation !== this.generation || this.status.status !== "connected") return;
      if (result.status === "unknownOutcome") this.settingsError = "配对结果尚不确定。关闭窗口不代表撤销已发生的绑定，请在原设备核对；操作不会自动重发。";
      if (result.status === "failed") this.settingsError = "配对未确认完成，请在原设备核对状态后再决定是否重试。";
    } finally {
      this.settingsApplying = false;
      this.emit();
    }
  }
  private async settingsAction(action: SettingsAction): Promise<SettingsActionResult> {
    this.requireReady();
    if (this.settingsApplying) throw new Error("另一项设置正在处理，请等待确认完成。");
    if (this.settingsLoading || !this.bridge.settingsAction || !this.runtimeSettings?.editor)
      throw new Error("请先刷新设置，或更新桌面桥接组件。");
    if (action.revision !== this.runtimeSettings.editor.revision)
      throw new Error("设置已变化，请刷新后重新编辑。");
    const generation = this.generation, accountEpoch = this.accountEpoch;
    const request = this.settingsRequest, runner = this.settingsRunner, includeMcp = this.settingsIncludeMcp;
    const current = () => !this.disposed && generation === this.generation && accountEpoch === this.accountEpoch && this.status.status === "connected";
    this.settingsApplying = true;
    this.settingsError = null;
    this.emit();
    try {
      const raw = await this.bridge.settingsAction(action);
      if (!current()) throw new Error("账号或连接已变化，请刷新后核对设置；操作未被自动重发。");
      const value = object(raw, "settingsAction");
      const status = value.status;
      if (status !== "applied" && status !== "cancelled" && status !== "unknownOutcome")
        throw new Error("设置操作结果尚不确定，请刷新核对；操作未被自动重发。");
      if (status !== "cancelled" && request === this.settingsRequest) await this.refreshSettings(runner, { includeMcp });
      if (!current()) throw new Error("账号或连接已变化，请刷新后核对设置；操作未被自动重发。");
      if (status === "unknownOutcome") this.settingsError = "刚才的设置操作结果尚不确定，请核对当前配置后再决定是否重试；操作未被自动重发。";
      return { status };
    } catch (error) {
      if (!current()) throw new Error("账号或连接已变化，请刷新后核对设置；操作未被自动重发。");
      if (request === this.settingsRequest) this.settingsError = error instanceof Error ? error.message : "设置操作失败，请刷新核对。";
      throw error;
    } finally {
      this.settingsApplying = false;
      this.emit();
    }
  }
  actions: LorcaShellActions = {
    onConversationVisibility: (id) => {
      this.visibleChatId = id !== null && id === this.activeId && this.model.chats.has(id) ? id : null;
      this.syncWatching();
    },
    onOpenPairing: (mode) => this.openPairing(mode),
    onSettingsAction: (action) => this.settingsAction(action),
    onRefreshSettings: (runnerId, options) => { void this.refreshSettings(runnerId, options); },
    onSelectConversation: (id) => {
      if (this.model.chats.has(id)) {
        this.navigation++;
        this.resetOlder();
        this.error = null;
        this.activeId = id;
        this.selectedBot =
          this.model.chats.get(id)?.bot_ids[0] ?? this.selectedBot;
        this.clearAttachments();
        this.syncAvatars(false, true);
        this.emit();
      }
    },
    onNewConversation: () => {
      this.navigation++;
      this.resetOlder();
      this.activeId = null;
      this.clearAttachments();
      this.error = null;
      this.syncAvatars(false, true);
      this.emit();
    },
    onOpenAgentChat: (id) => {
      if (this.disposed || this.sending || !this.model.bots.has(id)) return;
      const existing = [...this.model.chats.values()].find(chat => chat.kind === "dm" && chat.bot_ids.length === 1 && chat.bot_ids[0] === id);
      if (existing) {
        if (this.activeId !== existing.id) this.actions.onSelectConversation(existing.id);
      } else if (this.activeId !== null || this.selectedBot !== id) {
        this.actions.onNewConversation();
        this.actions.onSelectAgent(id);
      }
    },
    onSelectAgent: (id) => {
      if (!this.sending && this.model.bots.has(id)) {
        if (!this.activeId && id !== this.selectedBot) { this.navigation++; this.clearAttachments(); }
        this.selectedBot = id;
        this.syncAvatars(false, true);
        this.emit();
      }
    },
    onSend: (text) => this.send(text),
    onStop: () => {
      const id = this.activeId;
      if (id)
        void this.unique(`stop:${id}`, async () => {
          this.requireReady();
          await this.bridge.request("chats.stop", { chat_id: id });
        });
    },
    onSendNow: (id) => {
      const chat = this.activeId
        ? this.model.chats.get(this.activeId)
        : undefined;
      if (chat)
        void this.unique(`send-now:${id}`, async () => {
          this.requireReady();
          if (chat.kind !== "dm")
            throw new Error("仅可在一对一对话中立即发送。");
          await this.bridge.request("chats.send_now", {
            chat_id: chat.id,
            message_id: id,
          });
        });
    },
    onApproval: (id, decision) => {
      const chat = this.activeId
        ? this.model.chats.get(this.activeId)
        : undefined;
      if (chat)
        void this.unique(`permission:${id}`, async () => {
          this.requireReady();
          const message = chat.messages.find((m) => m.id === id);
          const body = message?.body;
          const pending =
            (body?.kind === "permission" && body.decision === "pending") ||
            (body?.kind === "tool" && body.run?.state === "asking");
          if (!pending)
            throw new Error("此权限请求已不再等待处理。");
          if (
            body?.kind === "permission" &&
            ["access", "connect", "secret"].includes(body.tool) &&
            decision !== "deny"
          )
            throw new Error(body.tool === "secret" ? "请在 Lorca 客户端中安全输入凭据。dots 未提交此请求。" : "请在 Lorca 客户端中管理访问权限或登录。");
          if (
            decision === "always" &&
            ((body?.kind === "tool" && !body.run?.rule) ||
              (body?.kind === "permission" &&
                body.plugin_id === "computer" &&
                !body.rule))
          )
            throw new Error("无法为此命令设置始终允许。");
          const result = object(
            await this.bridge.request("chats.permission", {
              chat_id: chat.id,
              message_id: id,
              decision,
            }),
            "权限响应",
          );
          if (typeof result.answered !== "boolean") throw new Error("Lorca 的权限响应不兼容。");
          if (result.answered === false) {
            await this.refresh();
            throw new Error(
              "此请求已不再等待处理。对话已刷新。",
            );
          }
        });
    },
    onLoadOlder: () => {
      void this.loadOlder();
    },
    onSaveEndpoint: async (endpoint) => {
      const match = /^ws:\/\/(127\.0\.0\.1|localhost):([0-9]{1,5})\/ws$/.exec(endpoint);
      if (endpoint.length > 160 || !match || Number(match[2]) < 1 || Number(match[2]) > 65535)
        throw new Error("请使用 ws://127.0.0.1:PORT/ws，端口范围为 1 至 65535。");
      const canonical = `ws://127.0.0.1:${Number(match[2])}/ws`;
      const changed = canonical !== this.status.endpoint.replace("localhost", "127.0.0.1");
      if (changed) {
        this.clearAvatars();
        this.resetOlder();
        this.snapshotRequest++;
        this.buffering = null;
        this.loading = false;
        this.clearSettings();
        this.accountEpoch++;
        this.navigation++;
        this.model = emptyModel();
        this.activeId = null;
        this.clearAttachments();
        this.synchronized = false;
        this.emit();
      }
      try {
        const status = await this.bridge.connect(canonical);
        this.receiveStatus(status);
        if (status.status !== "connected") throw new Error(status.detail || "未能连接 Lorca。请检查连接地址和身份验证。");
        await (this.loading && this.refreshTask ? this.refreshTask : this.refresh());
        if (!this.synchronized) throw new Error(this.error || "Lorca 同步失败。");
      } catch (error) {
        this.fail(error);
        throw error;
      }
    },
    onReconnect: () => {
      this.navigation++;
      this.clearAttachments();
      this.syncAttachmentScope();
      void this.run(async () => {
        const generation = this.generation;
        const status = await this.bridge.connect(this.status.endpoint);
        if (
          status.status === "connected" &&
          generation === this.generation &&
          !this.loading
        )
          await this.refresh();
      });
    },
    onPickAttachments: () => {
      void this.unique("pick-attachments", async () => {
        this.requireReady();
        if (this.sending) throw new Error("请等待当前消息发送完成后再添加附件。");
        if (!this.bridge.pickAttachments || !this.bridge.sendAttachments) throw new Error("此连接不支持添加附件。");
        const generation = this.generation,
          navigation = this.navigation,
          accountEpoch = this.accountEpoch;
        if (this.bridge.pickAttachments) {
          const picked = await this.bridge.pickAttachments();
          if (
            !this.disposed &&
            !this.sending &&
            this.status.status === "connected" &&
            generation === this.generation &&
            navigation === this.navigation &&
            accountEpoch === this.accountEpoch
          ) {
            this.mergeAttachments(picked);
          } else this.releaseUnusedAttachments(picked);
        }
      });
    },
    onRemoveAttachment: (id) => {
      const removed = this.pendingAttachments.filter(file => file.id === id);
      this.pendingAttachments = this.pendingAttachments.filter(file => file.id !== id);
      this.releaseAttachments(removed);
      this.emit();
    },
  };
  private resetOlder(): void {
    this.olderRequest++;
    this.loadingOlder = false;
  }
  private async loadOlder(): Promise<void> {
    const id = this.activeId,
      chat = id ? this.model.chats.get(id) : undefined;
    if (!chat || !id || !chat.has_more || this.loadingOlder) return;
    const request = ++this.olderRequest,
      navigation = this.navigation,
      generation = this.generation,
      accountEpoch = this.accountEpoch;
    const current = () => !this.disposed && request === this.olderRequest && generation === this.generation && accountEpoch === this.accountEpoch && id === this.activeId && navigation === this.navigation;
    this.loadingOlder = true;
    this.error = null;
    this.emit();
    try {
      this.requireReady();
      const raw = await this.bridge.request("chats.messages", {
        chat_id: id,
        before: chat.messages[0]?.id,
        limit: 60,
      });
      if (!current()) return;
      const page = parsePage(raw);
      this.model = appendOlder(this.model, id, page.messages, page.has_more);
    } catch (error) {
      if (current()) this.fail(error);
    } finally {
      if (current()) {
        this.loadingOlder = false;
        this.emit();
      }
    }
  }
}
