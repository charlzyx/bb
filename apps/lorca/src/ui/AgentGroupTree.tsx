import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
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
import { createAgentGroupDragSession } from "./agent-group-drag";
import type { LorcaAgent, LorcaConversation } from "./types";

type GroupEntity =
  | { kind: "bot"; id: string; label: string; agent: LorcaAgent }
  | { kind: "chat"; id: string; label: string; conversation: LorcaConversation };
export interface AgentGroupTreeProps {
  hasOtherSearchResults?: boolean;
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

type Commit = (change: AgentGroupsMutation, focusAgent?: string, focusGroup?: string) => string | null;

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

function GroupDestinationPicker({ id, groups, value, onChange, disabled }: {
  id: string;
  groups: readonly AgentGroup[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const title = useId();
  const options = [{ id: "", name: "未分组" }, ...groups];
  const filtered = options.filter(option => option.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const choose = (id: string) => { if (id !== value) onChange(id); setOpen(false); };
  return <Popover open={open && !disabled} onOpenChange={(next) => { setOpen(next); if (next) setQuery(""); }} modal={false}>
    <PopoverTrigger asChild>
      <button id={id} type="button" className="lorca-group-destination-trigger" aria-label="所属分组" disabled={disabled} onKeyDown={(event) => { if ((event.nativeEvent.isComposing || event.keyCode === 229) && (event.key === "Enter" || event.key === " ")) event.preventDefault(); }}>
        <span>{options.find(option => option.id === value)?.name ?? "未分组"}</span><Icon name="ChevronDown" />
      </button>
    </PopoverTrigger>
    <PopoverContent className="lorca-group-destination-popover" align="start" sideOffset={6} collisionPadding={12} aria-labelledby={title} mobileTitle="所属分组" onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}>
      <h3 id={title} className="sr-only">所属分组</h3>
      <div className="lorca-group-destination-search"><Icon name="Search" /><input ref={input} type="search" aria-label="搜索分组" placeholder="搜索分组…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "ArrowDown") { event.preventDefault(); list.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
        if (event.key === "Enter") { event.preventDefault(); if (filtered.length === 1) choose(filtered[0].id); }
      }} /></div>
      <div ref={list} role="group" aria-label="分组选项" className="lorca-group-destination-options" onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.altKey && !event.metaKey) {
          event.preventDefault(); setQuery(event.key); input.current?.focus(); return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        const index = buttons.findIndex(button => button === event.target);
        if (index < 0) return;
        event.preventDefault();
        if (event.key === "ArrowUp" && index === 0) { input.current?.focus(); return; }
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
        buttons[next]?.focus();
      }}>
        {filtered.map(option => <button type="button" key={option.id} data-group-destination={option.id} aria-pressed={value === option.id} onClick={() => choose(option.id)}><span>{option.name}</span>{value === option.id && <Icon name="Check" />}</button>)}
        {!filtered.length && <p role="status">没有匹配的分组</p>}
      </div>
    </PopoverContent>
  </Popover>;
}

function GroupName({ group, state, disabled, commit }: { group: AgentGroup; state: AgentGroupsState; disabled: boolean; commit: Commit }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (editing) { input.current?.focus(); input.current?.select(); }
    else if (restoreFocus.current) { restoreFocus.current = false; button.current?.focus({ preventScroll: true }); }
  }, [editing]);
  const begin = () => { if (!disabled) { setName(group.name); setEditing(true); } };
  if (editing) return <Input ref={input} className="lorca-agent-group-rename" aria-label={`重命名分组 ${group.name}`} value={name} maxLength={AGENT_GROUP_LIMITS.nameLength} onChange={(event) => setName(event.target.value)} onBlur={() => setEditing(false)} onKeyDown={(event) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); restoreFocus.current = true; setEditing(false); }
    if (event.key === "Enter") {
      event.preventDefault();
      const failure = commit(renameAgentGroup(state, group.id, name), undefined, group.id);
      if (!failure) { restoreFocus.current = true; setEditing(false); }
    }
  }} />;
  return <button ref={button} type="button" className="lorca-agent-group-title lorca-agent-group-name" data-group-name={group.id} aria-label={`重命名分组 ${group.name}`} title="双击重命名，或按 Enter / F2" disabled={disabled} onDoubleClick={begin} onClick={(event) => { if (event.detail === 0) begin(); }} onKeyDown={(event) => { if (event.key === "F2" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); begin(); } }}>{group.name}</button>;
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
  const label = `整理${entity.kind === "bot" ? "智能体" : "群聊"} ${entity.label}`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    let result = assignAgentGroup(state, { kind: entity.kind, id: entity.id }, groupId || null);
    if (result.ok && groupId && entity.kind === "bot") result = setAgentGroupPrimary(result.state, groupId, primary ? [entity.id] : others);
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
        <GroupDestinationPicker id={selectId} groups={state.groups} value={groupId} disabled={disabled} onChange={(value) => { setGroupId(value); setPrimary(false); setError(null); }} />
        {entity.kind === "bot" ? <><label className="lorca-agent-primary-control" htmlFor={primaryId}>
          <input id={primaryId} type="checkbox" checked={primary} disabled={!target || disabled} onChange={(event) => { setPrimary(event.target.checked); setError(null); }} />
          <span>标记为组内主力</span>
        </label>
        <p>{!target ? "先选择分组，再设置主力。" : others.length ? "选为主力会替换本组原主力。每组 1 位，仅作视觉标记，不会自动调度或赋予权限。" : "每组可设 1 位主力，也可暂不设置。仅作视觉标记，不会自动调度或赋予权限。"}</p></> : <p>仅调整已有群聊的本地分类，不更改群成员或创建聊天。主力标记只用于智能体。</p>}
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

