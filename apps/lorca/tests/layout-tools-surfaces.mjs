import assert from "node:assert/strict";
import { installLayoutToolsFixture } from "./layout-tools-ui-fixture.mjs";

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function composerRow(page) {
  assert.equal(await page.locator(".lorca-agent-picker").count(), 0, "An existing chat does not repeat an agent selector");
  assert.equal(await page.locator(".lorca-composer-footnote").count(), 0, "Composer help does not occupy a visible second footer row");
  assert.equal(await page.locator("#lorca-composer").getAttribute("aria-describedby"), "lorca-composer-help");
  assert.match(await page.locator("#lorca-composer-help").getAttribute("class"), /sr-only/);
  const runner = page.locator('.lorca-runner-summary[data-runner-kind="single"]');
  assert.equal(await runner.locator(".lorca-runner-name").innerText(), "Synthetic layout Runner");
  assert.equal(await runner.locator(".lorca-runner-status").getAttribute("data-online"), "true");
  const row = await page.locator(".lorca-composer-toolbar").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const parts = [element.querySelector(".lorca-runner-summary"), element.querySelector(".lorca-send-actions")].map((part) => part.getBoundingClientRect());
    return parts.every((part) => part.left >= bounds.left && part.right <= bounds.right && Math.abs((part.top + part.bottom - bounds.top - bounds.bottom) / 2) <= 1);
  });
  assert.equal(row, true, "Runner status and send controls share one unobscured toolbar row");
}

async function columnGeometry(page, mode) {
  await settle(page);
  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const bounds = document.querySelector(selector).getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, width: bounds.width };
    };
    const scroll = document.querySelector(".lorca-scroll");
    const bounds = scroll.getBoundingClientRect();
    const style = getComputedStyle(scroll);
    return { transcript: rect(".lorca-transcript"), tools: rect(".lorca-tool-group"), composer: rect(".lorca-composer-width"), title: rect(".lorca-header-title"), scrollLeft: bounds.left + scroll.clientLeft, scrollRight: bounds.left + scroll.clientLeft + scroll.clientWidth, paddingLeft: parseFloat(style.paddingLeft), paddingRight: parseFloat(style.paddingRight), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert.equal(layout.overflow, false);
  for (const name of ["tools", "composer"]) {
    assert.ok(Math.abs(layout[name].left - layout.transcript.left) <= 8 && Math.abs(layout[name].right - layout.transcript.right) <= 8, `${mode}: ${name} shares both reading-column edges within the scrollbar allowance: ${JSON.stringify(layout)}`);
  }
  assert.ok(Math.abs(layout.title.left - layout.transcript.left) <= 8, `${mode}: heading shares the content's left edge`);
  if (mode === "wide") {
    assert.ok(layout.paddingLeft >= 20 && layout.paddingLeft <= 48 && layout.paddingRight >= 20 && layout.paddingRight <= 48, "Wide columns keep 20–48px net side gutters");
    assert.ok(Math.abs(layout.transcript.left - layout.scrollLeft - layout.paddingLeft) <= 1 && Math.abs(layout.scrollRight - layout.transcript.right - layout.paddingRight) <= 1, "Wide content uses the available scroll width, excluding its scrollbar");
    assert.ok(layout.transcript.width > 1500, "A 2048px desktop uses a genuinely wide reading column");
  } else {
    assert.ok(Math.abs(layout.transcript.width - 760) <= 1 && Math.abs(layout.composer.width - 760) <= 1, "Reading mode caps transcript and composer at 760px");
  }
}

