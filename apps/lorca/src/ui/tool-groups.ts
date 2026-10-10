import type { LorcaMessage } from "./types";

export type ToolMessage = Extract<LorcaMessage, { kind: "tool" }>;
export type TranscriptEntry = { kind: "item"; message: LorcaMessage } | { kind: "tools"; id: string; messages: ToolMessage[] };

export function groupToolRecords(messages: readonly LorcaMessage[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const message of messages) {
    if (message.kind !== "tool") {
      entries.push({ kind: "item", message });
      continue;
    }
    const previous = entries.at(-1);
    const last = previous?.kind === "tools" ? previous.messages.at(-1)! : null;
    if (previous?.kind === "tools" && last && (last.authorId ?? null) === (message.authorId ?? null) && (last.observedBoundary ?? null) === (message.observedBoundary ?? null)) previous.messages.push(message);
    else entries.push({ kind: "tools", id: message.id, messages: [message] });
  }
  return entries;
}

export function toolGroupExpanded(messages: readonly ToolMessage[], choices: ReadonlyMap<string, boolean>): boolean {
  const chosen = messages.map(message => choices.get(message.id)).filter(value => value !== undefined);
  if (chosen.length) return chosen.some(Boolean);
  return messages.some(message => message.status === "error");
}

export function stableToolGroupIds(entries: TranscriptEntry[], anchors: Map<string, string>): TranscriptEntry[] {
  const used = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "tools") continue;
    const previous = entry.messages.map(message => anchors.get(message.id)).find(id => id !== undefined && !used.has(id));
    entry.id = previous ?? entry.messages[0]!.id;
    while (used.has(entry.id)) entry.id = `${entry.id}:split`;
    used.add(entry.id);
    for (const message of entry.messages) { anchors.delete(message.id); anchors.set(message.id, entry.id); }
  }
  while (anchors.size > 4000) anchors.delete(anchors.keys().next().value!);
  return entries;
}

export function rememberToolExpansion(choices: ReadonlyMap<string, boolean>, ids: readonly string[], expanded: boolean): Map<string, boolean> {
  const next = new Map(choices);
  for (const id of ids) { next.delete(id); next.set(id, expanded); }
  while (next.size > 4000) next.delete(next.keys().next().value!);
  return next;
}
