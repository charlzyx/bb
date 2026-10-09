import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, safeMarkdownUrl } from "./markdown";
import { TranscriptItem } from "./Transcript";
import { validateEndpoint } from "./Settings";
import type { LorcaShellActions, LorcaMessage } from "./types";

const actions: LorcaShellActions = {
  onSelectConversation() {},
  onNewConversation() {},
  onSend() {},
  onStop() {},
  onSendNow() {},
  onLoadOlder() {},
  onSelectAgent() {},
  async onSaveEndpoint() {},
  onReconnect() {},
  onApproval() {},
};

function renderMessage(message: LorcaMessage) {
  return renderToStaticMarkup(
    <TranscriptItem message={message} actions={actions} disabled={false} />,
  );
}

test("Markdown never injects raw HTML, executes URLs, or loads remote images", () => {
  const html = renderToStaticMarkup(
    <Markdown
      text={
        "Hello <script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)\n\n![remote image](https://example.com/tracker.png)\n\n[safe reference](https://example.com)"
      }
    />,
  );
  assert.doesNotMatch(html, /<script|<img|href=|javascript:/i);
  assert.match(html, /remote image/);
  assert.match(html, /safe reference/);
  assert.match(html, /title="https:\/\/example.com\//);
});

test("Markdown formats fenced code as escaped text with a copy action", () => {
  const html = renderToStaticMarkup(
    <Markdown text={"```html\n<img src=x onerror=alert(1)>\n```"} />,
  );
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /aria-label="Copy code"/);
  assert.doesNotMatch(html, /<img/);
});

test("Unsafe or local file URL references are rejected", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///etc/passwd",
    "//example.com",
    "/private/path",
    "lorca://admin",
  ]) {
    assert.equal(safeMarkdownUrl(value), undefined, value);
  }
  assert.equal(
    safeMarkdownUrl("https://example.com/docs"),
    "https://example.com/docs",
  );
});

test("Approval controls match capabilities without inventing persistent permission", () => {
  const base: Extract<LorcaMessage, { kind: "approval" }> = {
    kind: "approval",
    id: "a1",
    title: "Run a command",
    detail: "echo hello",
    status: "pending",
  };
  const normal = renderMessage(base);
  assert.match(normal, /Allow once/);
  assert.match(normal, />Deny</);
  assert.doesNotMatch(normal, /Always allow/);
  const restricted = renderMessage({
    ...base,
    canAllow: false,
    canAlways: true,
  });
  assert.doesNotMatch(restricted, /Allow once|Always allow/);
  assert.match(restricted, />Deny</);
  const persistent = renderMessage({ ...base, canAlways: true });
  assert.match(persistent, /Always allow this tool/);
  const expired = renderMessage({
    ...base,
    status: "expired",
    canAlways: true,
  });
  assert.match(expired, /Expired/);
  assert.doesNotMatch(expired, /Allow once|Always allow|>Deny</);
});

test("Attachment-only messages show names as text without paths or navigation", () => {
  const html = renderMessage({
    kind: "message",
    id: "m1",
    role: "user",
    text: "",
    attachments: [
      {
        id: "opaque-1",
        name: "<report & notes>.pdf",
        mimeType: "application/pdf",
      },
    ],
  });
  assert.match(html, /&lt;report &amp; notes&gt;.pdf/);
  assert.doesNotMatch(html, /href=|src=|opaque-1/);
});

test("Tool input and output are escaped, with distinct failure status", () => {
  const html = renderMessage({
    kind: "tool",
    id: "t1",
    name: "Read file",
    status: "error",
    input: "<script>bad</script>",
    output: "File not found",
  });
  assert.match(html, /Failed/);
  assert.match(html, /File not found/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("Endpoint configuration allows loopback WebSockets only, without secrets", () => {
  for (const value of [
    "ws://127.0.0.1:9476/ws",
    "ws://localhost:9476/ws",
    "ws://localhost:00080/ws",
  ])
    assert.equal(validateEndpoint(value), null);
  for (const value of [
    "wss://[::1]:9476/ws",
    "ws://[::1]:9476/ws",
    "wss://localhost:9476/ws",
    "ws://localhost/ws",
    "ws://localhost:0/ws",
    "ws://localhost:65536/ws",
    "ws://127.1:9476/ws",
    "ws://LOCALHOST:9476/ws",
    "https://localhost:9476/ws",
    "ws://remote.example/ws",
    "ws://localhost/",
    "ws://localhost/ws?token=secret",
    "ws://user:secret@localhost/ws",
    "ws://localhost/ws#secret",
    "not a url",
  ])
    assert.notEqual(validateEndpoint(value), null, value);
});

test("Failed text messages preserve partial content and show their error", () => {
  for (const role of ["user", "assistant"] as const) {
    const html = renderMessage({
      kind: "message",
      id: "failed-1",
      role,
      text: "Partial response",
      error: "Runner disconnected",
    });
    assert.match(html, /Partial response/);
    assert.match(html, /role="alert"/);
    assert.match(html, /Runner disconnected/);
  }
});

test("Named assistant identities are preserved in headers and accessible labels", () => {
  const html = renderMessage({
    kind: "message",
    id: "named-1",
    role: "assistant",
    authorName: "Fixture Bot",
    text: "Named bot response",
  });
  assert.match(html, /aria-label="Fixture Bot response"/);
  assert.match(html, /<span>Fixture Bot<\/span>/);
  assert.doesNotMatch(html, /<span>Lorca<\/span>/);
});

test("Renderer endpoint validation stays aligned with the native boundary", () => {
  const { validateEndpoint: validateNativeEndpoint } = createRequire(
    import.meta.url,
  )("../../native/bridge.cjs");
  const candidates = [
    "",
    " ws://localhost:4862/ws",
    "ws://localhost:4862/ws ",
    "ws://user:pass@localhost:4862/ws",
    "ws://localhost:4862/ws?token=test",
    "ws://localhost:4862/ws#hash",
  ];
  for (const scheme of ["ws", "wss", "http"]) {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "127.0.0.1",
      "127.1",
      "[::1]",
      "remote.invalid",
    ]) {
      for (const port of [
        "",
        "0",
        "1",
        "80",
        "00080",
        "000080",
        "65535",
        "65536",
        "-1",
      ])
        candidates.push(`${scheme}://${host}:${port}/ws`);
    }
  }
  for (const value of candidates) {
    let nativeAccepted = true;
    try {
      validateNativeEndpoint(value);
    } catch {
      nativeAccepted = false;
    }
    assert.equal(validateEndpoint(value) === null, nativeAccepted, value);
  }
});