async function checkWidthAndStatus({ browser, base, screenshot, chooseChat, captureErrors, setFailurePage }) {
  const context = await browser.newContext({ viewport: { width: 2048, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  setFailurePage(page);
  captureErrors(page);
  await page.addInitScript(installLayoutToolsFixture);
  await page.goto(base, { waitUntil: "networkidle" });
  await chooseChat(page, "宽度布局回归");
  const controls = page.getByRole("group", { name: "内容宽度", exact: true });
  const composer = page.getByRole("textbox", { name: "给 dots 发消息" });
  await composer.fill("Synthetic draft survives width and connection-menu changes");
  assert.equal(await page.locator(".lorca-app").getAttribute("data-content-width"), "wide");
  await columnGeometry(page, "wide");
  await composerRow(page);
  await screenshot(page, "desktop-layout-wide-2048");
  await page.locator(".lorca-assistant-message").nth(10).evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.locator(".lorca-jump-latest").waitFor();
  await settle(page);
  const anchorTop = await page.evaluate(() => {
    const scroll = document.querySelector(".lorca-scroll").getBoundingClientRect();
    const anchor = Array.from(document.querySelector(".lorca-timeline").children).find((element) => element.getBoundingClientRect().bottom > scroll.top + 48);
    anchor.setAttribute("data-width-anchor-probe", "");
    return anchor.getBoundingClientRect().top;
  });
  await controls.getByRole("button", { name: "阅读", exact: true }).click();
  await settle(page);
  assert.ok(Math.abs(await page.locator("[data-width-anchor-probe]").evaluate((element) => element.getBoundingClientRect().top) - anchorTop) <= 3, "Changing width preserves the first visible content anchor instead of jumping to latest");
  assert.equal(await composer.inputValue(), "Synthetic draft survives width and connection-menu changes");
  assert.equal(await controls.getByRole("button", { name: "阅读", exact: true }).getAttribute("aria-pressed"), "true");
  await columnGeometry(page, "reading");
  await screenshot(page, "desktop-layout-reading-2048");
  await page.reload({ waitUntil: "networkidle" });
  await chooseChat(page, "宽度布局回归");
  assert.equal(await page.locator(".lorca-app").getAttribute("data-content-width"), "reading", "The local width preference restores on reload");
  await controls.getByRole("button", { name: "宽屏", exact: true }).click();
  await composer.fill("Synthetic popover draft");
  const middleTool = page.locator('[data-tool-group="layout-tool-15-0"] .lorca-tool-group-toggle');
  await middleTool.evaluate((element) => element.scrollIntoView({ block: "end" }));
  await page.locator(".lorca-jump-latest").waitFor();
  await middleTool.evaluate((element) => element.scrollIntoView({ block: "end" }));
  await settle(page);
  const jump = await page.locator(".lorca-jump-latest").evaluate((button) => {
    const scroll = document.querySelector(".lorca-scroll").getBoundingClientRect();
    const composer = document.querySelector(".lorca-composer").getBoundingClientRect();
    const bounds = button.getBoundingClientRect();
    return { outsideTranscript: bounds.top >= scroll.bottom - 1, aboveComposer: bounds.bottom <= composer.top, position: getComputedStyle(button).position };
  });
  assert.equal(jump.outsideTranscript, true, "Jump-to-latest has its own composer row and never covers the transcript");
  assert.equal(jump.aboveComposer, true);
  assert.notEqual(jump.position, "absolute");
  const toolHit = await middleTool.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const scroll = document.querySelector(".lorca-scroll").getBoundingClientRect();
    const x = (bounds.left + bounds.right) / 2;
    const y = (bounds.top + bounds.bottom) / 2;
    return bounds.top >= scroll.top + 48 && bounds.bottom <= scroll.bottom && element.contains(document.elementFromPoint(x, y));
  });
  assert.equal(toolHit, true, "The near-bottom tool remains fully visible and receives pointer hits while Jump-to-latest is shown");
  await middleTool.click({ trial: true });
  await screenshot(page, "desktop-layout-jump-latest-clear");
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") {
      await page.evaluate(() => localStorage.setItem("bb-lorca.appearance", "dark"));
      await page.reload({ waitUntil: "networkidle" });
      await chooseChat(page, "宽度布局回归");
      await middleTool.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await page.locator(".lorca-jump-latest").waitFor();
      await composer.fill("Synthetic popover draft");
      await settle(page);
    }
    const trigger = page.locator(".lorca-header-status");
    const before = await page.evaluate(() => ({ scroll: document.querySelector(".lorca-scroll").scrollTop, requests: window.__layoutToolsUiTest.requests.length }));
    await trigger.focus();
    await trigger.press("Enter");
    const menu = page.getByRole("menu", { name: "连接状态", exact: true });
    await menu.waitFor();
    assert.equal(await page.evaluate(() => window.__layoutToolsUiTest.requests.length), before.requests, "Opening connection status is local and sends no RPC");
    assert.equal(await composer.inputValue(), "Synthetic popover draft");
    assert.ok(Math.abs(await page.locator(".lorca-scroll").evaluate((element) => element.scrollTop) - before.scroll) <= 1, "Connection status does not move the reading position");
    await screenshot(page, `desktop-connection-status-${theme}`);
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    assert.equal(await trigger.evaluate((element) => element === document.activeElement), true, "Escape restores the status trigger's keyboard focus");
    for (const backwards of [false, true]) {
      await trigger.focus();
      await trigger.evaluate((element, backwards) => {
        const controls = Array.from(element.closest(".lorca-app").querySelectorAll("button, a[href], input, textarea, select, summary, [tabindex]"))
          .filter((control) => control.tabIndex >= 0 && !control.matches(":disabled") && !control.closest("[inert], [aria-hidden=true]") && control.getClientRects().length > 0);
        const target = controls[controls.indexOf(element) + (backwards ? -1 : 1)] || element;
        document.querySelectorAll("[data-status-focus-target]").forEach((control) => control.removeAttribute("data-status-focus-target"));
        target.setAttribute("data-status-focus-target", "");
      }, backwards);
      await trigger.press("Space");
      await menu.waitFor();
      await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
      await menu.waitFor({ state: "hidden" });
      assert.equal(await page.locator("[data-status-focus-target]").evaluate((element) => element === document.activeElement), true, "Tab leaves the menu in the normal page focus order");
    }
    await trigger.press("Space");
    await menu.waitFor();
    await composer.click();
    await menu.waitFor({ state: "hidden" });
    assert.equal(await composer.evaluate((element) => element === document.activeElement), true, "Outside dismissal leaves focus on the clicked editor");
    assert.equal(await composer.inputValue(), "Synthetic popover draft");
    assert.equal(await page.evaluate(() => window.__layoutToolsUiTest.requests.length), before.requests, "Repeated status-menu interactions never read or mutate runtime settings");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await trigger.click();
    await menu.waitFor();
    assert.equal(await menu.evaluate((element) => getComputedStyle(element).animationName), "none", "Reduced motion removes the status-menu animation");
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  assert.equal(await controls.isVisible(), false, "Compact layouts hide the desktop width control");
  await composerRow(page);
  await screenshot(page, "mobile-layout-width-safe");
  await context.close();
}

