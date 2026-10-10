import type {
  WireBot,
  WireChat,
  WireDevice,
  WireEvent,
  WireMessage,
  WireSnapshot,
  WireTurn,
} from "./protocol";

export interface Model {
  version: string;
  hasIdentity: boolean;
  identityId: string | null;
  relayConnected: boolean;
  updateRequired: boolean;
  bots: Map<string, WireBot>;
  devices: Map<string, WireDevice>;
  chats: Map<string, WireChat>;
  turns: Map<string, WireTurn>;
  messageActivityBoundaries: Map<string, string>;
  activityBoundaries: Map<string, number>;
  legacyRunning: Set<string>;
}
export function emptyModel(): Model {
  return {
    version: "",
    hasIdentity: false,
    identityId: null,
    relayConnected: false,
    updateRequired: false,
    bots: new Map(),
    devices: new Map(),
    chats: new Map(),
    turns: new Map(),
    messageActivityBoundaries: new Map(),
    activityBoundaries: new Map(),
    legacyRunning: new Set(),
  };
}
export function upsertMessage(
  messages: WireMessage[],
  message: WireMessage,
): WireMessage[] {
  const index = messages.findIndex((m) => m.id === message.id);
  if (index < 0) return [...messages, message];
  return messages.map((m, i) => (i === index ? message : m));
}
export function applySnapshot(model: Model, snapshot: WireSnapshot): Model {
  const chats = new Map<string, WireChat>();
  for (const incoming of snapshot.chats) {
    const previous = model.identityId === (snapshot.identity_id ?? null)
      ? model.chats.get(incoming.id)
      : undefined;
    const oldest = incoming.messages[0];
    const firstIndex =
      previous && oldest
        ? previous.messages.findIndex((m) => m.id === oldest.id)
        : -1;
    const older =
      previous && incoming.has_more && firstIndex > 0
        ? previous.messages.slice(0, firstIndex)
        : [];
    chats.set(incoming.id, {
      ...incoming,
      messages: [...older, ...incoming.messages],
      has_more: older.length ? previous!.has_more : incoming.has_more,
    });
  }
  const retainedMessages = new Set([...chats.values()].flatMap(chat => chat.messages.map(message => `${chat.id}:${message.id}`)));
  return {
    version: snapshot.version,
    hasIdentity: snapshot.has_identity,
    identityId: snapshot.identity_id ?? null,
    relayConnected: snapshot.relay_connected,
    updateRequired: snapshot.relay_update_required,
    bots: new Map(snapshot.bots.map((b) => [b.id, b])),
    devices: new Map(snapshot.devices.map(device => [device.id, device])),
    chats,
    turns: new Map(snapshot.running_turns.map((t) => [t.job_id, t])),
    messageActivityBoundaries: model.identityId === (snapshot.identity_id ?? null)
      ? new Map([...model.messageActivityBoundaries].filter(([key]) => retainedMessages.has(key)))
      : new Map(),
    activityBoundaries: new Map([...chats.keys()].map(id => [id, (model.identityId === (snapshot.identity_id ?? null) ? model.activityBoundaries.get(id) ?? 0 : 0) + 1])),
    legacyRunning: new Set(
      snapshot.running_turns.length ? [] : snapshot.running_chat_ids,
    ),
  };
}
function observeToolBoundary(model: Model, event: WireEvent): Model {
  if (event.event !== "message.added" || event.data.message.body.kind !== "tool" || !model.chats.has(event.data.chat_id)) return model;
  const key = `${event.data.chat_id}:${event.data.message.id}`;
  const boundary = model.activityBoundaries.get(event.data.chat_id);
  if (boundary === undefined || model.messageActivityBoundaries.has(key)) return model;
  return { ...model, messageActivityBoundaries: new Map(model.messageActivityBoundaries).set(key, `observed:${boundary}`) };
}
export function applyEvent(model: Model, event: WireEvent): Model {
  model = observeToolBoundary(model, event);
  if (event.event === "snapshot") return applySnapshot(model, event.data);
  if (event.event === "ignored") return model;
  const next = {
    ...model,
    chats: new Map(model.chats),
    turns: new Map(model.turns),
    messageActivityBoundaries: new Map(model.messageActivityBoundaries),
    activityBoundaries: new Map(model.activityBoundaries),
    legacyRunning: new Set(model.legacyRunning),
  };
  switch (event.event) {
    case "roster.changed": {
      next.bots = new Map(event.data.bots.map((b) => [b.id, b]));
      if (event.data.devices !== undefined) next.devices = new Map(event.data.devices.map(device => [device.id, device]));
      next.chats = new Map(
        event.data.chats.map((chat) => {
          const existing = model.chats.get(chat.id);
          return [
            chat.id,
            {
              ...chat,
              messages: existing?.messages ?? [],
              has_more: existing?.has_more ?? false,
            },
          ];
        }),
      );
      break;
    }
    case "message.added":
    case "message.updated": {
      const chat = next.chats.get(event.data.chat_id);
      if (chat)
        next.chats.set(chat.id, {
          ...chat,
          messages: upsertMessage(chat.messages, event.data.message),
        });
      break;
    }
    case "message.removed": {
      next.messageActivityBoundaries.delete(`${event.data.chat_id}:${event.data.message_id}`);
      const chat = next.chats.get(event.data.chat_id);
      if (chat)
        next.chats.set(chat.id, {
          ...chat,
          messages: chat.messages.filter((m) => m.id !== event.data.message_id),
        });
      break;
    }
    case "chat.removed": {
      next.activityBoundaries.delete(event.data.chat_id);
      for (const message of next.chats.get(event.data.chat_id)?.messages ?? []) next.messageActivityBoundaries.delete(`${event.data.chat_id}:${message.id}`);
      next.chats.delete(event.data.chat_id);
      for (const [id, turn] of next.turns)
        if (turn.chat_id === event.data.chat_id) next.turns.delete(id);
      next.legacyRunning.delete(event.data.chat_id);
      break;
    }
    case "job.started":
      next.activityBoundaries.set(event.data.chat_id, (next.activityBoundaries.get(event.data.chat_id) ?? 0) + 1);
      next.turns.set(event.data.job_id, event.data);
      next.legacyRunning.delete(event.data.chat_id);
      break;
    case "job.finished":
      next.activityBoundaries.set(event.data.chat_id, (next.activityBoundaries.get(event.data.chat_id) ?? 0) + 1);
      next.turns.delete(event.data.job_id);
      next.legacyRunning.delete(event.data.chat_id);
      break;
    case "relay.status":
      next.relayConnected = event.data.connected;
      next.updateRequired = event.data.update_required;
      break;
    case "identity.changed":
      next.devices = new Map();
      next.hasIdentity = event.data.has_identity;
      break;
  }
  return next;
}
export function appendOlder(
  model: Model,
  chatId: string,
  messages: WireMessage[],
  hasMore: boolean,
): Model {
  const chat = model.chats.get(chatId);
  if (!chat) return model;
  const ids = new Set(chat.messages.map((m) => m.id));
  const chats = new Map(model.chats);
  chats.set(chatId, {
    ...chat,
    messages: [...messages.filter((m) => !ids.has(m.id)), ...chat.messages],
    has_more: hasMore,
  });
  return { ...model, chats };
}
export function isRunning(model: Model, chatId: string): boolean {
  return (
    model.legacyRunning.has(chatId) ||
    [...model.turns.values()].some((turn) => turn.chat_id === chatId)
  );
}

export function applyBufferedEvent(model: Model, event: WireEvent): Model {
  model = observeToolBoundary(model, event);
  if (event.event === "snapshot" && model.identityId !== (event.data.identity_id ?? null)) return model;
  if(event.event==="message.added"||event.event==="message.updated"){
    const incoming=event.data.message;
    const existing=model.chats.get(event.data.chat_id)?.messages.find(m=>m.id===incoming.id);
    if(existing){
      const terminal=(state:string)=>state==="complete"||state==="failed";
      if(terminal(existing.state)&&!terminal(incoming.state))return model;
      if(existing.body.kind==="permission"&&incoming.body.kind==="permission"&&existing.body.decision!=="pending"&&incoming.body.decision==="pending")return model;
      if(existing.body.kind==="tool"&&incoming.body.kind==="tool"&&!existing.body.is_running&&incoming.body.is_running)return model;
      if(existing.body.kind==="text"&&incoming.body.kind==="text"&&existing.body.text.length>incoming.body.text.length&&existing.body.text.startsWith(incoming.body.text))return model;
    }
  }
  return applyEvent(model,event);
}
