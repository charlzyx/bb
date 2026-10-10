import assert from "node:assert/strict";
import { installFooterFixture } from "./footer-ui-fixture.mjs";

async function paintedPixel(page, x, y) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const bytes = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, animations: "disabled" });
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = png;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  }, `data:image/png;base64,${bytes.toString("base64")}`);
}

async function scrollingFooterAvatar(page, reduced) {
  const avatar = page.locator(".lorca-sidebar .lorca-chat-item img").nth(20);
  await avatar.evaluate((image) => image.decode());
  const geometry = await avatar.evaluate((image) => {
    const list = image.closest(".lorca-chat-list");
    const footer = document.querySelector(".lorca-sidebar-footer");
    const bounds = footer.getBoundingClientRect();
    const target = bounds.top + 4;
    list.scrollTop += image.getBoundingClientRect().top + image.getBoundingClientRect().height / 2 - target;
    const photo = image.getBoundingClientRect();
    const material = getComputedStyle(footer, "::before");
    const opacities = [];
    for (const text of footer.querySelectorAll("strong, small")) {
      for (let node = text; node; node = node.parentElement) opacities.push(getComputedStyle(node).opacity);
    }
    return {
      x: Math.floor(photo.left + photo.width / 2), edgeX: Math.ceil(photo.right + 4), y: Math.floor(target),
      scrolled: list.scrollTop > 0,
      overlapping: photo.top < target && photo.bottom > target && list.getBoundingClientRect().bottom >= bounds.bottom,
      footerHeight: bounds.height, position: getComputedStyle(footer).position,
      padding: parseFloat(getComputedStyle(list).paddingBottom),
      scrollPadding: parseFloat(getComputedStyle(list).scrollPaddingBottom),
      backdrop: material.backdropFilter, background: material.backgroundImage,
      pointerEvents: material.pointerEvents, opacities,
    };
  });
  assert.equal(geometry.scrolled, true, "The real conversation list has scrolled");
  assert.equal(geometry.overlapping, true, "A real bot image passes beneath the independent footer surface");
  assert.equal(geometry.position, "absolute", "Footer overlays the list instead of shrinking its scroll area");
  assert.equal(geometry.footerHeight, 56, "Footer keeps its compact 56px geometry");
  assert.ok(geometry.padding >= 70 && geometry.scrollPadding >= 70, "Last-row spacing clears the footer and its 14px fade");
  assert.equal(geometry.backdrop, reduced ? "none" : "blur(16px)");
  assert.equal(geometry.background === "none", reduced);
  assert.equal(geometry.pointerEvents, "none", "The blur material cannot intercept input");
  assert.ok(geometry.opacities.every((opacity) => opacity === "1"), "Footer text and all its ancestors remain fully opaque");
  const actual = await paintedPixel(page, geometry.x, geometry.y);
  const edge = await paintedPixel(page, geometry.edgeX, geometry.y);
  let withoutAvatar;
  let edgeWithoutAvatar;
  await avatar.evaluate((image) => { image.style.visibility = "hidden"; });
  try {
    withoutAvatar = await paintedPixel(page, geometry.x, geometry.y);
    edgeWithoutAvatar = await paintedPixel(page, geometry.edgeX, geometry.y);
  } finally {
    await avatar.evaluate((image) => { image.style.removeProperty("visibility"); });
  }
  const differences = actual.slice(0, 3).map((channel, index) => Math.abs(channel - withoutAvatar[index]));
  const edgeDifferences = edge.slice(0, 3).map((channel, index) => Math.abs(channel - edgeWithoutAvatar[index]));
  if (reduced) {
    assert.ok(differences.every((difference) => difference <= 1), `Opaque reduced-transparency footer hides the same scrolled avatar: ${actual} / ${withoutAvatar}`);
    assert.ok(edgeDifferences.every((difference) => difference <= 1), "The opaque fallback also removes all colored blur beyond the avatar edge");
  } else {
    assert.ok(Math.max(...differences) >= 4 && differences.reduce((sum, value) => sum + value, 0) >= 7, `Rendered footer pixels mix the real avatar into the material: ${actual} / ${withoutAvatar}`);
    assert.ok(Math.max(...edgeDifferences) >= 1 && edgeDifferences.reduce((sum, value) => sum + value, 0) >= 2, `Blur spreads avatar color 4px beyond its original edge instead of only reducing opacity: ${edge} / ${edgeWithoutAvatar}`);
  }
  console.log(JSON.stringify({ check: "footer-avatar-pixels", theme: await page.locator("html").getAttribute("class"), reduced, center: actual, centerWithoutAvatar: withoutAvatar, outsideEdge: edge, outsideEdgeWithoutAvatar: edgeWithoutAvatar }));
}