function AgentGroupTreeSession({ hasOtherSearchResults = false, namespace, agents, conversations = [], search = "", selectedAgentId, selectedConversationId, onSelectAgent, onSelectConversation, storage }: AgentGroupTreeProps) {
  const [loaded] = useState(() => loadAgentGroups(namespace, storage));
  const [state, setState] = useState(loaded.state);
  const [error, setError] = useState<string | null>(loaded.ok ? null : loaded.message);
  const root = useRef<HTMLElement>(null);
  const [drag] = useState(() => createAgentGroupDragSession(namespace));
  const [dropTarget, setDropTarget] = useState<string | undefined>(undefined);
  const draggedKind = useRef<"bot" | "chat" | undefined>(undefined);
  const [dropNotice, setDropNotice] = useState("");
  const suppressDragClick = useRef(false);
  useEffect(() => () => drag.dispose(), [drag]);
  const pendingFocus = useRef<string | null>(null);
  const pendingGroupFocus = useRef<string | null>(null);
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
    if (pendingGroupFocus.current !== null) {
      const id = pendingGroupFocus.current;
      pendingGroupFocus.current = null;
      const button = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-group-name]") ?? []).find(item => item.dataset.groupName === id);
      if (button) button.focus({ preventScroll: true });
      else focusCreate();
      return;
    }
    if (pendingFocus.current === null) return;
    const id = pendingFocus.current;
    pendingFocus.current = null;
    const button = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-group-select]") ?? []).find((item) => item.dataset.groupSelect === id);
    if (button) button.focus({ preventScroll: true });
    else focusCreate();
  }, [state]);
  const commit: Commit = (change, focusAgent, focusGroup) => {
    if (!change.ok) { setError(change.message); return change.message; }
    const saved = saveAgentGroups(namespace, change.state, storage);
    if (!saved.ok) { setError(saved.message); return saved.message; }
    pendingFocus.current = focusAgent ?? null;
    pendingGroupFocus.current = focusGroup ?? null;
    setState(change.state);
    setError(null);
    return null;
  };
  const dropProps = (targetGroupId: string | null, kind?: "bot" | "chat") => ({
    "data-group-drop-target": targetGroupId ?? `ungrouped-${kind}`,
    "data-drag-over": dropTarget === (targetGroupId ?? `ungrouped-${kind}`) || undefined,
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!editable || (kind && draggedKind.current !== kind) || !drag.canDrop(event.nativeEvent, { namespace, state, entities, targetGroupId })) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(targetGroupId ?? `ungrouped-${kind}`);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(undefined);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const result = editable && (!kind || draggedKind.current === kind) ? drag.drop(event.nativeEvent, { namespace, state, entities, targetGroupId }) : null;
      setDropTarget(undefined);
      if (!result) return;
      event.preventDefault();
      event.stopPropagation();
      if (!commit(result)) setDropNotice(`已移到${targetGroupId === null ? "未分组" : state.groups.find(group => group.id === targetGroupId)?.name ?? "分组"}，仅更新本地分类。`);
    },
  });
  const renderEntity = (entity: GroupEntity, primary = false) => {
    const status = entity.kind === "bot" ? entity.agent.status : entity.conversation.status === "idle" ? undefined : entity.conversation.status;
    const selected = entity.kind === "bot" ? !selectedGroup && selectedAgentId === entity.id : selectedConversationId === entity.id;
    return <li key={agentGroupEntityKey(entity)} className="lorca-agent-group-member" data-group-member={agentGroupEntityKey(entity)}>
    <button type="button" className="lorca-agent-group-select" draggable={editable} onDragStart={(event) => {
      if (drag.begin(event.nativeEvent, { kind: entity.kind, id: entity.id }, entities)) { suppressDragClick.current = true; draggedKind.current = entity.kind; }
      else event.preventDefault();
    }} onDragEnd={() => { drag.end(); draggedKind.current = undefined; setDropTarget(undefined); }} data-group-select={agentGroupEntityKey(entity)} data-agent-select={entity.kind === "bot" ? entity.id : undefined} data-group-chat-select={entity.kind === "chat" ? entity.id : undefined} disabled={entity.kind === "chat" && !onSelectConversation} aria-current={selected ? "page" : undefined} onPointerDown={() => { suppressDragClick.current = false; }} onKeyDown={(event) => {
      if (!event.nativeEvent.isComposing && event.keyCode !== 229 && (event.key === "Enter" || event.key === " ")) suppressDragClick.current = false;
    }} onClick={(event) => {
      if (suppressDragClick.current && !(event.nativeEvent.isTrusted && event.detail === 0)) { event.preventDefault(); return; }
      if (entity.kind === "bot") onSelectAgent(entity.id);
      else onSelectConversation?.(entity.id);
    }}>
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
    <div className="lorca-agent-groups-heading"><h2>团队</h2><EditGroupPopover state={state} disabled={!editable} commit={commit} onDeleted={focusCreate} /></div>
    <span className="sr-only" role="status">{dropNotice}</span>
    {error && <p className="lorca-agent-group-storage-notice" role={editable ? "alert" : "status"}>{error}</p>}
    {projected.groups.map((group, index) => {
      const contentId = `${instance}-group-${index}`;
      const primary = group.primaries.find(entity => entity.kind === "bot");
      return <section key={group.id} className="lorca-agent-group" data-agent-group={group.id} {...dropProps(group.id)}>
        <div className="lorca-agent-group-heading">
          <span className="lorca-agent-group-lead" data-group-primary={primary?.id} title={primary ? `主力：${primary.label}` : "未设主力智能体"}><Avatar appearance={primary?.kind === "bot" ? primary.agent.appearance : undefined} /></span>
          <GroupName group={group} state={state} disabled={!editable} commit={commit} />
          <span className="lorca-agent-group-count" aria-label={`${group.totalMembers} 个项目`}>{group.totalMembers}</span>
          <button type="button" className="lorca-agent-group-toggle" aria-label={`${group.showMembers ? "折叠" : "展开"}分组 ${group.name}`} aria-expanded={group.showMembers} aria-controls={contentId} disabled={searching} title={searching ? "搜索时自动展开匹配分组" : group.name} onClick={() => commit(setAgentGroupCollapsed(state, group.id, !group.collapsed))}>
            <Icon name="ChevronRight" />
          </button>
          <EditGroupPopover state={state} group={group} disabled={!editable} commit={commit} onDeleted={focusCreate} />
        </div>
        {group.showMembers && <div id={contentId} className="lorca-agent-group-members">
          {!group.primaryIds.length && <p className="lorca-agent-primary-empty">未设主力智能体</p>}
          {group.members.length ? <ul>{group.members.map((entity) => renderEntity(entity, entity.kind === "bot" && group.primaryIds.includes(entity.id)))}</ul> : <p className="lorca-agent-group-empty">还没有成员，可从智能体或群聊菜单调整归属。</p>}
        </div>}
      </section>;
    })}
    {(projected.ungrouped.some(entity => entity.kind === "chat") || (editable && !searching)) && <section className="lorca-agent-ungrouped-chats" aria-label="未分组群聊" {...dropProps(null, "chat")}>
      <h3>未分组群聊<span className="lorca-agent-group-count">{projected.ungrouped.filter(entity => entity.kind === "chat").length}</span></h3>
      <ul>{projected.ungrouped.filter(entity => entity.kind === "chat").map(entity => renderEntity(entity))}</ul>
      {!projected.ungrouped.some(entity => entity.kind === "chat") && <p className="lorca-agent-group-empty">可将群聊拖到这里解除分类。</p>}
    </section>}
    {(projected.ungrouped.some(entity => entity.kind === "bot") || (editable && !searching)) && <section className="lorca-agent-ungrouped" aria-label="未分组智能体" {...dropProps(null, "bot")}>
      <h3>Solo<span className="lorca-agent-group-count">{projected.ungrouped.filter(entity => entity.kind === "bot").length}</span></h3>
      <ul>{projected.ungrouped.filter(entity => entity.kind === "bot").map(entity => renderEntity(entity))}</ul>
      {!projected.ungrouped.some(entity => entity.kind === "bot") && <p className="lorca-agent-group-empty">可将智能体拖到这里解除分类。</p>}
    </section>}
    {!hasOtherSearchResults && !projected.groups.length && !projected.ungrouped.length && <p className="lorca-agent-group-empty">{searching ? "没有匹配的分组、智能体或群聊。" : "当前账号还没有智能体或群聊。"}</p>}
    <p className="lorca-agent-groups-local-note">分组与主力标记仅用于本地整理</p>
  </section>;
}
