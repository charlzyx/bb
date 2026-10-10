import assert from "node:assert/strict";
import { installSettingsFixture } from "./settings-ui-fixture.mjs";

function extendFixture(theme) {
  localStorage.setItem("bb-lorca.appearance", theme);
  const request = window.lorca.request;
  window.lorca.request = async (method, params) => {
    const result = await request(method, params);
    if (method !== "bootstrap") return result;
    const created = Math.floor(Date.now() / 1000);
    return { ...result, chats: [{ id: "settings-layout-chat", kind: "dm", title: "合成设置布局回归", bot_ids: ["bot-one"], created_at: created, has_more: false, messages: Array.from({ length: 20 }, (_, index) => ({ id: `settings-layout-${index}`, chat_id: "settings-layout-chat", author: { kind: "bot", bot_id: "bot-one" }, body: { kind: "text", text: `合成布局段落 ${index + 1}\n\n${"只用于验证设置宽度和返回聊天时的滚动位置。".repeat(12)}` }, state: { kind: "complete" }, created_at: created + index })) }] };
  };
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function checkControls(page) {
  const controls = await page.locator('.lorca-settings-desktop[data-open="true"]').evaluate(root => Array.from(root.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), select, button:not(.lorca-device-name)')).filter(element => element.getBoundingClientRect().height > 0).map(element => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const iconOnly = element.tagName === "BUTTON" && element.children.length === 1 && element.firstElementChild.matches("[data-icon-root]");
    return { label: element.getAttribute("aria-label") || element.textContent.slice(0, 60), tag: element.tagName, height: box.height, width: box.width, iconOnly, top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom), left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight) };
  }));
  assert.ok(controls.length > 8, "The settings fixture exercises real single-line controls");
  for (const control of controls) {
    assert.ok(Math.abs(control.height - 36) <= 0.5, `Settings controls share a 36px height: ${JSON.stringify(control)}`);
    assert.equal(control.top, 0);
    assert.equal(control.bottom, 0);
    assert.equal(control.left, control.iconOnly ? 0 : 12, JSON.stringify(control));
    assert.equal(control.right, control.iconOnly ? 0 : control.tag === "SELECT" ? 34 : 12, JSON.stringify(control));
    if (control.iconOnly) assert.equal(control.width, 36);
  }
  const checkboxes = await page.locator('.lorca-settings-desktop[data-open="true"] input[type="checkbox"]').evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height > 0).map(element => element.getBoundingClientRect().height));
  assert.ok(checkboxes.every(height => height < 36), "Checkboxes retain their independent dimensions");
}

