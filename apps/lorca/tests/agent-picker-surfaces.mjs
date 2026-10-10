import assert from "node:assert/strict";
import { expectRestoredFocus } from "./focus-restoration.mjs";

function installAgentPickerFixture({ theme }) {
  localStorage.setItem("bb-lorca.appearance", theme);
  const events = new Set();
  const statuses = new Set();
  const requests = [];
  let held = false;
  let releaseRefresh;
  let roster = [];
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  context.fillStyle = "#8d7789";
  context.fillRect(0, 0, 32, 32);
  context.fillStyle = "#eee9df";
  context.fillRect(8, 6, 16, 20);
  context.fillStyle = "#51434f";
  context.fillRect(11, 12, 3, 3);
  context.fillRect(19, 12, 3, 3);
  const avatar = canvas.toDataURL("image/png");
  const bots = Array.from({ length: 45 }, (_, index) => ({
    id: `picker-bot-${String(index).padStart(2, "0")}`,
    name: index === 0 ? "合成头像助手" : `合成检索助手 ${String(index).padStart(2, "0")}`,
    runner_id: "picker-runner",
    symbol_name: "terminal",
    accent: "indigo",
    ...(index === 0 ? { has_avatar: true, avatar_version: "synthetic-picker-avatar" } : {}),
  }));
  roster = bots;
  const epoch = Math.floor(Date.now() / 1000);
  const snapshot = () => ({
    version: "synthetic-agent-picker",
    identity_id: "synthetic-picker-account",
    has_identity: true,
    relay_connected: false,
    devices: [{ id: "picker-runner", name: "合成选择器 Runner", status: "online" }],
    bots: structuredClone(roster),
    chats: [{ id: "picker-existing", kind: "dm", title: "合成选择器 · 已有聊天", bot_ids: [bots[0].id], messages: [], created_at: epoch, has_more: false }],
    running_turns: [],
    running_chat_ids: [],
  });
  const status = (value) => ({ status: value, endpoint: "ws://127.0.0.1:4862/ws", generation: 1, authMode: "token", detail: "仅用于合成智能体选择器测试" });
  window.__agentPickerTest = {
    avatar,
    requests,
    setEmpty(value) {
      roster = value ? [] : bots;
      for (const listener of events) listener({ event: "roster.changed", data: { bots: structuredClone(roster), chats: snapshot().chats } });
    },
    holdRefresh() {
      held = true;
      for (const listener of statuses) listener(status("disconnected"));
      for (const listener of statuses) listener(status("connected"));
    },
    resumeRefresh() {
      held = false;
      releaseRefresh?.();
      releaseRefresh = undefined;
    },
  };
  window.lorca = {
    getStatus: async () => status("connected"),
    connect: async () => { throw new Error("Synthetic picker fixtures cannot connect to services"); },
    request: async (method, params) => {
      requests.push({ method, params: structuredClone(params) });
      if (method !== "bootstrap") throw new Error(`Unexpected synthetic picker request: ${method}`);
      if (held) await new Promise((resolve) => { releaseRefresh = resolve; });
      return snapshot();
    },
    getBotAvatar: async (id, version) => id === bots[0].id && version === "synthetic-picker-avatar" ? avatar : null,
    onEvent: (listener) => { events.add(listener); return () => events.delete(listener); },
    onStatus: (listener) => { statuses.add(listener); return () => statuses.delete(listener); },
  };
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function focused(locator) {
  await locator.evaluate((element) => new Promise((resolve, reject) => {
    const deadline = performance.now() + 1000;
    const check = () => {
      if (document.activeElement === element) resolve(true);
      else if (performance.now() >= deadline) reject(new Error("Expected focus restoration within one second"));
      else requestAnimationFrame(check);
    };
    check();
  }));
  assert.equal(await locator.evaluate((element) => document.activeElement === element), true);
}

export async function checkAgentPickerSurfaces({ browser, base, screenshot = async () => {}, captureErrors = () => {}, setFailurePage = () => {} }) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1240, height: 820 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    setFailurePage(page);
    captureErrors(page);
    try {
      await page.addInitScript(installAgentPickerFixture, { theme });
      await page.goto(base, { waitUntil: "networkidle" });
      const picker = page.getByRole("button", { name: "选择智能体", exact: true });
      const panel = page.locator(".lorca-agent-picker-popover");
      const search = panel.getByRole("searchbox", { name: "搜索智能体", exact: true });
      const options = panel.locator("[data-picker-agent]");
      await page.locator(".lorca-chat-item").filter({ hasText: "合成选择器 · 已有聊天" }).click();
      await page.locator('.lorca-chat-item[aria-current="page"]').filter({ hasText: "合成选择器 · 已有聊天" }).waitFor();
      assert.equal(await picker.count(), 0, "Existing conversations do not expose the new-chat agent picker");
      await page.locator(".lorca-new-chat").click();
      await picker.waitFor();
      await page.waitForFunction(() => document.querySelector(".lorca-agent-picker")?.disabled === false);
      await picker.press("Enter");
      await search.waitFor();
      await focused(search);
      assert.equal(await options.count(), 45);
      await page.waitForFunction(() => document.querySelector('.lorca-agent-picker-popover [data-picker-agent="picker-bot-00"] img')?.naturalWidth === 32);
      const image = await panel.locator('[data-picker-agent="picker-bot-00"] img').evaluate((element) => ({ src: element.src, width: element.naturalWidth, filter: getComputedStyle(element).filter, opacity: getComputedStyle(element).opacity }));
      assert.deepEqual(image, { src: await page.evaluate(() => window.__agentPickerTest.avatar), width: 32, filter: "none", opacity: "1" }, "The picker uses the safely supplied actual synthetic avatar unchanged");
      const initial = await picker.getAttribute("data-selected-agent");
      assert.equal(await panel.locator(`[data-picker-agent="${initial}"]`).getAttribute("aria-pressed"), "true");

      await search.press("ArrowDown");
      await focused(options.nth(0));
      await page.keyboard.press("ArrowDown");
      await focused(options.nth(1));
      await page.keyboard.press("ArrowUp");
      await focused(options.nth(0));
      await page.keyboard.press("ArrowUp");
      await focused(search);
      await search.fill("检索助手 17");
      assert.equal(await options.count(), 1);
      assert.equal(await options.first().getAttribute("data-picker-agent"), "picker-bot-17");
      for (const key of ["Enter", "ArrowDown"]) {
        const state = await search.evaluate((element, eventKey) => {
          element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "合" }));
          const event = new KeyboardEvent("keydown", { key: eventKey, code: eventKey, bubbles: true, cancelable: true, isComposing: true });
          element.dispatchEvent(event);
          element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "合" }));
          return { focused: document.activeElement === element, prevented: event.defaultPrevented };
        }, key);
        assert.deepEqual(state, { focused: true, prevented: false }, `IME ${key} does not select or move focus`);
        assert.equal(await picker.getAttribute("data-selected-agent"), initial);
        assert.equal(await panel.isVisible(), true);
      }
      await search.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true })));
      assert.equal(await picker.getAttribute("data-selected-agent"), initial, "Legacy IME keyCode 229 cannot select an agent");
      await search.press("Enter");
      await panel.waitFor({ state: "hidden" });
      assert.equal(await picker.getAttribute("data-selected-agent"), "picker-bot-17");
      await expectRestoredFocus(picker);

      await picker.click();
      assert.equal(await search.inputValue(), "", "Every explicit open starts with an unfiltered roster");
      await search.fill("合成无匹配结果");
      assert.equal(await options.count(), 0);
      await panel.getByRole("status").filter({ hasText: "没有匹配的智能体" }).waitFor();
      await search.press("Enter");
      assert.equal(await panel.isVisible(), true);
      assert.equal(await picker.getAttribute("data-selected-agent"), "picker-bot-17");
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "hidden" });
      await expectRestoredFocus(picker);
      await picker.click();
      await page.getByRole("textbox", { name: "给 dots 发消息", exact: true }).click();
      await panel.waitFor({ state: "hidden" });
      await focused(page.getByRole("textbox", { name: "给 dots 发消息", exact: true }));

      await page.setViewportSize({ width: 900, height: 420 });
      await picker.click();
      await search.waitFor();
      await search.press("ArrowDown");
      await page.keyboard.press("End");
      await focused(options.last());
      await settle(page);
      const geometry = await panel.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const list = element.querySelector(".lorca-agent-picker-results");
        const last = list.lastElementChild.getBoundingClientRect();
        const visible = list.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, clientHeight: list.clientHeight, scrollHeight: list.scrollHeight, scrollTop: list.scrollTop, lastVisible: last.top >= visible.top - 1 && last.bottom <= visible.bottom + 1 };
      });
      assert.ok(geometry.x >= 10 && geometry.y >= 10 && geometry.right <= geometry.viewportWidth - 10 && geometry.bottom <= geometry.viewportHeight - 10, "The short desktop viewport keeps the popover within collision padding");
      assert.ok(geometry.scrollHeight > geometry.clientHeight && geometry.clientHeight > 0 && geometry.scrollTop > 0 && geometry.lastVisible, "The roster scrolls and keyboard navigation reveals its last item");
      await screenshot(page, `desktop-agent-picker-short-${theme}`);
      await page.keyboard.press("Home");
      await focused(options.first());
      await page.keyboard.press("Enter");
      await panel.waitFor({ state: "hidden" });
      assert.equal(await picker.getAttribute("data-selected-agent"), "picker-bot-00");
      await expectRestoredFocus(picker);
      await page.setViewportSize({ width: 1240, height: 820 });

      await picker.click();
      await search.waitFor();
      await page.evaluate(() => window.__agentPickerTest.holdRefresh());
      await page.waitForFunction(() => document.querySelector(".lorca-agent-picker")?.disabled === true);
      await panel.waitFor({ state: "hidden" });
      await page.evaluate(() => window.__agentPickerTest.resumeRefresh());
      await page.waitForFunction(() => document.querySelector(".lorca-agent-picker")?.disabled === false);
      await settle(page);
      assert.equal(await panel.isVisible(), false, "Finishing a temporary disabled state does not resurrect a dismissed panel");
      await picker.click();
      await search.waitFor();
      await page.evaluate(() => window.__agentPickerTest.setEmpty(true));
      await page.waitForFunction(() => document.querySelector(".lorca-agent-picker")?.disabled === true);
      await panel.waitFor({ state: "hidden" });
      assert.match(await picker.innerText(), /暂无智能体/);
      await page.evaluate(() => window.__agentPickerTest.setEmpty(false));
      await page.waitForFunction(() => document.querySelector(".lorca-agent-picker")?.disabled === false);
      await settle(page);
      assert.equal(await panel.isVisible(), false, "Restoring an empty roster requires a new explicit open");
      await picker.click();
      await search.waitFor();
      assert.equal(await options.count(), 45);
      await screenshot(page, `desktop-agent-picker-${theme}`);
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "hidden" });
      await expectRestoredFocus(picker);
      assert.equal(await page.evaluate(() => window.__agentPickerTest.requests.some((request) => request.method !== "bootstrap")), false, "Searching and selecting an agent never creates a chat, sends a message or changes daemon configuration");
    } catch (error) {
      await screenshot(page, `agent-picker-failure-${theme}`).catch(() => undefined);
      throw error;
    } finally {
      await context.close();
    }
  }
}
