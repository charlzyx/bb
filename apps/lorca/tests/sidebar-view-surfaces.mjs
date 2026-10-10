import assert from "node:assert/strict";

function installSidebarViewFixture({ theme }) {
  localStorage.setItem("bb-lorca.appearance", theme);
  const endpoint = "ws://127.0.0.1:4862/ws";
  let identity = "synthetic-sidebar-account-a";
  const requests = [], listeners = new Set();
  const now = new Date();
  const localTime = (age, hour = 0, minute = 0, second = 0) => Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() - age, hour, minute, second).getTime() / 1000);
  const bots = Array.from({ length: 28 }, (_, index) => ({ id: `sidebar-bot-${index}`, name: index === 0 ? "合成分组主力" : `合成独立助手 ${index}`, runner_id: "sidebar-runner", symbol_name: "terminal", accent: "indigo" }));
  const records = [
    { id: "sidebar-main", title: "合成主聊天 · 阅读与草稿", bucket: "today", stamp: Math.floor(now.getTime() / 1000) },
    { id: "sidebar-today", title: "合成今天零点", bucket: "today", stamp: localTime(0, 0, 0, 1) },
    { id: "sidebar-yesterday", title: "合成昨天最后一秒", bucket: "three-days", stamp: localTime(1, 23, 59, 59) },
    { id: "sidebar-two", title: "合成前天零点", bucket: "three-days", stamp: localTime(2) },
    { id: "sidebar-three", title: "合成第三天最后一秒", bucket: "week", stamp: localTime(3, 23, 59, 59) },
    { id: "sidebar-six", title: "合成第六天零点", bucket: "week", stamp: localTime(6) },
    { id: "sidebar-seven", title: "合成第七天最后一秒", bucket: "older", stamp: localTime(7, 23, 59, 59) },
    { id: "sidebar-old", title: "合成较早历史", bucket: "older", stamp: localTime(30) },
    { id: "sidebar-team", title: "合成已分类群聊", bucket: "three-days", stamp: localTime(1, 12), kind: "group" },
    { id: "sidebar-free-team", title: "合成未分组群聊", bucket: "week", stamp: localTime(3, 12), kind: "group" },
    ...Array.from({ length: 16 }, (_, index) => ({ id: `sidebar-archive-${index}`, title: `合成历史列表 ${index}`, bucket: "older", stamp: localTime(10 + index) })),
  ];
  const chats = records.map(record => ({
    id: record.id, kind: record.kind ?? "dm", title: record.title, bot_ids: record.kind === "group" ? [bots[0].id, bots[1].id] : [bots[0].id], created_at: record.stamp, has_more: false,
    messages: record.id === "sidebar-main" ? Array.from({ length: 28 }, (_, index) => ({ id: `sidebar-message-${index}`, chat_id: record.id, author: { kind: "bot", bot_id: bots[0].id }, body: { kind: "text", text: `合成阅读段落 ${index + 1}\n\n${"仅用于验证侧栏视图切换时保持正文阅读位置。".repeat(10)}` }, state: { kind: "complete" }, created_at: record.stamp })) : [],
  }));
  const namespace = value => JSON.stringify([endpoint, value]);
  const groupKey = `dots.agent-groups.v1:${encodeURIComponent(namespace(identity))}`;
  if (localStorage.getItem(groupKey) === null) localStorage.setItem(groupKey, JSON.stringify({ version: 1, groups: [{ id: "sidebar-work", name: "合成工作组", collapsed: true, memberIds: [{ kind: "bot", id: bots[0].id }, { kind: "chat", id: "sidebar-team" }], primaryIds: [bots[0].id] }] }));
  window.__sidebarViewTest = {
    requests,
    records,
    currentIdentity: () => identity,
    changeIdentity(value) {
      identity = value;
      for (const listener of listeners) listener({ event: "identity.changed", data: { has_identity: true } });
    },
    preferences(value = identity) { const raw = localStorage.getItem(`dots.sidebar.v1:${encodeURIComponent(namespace(value))}`); return raw === null ? null : JSON.parse(raw); },
    groups(value = identity) { const raw = localStorage.getItem(`dots.agent-groups.v1:${encodeURIComponent(namespace(value))}`); return raw === null ? null : JSON.parse(raw); },
  };
  window.lorca = {
    getStatus: async () => ({ status: "connected", endpoint, generation: 1, authMode: "token", detail: "仅用于合成侧栏视图测试" }),
    connect: async () => { throw new Error("Synthetic sidebar fixtures cannot connect to services"); },
    request: async (method, params) => {
      requests.push({ method, params: structuredClone(params) });
      if (method !== "bootstrap") throw new Error(`Unexpected synthetic sidebar request: ${method}`);
      return { version: "synthetic-sidebar-views", has_identity: true, identity_id: identity, relay_connected: false, devices: [{ id: "sidebar-runner", name: "合成侧栏 Runner", status: "online" }], bots: structuredClone(bots), chats: structuredClone(chats), running_turns: [], running_chat_ids: [] };
    },
    onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    onStatus: () => () => {},
  };
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export async function checkSidebarViewSurfaces({ browser, base, screenshot = async () => {}, captureErrors = () => {}, setFailurePage = () => {} }) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1240, height: 820 }, deviceScaleFactor: 1, timezoneId: "Asia/Shanghai" });
    const page = await context.newPage();
    setFailurePage(page);
    captureErrors(page);
    try {
      await page.addInitScript(installSidebarViewFixture, { theme });
      await page.goto(base, { waitUntil: "networkidle" });
      const views = page.getByRole("group", { name: "侧栏视图", exact: true });
      const recent = views.getByRole("button", { name: "最近", exact: true });
      const teams = views.getByRole("button", { name: "团队", exact: true });
      const search = page.getByRole("searchbox", { name: "搜索智能体与对话", exact: true });
      const list = page.locator(".lorca-chat-list");
      const bucket = id => list.locator(`[data-recent-bucket="${id}"]`);
      const toggle = id => bucket(id).locator(".lorca-recent-bucket-toggle");
      const mainTitle = "合成主聊天 · 阅读与草稿";
      await list.locator(".lorca-chat-item").filter({ hasText: mainTitle }).waitFor();
      assert.equal(await recent.getAttribute("aria-pressed"), "true", "An account without preferences starts in Recent");
      assert.equal(await teams.getAttribute("aria-pressed"), "false");
      assert.equal(await page.evaluate(() => window.__sidebarViewTest.preferences()), null, "The default view is not silently persisted on load");
      assert.deepEqual(await list.locator(".lorca-recent-bucket-toggle > span:first-child").allTextContents(), ["今天", "近三天", "近一周", "全部"]);
      const records = await page.evaluate(() => window.__sidebarViewTest.records);
      const rendered = [];
      for (const id of ["today", "three-days", "week", "older"]) {
        const actual = await bucket(id).locator(".lorca-chat-item-title").allTextContents();
        const expected = records.filter(record => record.bucket === id).sort((a, b) => b.stamp - a.stamp || a.id.localeCompare(b.id)).map(record => record.title);
        assert.deepEqual(actual, expected, `${id} uses local calendar dates, including the last second before a day boundary`);
        assert.equal(await toggle(id).getAttribute("aria-expanded"), "true");
        rendered.push(...actual);
      }
      assert.equal(rendered.length, records.length);
      assert.equal(new Set(rendered).size, records.length, "Every chat belongs to exactly one mutually exclusive date bucket");
      assert.match(await toggle("older").getAttribute("title"), /一周以前.*不重复/);
      await list.locator(".lorca-chat-item").filter({ hasText: mainTitle }).click();
      const composer = page.getByRole("textbox", { name: "给 dots 发消息", exact: true });
      const draft = `合成 ${theme} 侧栏切换草稿`;
      await composer.fill(draft);
      await settle(page);
      await page.locator(".lorca-scroll").evaluate(element => { element.scrollTop = element.scrollHeight / 2; });
      await list.evaluate(element => { element.scrollTop = Math.min(340, element.scrollHeight - element.clientHeight); });
      await settle(page);
      const mainScroll = await page.locator(".lorca-scroll").evaluate(element => element.scrollTop);
      const recentScroll = await list.evaluate(element => element.scrollTop);
      assert.ok(mainScroll > 100 && recentScroll > 100, "The fixture exercises genuinely scrolled transcript and sidebar containers");
      const checkMain = async () => {
        assert.equal(await composer.inputValue(), draft);
        assert.equal(await page.locator(".lorca-header-chat-title").innerText(), mainTitle);
        assert.ok(Math.abs(await page.locator(".lorca-scroll").evaluate(element => element.scrollTop) - mainScroll) <= 1, "Changing sidebar views preserves the current chat reading position");
      };
      await teams.click();
      const tree = page.getByRole("region", { name: "智能体与群聊分组", exact: true });
      await tree.waitFor();
      await settle(page);
      await checkMain();
      assert.equal(await teams.getAttribute("aria-pressed"), "true");
      assert.equal(await tree.locator(".lorca-agent-groups-heading h2").innerText(), "团队");
      assert.doesNotMatch(await tree.locator(".lorca-agent-groups-heading").innerText(), /Teams/);
      const solo = tree.getByRole("region", { name: "未分组智能体", exact: true });
      const looseChats = tree.getByRole("region", { name: "未分组群聊", exact: true });
      assert.match(await solo.locator("h3").innerText(), /^Solo/);
      assert.equal(await solo.locator("[data-agent-select]").count(), 27);
      assert.equal(await solo.locator("[data-group-chat-select]").count(), 0, "Solo contains only ungrouped bots");
      assert.equal(await looseChats.locator('[data-group-chat-select="sidebar-free-team"]').count(), 1);
      assert.equal(await looseChats.locator("[data-agent-select]").count(), 0);
      const group = tree.locator('[data-agent-group="sidebar-work"]');
      assert.equal(await group.locator(".lorca-agent-group-toggle").getAttribute("aria-expanded"), "false");
      await list.evaluate(element => { element.scrollTop = Math.min(210, element.scrollHeight - element.clientHeight); });
      await settle(page);
      const teamScroll = await list.evaluate(element => element.scrollTop);
      assert.ok(teamScroll > 100);
      await recent.click();
      await settle(page);
      await checkMain();
      assert.ok(Math.abs(await list.evaluate(element => element.scrollTop) - recentScroll) <= 1, "Recent restores its own sidebar scroll offset");
      assert.equal(await list.locator('.lorca-chat-item[aria-current="page"]').innerText(), mainTitle);
      await teams.click();
      await settle(page);
      assert.ok(Math.abs(await list.evaluate(element => element.scrollTop) - teamScroll) <= 1, "Teams restores its own sidebar scroll offset");
      await checkMain();
      await search.fill("合成分组主力");
      assert.equal(await group.locator(".lorca-agent-group-toggle").getAttribute("aria-expanded"), "true");
      assert.equal(await group.locator('[data-agent-select="sidebar-bot-0"]').count(), 1, "Search reveals a bot inside a collapsed group");
      await search.fill("合成已分类群聊");
      assert.equal(await group.locator('[data-group-chat-select="sidebar-team"]').count(), 1, "Search also reveals a collapsed group's chat member");
      await search.fill("合成未分组群聊");
      assert.equal(await looseChats.locator('[data-group-chat-select="sidebar-free-team"]').count(), 1);
      await search.fill("");
      assert.equal(await group.locator(".lorca-agent-group-toggle").getAttribute("aria-expanded"), "false");
      assert.equal(await page.evaluate(() => window.__sidebarViewTest.groups().groups[0].collapsed), true, "Search expansion does not persist a different group collapse preference");
      await screenshot(page, `desktop-sidebar-teams-${theme}`);
      await recent.click();
      await toggle("today").click();
      await toggle("week").click();
      assert.equal(await bucket("today").locator(".lorca-chat-item").count(), 0);
      assert.equal(await bucket("week").locator(".lorca-chat-item").count(), 0);
      await search.fill("合成第三天最后一秒");
      assert.equal(await list.locator("[data-recent-bucket]").count(), 0, "Global search replaces date buckets without changing the saved sidebar view");
      assert.equal(await list.locator(".lorca-chat-item-title").innerText(), "合成第三天最后一秒");
      assert.doesNotMatch(await tree.innerText(), /没有匹配的分组、智能体或群聊。/, "A DM-only match never shows a contradictory global empty state");
      assert.equal(await recent.getAttribute("aria-pressed"), "true");
      assert.deepEqual(await page.evaluate(() => window.__sidebarViewTest.preferences()), { view: "recent", collapsed: ["today", "week"] });
      await search.fill("合成独立助手 27");
      assert.equal(await tree.locator('[data-agent-select="sidebar-bot-27"]').count(), 1, "Searching from Recent still finds a bot without any existing chat");
      await search.fill("合成不存在的搜索结果");
      assert.match(await tree.innerText(), /没有匹配的分组、智能体或群聊。/);
      assert.equal(await list.locator("[data-group-select], .lorca-chat-item").count(), 0);
      await search.fill("");
      assert.equal(await toggle("week").getAttribute("aria-expanded"), "false");
      assert.deepEqual(await page.evaluate(() => window.__sidebarViewTest.preferences().collapsed), ["today", "week"]);
      await screenshot(page, `desktop-sidebar-recent-collapsed-${theme}`);
      await teams.click();
      assert.equal(await page.evaluate(() => window.__sidebarViewTest.requests.some(request => request.method !== "bootstrap")), false, "Local view, folding and search interactions issue no mutation RPCs");
      await page.reload({ waitUntil: "networkidle" });
      await tree.waitFor();
      assert.equal(await teams.getAttribute("aria-pressed"), "true", "The chosen sidebar view survives reload");
      await recent.click();
      assert.equal(await toggle("today").getAttribute("aria-expanded"), "false");
      assert.equal(await toggle("week").getAttribute("aria-expanded"), "false", "Date bucket folding survives reload");
      await teams.click();
      await page.evaluate(() => window.__sidebarViewTest.changeIdentity("synthetic-sidebar-account-b"));
      await page.waitForFunction(() => document.querySelector('.lorca-sidebar-view-switch button[aria-pressed="true"]')?.textContent === "最近" && document.querySelector('[data-recent-bucket="today"] .lorca-chat-item'));
      assert.equal(await page.evaluate(() => window.__sidebarViewTest.preferences()), null);
      for (const id of ["today", "three-days", "week", "older"]) assert.equal(await toggle(id).getAttribute("aria-expanded"), "true", "Another account cannot inherit folded buckets");
      await toggle("older").click();
      await teams.click();
      await tree.waitFor();
      assert.equal(await tree.locator("[data-agent-group]").count(), 0, "Account changes do not inherit another account's groups");
      assert.equal(await solo.locator("[data-agent-select]").count(), 28);
      assert.equal(await looseChats.locator("[data-group-chat-select]").count(), 2);
      await page.evaluate(() => window.__sidebarViewTest.changeIdentity("synthetic-sidebar-account-a"));
      await group.waitFor();
      assert.equal(await teams.getAttribute("aria-pressed"), "true");
      await recent.click();
      assert.equal(await toggle("today").getAttribute("aria-expanded"), "false");
      assert.equal(await toggle("week").getAttribute("aria-expanded"), "false");
      assert.equal(await toggle("older").getAttribute("aria-expanded"), "true");
      assert.deepEqual(await page.evaluate(() => window.__sidebarViewTest.preferences("synthetic-sidebar-account-b")), { view: "teams", collapsed: ["older"] });
      assert.equal(await page.evaluate(() => window.__sidebarViewTest.requests.some(request => request.method !== "bootstrap")), false, "Sidebar presentation never creates chats, sends messages or changes daemon configuration");
    } catch (error) {
      await screenshot(page, `sidebar-view-failure-${theme}`).catch(() => undefined);
      throw error;
    } finally {
      await context.close();
    }
  }
}
