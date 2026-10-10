import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AttachmentImportEvent, BridgeStatus, LorcaBridge, PickedAttachment } from "../src/core/bridge";
import { LorcaController } from "../src/core/controller";
import { demoSnapshot } from "../src/core/demo";

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(check: () => boolean) {
  for (let index = 0; index < 100; index++) { if (check()) return; await tick(); }
  assert.fail("Synthetic controller operation did not settle");
}
const attachment = (id: string): PickedAttachment => ({ id, name: `${id}.png`, size: 68, mime: "image/png", previewUrl: `blob:null/${id}` });
const snapshot = () => ({ ...structuredClone(demoSnapshot), identity_id: "synthetic-account" });
const sendResponse = (params: Record<string, unknown>) => ({ message: {
  id: params.message_id, chat_id: params.chat_id, author: { kind: "you" },
  body: { kind: "text", text: params.text }, state: { kind: "complete" }, created_at: 1,
} });

class ImportBridge implements LorcaBridge {
  status: BridgeStatus = { status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token" };
  snapshot = snapshot();
  events = new Set<(event: unknown) => void>();
  statuses = new Set<(status: BridgeStatus) => void>();
  imports = new Set<(event: AttachmentImportEvent) => void>();
  texts = new Set<(text: string) => void>();
  scopes: (string | null)[] = [];
  released: string[][] = [];
  calls: { method: string; params: Record<string, unknown> }[] = [];
  picked: PickedAttachment[] = [];
  scopeHandler = async (_scope: string | null): Promise<void> => {};
  picker = async (): Promise<PickedAttachment[]> => this.picked;
  handler = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    if (method === "bootstrap") return structuredClone(this.snapshot);
    if (method === "attachments.send") return sendResponse(params);
    throw new Error(`Unexpected synthetic method: ${method}`);
  };
  getStatus = async () => this.status;
  connect = async () => this.status;
  request = async (method: string, params: Record<string, unknown>) => { this.calls.push({ method, params }); return this.handler(method, params); };
  pickAttachments = () => this.picker();
  releaseAttachments = async (ids: string[]) => { this.released.push(ids); };
  sendAttachments: NonNullable<LorcaBridge["sendAttachments"]> = params => this.request("attachments.send", params);
  setAttachmentScope = async (scope: string | null) => { this.scopes.push(scope); await this.scopeHandler(scope); };
  onAttachmentImport = (listener: (event: AttachmentImportEvent) => void) => { this.imports.add(listener); return () => { this.imports.delete(listener); }; };
  onAttachmentText = (listener: (text: string) => void) => { this.texts.add(listener); return () => { this.texts.delete(listener); }; };
  onEvent = (listener: (event: unknown) => void) => { this.events.add(listener); return () => { this.events.delete(listener); }; };
  onStatus = (listener: (status: BridgeStatus) => void) => { this.statuses.add(listener); return () => { this.statuses.delete(listener); }; };
  event(value: unknown) { for (const listener of this.events) listener(value); }
  change(patch: Partial<BridgeStatus>) { this.status = { ...this.status, ...patch }; for (const listener of this.statuses) listener(this.status); }
  import(files: PickedAttachment[], scope = this.scope(), duplicates = 0, error?: string) { for (const listener of this.imports) listener({ scope, attachments: files, duplicates, error }); }
  text(text: string) { for (const listener of this.texts) listener(text); }
  scope(): string { const value = this.scopes.at(-1); assert.equal(typeof value, "string"); return value!; }
}

async function fixture(context: { after: (callback: () => void) => void }) {
  const bridge = new ImportBridge(), controller = new LorcaController(bridge);
  context.after(() => controller.dispose());
  await controller.start();
  await until(() => typeof bridge.scopes.at(-1) === "string");
  return { bridge, controller };
}

test("native import scope is absent before bootstrap and only changes with draft boundaries", async context => {
  const bridge = new ImportBridge(), loading = deferred<unknown>();
  bridge.handler = async () => loading.promise;
  const controller = new LorcaController(bridge); context.after(() => controller.dispose());
  await controller.start();
  assert.deepEqual(bridge.scopes, [null]);
  loading.resolve(bridge.snapshot); await until(() => bridge.scopes.length === 2);
  const scope = bridge.scope();
  assert.ok(scope.length <= 256);
  assert.match(scope, /^g\d+:a\d+:n\d+$/);
  assert.doesNotMatch(scope, /synthetic-account/);
  controller.actions.onRemoveAttachment?.("absent");
  controller.actions.onRemoveAttachment?.("still-absent");
  assert.deepEqual(bridge.scopes, [null, scope]);
});

