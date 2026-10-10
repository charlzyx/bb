import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { LorcaController } from "../src/core/controller";
import { demoSnapshot } from "../src/core/demo";
import type { BridgeStatus, LorcaBridge, PickedAttachment } from "../src/core/bridge";
const require = createRequire(import.meta.url);
const { AttachmentSelections } = require("../native/attachments.cjs");
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) { if (check()) return; await tick(); }
  assert.fail("Synthetic attachment operation did not finish");
}
class FakeBridge implements LorcaBridge {
  status: BridgeStatus = { status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token" };
  registry = new AttachmentSelections();
  events = new Set<(value: unknown) => void>();
  statuses = new Set<(status: BridgeStatus) => void>();
  released: string[][] = [];
  calls: { method: string; params: Record<string, unknown> }[] = [];
  paths: string[] = [];
  picker: (() => Promise<PickedAttachment[]>) | undefined;
  handler = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    if (method === "bootstrap") return structuredClone(demoSnapshot);
    if (method === "chats.send") return { message: { id: params.message_id, chat_id: params.chat_id, author: { kind: "you" }, body: { kind: "text", text: params.text }, state: { kind: "complete" }, created_at: 1 } };
    throw new Error("Unexpected synthetic method");
  };
  getStatus = async () => this.status;
  connect = async () => this.status;
  request = async (method: string, params: Record<string, unknown>) => { this.calls.push({ method, params }); return this.handler(method, params); };
  pickAttachments = async (): Promise<PickedAttachment[]> => this.picker ? this.picker() : this.registry.add(this.paths);
  releaseAttachments = async (ids: string[]) => { this.released.push(ids); this.registry.release(ids); };
  sendAttachments: NonNullable<LorcaBridge["sendAttachments"]> = params => this.registry.send({ getStatus: () => this.status, sendValidated: this.request }, params);
  onEvent = (callback: (value: unknown) => void) => { this.events.add(callback); return () => { this.events.delete(callback); }; };
  onStatus = (callback: (status: BridgeStatus) => void) => { this.statuses.add(callback); return () => { this.statuses.delete(callback); }; };
  event(value: unknown) { for (const callback of this.events) callback(value); }
  change() { this.status = { ...this.status, generation: this.status.generation + 1 }; for (const callback of this.statuses) callback(this.status); }
}
async function fixture(context: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(tmpdir(), "dots-attachment-lifecycle-"));
  const file = path.join(directory, "synthetic.txt");
  await writeFile(file, "Synthetic attachment, never sent to a service");
  const bridge = new FakeBridge(); bridge.paths = [file];
  const controller = new LorcaController(bridge);
  context.after(async () => { controller.dispose(); await rm(directory, { recursive: true, force: true }); });
  await controller.start(); await tick();
  const pick = async () => { controller.actions.onPickAttachments?.(); await until(() => Boolean(controller.getSnapshot().pendingAttachments?.length)); await tick(); return controller.getSnapshot().pendingAttachments!; };
  return { bridge, controller, pick, file };
}

