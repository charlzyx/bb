import {
  object,
  parseChat,
  parseEvent,
  parseMessage,
  parsePage,
  parseSnapshot,
  type WireEvent,
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
import type { BridgeStatus, LorcaBridge, PickedAttachment } from "./bridge";
import type {
  LorcaShellState,
  LorcaConversation,
  LorcaMessage,
  LorcaShellActions,
  RuntimeSettings,
  SettingsAction,
  SettingsActionResult,
} from "../ui/types";

import { parseRuntimeSettings } from "./settings";

function messageView(message: WireMessage, authorName?: string): LorcaMessage {
  const body = message.body;
  switch (body.kind) {
    case "text":
      return {
        kind: "message",
        id: message.id,
        role: message.author.kind === "you" ? "user" : "assistant",
        authorName,
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
      if (body.run?.state === "asking")
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
        name: body.summary || body.name,
        status: body.is_error || body.run?.state === "failed"
          ? "error"
          : body.is_running
            ? "running"
            : "complete",
        output: body.run?.output || body.detail,
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
          body.tool === "access" || body.tool === "connect"
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
        canAllow: body.tool !== "access" && body.tool !== "connect",
        canAlways:
          body.tool !== "access" &&
          body.tool !== "connect" &&
          (body.plugin_id !== "computer" || Boolean(body.rule)),
      };
    case "handoff":
      return {
        kind: "notice",
        id: message.id,
        text: `${body.from} → ${body.to}: ${body.reason}`,
        tone: "info",
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
export class LorcaController {
  private model: Model = emptyModel();
  private runtimeSettings: RuntimeSettings | null = null;
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
  private selectedBot: string | null = null;
  private error: string | null = null;
  private loading = false;
  private synchronized = false;
  private loadingOlder = false;
  private olderRequest = 0;
  private sending = false;
  private navigation = 0;
  private accountEpoch = 0;
  private pendingActions = new Set<string>();
  private pendingAttachments: PickedAttachment[] = [];
  private sendingAttachmentIds = new Set<string>();
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
    for (const listener of this.listeners) listener();
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
          ? `dots · 运行环境 ${this.model.version || "连接中"} · ${this.model.relayConnected ? "中继已同步" : "中继离线"}`
          : this.status.detail;
    return {
      draftScope: this.accountEpoch,
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
          title:
            c.title ||
            c.bot_ids
              .map((id) => this.model.bots.get(id)?.name ?? "机器人")
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
      messages: messages.filter((m) => !m.queued).map((m) => messageView(m, m.author.bot_id ? this.model.bots.get(m.author.bot_id)?.name : undefined)),
      agents: [...this.model.bots.values()].map((b) => ({
        id: b.id,
        label: b.name,
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
    const newSession = status.generation !== this.generation;
    const becameConnected =
      status.status === "connected" && this.status.status !== "connected";
    this.status = status;
    if (newSession || status.status !== "connected") {
      this.clearSettings();
      this.snapshotRequest++;
      this.synchronized = false;
      this.clearAttachments();
      this.buffering = null;
      this.loading = false;
      this.resetOlder();
    }
    if (newSession) {
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
    try {
      const event = parseEvent(value);
      if (event.event === "identity.changed") {
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
    if (this.activeId && !this.model.chats.has(this.activeId))
      this.activeId = null;
    if (!this.selectedBot || !this.model.bots.has(this.selectedBot))
      this.selectedBot = this.model.bots.keys().next().value ?? null;
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
      this.sending = true;
      this.emit();
      const generation = this.generation,
        accountEpoch = this.accountEpoch;
      const selected = this.pendingAttachments.slice();
      this.sendingAttachmentIds = new Set(selected.map(file => file.id));
      try {
        let chatId = this.activeId;
        if (!chatId) {
          if (!this.selectedBot)
            throw new Error(
              "请先在 Lorca 运行环境中创建机器人，再开始对话。",
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
    const ids = files.filter(file => !this.sendingAttachmentIds.has(file.id)).map(file => file.id);
    if (ids.length && this.bridge.releaseAttachments) void this.bridge.releaseAttachments(ids).catch(() => {});
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
  private async refreshSettings(runnerId?: string): Promise<void> {
    const request = ++this.settingsRequest;
    this.settingsRunner = runnerId;
    const generation = this.generation, accountEpoch = this.accountEpoch;
    this.settingsLoading = true;
    this.settingsError = null;
    this.runtimeSettings = null;
    this.emit();
    try {
      if (this.status.status !== "connected") throw new Error("请先连接本地服务，再加载运行环境设置。");
      if (!this.bridge.getSettings) throw new Error("查看运行环境需要更新桌面桥接组件。");
      const settings = parseRuntimeSettings(await this.bridge.getSettings(runnerId ? { runnerId } : {}));
      if (request !== this.settingsRequest || generation !== this.generation || accountEpoch !== this.accountEpoch) return;
      this.runtimeSettings = settings;
    } catch (error) {
      if (request === this.settingsRequest) this.settingsError = error instanceof Error ? error.message : "无法加载运行环境设置。";
    } finally {
      if (request === this.settingsRequest) {
        this.settingsLoading = false;
        this.emit();
      }
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
    const request = this.settingsRequest, runner = this.settingsRunner;
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
      if (status !== "cancelled" && request === this.settingsRequest) await this.refreshSettings(runner);
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
    onSettingsAction: (action) => this.settingsAction(action),
    onRefreshSettings: (runnerId) => { void this.refreshSettings(runnerId); },
    onSelectConversation: (id) => {
      if (this.model.chats.has(id)) {
        this.navigation++;
        this.activeId = id;
        this.selectedBot =
          this.model.chats.get(id)?.bot_ids[0] ?? this.selectedBot;
        this.clearAttachments();
        this.emit();
      }
    },
    onNewConversation: () => {
      this.navigation++;
      this.activeId = null;
      this.clearAttachments();
      this.error = null;
      this.emit();
    },
    onSelectAgent: (id) => {
      if (!this.sending && this.model.bots.has(id)) {
        this.selectedBot = id;
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
            ["access", "connect"].includes(body.tool) &&
            decision !== "deny"
          )
            throw new Error("请在 Lorca 客户端中管理访问权限或登录。");
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
      this.clearAttachments();
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
        const generation = this.generation,
          navigation = this.navigation,
          accountEpoch = this.accountEpoch;
        if (this.bridge.pickAttachments) {
          const picked = await this.bridge.pickAttachments();
          if (
            !this.disposed &&
            generation === this.generation &&
            navigation === this.navigation &&
            accountEpoch === this.accountEpoch
          ) {
            const combined = [...this.pendingAttachments, ...picked];
            this.pendingAttachments = combined.slice(0, 10);
            this.releaseAttachments(combined.slice(10));
          } else this.releaseAttachments(picked);
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
      generation = this.generation,
      accountEpoch = this.accountEpoch;
    const current = () => !this.disposed && request === this.olderRequest && generation === this.generation && accountEpoch === this.accountEpoch;
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
