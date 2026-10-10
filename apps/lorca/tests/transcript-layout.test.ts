import assert from "node:assert/strict";
import { test } from "node:test";
import { hasTranscriptLayoutUpdate, type TranscriptLayout } from "../src/ui/transcript-layout";
import type { LorcaMessage } from "../src/ui/types";

const messages: LorcaMessage[] = [
  { kind: "message", id: "user", role: "user", text: "Synthetic draft", attachments: [{ id: "file", name: "example.txt" }] },
  { kind: "message", id: "assistant", role: "assistant", text: "Synthetic response", streaming: true },
  { kind: "tool", id: "tool", name: "read", status: "running", input: "example.txt", output: "Synthetic output" },
  { kind: "approval", id: "approval", title: "Synthetic request", detail: "Permission description", status: "pending", canAllow: true },
  { kind: "notice", id: "notice", text: "Synthetic notice", tone: "info" },
  { kind: "cross-agent", id: "cross", direction: "incoming", from: null, to: null, text: "Synthetic forwarded message" },
];
const layout: TranscriptLayout = { messages, height: 680, viewportHeight: 600, width: 1000 };

test("Identical projected messages never trigger follow-tail during unrelated state refreshes", () => {
  assert.equal(hasTranscriptLayoutUpdate(layout, layout), false);
  for (let refresh = 0; refresh < 4; refresh++) {
    assert.equal(hasTranscriptLayoutUpdate(layout, { ...layout, messages: structuredClone(messages) }), false);
  }
});

test("Actual timeline content changes trigger follow-tail even when height stays constant", () => {
  for (let index = 0; index < messages.length; index++) {
    const changed = structuredClone(messages);
    const message = changed[index];
    if (message.kind === "tool") message.output += " updated";
    else if (message.kind === "approval") message.status = "approved";
    else message.text += " updated";
    assert.equal(hasTranscriptLayoutUpdate(layout, { ...layout, messages: changed }), true, message.kind);
  }
  assert.equal(hasTranscriptLayoutUpdate(layout, { ...layout, messages: [...messages, { kind: "notice", id: "new", text: "New message", tone: "info" }] }), true);
  assert.equal(hasTranscriptLayoutUpdate(layout, { ...layout, messages: messages.slice(1) }), true);
  assert.equal(hasTranscriptLayoutUpdate(layout, { ...layout, messages: [...messages].reverse() }), true);
});

test("Geometry changes remain observable without treating a new array identity as layout", () => {
  for (const patch of [{ height: 720 }, { viewportHeight: 560 }, { width: 760 }]) {
    assert.equal(hasTranscriptLayoutUpdate(layout, { ...layout, ...patch }), true);
  }
  const imageOnly: LorcaMessage[] = messages.map((message) => message.kind === "message" && message.role === "assistant"
    ? { ...message, authorAvatar: { botId: "bot", name: "Bot", symbolName: "sparkles", accent: "indigo", image: "data:image/png;base64,iVBORw0KGgo=" } }
    : message);
  assert.equal(hasTranscriptLayoutUpdate(layout, { ...layout, messages: imageOnly }), false);
});
