import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { attachmentSize, insertAttachmentText, safeAttachmentPreview } from "./attachment-input";
import { PendingAttachments } from "./PendingAttachments";
import { LorcaShell } from "./LorcaShell";
import type { LorcaShellActions, LorcaShellState } from "./types";

const actions: LorcaShellActions = {
  onSelectConversation() {}, onNewConversation() {}, onSend() {}, onStop() {}, onSendNow() {}, onLoadOlder() {}, onSelectAgent() {},
  async onSaveEndpoint() {}, onReconnect() {}, onRefreshSettings() {}, async onSettingsAction() { return { status: "cancelled" }; }, onApproval() {},
};

test("Both document and native image policies permit local blob previews without enabling remote image sources", () => {
  const document = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const native = readFileSync(new URL("../../native/main.cjs", import.meta.url), "utf8");
  for (const source of [document, native]) {
    assert.equal(source.match(/img-src ([^;]+);/)?.[1], "'self' data: blob:");
  }
  assert.match(document, /script-src 'self';/);
  assert.match(document, /connect-src 'self' ws:\/\/127\.0\.0\.1:5178;/);
});

test("Attachment previews accept bounded blob URLs without loading remote, data or filesystem URLs", () => {
  for (const value of ["blob:null/synthetic-image", "blob:file:///synthetic-image", "blob:http://localhost:5178/synthetic-image"]) {
    assert.equal(safeAttachmentPreview(value), value);
  }
  for (const value of [undefined, "", "blob:", "https://example.invalid/tracker.png", "file:///private/image.png", "data:image/png;base64,AAAA", "javascript:alert(1)", " blob:null/image", "blob:null/line\nbreak", `blob:null/${"x".repeat(2048)}`]) {
    assert.equal(safeAttachmentPreview(value), undefined);
  }
});

test("Mixed file-paste text replaces only the current selection and preserves the resulting caret", () => {
  assert.deepEqual(insertAttachmentText("before selected after", "pasted", 7, 15), { value: "before pasted after", caret: 13 });
  assert.deepEqual(insertAttachmentText("ab", "一\r\n二\r三", 1, 1), { value: "a一\n二\n三b", caret: 6 });
  const first = insertAttachmentText("ab", "📎", 1, 1);
  const second = insertAttachmentText(first.value, " again", first.caret, first.caret);
  assert.deepEqual(second, { value: "a📎 againb", caret: 9 });
  assert.deepEqual(insertAttachmentText("text", "end", Infinity, Infinity), { value: "textend", caret: 7 });
  assert.deepEqual(insertAttachmentText("text", "start", -10, -2), { value: "starttext", caret: 5 });
});

test("Pending image previews stay compact, named and removable while ordinary files keep their cards", () => {
  const name = "很长的合成图片名称<script>不执行</script>.png";
  const html = renderToStaticMarkup(<PendingAttachments attachments={[
    { id: "image", name, size: 2048, mime: "image/png", previewUrl: "blob:null/synthetic-image" },
    { id: "file", name: "synthetic.txt", size: 0, mime: "text/plain" },
    { id: "unsafe", name: "remote.png", previewUrl: "https://example.invalid/tracker.png" },
  ]} disabled={false} onRemove={() => {}} />);
  assert.equal((html.match(/<img /g) ?? []).length, 1);
  assert.match(html, /src="blob:null\/synthetic-image"/);
  assert.match(html, /alt="图片预览：很长的合成图片名称/);
  assert.match(html, /title="很长的合成图片名称&lt;script&gt;不执行&lt;\/script&gt;\.png · 2 KB · image\/png"/);
  assert.match(html, /title="synthetic\.txt · 0 B · text\/plain"/);
  assert.match(html, /aria-label="移除附件 synthetic\.txt"/);
  assert.doesNotMatch(html, /<script>|example\.invalid|file:\/\/|disabled=""/);
  const disabled = renderToStaticMarkup(<PendingAttachments attachments={[{ id: "file", name: "synthetic.txt" }]} disabled onRemove={() => {}} />);
  assert.match(disabled, /<button[^>]*disabled=""/);
});

test("Unreported or invalid attachment sizes are omitted instead of inventing a size", () => {
  for (const value of [undefined, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(attachmentSize(value), undefined);
  assert.equal(attachmentSize(0), "0 B");
  assert.equal(attachmentSize(1536), "1.5 KB");
  assert.equal(attachmentSize(1024 * 1024), "1 MB");
});

test("Only an interactive native composer advertises an enabled attachment drop target", () => {
  const state: LorcaShellState = {
    connection: { status: "connected", endpoint: "ws://127.0.0.1:4862/ws" }, conversations: [], activeConversationId: null, messages: [], agents: [], selectedAgentId: null,
    busy: false, loading: false, hasMore: false, loadingOlder: false, error: null, queue: [], demo: false, attachmentsEnabled: true,
  };
  const form = (value: LorcaShellState) => renderToStaticMarkup(<LorcaShell state={value} actions={actions} />).match(/<form[^>]*data-attachment-composer[^>]*>/)?.[0];
  assert.ok(form(state));
  assert.doesNotMatch(form(state)!, /data-attachment-disabled/);
  for (const patch of [{ demo: true }, { loading: true }, { attachmentsEnabled: false }, { connection: { ...state.connection, status: "disconnected" as const } }]) {
    assert.match(form({ ...state, ...patch })!, /data-attachment-disabled="true"/);
  }
});
