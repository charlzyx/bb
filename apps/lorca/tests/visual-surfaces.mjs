import assert from "node:assert/strict";

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
  const page = await browser.newPage({ viewport: { width: 1240, height: 820 }, deviceScaleFactor: 1 });
  setFailurePage(page);
  captureErrors(page);
  await page.goto(`${base}/?demo=1`, { waitUntil: "networkidle" });
  const footer = page.locator(".lorca-sidebar .lorca-workspace");
  for (const theme of ["light", "dark"]) {
    await page.locator(".lorca-header-status").click();
    await waitForSettings(page);
    await chooseSettingsPage(page, "偏好设置");
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
    for (const [label, slug] of [["连接", "connection"], ["偏好设置", "preferences"], ["模型与机器人", "models"], ["执行器", "runners"], ["MCP", "mcp"], ["自动审批", "auto-review"]]) {
      await chooseSettingsPage(page, label);
      await page.locator(".lorca-settings-scroll").evaluate((element) => { element.scrollTop = 0; });
      await descriptionContrast(page);
      if (theme === "dark") await screenshot(page, `desktop-settings-${slug}-dark`);
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
    const approvalSwitch = page.getByRole("switch", { name: "启用自动审批" });
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
    await chooseSettingsPage(page, "模型与机器人");
    await page.getByRole("combobox", { name: "分配执行器", exact: true }).selectOption("runner-second");
    await page.getByRole("button", { name: "应用更改", exact: true }).click();
    await page.locator(".lorca-admin-confirmation").evaluate((element) => element.scrollIntoView({ block: "center" }));
    await screenshot(page, `desktop-settings-models-confirm-${theme}`);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await chooseSettingsPage(page, "连接");
    await page.getByRole("textbox", { name: "WebSocket 连接地址" }).fill("ws://invalid.example/ws");
    await page.getByRole("button", { name: "连接本次会话", exact: true }).click();
    await page.locator(".lorca-field-error").waitFor();
    await screenshot(page, `desktop-settings-connection-error-${theme}`);
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  }
}