test("repeated pick and remove releases native handles instead of exhausting the fifty-selection budget", async context => {
  const { bridge, controller, pick, file } = await fixture(context);
  for (let i = 0; i < 65; i++) {
    const [selected] = await pick(); controller.actions.onRemoveAttachment?.(selected.id);
    assert.equal(bridge.registry.files.size, 0);
  }
  assert.equal(bridge.released.length, 65);
  assert.match(await readFile(file, "utf8"), /^Synthetic attachment/);
});
for (const boundary of ["new chat", "select chat", "reconnect", "new generation", "identity", "dispose"] as const) {
  test(`discarding attachment selections releases handles at ${boundary}`, async context => {
    const { bridge, controller, pick } = await fixture(context); const [selected] = await pick();
    if (boundary === "new chat") controller.actions.onNewConversation();
    if (boundary === "select chat") controller.actions.onSelectConversation("chat-demo");
    if (boundary === "reconnect") controller.actions.onReconnect();
    if (boundary === "new generation") bridge.change();
    if (boundary === "identity") bridge.event({ event: "identity.changed", data: { has_identity: true } });
    if (boundary === "dispose") controller.dispose();
    assert(bridge.released.flat().includes(selected.id)); assert.equal(bridge.registry.files.size, 0);
  });
}
test("files omitted by the ten-attachment UI cap are released immediately", async context => {
  const { bridge, controller, file } = await fixture(context); bridge.paths = Array(9).fill(file);
  controller.actions.onPickAttachments?.(); await until(() => controller.getSnapshot().pendingAttachments?.length === 9); await tick();
  bridge.paths = Array(3).fill(file); controller.actions.onPickAttachments?.(); await until(() => controller.getSnapshot().pendingAttachments?.length === 10); await tick();
  assert.equal(bridge.registry.files.size, 10); assert.equal(bridge.released.flat().length, 2);
});
for (const boundary of ["navigation", "generation", "identity", "dispose"] as const) {
  test(`a picker that returns after ${boundary} releases its unused handles`, async context => {
    const { bridge, controller, file } = await fixture(context); const picked = await bridge.registry.add([file]);
    const pending = deferred<PickedAttachment[]>(); bridge.picker = () => pending.promise; controller.actions.onPickAttachments?.();
    if (boundary === "navigation") controller.actions.onNewConversation();
    if (boundary === "generation") bridge.change();
    if (boundary === "identity") bridge.event({ event: "identity.changed", data: { has_identity: true } });
    if (boundary === "dispose") controller.dispose();
    pending.resolve(picked); await tick();
    assert.equal(bridge.registry.files.size, 0); assert(bridge.released.flat().includes(picked[0].id));
  });
}
test("navigation during chat creation cannot release the attachments captured by an in-flight send", async context => {
  const { bridge, controller, pick } = await fixture(context); const [selected] = await pick(); const creating = deferred<unknown>();
  const original = bridge.handler; bridge.handler = (method, params) => method === "chats.create" ? creating.promise : original(method, params);
  const sending = controller.actions.onSend("Selected before navigation"); controller.actions.onNewConversation();
  assert.equal(bridge.registry.files.size, 1); assert.equal(bridge.released.flat().includes(selected.id), false);
  creating.resolve({ chat: { id: "created-chat", kind: "dm", title: null, bot_ids: ["bot-demo"], created_at: 1 } });
  assert.deepEqual(await sending, { chatId: "created-chat" }); assert.equal(bridge.registry.files.size, 0);
  assert.equal(bridge.calls.filter(call => call.method === "chats.send").length, 1);
});
test("unknown attachment send outcome releases detached handles without replaying the message", async context => {
  const { bridge, controller, pick } = await fixture(context); controller.actions.onSelectConversation("chat-demo"); const [selected] = await pick();
  bridge.handler = async () => { throw new Error("Synthetic outcome unknown"); };
  await assert.rejects(Promise.resolve(controller.actions.onSend("Do not retry")), /outcome unknown/);
  assert.equal(bridge.registry.files.size, 0); assert(bridge.released.flat().includes(selected.id));
  assert.equal(bridge.calls.filter(call => call.method === "chats.send").length, 1);
});
test("saving the canonical current endpoint preserves a selected attachment through the next send", async context => {
  const { bridge, controller, pick } = await fixture(context); controller.actions.onSelectConversation("chat-demo"); const [selected] = await pick();
  await controller.actions.onSaveEndpoint("ws://localhost:4862/ws");
  assert.equal(controller.getSnapshot().pendingAttachments?.[0].id, selected.id); assert.equal(bridge.registry.files.size, 1);
  await controller.actions.onSend(""); assert.equal(bridge.registry.files.size, 0); assert.equal(bridge.calls.filter(call => call.method === "chats.send").length, 1);
});
test("native release is bounded, opaque, idempotent, and never interrupts a busy send", async context => {
  const { bridge, file } = await fixture(context); const [selected] = await bridge.registry.add([file]);
  for (const invalid of [null, {}, [file], [selected.id, 5], Array(51).fill(selected.id)]) assert.throws(() => bridge.registry.release(invalid), /附件选择标识无效/);
  assert.equal(bridge.registry.files.size, 1); const reply = deferred<unknown>();
  const pending = bridge.registry.send({ getStatus: () => bridge.status, sendValidated: () => reply.promise }, { chat_id: "chat-demo", text: "", selection_ids: [selected.id] });
  bridge.registry.release([selected.id]); assert.equal(bridge.registry.files.size, 1);
  reply.resolve({ accepted: true }); await pending;
  bridge.registry.release([selected.id]); bridge.registry.release(["0".repeat(32)]); assert.equal(bridge.registry.files.size, 0);
  assert.match(await readFile(file, "utf8"), /^Synthetic attachment/);
});

test("failed chat creation keeps the still-visible selected file usable", async context => {
  const { bridge, controller, pick } = await fixture(context); const [selected] = await pick();
  bridge.handler = async () => { throw new Error("Synthetic create failure"); };
  await assert.rejects(Promise.resolve(controller.actions.onSend("Keep this file")), /create failure/);
  assert.equal(controller.getSnapshot().pendingAttachments?.[0].id, selected.id);
  assert.equal(bridge.registry.files.size, 1);
  assert.equal(bridge.released.flat().includes(selected.id), false);
});

