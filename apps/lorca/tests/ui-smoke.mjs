import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installSettingsFixture } from "./settings-ui-fixture.mjs";
import { installAvatarFixture } from "./avatar-ui-fixture.mjs";
import { checkVisualSurfaces } from "./visual-surfaces.mjs";
import { checkSettingsLayoutSurfaces } from "./settings-layout-surfaces.mjs";
import { checkSidebarViewSurfaces } from "./sidebar-view-surfaces.mjs";
import { checkLayoutToolsSurfaces } from "./layout-tools-surfaces.mjs";
import { expectRestoredFocus } from "./focus-restoration.mjs";

let playwright;
try {
  playwright = await import("playwright");
} catch {
  if (!process.env.PLAYWRIGHT_MODULE) {
    throw new Error(
      "Install Playwright in the workspace, or set PLAYWRIGHT_MODULE to an installed Playwright module path before running this smoke test.",
    );
  }
  playwright = await import(process.env.PLAYWRIGHT_MODULE);
}
const base = process.env.LORCA_UI_URL || "http://127.0.0.1:5178";
const output = fileURLToPath(
  new URL("../../../docs/lorca-screenshots/", import.meta.url),
);
mkdirSync(output, { recursive: true });
const executablePath =
  process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await playwright.chromium.launch({
  headless: true,
  executablePath,
  chromiumSandbox: true,
  args: ["--enable-automation"],
});
const failures = [];
let failurePage;
let layoutToolsStarted = false;
const tracedPages = new WeakSet();
const captureErrors = (page) => {
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
};
async function screenshot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('img[data-app-mark="ghost"]')).every((image) => image.complete && image.naturalWidth > 0));
  await page.screenshot({
    path: `${output}/${name}.png`,
    animations: "disabled",
  });
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > innerWidth + 1,
    composer:
      document.querySelector(".lorca-composer")?.getBoundingClientRect().right >
      innerWidth + 1,
  }));
  const footerInline = await page.evaluate(() => Array.from(document.querySelectorAll(".lorca-workspace")).every((workspace) => {
    const name = workspace.querySelector("strong")?.getBoundingClientRect();
    const status = workspace.querySelector("small")?.getBoundingClientRect();
    return !name?.height || !status?.height || Math.abs(name.top + name.height / 2 - status.top - status.height / 2) <= 1;
  }));
  assert.equal(footerInline, true, `${name}: sidebar brand and status share one row`);
  assert.equal(overflow.page, false, `${name}: horizontal page overflow`);
  assert.equal(overflow.composer, false, `${name}: composer overflow`);
}
function installFocusTrace() {
  if (window.__lorcaFocusTrace) return;
  const events = [];
  window.__lorcaFocusTrace = events;
  const target = (element) => element instanceof Element ? {
    tag: element.tagName,
    classes: Array.from(element.classList).filter((name) => name.startsWith("lorca-")),
    role: element.getAttribute("role"),
    state: element.getAttribute("data-state"),
    open: element.getAttribute("data-open"),
  } : null;
  const record = (type, element, extra = {}) => {
    events.push({ time: Math.round(performance.now() * 10) / 10, type, target: target(element), active: target(document.activeElement), ...extra });
    if (events.length > 300) events.shift();
  };
  for (const type of ["focusin", "focusout", "pointerdown", "click"]) document.addEventListener(type, (event) => record(type, event.target), true);
  document.addEventListener("keydown", (event) => {
    if (["Enter", "Escape", "Tab", " "].includes(event.key)) record("keydown", event.target, { key: event.key });
  }, true);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (!mutation.target.matches(".lorca-header-status, .lorca-connection-popover, .lorca-settings-desktop, .lorca-settings-drawer")) continue;
      record("attribute", mutation.target, { attribute: mutation.attributeName, previous: mutation.oldValue });
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-state", "data-open"], attributeOldValue: true });
  record("installed", document.documentElement);
}
async function tracePage(page) {
  if (tracedPages.has(page)) return;
  tracedPages.add(page);
  await page.addInitScript(installFocusTrace);
  await page.evaluate(installFocusTrace);
}
async function saveFailure(page, name) {
  if (!page || page.isClosed()) return;
  await page.screenshot({ path: `${output}/${name}.png`, animations: "disabled", timeout: 5000 }).catch(() => undefined);
  const events = await page.evaluate(() => window.__lorcaFocusTrace || []).catch(() => []);
  writeFileSync(`${output}/${name}-events.json`, JSON.stringify(events, null, 2));
  console.error(`${name} recent synthetic DOM events: ${JSON.stringify(events.slice(-30))}`);
}
async function runLayoutToolsDiagnostics() {
  layoutToolsStarted = true;
  await checkLayoutToolsSurfaces({ browser, base, screenshot, chooseChat, captureErrors, tracePage, setFailurePage: (page) => { failurePage = page; }, onFailure: async (name, error) => {
    console.error(`Independent ${name} check failed:`, error);
    await saveFailure(failurePage, `ui-smoke-${name}-failure`);
  } });
}
async function openConnectionSettings(page) {
  await tracePage(page);
  await page.locator(".lorca-header-status").click();
  await page.locator(".lorca-connection-popover").getByRole("button", { name: "连接设置", exact: true }).click();
}
async function chooseSettingsPage(page, label) {
  await page
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: label, exact: true })
    .click();
  await waitForSettings(page);
}
async function waitForSettings(page) {
  await page.locator(".lorca-settings-section-content").waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".lorca-settings-runtime-toolbar")
        ?.getAttribute("aria-busy") !== "true",
  );
}
async function chooseChat(page, text) {
  await page
    .locator(".lorca-chat-item")
    .filter({ hasText: text })
    .first()
    .click();
}

function installPairingBridge({ hasIdentity = true, capabilities, callback = true, authMode = "token" }) {
  const calls = [];
  const pending = [];
  const requestMethods = [];
  let reads = 0;
  const fixture = window.__settingsUiTest;
  fixture.snapshot.hasIdentity = hasIdentity;
  fixture.snapshot.authMode = authMode;
  const getStatus = window.lorca.getStatus;
  window.lorca.getStatus = async () => ({ ...await getStatus(), authMode });
  if (!hasIdentity) fixture.snapshot.devices = [];
  if (capabilities) fixture.snapshot.pairingCapabilities = capabilities;
  else delete fixture.snapshot.pairingCapabilities;
  const request = window.lorca.request;
  window.lorca.request = async (method, ...args) => {
    requestMethods.push(method);
    const result = await request(method, ...args);
    return method === "bootstrap" && !hasIdentity ? { ...result, has_identity: false, identity_id: null } : result;
  };
  const getSettings = window.lorca.getSettings;
  window.lorca.getSettings = async (...args) => { reads++; return getSettings(...args); };
  if (callback) window.lorca.openPairing = async (mode) => {
    calls.push(mode);
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  };
  else delete window.lorca.openPairing;
  window.__pairingUiTest = {
    calls, pending, requestMethods,
    get reads() { return reads; },
    resolve(status) { pending.shift().resolve({ status }); },
    reject() { pending.shift().reject(new Error("synthetic-private-native-error")); },
  };
}

async function checkDevicePairing() {
  const open = async (options) => {
    const page = await browser.newPage({ viewport: { width: 1240, height: 820 }, deviceScaleFactor: 1 });
    failurePage = page;
    captureErrors(page);
    await page.addInitScript({ content: `(${installSettingsFixture.toString()})(); (${installPairingBridge.toString()})(${JSON.stringify(options)});` });
    await page.goto(base, { waitUntil: "networkidle" });
    await openConnectionSettings(page);
    await waitForSettings(page);
    await chooseSettingsPage(page, "设备");
    return page;
  };
  const noSuccessClaim = async (page) => {
    const text = await page.locator(".lorca-settings-section-content").innerText();
    assert.doesNotMatch(text, /配对成功|绑定成功|已完成配对|同步完成|synthetic-private-native-error/, "Main settings never infer successful pairing or expose raw native errors");
    assert.equal(await page.locator('input[name="pairing_string"], input[name="nonce"], [data-pairing-qr]').count(), 0, "Pairing secrets and QR entry stay outside the main renderer");
    assert.equal(await page.evaluate(() => window.__pairingUiTest.requestMethods.some((method) => method.startsWith("pair."))), false, "The main UI never invokes pairing service methods directly");
  };
  for (const options of [
    { callback: true },
    { callback: true, capabilities: { invite: false, join: true } },
    { callback: false, capabilities: { invite: true, join: true } },
  ]) {
    const page = await open(options);
    const button = page.locator(".lorca-settings-section-content").getByRole("button", { name: "配对新设备", exact: true });
    assert.equal(await button.isDisabled(), true, "Both the native callback and the current mode capability are required");
    await button.evaluate((element) => element.click());
    assert.deepEqual(await page.evaluate(() => window.__pairingUiTest.calls), [], "Unsupported pairing cannot be activated, even by a dispatched click");
    assert.equal(await page.locator(".lorca-runtime-device-row").count(), 2, "Read-only device inventory remains available without pairing support");
    await noSuccessClaim(page);
    if (!options.capabilities) await screenshot(page, "desktop-devices-pairing-unavailable");
    await page.close();
  }
  for (const [authMode, reasons] of [
    ["legacy", ["token_auth_required", "https_relay_required"]],
    ["token", ["https_relay_required"]],
    ["legacy", ["token_auth_required"]],
  ]) {
    const page = await open({ authMode, callback: true, capabilities: { invite: false, join: false, inviteReasons: reasons, joinReasons: authMode === "legacy" ? ["token_auth_required", "already_has_identity"] : ["already_has_identity"] } });
    assert.deepEqual(await page.locator("[data-pairing-disabled-reason]").evaluateAll((elements) => elements.map((element) => element.dataset.pairingDisabledReason)), reasons, "Every independent pairing blocker is shown, including the remaining blocker when only one requirement is fixed");
    if (reasons.includes("token_auth_required")) assert.match(await page.locator('[data-pairing-disabled-reason="token_auth_required"]').innerText(), /客户端限制/);
    if (reasons.includes("https_relay_required")) assert.match(await page.locator('[data-pairing-disabled-reason="https_relay_required"]').innerText(), /HTTPS/);
    for (const selector of [".lorca-settings-section-content .lorca-device-pairing-action button", ".lorca-device-pairing-compact button"]) {
      const button = page.locator(selector);
      assert.equal(await button.isDisabled(), true, "Neither the page nor header shortcut bypasses token or HTTPS policy");
      await button.evaluate((element) => element.click());
    }
    assert.deepEqual(await page.evaluate(() => window.__pairingUiTest.calls), [], "Displaying or clicking blocked pairing sends no native pairing request");
    await noSuccessClaim(page);
    if (reasons.length === 2) await screenshot(page, "desktop-pairing-multiple-disabled-reasons");
    await page.close();
  }
  for (const hasIdentity of [true, false]) {
    const page = await open({ hasIdentity, capabilities: { invite: hasIdentity, join: !hasIdentity }, callback: true });
    const mode = hasIdentity ? "invite" : "join";
    const label = hasIdentity ? "配对新设备" : "加入已有账号";
    const button = page.locator(".lorca-settings-section-content").getByRole("button", { name: label, exact: true });
    assert.equal(await button.isEnabled(), true);
    assert.deepEqual(await page.evaluate(() => window.__pairingUiTest.calls), [], "Reading the device page does not start a native flow");
    await screenshot(page, `desktop-devices-${mode}-ready`);
    for (const result of ["cancelled", "completed", "unknownOutcome"]) {
      const before = await page.evaluate(() => ({ reads: window.__pairingUiTest.reads, calls: window.__pairingUiTest.calls.length, devices: window.__settingsUiTest.snapshot.devices.length }));
      await button.evaluate((element) => { element.click(); element.click(); });
      await page.waitForFunction(() => document.querySelector(".lorca-settings-section-content .lorca-device-pairing-action")?.getAttribute("aria-busy") === "true");
      assert.equal(await page.locator(".lorca-settings-section-content .lorca-device-pairing-action button").isDisabled(), true, "One native flow disables duplicate activation");
      assert.equal(await page.locator(".lorca-device-pairing-compact button").isDisabled(), true, "The shared native flow also disables the header pairing shortcut");
      assert.deepEqual(await page.evaluate(() => window.__pairingUiTest.calls), Array(before.calls + 1).fill(mode), "A repeated click opens exactly one native flow with the correct mode");
      await noSuccessClaim(page);
      if (result === "cancelled") await screenshot(page, `desktop-devices-${mode}-pending`);
      await page.evaluate((status) => window.__pairingUiTest.resolve(status), result);
      await page.waitForFunction(() => document.querySelector(".lorca-settings-section-content .lorca-device-pairing-action")?.getAttribute("aria-busy") === "false" && document.querySelector(".lorca-settings-runtime-toolbar")?.getAttribute("aria-busy") === "false");
      assert.equal(await page.evaluate(() => window.__pairingUiTest.reads), before.reads + 1, "Closing a native flow reads back the device inventory once");
      assert.equal(await page.locator(".lorca-runtime-device-row").count(), before.devices, "A native result does not fabricate a paired device");
      assert.equal(await page.evaluate(() => window.__pairingUiTest.calls.length), before.calls + 1, "Cancellation and unknown outcomes are never retried automatically");
      await noSuccessClaim(page);
      if (result === "unknownOutcome") await page.getByText("配对结果尚不确定。关闭窗口不代表撤销已发生的绑定，请在原设备核对；操作不会自动重发。", { exact: true }).waitFor();
      if (result === "completed") await screenshot(page, `desktop-devices-${mode}-readback`);
    }
    await button.click();
    await page.evaluate(() => window.__pairingUiTest.reject());
    await page.getByText("配对窗口未能打开，请查看设备页的禁用原因。若上次结果未知，请先在官方客户端核对设备。", { exact: true }).waitFor();
    assert.doesNotMatch(await page.content(), /synthetic-private-native-error/, "Native rejection details never appear anywhere in the rendered document");
    await noSuccessClaim(page);
    await page.getByRole("button", { name: "返回聊天", exact: true }).click();
    await openConnectionSettings(page);
    await waitForSettings(page);
    await chooseSettingsPage(page, "设备");
    assert.equal(await page.evaluate(() => window.__pairingUiTest.calls.length), 4, "Reopening settings never resumes or repeats a dismissed native flow");
    await page.close();
  }
}

