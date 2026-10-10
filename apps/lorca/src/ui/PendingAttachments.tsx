import { useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { zhCN } from "../locale/zh-CN";
import { attachmentSize, safeAttachmentPreview } from "./attachment-input";
import type { LorcaShellState } from "./types";

function AttachmentPreview({ source, name }: { source: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="lorca-attachment-preview" title={failed ? zhCN.chat.attachmentPreviewUnavailable : undefined}>
      {failed ? <><Icon name="Folder" /><span className="sr-only">{zhCN.chat.attachmentPreviewUnavailable}</span></>
        : <img src={source} alt={`${zhCN.chat.attachmentImagePreview}：${name}`} decoding="async" onError={() => setFailed(true)} />}
    </span>
  );
}

export function PendingAttachments({ attachments, disabled, onRemove }: {
  attachments: NonNullable<LorcaShellState["pendingAttachments"]>;
  disabled: boolean;
  onRemove?: (id: string) => void;
}) {
  return (
    <div className="lorca-pending-attachments">
      {attachments.map((attachment) => {
        const preview = safeAttachmentPreview(attachment.previewUrl);
        const description = [attachment.name, attachmentSize(attachment.size), attachment.mime].filter(Boolean).join(" · ");
        return (
          <span key={attachment.id} data-attachment-id={attachment.id} data-image-preview={preview ? "true" : undefined}>
            {preview ? <AttachmentPreview key={preview} source={preview} name={attachment.name} /> : <Icon name="Folder" />}
            <span className="lorca-attachment-name" title={description}>{attachment.name}</span>
            {onRemove && <button type="button" disabled={disabled} aria-label={zhCN.chat.removeAttachment(attachment.name)} onClick={() => onRemove(attachment.id)}><Icon name="X" /></button>}
          </span>
        );
      })}
    </div>
  );
}
