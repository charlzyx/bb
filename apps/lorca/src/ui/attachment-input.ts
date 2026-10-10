export function safeAttachmentPreview(value: string | undefined): string | undefined {
  if (!value || value.length > 2048 || !value.startsWith("blob:") || /[\u0000-\u0020\u007f]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "blob:" && url.pathname.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function insertAttachmentText(value: string, text: string, selectionStart: number, selectionEnd: number): { value: string; caret: number } {
  const start = Math.max(0, Math.min(value.length, Number.isFinite(selectionStart) ? Math.trunc(selectionStart) : value.length));
  const end = Math.max(start, Math.min(value.length, Number.isFinite(selectionEnd) ? Math.trunc(selectionEnd) : start));
  const inserted = text.replace(/\r\n?/g, "\n");
  return { value: value.slice(0, start) + inserted + value.slice(end), caret: start + inserted.length };
}

export function attachmentSize(size: number | undefined): string | undefined {
  if (size === undefined || !Number.isSafeInteger(size) || size < 0) return undefined;
  if (size < 1024) return `${size} B`;
  const unit = size < 1024 * 1024 ? "KB" : "MB";
  const value = size / (unit === "KB" ? 1024 : 1024 * 1024);
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} ${unit}`;
}