test("imported metadata is bounded, projected and staged without a message RPC", async context => {
  const { bridge, controller } = await fixture(context);
  const incoming = { ...attachment("image"), path: "/synthetic/private/path", bytes: "SYNTHETIC_SECRET" };
  bridge.import([incoming]);
  assert.deepEqual(controller.getSnapshot().pendingAttachments, [attachment("image")]);
  assert.equal(JSON.stringify(controller.getSnapshot().pendingAttachments).includes("SYNTHETIC_SECRET"), false);
  assert.equal(bridge.calls.filter(call => call.method !== "bootstrap").length, 0);
});

test("duplicate opaque IDs are not re-added or released while the kept grant is still selected", async context => {
  const { bridge, controller } = await fixture(context);
  bridge.import([attachment("one"), attachment("one")]);
  bridge.import([attachment("one"), attachment("two")], bridge.scope(), 2);
  assert.deepEqual(controller.getSnapshot().pendingAttachments?.map(file => file.id), ["one", "two"]);
  assert.match(controller.getSnapshot().error ?? "", /3 个重复附件/);
  assert.deepEqual(bridge.released, []);
});

test("the ten-file limit releases excess unique handles and reports the reason", async context => {
  const { bridge, controller } = await fixture(context);
  bridge.import(Array.from({ length: 9 }, (_, index) => attachment(`existing-${index}`)));
  bridge.import([attachment("tenth"), attachment("excess-one"), attachment("excess-two")]);
  assert.equal(controller.getSnapshot().pendingAttachments?.length, 10);
  assert.deepEqual(bridge.released, [["excess-one", "excess-two"]]);
  assert.match(controller.getSnapshot().error ?? "", /最多 10 个.*2 个/);
});

for (const change of ["new conversation", "select conversation", "account", "connection", "endpoint", "authentication mode", "reconnect", "disconnect", "dispose"] as const) {
  test(`late import after ${change} never enters the current draft`, async context => {
    const { bridge, controller } = await fixture(context);
    const previous = bridge.scope();
    const callback = [...bridge.imports][0]!;
    bridge.import([attachment("selected")]);
    if (change === "new conversation") controller.actions.onNewConversation();
    if (change === "select conversation") controller.actions.onSelectConversation("chat-demo");
    if (change === "account") bridge.event({ event: "snapshot", data: { ...bridge.snapshot, identity_id: "other-synthetic-account" } });
    if (change === "connection") { bridge.change({ generation: 2 }); await tick(); }
    if (change === "endpoint") { bridge.change({ endpoint: "ws://127.0.0.1:4863/ws" }); await tick(); }
    if (change === "authentication mode") { bridge.change({ authMode: "legacy" }); await tick(); }
    if (change === "reconnect") { controller.actions.onReconnect(); await tick(); }
    if (change === "disconnect") bridge.change({ status: "disconnected" });
    if (change === "dispose") controller.dispose();
    callback({ scope: previous, attachments: [attachment("late")], duplicates: 0 });
    assert.deepEqual(controller.getSnapshot().pendingAttachments, change === "dispose" ? [attachment("selected")] : []);
    assert.ok(bridge.released.flat().includes("selected"));
    assert.ok(bridge.released.flat().includes("late"));
    if (change === "disconnect" || change === "dispose") assert.equal(bridge.scopes.at(-1), null);
    else assert.notEqual(bridge.scopes.at(-1), previous);
  });
}

test("temporary bootstrap refresh preserves the draft scope and selected grants but rejects new import", async context => {
  const { bridge, controller } = await fixture(context);
  bridge.import([attachment("selected")]);
  const scope = bridge.scope(), scopes = bridge.scopes.slice(), loading = deferred<unknown>();
  bridge.handler = async () => loading.promise;
  const refresh = controller.refresh();
  assert.deepEqual(bridge.scopes, scopes);
  assert.deepEqual(controller.getSnapshot().pendingAttachments, [attachment("selected")]);
  bridge.import([attachment("late-during-refresh")], scope);
  assert.deepEqual(bridge.released, [["late-during-refresh"]]);
  loading.resolve(bridge.snapshot); await refresh;
  assert.deepEqual(bridge.scopes, scopes);
  assert.deepEqual(controller.getSnapshot().pendingAttachments, [attachment("selected")]);
});

