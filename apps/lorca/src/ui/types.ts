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

export interface LorcaConversation {
  id: string;
  title: string;
  updatedAt: string;
  status: "idle" | "running" | "waiting" | "error";
}

export interface LorcaAgent {
  id: string;
  label: string;
}

export type LorcaMessage =
  | {
      kind: "message";
      id: string;
      role: "user" | "assistant";
      authorName?: string;
      text: string;
      createdAt?: string;
      streaming?: boolean;
      error?: string;
      attachments?: { id: string; name: string; mimeType?: string }[];
    }
  | {
      kind: "tool";
      id: string;
      name: string;
      status: "running" | "complete" | "error";
      input?: string;
      output?: string;
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

export interface RuntimeSettings {
  version: string;
  hasIdentity: boolean;
  relayConnected: boolean;
  updateRequired: boolean;
  authMode: "token" | "legacy";
  devices: {
    id: string;
    name: string;
    os: string;
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

export interface LorcaShellState {
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
  pendingAttachments?: { id: string; name: string }[];
  attachmentsEnabled?: boolean;
  runtimeSettings?: RuntimeSettings;
  settingsLoading?: boolean;
  settingsError?: string | null;
}

export interface LorcaShellActions {
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onSend: (
    text: string,
  ) => void | { chatId: string } | Promise<void | { chatId: string }>;
  onStop: () => void;
  onSendNow: (id: string) => void;
  onLoadOlder: () => void;
  onSelectAgent: (id: string) => void;
  onSaveEndpoint: (url: string) => Promise<void>;
  onReconnect: () => void;
  onRefreshSettings: (runnerId?: string) => void;
  onPickAttachments?: () => void;
  onRemoveAttachment?: (id: string) => void;
  onApproval: (id: string, decision: "allow" | "always" | "deny") => void;
}

export interface LorcaShellProps {
  state: LorcaShellState;
  actions: LorcaShellActions;
}
