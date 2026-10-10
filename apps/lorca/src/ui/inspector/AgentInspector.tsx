import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Avatar } from "../Avatar";
import { CapabilitiesPanel } from "./CapabilitiesPanel";
import type { AgentDetailsSnapshot, AgentInspectorProps, AgentInspectorResult, AgentProfile, AgentProfilePatch } from "./types";

interface ProfileDraft {
  name: string;
  description: string;
  provider: string;
  model: string;
  thinking: string;
  runnerId: string;
}

const thinkingLabels: Record<string, string> = { none: "关闭", off: "关闭", minimal: "最低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高", auto: "自动" };

export function agentNativeOutcomeMessage(result: AgentInspectorResult | void): string | null {
  if (!result) return null;
  return result.status === "applied" ? "更改已应用。" : result.status === "cancelled" ? "已取消操作。" : "结果尚不确定，请刷新核对；操作未自动重发。";
}

function draftFor(bot: AgentProfile): ProfileDraft {
  return { name: bot.name, description: bot.description, provider: bot.provider ?? "", model: bot.model ?? "", thinking: bot.thinking ?? "", runnerId: bot.runnerId };
}

export function agentProfilePatch(bot: AgentProfile, draft: ProfileDraft): AgentProfilePatch {
  const original = draftFor(bot);
  const patch: AgentProfilePatch = {};
  for (const key of ["name", "description", "provider", "model", "thinking", "runnerId"] as const) if (draft[key] !== original[key]) patch[key] = draft[key];
  if (patch.provider !== undefined) { patch.model = draft.model; patch.thinking = draft.thinking; }
  if (patch.model !== undefined) patch.thinking = draft.thinking;
  return patch;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="lorca-inspector-section"><h3>{title}</h3><div className="lorca-inspector-section-body">{children}</div></section>;
}

function SelectField({ label, value, onChange, children, disabled = false }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; disabled?: boolean }) {
  const id = useId();
  return <div className="lorca-inspector-field"><label htmlFor={id}>{label}</label><div className="lorca-inspector-select"><select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{children}</select><Icon name="ChevronDown" /></div></div>;
}

function initialProfile(snapshot: AgentDetailsSnapshot): AgentProfile {
  return snapshot.bot ?? { id: "", name: "", description: "", symbolName: "sparkles", accent: "indigo", provider: snapshot.providers.find(provider => provider.connected)?.id ?? snapshot.providers[0]?.id ?? null, model: "", thinking: "", runnerId: "", hasAvatar: false, avatarVersion: null };
}

