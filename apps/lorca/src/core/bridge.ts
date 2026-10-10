import type { AgentCapabilitiesAction } from "../ui/inspector/types";
import type { SettingsAction } from "../ui/types";
export interface BridgeStatus {
  status: "disconnected" | "connecting" | "connected" | "error";
  endpoint: string;
  generation: number;
  authMode: "token" | "legacy";
  detail?: string;
}
export interface PickedAttachment {
  id: string;
  name: string;
  size?: number;
  mime?: string;
  previewUrl?: string;
}
export interface AttachmentImportEvent {
  scope: string;
  attachments: PickedAttachment[];
  duplicates: number;
  error?: string;
}
export interface LorcaBridge {
  connect(endpoint: string): Promise<BridgeStatus>;
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  onEvent(callback: (event: unknown) => void): () => void;
  onStatus(callback: (status: BridgeStatus) => void): () => void;
  getStatus(): Promise<BridgeStatus>;
  setWatchingChat?(chatId: string | null): Promise<void>;
  getBotAvatar?(botId: string, expectedAvatarVersion: string): Promise<string | null>;
  openPairing?(mode: "invite" | "join"): Promise<unknown>;
  settingsAction?(action: SettingsAction): Promise<unknown>;
  getAgentCapabilities?(params: { botId: string }): Promise<unknown>;
  agentCapabilitiesAction?(action: AgentCapabilitiesAction): Promise<unknown>;
  getAgentDetails?(params: { botId?: string }): Promise<unknown>;
  getAgentMemorySummary?(params: { revision: string }): Promise<unknown>;
  openAgentMemory?(params: { revision: string }): Promise<unknown>;
  closeAgentDetails?(): Promise<unknown>;
  agentDetailsAction?(action: unknown): Promise<unknown>;
  getSettings?(options: { runnerId?: string; includeMcp?: boolean }): Promise<unknown>;
  copyText?(text: string): Promise<void>;
  pickAttachments?(): Promise<PickedAttachment[]>;
  releaseAttachments?(ids: string[]): Promise<void>;
  setAttachmentScope?(scope: string | null): Promise<void>;
  onAttachmentImport?(callback: (event: AttachmentImportEvent) => void): () => void;
  onAttachmentText?(callback: (text: string) => void): () => void;
  sendAttachments?(params: {
    chat_id: string;
    text: string;
    message_id: string;
    selection_ids: string[];
  }): Promise<unknown>;
}
declare global {
  interface Window {
    lorca?: LorcaBridge;
  }
}
