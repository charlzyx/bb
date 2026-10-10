import type { LorcaAgent } from "../types";

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  symbolName: string;
  accent: string;
  provider: string | null;
  model: string | null;
  thinking: string | null;
  runnerId: string;
  hasAvatar: boolean;
  avatarVersion: string | null;
}

export interface AgentDetailsSnapshot {
  revision: string;
  version: string;
  bot: AgentProfile | null;
  runners: { id: string; name: string; os: string; online: boolean }[];
  providers: { id: string; name: string; connected: boolean }[];
  models: { provider: string; id: string; name: string; levels: string[] }[];
  canCreate: boolean;
  canEditAvatar: boolean;
}

export interface AgentProfilePatch {
  name?: string;
  description?: string;
  symbolName?: string;
  accent?: string;
  provider?: string;
  model?: string;
  thinking?: string;
  runnerId?: string;
}

export type AgentInspectorAction =
  | { kind: "profile.save"; revision: string; patch: AgentProfilePatch }
  | { kind: "agent.create"; revision: string; profile: AgentProfilePatch & { name: string; runnerId: string } };

export interface AgentInspectorResult {
  status: "applied" | "cancelled" | "unknownOutcome";
  botId: string;
  chatId?: string;
}

export interface AgentMemorySummary {
  status: "ready" | "unavailable";
  lines: number | null;
  bytes: number | null;
  maxLines: number | null;
  maxBytes: number | null;
  topicCount: number | null;
  logCount: number | null;
  canEdit: boolean;
}

export interface AgentInspectorProps {
  open: boolean;
  scope: string | number;
  agentId: string | null;
  agents: readonly LorcaAgent[];
  details?: AgentDetailsSnapshot;
  memory?: AgentMemorySummary;
  capabilities?: AgentCapabilitiesSnapshot;
  capabilitiesLoading?: boolean;
  capabilitiesError?: string | null;
  onCapabilitiesAction?: (action: AgentCapabilitiesAction) => Promise<AgentCapabilitiesResult>;
  loading?: boolean;
  applying?: boolean;
  disabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  error?: string | null;
  contextNotice?: string;
  onClose: () => void;
  onCreate?: () => void;
  onSelectAgent: (id: string) => void;
  onRefresh: () => void;
  onAction?: (action: AgentInspectorAction) => Promise<AgentInspectorResult>;
  onOpenMemory?: (botId: string) => Promise<AgentInspectorResult | void>;
  onEditAvatar?: (botId: string) => Promise<AgentInspectorResult | void>;
  onRemoveAvatar?: (botId: string) => Promise<AgentInspectorResult | void>;
  onOpenProvider?: (providerId: string) => Promise<void>;
  onOpenPlugins?: (runnerId: string) => void;
}

export type ToolCapability = "read" | "draft" | "write";
export interface AgentRoutineDraft {
  name: string;
  prompt: string;
  schedule: string;
  timezone: string;
  missedRunPolicy: "coalesce" | "skip";
  enabled: boolean;
}
export interface AgentRoutine extends AgentRoutineDraft {
  id: string;
  botId: string;
  scheduleText: string;
  running: boolean;
  state: "running" | "blocked" | "paused" | "waiting_for_runner" | "failed" | "on";
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastOutcome: "sent" | "pass" | "error" | null;
  pausedReason: string | null;
  hasCheck: boolean;
  triggerKind: "schedule" | "pull_request" | "calendar";
  editable: boolean;
}
export interface AgentPlugin {
  id: string;
  name: string;
  tools: { name: string; title: string | null; capability: ToolCapability }[];
  capabilities: ToolCapability[];
  allowedTools: string[] | null;
}
export interface AgentCapabilitiesSnapshot {
  revision: string;
  version: string;
  botId: string;
  botName: string;
  runnerId: string;
  routines: AgentRoutine[];
  plugins: AgentPlugin[];
  permissions: { allConnections: boolean; filesystem: "none" | "read" | "write"; shell: boolean; drafts: boolean };
  capabilities: { canCreateRoutine: boolean; canEditPlugins: boolean };
}
export type AgentCapabilitiesAction = { revision: string } & (
  | { kind: "routine.create"; draft: AgentRoutineDraft }
  | { kind: "routine.edit"; routineId: string; patch: Partial<Omit<AgentRoutineDraft, "enabled">> }
  | { kind: "routine.setEnabled"; routineId: string; enabled: boolean }
  | { kind: "routine.run" | "routine.delete"; routineId: string }
  | { kind: "plugin.setAccess"; connectionId: string; capabilities: ToolCapability[]; tools: string[] | null }
);
export interface AgentCapabilitiesResult {
  status: "applied" | "cancelled" | "unknownOutcome";
  botId: string;
  routineId?: string;
  requested?: boolean;
}
