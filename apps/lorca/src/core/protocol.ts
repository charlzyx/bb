export interface WireBot {
  id: string;
  name: string;
  runner_id: string;
}
export interface WireChat {
  id: string;
  kind: string;
  title: string | null;
  bot_ids: string[];
  created_at: number;
  messages: WireMessage[];
  has_more: boolean;
}
export type WireBody =
  | {
      kind: "text";
      text: string;
      attachments: { id: string; name: string; mime: string; size: number }[];
    }
  | {
      kind: "tool";
      name: string;
      summary: string;
      detail: string;
      is_running: boolean;
      is_error: boolean;
      run: {
        state: string;
        command: string;
        output: string | null;
        reason: string | null;
        rule: string | null;
      } | null;
    }
  | {
      kind: "permission";
      plugin_id: string;
      plugin_name: string;
      tool: string;
      summary: string;
      decision: string;
      reason: string | null;
      rule: string | null;
      command: string | null;
    }
  | { kind: "notice"; text: string }
  | { kind: "handoff"; from: string; to: string; reason: string }
  | { kind: "unsupported"; originalKind: string };
export interface WireMessage {
  id: string;
  chat_id: string;
  author: { kind: string; bot_id: string | null };
  body: WireBody;
  state: string;
  error: string | null;
  created_at: number;
  queued: boolean;
}
export interface WireTurn {
  chat_id: string;
  bot_id: string;
  job_id: string;
}
export interface WireSnapshot {
  version: string;
  has_identity: boolean;
  identity_id?: string | null;
  relay_connected: boolean;
  relay_update_required: boolean;
  bots: WireBot[];
  chats: WireChat[];
  running_turns: WireTurn[];
  running_chat_ids: string[];
}
export type WireEvent =
  | { event: "snapshot"; data: WireSnapshot }
  | { event: "roster.changed"; data: { bots: WireBot[]; chats: WireChat[] } }
  | {
      event: "message.added" | "message.updated";
      data: { chat_id: string; message: WireMessage };
    }
  | { event: "message.removed"; data: { chat_id: string; message_id: string } }
  | { event: "chat.removed"; data: { chat_id: string } }
  | { event: "job.started" | "job.finished"; data: WireTurn }
  | {
      event: "relay.status";
      data: { connected: boolean; update_required: boolean };
    }
  | { event: "identity.changed"; data: { has_identity: boolean } }
  | { event: "ignored"; data: { name: string } };