async function checkToolGroups({ browser, base, screenshot, chooseChat, captureErrors, setFailurePage }) {
  const context = await browser.newContext({ viewport: { width: 1240, height: 1050 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  setFailurePage(page);
  captureErrors(page);
  await page.addInitScript(installLayoutToolsFixture);
  await page.goto(base, { waitUntil: "networkidle" });
  await chooseChat(page, "工具显示回归");
  const group = (id) => page.locator(`[data-tool-group="${id}"]`);
  const detail = (id) => page.locator(`[data-tool-id="${id}"]`);
  await group("normal-1").waitFor();
  assert.deepEqual(await page.locator(".lorca-tool-group").evaluateAll((groups) => groups.map((element) => [element.dataset.toolGroup, Number(element.dataset.toolCount)])), [["normal-1", 7], ["error-one", 2], ["after-user", 1], ["other-author", 1], ["running-one", 2]], "Text, user messages and author changes divide consecutive tool display groups");
  assert.equal(await group("normal-1").locator("button").getAttribute("aria-expanded"), "false");
  assert.equal(await group("normal-1").locator(".lorca-tool-group-items").isVisible(), false, "Seven successful tools are collapsed by default");
  assert.equal(await group("running-one").locator("button").getAttribute("aria-expanded"), "false");
  assert.equal(await group("running-one").getByRole("status").innerText(), "Synthetic fetch /lookup", "Running text comes from the current tool record without an invented purpose");
  assert.equal(await group("error-one").locator("button").getAttribute("aria-expanded"), "true");
  assert.match(await group("error-one").locator(".lorca-tool-group-state").innerText(), /1 项失败/);
  assert.equal(await detail("error-two").evaluate((element) => element.open), true, "Error details start expanded");
  await page.locator(".lorca-scroll").evaluate((element) => { element.scrollTop = 0; });
  await screenshot(page, "desktop-tool-groups-default");
  await group("error-one").locator("button").click();
  assert.equal(await group("error-one").getByRole("alert").isVisible(), true, "An error stays conspicuous even after its group is manually collapsed");
  const approval = page.locator(".lorca-approval-card");
  assert.equal(await approval.locator("xpath=ancestor::*[contains(@class, 'lorca-tool-group')]").count(), 0, "Approval actions never become children of a collapsed tool group");
  assert.equal(await approval.getByRole("button", { name: "仅允许一次", exact: true }).isVisible(), true);
  await approval.getByRole("button", { name: "仅允许一次", exact: true }).click({ trial: true });
  await group("normal-1").locator("button").focus();
  await page.keyboard.press("Enter");
  await detail("normal-3").locator("summary").click();
  assert.equal(await detail("normal-3").evaluate((element) => element.open), true);
  await page.evaluate(() => window.__layoutToolsUiTest.update("normal-3", { detail: "Updated synthetic streamed output" }));
  await detail("normal-3").getByText("Updated synthetic streamed output", { exact: true }).waitFor();
  assert.equal(await group("normal-1").locator("button").getAttribute("aria-expanded"), "true");
  assert.equal(await detail("normal-3").evaluate((element) => element.open), true, "Streaming updates preserve the user's expanded tool details");
  await screenshot(page, "desktop-tool-groups-expanded");
  await page.getByRole("button", { name: "加载更早的消息", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-tool-group="normal-1"]')?.getAttribute("data-tool-count") === "9");
  assert.equal(await detail("older-one").count(), 1);
  assert.equal(await group("normal-1").locator("button").getAttribute("aria-expanded"), "true", "Prepending into a group preserves its stable anchor and its old members' expansion choice");
  assert.equal(await detail("normal-3").evaluate((element) => element.open), true, "Historical prepends preserve expanded child details");
  assert.equal(await group("error-one").locator("button").getAttribute("aria-expanded"), "false", "Historical insertion also preserves a deliberate error-group collapse");
  await page.evaluate(() => window.__layoutToolsUiTest.update("running-two", { is_running: false, summary: "Synthetic fetch complete" }));
  await group("running-one").locator(".lorca-tool-live").waitFor({ state: "detached" });
  await page.evaluate(() => window.__layoutToolsUiTest.startLiveGroup());
  await group("live-one").waitFor();
  assert.equal(await group("running-one").getAttribute("data-tool-count"), "2", "Observed live tools do not acquire a fabricated historical boundary");
  await group("live-one").locator("button").click();
  await detail("live-two").locator("summary").click();
  await page.evaluate(() => window.__layoutToolsUiTest.appendLiveGroup());
  await page.waitForFunction(() => document.querySelector('[data-tool-group="live-one"]')?.getAttribute("data-tool-count") === "3");
  assert.equal(await group("live-one").locator("button").getAttribute("aria-expanded"), "true");
  await page.evaluate(() => window.__layoutToolsUiTest.update("live-two", { is_running: false, summary: "Synthetic live fetch complete" }));
  await group("live-one").locator(".lorca-tool-live").waitFor({ state: "detached" });
  assert.equal(await detail("live-two").evaluate((element) => element.open), true, "Completion removes the live label without resetting user-expanded details");
  await page.evaluate(() => window.__layoutToolsUiTest.appendObservedBoundaries());
  await group("observed-two").waitFor();
  assert.equal(await group("observed-one").getAttribute("data-tool-count"), "1");
  assert.equal(await group("observed-two").getAttribute("data-tool-count"), "1", "Observed job start/finish boundaries split display groups without inventing historical turn ownership");
  assert.deepEqual(await page.evaluate(() => window.__layoutToolsUiTest.requests.map((request) => request.method)), ["bootstrap", "chats.messages"], "Grouping and expansion are local; only the requested synthetic history page is read");
  await screenshot(page, "desktop-tool-groups-history-and-boundaries");
  await context.close();
}

export async function checkLayoutToolsSurfaces(options) {
  await checkWidthAndStatus(options);
  await checkToolGroups(options);
}
