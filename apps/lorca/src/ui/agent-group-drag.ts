import { agentGroupEntityKey, assignAgentGroup, parseAgentGroups, type AgentGroupEntityId, type AgentGroupsMutation, type AgentGroupsState } from "./agent-groups";

export const AGENT_GROUP_DRAG_MIME = "application/x-dots-group-entity";

export interface AgentGroupDragContext {
  namespace: string | null | undefined;
  state: AgentGroupsState;
  entities: readonly AgentGroupEntityId[];
  targetGroupId: string | null | undefined;
}

interface DragTransfer {
  readonly types: readonly string[];
  readonly files?: { readonly length: number };
  effectAllowed: string;
  getData(type: string): string;
  setData(type: string, value: string): void;
}
interface GroupDragEvent {
  readonly type: string;
  readonly isTrusted: boolean;
  readonly dataTransfer: DragTransfer | null;
}

function validNamespace(value: string | null | undefined): value is string {
  if (typeof value !== "string" || !value.length || value.length > 512 || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value) || /^(anonymous|unknown|null|undefined)$/i.test(value)) return false;
  try { encodeURIComponent(value); return true; } catch { return false; }
}
const validRef = (value: AgentGroupEntityId): boolean => Boolean(value && (value.kind === "bot" || value.kind === "chat") && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 256 && value.id === value.id.trim() && !/[\x00-\x1f\x7f]/.test(value.id) && Object.keys(value).length === 2 && Object.hasOwn(value, "kind") && Object.hasOwn(value, "id"));
const hasEntity = (entities: readonly AgentGroupEntityId[], entity: AgentGroupEntityId): boolean => entities.some(current => current.kind === entity.kind && current.id === entity.id);
const fileTransfer = (transfer: DragTransfer): boolean => Array.from(transfer.types).includes("Files") || Boolean(transfer.files?.length);

export function createAgentGroupDragSession(namespace: string | null | undefined, { now = Date.now, randomToken = () => globalThis.crypto.randomUUID() }: { now?: () => number; randomToken?: () => string } = {}) {
  let disposed = false;
  let active: { token: string; entity: AgentGroupEntityId; startedAt: number } | null = null;
  let sequence = 0;
  function end() { active = null; }
  function usable(context: AgentGroupDragContext): boolean {
    if (disposed || !validNamespace(namespace) || context.namespace !== namespace || !active || now() < active.startedAt || now() - active.startedAt > 60_000 || !hasEntity(context.entities, active.entity)) {
      end();
      return false;
    }
    return true;
  }
  function target(context: AgentGroupDragContext): AgentGroupsState | null {
    if (context.targetGroupId === undefined) return null;
    const parsed = parseAgentGroups(context.state);
    return parsed && (context.targetGroupId === null || parsed.groups.some(group => group.id === context.targetGroupId)) ? parsed : null;
  }
  function internal(event: GroupDragEvent, types: readonly string[]): boolean {
    return event.isTrusted && types.includes(event.type) && Boolean(event.dataTransfer && !fileTransfer(event.dataTransfer) && Array.from(event.dataTransfer.types).includes(AGENT_GROUP_DRAG_MIME));
  }
  return {
    begin(event: GroupDragEvent, entity: AgentGroupEntityId, entities: readonly AgentGroupEntityId[]): boolean {
      end();
      if (disposed || !validNamespace(namespace) || !event.isTrusted || event.type !== "dragstart" || !event.dataTransfer || fileTransfer(event.dataTransfer) || !validRef(entity) || !hasEntity(entities, entity)) return false;
      try {
        const random = randomToken();
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(random) || !Number.isSafeInteger(sequence + 1)) return false;
        const token = `${random}:${++sequence}`;
        event.dataTransfer.setData(AGENT_GROUP_DRAG_MIME, token);
        event.dataTransfer.effectAllowed = "move";
        active = { token, entity: { kind: entity.kind, id: entity.id }, startedAt: now() };
        return true;
      } catch { return false; }
    },
    canDrop(event: GroupDragEvent, context: AgentGroupDragContext): boolean {
      return usable(context) && internal(event, ["dragenter", "dragover"]) && target(context) !== null;
    },
    drop(event: GroupDragEvent, context: AgentGroupDragContext): AgentGroupsMutation | null {
      if (!usable(context) || !internal(event, ["drop"]) || !active) return null;
      let token: string;
      try { token = event.dataTransfer!.getData(AGENT_GROUP_DRAG_MIME); } catch { return null; }
      if (token !== active.token) return null;
      const entity = active.entity;
      end();
      const parsed = target(context);
      if (!parsed) return null;
      const current = parsed.groups.find(group => group.memberIds.some(member => agentGroupEntityKey(member) === agentGroupEntityKey(entity)))?.id ?? null;
      if (current === context.targetGroupId) return null;
      return assignAgentGroup(parsed, entity, context.targetGroupId!);
    },
    end,
    dispose() { disposed = true; end(); },
  };
}