function installDeviceScopeFixture() {
  const fixture = window.__settingsUiTest;
  fixture.snapshot.devices.push(
    { id: "scope-phone", name: "Synthetic phone", role: "device", os: "ios", version: "fixture", online: true, isThisDevice: false, plugins: [] },
    { id: "scope-unknown", name: "Synthetic unknown device", role: "unknown", os: "macos", version: "fixture", online: true, isThisDevice: false, plugins: [] },
  );
  fixture.snapshot.bots.push({ id: "bot-two", name: "Synthetic second agent", runnerId: "runner-two", provider: "provider-two", model: "model-two" });
  fixture.snapshot.editor.bots.push({ id: "bot-two", thinking: "low" });
  const originalMcp = structuredClone(fixture.snapshot.mcp);
  const getSettings = window.lorca.getSettings;
  const reads = [];
  window.lorca.getSettings = async (options = {}) => {
    reads.push(structuredClone(options));
    const result = await getSettings(options);
    result.mcp = options.includeMcp === false
      ? { status: "unavailable", runnerId: null, hasConfigError: false, servers: [] }
      : { ...structuredClone(originalMcp), runnerId: options.runnerId || "runner-one" };
    return result;
  };
  window.__deviceScopeUiTest = { reads, originalBots: structuredClone(fixture.snapshot.bots) };
}

async function checkSharedDeviceScope() {
  const page = await browser.newPage({ viewport: { width: 1240, height: 820 }, deviceScaleFactor: 1 });
  failurePage = page;
  captureErrors(page);
  await page.addInitScript({ content: `(${installSettingsFixture.toString()})(); (${installDeviceScopeFixture.toString()})();` });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator(".lorca-sidebar .lorca-workspace").click();
  await waitForSettings(page);
  await page.getByRole("button", { name: "浅色", exact: true }).waitFor();
  const scope = page.getByRole("combobox", { name: "查看设备", exact: true });
  await page.waitForFunction(() => document.querySelector('[aria-label="查看设备"]')?.disabled === false);
  assert.equal(await scope.inputValue(), "runner-one", "Settings opens with the current device selected");
  assert.equal(await page.getByRole("textbox", { name: "WebSocket 连接地址" }).count(), 0, "The footer opens General, while connection details stay in Advanced");
  assert.ok(await page.evaluate(() => window.__deviceScopeUiTest.reads.every((options) => options.includeMcp === false)), "Opening settings does not read MCP for an unrelated page");
  const initialReads = await page.evaluate(() => window.__deviceScopeUiTest.reads.length);
  await scope.selectOption("runner-two");
  await chooseSettingsPage(page, "智能体");
  assert.equal(await page.locator("#lorca-edit-bot").inputValue(), "bot-two");
  assert.deepEqual(await page.locator("#lorca-edit-bot option").allTextContents(), ["Synthetic second agent"], "Agent inventory follows the shared device scope");
  await chooseSettingsPage(page, "设备");
  assert.equal(await scope.inputValue(), "runner-two", "The same scope survives settings navigation");
  assert.equal(await page.locator('.lorca-runtime-device-row[data-selected="true"] .lorca-device-name').innerText(), "Synthetic workstation");
  assert.equal(await page.locator(".lorca-runtime-device-row").count(), 4, "Device scope selection never hides the account inventory");
  assert.equal(await page.evaluate(() => window.__deviceScopeUiTest.reads.length), initialReads, "Switching read-only scope outside Plugins makes no MCP or settings read");
  await page.getByRole("button", { name: "Synthetic desktop", exact: true }).click();
  assert.equal(await scope.inputValue(), "runner-one", "Selecting a device card updates the shared header scope");
  await chooseSettingsPage(page, "插件");
  await waitForSettings(page);
  assert.deepEqual(await page.evaluate(() => window.__deviceScopeUiTest.reads.at(-1)), { runnerId: "runner-one" }, "Plugins explicitly reads the selected Runner only");
  await page.locator(".lorca-mcp-server").waitFor();
  await scope.selectOption("runner-two");
  await waitForSettings(page);
  assert.deepEqual(await page.evaluate(() => window.__deviceScopeUiTest.reads.at(-1)), { runnerId: "runner-two" });
  await screenshot(page, "desktop-settings-shared-runner-scope");
  for (const [id, name, empty] of [["scope-phone", "phone", "此设备不运行智能体"], ["scope-unknown", "unknown", "此设备尚未报告 Runner 角色"]]) {
    const before = await page.evaluate(() => window.__deviceScopeUiTest.reads.length);
    await scope.selectOption(id);
    await waitForSettings(page);
    await page.getByText(empty, { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate((index) => window.__deviceScopeUiTest.reads.slice(index), before), [{ includeMcp: false }], "Phone or unknown-role scope explicitly skips MCP and never supplies its device ID as a Runner");
    assert.equal(await page.locator(".lorca-mcp-server").count(), 0);
    assert.equal(await page.getByRole("button", { name: "添加服务器…", exact: true }).count(), 0);
    await chooseSettingsPage(page, "智能体");
    assert.equal(await scope.inputValue(), id);
    await page.getByText(empty, { exact: true }).waitFor();
    assert.equal(await page.locator("#lorca-edit-bot").count(), 0);
    await chooseSettingsPage(page, "服务商");
    assert.equal(await page.locator(".lorca-admin-provider-row").count(), 2, "Providers remain account-wide even while viewing a phone");
    await chooseSettingsPage(page, "设备");
    assert.equal(await page.locator('.lorca-runtime-device-row[data-selected="true"]').count(), 1);
    assert.equal(await page.evaluate(() => window.__deviceScopeUiTest.reads.length), before + 1, "Navigating account and device pages does not introduce hidden MCP reads");
    await screenshot(page, `desktop-settings-device-scope-${name}`);
    await chooseSettingsPage(page, "插件");
    await waitForSettings(page);
  }
  assert.deepEqual(await page.evaluate(() => window.__settingsUiTest.requests), [], "Every device-scope switch is read-only and never sends a settings mutation");
  assert.deepEqual(await page.evaluate(() => window.__settingsUiTest.snapshot.bots), await page.evaluate(() => window.__deviceScopeUiTest.originalBots), "Changing the viewed device never migrates an agent");
  await scope.selectOption("runner-one");
  await waitForSettings(page);
  await chooseSettingsPage(page, "智能体");
  assert.equal(await page.locator("#lorca-edit-bot").inputValue(), "bot-one", "Returning to a Runner restores its own agent list");
  await page.close();
}

function installCrossAgentFixture() {
  const request = window.lorca.request;
  const getAvatar = window.lorca.getBotAvatar;
  window.lorca.getBotAvatar = async (id, version) => id === "cross-photo" && version === "synthetic-cross-1" ? window.__avatarUiTest.images[1] : getAvatar(id, version);
  window.lorca.request = async (method, ...args) => {
    const snapshot = await request(method, ...args);
    if (method !== "bootstrap") return snapshot;
    const epoch = Math.floor(Date.now() / 1000);
    const message = (id, body, author = { kind: "bot", bot_id: "avatar-photo" }) => ({ id, chat_id: "cross-chat", author, body, state: { kind: "complete" }, created_at: epoch });
    snapshot.bots.push({ id: "cross-photo", name: "合成研究助手", runner_id: "fixture-runner", has_avatar: true, avatar_version: "synthetic-cross-1" });
    snapshot.chats = [{ id: "cross-chat", kind: "dm", title: "合成跨智能体协作", bot_ids: ["avatar-photo"], created_at: epoch, has_more: false, messages: [
      message("cross-user", { kind: "text", text: "请和研究助手核对这份合成计划。" }, { kind: "you" }),
      message("cross-incoming", { kind: "handoff", from: "cross-photo", to: "avatar-photo", reason: "已核对三项合成任务，交给你整理下一步。" }),
      message("cross-reply", { kind: "text", text: "我收到了研究助手的交接，并整理了下一步。" }),
      message("cross-outgoing", { kind: "tool", name: "message_bot", target_bot_id: "cross-photo", summary: "Messaged 合成研究助手", detail: "请复核第二项合成任务的时间安排。", is_running: false, is_error: false }),
      message("cross-failed", { kind: "tool", name: "message_bot", target_bot_id: "cross-photo", summary: "Synthetic failed message", detail: "合成失败示例不会显示已发送。", is_running: false, is_error: true }),
    ] }];
    return snapshot;
  };
}

async function checkCrossAgentRows() {
  const page = await browser.newPage({ viewport: { width: 1240, height: 820 }, deviceScaleFactor: 1 });
  failurePage = page;
  captureErrors(page);
  await page.addInitScript({ content: `(${installAvatarFixture.toString()})(); (${installCrossAgentFixture.toString()})();` });
  await page.goto(base, { waitUntil: "networkidle" });
  await chooseChat(page, "合成跨智能体协作");
  const rows = page.locator(".lorca-cross-agent");
  await rows.nth(1).waitFor();
  assert.equal(await rows.count(), 2, "Only the incoming handoff and completed message_bot send become cross-agent rows");
  assert.match(await rows.nth(0).locator("summary").innerText(), /来自\s*合成研究助手/);
  assert.match(await rows.nth(1).locator("summary").innerText(), /已发消息给\s*合成研究助手/);
  assert.equal(await page.locator(".lorca-cross-agent").filter({ hasText: "Synthetic failed message" }).count(), 0, "A failed send never claims outgoing success");
  for (const row of [rows.nth(0), rows.nth(1)]) {
    const avatar = row.locator('[data-avatar-bot="cross-photo"] img');
    await avatar.evaluate((image) => image.decode());
    assert.equal(await avatar.evaluate((image) => image.src === window.__avatarUiTest.images[1] && getComputedStyle(image).filter === "none" && getComputedStyle(image).opacity === "1"), true, "Known counterpart avatars use their unmodified synthetic PNG");
  }
  const ownAvatar = page.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] img');
  await ownAvatar.evaluate((image) => image.decode());
  assert.equal(await ownAvatar.evaluate((image) => image.src === window.__avatarUiTest.images[0] && getComputedStyle(image).filter === "none"), true);
  const user = page.locator('.lorca-user-message img[data-user-avatar="ghost"]');
  await user.evaluate((image) => image.decode());
  assert.equal(await user.evaluate((image) => new URL(image.src).pathname.endsWith("/app-icon/64.png") && getComputedStyle(image).filter === "grayscale(1) contrast(0.45) brightness(1.65)"), true);
  await rows.nth(0).locator("summary").click();
  await rows.nth(0).locator(".lorca-cross-agent-detail").waitFor();
  await page.locator(".lorca-scroll").evaluate((element) => { element.scrollTop = 0; });
  await screenshot(page, "desktop-cross-agent-light");
  await page.close();
}