test("a stale scope-binding rejection cannot disable a newly selected draft", async context => {
  const bridge = new ImportBridge(), oldBinding = deferred<void>();
  bridge.scopeHandler = async scope => { if (scope && bridge.scopes.filter(value => value !== null).length === 1) await oldBinding.promise; };
  const controller = new LorcaController(bridge); context.after(() => controller.dispose());
  await controller.start(); await until(() => typeof bridge.scopes.at(-1) === "string");
  const oldScope = bridge.scope();
  controller.actions.onNewConversation();
  assert.notEqual(bridge.scope(), oldScope);
  oldBinding.reject(new Error("Old synthetic scope error")); await tick();
  bridge.import([attachment("current")]);
  assert.deepEqual(controller.getSnapshot().pendingAttachments, [attachment("current")]);
  assert.equal(controller.getSnapshot().error, null);
});

test("disposing and restarting the same controller cannot reuse the prior import scope", async context => {
  const { bridge, controller } = await fixture(context);
  const oldScope = bridge.scope(), oldListener = [...bridge.imports][0]!;
  controller.dispose();
  assert.equal(bridge.imports.size, 0);
  await controller.start(); await until(() => typeof bridge.scopes.at(-1) === "string");
  assert.notEqual(bridge.scope(), oldScope);
  oldListener({ scope: oldScope, attachments: [attachment("old-lifecycle")], duplicates: 0 });
  assert.deepEqual(controller.getSnapshot().pendingAttachments, []);
  assert.ok(bridge.released.flat().includes("old-lifecycle"));
});

test("removing the selected conversation invalidates its attachment draft rather than moving grants to a new chat", async context => {
  const { bridge, controller } = await fixture(context);
  controller.actions.onSelectConversation("chat-demo");
  const oldScope = bridge.scope();
  bridge.import([attachment("removed-chat")]);
  bridge.event({ event: "chat.removed", data: { chat_id: "chat-demo" } });
  assert.notEqual(bridge.scope(), oldScope);
  assert.deepEqual(controller.getSnapshot().pendingAttachments, []);
  assert.ok(bridge.released.flat().includes("removed-chat"));
  bridge.import([attachment("late-chat")], oldScope);
  assert.ok(bridge.released.flat().includes("late-chat"));
});

test("send keeps its scope and protects the selected grant while rejecting new imports", async context => {
  const { bridge, controller } = await fixture(context);
  controller.actions.onSelectConversation("chat-demo");
  bridge.import([attachment("selected")]);
  const scope = bridge.scope(), scopes = bridge.scopes.slice(), sending = deferred<unknown>();
  bridge.handler = async () => sending.promise;
  const operation = controller.actions.onSend("Explicit synthetic send");
  await until(() => bridge.calls.some(call => call.method === "attachments.send"));
  assert.deepEqual(bridge.scopes, scopes);
  bridge.import([attachment("selected"), attachment("new-during-send")], scope);
  assert.deepEqual(bridge.released, [["new-during-send"]]);
  const request = bridge.calls.find(call => call.method === "attachments.send")!;
  sending.resolve(sendResponse(request.params)); await operation;
  assert.deepEqual(bridge.scopes, scopes);
  assert.deepEqual(controller.getSnapshot().pendingAttachments, []);
  assert.equal(bridge.calls.filter(call => call.method === "attachments.send").length, 1);
  assert.equal(bridge.calls.some(call => call.method === "chats.send"), false);
});

test("an accepted attachment send preserves its original native grant while new-chat creation waits across navigation", async context => {
  const { bridge, controller } = await fixture(context);
  const grants = new Set<string>(), creating = deferred<unknown>();
  let nativeScope = bridge.scope();
  bridge.scopeHandler = async scope => { if (scope !== nativeScope) grants.clear(); nativeScope = scope ?? ""; };
  const selected = attachment("creation-grant"); grants.add(selected.id); bridge.import([selected]);
  const scope = bridge.scope();
  bridge.handler = async (method, params) => {
    if (method === "chats.create") return creating.promise;
    assert.equal(method, "attachments.send");
    assert.deepEqual(params.selection_ids, [selected.id]);
    assert.ok(grants.has(selected.id));
    assert.equal(nativeScope, scope);
    return sendResponse(params);
  };
  const sending = controller.actions.onSend("Accepted before navigation");
  await until(() => bridge.calls.some(call => call.method === "chats.create"));
  controller.actions.onNewConversation();
  assert.deepEqual(controller.getSnapshot().pendingAttachments, []);
  assert.equal(bridge.scope(), scope);
  assert.ok(grants.has(selected.id));
  creating.resolve({ chat: { ...bridge.snapshot.chats[0], id: "created-target", messages: [] } });
  const result = await sending;
  assert.deepEqual(result, { chatId: "created-target" });
  assert.equal(bridge.calls.find(call => call.method === "attachments.send")?.params.chat_id, "created-target");
  assert.notEqual(bridge.scope(), scope);
  assert.equal(controller.getSnapshot().activeConversationId, null);
});