function ProfileEditor({ snapshot, disabled, onAction, onDirtyChange, discardSignal }: { snapshot: AgentDetailsSnapshot; disabled: boolean; onAction: AgentInspectorProps["onAction"]; onDirtyChange: (dirty: boolean) => void; discardSignal: number }) {
  const creating = snapshot.bot === null;
  const [baseline, setBaseline] = useState(snapshot);
  const [draft, setDraft] = useState(() => draftFor(initialProfile(snapshot)));
  const [discarded, setDiscarded] = useState(discardSignal);
  const [submittedRevision, setSubmittedRevision] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<"applied" | "cancelled" | "unknownOutcome" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const patch = agentProfilePatch(initialProfile(baseline), draft);
  const dirty = Object.keys(patch).length > 0;
  useEffect(() => { onDirtyChange(dirty || pending || result === "unknownOutcome"); }, [dirty, pending, result, onDirtyChange]);
  if (discarded !== discardSignal) { setDiscarded(discardSignal); setBaseline(snapshot); setDraft(draftFor(initialProfile(snapshot))); setError(null); setResult(null); }
  if (snapshot.revision !== baseline.revision && snapshot.version === baseline.version) setBaseline(snapshot);
  if (!pending && ((result === "applied" && snapshot.revision !== submittedRevision) || (snapshot.version !== baseline.version && result !== "unknownOutcome" && !dirty))) {
    setBaseline(snapshot); setDraft(draftFor(initialProfile(snapshot))); setResult(null);
  }
  const conflict = snapshot.version !== baseline.version;
  const blocked = disabled || pending || result === "unknownOutcome" || result === "applied" || conflict || !onAction || (creating && !snapshot.canCreate);
  const validCreate = !creating || (snapshot.runners.some(runner => runner.id === draft.runnerId) && snapshot.providers.some(provider => provider.id === draft.provider));
  const models = snapshot.models.filter(model => model.provider === draft.provider);
  const levels = models.find(model => model.id === draft.model)?.levels ?? [];
  const nameId = useId();
  const descriptionId = useId();
  const edit = (change: Partial<ProfileDraft>) => { setDraft(current => ({ ...current, ...change })); setError(null); setResult(null); };
  const adopt = () => { setBaseline(snapshot); setDraft(draftFor(initialProfile(snapshot))); setError(null); setResult(null); };
  const save = async () => {
    if (blocked || !dirty || !draft.name.trim() || !validCreate || !onAction || inFlight.current) return;
    inFlight.current = true;
    setPending(true); setError(null); setResult(null); setSubmittedRevision(baseline.revision);
    try { setResult((await onAction(creating ? { kind: "agent.create", revision: baseline.revision, profile: { ...draft } } : { kind: "profile.save", revision: baseline.revision, patch })).status); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "无法保存智能体资料，请核对当前配置后重试。"); }
    finally { inFlight.current = false; setPending(false); }
  };
  return <form className="lorca-inspector-profile" onSubmit={event => { event.preventDefault(); void save(); }}>
    <fieldset disabled={blocked}>
      <Section title="资料">
        <div className="lorca-inspector-field"><label htmlFor={nameId}>名称</label><Input id={nameId} value={draft.name} maxLength={256} onChange={event => edit({ name: event.target.value })} /></div>
        <div className="lorca-inspector-description"><label htmlFor={descriptionId}>描述</label><textarea id={descriptionId} value={draft.description} maxLength={20_000} rows={3} onChange={event => edit({ description: event.target.value })} /></div>
      </Section>
      <Section title="运行方式">
        <SelectField label="服务商" value={draft.provider} onChange={provider => edit({ provider, model: "", thinking: "" })}>
          {!snapshot.providers.some(provider => provider.id === draft.provider) && <option value={draft.provider} disabled>{draft.provider || "未报告"}</option>}
          {snapshot.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}{provider.connected ? "" : " · 未配置"}</option>)}
        </SelectField>
        <SelectField label="模型" value={draft.model} onChange={model => edit({ model, thinking: "" })}>
          <option value="">默认</option>
          {draft.model && !models.some(model => model.id === draft.model) && <option value={draft.model} disabled>{draft.model}</option>}
          {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </SelectField>
        <SelectField label="思考" value={draft.thinking} onChange={thinking => edit({ thinking })}>
          <option value="">默认</option>
          {draft.thinking && !levels.includes(draft.thinking) && <option value={draft.thinking} disabled>{thinkingLabels[draft.thinking] ?? draft.thinking}</option>}
          {levels.map(level => <option key={level} value={level}>{thinkingLabels[level] ?? level}</option>)}
        </SelectField>
        <SelectField label="Runner" value={draft.runnerId} onChange={runnerId => edit({ runnerId })}>
          {!snapshot.runners.some(runner => runner.id === draft.runnerId) && <option value={draft.runnerId} disabled>{draft.runnerId || "未分配"}</option>}
          {snapshot.runners.map(runner => <option key={runner.id} value={runner.id}>{runner.name}{runner.online ? "" : " · 离线"}</option>)}
        </SelectField>
      </Section>
    </fieldset>
    <p className="lorca-inspector-help">{creating ? "新建会创建智能体及其私聊，本次不发送消息。初始权限依后端默认配置，可能包含完整访问；提交前会展示原生确认。" : "资料和运行方式作用于所有使用此智能体的聊天。更换 Runner 不会迁移运行中的任务、文件或记忆。"}</p>
    {creating && !snapshot.runners.length && <p className="lorca-inspector-error" role="status">当前没有可用于创建智能体的 Runner。手机设备不能作为运行设备。</p>}
    {error && <p className="lorca-inspector-error" role="alert">{error}</p>}
    {result === "unknownOutcome" && <p className="lorca-inspector-error" role="alert">保存结果尚不确定。请先核对当前配置；操作未自动重发，草稿仍保留。</p>}
    {conflict && result !== "unknownOutcome" && <p className="lorca-inspector-error" role="alert">资料已在其他位置更改。请核对当前配置后再编辑，未覆盖现有配置。</p>}
    {result === "cancelled" && <p className="lorca-inspector-help" role="status">已取消保存，草稿仍保留。</p>}
    {result === "applied" && <p className="lorca-inspector-help" role="status">已提交，正在核对更新后的资料。</p>}
    {(creating || dirty || conflict || result === "unknownOutcome") && <div className="lorca-inspector-actions">
      <Button type="button" variant="ghost" disabled={disabled || pending || (result === "unknownOutcome" && snapshot.revision === submittedRevision)} onClick={adopt}>{conflict || result === "unknownOutcome" ? "放弃草稿并采用当前配置" : "取消"}</Button>
      <Button type="submit" disabled={blocked || !dirty || !draft.name.trim() || !validCreate}>{pending ? "保存中…" : creating ? "创建智能体" : "保存更改"}</Button>
    </div>}
  </form>;
}

export function AgentInspector(props: AgentInspectorProps) {
  return <AgentInspectorSession key={`${props.scope}:${props.agentId ?? "none"}`} {...props} />;
}