export class ProtocolError extends Error {
  constructor(field: string) {
    super(`Lorca 返回的数据不兼容：${field}`);
    this.name = "ProtocolError";
  }
}
export function object(
  value: unknown,
  field = "object",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProtocolError(field);
  return value as Record<string, unknown>;
}
export function string(value: unknown, field: string): string {
  if (typeof value !== "string") throw new ProtocolError(field);
  return value;
}
function optionalString(value: unknown, field: string): string | null {
  return value == null ? null : string(value, field);
}
function boolean(value: unknown, field: string, fallback?: boolean): boolean {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "boolean") throw new ProtocolError(field);
  return value;
}
function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new ProtocolError(field);
  return value;
}
function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new ProtocolError(field);
  return value;
}
function strings(value: unknown, field: string): string[] {
  return array(value, field).map((v) => string(v, field));
}
export function parseBot(value: unknown): WireBot {
  const v = object(value, "bot");
  return {
    id: string(v.id, "bot.id"),
    name: string(v.name, "bot.name"),
    runner_id: string(v.runner_id, "bot.runner_id"),
  };
}
function parseRun(value: unknown): Extract<WireBody, { kind: "tool" }>["run"] {
  if (value == null) return null;
  const r = object(value, "tool.run");
  return {
    state: string(r.state, "run.state"),
    command: string(r.command, "run.command"),
    output: optionalString(r.output, "run.output"),
    reason: optionalString(r.reason, "run.reason"),
    rule: optionalString(r.rule, "run.rule"),
  };
}
export function parseMessage(value: unknown): WireMessage {
  const v = object(value, "message"),
    a = object(v.author, "message.author"),
    b = object(v.body, "message.body");
  const kind = string(b.kind, "body.kind");
  let body: WireBody;
  switch (kind) {
    case "text":
      body = {
        kind,
        text: string(b.text, "body.text"),
        attachments:
          b.attachments === undefined
            ? []
            : array(b.attachments, "attachments").map((item) => {
                const f = object(item, "attachment");
                return {
                  id: string(f.id, "attachment.id"),
                  name: string(f.name, "attachment.name"),
                  mime: string(f.mime, "attachment.mime"),
                  size: number(f.size, "attachment.size"),
                };
              }),
      };
      break;
    case "tool":
      body = {
        kind,
        name: string(b.name, "tool.name"),
        summary: string(b.summary, "tool.summary"),
        detail: string(b.detail, "tool.detail"),
        is_running: boolean(b.is_running, "tool.is_running"),
        is_error: boolean(b.is_error, "tool.is_error", false),
        run: parseRun(b.run),
      };
      break;
    case "permission":
      body = {
        kind,
        plugin_id: string(b.plugin_id, "permission.plugin_id"),
        plugin_name: string(b.plugin_name, "permission.plugin_name"),
        tool: string(b.tool, "permission.tool"),
        summary: string(b.summary, "permission.summary"),
        decision: string(b.decision, "permission.decision"),
        reason: optionalString(b.reason, "permission.reason"),
        rule: optionalString(b.rule, "permission.rule"),
        command: optionalString(b.command, "permission.command"),
      };
      break;
    case "notice":
      body = { kind, text: string(b.text, "notice.text") };
      break;
    case "handoff":
      body = {
        kind,
        from: string(b.from, "handoff.from"),
        to: string(b.to, "handoff.to"),
        reason: string(b.reason, "handoff.reason"),
      };
      break;
    default:
      body = { kind: "unsupported", originalKind: kind };
  }
  return {
    id: string(v.id, "message.id"),
    chat_id: string(v.chat_id, "message.chat_id"),
    author: {
      kind: string(a.kind, "author.kind"),
      bot_id: optionalString(a.bot_id, "author.bot_id"),
    },
    body,
    state: string(object(v.state, "message.state").kind, "message.state.kind"),
    error: optionalString(object(v.state, "message.state").error,"message.state.error"),
    created_at: number(v.created_at, "message.created_at"),
    queued: boolean(v.queued, "message.queued", false),
  };
}
export function parseChat(value: unknown, withMessages = true): WireChat {
  const v = object(value, "chat");
  return {
    id: string(v.id, "chat.id"),
    kind: string(v.kind, "chat.kind"),
    title: optionalString(v.title, "chat.title"),
    bot_ids: strings(v.bot_ids, "chat.bot_ids"),
    created_at: number(v.created_at, "chat.created_at"),
    messages: withMessages
      ? array(v.messages, "chat.messages").map(parseMessage)
      : [],
    has_more: withMessages
      ? boolean(v.has_more, "chat.has_more", false)
      : false,
  };
}
function parseTurn(value: unknown): WireTurn {
  const v = object(value, "turn");
  return {
    chat_id: string(v.chat_id, "turn.chat_id"),
    bot_id: string(v.bot_id, "turn.bot_id"),
    job_id: string(v.job_id, "turn.job_id"),
  };
}
export function parseSnapshot(value: unknown): WireSnapshot {
  const v = object(value, "snapshot");
  return {
    version: string(v.version, "version"),
    has_identity: boolean(v.has_identity, "has_identity"),
    identity_id: v.identity_id == null ? null : string(v.identity_id, "identity_id"),
    relay_connected: boolean(v.relay_connected, "relay_connected"),
    relay_update_required: boolean(
      v.relay_update_required,
      "relay_update_required",
      false,
    ),
    bots: array(v.bots, "bots").map(parseBot),
    chats: array(v.chats, "chats").map((c) => parseChat(c)),
    running_turns:
      v.running_turns === undefined
        ? []
        : array(v.running_turns, "running_turns").map(parseTurn),
    running_chat_ids:
      v.running_chat_ids === undefined
        ? []
        : strings(v.running_chat_ids, "running_chat_ids"),
  };
}
export function parsePage(value: unknown): {
  messages: WireMessage[];
  has_more: boolean;
} {
  const v = object(value, "page");
  return {
    messages: array(v.messages, "page.messages").map(parseMessage),
    has_more: boolean(v.has_more, "page.has_more"),
  };
}
export function parseEvent(value: unknown): WireEvent {
  const v = object(value, "event"),
    name = string(v.event, "event.name");
  if (name === "snapshot") return { event: name, data: parseSnapshot(v.data) };
  if (
    ![
      "roster.changed",
      "message.added",
      "message.updated",
      "message.removed",
      "chat.removed",
      "job.started",
      "job.finished",
      "relay.status",
      "identity.changed",
    ].includes(name)
  )
    return { event: "ignored", data: { name } };
  const d = object(v.data, "event.data");
  switch (name) {
    case "roster.changed":
      return {
        event: name,
        data: {
          bots: array(d.bots, "bots").map(parseBot),
          chats: array(d.chats, "chats").map((c) => parseChat(c, false)),
        },
      };
    case "message.added":
    case "message.updated": {
      const message = parseMessage(d.message),
        chat_id = string(d.chat_id, "chat_id");
      if (message.chat_id !== chat_id)
        throw new ProtocolError("message.chat_id 与 chat_id 不一致");
      return { event: name, data: { chat_id, message } };
    }
    case "message.removed":
      return {
        event: name,
        data: {
          chat_id: string(d.chat_id, "chat_id"),
          message_id: string(d.message_id, "message_id"),
        },
      };
    case "chat.removed":
      return { event: name, data: { chat_id: string(d.chat_id, "chat_id") } };
    case "job.started":
    case "job.finished":
      return { event: name, data: parseTurn(d) };
    case "relay.status":
      return {
        event: name,
        data: {
          connected: boolean(d.connected, "connected"),
          update_required: boolean(d.update_required, "update_required", false),
        },
      };
    case "identity.changed":
      return {
        event: name,
        data: { has_identity: boolean(d.has_identity, "has_identity") },
      };
    default:
      return { event: "ignored", data: { name } };
  }
}