async function footerLastRow(page) {
  const rows = page.locator(".lorca-sidebar .lorca-chat-item");
  const last = rows.last();
  await page.locator(".lorca-sidebar .lorca-chat-list").evaluate((list) => { list.scrollTop = list.scrollHeight; });
  await rows.nth((await rows.count()) - 2).focus();
  await page.keyboard.press("Tab");
  const geometry = await last.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const list = element.closest(".lorca-chat-list").getBoundingClientRect();
    const footer = document.querySelector(".lorca-sidebar-footer").getBoundingClientRect();
    const points = [[bounds.left + 2, bounds.top + 2], [bounds.right - 2, bounds.bottom - 2], [(bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2]];
    return { focused: element === document.activeElement, visibleFocus: element.matches(":focus-visible"), clear: bounds.top >= list.top && bounds.bottom <= footer.top - 14, unobscured: points.every(([x, y]) => element.contains(document.elementFromPoint(x, y))) };
  });
  assert.equal(geometry.focused, true, "Tab reaches the final real conversation");
  assert.equal(geometry.visibleFocus, true);
  assert.equal(geometry.clear, true, "The final conversation scrolls fully above the footer fade");
  assert.equal(geometry.unobscured, true, "The final conversation remains clickable above the footer");
  await last.press("Enter");
  assert.equal(await last.getAttribute("aria-current"), "page", "Keyboard activation opens the last conversation");
}

async function checkScrollingFooter({ browser, base, screenshot, chooseSettingsPage, waitForSettings, captureErrors, setFailurePage }) {
  const page = await browser.newPage({ viewport: { width: 1240, height: 820 }, deviceScaleFactor: 1 });
  setFailurePage(page);
  captureErrors(page);
  await page.addInitScript(installFooterFixture);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".lorca-sidebar .lorca-chat-item img").length === 36);
  const media = await page.context().newCDPSession(page);
  try {
    for (const theme of ["light", "dark"]) {
      await page.locator(".lorca-header-status").click();
      await waitForSettings(page);
      await chooseSettingsPage(page, "通用");
      await page.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      await page.getByRole("button", { name: "关闭设置", exact: true }).click();
      await page.mouse.move(900, 400);
      await page.getByRole("textbox", { name: "给 dots 发消息" }).focus();
      await scrollingFooterAvatar(page, false);
      await screenshot(page, `desktop-footer-avatar-behind-${theme}`);
      await setMaterialPreference(page, media, ".lorca-header", true, true);
      await scrollingFooterAvatar(page, true);
      await screenshot(page, `desktop-footer-avatar-reduced-${theme}`);
      await setMaterialPreference(page, media, ".lorca-header", false);
      await footerLastRow(page);
      await screenshot(page, `desktop-footer-last-row-keyboard-${theme}`);
    }
  } finally {
    await media.detach();
  }
}