async function assertDesktopDensity(page) {
  const layout = await page.evaluate(() => {
    const header = document.querySelector(".lorca-header");
    const transcript = document.querySelector(".lorca-transcript");
    const composer = document.querySelector(".lorca-composer");
    const title = document.querySelector(".lorca-header-title");
    return {
      headerHeight: header.getBoundingClientRect().height,
      headerBorder: getComputedStyle(header).borderBottomWidth,
      composerBorder: getComputedStyle(composer).borderTopWidth,
      contentGap: parseFloat(getComputedStyle(transcript).paddingTop),
      titleLeft: title.getBoundingClientRect().left,
      transcriptLeft: transcript.getBoundingClientRect().left,
      composerLeft: composer.getBoundingClientRect().left,
      composerBottom: composer.getBoundingClientRect().bottom,
      height: innerHeight,
    };
  });
  assert.equal(layout.headerHeight, 48, "Desktop header stays a compact single row");
  assert.equal(layout.headerBorder, "0px");
  assert.equal(layout.composerBorder, "0px");
  assert.equal(layout.contentGap, 20, "Transcript starts close to the header");
  assert.ok(Math.abs(layout.titleLeft - layout.transcriptLeft) <= 8, "Header aligns with the reading column within its thin-scrollbar allowance");
  assert.ok(Math.abs(layout.composerLeft - layout.transcriptLeft) <= 8, "Composer aligns with the reading column within its thin-scrollbar allowance");
  assert.ok(layout.composerBottom < layout.height, "Composer remains inside the window");
}

async function assertNativeSkipLink(page) {
  const link = page.locator(".lorca-skip-link");
  const composer = page.getByRole("textbox", { name: "给 dots 发消息" });
  await composer.focus();
  assert.ok(await link.evaluate((element) => element.getBoundingClientRect().bottom) <= 0, "Unfocused native skip link is entirely above the viewport");
  await link.focus();
  assert.equal(await link.evaluate((element) => element === document.activeElement), true);
  assert.ok(await link.evaluate((element) => element.getBoundingClientRect().top) >= 40, "Focused skip link appears below the traffic-light safe area");
  await composer.focus();
  assert.ok(await link.evaluate((element) => element.getBoundingClientRect().bottom) <= 0, "Native skip link becomes completely hidden after blur");
}

async function assertNeutralAvatarFallbacks(page) {
  const styles = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    const pixel = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    return Array.from(document.querySelectorAll(".lorca-avatar:not(.lorca-avatar-person) [data-avatar-fallback]")).map((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor, image: style.backgroundImage, foregroundPixel: pixel(style.color), backgroundPixel: pixel(style.backgroundColor) };
    });
  });
  assert.ok(styles.length >= 6, "Default, configured and missing-image fallbacks are represented across the UI");
  for (const style of styles) {
    assert.equal(style.color, styles[0].color, "All bot fallback symbols use one neutral foreground token");
    assert.equal(style.background, styles[0].background, "All bot fallbacks use one neutral surface token");
    assert.equal(style.image, "none", "Fallbacks do not retain colored gradients");
    for (const pixel of [style.foregroundPixel, style.backgroundPixel]) {
      assert.ok(Math.max(...pixel.slice(0, 3)) - Math.min(...pixel.slice(0, 3)) <= 16, "Fallback colors remain low-saturation in the current theme");
    }
  }
  assert.ok(await page.locator(".lorca-chat-list [data-avatar-fallback]").count() > 0);
  assert.ok(await page.locator(".lorca-message-author [data-avatar-fallback]").count() > 0);
  assert.equal(await page.locator(".lorca-agent-picker").count(), 0, "Existing group chats have no agent picker");
  assert.equal(await page.locator(".lorca-header-title .lorca-avatar-stack [data-avatar-fallback]").count(), 1);
  assert.equal(await page.locator('.lorca-message-author .lorca-avatar:not([data-avatar-bot]) [data-avatar-fallback]').count(), 1, "A missing appearance uses the same neutral default");
  const photos = await page.locator('[data-avatar-bot="avatar-photo"] img').evaluateAll(async (images) => {
    await Promise.all(images.map((image) => image.decode()));
    return images.map((image) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const treatments = [];
      for (let element = image; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        treatments.push({ filter: style.filter, opacity: style.opacity, blend: style.mixBlendMode });
      }
      return { original: image.src === window.__avatarUiTest.images[0], pixel: Array.from(context.getImageData(8, 32, 1, 1).data), width: image.naturalWidth, height: image.naturalHeight, treatments };
    });
  });
  assert.ok(photos.length >= 3, "The same custom pink PNG is visible in list, group header and message");
  for (const photo of photos) {
    assert.equal(photo.original, true, "Custom PNG bytes are not substituted");
    assert.deepEqual(photo.pixel, [219, 98, 163, 255], "Custom pink image keeps its exact decoded pixels");
    assert.equal(photo.width, 64);
    assert.equal(photo.height, 64);
    assert.ok(photo.treatments.every((style) => style.filter === "none" && style.opacity === "1" && style.blend === "normal"), "Neutral fallback styling never recolors or fades a custom image");
  }
}

