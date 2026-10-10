import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { LorcaController } from "../src/core/controller";
import { demoRuntimeSettings, demoSnapshot } from "../src/core/demo";
import type { BridgeStatus, LorcaBridge } from "../src/core/bridge";
import type { SettingsAction, SettingsEditor } from "../src/ui/types";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const revision = (runnerId: string) => `revision-${runnerId}`;
const action: SettingsAction = {
  kind: "mcp.setEnabled",
  revision: revision("runner-demo"),
  runnerId: "runner-demo",
  name: "Demo notes",
  enabled: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function inventory(runnerId = "runner-demo", currentRevision = revision(runnerId)) {
  const editor: SettingsEditor = {
    revision: currentRevision,
    models: [{ provider: "demo-provider", id: "synthetic-model", name: "Synthetic model", levels: [] }],
    bots: [{ id: "bot-demo", thinking: null }],
    providers: [{ id: "demo-provider", canConfigure: true, canDisconnect: true }],
    canUpdateBots: true,
    canAddProvider: true,
    canManageMcp: true,
    autoReview: { status: "ready", isEnabled: false, rules: [] },
  };
  return {
    ...structuredClone(demoRuntimeSettings),
    editor,
    mcp: { ...structuredClone(demoRuntimeSettings.mcp), runnerId },
  };
}

class SettingsBridge implements LorcaBridge {
  status: BridgeStatus = {
    status: "connected",
    endpoint: "ws://127.0.0.1:4862/ws",
    generation: 1,
    authMode: "token",
  };
  accountId = "account-one";
  hasIdentity = true;
  rpcCalls: string[] = [];
  settingsCalls: { runnerId?: string }[] = [];
  actionCalls: SettingsAction[] = [];
  events = new Set<(event: unknown) => void>();
  statuses = new Set<(status: BridgeStatus) => void>();
  bootstrap: () => Promise<unknown> = async () => ({
    ...structuredClone(demoSnapshot),
    identity_id: this.accountId,
    has_identity: this.hasIdentity,
  });
  inspect: (options: { runnerId?: string }) => Promise<unknown> = async ({ runnerId }) => inventory(runnerId);
  apply: (value: SettingsAction) => Promise<unknown> = async () => ({ status: "applied" });
  getStatus = async () => this.status;
  connect = async (endpoint: string) => {
    if (endpoint !== this.status.endpoint) {
      this.status = { ...this.status, endpoint };
      this.change(this.status.generation + 1, "connecting");
      this.change(this.status.generation, "connected");
    }
    return this.status;
  };
  request = async (method: string) => {
    this.rpcCalls.push(method);
    assert.equal(method, "bootstrap", "Settings writes must use the bounded native action bridge");
    return this.bootstrap();
  };
  getSettings = async (options: { runnerId?: string }) => {
    this.settingsCalls.push(structuredClone(options));
    return this.inspect(options);
  };
  settingsAction: LorcaBridge["settingsAction"] = async (value) => {
    this.actionCalls.push(structuredClone(value));
    return this.apply(value);
  };
  onEvent = (callback: (event: unknown) => void) => {
    this.events.add(callback);
    return () => this.events.delete(callback);
  };
  onStatus = (callback: (status: BridgeStatus) => void) => {
    this.statuses.add(callback);
    return () => this.statuses.delete(callback);
  };
  event(value: unknown) {
    for (const callback of this.events) callback(value);
  }
  change(generation: number, status: BridgeStatus["status"] = "connected") {
    this.status = { ...this.status, generation, status };
    for (const callback of this.statuses) callback(this.status);
  }
}

function fixture(t: TestContext) {
  const bridge = new SettingsBridge(), controller = new LorcaController(bridge);
  t.after(() => {
    controller.dispose();
    assert.ok(bridge.rpcCalls.every((method) => method === "bootstrap"));
  });
  return { bridge, controller };
}

async function ready(t: TestContext) {
  const result = fixture(t);
  await result.controller.start();
  await tick();
  result.controller.actions.onRefreshSettings("runner-demo");
  await tick();
  assert.equal(result.controller.getSnapshot().runtimeSettings?.editor?.revision, action.revision);
  return result;
}

test("settings apply waits for native acknowledgement, then refreshes the unchanged runner once", async (t) => {
  const { bridge, controller } = await ready(t);
  const pending = deferred<unknown>();
  bridge.apply = () => pending.promise;
  const applying = controller.actions.onSettingsAction(action);
  assert.equal(controller.getSnapshot().settingsApplying, true);
  assert.equal(bridge.settingsCalls.length, 1);
  assert.deepEqual(bridge.actionCalls, [action]);
  bridge.inspect = async ({ runnerId }) => inventory(runnerId, "revision-after-apply");
  pending.resolve({ status: "applied" });

  assert.deepEqual(await applying, { status: "applied" });
  assert.deepEqual(bridge.settingsCalls, [{ runnerId: "runner-demo" }, { runnerId: "runner-demo" }]);
  assert.equal(controller.getSnapshot().runtimeSettings?.editor?.revision, "revision-after-apply");
  assert.equal(controller.getSnapshot().settingsApplying, false);
});

test("a cancelled native settings dialog does not refresh or report an applied change", async (t) => {
  const { bridge, controller } = await ready(t);
  bridge.apply = async () => ({ status: "cancelled" });
  const before = controller.getSnapshot().runtimeSettings;
  assert.deepEqual(await controller.actions.onSettingsAction(action), { status: "cancelled" });
  assert.equal(bridge.actionCalls.length, 1);
  assert.equal(bridge.settingsCalls.length, 1);
  assert.deepEqual(controller.getSnapshot().runtimeSettings, before);
  assert.equal(controller.getSnapshot().settingsApplying, false);
});

test("a duplicate settings apply rejects while the single native dialog is pending", async (t) => {
  const { bridge, controller } = await ready(t);
  const pending = deferred<unknown>();
  bridge.apply = () => pending.promise;
  const first = controller.actions.onSettingsAction(action);
  await assert.rejects(controller.actions.onSettingsAction(action));
  assert.equal(bridge.actionCalls.length, 1);
  assert.equal(controller.getSnapshot().settingsApplying, true);
  pending.resolve({ status: "cancelled" });
  assert.deepEqual(await first, { status: "cancelled" });
  assert.equal(controller.getSnapshot().settingsApplying, false);
});

for (const selection of ["runner-demo", "runner-second"]) {
  test(`a newer settings refresh for ${selection} is not replaced by an older apply`, async (t) => {
    const { bridge, controller } = await ready(t);
    const pending = deferred<unknown>();
    bridge.apply = () => pending.promise;
    const applying = controller.actions.onSettingsAction(action);
    bridge.inspect = async ({ runnerId }) => inventory(runnerId, "revision-from-newer-navigation");
    controller.actions.onRefreshSettings(selection);
    await tick();
    const latest = controller.getSnapshot().runtimeSettings;
    const readCount = bridge.settingsCalls.length;
    assert.equal(latest?.mcp.runnerId, selection);
    pending.resolve({ status: "applied" });

    assert.deepEqual(await applying, { status: "applied" });
    assert.equal(bridge.settingsCalls.length, readCount);
    assert.deepEqual(controller.getSnapshot().runtimeSettings, latest);
    assert.equal(controller.getSnapshot().settingsApplying, false);
    assert.equal(bridge.actionCalls.length, 1);
  });
}

test("newer runner navigation wins when an applied action's inventory reload is already pending", async (t) => {
  const { bridge, controller } = await ready(t);
  const reload = deferred<unknown>();
  bridge.inspect = () => reload.promise;
  const applying = controller.actions.onSettingsAction(action);
  await tick();
  assert.equal(bridge.settingsCalls.length, 2);
  assert.equal(controller.getSnapshot().settingsApplying, true);

  bridge.inspect = async ({ runnerId }) => inventory(runnerId, "revision-newer-runner");
  controller.actions.onRefreshSettings("runner-second");
  await tick();
  const latest = controller.getSnapshot().runtimeSettings;
  reload.resolve(inventory("runner-demo", "revision-old-runner-reload"));
  assert.deepEqual(await applying, { status: "applied" });
  assert.deepEqual(controller.getSnapshot().runtimeSettings, latest);
  assert.equal(controller.getSnapshot().runtimeSettings?.mcp.runnerId, "runner-second");
  assert.equal(bridge.actionCalls.length, 1);
  assert.equal(bridge.settingsCalls.length, 3);
});

test("a connection change during the post-apply read prevents a stale success result", async (t) => {
  const { bridge, controller } = await ready(t);
  const reload = deferred<unknown>();
  bridge.inspect = () => reload.promise;
  const applying = controller.actions.onSettingsAction(action);
  const rejected = assert.rejects(applying);
  await tick();
  assert.equal(bridge.settingsCalls.length, 2);
  bridge.change(2, "connecting");
  bridge.change(2, "connected");
  await tick();
  bridge.inspect = async ({ runnerId }) => inventory(runnerId, "revision-current-session");
  controller.actions.onRefreshSettings("runner-second");
  await tick();
  const latest = controller.getSnapshot().runtimeSettings;
  reload.resolve(inventory("runner-demo", "revision-old-session"));
  await rejected;

  assert.deepEqual(controller.getSnapshot().runtimeSettings, latest);
  assert.equal(controller.getSnapshot().settingsError, undefined);
  assert.equal(controller.getSnapshot().settingsApplying, false);
  assert.equal(bridge.actionCalls.length, 1);
  assert.equal(bridge.settingsCalls.length, 3);
});

test("failure to reload an acknowledged change does not replay the settings mutation", async (t) => {
  const { bridge, controller } = await ready(t);
  bridge.inspect = async () => { throw new Error("Synthetic inventory reload failed"); };
  assert.deepEqual(await controller.actions.onSettingsAction(action), { status: "applied" });
  assert.match(controller.getSnapshot().settingsError ?? "", /Synthetic inventory reload failed/);
  assert.equal(controller.getSnapshot().settingsApplying, false);
  assert.equal(bridge.actionCalls.length, 1);
  assert.equal(bridge.settingsCalls.length, 2);
});

for (const boundary of ["identity event", "bootstrap identity", "endpoint", "reconnect"] as const) {
  for (const outcome of ["success", "failure"] as const) {
    test(`a native settings dialog's late ${outcome} is fenced after ${boundary} changes`, async (t) => {
      const { bridge, controller } = await ready(t);
      const pending = deferred<unknown>();
      bridge.apply = () => pending.promise;
      const applying = controller.actions.onSettingsAction(action);
      const rejected = assert.rejects(applying);
      if (boundary === "identity event") {
        bridge.accountId = "account-two";
        bridge.event({ event: "identity.changed", data: { has_identity: true } });
      } else if (boundary === "bootstrap identity") {
        bridge.accountId = "account-two";
        await controller.refresh();
      } else if (boundary === "endpoint") {
        await controller.actions.onSaveEndpoint("ws://127.0.0.1:4863/ws");
      } else {
        bridge.change(2, "connecting");
        bridge.change(2, "connected");
      }
      await tick();
      bridge.inspect = async ({ runnerId }) => inventory(runnerId, "revision-current-session");
      controller.actions.onRefreshSettings("runner-second");
      await tick();
      const latest = controller.getSnapshot().runtimeSettings;
      const readCount = bridge.settingsCalls.length;
      assert.equal(latest?.editor?.revision, "revision-current-session");
      if (outcome === "success") pending.resolve({ status: "applied" });
      else pending.reject(new Error("Old session's native dialog failed"));
      await rejected;

      assert.equal(bridge.actionCalls.length, 1);
      assert.equal(bridge.settingsCalls.length, readCount);
      assert.deepEqual(controller.getSnapshot().runtimeSettings, latest);
      assert.equal(controller.getSnapshot().settingsError, undefined);
      assert.equal(controller.getSnapshot().settingsApplying, false);
    });
  }
}

test("an unknown settings mutation outcome remains explicit and is never automatically replayed", async (t) => {
  const { bridge, controller } = await ready(t);
  bridge.apply = async () => ({ status: "unknownOutcome" });
  assert.deepEqual(await controller.actions.onSettingsAction(action), { status: "unknownOutcome" });
  assert.match(controller.getSnapshot().settingsError ?? "", /结果尚不确定.*未被自动重发/);
  assert.equal(bridge.settingsCalls.length, 2);
  assert.equal(controller.getSnapshot().settingsApplying, false);
  controller.actions.onRefreshSettings("runner-demo");
  await tick();
  controller.actions.onReconnect();
  await tick();
  assert.deepEqual(bridge.actionCalls, [action]);
});

test("a rejected settings action is not treated as success or retried", async (t) => {
  const { bridge, controller } = await ready(t);
  bridge.apply = async () => { throw new Error("Synthetic mutation outcome is unknown; check settings first"); };
  await assert.rejects(controller.actions.onSettingsAction(action), /Synthetic mutation outcome is unknown/);
  assert.equal(controller.getSnapshot().settingsApplying, false);
  controller.actions.onRefreshSettings("runner-demo");
  await tick();
  assert.deepEqual(bridge.actionCalls, [action]);
});

for (const invalidResult of [null, { status: "done" }, { status: true }, {}]) {
  test(`a malformed settings action result ${JSON.stringify(invalidResult)} fails closed`, async (t) => {
    const { bridge, controller } = await ready(t);
    bridge.apply = async () => invalidResult;
    await assert.rejects(controller.actions.onSettingsAction(action));
    assert.equal(bridge.actionCalls.length, 1);
    assert.equal(controller.getSnapshot().settingsApplying, false);
  });
}

test("settings actions require the exact current editor revision before reaching native", async (t) => {
  const { bridge, controller } = await ready(t);
  await assert.rejects(controller.actions.onSettingsAction({ ...action, revision: "obsolete-revision" }));
  assert.equal(bridge.actionCalls.length, 0);
  assert.equal(controller.getSnapshot().settingsApplying, false);
});

test("settings actions do not fall back to raw RPC when the native bridge lacks write support", async (t) => {
  const { bridge, controller } = await ready(t);
  bridge.settingsAction = undefined;
  await assert.rejects(controller.actions.onSettingsAction(action));
  assert.equal(bridge.actionCalls.length, 0);
  assert.equal(controller.getSnapshot().settingsApplying, false);
});

test("settings actions cannot dispatch while bootstrap synchronization is pending", async (t) => {
  const { bridge, controller } = await ready(t);
  const pending = deferred<unknown>();
  bridge.bootstrap = () => pending.promise;
  const refreshing = controller.refresh();
  await assert.rejects(controller.actions.onSettingsAction(action));
  assert.equal(bridge.actionCalls.length, 0);
  pending.resolve({ ...structuredClone(demoSnapshot), identity_id: bridge.accountId });
  await refreshing;
});

test("settings actions cannot dispatch while disconnected", async (t) => {
  const { bridge, controller } = await ready(t);
  bridge.change(2, "disconnected");
  await assert.rejects(controller.actions.onSettingsAction(action));
  assert.equal(bridge.actionCalls.length, 0);
  assert.equal(controller.getSnapshot().settingsApplying, false);
});

test("settings actions need both an identity and a loaded editor", async (t) => {
  const { bridge, controller } = fixture(t);
  bridge.hasIdentity = false;
  await controller.start();
  await tick();
  controller.actions.onRefreshSettings("runner-demo");
  await tick();
  await assert.rejects(controller.actions.onSettingsAction(action));
  assert.equal(bridge.actionCalls.length, 0);

  bridge.hasIdentity = true;
  await controller.refresh();
  bridge.inspect = async () => ({ ...structuredClone(demoRuntimeSettings), editor: undefined });
  controller.actions.onRefreshSettings("runner-demo");
  await tick();
  assert.equal(controller.getSnapshot().runtimeSettings?.editor, undefined);
  await assert.rejects(controller.actions.onSettingsAction(action));
  assert.equal(bridge.actionCalls.length, 0);
});
