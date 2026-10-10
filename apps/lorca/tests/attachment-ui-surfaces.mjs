import assert from "node:assert/strict";
import { installAttachmentFixture } from "./attachment-ui-fixture.mjs";

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function ready(page) {
  await page.waitForFunction(() => window.__attachmentUiTest.snapshot().textListeners === 1 && typeof window.__attachmentUiTest.snapshot().scope === "string" && !document.querySelector("[data-attachment-composer]")?.hasAttribute("data-attachment-disabled"));
}

async function chooseChat(page, title) {
  await page.locator(".lorca-chat-item").filter({ hasText: title }).click();
  await page.locator(".lorca-chat-item[aria-current=page]").filter({ hasText: title }).waitFor();
  await ready(page);
}

export async function checkAttachmentSurfaces({ browser, base, screenshot, captureErrors = () => {}, setFailurePage = () => {} }) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1240, height: 820 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    setFailurePage(page);
    captureErrors(page);
    await page.addInitScript(installAttachmentFixture, { theme });
    await page.goto(base, { waitUntil: "networkidle" });
    await chooseChat(page, "合成附件 · 输入与预览");
    const composer = page.getByRole("textbox", { name: "给 dots 发消息", exact: true });
    const cards = page.locator(".lorca-pending-attachments > [data-attachment-id]");
    assert.equal(await page.locator("html").evaluate((element) => element.classList.contains("dark")), theme === "dark");
    await composer.fill("前面 SELECT 后面");
    await composer.evaluate((element) => element.setSelectionRange(3, 9));
    const inserted = await page.evaluate(() => {
      const fixture = window.__attachmentUiTest;
      fixture.mixed("粘贴\r\n图文", [fixture.file("image", "mixed-image")]);
      fixture.mixed(" + 连续", [fixture.file("file", "mixed-file")]);
      const input = document.querySelector(".lorca-composer textarea");
      return { value: input.value, start: input.selectionStart, end: input.selectionEnd, focused: document.activeElement === input };
    });
    const prefix = "前面 粘贴\n图文 + 连续";
    const expected = `${prefix} 后面`;
    assert.deepEqual(inserted, { value: expected, start: prefix.length, end: prefix.length, focused: true }, "Two synchronous mixed-file notifications preserve both text insertions and the caret");
    await settle(page);
    assert.equal(await composer.inputValue(), expected, "The React commit retains the inserted DOM value");
    await composer.press("!");
    const typed = `${prefix}! 后面`;
    assert.equal(await composer.inputValue(), typed, "Typing after the controlled React update inserts at the preserved caret without reverting text");
    assert.deepEqual(await composer.evaluate((element) => [element.selectionStart, element.selectionEnd]), [prefix.length + 1, prefix.length + 1]);
    assert.equal(await cards.count(), 2);
    await page.waitForFunction(() => Array.from(document.querySelectorAll(".lorca-attachment-preview img")).length === 1 && Array.from(document.querySelectorAll(".lorca-attachment-preview img")).every((image) => image.complete && image.naturalWidth === 160 && image.naturalHeight === 100));
    const imageStyle = await page.locator(".lorca-attachment-preview img").evaluate((image) => ({ protocol: new URL(image.src).protocol, width: image.clientWidth, height: image.clientHeight, fit: getComputedStyle(image).objectFit, filter: getComputedStyle(image).filter }));
    assert.deepEqual(imageStyle, { protocol: "blob:", width: 36, height: 36, fit: "contain", filter: "none" });
    const imageName = page.locator('[data-attachment-id="mixed-image"] .lorca-attachment-name');
    assert.ok((await imageName.getAttribute("title")).includes("合成图片 · 很长的文件名用于检查省略号和完整提示.png"));
    assert.equal(await page.evaluate(() => window.__attachmentUiTest.snapshot().requests.filter((item) => item.method !== "bootstrap").length), 0, "Import notifications never send a message or open a picker automatically");
    const plainPaste = await composer.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", "synthetic plain text");
      const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer });
      element.dispatchEvent(event);
      return { prevented: event.defaultPrevented, value: element.value };
    });
    assert.deepEqual(plainPaste, { prevented: false, value: typed }, "The UI does not intercept ordinary text paste; synthetic clipboard events do not perform a browser default insertion");
    await screenshot(page, `desktop-attachments-preview-${theme}`);

    await page.evaluate(() => {
      const fixture = window.__attachmentUiTest;
      fixture.emitImport([fixture.file("image", "mixed-image"), fixture.file("broken", "broken-image")], { duplicates: 1, error: "合成错误：一个附件未导入，已添加的附件可继续检查。" });
    });
    await page.locator('[data-attachment-id="broken-image"] .lorca-attachment-preview[title="图片预览暂不可用"]').waitFor();
    assert.equal(await page.locator('[data-attachment-id="broken-image"] img').count(), 0, "An image decoding error renders the file fallback");
    assert.equal(await cards.count(), 3);
    assert.match(await page.locator(".lorca-composer-error").innerText(), /合成错误：一个附件未导入/);
    assert.match(await page.locator(".lorca-composer-error").innerText(), /已跳过 2 个重复附件/);
    assert.equal(await composer.inputValue(), typed, "Import errors and duplicate reporting do not erase the text draft");
    await screenshot(page, `desktop-attachments-error-${theme}`);
    await page.locator('[data-attachment-id="mixed-image"]').getByRole("button", { name: /^移除附件/ }).click();
    assert.equal(await page.locator('[data-attachment-id="mixed-image"]').count(), 0);
    assert.equal(await cards.count(), 2, "Removing the preview leaves the ordinary file and failed-preview fallback intact");
    assert.equal(await composer.inputValue(), typed);
    assert.equal(await page.evaluate(() => window.__attachmentUiTest.snapshot().released.flat().filter((id) => id === "mixed-image").length), 1);

    const previous = await page.evaluate(() => ({ scope: window.__attachmentUiTest.snapshot().scope, textHandle: window.__attachmentUiTest.captureTextListeners() }));
    await chooseChat(page, "合成附件 · 第二个聊天");
    assert.equal(await cards.count(), 0);
    await composer.fill("第二个聊天的草稿");
    await page.evaluate(({ scope, textHandle }) => {
      const fixture = window.__attachmentUiTest;
      fixture.emitCapturedText(textHandle, "不应写入另一个聊天");
      fixture.emitImport([fixture.file("image", "stale-navigation")], { scope });
    }, previous);
    await settle(page);
    assert.equal(await composer.inputValue(), "第二个聊天的草稿");
    assert.equal(await cards.count(), 0);
    assert.ok(await page.evaluate(() => window.__attachmentUiTest.snapshot().released.flat().includes("stale-navigation")), "Late import metadata from the previous navigation is released");
    assert.equal(await page.evaluate(() => window.__attachmentUiTest.snapshot().textListeners), 1, "Navigation removes the old subscription instead of accumulating text listeners");
    await chooseChat(page, "合成附件 · 输入与预览");
    assert.equal(await composer.inputValue(), typed, "The original chat keeps its text draft after attachment cleanup");
    await page.getByRole("button", { name: "添加附件", exact: true }).click();
    await page.locator('[data-attachment-id="synthetic-picker-file"]').waitFor();
    assert.equal(await page.locator('[data-attachment-id="synthetic-picker-file"] img').count(), 0, "Ordinary picker files keep the compact non-image card");
    assert.equal(await page.evaluate(() => window.__attachmentUiTest.snapshot().requests.filter((item) => item.method === "sendAttachments").length), 0);
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.waitForFunction(() => window.__attachmentUiTest.snapshot().pendingSends === 1 && window.__attachmentUiTest.snapshot().textListeners === 0 && document.querySelector("[data-attachment-composer]").getAttribute("data-attachment-disabled") === "true");
    await page.evaluate(() => {
      const fixture = window.__attachmentUiTest;
      fixture.mixed("发送期间不插入", [fixture.file("file", "during-send")]);
    });
    assert.equal(await composer.inputValue(), typed);
    assert.ok(await page.evaluate(() => window.__attachmentUiTest.snapshot().released.flat().includes("during-send")));
    await page.evaluate(() => window.__attachmentUiTest.completeSend());
    await ready(page);
    assert.equal(await composer.inputValue(), "");
    assert.equal(await cards.count(), 0);
    assert.equal(await page.evaluate(() => window.__attachmentUiTest.snapshot().requests.filter((item) => item.method === "sendAttachments").length), 1, "Exactly one explicitly clicked synthetic send occurs");

    await composer.fill("断线时保留的草稿");
    await page.evaluate(() => window.__attachmentUiTest.setConnection("disconnected"));
    await page.waitForFunction(() => window.__attachmentUiTest.snapshot().textListeners === 0 && document.querySelector("[data-attachment-composer]").getAttribute("data-attachment-disabled") === "true");
    await page.evaluate(() => window.__attachmentUiTest.mixed("离线不插入"));
    assert.equal(await composer.inputValue(), "断线时保留的草稿");
    await page.evaluate(() => window.__attachmentUiTest.setConnection("connected"));
    await ready(page);
    assert.equal(await composer.inputValue(), "断线时保留的草稿");
    await page.evaluate(() => window.__attachmentUiTest.changeIdentity());
    await ready(page);
    assert.equal(await composer.inputValue(), "", "A different account does not inherit the prior account draft");
    assert.equal(await page.evaluate(() => window.__attachmentUiTest.snapshot().textListeners), 1);
    await context.close();
  }
}
