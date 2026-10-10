import assert from "node:assert/strict";
import test from "node:test";
import { LorcaController } from "../src/core/controller";
import { demoSnapshot } from "../src/core/demo";
import type { BridgeStatus, LorcaBridge } from "../src/core/bridge";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
for (const operation of ["chats.stop", "chats.messages"]) {
  test(`successful send is independent of concurrent ${operation} failure`, async () => {
    const status: BridgeStatus = { status: "connected", endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token" };
    let finish!: (value: unknown) => void;
    let sent: Record<string, unknown> = {};
    const calls: string[] = [];
    const bridge: LorcaBridge = {
      getStatus: async () => status, connect: async () => status,
      onEvent: () => () => {}, onStatus: () => () => {},
      request: async (method, params) => {
        calls.push(method);
        if (method === "bootstrap") {
          const snapshot = structuredClone(demoSnapshot);
          snapshot.chats[0].has_more = true;
          return snapshot;
        }
        if (method === "chats.send") { sent = params; return new Promise(resolve => { finish = resolve; }); }
        throw new Error(`Synthetic ${operation} failure`);
      },
    };
    const controller = new LorcaController(bridge);
    await controller.start(); await tick();
    controller.actions.onSelectConversation("chat-demo");
    const sending = controller.actions.onSend("Accepted message");
    await tick();
    if (operation === "chats.stop") controller.actions.onStop(); else controller.actions.onLoadOlder();
    await tick();
    assert.match(controller.getSnapshot().error ?? "", /Synthetic/);
    finish({ message: { id: sent.message_id, chat_id: sent.chat_id, author: { kind: "you" }, body: { kind: "text", text: sent.text }, state: { kind: "complete" }, created_at: 1791561700 } });
    assert.deepEqual(await sending, { chatId: "chat-demo" });
    assert.equal(calls.filter(method => method === "chats.send").length, 1);
    assert.match(controller.getSnapshot().error ?? "", /Synthetic/);
    controller.dispose();
  });
}
