import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsFrame, type SettingsPage } from "./settings/SettingsFrame";

test("Every settings section has one content-top return action and no internal close icon", () => {
  let callbacks = 0;
  const pages: SettingsPage[] = ["preferences", "providers", "approvals", "mcp", "models", "devices", "connection"];
  for (const page of pages) {
    const html = renderToStaticMarkup(<SettingsFrame open onOpenChange={() => { callbacks++; }} page={page} onPageChange={() => { callbacks++; }} demo={false} deviceControl={<select aria-label="查看设备"><option>合成设备</option></select>}><input aria-label="合成单行字段" /><textarea aria-label="合成多行字段" /></SettingsFrame>);
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    const sidebar = html.match(/<aside[\s\S]*?<\/aside>/)?.[0] ?? "";
    assert.equal((html.match(/class="[^"]*lorca-settings-back/g) ?? []).length, 1);
    assert.match(header, /lorca-settings-topbar/);
    assert.match(header, /lorca-settings-back[\s\S]*?返回聊天/);
    assert.match(header, /aria-label="查看设备"/);
    assert.doesNotMatch(html, /aria-label="关闭设置"/);
    assert.doesNotMatch(sidebar, /返回聊天|lorca-settings-back/);
    assert.match(sidebar, /aria-label="设置分类"/);
    assert.ok(html.indexOf("lorca-settings-desktop-main") < html.indexOf("lorca-settings-back"));
  }
  assert.equal(callbacks, 0);
});

test("Closing settings keeps its existing persistent hidden boundary and rendered children", () => {
  const html = renderToStaticMarkup(<SettingsFrame open={false} onOpenChange={() => {}} page="approvals" onPageChange={() => {}} demo={false}><input value="合成未保存草稿" readOnly /></SettingsFrame>);
  assert.match(html, /data-open="false"/);
  assert.match(html, /aria-hidden="true" inert=""/);
  assert.match(html, /value="合成未保存草稿"/);
  assert.match(html, /返回聊天/);
});

test("Settings width and control tokens stay local, leave textareas independent and keep native safe regions", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /max-width:\s*840px/);
  assert.match(css, /--lorca-settings-control-height:\s*36px/);
  assert.match(css, /--lorca-settings-control-padding:\s*12px/);
  assert.match(css, /--lorca-settings-gutter:\s*clamp\(24px, 2\.5vw, 48px\)/);
  const controls = css.match(/:where\(\.lorca-settings-desktop, \.lorca-settings-drawer\) :is\(input:not\(\[type="checkbox"\]\)[^{]*\{[^}]*height: var\(--lorca-settings-control-height, 36px\);[^}]*\}/)?.[0];
  assert.ok(controls);
  assert.doesNotMatch(controls, /textarea|lorca-app/);
  assert.match(css, /scroll-padding-top:\s*calc\(var\(--lorca-settings-header-height, 224px\) \+ 16px\)/);
  assert.match(css, /html\[data-lorca-platform="darwin"\] \.lorca-settings-desktop\) \.lorca-settings-sidebar\s*\{\s*padding-top: 44px;/);
  assert.match(css, /:is\(button, input, textarea, select, a, summary\)\s*\{\s*-webkit-app-region: no-drag;/);
});
