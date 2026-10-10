export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface LorcaConnection {
  status: ConnectionStatus;
  endpoint: string;
  detail?: string;
}

export interface LorcaBotAppearance {
  botId: string;
  name: string;
  symbolName: string;
  accent: string;
  image?: string;
}

export interface LorcaConversation {
  botIds?: string[];
  kind?: "dm" | "group";
  id: string;
  title: string;
  updatedAt: string;
  status: "idle" | "running" | "waiting" | "error";
  avatars?: LorcaBotAppearance[];
}

export interface LorcaAgent {
  id: string;
  label: string;
  appearance?: LorcaBotAppearance;
  status?: "running" | "waiting";
}

export type LorcaMessage =
  | {
      kind: "message";
      id: string;
      role: "user" | "assistant";
      authorName?: string;
      authorAvatar?: LorcaBotAppearance;
      text: string;
      createdAt?: string;
      streaming?: boolean;
      error?: string;
      attachments?: { id: string; name: string; mimeType?: string }[];
    }
  | {
      kind: "tool";
      id: string;
      authorId?: string | null;
      observedBoundary?: string | null;
      name: string;
      status: "running" | "complete" | "error";
      input?: string;
      output?: string;
    }
  | {
      kind: "cross-agent";
      id: string;
      direction: "incoming" | "outgoing" | "handoff";
      from: LorcaBotAppearance | null;
      to: LorcaBotAppearance | null;
      text: string;
    }
  | {
      kind: "approval";
      id: string;
      title: string;
      detail: string;
      status: "pending" | "approved" | "denied" | "expired";
      canAlways?: boolean;
      canAllow?: boolean;
    }
  | {
      kind: "notice";
      id: string;
      text: string;
      tone: "info" | "error";
    };

export interface SettingsEditor {
  revision: string;
  models: { provider: string; id: string; name: string; levels: string[] }[];
  bots: { id: string; thinking: string | null }[];
  providers: { id: string; canConfigure: boolean; canDisconnect: boolean }[];
  canUpdateBots: boolean;
  canAddProvider: boolean;
  canManageMcp: boolean;
  autoReview: {
    status: "ready" | "unavailable";
    isEnabled: boolean | null;
    rules: { id: string; text: string; behavior: "allow" | "ask"; tool: string | null }[];
  };
}

export type SettingsAction = { revision: string } & (
  | { kind: "bot.update"; botId: string; provider?: string; model?: string; thinking?: string; runnerId?: string }
  | { kind: "provider.configure"; providerId?: string }
  | { kind: "provider.disconnect"; providerId: string }
  | { kind: "mcp.configure"; runnerId: string; name?: string }
  | { kind: "mcp.setEnabled"; runnerId: string; name: string; enabled: boolean }
  | { kind: "mcp.remove" | "mcp.reconnect"; runnerId: string; name: string }
  | { kind: "mcp.reload"; runnerId: string }
  | { kind: "autoReview.set"; isEnabled: boolean; rules: { id?: string; text: string; behavior: "allow" | "ask"; tool?: string }[] }
);

export interface SettingsActionResult {
  status: "applied" | "cancelled" | "unknownOutcome";
}

export type PairingDisabledReason =
  | "not_connected"
  | "token_auth_required"
  | "local_transport_required"
  | "relay_transport_required"
  | "identity_required"
  | "already_has_identity"
  | "identity_fields_missing"
  | "relay_missing"
  | "https_relay_required"
  | "unknown_outcome"
  | "bridge_unavailable"
  | "not_reported";

export interface PairingCapabilities {
  invite: boolean;
  join: boolean;
  inviteReasons?: PairingDisabledReason[];
  joinReasons?: PairingDisabledReason[];
}

export interface RuntimeSettings {
  editor?: SettingsEditor;
  pairingCapabilities?: PairingCapabilities;
  version: string;
  hasIdentity: boolean;
  relayConnected: boolean;
  updateRequired: boolean;
  authMode: "token" | "legacy";
  devices: {
    id: string;
    name: string;
    os: string;
    role?: "runner" | "device" | "unknown";
    version: string;
    online: boolean;
    isThisDevice: boolean;
    plugins: {
      id: string;
      name: string;
      state: string;
      toolCount: number | null;
    }[];
  }[];
  providers: { id: string; name: string; connected: boolean }[];
  bots: {
    id: string;
    name: string;
    runnerId: string;
    provider: string | null;
    model: string | null;
  }[];
  mcp: {
    status: "ready" | "unavailable";
    runnerId: string | null;
    hasConfigError: boolean;
    servers: {
      name: string;
      transport: "stdio" | "http" | "unknown";
      enabled: boolean;
      state: string;
      toolCount: number | null;
      hiddenToolCount: number | null;
      hasError: boolean;
    }[];
  };
}

export type RunnerSummary =
  | { kind: "single"; device: { id: string; name: string; online: boolean } }
  | { kind: "multiple" }
  | { kind: "unknown" }
  | { kind: "unassigned" };

export interface LorcaShellState {
  runnerSummary?: RunnerSummary;
  connection: LorcaConnection;
  conversations: LorcaConversation[];
  activeConversationId: string | null;
  messages: LorcaMessage[];
  agents: LorcaAgent[];
  selectedAgentId: string | null;
  busy: boolean;
  loading: boolean;
  hasMore: boolean;
  loadingOlder: boolean;
  error: string | null;
  queue: { id: string; text: string; canSendNow?: boolean }[];
  demo: boolean;
  draftScope?: number;
  localGroupNamespace?: string;
  pendingAttachments?: { id: string; name: string; size?: number; mime?: string; previewUrl?: string }[];
  attachmentsEnabled?: boolean;
  runtimeSettings?: RuntimeSettings;
  settingsLoading?: boolean;
  settingsApplying?: boolean;
  settingsError?: string | null;
}

export interface LorcaShellActions {
  onRefreshData?: () => Promise<void>;
  onConversationVisibility?: (id: string | null) => void;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onSend: (
    text: string,
  ) => void | { chatId: string } | Promise<void | { chatId: string }>;
  onStop: () => void;
  onSendNow: (id: string) => void;
  onLoadOlder: () => void;
  onSelectAgent: (id: string) => void;
  onOpenAgentChat?: (id: string) => void;
  onSaveEndpoint: (url: string) => Promise<void>;
  onReconnect: () => void;
  onRefreshSettings: (runnerId?: string, options?: { includeMcp?: boolean }) => void;
  onOpenPairing?: (mode: "invite" | "join") => Promise<void>;
  onSettingsAction: (action: SettingsAction) => Promise<SettingsActionResult>;
  onPickAttachments?: () => void;
  onRemoveAttachment?: (id: string) => void;
  onApproval: (id: string, decision: "allow" | "always" | "deny") => void;
}

export interface LorcaShellProps {
  state: LorcaShellState;
  actions: LorcaShellActions;
}
