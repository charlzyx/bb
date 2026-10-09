import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  chromiumSandbox: process.env.LORCA_CHROMIUM_NO_SANDBOX !== "1",
});
const failures = [];
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
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function waitForSettings(page) {
  await page
    .getByRole("textbox", { name: "Lorca WebSocket endpoint" })
    .waitFor();
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
  const desktop = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  captureErrors(desktop);
  await desktop.goto(`${base}/?demo=1`, { waitUntil: "networkidle" });
  await desktop
    .getByRole("heading", { name: "Where should we begin?" })
    .waitFor();
  await screenshot(desktop, "desktop-empty-light");
  await chooseChat(desktop, /^Lorca$/);
  await desktop.locator(".lorca-assistant-message").first().waitFor();
  await desktop.locator(".lorca-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  await screenshot(desktop, "desktop-conversation-light");
  await desktop.locator(".lorca-header-status").click();
  const savedEndpoint = await desktop
    .getByRole("textbox", { name: "Lorca WebSocket endpoint" })
    .inputValue();
  await desktop
    .getByRole("textbox", { name: "Lorca WebSocket endpoint" })
    .fill("ws://remote.invalid/ws");
  await desktop
    .getByRole("button", { name: "Connect for this session", exact: true })
    .click();
  await desktop
    .getByText(
      "Use ws://127.0.0.1:<port>/ws or ws://localhost:<port>/ws with a port from 1 to 65535.",
      { exact: true },
    )
    .waitFor();
  await desktop.getByRole("button", { name: "Close settings" }).click();
  await desktop.locator(".lorca-header-status").click();
  assert.equal(
    await desktop
      .getByRole("textbox", { name: "Lorca WebSocket endpoint" })
      .inputValue(),
    savedEndpoint,
    "Closing settings discards unsaved endpoint edits and validation errors",
  );
  assert.equal(await desktop.locator(".lorca-field-error").count(), 0);
  await chooseSettingsPage(desktop, "Preferences");
  await desktop.getByRole("button", { name: "Dark", exact: true }).click();
  await desktop.getByRole("button", { name: "Close settings" }).click();
  await screenshot(desktop, "desktop-conversation-dark");
  await desktop.locator(".lorca-header-status").click();
  await chooseSettingsPage(desktop, "Preferences");
  await desktop.getByRole("button", { name: "Light", exact: true }).click();
  await desktop.getByRole("button", { name: "Close settings" }).click();
  const preview = desktop
    .locator(".lorca-chat-item")
    .filter({ hasText: "Approval and activity preview" });
  if (await preview.count()) {
    await preview.click();
    await desktop.getByRole("button", { name: "Allow once" }).waitFor();
    await screenshot(desktop, "desktop-approval-light");
  }
  await desktop.keyboard.press("Control+k");
  await desktop
    .getByRole("searchbox", { name: "Search chats" })
    .fill("nonexistent fixture title");
  await desktop.getByText("No matching chats", { exact: true }).waitFor();
  await desktop.getByRole("searchbox", { name: "Search chats" }).fill("");
  await desktop.keyboard.press("Control+n");
  await desktop
    .getByRole("textbox", { name: "Message Lorca" })
    .fill("Keep my synthetic draft");
  await desktop.keyboard.press("Enter");
  await desktop.getByRole("alert").first().waitFor();
  assert.equal(
    await desktop.getByRole("textbox", { name: "Message Lorca" }).inputValue(),
    "Keep my synthetic draft",
  );

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  captureErrors(mobile);
  await mobile.goto(`${base}/?demo=1`, { waitUntil: "networkidle" });
  await screenshot(mobile, "mobile-empty-light");
  await mobile.getByRole("button", { name: "Open chats" }).click();
  await mobile.locator(".lorca-chat-item").first().waitFor();
  await screenshot(mobile, "mobile-chats-light");
  await chooseChat(mobile, /^Lorca$/);
  await mobile.locator(".lorca-assistant-message").first().waitFor();
  await screenshot(mobile, "mobile-conversation-light");
  assert.equal(await mobile.locator("#root").getAttribute("aria-hidden"), null);
  assert.equal(await mobile.locator("#root").getAttribute("inert"), null);
  await mobile.locator(".lorca-header-status").click();
  await mobile
    .getByRole("textbox", { name: "Lorca WebSocket endpoint" })
    .waitFor();
  await mobile
    .getByRole("textbox", { name: "Lorca WebSocket endpoint" })
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
  await chooseSettingsPage(mobile, "Preferences");
  await mobile.getByRole("button", { name: "Dark", exact: true }).click();
  await mobile.getByRole("button", { name: "Close settings" }).click();
  await screenshot(mobile, "mobile-conversation-dark");

  const settingsDesktop = await browser.newPage({
    viewport: { width: 1240, height: 820 },
    deviceScaleFactor: 1,
  });
  captureErrors(settingsDesktop);
  await settingsDesktop.goto(`${base}/?demo=1`, { waitUntil: "networkidle" });
  await settingsDesktop.locator(".lorca-header-status").click();
  await waitForSettings(settingsDesktop);
  await screenshot(settingsDesktop, "desktop-settings-connection");
  await chooseSettingsPage(settingsDesktop, "Preferences");
  await screenshot(settingsDesktop, "desktop-settings-preferences");
  await settingsDesktop
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await settingsDesktop.reload({ waitUntil: "networkidle" });
  assert.equal(
    await settingsDesktop.locator("html").getAttribute("class"),
    "dark",
    "Appearance restores on reload within this session",
  );
  await settingsDesktop.locator(".lorca-header-status").click();
  await waitForSettings(settingsDesktop);
  await chooseSettingsPage(settingsDesktop, "Preferences");
  await screenshot(settingsDesktop, "desktop-settings-preferences-dark");
  await settingsDesktop
    .getByRole("button", { name: "Light", exact: true })
    .click();
  await chooseSettingsPage(settingsDesktop, "Runners");
  await settingsDesktop
    .getByText("Demo desktop", { exact: true })
    .first()
    .waitFor();
  await screenshot(settingsDesktop, "desktop-settings-runners");
  await settingsDesktop
    .locator(".lorca-runtime-disclosure summary")
    .first()
    .click();
  await settingsDesktop
    .getByText("Tool count not reported", { exact: true })
    .waitFor();
  await screenshot(settingsDesktop, "desktop-settings-runner-details");
  await chooseSettingsPage(settingsDesktop, "MCP");
  await settingsDesktop
    .getByRole("combobox", { name: "Runner", exact: true })
    .waitFor();
  await screenshot(settingsDesktop, "desktop-settings-mcp");
  await settingsDesktop
    .getByRole("combobox", { name: "Runner", exact: true })
    .selectOption("runner-second");
  await settingsDesktop
    .getByText("MCP inventory unavailable", { exact: true })
    .waitFor();
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
  await settingsDesktop.keyboard.press("Escape");
  assert.equal(
    await settingsDesktop
      .getByRole("dialog", { name: "Settings", exact: true })
      .count(),
    0,
    "Escape closes desktop settings",
  );
  const offline = await browser.newPage({
    viewport: { width: 1200, height: 850 },
  });
  captureErrors(offline);
  await offline.goto(base, { waitUntil: "networkidle" });
  await offline
    .getByText("Connect your local Lorca runtime to send a message.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await offline
      .getByRole("button", { name: "Send message", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await offline.locator(".lorca-header-status").innerText(),
    "Offline",
  );
  await screenshot(offline, "desktop-disconnected-light");
  const controlled = await browser.newPage({
    viewport: { width: 1200, height: 850 },
  });
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
    .getByRole("textbox", { name: "Message Lorca" })
    .fill("First synthetic submission");
  await controlled
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await controlled
    .getByRole("textbox", { name: "Message Lorca" })
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
    .getByRole("textbox", { name: "Message Lorca" })
    .fill("Second chat draft");
  await controlled.evaluate(() => window.__lorcaUiTest.complete());
  await controlled.waitForFunction(
    () => document.querySelector(".lorca-send-button")?.disabled === false,
  );
  assert.equal(
    await controlled
      .getByRole("textbox", { name: "Message Lorca" })
      .inputValue(),
    "Second chat draft",
    "Late acknowledgement preserves another chat's draft",
  );
  await chooseChat(controlled, "Fixture One");
  assert.equal(
    await controlled
      .getByRole("textbox", { name: "Message Lorca" })
      .inputValue(),
    "New edits while sending",
    "Late acknowledgement preserves new edits in the original chat",
  );
  await controlled
    .getByText("First synthetic submission", { exact: true })
    .waitFor();
  await controlled.keyboard.press("Control+n");
  await controlled
    .getByRole("textbox", { name: "Message Lorca" })
    .fill("Preserve a failed first message");
  await controlled
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await controlled.waitForFunction(
    () => window.__lorcaUiTest.sends.length === 1,
  );
  assert.equal(
    await controlled.locator(".lorca-header-title").innerText(),
    "New chat",
    "Created chat stays unselected until send succeeds",
  );
  await controlled.evaluate(() => window.__lorcaUiTest.rejectSend());
  await controlled
    .getByText("Synthetic send failure", { exact: true })
    .waitFor();
  assert.equal(
    await controlled
      .getByRole("textbox", { name: "Message Lorca" })
      .inputValue(),
    "Preserve a failed first message",
    "Failed first message remains visibly in the new-chat composer",
  );
  assert.equal(
    await controlled.locator(".lorca-header-title").innerText(),
    "New chat",
  );
  await controlled
    .getByRole("textbox", { name: "Message Lorca" })
    .fill("Successful first message");
  await controlled
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await controlled.waitForFunction(
    () => window.__lorcaUiTest.sends.length === 1,
  );
  await controlled
    .getByRole("textbox", { name: "Message Lorca" })
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
      .getByRole("textbox", { name: "Message Lorca" })
      .inputValue(),
    "Edited new-chat follow-up",
    "New draft edits migrate into the successfully created chat",
  );
  await controlled.keyboard.press("Control+n");
  await controlled
    .getByRole("textbox", { name: "Message Lorca" })
    .fill("Create without stealing navigation");
  await controlled
    .getByRole("button", { name: "Send message", exact: true })
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
  await controlled.locator(".lorca-header-status").click();
  await controlled
    .getByRole("button", { name: "Connect for this session", exact: true })
    .click();
  await controlled.locator(".lorca-settings .lorca-field-error").waitFor();
  assert.equal(
    await controlled
      .locator(".lorca-settings-form-actions [role=status]")
      .count(),
    0,
    "Rejected endpoint connection never reports success",
  );
  await controlled.getByRole("button", { name: "Close settings" }).click();
  await controlled.keyboard.press("Control+n");
  await controlled
    .getByRole("textbox", { name: "Message Lorca" })
    .fill("Private account draft");
  await controlled.evaluate(() => window.__lorcaUiTest.reconnect());
  await controlled.waitForFunction(
    () => document.querySelector(".lorca-send-button")?.disabled === false,
  );
  assert.equal(
    await controlled
      .getByRole("textbox", { name: "Message Lorca" })
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
      .getByRole("textbox", { name: "Message Lorca" })
      .inputValue(),
    "",
    "Account switch clears drafts across all conversations",
  );
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
          "Ordinary reconnect preserves drafts",
          "Account switch clears all drafts",
          "Desktop settings panes and read-only runner inspection",
          "Appearance survives view reload within the session",
          "Desktop settings Escape and app-root focus behavior",
          "No console errors",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
