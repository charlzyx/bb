import type { LorcaMessage } from "./types";

export interface TranscriptLayout {
  messages: readonly LorcaMessage[];
  height: number;
  viewportHeight: number;
  width: number;
}

function sameMessageContent(previous: LorcaMessage, next: LorcaMessage): boolean {
  if (previous === next) return true;
  if (previous.id !== next.id) return false;
  switch (previous.kind) {
    case "message": {
      if (next.kind !== "message") return false;
      const beforeAttachments = previous.attachments ?? [];
      const afterAttachments = next.attachments ?? [];
      return previous.role === next.role && previous.text === next.text && previous.streaming === next.streaming
        && previous.error === next.error && previous.authorName === next.authorName && previous.createdAt === next.createdAt
        && beforeAttachments.length === afterAttachments.length
        && beforeAttachments.every((item, index) => item.id === afterAttachments[index].id && item.name === afterAttachments[index].name && item.mimeType === afterAttachments[index].mimeType);
    }
    case "tool":
      return next.kind === "tool" && previous.name === next.name && previous.status === next.status
        && previous.input === next.input && previous.output === next.output;
    case "approval":
      return next.kind === "approval" && previous.title === next.title && previous.detail === next.detail
        && previous.status === next.status && previous.canAllow === next.canAllow && previous.canAlways === next.canAlways;
    case "notice":
      return next.kind === "notice" && previous.text === next.text && previous.tone === next.tone;
    case "cross-agent":
      return next.kind === "cross-agent" && previous.direction === next.direction && previous.text === next.text
        && previous.from?.botId === next.from?.botId && previous.from?.name === next.from?.name
        && previous.to?.botId === next.to?.botId && previous.to?.name === next.to?.name;
  }
}

export function hasTranscriptLayoutUpdate(previous: TranscriptLayout, next: TranscriptLayout): boolean {
  if (previous.height !== next.height || previous.viewportHeight !== next.viewportHeight || previous.width !== next.width) return true;
  if (previous.messages === next.messages) return false;
  return previous.messages.length !== next.messages.length
    || previous.messages.some((message, index) => !sameMessageContent(message, next.messages[index]));
}
