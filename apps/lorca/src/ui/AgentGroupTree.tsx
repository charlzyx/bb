import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { Avatar, ConversationAvatars } from "./Avatar";
import {
  AGENT_GROUP_LIMITS,
  agentGroupEntityKey,
  assignAgentGroup,
  createAgentGroup,
  deleteAgentGroup,
  loadAgentGroups,
  projectAgentGroups,
  renameAgentGroup,
  saveAgentGroups,
  setAgentGroupCollapsed,
  setAgentGroupPrimary,
  type AgentGroup,
  type AgentGroupsMutation,
  type AgentGroupsState,
  type AgentGroupsStorage,
} from "./agent-groups";
import type { LorcaAgent, LorcaConversation } from "./types";

type GroupEntity =
  | { kind: "bot"; id: string; label: string; agent: LorcaAgent }
  | { kind: "chat"; id: string; label: string; conversation: LorcaConversation };
export interface AgentGroupTreeProps {
  namespace?: string;
  agents: readonly LorcaAgent[];
  conversations?: readonly LorcaConversation[];
  search?: string;
  selectedAgentId?: string | null;
  selectedConversationId?: string | null;
  onSelectAgent: (id: string) => void;
  onSelectConversation?: (id: string) => void;
  storage?: AgentGroupsStorage;
}

type Commit = (change: AgentGroupsMutation, focusAgent?: string) => string | null;

