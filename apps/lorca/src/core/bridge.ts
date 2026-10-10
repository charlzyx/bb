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
}
export interface LorcaBridge {
  connect(endpoint: string): Promise<BridgeStatus>;
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  onEvent(callback: (event: unknown) => void): () => void;
  onStatus(callback: (status: BridgeStatus) => void): () => void;
  getStatus(): Promise<BridgeStatus>;
  setWatchingChat?(chatId: string | null): Promise<void>;
  getBotAvatar?(botId: string, expectedAvatarVersion: string): Promise<string | null>;
  settingsAction?(action: SettingsAction): Promise<unknown>;
  getSettings?(options: { runnerId?: string }): Promise<unknown>;
  copyText?(text: string): Promise<void>;
  pickAttachments?(): Promise<PickedAttachment[]>;
  releaseAttachments?(ids: string[]): Promise<void>;
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
