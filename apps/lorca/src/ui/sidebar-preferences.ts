import type { LorcaConversation } from "./types";

export type SidebarView = "recent" | "teams";
export type RecentBucket = "today" | "three-days" | "week" | "older";
export interface SidebarPreferences { view: SidebarView; collapsed: RecentBucket[] }
export const recentBuckets: readonly { id: RecentBucket; label: string; detail?: string }[] = [
  { id: "today", label: "今天" },
  { id: "three-days", label: "近三天", detail: "今天之前的两天" },
  { id: "week", label: "近一周", detail: "前三天之前的四天" },
  { id: "older", label: "全部", detail: "一周以前的其余历史，不重复上面的对话" },
];
const defaults = (): SidebarPreferences => ({ view: "recent", collapsed: [] });
const key = (namespace?: string) => namespace ? `dots.sidebar.v1:${encodeURIComponent(namespace)}` : null;
export function readSidebarPreferences(namespace?: string, storage?: Pick<Storage, "getItem">): SidebarPreferences {
  if (!namespace) return defaults();
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(key(namespace)!);
    if (!raw || raw.length > 1024) return defaults();
    const value = JSON.parse(raw);
    if (!value || !["recent", "teams"].includes(value.view) || !Array.isArray(value.collapsed) || value.collapsed.length > 4 || value.collapsed.some((id: unknown) => !recentBuckets.some(bucket => bucket.id === id))) return defaults();
    return { view: value.view, collapsed: [...new Set<RecentBucket>(value.collapsed)] };
  } catch { return defaults(); }
}
export function writeSidebarPreferences(namespace: string | undefined, value: SidebarPreferences, storage?: Pick<Storage, "setItem">): boolean {
  if (!namespace) return false;
  try { (storage ?? globalThis.localStorage).setItem(key(namespace)!, JSON.stringify(value)); return true; } catch { return false; }
}
export function recentBucket(date: string, now = new Date()): RecentBucket {
  const value = new Date(date);
  if (!Number.isFinite(value.getTime())) return "older";
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  const age = day(now) - day(value);
  return age <= 0 ? "today" : age < 3 ? "three-days" : age < 7 ? "week" : "older";
}
export function bucketConversations(conversations: readonly LorcaConversation[], now = new Date()) {
  const sorted = [...conversations].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || a.id.localeCompare(b.id));
  return recentBuckets.map(bucket => ({ ...bucket, conversations: sorted.filter(chat => recentBucket(chat.updatedAt, now) === bucket.id) }));
}