async function checkGeometry(page) {
  const geometry = await page.evaluate(() => {
    const root = document.querySelector('.lorca-settings-desktop[data-open="true"]');
    const scroll = root.querySelector(".lorca-settings-scroll");
    const body = root.querySelector(".lorca-settings-reading-width");
    const header = root.querySelector(".lorca-settings-page-header");
    const content = root.querySelector(".lorca-settings-section-content").getBoundingClientRect();
    const back = root.querySelector(".lorca-settings-back").getBoundingClientRect();
    const select = root.querySelector(".lorca-settings-device-control select").getBoundingClientRect();
    const pair = root.querySelector(".lorca-device-pairing-compact button")?.getBoundingClientRect();
    return { scrollWidth: scroll.clientWidth, bodyWidth: body.getBoundingClientRect().width, headerWidth: header.getBoundingClientRect().width, contentWidth: content.width, contentLeft: content.left, headingLeft: root.querySelector("h1").getBoundingClientRect().left, gutter: parseFloat(getComputedStyle(body).paddingLeft), back: { left: back.left, top: back.top, right: back.right, bottom: back.bottom }, selectTop: select.top, pairTop: pair?.top, headerHeight: header.getBoundingClientRect().height, scrollPadding: parseFloat(getComputedStyle(scroll).scrollPaddingTop), headerDrag: getComputedStyle(header).getPropertyValue("-webkit-app-region"), backDrag: getComputedStyle(root.querySelector(".lorca-settings-back")).getPropertyValue("-webkit-app-region"), navigationTop: root.querySelector(".lorca-settings-nav-item").getBoundingClientRect().top, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert.equal(geometry.overflow, false);
  assert.ok(Math.abs(geometry.bodyWidth - geometry.scrollWidth) <= 1 && Math.abs(geometry.headerWidth - geometry.scrollWidth) <= 1, "Settings use the available main width without a reading-column cap");
  assert.ok(geometry.gutter >= 24 && geometry.gutter <= 48);
  assert.ok(geometry.contentWidth > 1600, "A 2048px desktop exposes genuinely wide settings content");
  assert.ok(Math.abs(geometry.contentWidth - geometry.scrollWidth + 2 * geometry.gutter) <= 1);
  assert.ok(Math.abs(geometry.headingLeft - geometry.contentLeft) <= 1);
  assert.ok(Math.abs(geometry.back.top - geometry.selectTop) <= 1, "Return and device selector share the top row");
  if (geometry.pairTop !== undefined) assert.ok(Math.abs(geometry.back.top - geometry.pairTop) <= 1, "Pairing shares the same control baseline");
  assert.ok(geometry.back.left >= 88 || geometry.back.top >= 40, "The content-top return action does not overlap the native traffic-light rectangle");
  assert.ok(geometry.navigationTop >= 44);
  assert.equal(geometry.headerDrag, "drag");
  assert.equal(geometry.backDrag, "no-drag");
  assert.ok(geometry.scrollPadding >= geometry.headerHeight + 15, "Keyboard scrolling reserves the measured sticky header height");
}

export async function checkSettingsLayoutSurfaces({ browser, base, screenshot, captureErrors = () => {}, setFailurePage = () => {} }) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 2048, height: 1080 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    setFailurePage(page);
    captureErrors(page);
    await page.addInitScript({ content: `(${installSettingsFixture.toString()})();(${extendFixture.toString()})(${JSON.stringify(theme)});` });
    await page.goto(base, { waitUntil: "networkidle" });
    await page.evaluate(() => { document.documentElement.dataset.lorcaPlatform = "darwin"; });
    await page.locator(".lorca-chat-item").filter({ hasText: "合成设置布局回归" }).click();
    const composer = page.getByRole("textbox", { name: "给 dots 发消息" });
    const draft = `Synthetic ${theme} settings layout draft`;
    await composer.fill(draft);
    await page.getByRole("group", { name: "内容宽度", exact: true }).getByRole("button", { name: "阅读", exact: true }).click();
    await settle(page);
    await page.locator(".lorca-scroll").evaluate(element => { element.scrollTop = element.scrollHeight / 2; });
    await settle(page);
    const originalScroll = await page.locator(".lorca-scroll").evaluate(element => element.scrollTop);
    assert.ok(originalScroll > 0);
    await page.locator(".lorca-workspace").click();
    const settings = page.locator('.lorca-settings-desktop[data-open="true"]');
    await settings.waitFor();
    assert.equal(await settings.getByRole("button", { name: "返回聊天", exact: true }).count(), 1);
    assert.equal(await settings.getByRole("button", { name: "关闭设置", exact: true }).count(), 0);
    assert.equal(await settings.locator(".lorca-settings-sidebar .lorca-settings-back").count(), 0);
    for (const section of ["通用", "服务商", "自动审查", "插件", "智能体", "设备", "高级"]) {
      await settings.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: section, exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.lorca-settings-desktop[data-open="true"] .lorca-settings-runtime-toolbar[aria-busy="true"]'));
      await settle(page);
      await checkControls(page);
      await checkGeometry(page);
      if (section === "智能体") await screenshot(page, `desktop-settings-wide-controls-${theme}`);
    }
    await settings.getByRole("button", { name: "返回聊天", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.classList.contains("lorca-workspace"));
    assert.equal(await composer.inputValue(), draft);
    assert.ok(Math.abs(await page.locator(".lorca-scroll").evaluate(element => element.scrollTop) - originalScroll) <= 1, "Returning from settings preserves the chat reading position");
    await page.locator(".lorca-workspace").click();
    await settings.waitFor();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.classList.contains("lorca-workspace") && document.querySelector('.lorca-settings-desktop[data-open="false"]'));
    assert.equal(await composer.inputValue(), draft);
    assert.ok(Math.abs(await page.locator(".lorca-scroll").evaluate(element => element.scrollTop) - originalScroll) <= 1);
    assert.ok(await composer.evaluate(element => element.getBoundingClientRect().height) >= 50, "The composer textarea remains independently sized");
    assert.equal(await page.evaluate(() => window.__settingsUiTest.requests.length), 0, "Geometry checks do not save configuration");
    await context.close();
  }
}