for (const phase of ["creating", "dispatched"] as const) {
  test(`controller and real native attachment session preserve an accepted send across navigation while ${phase}`, async context => {
    const require = createRequire(import.meta.url);
    const { AttachmentSession } = require("../native/attachment-session.cjs");
    const { AttachmentSelections } = require("../native/attachments.cjs");
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "dots-controller-import-fixture-"));
    const bridge = new ImportBridge(), controller = new LorcaController(bridge);
    const creating = deferred<unknown>(), dispatched = deferred<void>(), reply = deferred<void>();
    const selections = new AttachmentSelections();
    let privateTicket: string | null = null, nativeSends = 0;
    const inventory = {
      capture: () => ({ generation: bridge.status.generation, endpoint: bridge.status.endpoint }),
      check: (fence: { generation: number; endpoint: string }) => {
        assert.equal(bridge.status.status, "connected");
        assert.equal(fence.generation, bridge.status.generation);
        assert.equal(fence.endpoint, bridge.status.endpoint);
      },
    };
    const session = new AttachmentSession({
      selections, temporaryDirectory, inventory, chooseFiles: async () => ({ canceled: true, filePaths: [] }),
      bridge: {
        getStatus: () => bridge.status,
        sendValidated: async (method: string, params: { message_id: string; chat_id: string; text: string; attachments: { path: string; name: string }[] }) => {
          nativeSends++;
          assert.equal(method, "chats.send");
          assert.equal(await readFile(params.attachments[0].path, "utf8"), "synthetic cross-layer fixture");
          dispatched.resolve();
          if (phase === "dispatched") await reply.promise;
          return sendResponse(params);
        },
      },
    });
    context.after(async () => { controller.dispose(); await session.shutdown(); await rm(temporaryDirectory, { recursive: true, force: true }); });
    bridge.scopeHandler = async scope => {
      const issued = await session.setScope(scope, () => {});
      if (bridge.scopes.at(-1) === scope) privateTicket = issued?.ticket ?? null;
    };
    bridge.releaseAttachments = async ids => { bridge.released.push(ids); await session.release(ids, () => {}); };
    bridge.sendAttachments = params => session.send(bridge.scope(), privateTicket, params, () => {});
    bridge.handler = async method => {
      if (method === "bootstrap") return bridge.snapshot;
      assert.equal(method, "chats.create");
      return creating.promise;
    };
    await controller.start(); await until(() => privateTicket !== null);
    if (phase === "dispatched") {
      controller.actions.onSelectConversation("chat-demo");
      await until(() => session.scope === bridge.scope());
    }
    const bytes = new TextEncoder().encode("synthetic cross-layer fixture");
    const staged = await session.stage(bridge.scope(), privateTicket, { source: "paste", files: [{ kind: "bytes", name: "fixture.txt", mime: "text/plain", size: bytes.length, bytes }] }, () => {});
    const selected = staged.attachments.map((item: PickedAttachment) => ({ id: item.id, name: item.name, size: item.size, mime: item.mime }));
    bridge.import(selected);
    const scope = bridge.scope();
    const operation = controller.actions.onSend("Explicit synthetic send");
    if (phase === "dispatched") await dispatched.promise;
    else await until(() => bridge.calls.some(call => call.method === "chats.create"));
    controller.actions.onNewConversation();
    assert.equal(bridge.scope(), scope);
    assert.equal(session.scope, scope);
    assert.ok(selections.files.has(selected[0].id));
    if (phase === "creating") creating.resolve({ chat: { ...bridge.snapshot.chats[0], id: "created-fixed-target", messages: [] } });
    else reply.resolve();
    assert.deepEqual(await operation, { chatId: phase === "creating" ? "created-fixed-target" : "chat-demo" });
    assert.equal(nativeSends, 1);
    assert.equal(controller.getSnapshot().activeConversationId, null);
    await until(() => session.scope === bridge.scope());
    assert.notEqual(bridge.scope(), scope);
    assert.equal(selections.files.size, 0);
    assert.deepEqual(await readdir(temporaryDirectory), []);
  });
}