async function setMaterialPreference(page, session, headerSelector, reduced, reduceMotion = false) {
  const features = reduced ? [{ name: "prefers-reduced-transparency", value: "reduce" }] : [];
  if (reduceMotion) features.push({ name: "prefers-reduced-motion", value: "reduce" });
  await session.send("Emulation.setEmulatedMedia", { features });
  await page.waitForFunction(({ headerSelector, reduced, reduceMotion }) => {
    const header = document.querySelector(headerSelector);
    if (!header || header.getBoundingClientRect().height === 0) return false;
    const material = getComputedStyle(header, "::before");
    return matchMedia("(min-width: 768px) and (prefers-reduced-transparency: reduce)").matches === reduced
      && (!reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches)
      && material.backdropFilter === (reduced ? "none" : "blur(14px)")
      && (material.backgroundImage === "none") === reduced;
  }, { headerSelector, reduced, reduceMotion });
}

async function descriptionContrast(page) {
  const ratios = await page.locator(".lorca-settings-desktop").evaluate((root) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    const rgba = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).map((value) => value / 255);
    };
    const over = (foreground, background) => foreground.slice(0, 3).map((value, index) => value * foreground[3] + background[index] * (1 - foreground[3]));
    const luminance = (color) => color.reduce((sum, value, index) => sum + [0.2126, 0.7152, 0.0722][index] * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4), 0);
    return Array.from(root.querySelectorAll('[class~="text-subtle-foreground/75"]')).map((element) => {
      const chain = [];
      for (let node = element; node; node = node.parentElement) chain.unshift(node);
      let background = [1, 1, 1];
      for (const node of chain) background = over(rgba(getComputedStyle(node).backgroundColor), background);
      const foreground = over(rgba(getComputedStyle(element).color), background);
      const first = luminance(foreground);
      const second = luminance(background);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    });
  });
  assert.ok(ratios.length > 0, "Settings descriptions are present for contrast measurement");
  assert.ok(ratios.every((ratio) => ratio >= 4.5), `Small settings descriptions meet 4.5:1 contrast: ${ratios.join(", ")}`);
}

async function glassSurface(page, headerSelector, scrollSelector, contentSelector, reduced) {
  const geometry = await page.evaluate(({ headerSelector, scrollSelector, contentSelector }) => {
    const header = document.querySelector(headerSelector);
    const scroll = document.querySelector(scrollSelector);
    const content = document.querySelector(contentSelector);
    scroll.scrollTop = 0;
    const probe = document.createElement("div");
    probe.dataset.syntheticGlassProbe = "";
    probe.style.cssText = "height:192px;flex:none;background:rgb(30,160,200)";
    content.prepend(probe);
    scroll.scrollTop = probe.getBoundingClientRect().top - header.getBoundingClientRect().top;
    const bounds = header.getBoundingClientRect();
    const behind = probe.getBoundingClientRect();
    const material = getComputedStyle(header, "::before");
    return { x: Math.floor(bounds.left + bounds.width / 2), y: Math.floor(bounds.top + 8), overlaps: behind.top <= bounds.top + 1 && behind.bottom >= bounds.bottom, filter: material.backdropFilter, background: material.backgroundImage, padding: parseFloat(getComputedStyle(scroll).scrollPaddingTop), height: bounds.height };
  }, { headerSelector, scrollSelector, contentSelector });
  try {
    assert.equal(geometry.overlaps, true, "Real scroll content passes behind the header surface");
    assert.ok(geometry.padding >= geometry.height, "Keyboard scroll positioning reserves the complete sticky header");
    assert.equal(geometry.filter, reduced ? "none" : "blur(14px)");
    assert.equal(geometry.background === "none", reduced, "Reduced transparency replaces the gradient with an opaque surface");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const screenshot = await page.screenshot({ clip: { x: geometry.x, y: geometry.y, width: 1, height: 1 }, animations: "disabled" });
    const rendered = await page.evaluate(async (png) => {
      const image = new Image();
      image.src = png;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const actual = Array.from(context.getImageData(0, 0, 1, 1).data);
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--canvas");
      context.fillRect(0, 0, 1, 1);
      return { actual, opaque: Array.from(context.getImageData(0, 0, 1, 1).data) };
    }, `data:image/png;base64,${screenshot.toString("base64")}`);
    if (reduced) {
      assert.ok(rendered.actual.slice(0, 3).every((channel, index) => Math.abs(channel - rendered.opaque[index]) <= 2), "Reduced-transparency header does not leak the colored content beneath it");
    } else {
      assert.ok(rendered.actual[2] - rendered.actual[0] >= 3, "Rendered header pixels reveal the real underlying content instead of an opaque white mask");
    }
  } finally {
    await page.evaluate((selector) => {
      document.querySelector("[data-synthetic-glass-probe]")?.remove();
      document.querySelector(selector).scrollTop = 0;
    }, scrollSelector);
  }
}