try {
  const sandboxSession = await browser.newBrowserCDPSession();
  try {
    const commandLine = await sandboxSession.send("Browser.getBrowserCommandLine");
    assert.ok(Array.isArray(commandLine.arguments), "Chromium reports its actual launch arguments");
    assert.equal(commandLine.arguments.some((argument) => argument === "--no-sandbox" || argument.startsWith("--no-sandbox=")), false, "Chromium must not launch with --no-sandbox");
  } finally {
    await sandboxSession.detach();
  }
  const desktop = await browser.newPage({
    viewport: { width: 1240, height: 820 },
    deviceScaleFactor: 1,
  });
  failurePage = desktop;
  captureErrors(desktop);
  await desktop.goto(`${base}/?demo=1`, { waitUntil: "networkidle" });
  await desktop
    .getByRole("heading", { name: "想和 dots 聊些什么？" })
    .waitFor();
  assert.equal(await desktop.locator("html").getAttribute("lang"), "zh-CN");
  assert.equal(await desktop.title(), "dots");
  assert.equal(await desktop.locator(".lorca-brand").innerText(), "dots");
  assert.equal(await desktop.locator('.lorca-brand img[data-app-mark="ghost"]').count(), 1);
  assert.equal(await desktop.locator(".lorca-brand svg").count(), 0);
  await desktop.waitForFunction(() => document.querySelector('.lorca-brand img[data-app-mark="ghost"]')?.naturalWidth === 64);
  const faviconUrl = await desktop
    .locator('link[rel="icon"]')
    .evaluate(
      (element) => new URL(element.getAttribute("href"), document.baseURI).href,
    );
  assert.equal(new URL(faviconUrl).pathname.endsWith("/app-icon/32.png"), true);
  const faviconResponse = await desktop.request.get(faviconUrl);
  assert.equal(
    faviconResponse.ok(),
    true,
    "The dots favicon asset is available",
  );
  assert.match(faviconResponse.headers()["content-type"], /image\/png/);
  const faviconBytes = await faviconResponse.body();
  assert.deepEqual(faviconBytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(faviconBytes.readUInt32BE(16), 32);
  assert.equal(faviconBytes.readUInt32BE(20), 32);
  assert.deepEqual(faviconBytes, readFileSync(new URL("../public/app-icon/32.png", import.meta.url)), "Favicon is the selected Ghost artwork asset");
  await desktop.getByRole("searchbox", { name: "搜索智能体与对话" }).waitFor();
  await desktop
    .getByRole("button", { name: "发送消息", exact: true })
    .waitFor();
  await desktop.getByRole("textbox", { name: "给 dots 发消息" }).waitFor();
  await screenshot(desktop, "desktop-empty-light");
  await chooseChat(desktop, /^示例助手$/);
  await desktop.locator(".lorca-assistant-message").first().waitFor();
  await desktop.locator(".lorca-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  await screenshot(desktop, "desktop-conversation-light");
  await assertDesktopDensity(desktop);
  await desktop.getByRole("textbox", { name: "给 dots 发消息" }).focus();
  assert.notEqual(await desktop.locator(".lorca-composer").evaluate((element) => getComputedStyle(element).boxShadow), "none", "Borderless composer keeps a visible focus indicator");
  const connectionRoundTrip = await desktop.evaluate(() => ({ draft: document.querySelector("#lorca-composer").value, scroll: document.querySelector(".lorca-scroll").scrollTop }));
  await openConnectionSettings(desktop);
  const savedEndpoint = await desktop
    .getByRole("textbox", { name: "WebSocket 连接地址" })
    .inputValue();
  await desktop
    .getByRole("textbox", { name: "WebSocket 连接地址" })
    .fill("ws://remote.invalid/ws");
  await desktop
    .getByRole("button", { name: "连接本次会话", exact: true })
    .click();
  await desktop
    .getByText(
      "请使用 ws://127.0.0.1:<port>/ws 或 ws://localhost:<port>/ws，端口范围为 1 至 65535。",
      { exact: true },
    )
    .waitFor();
  await desktop.getByRole("button", { name: "返回聊天" }).click();
  await openConnectionSettings(desktop);
  assert.equal(
    await desktop
      .getByRole("textbox", { name: "WebSocket 连接地址" })
      .inputValue(),
    savedEndpoint,
    "Closing settings discards unsaved endpoint edits and validation errors",
  );
  assert.equal(await desktop.locator(".lorca-field-error").count(), 0);
  for (let repeat = 0; repeat < 2; repeat++) {
    await desktop.getByRole("button", { name: "返回聊天", exact: true }).click();
    const after = await desktop.evaluate(() => ({ draft: document.querySelector("#lorca-composer").value, scroll: document.querySelector(".lorca-scroll").scrollTop }));
    assert.deepEqual(after, connectionRoundTrip, "Repeated status-to-settings round trips preserve the draft and reading position");
    await openConnectionSettings(desktop);
    assert.equal(await desktop.getByRole("textbox", { name: "WebSocket 连接地址" }).inputValue(), savedEndpoint);
  }
  await desktop.getByRole("button", { name: "返回聊天", exact: true }).click();
  await desktop.waitForFunction(() => document.querySelector(".lorca-header-status") === document.activeElement);
  await openConnectionSettings(desktop);
  await chooseSettingsPage(desktop, "通用");
  await desktop.getByRole("button", { name: "深色", exact: true }).click();
  await desktop.getByRole("button", { name: "返回聊天" }).click();
  await screenshot(desktop, "desktop-conversation-dark");
  await openConnectionSettings(desktop);
  await chooseSettingsPage(desktop, "通用");
  await desktop.getByRole("button", { name: "浅色", exact: true }).click();
  await desktop.getByRole("button", { name: "返回聊天" }).click();
  const preview = desktop
    .locator(".lorca-chat-item")
    .filter({ hasText: "Approval and activity preview" });
  if (await preview.count()) {
    await preview.click();
    await desktop.getByRole("button", { name: "仅允许一次" }).waitFor();
    await screenshot(desktop, "desktop-approval-light");
  }
  await desktop.keyboard.press("Control+k");
  await desktop
    .getByRole("searchbox", { name: "搜索智能体与对话" })
    .fill("nonexistent fixture title");
  await desktop.getByText("没有匹配的分组、智能体或群聊。", { exact: true }).waitFor();
  await desktop.getByRole("searchbox", { name: "搜索智能体与对话" }).fill("");
  await desktop.keyboard.press("Control+n");
  await desktop
    .getByRole("textbox", { name: "给 dots 发消息" })
    .fill("Keep my synthetic draft");
  await desktop.keyboard.press("Enter");
  await desktop.getByRole("alert").first().waitFor();
  assert.equal(
    await desktop.getByRole("textbox", { name: "给 dots 发消息" }).inputValue(),
    "Keep my synthetic draft",
  );

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  failurePage = mobile;
  captureErrors(mobile);
  await mobile.goto(`${base}/?demo=1`, { waitUntil: "networkidle" });
  await screenshot(mobile, "mobile-empty-light");
  await mobile.getByRole("button", { name: "打开对话列表" }).click();
  await mobile.locator(".lorca-chat-item").first().waitFor();
  await screenshot(mobile, "mobile-chats-light");
  await chooseChat(mobile, /^示例助手$/);
  await mobile.locator(".lorca-assistant-message").first().waitFor();
  await screenshot(mobile, "mobile-conversation-light");
  assert.equal(await mobile.locator("#root").getAttribute("aria-hidden"), null);
  assert.equal(await mobile.locator("#root").getAttribute("inert"), null);
  await openConnectionSettings(mobile);
  await mobile.getByRole("textbox", { name: "WebSocket 连接地址" }).waitFor();
  await mobile
    .getByRole("textbox", { name: "WebSocket 连接地址" })
    .scrollIntoViewIfNeeded();
  await mobile.waitForFunction(() => {
    const drawer = document.querySelector(".lorca-settings-drawer");
    const input = document.querySelector("#lorca-endpoint");
    if (!drawer || !input) return false;
    const bounds = input.getBoundingClientRect();
    return (
      bounds.top >= 0 &&
      bounds.bottom <= innerHeight &&
      Math.abs(new DOMMatrixReadOnly(getComputedStyle(drawer).transform).m42) <
        0.5
    );
  });
  await screenshot(mobile, "mobile-settings-light");
  await chooseSettingsPage(mobile, "通用");
  await mobile.getByRole("button", { name: "深色", exact: true }).click();
  await mobile.getByRole("button", { name: "返回聊天" }).click();
  await screenshot(mobile, "mobile-conversation-dark");

  const settingsDesktop = await browser.newPage({
    viewport: { width: 1240, height: 820 },
    deviceScaleFactor: 1,
  });
  failurePage = settingsDesktop;
  captureErrors(settingsDesktop);
  await settingsDesktop.goto(`${base}/?demo=1`, { waitUntil: "networkidle" });
  await openConnectionSettings(settingsDesktop);
  await waitForSettings(settingsDesktop);
  assert.deepEqual(await settingsDesktop.getByRole("navigation", { name: "设置分类" }).getByRole("button").allTextContents(), ["通用", "服务商", "自动审查", "插件", "智能体", "设备", "高级"], "Settings uses the unified device page and current product terminology");
  const settingsAlignment = await settingsDesktop.evaluate(() => ({
    heading: document.querySelector(".lorca-settings-page-header h1").getBoundingClientRect().left,
    content: document.querySelector(".lorca-settings-runtime-toolbar").getBoundingClientRect().left,
    gap: parseFloat(getComputedStyle(document.querySelector(".lorca-settings-reading-width")).paddingTop),
    borders: Array.from(document.querySelectorAll(".lorca-settings-section-content section > .border")).map((element) => getComputedStyle(element).borderTopWidth),
  }));
  assert.ok(Math.abs(settingsAlignment.heading - settingsAlignment.content) <= 8, "Settings heading and form share one reading column within its thin-scrollbar allowance");
  assert.equal(settingsAlignment.gap, 8);
  assert.ok(settingsAlignment.borders.length > 0);
  assert.ok(settingsAlignment.borders.every((border) => border === "0px"), "Desktop settings use tonal groups without card outlines");
  await screenshot(settingsDesktop, "desktop-settings-connection");
  await chooseSettingsPage(settingsDesktop, "通用");
  await screenshot(settingsDesktop, "desktop-settings-preferences");
  await settingsDesktop
    .getByRole("button", { name: "深色", exact: true })
    .click();
  await settingsDesktop.reload({ waitUntil: "networkidle" });
  assert.equal(
    await settingsDesktop.locator("html").getAttribute("class"),
    "dark",
    "Appearance restores on reload within this session",
  );
  await openConnectionSettings(settingsDesktop);
  await waitForSettings(settingsDesktop);
  await chooseSettingsPage(settingsDesktop, "通用");
  await screenshot(settingsDesktop, "desktop-settings-preferences-dark");
  await settingsDesktop
    .getByRole("button", { name: "浅色", exact: true })
    .click();
  await chooseSettingsPage(settingsDesktop, "设备");
  await settingsDesktop
    .getByText("Demo desktop", { exact: true })
    .first()
    .waitFor();
  await screenshot(settingsDesktop, "desktop-settings-devices");
  const runnerDetails = settingsDesktop.locator(".lorca-runtime-disclosure").first();
  if (!(await runnerDetails.evaluate((element) => element.open))) await runnerDetails.locator("summary").click();
  await settingsDesktop.getByText("未报告工具数量", { exact: true }).waitFor();
  await screenshot(settingsDesktop, "desktop-settings-runner-details");
  await chooseSettingsPage(settingsDesktop, "插件");
  await settingsDesktop
    .getByRole("combobox", { name: "查看设备", exact: true })
    .waitFor();
  await screenshot(settingsDesktop, "desktop-settings-mcp");
  await settingsDesktop
    .getByRole("combobox", { name: "查看设备", exact: true })
    .selectOption("runner-second");
  await settingsDesktop.getByText("MCP 清单不可用", { exact: true }).waitFor();
  await screenshot(settingsDesktop, "desktop-settings-mcp-unavailable");
  assert.equal(await settingsDesktop.locator(".lorca-agent-picker").count(), 1, "A new-chat agent picker remains available while inspecting runtime settings");
  assert.equal(await settingsDesktop.locator(".lorca-agent-picker").getAttribute("data-selected-agent"), "bot-demo", "Inspecting a device never reassigns the selected agent");
  assert.equal(
    await settingsDesktop.locator("#root").getAttribute("inert"),
    null,
  );
  assert.equal(
    await settingsDesktop.locator("#root").getAttribute("aria-hidden"),
    null,
  );
  await chooseSettingsPage(settingsDesktop, "智能体");
  await settingsDesktop.getByRole("combobox", { name: "查看设备", exact: true }).selectOption("runner-demo");
  await settingsDesktop.getByRole("combobox", { name: "分配执行器", exact: true }).waitFor();
  await screenshot(settingsDesktop, "desktop-settings-models");
  await settingsDesktop.getByRole("combobox", { name: "分配执行器", exact: true }).selectOption("runner-second");
  await settingsDesktop.getByRole("button", { name: "应用更改", exact: true }).click();
  await screenshot(settingsDesktop, "desktop-settings-models-confirm");
  await settingsDesktop.getByRole("button", { name: "取消", exact: true }).click();
  await chooseSettingsPage(settingsDesktop, "自动审查");
  await settingsDesktop.getByRole("switch", { name: "启用自动审查" }).waitFor();
  await screenshot(settingsDesktop, "desktop-settings-auto-review");
  await settingsDesktop.getByRole("switch", { name: "启用自动审查" }).click();
  await settingsDesktop.getByRole("button", { name: "查看变更", exact: true }).click();
  await screenshot(settingsDesktop, "desktop-settings-auto-review-confirm");
  const lastReviewRule = settingsDesktop.locator(".lorca-approval-review-list li").last();
  await lastReviewRule.scrollIntoViewIfNeeded();
  await settingsDesktop.locator(".lorca-approval-confirmation > p").last().evaluate((element) => element.scrollIntoView({ block: "center" }));
  const confirmationButton = settingsDesktop.getByRole("button", { name: "确认并提交", exact: true });
  for (const [label, locator] of [["Last approval rule", lastReviewRule], ["Approval confirmation button", confirmationButton]]) {
    assert.equal(await locator.isVisible(), true, `${label} is visible`);
    const geometry = await locator.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const scroll = element.closest(".lorca-settings-scroll").getBoundingClientRect();
      const footer = document.querySelector(".lorca-auto-review-actions").getBoundingClientRect();
      const isRule = element.matches(".lorca-approval-review-list li");
      const points = [[bounds.left + 2, bounds.top + 2], [bounds.right - 2, bounds.top + 2], [bounds.left + 2, bounds.bottom - 2], [bounds.right - 2, bounds.bottom - 2], [(bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2]];
      return {
        complete: bounds.width > 0 && bounds.height > 0 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= Math.max(0, scroll.top, document.querySelector(".lorca-settings-page-header").getBoundingClientRect().bottom) && bounds.bottom <= Math.min(innerHeight, scroll.bottom, isRule ? footer.top - 18 : innerHeight),
        unobscured: points.every(([x, y]) => element.contains(document.elementFromPoint(x, y))),
      };
    });
    assert.equal(geometry.complete, true, `${label} fits completely above any sticky footer or viewport edge`);
    assert.equal(geometry.unobscured, true, `${label} is not covered by another element`);
  }
  await screenshot(settingsDesktop, "desktop-settings-auto-review-confirm-end");
  await settingsDesktop.getByRole("button", { name: "返回修改", exact: true }).click();
  await settingsDesktop.keyboard.press("Escape");
  assert.equal(
    await settingsDesktop
      .getByRole("dialog", { name: "设置", exact: true })
      .count(),
    0,
    "Escape closes desktop settings",
  );
  const offline = await browser.newPage({
    viewport: { width: 1200, height: 850 },
  });
  failurePage = offline;
  captureErrors(offline);
  await offline.goto(base, { waitUntil: "networkidle" });
  await offline
    .getByText("连接本地服务后即可发送消息。", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await offline
      .getByRole("button", { name: "发送消息", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await offline.locator(".lorca-header-status").innerText(),
    "未连接",
  );
  await screenshot(offline, "desktop-disconnected-light");
  const controlled = await browser.newPage({
    viewport: { width: 1200, height: 850 },
  });
  failurePage = controlled;
  captureErrors(controlled);
  await controlled.addInitScript(() => {
    const epoch = Math.floor(Date.now() / 1000);
    const createChat = (id, title) => ({
      id,
      kind: "dm",
      title,
      bot_ids: ["fixture-bot"],
      created_at: epoch,
      has_more: false,
      messages: [
        {
          id: `${id}-opening`,
          chat_id: id,
          author: { kind: "bot", bot_id: "fixture-bot" },
          body: { kind: "text", text: "Synthetic UI interaction fixture." },
          state: { kind: "complete" },
          created_at: epoch,
        },
      ],
    });
    const snapshot = {
      version: "synthetic-test",
      identity_id: "fixture-identity-one",
      has_identity: true,
      relay_connected: false,
      bots: [
        { id: "fixture-bot", name: "Fixture bot", runner_id: "fixture-runner" },
      ],
      chats: [
        createChat("fixture-one", "Fixture One"),
        createChat("fixture-two", "Fixture Two"),
      ],
      running_turns: [],
      running_chat_ids: [],
    };
    const ledger = [];
    const sends = [];
    const eventListeners = new Set();
    const statusListeners = new Set();
    const watching = [];
    let reuseChatId = null;
    window.__lorcaUiTest = {
      ledger,
      sends,
      watching,
      reuseChat: (id) => { reuseChatId = id; },
      reconnect: () => {
        for (const status of ["connecting", "connected"]) {
          for (const listener of statusListeners)
            listener({
              status,
              endpoint: "ws://127.0.0.1:4862/ws",
              generation: 2,
              authMode: "token",
            });
        }
      },
      changeIdentity: () => {
        snapshot.identity_id = "fixture-identity-two";
        for (const listener of eventListeners)
          listener({ event: "identity.changed", data: { has_identity: true } });
      },
      rejectSend: () => {
        sends.shift().reject(new Error("Synthetic send failure"));
      },
      job: (event) => {
        for (const listener of eventListeners) listener({ event, data: { job_id: "synthetic-stop-job", chat_id: "fixture-two", bot_id: "fixture-bot" } });
      },
      complete: () => {
        const item = sends.shift();
        item.resolve({
          message: {
            id: item.params.message_id,
            chat_id: item.params.chat_id,
            author: { kind: "you" },
            body: { kind: "text", text: item.params.text },
            state: { kind: "complete" },
            created_at: epoch + 1,
          },
        });
      },
    };
    window.lorca = {
      setWatchingChat: async (id) => { watching.push(id); },
      getStatus: async () => ({
        status: "connected",
        endpoint: "ws://127.0.0.1:4862/ws",
        generation: 1,
        authMode: "token",
        detail: "Synthetic UI test bridge",
      }),
      connect: async () => {
        throw new Error("Synthetic UI tests must not connect to services.");
      },
      request: async (method, params) => {
        ledger.push({ method, params });
        if (method === "bootstrap") return structuredClone(snapshot);
        if (method === "chats.create") {
          if (reuseChatId) return { chat: structuredClone(snapshot.chats.find((chat) => chat.id === reuseChatId)) };
          const chat = {
            ...createChat(params.id, "Created fixture chat"),
            messages: [],
          };
          snapshot.chats.push(chat);
          return { chat };
        }
        if (method === "chats.stop") throw new Error("Synthetic stop failure");
        if (method === "chats.send")
          return new Promise((resolve, reject) =>
            sends.push({ params, resolve, reject }),
          );
        throw new Error(`Unexpected synthetic request: ${method}`);
      },
      onEvent: (listener) => {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
      },
      onStatus: (listener) => {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
    };
  });
  await controlled.goto(base, { waitUntil: "networkidle" });
  await chooseChat(controlled, "Fixture One");
  await controlled.waitForFunction(() => window.__lorcaUiTest.watching.at(-1) === "fixture-one");
  const watchingBeforeTyping = await controlled.evaluate(() => window.__lorcaUiTest.watching.length);
  await controlled
    .getByRole("textbox", { name: "给 dots 发消息" })
    .fill("第一条合成测试消息");
  assert.equal(await controlled.evaluate(() => window.__lorcaUiTest.watching.length), watchingBeforeTyping, "Typing does not repeatedly change the watched conversation");
  await controlled
    .getByRole("textbox", { name: "给 dots 发消息" })
    .dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });
  assert.equal(
    await controlled.evaluate(() => window.__lorcaUiTest.sends.length),
    0,
    "Chinese IME confirmation does not submit the draft",
  );
  await controlled
    .getByRole("button", { name: "发送消息", exact: true })
    .click();
  await controlled
    .getByRole("textbox", { name: "给 dots 发消息" })
    .fill("New edits while sending");
  await controlled.keyboard.press("Enter");
  assert.equal(
    await controlled.evaluate(
      () =>
        window.__lorcaUiTest.ledger.filter(
          (item) => item.method === "chats.send",
        ).length,
    ),
    1,
    "Repeated send is prevented while acknowledgement is pending",
  );
  await chooseChat(controlled, "Fixture Two");
  await controlled
    .getByRole("textbox", { name: "给 dots 发消息" })
    .fill("Second chat draft");
  await controlled.evaluate(() => window.__lorcaUiTest.complete());
  await controlled.waitForFunction(
    () => document.querySelector(".lorca-send-button")?.disabled === false,
  );
  assert.equal(
    await controlled
      .getByRole("textbox", { name: "给 dots 发消息" })
      .inputValue(),
    "Second chat draft",
    "Late acknowledgement preserves another chat's draft",
  );
  await chooseChat(controlled, "Fixture One");
  assert.equal(
    await controlled
      .getByRole("textbox", { name: "给 dots 发消息" })
      .inputValue(),
    "New edits while sending",
    "Late acknowledgement preserves new edits in the original chat",
  );
  await controlled.getByText("第一条合成测试消息", { exact: true }).waitFor();
  await controlled.keyboard.press("Control+n");
  await controlled
    .getByRole("textbox", { name: "给 dots 发消息" })
    .fill("Preserve a failed first message");
  await controlled
    .getByRole("button", { name: "发送消息", exact: true })
    .click();
  await controlled.waitForFunction(
    () => window.__lorcaUiTest.sends.length === 1,
  );
  assert.equal(
    await controlled.locator(".lorca-header-title").innerText(),
    "开始聊天",
    "Created chat stays unselected until send succeeds",
  );
  assert.equal(await controlled.getByRole("button", { name: "选择智能体", exact: true }).isDisabled(), true, "Bot selection stays disabled while the first send is pending");
  await controlled.evaluate(() => window.__lorcaUiTest.rejectSend());
  await controlled
    .getByText("Synthetic send failure", { exact: true })
    .waitFor();
  assert.equal(
    await controlled
      .getByRole("textbox", { name: "给 dots 发消息" })
      .inputValue(),
    "Preserve a failed first message",
    "Failed first message remains visibly in the new-chat composer",
  );
  assert.equal(
    await controlled.locator(".lorca-header-title").innerText(),
    "开始聊天",
  );
  await controlled
    .getByRole("textbox", { name: "给 dots 发消息" })
    .fill("Successful first message");
  await controlled
    .getByRole("button", { name: "发送消息", exact: true })
    .click();
  await controlled.waitForFunction(
    () => window.__lorcaUiTest.sends.length === 1,
  );
  await controlled
    .getByRole("textbox", { name: "给 dots 发消息" })
    .fill("Edited new-chat follow-up");
  await controlled.evaluate(() => window.__lorcaUiTest.complete());
  await controlled
    .getByText("Successful first message", { exact: true })
    .waitFor();
  assert.equal(
    await controlled.locator(".lorca-header-title").innerText(),
    "Created fixture chat",
  );
  assert.equal(
    await controlled
      .getByRole("textbox", { name: "给 dots 发消息" })
      .inputValue(),
    "Edited new-chat follow-up",
    "New draft edits migrate into the successfully created chat",
  );
  await controlled.keyboard.press("Control+n");
  await controlled
    .getByRole("textbox", { name: "给 dots 发消息" })
    .fill("Create without stealing navigation");
  await controlled
    .getByRole("button", { name: "发送消息", exact: true })
    .click();
  await controlled.waitForFunction(
    () => window.__lorcaUiTest.sends.length === 1,
  );
  await chooseChat(controlled, "Fixture Two");
  await controlled.evaluate(() => window.__lorcaUiTest.complete());
  await controlled.waitForFunction(
    () => document.querySelector(".lorca-send-button")?.disabled === false,
  );
  assert.equal(
    await controlled.locator(".lorca-header-title").innerText(),
    "Fixture Two",
    "Late first-send acknowledgement does not steal explicit navigation",
  );
  await controlled.getByRole("textbox", { name: "给 dots 发消息" }).fill("Accepted despite a concurrent stop failure");
  await controlled.getByRole("button", { name: "发送消息", exact: true }).click();
  await controlled.waitForFunction(() => window.__lorcaUiTest.sends.length === 1);
  await controlled.evaluate(() => window.__lorcaUiTest.job("job.started"));
  await controlled.getByRole("button", { name: "停止回复", exact: true }).click();
  await controlled.getByText("Synthetic stop failure", { exact: true }).waitFor();
  await controlled.evaluate(() => window.__lorcaUiTest.complete());
  await controlled.waitForFunction(() => document.querySelector("#lorca-composer")?.value === "");
  await controlled.getByText("Accepted despite a concurrent stop failure", { exact: true }).waitFor();
  assert.equal(await controlled.locator(".lorca-composer-error").innerText(), "Synthetic stop failure", "The unrelated stop error remains distinct from the acknowledged send");
  await controlled.evaluate(() => window.__lorcaUiTest.job("job.finished"));
  await chooseChat(controlled, "Fixture One");
  await controlled.getByRole("textbox", { name: "给 dots 发消息" }).fill("Existing unique DM draft");
  await controlled.evaluate(() => window.__lorcaUiTest.reuseChat("fixture-one"));
  await controlled.keyboard.press("Control+n");
  await controlled.waitForFunction(() => window.__lorcaUiTest.watching.at(-1) === null);
  await controlled.getByRole("textbox", { name: "给 dots 发消息" }).fill("Send through the existing unique DM");
  await controlled.getByRole("button", { name: "发送消息", exact: true }).click();
  await controlled.waitForFunction(() => window.__lorcaUiTest.sends.length === 1);
  await controlled.getByRole("textbox", { name: "给 dots 发消息" }).fill("Separate new-chat follow-up draft");
  await controlled.evaluate(() => window.__lorcaUiTest.complete());
  await controlled.waitForFunction(() => document.querySelector(".lorca-header-chat-title")?.textContent === "Fixture One");
  assert.equal(await controlled.getByRole("textbox", { name: "给 dots 发消息" }).inputValue(), "Existing unique DM draft", "Returning a unique DM never clears its older unsent text");
  await controlled.keyboard.press("Control+n");
  assert.equal(await controlled.getByRole("textbox", { name: "给 dots 发消息" }).inputValue(), "Separate new-chat follow-up draft", "Concurrent new-chat edits remain separate when the destination already has a draft");
  await chooseChat(controlled, "Fixture Two");
  await openConnectionSettings(controlled);
  await controlled.waitForFunction(() => window.__lorcaUiTest.watching.at(-1) === null);
  await controlled
    .getByRole("button", { name: "连接本次会话", exact: true })
    .click();
  await controlled.locator(".lorca-settings .lorca-field-error").waitFor();
  assert.equal(
    await controlled
      .locator(".lorca-settings-form-actions [role=status]")
      .count(),
    0,
    "Rejected endpoint connection never reports success",
  );
  await controlled.getByRole("button", { name: "返回聊天" }).click();
  await controlled.waitForFunction(() => window.__lorcaUiTest.watching.at(-1) === "fixture-two");
  await controlled.keyboard.press("Control+n");
  await controlled
    .getByRole("textbox", { name: "给 dots 发消息" })
    .fill("Private account draft");
  await controlled.evaluate(() => window.__lorcaUiTest.reconnect());
  await controlled.waitForFunction(
    () => document.querySelector(".lorca-send-button")?.disabled === false,
  );
  assert.equal(
    await controlled
      .getByRole("textbox", { name: "给 dots 发消息" })
      .inputValue(),
    "Private account draft",
    "Ordinary reconnect preserves drafts",
  );
  await controlled.evaluate(() => window.__lorcaUiTest.changeIdentity());
  await controlled.waitForFunction(
    () => document.querySelector("#lorca-composer")?.value === "",
  );
  await chooseChat(controlled, "Fixture Two");
  assert.equal(
    await controlled
      .getByRole("textbox", { name: "给 dots 发消息" })
      .inputValue(),
    "",
    "Account switch clears drafts across all conversations",
  );
  const settingsInteraction = await browser.newPage({ viewport: { width: 1240, height: 820 } });
  failurePage = settingsInteraction;
  captureErrors(settingsInteraction);
  await settingsInteraction.addInitScript(installSettingsFixture);
  await settingsInteraction.goto(base, { waitUntil: "networkidle" });
  await openConnectionSettings(settingsInteraction);
  await waitForSettings(settingsInteraction);
  await chooseSettingsPage(settingsInteraction, "智能体");
  await settingsInteraction.getByRole("combobox", { name: "服务商", exact: true }).selectOption("provider-two");
  assert.equal(await settingsInteraction.getByRole("combobox", { name: "模型", exact: true }).inputValue(), "");
  assert.equal(await settingsInteraction.getByRole("combobox", { name: "思考级别", exact: true }).inputValue(), "");
  await settingsInteraction.getByRole("combobox", { name: "分配执行器", exact: true }).selectOption("runner-two");
  assert.equal(await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length), 0, "Editing bot settings is draft-only");
  await settingsInteraction.getByRole("button", { name: "应用更改", exact: true }).click();
  await settingsInteraction.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length), 0, "Cancelling scope review sends nothing");
  await settingsInteraction.getByRole("button", { name: "应用更改", exact: true }).click();
  await settingsInteraction.getByRole("button", { name: "确认应用", exact: true }).click();
  await settingsInteraction.waitForFunction(() => window.__settingsUiTest.pending.length === 1);
  assert.deepEqual(await settingsInteraction.evaluate(() => { const { revision, ...action } = window.__settingsUiTest.requests[0]; return action; }), { kind: "bot.update", botId: "bot-one", provider: "provider-two", model: "", thinking: "", runnerId: "runner-two" });
  assert.equal(await settingsInteraction.getByRole("combobox", { name: "分配执行器", exact: true }).isDisabled(), true);
  await settingsInteraction.evaluate(() => window.__settingsUiTest.reject());
  await settingsInteraction.getByText("合成测试：保存失败", { exact: true }).first().waitFor();
  assert.equal(await settingsInteraction.getByRole("combobox", { name: "服务商", exact: true }).inputValue(), "provider-two", "Failed apply preserves form values");
  await settingsInteraction.getByRole("button", { name: "应用更改", exact: true }).click();
  await settingsInteraction.getByRole("button", { name: "确认应用", exact: true }).click();
  await settingsInteraction.evaluate(() => window.__settingsUiTest.resolve("applied"));
  await settingsInteraction.waitForFunction(() => window.__settingsUiTest.snapshot.bots[0].runnerId === "runner-two" && document.querySelector(".lorca-settings-runtime-toolbar")?.getAttribute("aria-busy") === "false");
  await settingsInteraction.getByRole("combobox", { name: "查看设备", exact: true }).selectOption("runner-two");
  await settingsInteraction.waitForFunction(() => document.querySelector("#lorca-bot-runner")?.value === "runner-two" && !document.querySelector("#lorca-bot-runner")?.matches(":disabled"));
  await chooseSettingsPage(settingsInteraction, "自动审查");
  await settingsInteraction.getByRole("button", { name: "添加规则", exact: true }).click();
  const ruleFields = settingsInteraction.locator(".lorca-approval-rule-fields");
  assert.equal(await ruleFields.last().getByRole("combobox").inputValue(), "ask", "New approval rules default to asking");
  await ruleFields.last().getByRole("textbox", { name: /适用情景/ }).fill("Read only the synthetic fixture");
  assert.equal(await ruleFields.first().getByRole("textbox", { name: /备注/ }).inputValue(), "Ask before external messages", "Existing tool-rule text remains editable as a note");
  await ruleFields.last().getByRole("textbox", { name: "精确工具 ID（plugin_id/tool，可选）", exact: true }).fill("messages/send");
  await ruleFields.last().getByRole("combobox").selectOption("allow");
  assert.equal(await ruleFields.last().getByRole("textbox", { name: /备注/ }).inputValue(), "Read only the synthetic fixture", "Choosing a tool relabels text without rewriting it");
  await ruleFields.last().getByText("精确工具：messages/send。启用自动审查后，将始终允许此工具；备注不构成限制条件。", { exact: true }).waitFor();
  await settingsInteraction.getByRole("alert").filter({ hasText: "后端按首条匹配处理，不保证“始终询问”优先" }).waitFor();
  assert.equal(await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).isDisabled(), true, "Duplicate tools block saving until explicitly changed");
  assert.equal(await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length), 2, "Duplicate tools do not dispatch any setting action");
  await ruleFields.last().getByRole("textbox", { name: "精确工具 ID（plugin_id/tool，可选）", exact: true }).fill("filesystem/read_complete_identifier");
  await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).click();
  const toolReview = settingsInteraction.locator(".lorca-approval-confirmation");
  await toolReview.getByText("始终允许此工具", { exact: true }).waitFor();
  await toolReview.getByText("备注：Read only the synthetic fixture", { exact: true }).waitFor();
  await toolReview.getByText("精确工具：filesystem/read_complete_identifier。启用自动审查后，将始终允许此工具；备注不构成限制条件。", { exact: true }).waitFor();
  await settingsInteraction.getByRole("button", { name: "返回修改", exact: true }).click();
  await ruleFields.last().getByRole("textbox", { name: "精确工具 ID（plugin_id/tool，可选）", exact: true }).fill("");
  await ruleFields.last().getByRole("combobox").selectOption("ask");
  await settingsInteraction.getByRole("switch", { name: "启用自动审查" }).click();
  assert.equal(await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length), 2, "Approval edits do not immediately mutate");
  const refreshApprovalSnapshot = async () => {
    const previousTicket = await settingsInteraction.evaluate(() => window.__settingsUiTest.snapshot.editor.revision);
    await settingsInteraction.getByRole("button", { name: "刷新", exact: true }).click();
    await settingsInteraction.waitForFunction((ticket) => window.__settingsUiTest.snapshot.editor.revision !== ticket && document.querySelector(".lorca-settings-runtime-toolbar")?.getAttribute("aria-busy") === "false", previousTicket);
  };
  await refreshApprovalSnapshot();
  assert.equal(await ruleFields.last().getByRole("textbox", { name: /适用情景/ }).inputValue(), "Read only the synthetic fixture", "Same policy with a new ticket preserves the dirty draft");
  assert.equal(await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).isEnabled(), true, "Ticket renewal alone never creates a configuration conflict");
  assert.equal(await settingsInteraction.getByRole("alert").filter({ hasText: "服务端配置已更新" }).count(), 0);
  await settingsInteraction.getByRole("button", { name: "返回聊天", exact: true }).click();
  await openConnectionSettings(settingsInteraction);
  await waitForSettings(settingsInteraction);
  await chooseSettingsPage(settingsInteraction, "自动审查");
  assert.equal(await ruleFields.count(), 2, "Closing and reopening settings preserves the edited policy");
  assert.equal(await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).isEnabled(), true, "Reopening with unchanged policy keeps the draft editable");
  await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).click();
  await refreshApprovalSnapshot();
  await settingsInteraction.getByRole("region", { name: "确认自动审查变更", exact: true }).waitFor();
  assert.equal(await settingsInteraction.getByRole("button", { name: "确认并提交", exact: true }).isEnabled(), true, "A renewed ticket preserves scope review and enables explicit submission");
  await settingsInteraction.setViewportSize({ width: 560, height: 820 });
  await settingsInteraction.locator(".lorca-settings-drawer .lorca-approval-confirmation").waitFor();
  assert.equal(await ruleFields.last().getByRole("textbox", { name: /适用情景/ }).inputValue(), "Read only the synthetic fixture", "Compact frame remount preserves the draft and review");
  await settingsInteraction.setViewportSize({ width: 1240, height: 820 });
  await settingsInteraction.locator(".lorca-settings-desktop .lorca-approval-confirmation").waitFor();
  assert.equal(await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length), 2, "Refresh, reopen and breakpoint changes never submit a policy");
  const reviewedTicket = await settingsInteraction.evaluate(() => window.__settingsUiTest.snapshot.editor.revision);
  await settingsInteraction.getByRole("button", { name: "确认并提交", exact: true }).click();
  await settingsInteraction.waitForFunction(() => window.__settingsUiTest.pending.length === 1);
  assert.equal(await settingsInteraction.getByRole("switch", { name: "启用自动审查" }).isDisabled(), true);
  const approvalAction = await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.at(-1));
  assert.equal(approvalAction.kind, "autoReview.set");
  assert.equal(approvalAction.revision, reviewedTicket, "Explicit submission uses the current ticket after unchanged readbacks");
  assert.equal(approvalAction.isEnabled, true);
  assert.equal(approvalAction.rules[0].id, "existing-rule");
  assert.equal(approvalAction.rules[1].behavior, "ask");
  assert.equal("id" in approvalAction.rules[1], false);
  await settingsInteraction.evaluate(() => window.__settingsUiTest.resolve("cancelled"));
  await settingsInteraction.getByText("已取消提交，草稿仍保留，未确认应用任何变更。", { exact: true }).waitFor();
  assert.equal(await settingsInteraction.getByRole("switch", { name: "启用自动审查" }).getAttribute("aria-checked"), "true");
  await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).click();
  await settingsInteraction.getByRole("button", { name: "确认并提交", exact: true }).click();
  await settingsInteraction.evaluate(() => { window.__settingsUiTest.holdReadback(); window.__settingsUiTest.resolve("unknownOutcome"); });
  await settingsInteraction.waitForFunction(() => window.__settingsUiTest.readbacks.length === 1);
  assert.equal(await ruleFields.last().getByRole("textbox", { name: /适用情景/ }).inputValue(), "Read only the synthetic fixture", "Loading a readback does not unmount or replace the pending policy draft");
  await settingsInteraction.evaluate(() => window.__settingsUiTest.releaseReadback());
  await settingsInteraction.getByText("无法确认提交结果。草稿仍保留，请先刷新并核对实际设置，避免重复提交。", { exact: true }).waitFor();
  assert.equal(await ruleFields.count(), 2, "Unknown result retains the complete draft rule table after a new revision arrives");
  assert.equal(await settingsInteraction.getByRole("switch", { name: "启用自动审查" }).getAttribute("aria-checked"), "true");
  await settingsInteraction.getByRole("region", { name: "当前读回配置", exact: true }).getByText("自动审查：关闭", { exact: true }).waitFor();
  assert.equal(await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).isDisabled(), true, "Unknown outcome is never automatically replayed");
  const afterUnknown = await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length);
  await settingsInteraction.getByRole("button", { name: "刷新", exact: true }).click();
  await settingsInteraction.getByRole("button", { name: "刷新", exact: true }).waitFor();
  assert.equal(await ruleFields.last().getByRole("textbox", { name: /适用情景/ }).inputValue(), "Read only the synthetic fixture", "Explicit refresh preserves unknown-result draft");
  await settingsInteraction.getByText("无法确认提交结果。草稿仍保留，请先刷新并核对实际设置，避免重复提交。", { exact: true }).waitFor();
  assert.equal(await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length), afterUnknown);
  await settingsInteraction.getByRole("button", { name: "返回聊天", exact: true }).click();
  await openConnectionSettings(settingsInteraction);
  await waitForSettings(settingsInteraction);
  await chooseSettingsPage(settingsInteraction, "自动审查");
  await settingsInteraction.getByText("无法确认提交结果。草稿仍保留，请先刷新并核对实际设置，避免重复提交。", { exact: true }).waitFor();
  for (const width of [560, 1240, 560, 1240]) {
    await settingsInteraction.setViewportSize({ width, height: 820 });
    const surface = width === 560 ? ".lorca-settings-drawer" : ".lorca-settings-desktop";
    await settingsInteraction.locator(`${surface} .lorca-auto-review-panel`).waitFor();
    assert.equal(await ruleFields.count(), 2, "Every breakpoint remount retains the complete uncertain policy draft");
    assert.equal(await ruleFields.last().getByRole("textbox", { name: /适用情景/ }).inputValue(), "Read only the synthetic fixture");
    await settingsInteraction.getByText("无法确认提交结果。草稿仍保留，请先刷新并核对实际设置，避免重复提交。", { exact: true }).waitFor();
    assert.equal(await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).isDisabled(), true, "Unknown-result lock survives every responsive remount");
  }
  await refreshApprovalSnapshot();
  assert.equal(await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).isDisabled(), true, "Refreshing after remount does not clear the unknown-result lock");
  assert.equal(await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length), afterUnknown, "Unknown policy is never automatically replayed by reopen, resize or refresh");
  await chooseSettingsPage(settingsInteraction, "插件");
  await settingsInteraction.getByRole("button", { name: "移除", exact: true }).click();
  await settingsInteraction.getByText(/删除其本地配置、凭据、数据和关联的工具规则/).waitFor();
  const beforeDelete = await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length);
  await settingsInteraction.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length), beforeDelete, "Cancel leaves destructive MCP action undispatched");
  await settingsInteraction.getByRole("button", { name: "配置…", exact: true }).click();
  await settingsInteraction.waitForFunction(() => window.__settingsUiTest.pending.length === 1);
  const secureAction = await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.at(-1));
  assert.deepEqual(Object.keys(secureAction).sort(), ["kind", "name", "revision", "runnerId"]);
  assert.equal(secureAction.kind, "mcp.configure");
  assert.equal(await settingsInteraction.locator('input[type="password"], textarea').count(), 1, "Only the chat composer remains; no secret configuration form exists in the main renderer");
  await settingsInteraction.evaluate(() => window.__settingsUiTest.resolve("cancelled"));
  await settingsInteraction.getByText("已取消，未应用更改。", { exact: true }).waitFor();
  await chooseSettingsPage(settingsInteraction, "自动审查");
  await settingsInteraction.getByText("无法确认提交结果。草稿仍保留，请先刷新并核对实际设置，避免重复提交。", { exact: true }).waitFor();
  assert.equal(await ruleFields.last().getByRole("textbox", { name: /适用情景/ }).inputValue(), "Read only the synthetic fixture", "Switching settings pages preserves unknown-result draft");
  await settingsInteraction.evaluate(() => window.__settingsUiTest.disconnect());
  assert.equal(await settingsInteraction.getByRole("button", { name: "放弃草稿并采用当前配置", exact: true }).isDisabled(), true, "Unavailable readback cannot replace a draft");
  await settingsInteraction.evaluate(() => window.__settingsUiTest.reconnect());
  await settingsInteraction.getByRole("button", { name: "刷新", exact: true }).click();
  await settingsInteraction.getByRole("region", { name: "当前读回配置", exact: true }).waitFor();
  await settingsInteraction.getByRole("button", { name: "放弃草稿并采用当前配置", exact: true }).click();
  assert.equal(await ruleFields.count(), 1);
  assert.equal(await settingsInteraction.getByRole("switch", { name: "启用自动审查" }).getAttribute("aria-checked"), "false", "Only explicit adoption discards uncertain policy draft");
  await ruleFields.first().getByRole("textbox", { name: /备注/ }).fill("Private unsaved policy draft");
  await settingsInteraction.evaluate(() => { window.__settingsUiTest.snapshot.editor.autoReview.rules[0].text = "Changed by another client"; });
  const beforeConflict = await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length);
  await settingsInteraction.getByRole("button", { name: "刷新", exact: true }).click();
  await settingsInteraction.getByRole("alert").filter({ hasText: "服务端配置已更新" }).waitFor();
  assert.equal(await ruleFields.first().getByRole("textbox", { name: /备注/ }).inputValue(), "Private unsaved policy draft", "External revision changes never silently replace dirty policy text");
  await settingsInteraction.getByRole("region", { name: "当前读回配置", exact: true }).getByText("备注：Changed by another client", { exact: true }).waitFor();
  assert.equal(await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).isDisabled(), true, "Dirty policy cannot overwrite a new revision without explicit reconciliation");
  assert.equal(await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length), beforeConflict);
  await settingsInteraction.evaluate(() => window.__settingsUiTest.changeIdentity(null));
  await settingsInteraction.waitForFunction(() => !Array.from(document.querySelectorAll("input")).some((input) => input.value === "Private unsaved policy draft"));
  await settingsInteraction.evaluate(() => window.__settingsUiTest.changeIdentity("synthetic-next-identity"));
  await openConnectionSettings(settingsInteraction);
  await waitForSettings(settingsInteraction);
  await chooseSettingsPage(settingsInteraction, "自动审查");
  assert.equal(await ruleFields.first().getByRole("textbox", { name: /备注/ }).inputValue(), "Changed by another client", "Identity loss and replacement clear private policy drafts");
  assert.equal(await settingsInteraction.getByText("无法确认提交结果。草稿仍保留，请先刷新并核对实际设置，避免重复提交。", { exact: true }).count(), 0);
  const avatars = await browser.newPage({ viewport: { width: 1240, height: 820 } });
  failurePage = avatars;
  captureErrors(avatars);
  const externalAvatarRequests = [];
  avatars.on("request", (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin) externalAvatarRequests.push(request.url()); });
  await avatars.addInitScript(installAvatarFixture);
  await avatars.goto(base, { waitUntil: "networkidle" });
  const avatarPicker = avatars.getByRole("button", { name: "选择智能体", exact: true });
  assert.equal(await avatarPicker.isEnabled(), true, "Bot selection remains enabled before starting a chat");
  await avatars.locator('.lorca-agent-picker [data-avatar-bot="avatar-photo"] img').waitFor();
  await avatarPicker.click();
  await avatars.locator('[data-picker-agent="avatar-symbol"]').click();
  assert.equal(await avatars.locator('.lorca-agent-picker [data-avatar-bot="avatar-symbol"] [data-icon="ComputerTerminal01"]').count(), 1, "Composer uses the selected bot's symbol fallback");
  assert.equal(await avatars.locator(".lorca-agent-picker img").count(), 0);
  await avatarPicker.focus();
  await avatarPicker.press("Enter");
  await avatars.getByRole("searchbox", { name: "搜索智能体", exact: true }).fill("Photo Bot");
  await avatars.getByRole("searchbox", { name: "搜索智能体", exact: true }).fill("");
  await avatars.locator('[data-picker-agent="avatar-photo"]').click();
  await avatars.locator('.lorca-agent-picker [data-avatar-bot="avatar-photo"] img').waitFor();
  assert.equal(await avatarPicker.evaluate((element) => element.tagName), "BUTTON", "Agent picker has an accessible popover trigger");
  await avatarPicker.click();
  await avatars.getByRole("searchbox", { name: "搜索智能体", exact: true }).press("Escape");
  await expectRestoredFocus(avatarPicker);
  assert.equal(await avatarPicker.evaluate(element => document.activeElement === element), true, "Escape returns focus to the picker");
  await chooseChat(avatars, "合成头像 · 单聊");
  assert.equal(await avatarPicker.count(), 0, "Existing-chat composers do not repeat the agent picker");
  await avatars.waitForFunction(() => Array.from(document.querySelectorAll('[data-avatar-bot="avatar-photo"] img')).every((image) => image.complete && image.naturalWidth === 64) && document.querySelectorAll('[data-avatar-bot="avatar-photo"] img').length >= 3);
  assert.equal(await avatars.locator('.lorca-brand .lorca-brand-logo img[data-app-mark="ghost"]').count(), 1, "Application Ghost mark remains separate from bot avatars");
  assert.equal(await avatars.locator('.lorca-avatar img[data-app-mark="ghost"]').count(), 0, "Actual bot and user avatars never inherit the application Ghost mark");
  assert.equal(await avatars.locator(".lorca-user-message .lorca-avatar-person").count(), 1);
  const userGhost = avatars.locator('.lorca-user-message img[data-user-avatar="ghost"]');
  await userGhost.evaluate((image) => image.decode());
  const userArtwork = await userGhost.evaluate((image) => ({ source: new URL(image.src).pathname, width: image.naturalWidth, height: image.naturalHeight, filter: getComputedStyle(image).filter, opacity: getComputedStyle(image).opacity }));
  assert.equal(userArtwork.source.endsWith("/app-icon/64.png"), true, "The user's avatar uses the selected Ghost artwork");
  assert.equal(userArtwork.width, 64);
  assert.equal(userArtwork.height, 64);
  assert.equal(userArtwork.filter, "grayscale(1) contrast(0.45) brightness(1.65)", "Neutral gray treatment is scoped to the user Ghost image");
  assert.equal(userArtwork.opacity, "1", "User artwork is gray without fading its containing UI");
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] img').count(), 1);
  assert.equal(await avatars.evaluate(() => window.__avatarUiTest.calls.filter((id) => id === "avatar-photo").length), 1, "Sidebar, header and transcript deduplicate avatar reads");
  await screenshot(avatars, "desktop-avatars-light");
  await openConnectionSettings(avatars);
  await waitForSettings(avatars);
  await chooseSettingsPage(avatars, "通用");
  await avatars.getByRole("button", { name: "深色", exact: true }).click();
  await avatars.getByRole("button", { name: "返回聊天", exact: true }).click();
  await screenshot(avatars, "desktop-avatars-dark");
  await chooseChat(avatars, "合成头像 · 群组");
  assert.equal(await avatars.locator(".lorca-header-title .lorca-avatar-stack .lorca-avatar").count(), 2);
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-symbol"] [data-icon="ComputerTerminal01"]').count(), 1);
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] img').count(), 1);
  await screenshot(avatars, "desktop-avatars-group");
  await assertNeutralAvatarFallbacks(avatars);
  await screenshot(avatars, "desktop-avatar-fallbacks-dark");
  await openConnectionSettings(avatars);
  await waitForSettings(avatars);
  await chooseSettingsPage(avatars, "通用");
  await avatars.getByRole("button", { name: "浅色", exact: true }).click();
  await avatars.getByRole("button", { name: "返回聊天", exact: true }).click();
  await assertNeutralAvatarFallbacks(avatars);
  await screenshot(avatars, "desktop-avatar-fallbacks-light");
  await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] img').dispatchEvent("error");
  await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] img').waitFor({ state: "detached" });
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] img').count(), 0, "A failed image decode falls back locally");
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] svg').count(), 1);
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] [data-avatar-fallback]').count(), 1, "Decode errors use the same neutral fallback surface");
  assert.equal(await avatars.locator(".lorca-composer-error").count(), 0);
  await avatars.evaluate(() => window.__avatarUiTest.replace());
  await avatars.waitForFunction(() => document.querySelectorAll('[data-avatar-bot="avatar-photo"] img').length >= 3 && Array.from(document.querySelectorAll('[data-avatar-bot="avatar-photo"] img')).every((image) => image.src === window.__avatarUiTest.images[1] && image.complete && image.naturalWidth === 64));
  assert.equal(await avatars.evaluate(() => window.__avatarUiTest.calls.filter((id) => id === "avatar-photo").length), 2, "A changed avatar version is reloaded exactly once");
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] img').count(), 1, "A new valid avatar replaces an earlier failed decode fallback");
  await chooseChat(avatars, "合成头像 · 缓存缺失");
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-missing"] img').count(), 0);
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-missing"][data-accent="orange"]').count(), 1);
  assert.equal(await avatars.locator(".lorca-composer-error").count(), 0, "Missing local avatar cache does not fail the chat");
  const nativeLayout = await browser.newPage({ viewport: { width: 1240, height: 820 } });
  failurePage = nativeLayout;
  captureErrors(nativeLayout);
  await nativeLayout.addInitScript(installAvatarFixture);
  await nativeLayout.goto(base, { waitUntil: "networkidle" });
  await nativeLayout.evaluate(() => { document.documentElement.dataset.lorcaPlatform = "darwin"; });
  await chooseChat(nativeLayout, "合成头像 · 单聊");
  await assertDesktopDensity(nativeLayout);
  const nativeChrome = await nativeLayout.evaluate(() => {
    const brand = document.querySelector(".lorca-brand-logo").getBoundingClientRect();
    return {
      brandLeft: brand.left,
      brandCenter: brand.top + brand.height / 2,
      headerDrag: getComputedStyle(document.querySelector(".lorca-header")).getPropertyValue("-webkit-app-region"),
      statusDrag: getComputedStyle(document.querySelector(".lorca-header-status")).getPropertyValue("-webkit-app-region"),
      titleDrag: getComputedStyle(document.querySelector(".lorca-header-title")).getPropertyValue("-webkit-app-region"),
    };
  });
  assert.ok(nativeChrome.brandLeft >= 104, "Ghost branding clears the native traffic-light rectangle");
  assert.equal(nativeChrome.brandCenter, 24, "Brand and conversation header use the same vertical center");
  assert.equal(nativeChrome.headerDrag, "drag");
  assert.equal(nativeChrome.statusDrag, "no-drag");
  assert.equal(nativeChrome.titleDrag, "no-drag");
  await assertNativeSkipLink(nativeLayout);
  await screenshot(nativeLayout, "desktop-macos-layout-light");
  await openConnectionSettings(nativeLayout);
  await waitForSettings(nativeLayout);
  assert.equal(await nativeLayout.locator(".lorca-settings-back").evaluate((element) => { const rect = element.getBoundingClientRect(); return rect.right <= 0 || rect.left >= 88 || rect.bottom <= 0 || rect.top >= 40; }), true, "Content return action clears the native traffic-light rectangle");
  assert.ok(await nativeLayout.locator(".lorca-settings-sidebar .lorca-settings-nav-item").first().evaluate((element) => element.getBoundingClientRect().top) >= 44, "Settings sidebar navigation remains below the traffic lights");
  assert.equal(await nativeLayout.getByRole("button", { name: "返回聊天", exact: true }).evaluate((element) => getComputedStyle(element).getPropertyValue("-webkit-app-region")), "no-drag");
  await screenshot(nativeLayout, "desktop-macos-settings-layout");
  await nativeLayout.getByRole("button", { name: "返回聊天", exact: true }).click();
  await nativeLayout.setViewportSize({ width: 760, height: 520 });
  await nativeLayout.waitForFunction(() => !document.querySelector(".lorca-sidebar"));
  const minimumLayout = await nativeLayout.evaluate(() => ({
    titleLeft: document.querySelector(".lorca-header-title").getBoundingClientRect().left,
    headerRight: document.querySelector(".lorca-header-actions").getBoundingClientRect().right,
    composerBottom: document.querySelector(".lorca-composer").getBoundingClientRect().bottom,
    editorHeight: document.querySelector("#lorca-composer").getBoundingClientRect().height,
  }));
  assert.ok(minimumLayout.titleLeft >= 88, "Compact native header avoids traffic lights");
  assert.ok(minimumLayout.headerRight <= 760);
  assert.ok(minimumLayout.composerBottom < 520);
  assert.ok(minimumLayout.editorHeight >= 50, "Minimum window keeps the editor usable");
  await assertNativeSkipLink(nativeLayout);
  await screenshot(nativeLayout, "desktop-minimum-window");
  await nativeLayout.getByRole("textbox", { name: "给 dots 发消息" }).fill("Synthetic minimum-window draft");
  await openConnectionSettings(nativeLayout);
  await waitForSettings(nativeLayout);
  await nativeLayout.getByRole("button", { name: "返回聊天", exact: true }).click();
  assert.equal(await nativeLayout.getByRole("textbox", { name: "给 dots 发消息" }).inputValue(), "Synthetic minimum-window draft", "Compact native settings can be opened and closed without losing the draft");
  failurePage = avatars;
  await avatars.evaluate(() => window.__avatarUiTest.loseIdentity());
  await avatars.waitForFunction(() => document.querySelectorAll("[data-avatar-image]").length === 0);
  assert.deepEqual(externalAvatarRequests, [], "Bot avatars never fetch remote image URLs in the renderer");
  await checkCrossAgentRows();
  await checkDevicePairing();
  await checkSharedDeviceScope();
  await runLayoutToolsDiagnostics();
  await checkVisualSurfaces({ browser, base, screenshot, openConnectionSettings, chooseSettingsPage, waitForSettings, chooseChat, captureErrors, setFailurePage: (page) => { failurePage = page; } });
  await checkSettingsLayoutSurfaces({ browser, base, screenshot, captureErrors, setFailurePage: (page) => { failurePage = page; } });
  await checkSidebarViewSurfaces({ browser, base, screenshot, captureErrors, setFailurePage: (page) => { failurePage = page; } });
  assert.deepEqual(
    failures,
    [],
    "No browser console errors or uncaught exceptions",
  );
  console.log(
    JSON.stringify(
      {
        result: "passed",
        screenshots: output,
        browser: "Chromium desktop and mobile emulation",
        checks: [
          "Synthetic labels",
          "Chromium command line has no --no-sandbox flag",
          "Final approval rule and confirmation button are complete and unobscured",
          "Simplified Chinese UI and input composition",
          "Desktop and mobile light/dark",
          "No horizontal overflow",
          "Borderless desktop layout, aligned reading columns and visible composer focus",
          "Synthetic macOS traffic-light safe area and minimum-window geometry",
          "Search keyboard shortcut",
          "New-chat keyboard shortcut",
          "Failed-send draft preservation",
          "Mobile drawer leaves app root active",
          "Offline disables sending",
          "Repeated send deduplication",
          "Late acknowledgement preserves edited and switched-chat drafts",
          "First-send failure preserves the visible new draft",
          "First-send success migrates edited draft without stealing navigation",
          "Unique DM reuse preserves both existing and new-chat drafts without merging them",
          "Conversation visibility stops in settings and empty state without repeated typing updates",
          "Rejected endpoint save never reports success",
          "Settings screenshot waits for realized content",
          "Approval capability-ticket renewal preserves edited scope review",
          "Approval draft and unknown lock survive reopen and responsive remount",
          "Ordinary reconnect preserves drafts",
          "Account switch clears all drafts",
          "Desktop settings panes and read-only runner inspection",
          "Appearance survives view reload within the session",
          "Desktop settings Escape and app-root focus behavior",
          "Bot avatars in sidebar, header, messages and searchable composer picker",
          "Composer avatar follows keyboard selection and preserves disabled states",
          "Avatar replacement, identity clearing and no renderer remote-image fetches",
          "Neutral default, symbol and missing-cache avatars across light/dark themes",
          "Glass headers sample real scrolled content and reduce to opaque surfaces on request",
          "Footer default, hover and restored keyboard focus have no white icon tile",
          "Real sidebar avatars scroll behind the blur footer with measured pixels and an opaque reduced-transparency fallback",
          "Last sidebar conversation remains unobscured, keyboard reachable and activatable",
          "Device pairing requires both current native capability and callback, opens only one native flow, and never infers pairing completion",
          "Seven official settings groups share read-only device scope; phone and unknown-role selection skip MCP and never migrate agents",
          "Incoming handoff and completed outgoing message_bot rows resolve known counterpart avatars without recoloring bot PNGs",
          "2048px wide and 760px reading columns align tools and composer, preserve anchors and keep Jump-to-latest outside the transcript",
          "Consecutive tool groups preserve expansion through updates, live additions and historical prepends while errors remain visible",
          "Reported pairing blockers are shown together without claiming missing backend RPCs",
          "Settings description contrast is at least 4.5:1 in light and dark themes",
          "Custom pink PNG source pixels and unfiltered display stay unchanged",
          "No console errors",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  await saveFailure(failurePage, "ui-smoke-failure");
  if (!layoutToolsStarted) {
    try { await runLayoutToolsDiagnostics(); }
    catch (diagnosticError) { console.error("Additional independent browser checks failed:", diagnosticError); }
  }
  throw error;
} finally {
  await browser.close();
}