function AgentInspectorSession({ open, agentId, agents, details, memory, capabilities, capabilitiesLoading = false, capabilitiesError, onCapabilitiesAction, loading = false, applying = false, disabled: unavailable = false, onDirtyChange, error, contextNotice, onClose, onCreate, onSelectAgent, onRefresh, onAction, onOpenMemory, onEditAvatar, onRemoveAvatar, onOpenProvider, onOpenPlugins }: AgentInspectorProps) {
  const [cached, setCached] = useState<AgentDetailsSnapshot | undefined>(() => details !== undefined && (details.bot?.id ?? null) === agentId ? details : undefined);
  if (details !== undefined && (details.bot?.id ?? null) === agentId && details !== cached) setCached(details);
  const [opening, setOpening] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nativeResult, setNativeResult] = useState<AgentInspectorResult | undefined>(undefined);
  const current = details !== undefined && (details.bot?.id ?? null) === agentId;
  const disabled = unavailable || loading || applying || opening || Boolean(error) || !current;
  const [profileDirty, setProfileDirty] = useState(false);
  const [capabilityDirty, setCapabilityDirty] = useState(false);
  const dirty = profileDirty || capabilityDirty;
  const [cachedCapabilities, setCachedCapabilities] = useState(() => capabilities?.botId === agentId ? capabilities : undefined);
  if (capabilities?.botId === agentId && capabilities !== cachedCapabilities) setCachedCapabilities(capabilities);
  const [discardSignal, setDiscardSignal] = useState(0);
  const [intent, setIntent] = useState<{ kind: "close" | "create" } | { kind: "select"; id: string } | null>(null);
  const cancelDiscard = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const dirtyCallback = useRef(onDirtyChange);
  useLayoutEffect(() => { dirtyCallback.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => dirtyCallback.current?.(false), []);
  useLayoutEffect(() => { if (intent) cancelDiscard.current?.focus(); }, [intent]);
  const request = (next: { kind: "close" | "create" } | { kind: "select"; id: string }) => {
    if (applying || opening) return;
    if (dirty) { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setIntent(next); }
    else if (next.kind === "close") onClose();
    else if (next.kind === "create") onCreate?.();
    else if (next.kind === "select") onSelectAgent(next.id);
  };
  const discard = () => { const next = intent; setIntent(null); setProfileDirty(false); setCapabilityDirty(false); setDiscardSignal(value => value + 1); if (next?.kind === "close") onClose(); else if (next?.kind === "create") onCreate?.(); else if (next?.kind === "select") onSelectAgent(next.id); };
  const bot = cached?.bot;
  const selected = agents.find(agent => agent.id === agentId);
  const openNative = async (callback: (() => Promise<AgentInspectorResult | void>) | undefined) => {
    if (!callback || disabled) return;
    setOpening(true); setActionError(null); setNativeResult(undefined);
    try { setNativeResult(await callback() || undefined); }
    catch { setActionError("无法打开此编辑流程，请检查连接后重试。"); }
    finally { setOpening(false); }
  };
  return <aside className="lorca-agent-inspector" data-open={open} hidden={!open} inert={!open} aria-label="智能体详情" onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); request({ kind: "close" }); } }} tabIndex={-1}>
    <header className="lorca-inspector-header"><h2>{agentId === null ? "新建智能体" : "智能体详情"}</h2><div>{onCreate && agentId !== null && <Button variant="ghost" size="icon" aria-label="新建智能体" disabled={applying || opening} onClick={() => request({ kind: "create" })}><Icon name="Plus" /></Button>}<Button variant="ghost" size="icon" aria-label="刷新智能体详情" disabled={loading || applying} onClick={onRefresh}><Icon name="RefreshCw" /></Button><Button variant="ghost" size="icon" aria-label="关闭智能体详情" disabled={applying || opening} onClick={() => request({ kind: "close" })}><Icon name="X" /></Button></div></header>
    <div className="lorca-inspector-scroll">
      {intent && <div className="lorca-inspector-discard" role="group" aria-label="放弃未保存更改"><p>放弃当前草稿？这只清除本地未保存的编辑，不会撤销已提交的变更。</p><div className="lorca-inspector-actions"><Button ref={cancelDiscard} variant="ghost" onClick={() => { setIntent(null); returnFocus.current?.focus({ preventScroll: true }); }}>继续编辑</Button><Button onClick={discard}>放弃草稿并继续</Button></div></div>}
      {agentId !== null && <Section title="查看智能体"><div className="lorca-inspector-agents">{agents.map(agent => <button type="button" key={agent.id} aria-pressed={agent.id === agentId} disabled={applying} onClick={() => { if (agent.id !== agentId) request({ kind: "select", id: agent.id }); }}><Avatar appearance={agent.appearance} size="md" /><span>{agent.label}</span>{agent.id === agentId && <Icon name="Check" />}</button>)}</div></Section>}
      {contextNotice && <p className="lorca-inspector-help" role="status">{contextNotice}</p>}
      {(error || actionError) && <p className="lorca-inspector-error" role="alert">{error || actionError}</p>}
      {nativeResult && <p className={nativeResult.status === "unknownOutcome" ? "lorca-inspector-error" : "lorca-inspector-help"} role={nativeResult.status === "unknownOutcome" ? "alert" : "status"}>{agentNativeOutcomeMessage(nativeResult)}</p>}
      {loading && <p className="lorca-inspector-help" role="status">正在读取智能体详情…</p>}
      {cached && (bot || agentId === null) ? <>
        {bot && <>
        <div className="lorca-inspector-avatar-row"><Avatar appearance={selected?.appearance} size="md" /><span>{bot.name}</span><Button variant="ghost" size="sm" disabled={disabled || !cached.canEditAvatar || !onEditAvatar} onClick={() => void openNative(onEditAvatar ? () => onEditAvatar(bot.id) : undefined)}>修改头像</Button>{bot.hasAvatar && <Button variant="ghost" size="sm" disabled={disabled || !cached.canEditAvatar || !onRemoveAvatar} onClick={() => void openNative(onRemoveAvatar ? () => onRemoveAvatar(bot.id) : undefined)}>恢复默认头像</Button>}</div>
        {!cached.canEditAvatar && <p className="lorca-inspector-help">当前连接尚不支持修改头像。</p>}
        </>}
        <ProfileEditor snapshot={cached} disabled={disabled} onAction={onAction} onDirtyChange={setProfileDirty} discardSignal={discardSignal} />
        {bot && <>
        <Section title="服务商设置"><div className="lorca-inspector-detail-row"><span>凭证通过隔离配置流程管理</span><Button variant="ghost" size="sm" disabled={disabled || !bot.provider || !onOpenProvider} onClick={() => void openNative(bot.provider && onOpenProvider ? () => onOpenProvider(bot.provider!) : undefined)}>打开设置</Button></div></Section>
        <Section title="记忆">
          <div className="lorca-inspector-detail-row"><span>笔记</span><span>{memory?.status === "ready" ? `${memory.lines ?? "未报告"} 行 · ${memory.bytes === null ? "未报告" : `${(memory.bytes / 1024).toFixed(1)} KiB`}${memory.maxBytes === null ? "" : ` / ${(memory.maxBytes / 1024).toFixed(0)} KiB`}` : memory?.status === "unavailable" ? "当前不可用" : "尚未读取"}</span><Button variant="ghost" size="sm" disabled={disabled || !memory?.canEdit || !onOpenMemory} onClick={() => void openNative(onOpenMemory ? () => onOpenMemory(bot.id) : undefined)}>编辑…</Button></div>
          <div className="lorca-inspector-detail-row"><span>文件夹</span><span>{memory?.status === "ready" ? `${memory.topicCount ?? "未报告"} 个主题 · ${memory.logCount ?? "未报告"} 天日志` : "未报告"}</span></div>
          <p className="lorca-inspector-help">记忆正文只在独立编辑窗口中读取与保存。</p>
        </Section>
        {capabilitiesError && <div className="lorca-inspector-error" role="alert"><p>{capabilitiesError}</p><Button variant="ghost" disabled={loading || applying || capabilitiesLoading} onClick={onRefresh}>重新读取例行任务与插件</Button></div>}
        {cachedCapabilities ? <CapabilitiesPanel snapshot={cachedCapabilities} disabled={disabled || capabilitiesLoading || Boolean(capabilitiesError) || capabilities?.botId !== bot.id} onAction={onCapabilitiesAction} onOpenPlugins={onOpenPlugins} onDirtyChange={setCapabilityDirty} discardSignal={discardSignal} /> : <>
          <Section title="例行任务"><p className="lorca-inspector-help">{capabilitiesLoading ? "正在读取例行任务…" : capabilitiesError ? "例行任务读取失败，尚无法确认当前列表。" : "尚未读取当前智能体的例行任务。"}</p></Section>
          <Section title="插件"><p className="lorca-inspector-help">插件使用此智能体实际分配的 Runner 配置。</p><Button variant="ghost" disabled={disabled || !bot.runnerId || !onOpenPlugins} onClick={() => onOpenPlugins?.(bot.runnerId)}>查看 Runner 的插件<Icon name="ChevronRight" /></Button></Section>
        </>}
        </>}
      </> : !loading && <p className="lorca-inspector-help">{agentId === null ? "读取可用 Runner 后才能创建智能体。" : "请选择智能体查看资料。"}</p>}
    </div>
  </aside>;
}