test("text events belong to the live shell and are neither subscribed, queued nor sent by the controller", async context => {
  const { bridge, controller } = await fixture(context);
  assert.equal(bridge.texts.size, 0);
  bridge.text("Synthetic mixed-paste text");
  bridge.import([attachment("file")]);
  bridge.text("More synthetic text");
  assert.deepEqual(controller.getSnapshot().pendingAttachments, [attachment("file")]);
  assert.deepEqual(bridge.calls.map(call => call.method), ["bootstrap"]);
});

test("unsafe preview schemes and invalid metadata never reach attachment rendering", async context => {
  const { bridge, controller } = await fixture(context);
  for (const [index, previewUrl] of ["file:///synthetic", "https://synthetic.invalid/image", "data:image/svg+xml,synthetic"].entries())
    bridge.import([{ id: `unsafe-${index}`, name: "synthetic.txt", previewUrl, size: -1, mime: "bad\nvalue" }]);
  assert.ok(controller.getSnapshot().pendingAttachments?.every(file => !("previewUrl" in file) && !("size" in file) && !("mime" in file)));
  bridge.import([{ id: "bad-name", name: "bad\0name" }]);
  assert.ok(bridge.released.flat().includes("bad-name"));
  assert.match(controller.getSnapshot().error ?? "", /附件信息无效/);
});

test("native import errors and duplicate counts remain visible without sending", async context => {
  const { bridge, controller } = await fixture(context);
  bridge.import([], bridge.scope(), 1, "合成导入失败");
  assert.match(controller.getSnapshot().error ?? "", /合成导入失败.*1 个重复附件/);
  assert.equal(controller.getSnapshot().pendingAttachments?.length, 0);
  assert.deepEqual(bridge.calls.map(call => call.method), ["bootstrap"]);
});

test("failure to bind an import scope is visible and does not fall back or replay", async context => {
  const bridge = new ImportBridge();
  bridge.scopeHandler = async scope => { if (scope) throw new Error("SYNTHETIC_PRIVATE_ERROR"); };
  const controller = new LorcaController(bridge); context.after(() => controller.dispose());
  await controller.start(); await until(() => Boolean(controller.getSnapshot().error));
  const scope = bridge.scope();
  bridge.import([attachment("rejected")], scope);
  assert.deepEqual(controller.getSnapshot().pendingAttachments, []);
  assert.deepEqual(bridge.released, [["rejected"]]);
  assert.match(controller.getSnapshot().error ?? "", /无法启用/);
  assert.doesNotMatch(controller.getSnapshot().error ?? "", /SYNTHETIC_PRIVATE_ERROR/);
  assert.deepEqual(bridge.scopes, [null, scope]);
});

test("an incomplete native bridge does not enable import or use arbitrary request fallback", async context => {
  const original = new ImportBridge();
  const bridge: LorcaBridge = {
    connect: original.connect, request: original.request, getStatus: original.getStatus,
    onEvent: original.onEvent, onStatus: original.onStatus,
    setAttachmentScope: original.setAttachmentScope, onAttachmentImport: original.onAttachmentImport,
    pickAttachments: original.pickAttachments,
  };
  const controller = new LorcaController(bridge); context.after(() => controller.dispose());
  await controller.start(); await tick();
  assert.equal(original.imports.size, 0);
  assert.deepEqual(original.scopes, []);
  assert.equal(controller.getSnapshot().attachmentsEnabled, false);
  controller.actions.onPickAttachments?.(); await tick();
  assert.match(controller.getSnapshot().error ?? "", /不支持添加附件/);
  assert.deepEqual(original.calls.map(call => call.method), ["bootstrap"]);
});

test("picker and imported grants share opaque-ID deduplication and the same ten-file limit", async context => {
  const { bridge, controller } = await fixture(context);
  bridge.import([attachment("existing")]);
  bridge.picked = [attachment("existing"), ...Array.from({ length: 10 }, (_, index) => attachment(`picked-${index}`))];
  controller.actions.onPickAttachments?.(); await until(() => controller.getSnapshot().pendingAttachments?.length === 10);
  assert.equal(new Set(controller.getSnapshot().pendingAttachments?.map(file => file.id)).size, 10);
  assert.deepEqual(bridge.released, [["picked-9"]]);
  assert.match(controller.getSnapshot().error ?? "", /重复附件.*最多 10 个/);
});