function EditGroupPopover({ state, group, disabled, commit, onDeleted }: {
  state: AgentGroupsState;
  group?: AgentGroup;
  disabled: boolean;
  commit: Commit;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(group?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleted = useRef(false);
  const inputId = useId();
  const titleId = useId();
  const label = group ? `管理分组 ${group.name}` : "创建分组";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = group ? renameAgentGroup(state, group.id, name) : createAgentGroup(state, crypto.randomUUID(), name);
    const failure = commit(result);
    setError(failure);
    if (!failure) setOpen(false);
  };
  return <Popover modal={false} open={open} onOpenChange={(value) => {
    if (value) { setName(group?.name ?? ""); setError(null); setConfirmDelete(false); deleted.current = false; }
    setOpen(value);
  }}>
    <PopoverTrigger asChild>
      <Button type="button" size="icon" variant="ghost" className="lorca-agent-group-action" disabled={disabled} aria-label={label} data-group-create={group ? undefined : ""}>
        <Icon name={group ? "MoreHorizontal" : "Plus"} />
      </Button>
    </PopoverTrigger>
    <PopoverContent className="lorca-agent-group-popover" align="start" sideOffset={6} collisionPadding={12} aria-labelledby={titleId} mobileTitle={label} onCloseAutoFocus={(event) => {
      if (deleted.current) event.preventDefault();
    }}>
      <h3 id={titleId}>{confirmDelete ? "删除本地分组？" : group ? "编辑分组" : "创建分组"}</h3>
      {confirmDelete && group ? <>
        <p>删除“{group.name}”后，成员会回到未分组。智能体和聊天不会删除。</p>
        <div className="lorca-agent-group-form-actions">
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>取消</Button>
          <Button type="button" variant="destructive" size="sm" onClick={() => {
            const failure = commit(deleteAgentGroup(state, group.id));
            setError(failure);
            if (!failure) { deleted.current = true; setOpen(false); onDeleted(); }
          }}>删除分组</Button>
        </div>
      </> : <form onSubmit={submit}>
        <label htmlFor={inputId}>分组名称</label>
        <Input id={inputId} value={name} maxLength={AGENT_GROUP_LIMITS.nameLength} placeholder="例如：日常工作" onChange={(event) => { setName(event.target.value); setError(null); }} aria-invalid={Boolean(error)} />
        <p>仅整理本地列表，不创建群聊或团队，也不更改权限。</p>
        <div className="lorca-agent-group-form-actions">
          {group && <Button type="button" variant="ghost" size="sm" className="lorca-agent-group-delete" onClick={() => { setConfirmDelete(true); setError(null); }}>删除分组…</Button>}
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>取消</Button>
          <Button type="submit" size="sm" disabled={!name.trim()}>{group ? "保存" : "创建"}</Button>
        </div>
      </form>}
      {error && <p className="lorca-agent-group-error" role="alert">{error}</p>}
    </PopoverContent>
  </Popover>;
}

function EditMemberPopover({ entity, entities, state, disabled, commit }: {
  entity: GroupEntity;
  entities: readonly GroupEntity[];
  state: AgentGroupsState;
  disabled: boolean;
  commit: Commit;
}) {
  const key = agentGroupEntityKey(entity);
  const currentGroup = state.groups.find((group) => group.memberIds.some((member) => agentGroupEntityKey(member) === key));
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState(currentGroup?.id ?? "");
  const [primary, setPrimary] = useState(entity.kind === "bot" && (currentGroup?.primaryIds.includes(entity.id) ?? false));
  const [error, setError] = useState<string | null>(null);
  const applied = useRef(false);
  const selectId = useId();
  const primaryId = useId();
  const titleId = useId();
  const known = new Set(entities.filter((item) => item.kind === "bot").map((item) => item.id));
  const target = state.groups.find((group) => group.id === groupId);
  const others = target?.primaryIds.filter((id) => id !== entity.id && known.has(id)) ?? [];
  const limitReached = others.length >= AGENT_GROUP_LIMITS.primaryPerGroup;
  const label = `整理${entity.kind === "bot" ? "智能体" : "群聊"} ${entity.label}`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    let result = assignAgentGroup(state, { kind: entity.kind, id: entity.id }, groupId || null);
    if (result.ok && groupId && entity.kind === "bot") result = setAgentGroupPrimary(result.state, groupId, primary ? [...others, entity.id] : others);
    const failure = commit(result, key);
    setError(failure);
    if (!failure) { applied.current = true; setOpen(false); }
  };
  return <Popover modal={false} open={open} onOpenChange={(value) => {
    if (value) { setGroupId(currentGroup?.id ?? ""); setPrimary(entity.kind === "bot" && (currentGroup?.primaryIds.includes(entity.id) ?? false)); setError(null); applied.current = false; }
    setOpen(value);
  }}>
    <PopoverTrigger asChild>
      <Button type="button" size="icon" variant="ghost" className="lorca-agent-group-action" disabled={disabled} aria-label={label}><Icon name="MoreHorizontal" /></Button>
    </PopoverTrigger>
    <PopoverContent className="lorca-agent-group-popover" align="start" sideOffset={6} collisionPadding={12} aria-labelledby={titleId} mobileTitle={label} onCloseAutoFocus={(event) => {
      if (applied.current) event.preventDefault();
    }}>
      <h3 id={titleId} className="lorca-agent-group-editor-title">{entity.kind === "bot" ? <Avatar appearance={entity.agent.appearance} /> : <ConversationAvatars avatars={entity.conversation.avatars} />}<span>{entity.label}</span></h3>
      <form onSubmit={submit}>
        <label htmlFor={selectId}>所属分组</label>
        <select id={selectId} value={groupId} onChange={(event) => { setGroupId(event.target.value); setPrimary(false); setError(null); }}>
          <option value="">未分组</option>
          {state.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
        {entity.kind === "bot" ? <><label className="lorca-agent-primary-control" htmlFor={primaryId}>
          <input id={primaryId} type="checkbox" checked={primary} disabled={!target || (limitReached && !primary)} onChange={(event) => { setPrimary(event.target.checked); setError(null); }} />
          <span>标记为组内主力</span>
        </label>
        <p>{!target ? "先选择分组，再设置主力。" : limitReached && !primary ? "该组已有 2 位主力，请先取消一位后再设置。" : "每组最多 2 位主力，仅作视觉标记，不会自动调度或赋予权限。"}</p></> : <p>仅调整已有群聊的本地分类，不更改群成员或创建聊天。主力标记只用于智能体。</p>}
        <div className="lorca-agent-group-form-actions">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>取消</Button>
          <Button type="submit" size="sm">保存</Button>
        </div>
      </form>
      {error && <p className="lorca-agent-group-error" role="alert">{error}</p>}
    </PopoverContent>
  </Popover>;
}

export function AgentGroupTree(props: AgentGroupTreeProps) {
  return <AgentGroupTreeSession key={JSON.stringify(props.namespace ?? null)} {...props} />;
}

function AgentGroupTreeSession({ namespace, agents, conversations = [], search = "", selectedAgentId, selectedConversationId, onSelectAgent, onSelectConversation, storage }: AgentGroupTreeProps) {
  const [loaded] = useState(() => loadAgentGroups(namespace, storage));
  const [state, setState] = useState(loaded.state);
  const [error, setError] = useState<string | null>(loaded.ok ? null : loaded.message);
  const root = useRef<HTMLElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const instance = useId();
  const editable = Boolean(namespace) && (loaded.ok || loaded.error !== "missing-account");
  const searching = Boolean(search.trim());
  const entities: GroupEntity[] = [
    ...agents.map((agent) => ({ kind: "bot" as const, id: agent.id, label: agent.label, agent })),
    ...conversations.filter((conversation) => conversation.kind === "group").map((conversation) => ({ kind: "chat" as const, id: conversation.id, label: conversation.title || "未命名群聊", conversation })),
  ];
  const selectedGroup = conversations.some((conversation) => conversation.id === selectedConversationId && conversation.kind === "group");
  const projected = projectAgentGroups(state, entities, search);
  const focusCreate = () => root.current?.querySelector<HTMLButtonElement>("[data-group-create]")?.focus({ preventScroll: true });
  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const id = pendingFocus.current;
    pendingFocus.current = null;
    const button = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-group-select]") ?? []).find((item) => item.dataset.groupSelect === id);
    if (button) button.focus({ preventScroll: true });
    else focusCreate();
  }, [state]);
  const commit: Commit = (change, focusAgent) => {
    if (!change.ok) { setError(change.message); return change.message; }
    const saved = saveAgentGroups(namespace, change.state, storage);
    if (!saved.ok) { setError(saved.message); return saved.message; }
    pendingFocus.current = focusAgent ?? null;
    setState(change.state);
    setError(null);
    return null;
  };
  const renderEntity = (entity: GroupEntity, primary = false) => {
    const status = entity.kind === "bot" ? entity.agent.status : entity.conversation.status === "idle" ? undefined : entity.conversation.status;
    const selected = entity.kind === "bot" ? !selectedGroup && selectedAgentId === entity.id : selectedConversationId === entity.id;
    return <li key={agentGroupEntityKey(entity)} className="lorca-agent-group-member" data-group-member={agentGroupEntityKey(entity)}>
    <button type="button" className="lorca-agent-group-select" data-group-select={agentGroupEntityKey(entity)} data-agent-select={entity.kind === "bot" ? entity.id : undefined} data-group-chat-select={entity.kind === "chat" ? entity.id : undefined} disabled={entity.kind === "chat" && !onSelectConversation} aria-current={selected ? "page" : undefined} onClick={() => entity.kind === "bot" ? onSelectAgent(entity.id) : onSelectConversation?.(entity.id)}>
      {entity.kind === "bot" ? <Avatar appearance={entity.agent.appearance} /> : <ConversationAvatars avatars={entity.conversation.avatars} />}
      <span className="lorca-agent-group-name" title={entity.label}>{entity.label}</span>
      {entity.kind === "chat" && <span className="lorca-agent-group-chat-label">群聊</span>}
      {primary && <span className="lorca-agent-primary" title="主力仅作本地视觉标记">主力</span>}
      {status && <span className={`lorca-agent-status lorca-agent-status-${status}`} role="img" aria-label={status === "running" ? "运行中" : status === "waiting" ? "等待审批" : "对话有错误"} title={status === "running" ? "运行中" : status === "waiting" ? "等待审批" : "对话有错误"} />}
    </button>
    <EditMemberPopover entity={entity} entities={entities} state={state} disabled={!editable} commit={commit} />
  </li>;
  };
  return <section ref={root} className="lorca-agent-groups" aria-label="智能体与群聊分组">
    <div className="lorca-agent-groups-heading"><h2>分组</h2><EditGroupPopover state={state} disabled={!editable} commit={commit} onDeleted={focusCreate} /></div>
    {error && <p className="lorca-agent-group-storage-notice" role={editable ? "alert" : "status"}>{error}</p>}
    {projected.groups.map((group, index) => {
      const contentId = `${instance}-group-${index}`;
      return <section key={group.id} className="lorca-agent-group" data-agent-group={group.id}>
        <div className="lorca-agent-group-heading">
          <button type="button" className="lorca-agent-group-toggle" aria-expanded={group.showMembers} aria-controls={contentId} disabled={searching} title={searching ? "搜索时自动展开匹配分组" : group.name} onClick={() => commit(setAgentGroupCollapsed(state, group.id, !group.collapsed))}>
            <Icon name="ChevronRight" />
            <span className="lorca-agent-group-name">{group.name}</span>
            <span className="lorca-agent-group-count" aria-label={`${group.totalMembers} 个项目`}>{group.totalMembers}</span>
          </button>
          <EditGroupPopover state={state} group={group} disabled={!editable} commit={commit} onDeleted={focusCreate} />
        </div>
        {group.showMembers && <div id={contentId} className="lorca-agent-group-members">
          {!group.primaryIds.length && <p className="lorca-agent-primary-empty">未设主力智能体</p>}
          {group.members.length ? <ul>{group.members.map((entity) => renderEntity(entity, entity.kind === "bot" && group.primaryIds.includes(entity.id)))}</ul> : <p className="lorca-agent-group-empty">还没有成员，可从智能体或群聊菜单调整归属。</p>}
        </div>}
      </section>;
    })}
    {projected.ungrouped.length > 0 && <section className="lorca-agent-ungrouped" aria-label="未分组项目">
      <h3>未分组<span className="lorca-agent-group-count">{projected.ungrouped.length}</span></h3>
      <ul>{projected.ungrouped.map((entity) => renderEntity(entity))}</ul>
    </section>}
    {!projected.groups.length && !projected.ungrouped.length && <p className="lorca-agent-group-empty">{searching ? "没有匹配的分组、智能体或群聊。" : "当前账号还没有智能体或群聊。"}</p>}
    <p className="lorca-agent-groups-local-note">分组与主力标记仅用于本地整理</p>
  </section>;
}