test("main IPC preserves files on a same-endpoint save, clears actual reconnects, and rejects forged release sources", async context => {
  const { file } = await fixture(context);
  const handlers = new Map<string, (...args: any[]) => any>();
  const actualBridge = require("../native/bridge.cjs");
  let nativeRegistry: any;
  let nativeBridge: any;
  class NativeBridge extends EventEmitter {
    status: BridgeStatus = { status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token" };
    constructor() { super(); nativeBridge = this; }
    getStatus() { return { ...this.status }; }
    async connect(value: string) {
      const endpoint = actualBridge.validateEndpoint(value);
      if (endpoint === this.status.endpoint && this.status.status === "connected") return this.getStatus();
      this.status = { ...this.status, endpoint, generation: this.status.generation + 1, status: "connecting" };
      this.emit("status", this.getStatus()); this.status.status = "connected"; this.emit("status", this.getStatus()); return this.getStatus();
    }
    async sendValidated(_method: string, params: Record<string, unknown>) { return { message: { id: params.message_id, chat_id: params.chat_id } }; }
    close() {}
  }
  class Contents extends EventEmitter {
    mainFrame = { url: "" };
    session = Object.assign(new EventEmitter(), { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {}, onHeadersReceived() {} } });
    send() {}
    setWindowOpenHandler() {}
  }
  let window!: FakeWindow;
  class FakeWindow extends EventEmitter {
    webContents = new Contents();
    constructor() { super(); window = this; }
    isDestroyed() { return false; }
    setMenuBarVisibility() {}
    async loadFile(file: string) { this.webContents.mainFrame.url = pathToFileURL(file).href; }
  }
  const electron = {
    app: Object.assign(new EventEmitter(), { whenReady: () => Promise.resolve() }), BrowserWindow: FakeWindow,
    ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) }, clipboard: {},
    Menu: { setApplicationMenu() {}, buildFromTemplate() {} }, nativeImage: {},
  };
  const source = await readFile(new URL("../native/main.cjs", import.meta.url), "utf8");
  runInNewContext(source, {
    __dirname: fileURLToPath(new URL("../native", import.meta.url)), process: { env: {}, platform: "linux" },
    require: (name: string) => {
      if (name === "electron") return electron;
      if (name === "./bridge.cjs") return { ...actualBridge, LorcaBridge: NativeBridge };
      if (name === "./attachments.cjs") return { AttachmentSelections: class extends AttachmentSelections { constructor() { super(); nativeRegistry = this; } } };
      if (name === "./branding.cjs") return { APP_NAME: "dots", configureApplicationName() {}, configureApplicationBranding() {} };
      if (name === "./menu.cjs") return { applicationMenuTemplate: () => [] };
      if (name === "./secure-settings.cjs") return { createSecureSettingsEditor: () => ({ edit() {}, close() {} }) };
      if (name === "./settings-editor.cjs") return { SettingsEditor: class {} };
      if (name === "./settings.cjs") return { SettingsInventory: class { capture() {} check() {} }, sanitizeRendererResult: (_method: string, value: unknown) => value, sanitizeRendererEvent: (value: unknown) => value, safeRendererError: (error: unknown) => error };
      return require(name);
    },
  });
  await tick();
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const [selected] = await handlers.get("lorca:pick-attachments")!(event);
  await handlers.get("lorca:connect")!(event, "ws://localhost:4862/ws");
  assert.equal(nativeRegistry.files.size, 1);
  assert.throws(() => handlers.get("lorca:release-attachments")!({ ...event, senderFrame: { ...event.senderFrame } }, [selected.id]), /来源不可信/);
  assert.equal(nativeRegistry.files.size, 1);
  await handlers.get("lorca:send-attachments")!(event, { chat_id: "synthetic-chat", text: "", message_id: "synthetic-message", selection_ids: [selected.id] });
  assert.equal(nativeRegistry.files.size, 0);
  const [unused] = await handlers.get("lorca:pick-attachments")!(event);
  handlers.get("lorca:release-attachments")!(event, [unused.id]); assert.equal(nativeRegistry.files.size, 0);
  await handlers.get("lorca:pick-attachments")!(event);
  await handlers.get("lorca:connect")!(event, "ws://localhost:4863/ws");
  assert.equal(nativeRegistry.files.size, 0); assert.equal(nativeBridge.status.generation, 2);
  await handlers.get("lorca:pick-attachments")!(event);
  nativeBridge.emit("status", { ...nativeBridge.getStatus(), status: "disconnected" });
  assert.equal(nativeRegistry.files.size, 0);
  assert.match(await readFile(file, "utf8"), /^Synthetic attachment/);
});
