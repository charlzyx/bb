import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import type { AgentCapabilitiesAction, AgentCapabilitiesResult, AgentCapabilitiesSnapshot, AgentPlugin, AgentRoutine, AgentRoutineDraft, ToolCapability } from "./types";

const states: Record<AgentRoutine["state"], string> = { running: "运行中", blocked: "已阻止", paused: "已暂停", waiting_for_runner: "等待 Runner", failed: "运行失败", on: "已启用" };
const capabilityNames: Record<ToolCapability, string> = { read: "读取", draft: "准备草稿", write: "写入与外部操作" };
const pauseReasons: Record<string, string> = { away: "智能体暂时离开，计划已暂停。", authentication: "需要重新认证后才能运行。", other: "计划已暂停，请核对后端状态。" };
const routineKeys = ["name", "prompt", "schedule", "timezone", "missedRunPolicy"] as const;
function routineDraft(routine?: AgentRoutine): AgentRoutineDraft {
  return routine ? { name: routine.name, prompt: routine.prompt, schedule: routine.schedule, timezone: routine.timezone, missedRunPolicy: routine.missedRunPolicy, enabled: routine.enabled } : { name: "", prompt: "", schedule: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, missedRunPolicy: "coalesce", enabled: false };
}
function timestamp(value: number | null): string {
  if (value === null) return "未报告";
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? "未报告" : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function pluginAccessSummary(plugin: AgentPlugin): string {
  if (!plugin.capabilities.length || plugin.allowedTools?.length === 0) return "未授权工具";
  return `${plugin.capabilities.map(capability => capabilityNames[capability]).join("、")} · ${plugin.allowedTools === null ? "范围内全部工具" : `${plugin.allowedTools.length} 项工具`}`;
}

type Editor =
  | { kind: "routine"; version: string; original: AgentRoutineDraft; id: string | null; draft: AgentRoutineDraft }
  | { kind: "plugin"; version: string; original: AgentPlugin; capabilities: ToolCapability[]; tools: string[] | null };
const sameList = (left: readonly string[] | null, right: readonly string[] | null) => left === null || right === null ? left === right : left.length === right.length && left.every(item => right.includes(item));

export function CapabilitiesPanel({ snapshot, disabled, onAction, onOpenPlugins, onDirtyChange, discardSignal }: {
  snapshot: AgentCapabilitiesSnapshot;
  disabled: boolean;
  onAction?: (action: AgentCapabilitiesAction) => Promise<AgentCapabilitiesResult>;
  onOpenPlugins?: (runnerId: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  discardSignal: number;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AgentCapabilitiesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittedRevision, setSubmittedRevision] = useState<string | null>(null);
  const [discarded, setDiscarded] = useState(discardSignal);
  const inFlight = useRef(false);
  const editorRef = useRef<HTMLFormElement>(null);
  const editorKey = editor?.kind === "routine" ? `routine:${editor.id ?? "new"}` : editor?.kind === "plugin" ? `plugin:${editor.original.id}` : "";
  useLayoutEffect(() => { if (editorKey) editorRef.current?.querySelector<HTMLElement>("input, textarea, select")?.focus(); }, [editorKey]);
  const dirty = editor?.kind === "routine" ? routineKeys.some(key => editor.draft[key] !== editor.original[key]) || editor.draft.enabled !== editor.original.enabled : editor?.kind === "plugin" ? !sameList(editor.capabilities, editor.original.capabilities) || !sameList(editor.tools, editor.original.allowedTools) : false;
  const conflict = editor !== null && editor.version !== snapshot.version;
  const blocked = disabled || pending || result?.status === "unknownOutcome" || !onAction;
  useEffect(() => { onDirtyChange(dirty || pending || result?.status === "unknownOutcome"); }, [dirty, pending, result, onDirtyChange]);
  if (discarded !== discardSignal) { setDiscarded(discardSignal); setEditor(null); setResult(null); setError(null); }
  const run = async (action: AgentCapabilitiesAction) => {
    if (blocked || inFlight.current) return;
    inFlight.current = true; setPending(true); setError(null); setResult(null); setSubmittedRevision(snapshot.revision);
    try {
      const outcome = await onAction!(action);
      setResult(outcome);
      if (outcome.status === "applied") setEditor(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "操作未能确认，请刷新后核对。"); }
    finally { inFlight.current = false; setPending(false); }
  };
  const editRoutine = (routine?: AgentRoutine) => { const draft = routineDraft(routine); setEditor({ kind: "routine", version: snapshot.version, id: routine?.id ?? null, original: draft, draft }); setError(null); setResult(null); };
  const editPlugin = (plugin: AgentPlugin) => { setEditor({ kind: "plugin", version: snapshot.version, original: plugin, capabilities: [...plugin.capabilities], tools: plugin.allowedTools === null ? null : [...plugin.allowedTools] }); setError(null); setResult(null); };
  const save = () => {
    if (!editor || conflict || !dirty) return;
    if (editor.kind === "plugin") void run({ kind: "plugin.setAccess", revision: snapshot.revision, connectionId: editor.original.id, capabilities: editor.capabilities, tools: editor.tools });
    else if (editor.id === null) void run({ kind: "routine.create", revision: snapshot.revision, draft: editor.draft });
    else {
      const patch: Partial<Omit<AgentRoutineDraft, "enabled">> = {};
      for (const key of routineKeys) if (editor.draft[key] !== editor.original[key]) Object.assign(patch, { [key]: editor.draft[key] });
      void run({ kind: "routine.edit", revision: snapshot.revision, routineId: editor.id, patch });
    }
  };
  return <div className="lorca-inspector-capabilities">
    {error && <p className="lorca-inspector-error" role="alert">{error}</p>}
    {result && <p className={result.status === "unknownOutcome" ? "lorca-inspector-error" : "lorca-inspector-help"} role={result.status === "unknownOutcome" ? "alert" : "status"}>{result.status === "unknownOutcome" ? "结果尚不确定，请刷新核对；操作未自动重发。" : result.status === "cancelled" ? "已取消操作，原草稿仍保留。" : result.requested ? "已请求运行，请查看任务的后端状态。" : "操作已提交，请以刷新后的配置为准。"}</p>}
    {result?.status === "unknownOutcome" && <Button variant="ghost" disabled={disabled || snapshot.revision === submittedRevision} onClick={() => { setResult(null); setEditor(null); }}>已核对，放弃草稿并继续</Button>}
    <section className="lorca-inspector-section"><h3>例行任务</h3><div className="lorca-inspector-section-body">
      {snapshot.routines.map(routine => <details key={routine.id} className="lorca-inspector-routine" data-inspector-routine={routine.id}>
        <summary><Icon name="Clock" /><span><strong>{routine.name}</strong><small>{routine.scheduleText} · {states[routine.state]}</small></span><Icon name="ChevronDown" /></summary>
        <div className="lorca-inspector-routine-detail"><p>{routine.prompt}</p><p className="lorca-inspector-help">时区：{routine.timezone}<br />下次：{timestamp(routine.nextRunAt)}<br />上次：{timestamp(routine.lastRunAt)}</p>{routine.pausedReason && <p className="lorca-inspector-help">{pauseReasons[routine.pausedReason] ?? pauseReasons.other}</p>}
          <label className="lorca-inspector-checkbox"><input type="checkbox" aria-label={`启用例行任务 ${routine.name}`} checked={routine.enabled} disabled={blocked || dirty} onChange={event => void run({ kind: "routine.setEnabled", revision: snapshot.revision, routineId: routine.id, enabled: event.target.checked })} /><span>启用计划</span></label>
          <div className="lorca-inspector-actions"><Button variant="ghost" disabled={blocked || dirty || !routine.editable} onClick={() => editRoutine(routine)}>编辑任务</Button><Button variant="ghost" disabled={blocked || dirty || routine.running || routine.state === "waiting_for_runner" || routine.pausedReason === "authentication"} onClick={() => void run({ kind: "routine.run", revision: snapshot.revision, routineId: routine.id })}>立即运行</Button><Button variant="ghost" disabled={blocked || dirty} onClick={() => void run({ kind: "routine.delete", revision: snapshot.revision, routineId: routine.id })}>删除任务…</Button></div>
          {!routine.editable && <p className="lorca-inspector-help">包含检查脚本或高级触发器，此处不支持编辑其配置。</p>}
          <p className="lorca-inspector-help">暂停或删除计划不会取消正在运行的任务。</p>
        </div>
      </details>)}
      {!snapshot.routines.length && <p className="lorca-inspector-help">此智能体暂无例行任务。</p>}
      <Button variant="ghost" disabled={blocked || dirty || !snapshot.capabilities.canCreateRoutine} onClick={() => editRoutine()}>添加例行任务<Icon name="Plus" /></Button>
    </div></section>
    <section className="lorca-inspector-section"><h3>插件</h3><div className="lorca-inspector-section-body">
      {snapshot.plugins.map(plugin => <div className="lorca-inspector-plugin" key={plugin.id}><div><Icon name="Toolbox" /><span><strong>{plugin.name}</strong><small>{pluginAccessSummary(plugin)}</small></span></div><Button variant="ghost" size="sm" disabled={blocked || dirty || !snapshot.capabilities.canEditPlugins} onClick={() => editPlugin(plugin)}>权限…</Button></div>)}
      {!snapshot.plugins.length && <p className="lorca-inspector-help">当前未报告插件目录。</p>}
      <Button variant="ghost" disabled={disabled || !snapshot.runnerId || !onOpenPlugins} onClick={() => onOpenPlugins?.(snapshot.runnerId)}>管理或添加插件<Icon name="ChevronRight" /></Button>
    </div><p className="lorca-inspector-help">{snapshot.permissions.allConnections ? "当前权限包含所有现有及未来插件。修改一项后将转为明确授权列表，后续新插件不再自动获权。" : "此处仅管理该智能体的工具授权，不卸载插件，也不更改账户连接。"}</p><p className="lorca-inspector-help">列表来自后端缓存的工具目录，不代表插件当前在线。读取、准备草稿、写入三类授权彼此独立。</p></section>
    {editor && <form ref={editorRef} className="lorca-inspector-inline-editor" onSubmit={event => { event.preventDefault(); save(); }}>
      <h3>{editor.kind === "plugin" ? `${editor.original.name} · 工具权限` : editor.id === null ? "添加例行任务" : "编辑例行任务"}</h3>
      <fieldset disabled={blocked || conflict}>
        {editor.kind === "routine" ? <>
          <label>任务名称<Input value={editor.draft.name} maxLength={60} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, name: event.target.value } })} /></label>
          <label>任务内容<textarea value={editor.draft.prompt} maxLength={20_000} rows={4} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, prompt: event.target.value } })} /></label>
          <label>计划表达式<Input value={editor.draft.schedule} maxLength={256} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, schedule: event.target.value } })} /></label>
          <label>时区<Input value={editor.draft.timezone} maxLength={128} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, timezone: event.target.value } })} /></label>
          <label>错过计划时<select value={editor.draft.missedRunPolicy} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, missedRunPolicy: event.target.value === "skip" ? "skip" : "coalesce" } })}><option value="coalesce">合并补跑一次</option><option value="skip">跳过</option></select></label>
          {editor.id === null && <label className="lorca-inspector-checkbox"><input type="checkbox" checked={editor.draft.enabled} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, enabled: event.target.checked } })} /><span>创建后启用计划</span></label>}
          <p className="lorca-inspector-help">支持服务端的间隔、cron 或单次计划。最终计划与作用范围会在原生确认中展示。任务沿用该智能体权限，可能产生模型费用及外部操作。</p>
        </> : <>
          {(["read", "draft", "write"] as const).map(capability => <label className="lorca-inspector-checkbox" key={capability}><input type="checkbox" checked={editor.capabilities.includes(capability)} onChange={event => setEditor({ ...editor, capabilities: event.target.checked ? [...editor.capabilities, capability] : editor.capabilities.filter(item => item !== capability) })} /><span>{capabilityNames[capability]}</span></label>)}
          <label className="lorca-inspector-checkbox"><input type="checkbox" checked={editor.tools === null} onChange={event => setEditor({ ...editor, tools: event.target.checked ? null : [] })} /><span>授权范围内的当前及未来工具</span></label>
          {editor.tools !== null && editor.original.tools.map(tool => <label className="lorca-inspector-checkbox" key={tool.name}><input type="checkbox" checked={editor.tools?.includes(tool.name) ?? false} onChange={event => setEditor({ ...editor, tools: event.target.checked ? [...editor.tools ?? [], tool.name] : editor.tools?.filter(name => name !== tool.name) ?? [] })} /><span>{tool.title || tool.name}<small>{tool.name} · {capabilityNames[tool.capability]}</small></span></label>)}
          <p className="lorca-inspector-help">工具须同时满足操作范围与工具名单。空范围或空名单表示未授权，不代表插件已卸载。</p>
        </>}
      </fieldset>
      {conflict && <p className="lorca-inspector-error" role="alert">配置已变化，草稿未覆盖远端。请取消后按当前配置重新编辑。</p>}
      <div className="lorca-inspector-actions"><Button type="button" variant="ghost" disabled={pending} onClick={() => setEditor(null)}>取消</Button><Button type="submit" disabled={blocked || conflict || !dirty || (editor.kind === "routine" && (!editor.draft.name.trim() || !editor.draft.prompt.trim() || !editor.draft.schedule.trim() || !editor.draft.timezone.trim()))}>{pending ? "提交中…" : "保存并确认…"}</Button></div>
    </form>}
  </div>;
}