async function footerState(page, mode) {
  const state = await page.locator(".lorca-sidebar .lorca-workspace").evaluate((element) => {
    const style = getComputedStyle(element);
    const icon = getComputedStyle(element.querySelector(".lorca-workspace-icon"));
    return { appearance: style.appearance, background: style.backgroundColor, shadow: style.boxShadow, border: style.borderTopWidth, iconBackground: icon.backgroundColor, iconBorder: icon.borderTopWidth, focused: element === document.activeElement, keyboardFocus: element.matches(":focus-visible"), outline: parseFloat(style.outlineWidth) };
  });
  assert.equal(state.appearance, "none");
  assert.equal(state.shadow, "none");
  assert.equal(state.border, "0px");
  assert.equal(state.iconBorder, "0px");
  assert.equal(state.iconBackground, "rgba(0, 0, 0, 0)", "Footer icon has no isolated white tile");
  if (mode === "default") assert.equal(state.background, "rgba(0, 0, 0, 0)", "Footer has no native ButtonFace fill");
  else assert.notEqual(state.background, "rgba(0, 0, 0, 0)", "Interaction uses the theme hover surface");
  if (mode === "focus") {
    assert.equal(state.focused, true);
    assert.equal(state.keyboardFocus, true);
    assert.ok(state.outline >= 1, "Keyboard focus remains visibly identifiable");
  }
}

