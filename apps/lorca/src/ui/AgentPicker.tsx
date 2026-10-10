import { useId, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { Icon } from "@bb/shared-ui/icon";
import { Avatar } from "./Avatar";
import type { LorcaAgent } from "./types";

export function filterPickerAgents(agents: readonly LorcaAgent[], query: string) {
  const search = query.trim().toLocaleLowerCase();
  return agents.filter(agent => agent.label.toLocaleLowerCase().includes(search));
}

export function AgentPicker({ agents, selectedAgentId, onSelectAgent, disabled = false }: {
  agents: readonly LorcaAgent[];
  selectedAgentId?: string | null;
  onSelectAgent: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const available = !disabled && agents.length > 0;
  const [wasAvailable, setWasAvailable] = useState(available);
  if (available !== wasAvailable) { setWasAvailable(available); if (open) setOpen(false); }
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const title = useId();
  const selected = agents.find(agent => agent.id === selectedAgentId);
  const filtered = filterPickerAgents(agents, query);
  const choose = (id: string) => { onSelectAgent(id); setOpen(false); };
  return <Popover open={open && !disabled && agents.length > 0} onOpenChange={(value) => { setOpen(value); if (value) setQuery(""); }} modal={false}>
    <PopoverTrigger asChild>
      <button type="button" className="lorca-agent-picker" data-selected-agent={selectedAgentId ?? ""} aria-label="选择智能体" disabled={disabled || !agents.length} title={selected?.label ?? "暂无智能体"}>
        <Avatar appearance={selected?.appearance} />
        <span>{selected?.label ?? "暂无智能体"}</span><Icon name="ChevronDown" />
      </button>
    </PopoverTrigger>
    <PopoverContent className="lorca-agent-picker-popover" side="top" align="start" sideOffset={8} collisionPadding={12} aria-labelledby={title} mobileTitle="选择智能体" onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}>
      <h3 id={title} className="sr-only">选择智能体</h3>
      <div className="lorca-agent-picker-search"><Icon name="Search" /><input ref={input} type="search" aria-label="搜索智能体" placeholder="搜索智能体…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "ArrowDown") { event.preventDefault(); list.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
        if (event.key === "Enter" && filtered.length === 1) { event.preventDefault(); choose(filtered[0].id); }
      }} /></div>
      <div ref={list} className="lorca-agent-picker-results" role="group" aria-label="智能体列表" onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        const current = buttons.indexOf(event.target as HTMLButtonElement);
        if (current < 0) return;
        event.preventDefault();
        if (event.key === "ArrowUp" && current === 0) { input.current?.focus(); return; }
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.min(buttons.length - 1, current + (event.key === "ArrowDown" ? 1 : -1));
        buttons[next]?.focus();
      }}>
        {filtered.map(agent => <button type="button" key={agent.id} data-picker-agent={agent.id} aria-pressed={agent.id === selectedAgentId} onClick={() => choose(agent.id)}><Avatar appearance={agent.appearance} /><span>{agent.label}</span>{agent.id === selectedAgentId && <Icon name="Check" />}</button>)}
        {!filtered.length && <p role="status">没有匹配的智能体</p>}
      </div>
    </PopoverContent>
  </Popover>;
}
