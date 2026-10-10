import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkAttachmentSurfaces } from "./attachment-ui-surfaces.mjs";

let playwright;
try {
  playwright = await import("playwright");
} catch {
  if (!process.env.PLAYWRIGHT_MODULE) throw new Error("Install Playwright in the workspace, or set PLAYWRIGHT_MODULE to an installed Playwright module path.");
  playwright = await import(process.env.PLAYWRIGHT_MODULE);
}
const base = process.env.LORCA_UI_URL || "http://127.0.0.1:5178";
const output = process.env.LORCA_SCREENSHOT_DIR || fileURLToPath(new URL("../../../docs/lorca-screenshots/", import.meta.url));
mkdirSync(output, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await playwright.chromium.launch({ headless: true, executablePath, chromiumSandbox: true, args: ["--enable-automation"] });
const failures = [];
let failurePage;
try {
  const command = await browser.newBrowserCDPSession();
  const { arguments: args } = await command.send("Browser.getBrowserCommandLine");
  await command.detach();
  assert.equal(args.includes("--no-sandbox"), false, "The synthetic browser must run with its sandbox enabled");
  await checkAttachmentSurfaces({
    browser, base,
    setFailurePage: (page) => { failurePage = page; },
    captureErrors: (page) => {
      page.on("pageerror", (error) => failures.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
    },
    screenshot: async (page, name) => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => Array.from(document.querySelectorAll('img[data-app-mark="ghost"]')).every((image) => image.complete && image.naturalWidth > 0));
      const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > innerWidth + 1, cards: Array.from(document.querySelectorAll("[data-attachment-id]")).some((element) => element.getBoundingClientRect().right > innerWidth + 1) }));
      assert.deepEqual(overflow, { page: false, cards: false }, `${name}: attachments must not overflow the desktop viewport`);
      await page.screenshot({ path: `${output}/${name}.png`, animations: "disabled" });
    },
  });
  assert.deepEqual(failures, [], "Synthetic attachment pages have no unexpected browser errors");
  console.log("Attachment UI smoke passed: light/dark previews, caret and repeated mixed-text insertion, React typing, decode fallback/removal, duplicate/error feedback, navigation/account fences, explicit send and disconnected gating.");
} catch (error) {
  if (failurePage && !failurePage.isClosed()) {
    await failurePage.screenshot({ path: `${output}/attachment-ui-smoke-failure.png`, animations: "disabled", timeout: 5000 }).catch(() => undefined);
    const state = await failurePage.evaluate(() => window.__attachmentUiTest?.snapshot()).catch(() => null);
    writeFileSync(`${output}/attachment-ui-smoke-failure.json`, JSON.stringify({ state, failures }, null, 2));
  }
  throw error;
} finally {
  await browser.close();
}