export async function checkVisualSurfaces({ browser, base, screenshot, chooseSettingsPage, waitForSettings, chooseChat, captureErrors, setFailurePage }) {
  await checkScrollingFooter({ browser, base, screenshot, chooseSettingsPage, waitForSettings, captureErrors, setFailurePage });
  const page = await browser.newPage({ viewport: { width: 1240, height: 820 }, deviceScaleFactor: 1 });
  setFailurePage(page);
  captureErrors(page);
  await page.goto(`${base}/?demo=1`, { waitUntil: "networkidle" });
  const footer = page.locator(".lorca-sidebar .lorca-workspace");
  for (const theme of ["light", "dark"]) {
    await page.locator(".lorca-header-status").click();
    await waitForSettings(page);
    await chooseSettingsPage(page, "通用");
    await page.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
    await page.keyboard.press("Control+n");
    await page.mouse.move(900, 400);
    await page.getByRole("textbox", { name: "给 dots 发消息" }).focus();
    await footerState(page, "default");
    await screenshot(page, `desktop-glass-empty-${theme}`);
    await footer.hover();
    await footerState(page, "hover");
    await screenshot(page, `desktop-footer-hover-${theme}`);
    await page.mouse.move(900, 400);
    await page.keyboard.press("Tab");
    await footer.focus();
    await footerState(page, "focus");
    await footer.press("Enter");
    await waitForSettings(page);
    await page.keyboard.press("Escape");
    await footerState(page, "focus");
    await screenshot(page, `desktop-footer-focus-${theme}`);
    await chooseChat(page, /^示例助手$/);
    await glassSurface(page, ".lorca-header", ".lorca-scroll", ".lorca-transcript", false);
    await page.locator(".lorca-scroll").evaluate((scroll) => {
      const message = scroll.querySelector(".lorca-user-message");
      scroll.scrollTop = message.getBoundingClientRect().top - document.querySelector(".lorca-header").getBoundingClientRect().top - 4;
    });
    await screenshot(page, `desktop-glass-scrolled-${theme}`);
    const media = await page.context().newCDPSession(page);
    try {
      await setMaterialPreference(page, media, ".lorca-header", true, true);
      assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches && matchMedia("(prefers-reduced-motion: reduce)").matches), true);
      await glassSurface(page, ".lorca-header", ".lorca-scroll", ".lorca-transcript", true);
      const motion = await page.locator(".lorca-composer").evaluate((element) => getComputedStyle(element).transitionDuration);
      assert.ok(motion.split(",").every((value) => parseFloat(value) <= 0.00001), "Reduced motion keeps transitions effectively disabled");
      await screenshot(page, `desktop-glass-reduced-transparency-${theme}`);
      await setMaterialPreference(page, media, ".lorca-header", false);
    } finally {
      await media.detach();
    }
    await page.locator(".lorca-header-status").click();
    await waitForSettings(page);
    for (const [label, slug] of [["通用", "general"], ["服务商", "providers"], ["插件", "plugins"], ["智能体", "agents"], ["设备", "devices"], ["高级", "advanced"], ["自动审查", "auto-review"]]) {
      await chooseSettingsPage(page, label);
      await page.locator(".lorca-settings-scroll").evaluate((element) => { element.scrollTop = 0; });
      await descriptionContrast(page);
      if (theme === "dark" || slug === "devices") await screenshot(page, `desktop-settings-${slug}-${theme}`);
    }
    await glassSurface(page, ".lorca-settings-page-header", ".lorca-settings-scroll", ".lorca-settings-reading-width", false);
    const settingsMedia = await page.context().newCDPSession(page);
    try {
      await setMaterialPreference(page, settingsMedia, ".lorca-settings-page-header", true);
      await glassSurface(page, ".lorca-settings-page-header", ".lorca-settings-scroll", ".lorca-settings-reading-width", true);
      assert.equal(await page.locator(".lorca-auto-review-actions").evaluate((element) => getComputedStyle(element, "::before").display), "none", "Reduced transparency also removes the approval footer fade");
      if (theme === "light") await screenshot(page, "desktop-settings-reduced-transparency");
      await setMaterialPreference(page, settingsMedia, ".lorca-settings-page-header", false);
    } finally {
      await settingsMedia.detach();
    }
    const approvalSwitch = page.getByRole("switch", { name: "启用自动审查" });
    if (await approvalSwitch.getAttribute("aria-checked") !== "true") await approvalSwitch.click();
    await page.getByRole("button", { name: "查看变更", exact: true }).click();
    await page.locator(".lorca-approval-confirmation > p").last().evaluate((element) => element.scrollIntoView({ block: "center" }));
    const rule = page.locator(".lorca-approval-review-list li").last();
    const ruleGeometry = await rule.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const header = document.querySelector(".lorca-settings-page-header").getBoundingClientRect();
      const footer = document.querySelector(".lorca-auto-review-actions").getBoundingClientRect();
      return { clear: bounds.top >= header.bottom && bounds.bottom <= footer.top - 18 };
    });
    assert.equal(ruleGeometry.clear, true, "Final approval rule stays between the glass header and footer fade");
    await screenshot(page, `desktop-settings-auto-review-confirm-end-${theme}`);
    await page.getByRole("button", { name: "返回修改", exact: true }).click();
    await chooseSettingsPage(page, "智能体");
    await page.getByRole("combobox", { name: "分配执行器", exact: true }).selectOption("runner-second");
    await page.getByRole("button", { name: "应用更改", exact: true }).click();
    await page.locator(".lorca-admin-confirmation").evaluate((element) => element.scrollIntoView({ block: "center" }));
    await screenshot(page, `desktop-settings-models-confirm-${theme}`);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await chooseSettingsPage(page, "高级");
    await page.getByRole("textbox", { name: "WebSocket 连接地址" }).fill("ws://invalid.example/ws");
    await page.getByRole("button", { name: "连接本次会话", exact: true }).click();
    await page.locator(".lorca-field-error").waitFor();
    await screenshot(page, `desktop-settings-connection-error-${theme}`);
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  }
}
