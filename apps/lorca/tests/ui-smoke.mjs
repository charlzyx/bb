import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installSettingsFixture } from "./settings-ui-fixture.mjs";
import { installAvatarFixture } from "./avatar-ui-fixture.mjs";

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
const captureErrors = (page) => {
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
};
async function screenshot(page, name) {
  await page.evaluate(() => document.fonts.ready);
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
  assert.equal(overflow.page, false, `${name}: horizontal page overflow`);
  assert.equal(overflow.composer, false, `${name}: composer overflow`);
}
async function chooseSettingsPage(page, label) {
  await page
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function waitForSettings(page) {
  await page.getByRole("textbox", { name: "WebSocket 连接地址" }).waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".lorca-settings-runtime-toolbar")
        ?.getAttribute("aria-busy") === "false",
  );
}
async function chooseChat(page, text) {
  await page
    .locator(".lorca-chat-item")
    .filter({ hasText: text })
    .first()
    .click();
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
    viewport: { width: 1440, height: 1000 },
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
  assert.equal(await desktop.locator(".lorca-brand svg circle").count(), 4);
  const faviconUrl = await desktop
    .locator('link[rel="icon"]')
    .evaluate(
      (element) => new URL(element.getAttribute("href"), document.baseURI).href,
    );
  assert.equal(new URL(faviconUrl).pathname.endsWith("/dots.svg"), true);
  const faviconResponse = await desktop.request.get(faviconUrl);
  assert.equal(
    faviconResponse.ok(),
    true,
    "The dots favicon asset is available",
  );
  assert.match(faviconResponse.headers()["content-type"], /image\/svg\+xml/);
  assert.equal((await faviconResponse.text()).match(/<circle\b/g)?.length, 4);
  await desktop.getByRole("searchbox", { name: "搜索对话" }).waitFor();
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
  await desktop.locator(".lorca-header-status").click();
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
  await desktop.getByRole("button", { name: "关闭设置" }).click();
  await desktop.locator(".lorca-header-status").click();
  assert.equal(
    await desktop
      .getByRole("textbox", { name: "WebSocket 连接地址" })
      .inputValue(),
    savedEndpoint,
    "Closing settings discards unsaved endpoint edits and validation errors",
  );
  assert.equal(await desktop.locator(".lorca-field-error").count(), 0);
  await chooseSettingsPage(desktop, "偏好设置");
  await desktop.getByRole("button", { name: "深色", exact: true }).click();
  await desktop.getByRole("button", { name: "关闭设置" }).click();
  await screenshot(desktop, "desktop-conversation-dark");
  await desktop.locator(".lorca-header-status").click();
  await chooseSettingsPage(desktop, "偏好设置");
  await desktop.getByRole("button", { name: "浅色", exact: true }).click();
  await desktop.getByRole("button", { name: "关闭设置" }).click();
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
    .getByRole("searchbox", { name: "搜索对话" })
    .fill("nonexistent fixture title");
  await desktop.getByText("没有匹配的对话", { exact: true }).waitFor();
  await desktop.getByRole("searchbox", { name: "搜索对话" }).fill("");
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
  await mobile.locator(".lorca-header-status").click();
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
  await chooseSettingsPage(mobile, "偏好设置");
  await mobile.getByRole("button", { name: "深色", exact: true }).click();
  await mobile.getByRole("button", { name: "关闭设置" }).click();
  await screenshot(mobile, "mobile-conversation-dark");

  const settingsDesktop = await browser.newPage({
    viewport: { width: 1240, height: 820 },
    deviceScaleFactor: 1,
  });
  failurePage = settingsDesktop;
  captureErrors(settingsDesktop);
  await settingsDesktop.goto(`${base}/?demo=1`, { waitUntil: "networkidle" });
  await settingsDesktop.locator(".lorca-header-status").click();
  await waitForSettings(settingsDesktop);
  await screenshot(settingsDesktop, "desktop-settings-connection");
  await chooseSettingsPage(settingsDesktop, "偏好设置");
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
  await settingsDesktop.locator(".lorca-header-status").click();
  await waitForSettings(settingsDesktop);
  await chooseSettingsPage(settingsDesktop, "偏好设置");
  await screenshot(settingsDesktop, "desktop-settings-preferences-dark");
  await settingsDesktop
    .getByRole("button", { name: "浅色", exact: true })
    .click();
  await chooseSettingsPage(settingsDesktop, "执行器");
  await settingsDesktop
    .getByText("Demo desktop", { exact: true })
    .first()
    .waitFor();
  await screenshot(settingsDesktop, "desktop-settings-runners");
  await settingsDesktop
    .locator(".lorca-runtime-disclosure summary")
    .first()
    .click();
  await settingsDesktop.getByText("未报告工具数量", { exact: true }).waitFor();
  await screenshot(settingsDesktop, "desktop-settings-runner-details");
  await chooseSettingsPage(settingsDesktop, "MCP");
  await settingsDesktop
    .getByRole("combobox", { name: "执行器", exact: true })
    .waitFor();
  await screenshot(settingsDesktop, "desktop-settings-mcp");
  await settingsDesktop
    .getByRole("combobox", { name: "执行器", exact: true })
    .selectOption("runner-second");
  await settingsDesktop.getByText("MCP 清单不可用", { exact: true }).waitFor();
  await screenshot(settingsDesktop, "desktop-settings-mcp-unavailable");
  assert.equal(
    await settingsDesktop.locator(".lorca-agent-picker select").inputValue(),
    "bot-demo",
    "Inspecting a runner never reassigns the chat bot",
  );
  assert.equal(
    await settingsDesktop.locator("#root").getAttribute("inert"),
    null,
  );
  assert.equal(
    await settingsDesktop.locator("#root").getAttribute("aria-hidden"),
    null,
  );
  await chooseSettingsPage(settingsDesktop, "模型与机器人");
  await settingsDesktop.getByRole("combobox", { name: "分配执行器", exact: true }).waitFor();
  await screenshot(settingsDesktop, "desktop-settings-models");
  await settingsDesktop.getByRole("combobox", { name: "分配执行器", exact: true }).selectOption("runner-second");
  await settingsDesktop.getByRole("button", { name: "应用更改", exact: true }).click();
  await screenshot(settingsDesktop, "desktop-settings-models-confirm");
  await settingsDesktop.getByRole("button", { name: "取消", exact: true }).click();
  await chooseSettingsPage(settingsDesktop, "自动审批");
  await settingsDesktop.getByRole("switch", { name: "启用自动审批" }).waitFor();
  await screenshot(settingsDesktop, "desktop-settings-auto-review");
  await settingsDesktop.getByRole("switch", { name: "启用自动审批" }).click();
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
        complete: bounds.width > 0 && bounds.height > 0 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= Math.max(0, scroll.top) && bounds.bottom <= Math.min(innerHeight, scroll.bottom, isRule ? footer.top : innerHeight),
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
    window.__lorcaUiTest = {
      ledger,
      sends,
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
  await controlled
    .getByRole("textbox", { name: "给 dots 发消息" })
    .fill("第一条合成测试消息");
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
  assert.equal(await controlled.getByRole("combobox", { name: "选择机器人", exact: true }).isDisabled(), true, "Bot selection stays disabled while the first send is pending");
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
  await controlled.locator(".lorca-header-status").click();
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
  await controlled.getByRole("button", { name: "关闭设置" }).click();
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
  await settingsInteraction.locator(".lorca-header-status").click();
  await waitForSettings(settingsInteraction);
  await chooseSettingsPage(settingsInteraction, "模型与机器人");
  await settingsInteraction.getByRole("combobox", { name: "模型服务商", exact: true }).selectOption("provider-two");
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
  assert.equal(await settingsInteraction.getByRole("combobox", { name: "模型服务商", exact: true }).inputValue(), "provider-two", "Failed apply preserves form values");
  await settingsInteraction.getByRole("button", { name: "应用更改", exact: true }).click();
  await settingsInteraction.getByRole("button", { name: "确认应用", exact: true }).click();
  await settingsInteraction.evaluate(() => window.__settingsUiTest.resolve("applied"));
  await settingsInteraction.waitForFunction(() => document.querySelector("#lorca-bot-runner")?.value === "runner-two" && !document.querySelector("#lorca-bot-runner")?.matches(":disabled"));
  await chooseSettingsPage(settingsInteraction, "自动审批");
  await settingsInteraction.getByRole("button", { name: "添加规则", exact: true }).click();
  const ruleFields = settingsInteraction.locator(".lorca-approval-rule-fields");
  assert.equal(await ruleFields.last().getByRole("combobox").inputValue(), "ask", "New approval rules default to asking");
  await ruleFields.last().getByRole("textbox", { name: /适用情景/ }).fill("Read only the synthetic fixture");
  assert.equal(await ruleFields.first().getByRole("textbox", { name: /备注/ }).inputValue(), "Ask before external messages", "Existing tool-rule text remains editable as a note");
  await ruleFields.last().getByRole("textbox", { name: "精确工具 ID（plugin_id/tool，可选）", exact: true }).fill("messages/send");
  await ruleFields.last().getByRole("combobox").selectOption("allow");
  assert.equal(await ruleFields.last().getByRole("textbox", { name: /备注/ }).inputValue(), "Read only the synthetic fixture", "Choosing a tool relabels text without rewriting it");
  await ruleFields.last().getByText("精确工具：messages/send。启用自动审批后，将始终允许此工具；备注不构成限制条件。", { exact: true }).waitFor();
  await settingsInteraction.getByRole("alert").filter({ hasText: "后端按首条匹配处理，不保证“始终询问”优先" }).waitFor();
  assert.equal(await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).isDisabled(), true, "Duplicate tools block saving until explicitly changed");
  assert.equal(await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length), 2, "Duplicate tools do not dispatch any setting action");
  await ruleFields.last().getByRole("textbox", { name: "精确工具 ID（plugin_id/tool，可选）", exact: true }).fill("filesystem/read_complete_identifier");
  await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).click();
  const toolReview = settingsInteraction.locator(".lorca-approval-confirmation");
  await toolReview.getByText("始终允许此工具", { exact: true }).waitFor();
  await toolReview.getByText("备注：Read only the synthetic fixture", { exact: true }).waitFor();
  await toolReview.getByText("精确工具：filesystem/read_complete_identifier。启用自动审批后，将始终允许此工具；备注不构成限制条件。", { exact: true }).waitFor();
  await settingsInteraction.getByRole("button", { name: "返回修改", exact: true }).click();
  await ruleFields.last().getByRole("textbox", { name: "精确工具 ID（plugin_id/tool，可选）", exact: true }).fill("");
  await ruleFields.last().getByRole("combobox").selectOption("ask");
  await settingsInteraction.getByRole("switch", { name: "启用自动审批" }).click();
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
  await settingsInteraction.getByRole("button", { name: "关闭设置", exact: true }).click();
  await settingsInteraction.locator(".lorca-header-status").click();
  await waitForSettings(settingsInteraction);
  await chooseSettingsPage(settingsInteraction, "自动审批");
  assert.equal(await ruleFields.count(), 2, "Closing and reopening settings preserves the edited policy");
  assert.equal(await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).isEnabled(), true, "Reopening with unchanged policy keeps the draft editable");
  await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).click();
  await refreshApprovalSnapshot();
  await settingsInteraction.getByRole("region", { name: "确认自动审批变更", exact: true }).waitFor();
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
  assert.equal(await settingsInteraction.getByRole("switch", { name: "启用自动审批" }).isDisabled(), true);
  const approvalAction = await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.at(-1));
  assert.equal(approvalAction.kind, "autoReview.set");
  assert.equal(approvalAction.revision, reviewedTicket, "Explicit submission uses the current ticket after unchanged readbacks");
  assert.equal(approvalAction.isEnabled, true);
  assert.equal(approvalAction.rules[0].id, "existing-rule");
  assert.equal(approvalAction.rules[1].behavior, "ask");
  assert.equal("id" in approvalAction.rules[1], false);
  await settingsInteraction.evaluate(() => window.__settingsUiTest.resolve("cancelled"));
  await settingsInteraction.getByText("已取消提交，草稿仍保留，未确认应用任何变更。", { exact: true }).waitFor();
  assert.equal(await settingsInteraction.getByRole("switch", { name: "启用自动审批" }).getAttribute("aria-checked"), "true");
  await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).click();
  await settingsInteraction.getByRole("button", { name: "确认并提交", exact: true }).click();
  await settingsInteraction.evaluate(() => { window.__settingsUiTest.holdReadback(); window.__settingsUiTest.resolve("unknownOutcome"); });
  await settingsInteraction.waitForFunction(() => window.__settingsUiTest.readbacks.length === 1);
  assert.equal(await ruleFields.last().getByRole("textbox", { name: /适用情景/ }).inputValue(), "Read only the synthetic fixture", "Loading a readback does not unmount or replace the pending policy draft");
  await settingsInteraction.evaluate(() => window.__settingsUiTest.releaseReadback());
  await settingsInteraction.getByText("无法确认提交结果。草稿仍保留，请先刷新并核对实际设置，避免重复提交。", { exact: true }).waitFor();
  assert.equal(await ruleFields.count(), 2, "Unknown result retains the complete draft rule table after a new revision arrives");
  assert.equal(await settingsInteraction.getByRole("switch", { name: "启用自动审批" }).getAttribute("aria-checked"), "true");
  await settingsInteraction.getByRole("region", { name: "当前读回配置", exact: true }).getByText("自动审批：关闭", { exact: true }).waitFor();
  assert.equal(await settingsInteraction.getByRole("button", { name: "查看变更", exact: true }).isDisabled(), true, "Unknown outcome is never automatically replayed");
  const afterUnknown = await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length);
  await settingsInteraction.getByRole("button", { name: "刷新", exact: true }).click();
  await settingsInteraction.getByRole("button", { name: "刷新", exact: true }).waitFor();
  assert.equal(await ruleFields.last().getByRole("textbox", { name: /适用情景/ }).inputValue(), "Read only the synthetic fixture", "Explicit refresh preserves unknown-result draft");
  await settingsInteraction.getByText("无法确认提交结果。草稿仍保留，请先刷新并核对实际设置，避免重复提交。", { exact: true }).waitFor();
  assert.equal(await settingsInteraction.evaluate(() => window.__settingsUiTest.requests.length), afterUnknown);
  await settingsInteraction.getByRole("button", { name: "关闭设置", exact: true }).click();
  await settingsInteraction.locator(".lorca-header-status").click();
  await waitForSettings(settingsInteraction);
  await chooseSettingsPage(settingsInteraction, "自动审批");
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
  await chooseSettingsPage(settingsInteraction, "MCP");
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
  await chooseSettingsPage(settingsInteraction, "自动审批");
  await settingsInteraction.getByText("无法确认提交结果。草稿仍保留，请先刷新并核对实际设置，避免重复提交。", { exact: true }).waitFor();
  assert.equal(await ruleFields.last().getByRole("textbox", { name: /适用情景/ }).inputValue(), "Read only the synthetic fixture", "Switching settings pages preserves unknown-result draft");
  await settingsInteraction.evaluate(() => window.__settingsUiTest.disconnect());
  assert.equal(await settingsInteraction.getByRole("button", { name: "放弃草稿并采用当前配置", exact: true }).isDisabled(), true, "Unavailable readback cannot replace a draft");
  await settingsInteraction.evaluate(() => window.__settingsUiTest.reconnect());
  await settingsInteraction.getByRole("button", { name: "刷新", exact: true }).click();
  await settingsInteraction.getByRole("region", { name: "当前读回配置", exact: true }).waitFor();
  await settingsInteraction.getByRole("button", { name: "放弃草稿并采用当前配置", exact: true }).click();
  assert.equal(await ruleFields.count(), 1);
  assert.equal(await settingsInteraction.getByRole("switch", { name: "启用自动审批" }).getAttribute("aria-checked"), "false", "Only explicit adoption discards uncertain policy draft");
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
  await settingsInteraction.locator(".lorca-header-status").click();
  await waitForSettings(settingsInteraction);
  await chooseSettingsPage(settingsInteraction, "自动审批");
  assert.equal(await ruleFields.first().getByRole("textbox", { name: /备注/ }).inputValue(), "Changed by another client", "Identity loss and replacement clear private policy drafts");
  assert.equal(await settingsInteraction.getByText("无法确认提交结果。草稿仍保留，请先刷新并核对实际设置，避免重复提交。", { exact: true }).count(), 0);
  const avatars = await browser.newPage({ viewport: { width: 1240, height: 820 } });
  failurePage = avatars;
  captureErrors(avatars);
  const externalAvatarRequests = [];
  avatars.on("request", (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin) externalAvatarRequests.push(request.url()); });
  await avatars.addInitScript(installAvatarFixture);
  await avatars.goto(base, { waitUntil: "networkidle" });
  const avatarPicker = avatars.getByRole("combobox", { name: "选择机器人", exact: true });
  assert.equal(await avatarPicker.isEnabled(), true, "Bot selection remains enabled before starting a chat");
  await avatars.locator('.lorca-agent-picker [data-avatar-bot="avatar-photo"] img').waitFor();
  await avatarPicker.selectOption("avatar-symbol");
  assert.equal(await avatars.locator('.lorca-agent-picker [data-avatar-bot="avatar-symbol"] [data-icon="ComputerTerminal01"]').count(), 1, "Composer uses the selected bot's symbol fallback");
  assert.equal(await avatars.locator(".lorca-agent-picker img").count(), 0);
  await avatarPicker.focus();
  await avatarPicker.press("ArrowUp");
  await avatars.waitForFunction(() => document.querySelector('.lorca-agent-picker select')?.value === "avatar-photo");
  await avatars.locator('.lorca-agent-picker [data-avatar-bot="avatar-photo"] img').waitFor();
  assert.equal(await avatarPicker.evaluate((element) => element.tagName), "SELECT", "Native keyboard selection semantics are preserved");
  assert.equal(await avatars.locator(".lorca-agent-picker option img").count(), 0, "Native options remain safe text-only entries");
  await chooseChat(avatars, "合成头像 · 单聊");
  assert.equal(await avatarPicker.isDisabled(), true, "Existing-chat bot selection remains disabled");
  await avatars.waitForFunction(() => Array.from(document.querySelectorAll('[data-avatar-bot="avatar-photo"] img')).every((image) => image.complete && image.naturalWidth === 64) && document.querySelectorAll('[data-avatar-bot="avatar-photo"] img').length >= 3);
  assert.equal(await avatars.locator(".lorca-brand .lorca-brand-logo svg").count(), 1, "Application dots mark remains separate from bot avatars");
  assert.equal(await avatars.locator(".lorca-user-message .lorca-avatar-person").count(), 1);
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] img').count(), 1);
  assert.equal(await avatars.evaluate(() => window.__avatarUiTest.calls.filter((id) => id === "avatar-photo").length), 1, "Sidebar, header and transcript deduplicate avatar reads");
  await screenshot(avatars, "desktop-avatars-light");
  await avatars.locator(".lorca-header-status").click();
  await waitForSettings(avatars);
  await chooseSettingsPage(avatars, "偏好设置");
  await avatars.getByRole("button", { name: "深色", exact: true }).click();
  await avatars.getByRole("button", { name: "关闭设置", exact: true }).click();
  await screenshot(avatars, "desktop-avatars-dark");
  await chooseChat(avatars, "合成头像 · 群组");
  assert.equal(await avatars.locator(".lorca-header-title .lorca-avatar-stack .lorca-avatar").count(), 2);
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-symbol"] [data-icon="ComputerTerminal01"]').count(), 1);
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] img').count(), 1);
  await screenshot(avatars, "desktop-avatars-group");
  await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] img').dispatchEvent("error");
  await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] img').waitFor({ state: "detached" });
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] img').count(), 0, "A failed image decode falls back locally");
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] svg').count(), 1);
  assert.equal(await avatars.locator(".lorca-composer-error").count(), 0);
  await avatars.evaluate(() => window.__avatarUiTest.replace());
  await avatars.waitForFunction(() => document.querySelectorAll('[data-avatar-bot="avatar-photo"] img').length >= 3 && Array.from(document.querySelectorAll('[data-avatar-bot="avatar-photo"] img')).every((image) => image.src === window.__avatarUiTest.images[1] && image.complete && image.naturalWidth === 64));
  assert.equal(await avatars.evaluate(() => window.__avatarUiTest.calls.filter((id) => id === "avatar-photo").length), 2, "A changed avatar version is reloaded exactly once");
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-photo"] img').count(), 1, "A new valid avatar replaces an earlier failed decode fallback");
  await chooseChat(avatars, "合成头像 · 缓存缺失");
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-missing"] img').count(), 0);
  assert.equal(await avatars.locator('.lorca-message-author [data-avatar-bot="avatar-missing"][data-accent="orange"]').count(), 1);
  assert.equal(await avatars.locator(".lorca-composer-error").count(), 0, "Missing local avatar cache does not fail the chat");
  await avatars.evaluate(() => window.__avatarUiTest.loseIdentity());
  await avatars.waitForFunction(() => document.querySelectorAll("[data-avatar-image]").length === 0);
  assert.deepEqual(externalAvatarRequests, [], "Bot avatars never fetch remote image URLs in the renderer");
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
          "Search keyboard shortcut",
          "New-chat keyboard shortcut",
          "Failed-send draft preservation",
          "Mobile drawer leaves app root active",
          "Offline disables sending",
          "Repeated send deduplication",
          "Late acknowledgement preserves edited and switched-chat drafts",
          "First-send failure preserves the visible new draft",
          "First-send success migrates edited draft without stealing navigation",
          "Rejected endpoint save never reports success",
          "Settings screenshot waits for realized content",
          "Approval capability-ticket renewal preserves edited scope review",
          "Approval draft and unknown lock survive reopen and responsive remount",
          "Ordinary reconnect preserves drafts",
          "Account switch clears all drafts",
          "Desktop settings panes and read-only runner inspection",
          "Appearance survives view reload within the session",
          "Desktop settings Escape and app-root focus behavior",
          "Bot avatars in sidebar, header, messages and native composer selector",
          "Composer avatar follows keyboard selection and preserves disabled states",
          "Avatar replacement, identity clearing and no renderer remote-image fetches",
          "No console errors",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (failurePage && !failurePage.isClosed()) {
    await failurePage
      .screenshot({
        path: `${output}/ui-smoke-failure.png`,
        animations: "disabled",
        timeout: 5000,
      })
      .catch(() => undefined);
  }
  throw error;
} finally {
  await browser.close();
}
