import {
  object,
  parseChat,
  parseEvent,
  parseMessage,
  parsePage,
  parseSnapshot,
  type WireEvent,
  type WireMessage,
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
  LorcaMessage,
  LorcaShellActions,
} from "../ui/types";

function messageView(message: WireMessage): LorcaMessage {
  const body = message.body;
  switch (body.kind) {
    case "text":
      return {
        kind: "message",
        id: message.id,
        role: message.author.kind === "you" ? "user" : "assistant",
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
          title: "Run command",
          detail: [body.run.command, body.run.reason]
            .filter(Boolean)
            .join("\n\n"),
          status: "pending",
          canAlways: Boolean(body.run.rule),
        };
      return {
        kind: "tool",
        id: message.id,
        name: body.summary || body.name,
        status: body.is_error
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
          body.tool === "access" || body.tool === "connect"
            ? "Manage access or sign-in in the Lorca app."
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
        text: `This message type (${body.originalKind}) needs a newer UI. Open it in Lorca.`,
        tone: "info",
      };
  }
}
export class LorcaController {
  private model: Model = emptyModel();
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
  private sending = false;
  private navigation = 0;
  private accountEpoch = 0;
  private pendingActions = new Set<string>();
  private pendingAttachments: PickedAttachment[] = [];
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
        ? "Legacy loopback mode · unauthenticated local connection"
        : this.status.status === "connected"
          ? `Lorca ${this.model.version || "connecting"} · ${this.model.relayConnected ? "relay synced" : "relay offline"}`
          : this.status.detail;
    return {
      connection: {
        status: this.status.status,
        endpoint: this.status.endpoint,
        detail,
      },
      conversations: [...this.model.chats.values()]
        .map((c) => ({
          id: c.id,
          title:
            c.title ||
            c.bot_ids
              .map((id) => this.model.bots.get(id)?.name ?? "Bot")
              .join(", ") ||
            "Conversation",
          updatedAt: new Date(
            (c.messages.at(-1)?.created_at ?? c.created_at) * 1000,
          ).toISOString(),
          status: c.messages.some(
            (m) =>
              m.body.kind === "permission" && m.body.decision === "pending",
          )
            ? "waiting"
            : isRunning(this.model, c.id)
              ? "running"
              : "idle",
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      activeConversationId: chat?.id ?? null,
      messages: messages.filter((m) => !m.queued).map(messageView),
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
          text: m.body.kind === "text" ? m.body.text : "Queued message",
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
      this.snapshotRequest++;
      this.synchronized = false;
      this.pendingAttachments = [];
      this.buffering = null;
      this.loading = false;
      this.loadingOlder = false;
    }
    if (newSession) this.generation = status.generation;
    this.emit();
    if (
      status.status === "connected" &&
      (newSession || becameConnected || !this.model.version)
    )
      void this.refresh();
  }
  private receive(value: unknown): void {
    try {
      const event = parseEvent(value);
      if (event.event === "identity.changed") {
        this.accountEpoch++;
        this.navigation++;
        this.model = emptyModel();
        this.activeId = null;
        this.pendingAttachments = [];
        void this.refresh();
        return;
      }
      if (this.buffering) {
        this.buffering.push(event);
        if (this.buffering.length > 10000)
          throw new Error(
            "Too many updates during synchronization. Reconnect to refresh.",
          );
        return;
      }
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
  private reconcileSelection(): void {
    if (this.activeId && !this.model.chats.has(this.activeId))
      this.activeId = null;
    if (!this.selectedBot || !this.model.bots.has(this.selectedBot))
      this.selectedBot = this.model.bots.keys().next().value ?? null;
  }
  async refresh(): Promise<void> {
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
      let next = applySnapshot(this.model, parseSnapshot(raw));
      for (const event of this.buffering ?? []) next = applyBufferedEvent(next, event);
      this.model = next;
      this.synchronized = true;
      this.buffering = null;
      this.reconcileSelection();
      if (!this.model.hasIdentity)
        this.error =
          "No Lorca identity on this device. Set up or pair the Lorca CLI first.";
      else if (this.model.updateRequired)
        this.error =
          "The relay requires a newer Lorca CLI. Update Lorca before syncing.";
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
      error instanceof Error ? error.message : "The Lorca request failed.";
    this.emit();
  }
  private requireReady(): void {
    if (this.status.status !== "connected" || this.loading || !this.synchronized)
      throw new Error("Wait for the local Lorca connection to finish syncing.");
    if (!this.model.hasIdentity)
      throw new Error("Set up your identity in Lorca first.");
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
  private async send(text: string): Promise<void> {
    if (this.sending) return;
    await this.run(async () => {
      this.requireReady();
      if (!text.trim() && !this.pendingAttachments.length) return;
      this.sending = true;
      this.emit();
      const generation = this.generation,
        navigation = this.navigation,
        accountEpoch = this.accountEpoch;
      const selected = this.pendingAttachments.slice();
      try {
        let chatId = this.activeId;
        if (!chatId) {
          if (!this.selectedBot)
            throw new Error(
              "Create a bot in Lorca before starting a conversation.",
            );
          const response = object(
            await this.bridge.request("chats.create", {
              kind: "dm",
              bot_ids: [this.selectedBot],
              id: `chat-${crypto.randomUUID()}`,
            }),
            "create response",
          );
          if (
            generation !== this.generation ||
            accountEpoch !== this.accountEpoch
          )
            throw new Error(
              "Account or connection changed while creating the chat. Reconnect before sending.",
            );
          const chat = parseChat(response.chat, false);
          if (!this.model.chats.has(chat.id))
            this.model = {
              ...this.model,
              chats: new Map(this.model.chats).set(chat.id, chat),
            };
          chatId = chat.id;
          if (navigation === this.navigation) this.activeId = chat.id;
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
          "send response",
        );
        if (
          generation !== this.generation ||
          accountEpoch !== this.accountEpoch
        )
          throw new Error(
            "Send outcome unknown after reconnect. Check the conversation before sending again.",
          );
        const message = parseMessage(response.message);
        if (message.chat_id !== chatId || message.id !== messageId)
          throw new Error(
            "Incompatible Lorca send response: message ID or chat mismatch.",
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
      } finally {
        this.sending = false;
      }
    });
    if (this.error) throw new Error(this.error);
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
  actions: LorcaShellActions = {
    onSelectConversation: (id) => {
      if (this.model.chats.has(id)) {
        this.navigation++;
        this.activeId = id;
        this.selectedBot =
          this.model.chats.get(id)?.bot_ids[0] ?? this.selectedBot;
        this.pendingAttachments = [];
        this.emit();
      }
    },
    onNewConversation: () => {
      this.navigation++;
      this.activeId = null;
      this.pendingAttachments = [];
      this.error = null;
      this.emit();
    },
    onSelectAgent: (id) => {
      if (this.model.bots.has(id)) {
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
            throw new Error("Send now is available in direct chats only.");
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
            throw new Error("This permission request is no longer pending.");
          if (
            body?.kind === "permission" &&
            ["access", "connect"].includes(body.tool) &&
            decision !== "deny"
          )
            throw new Error("Manage access or sign-in in the Lorca app.");
          if (
            decision === "always" &&
            ((body?.kind === "tool" && !body.run?.rule) ||
              (body?.kind === "permission" &&
                body.plugin_id === "computer" &&
                !body.rule))
          )
            throw new Error("This command cannot be permanently approved.");
          const result = object(
            await this.bridge.request("chats.permission", {
              chat_id: chat.id,
              message_id: id,
              decision,
            }),
            "permission response",
          );
          if (typeof result.answered !== "boolean") throw new Error("Incompatible Lorca permission response.");
          if (result.answered === false) {
            await this.refresh();
            throw new Error(
              "This request is no longer waiting. The conversation was refreshed.",
            );
          }
        });
    },
    onLoadOlder: () => {
      void this.loadOlder();
    },
    onSaveEndpoint: (endpoint) => {
      this.accountEpoch++;
      this.navigation++;
      this.model = emptyModel();
      this.activeId = null;
      void this.run(async () => {
        await this.bridge.connect(endpoint);
      });
    },
    onReconnect: () => {
      this.pendingAttachments = [];
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
            generation === this.generation &&
            navigation === this.navigation &&
            accountEpoch === this.accountEpoch
          )
            this.pendingAttachments = [
              ...this.pendingAttachments,
              ...picked,
            ].slice(0, 10);
        }
      });
    },
    onRemoveAttachment: (id) => {
      this.pendingAttachments = this.pendingAttachments.filter(
        (f) => f.id !== id,
      );
      this.emit();
    },
  };
  private async loadOlder(): Promise<void> {
    const id = this.activeId,
      chat = id ? this.model.chats.get(id) : undefined;
    if (!chat || !id || !chat.has_more || this.loadingOlder) return;
    const generation = this.generation,
      accountEpoch = this.accountEpoch;
    this.loadingOlder = true;
    this.emit();
    await this.run(async () => {
      this.requireReady();
      const page = parsePage(
        await this.bridge.request("chats.messages", {
          chat_id: id,
          before: chat.messages[0]?.id,
          limit: 60,
        }),
      );
      if (generation === this.generation && accountEpoch === this.accountEpoch)
        this.model = appendOlder(this.model, id, page.messages, page.has_more);
    });
    this.loadingOlder = false;
    this.emit();
  }
}
