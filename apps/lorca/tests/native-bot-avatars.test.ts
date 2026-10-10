import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const { BotAvatars, botPresentation, avatarDescriptor, rasterHeader, MAX_BYTES } = require("../native/bot-avatars.cjs");
const { sanitizeRendererResult, sanitizeRendererEvent } = require("../native/settings.cjs");
const { validateRequest } = require("../native/bridge.cjs");
const png = await readFile(new URL("../public/dots.png", import.meta.url));
const attachment = (id = "att-synthetic") => ({ id, name: "private-file-name.png", mime: "image/png", size: png.length, width: 256, height: 256, key: "SYNTHETIC_PRIVATE_KEY" });
const bot = (id = "bot-one", avatar = attachment()) => ({ id, name: "Original Bot", runner_id: "runner-one", avatar, symbol_name: "cat.fill", accent: "teal" });
const snapshot = (bots = [bot()]) => ({ version: "synthetic", has_identity: true, identity_id: "account-one", relay_connected: false, bots, chats: [], running_turns: [], running_chat_ids: [] });
function get(avatars: any, botId: unknown, guard?: () => void) {
  return avatars.get(botId, avatars.bots.get(botId)?.version ?? "0".repeat(24), guard);
}
class Bridge extends EventEmitter {
  status = { status: "connected", generation: 1 };
  calls: string[] = [];
  constructor(readonly home: string) { super(); }
  getStatus() { return { ...this.status }; }
  sendValidated(method: string) { this.calls.push(method); throw new Error("No avatar RPC is allowed"); }
}
async function fixture(context: { after: (callback: () => Promise<void>) => void }) {
  const home = await mkdtemp(path.join(tmpdir(), "dots-bot-avatar-")); await mkdir(path.join(home, "files"));
  await writeFile(path.join(home, "files", "att-synthetic"), png);
  const bridge = new Bridge(home);
  const decoded: Buffer[] = []; const resized: { width: number; height: number }[] = [];
  const decoder = { createFromBuffer: (bytes: Buffer) => {
    decoded.push(bytes);
    return { isEmpty: () => false, getSize: () => rasterHeader(bytes), resize: (size: { width: number; height: number }) => { resized.push(size); return { toPNG: () => png }; } };
  } };
  const avatars = new BotAvatars(bridge, decoder); avatars.observeSnapshot(snapshot());
  context.after(async () => { avatars.dispose(); await rm(home, { recursive: true, force: true }); });
  return { home, bridge, avatars, decoded, resized, decoder };
}

test("avatar projection keeps safe visual hints and only an opaque version, never attachment fields", () => {
  const projected = sanitizeRendererResult("bootstrap", snapshot()).bots[0];
  assert.equal(projected.symbol_name, "cat.fill"); assert.equal(projected.accent, "teal"); assert.equal(projected.has_avatar, true);
  assert.match(projected.avatar_version, /^[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(projected).includes("att-synthetic"), false); assert.equal(JSON.stringify(projected).includes("SYNTHETIC_PRIVATE_KEY"), false); assert.equal(JSON.stringify(projected).includes("private-file-name"), false);
  assert.deepEqual(sanitizeRendererEvent({ event: "roster.changed", data: snapshot() }, "true:account-one").data.bots[0], projected);
  assert.deepEqual(botPresentation({ symbol_name: "<svg/onload=x>", accent: "url(file:///private)", avatar: { ...attachment(), id: "../../private" } }), { symbol_name: "sparkles", accent: "indigo", has_avatar: false, avatar_version: null });
  assert.throws(() => validateRequest("files.path", { attachment: attachment() }));
});

test("known cached avatars are re-encoded as PNG and repeated reads share bounded cache without RPC", async context => {
  const { avatars, decoded, resized, bridge } = await fixture(context);
  const [first, second] = await Promise.all([get(avatars, "bot-one"), get(avatars, "bot-one")]);
  assert.equal(first, `data:image/png;base64,${png.toString("base64")}`); assert.equal(second, first);
  assert.equal(await get(avatars, "bot-one"), first); assert.equal(decoded.length, 1);
  assert.deepEqual(resized[0], { width: 256, height: 256, quality: "good" }); assert.equal(bridge.calls.length, 0);
  assert.equal(await get(avatars, "unknown-bot"), null);
  for (const input of [{ attachment: attachment() }, "", "bad\0id"]) await assert.rejects(get(avatars, input), /头像请求无效/);
});

test("missing cache or an unverifiable home falls back without files.path, registration, or connection changes", async context => {
  const { avatars, home, bridge, decoded } = await fixture(context);
  await rm(path.join(home, "files", "att-synthetic"));
  assert.equal(await get(avatars, "bot-one"), null); assert.equal(await get(avatars, "bot-one"), null);
  assert.equal(avatars.cache.size, 1); assert.equal(decoded.length, 0); assert.deepEqual(bridge.calls, []); assert.equal(bridge.status.status, "connected");
  const relative = new BotAvatars(new Bridge("relative-home"), { createFromBuffer: () => assert.fail("must not decode") });
  relative.observeSnapshot(snapshot()); assert.equal(await get(relative, "bot-one"), null); relative.dispose();
});

for (const kind of ["file symlink", "directory symlink", "hardlink"] as const) {
  test(`avatar cache rejects ${kind} without exposing another file`, async context => {
    const { avatars, home, decoded } = await fixture(context);
    const external = path.join(home, "outside.png"); await writeFile(external, png);
    await rm(path.join(home, "files", "att-synthetic"));
    if (kind === "file symlink") await symlink(external, path.join(home, "files", "att-synthetic"));
    if (kind === "hardlink") await link(external, path.join(home, "files", "att-synthetic"));
    if (kind === "directory symlink") { await rm(path.join(home, "files"), { recursive: true }); await mkdir(path.join(home, "outside")); await writeFile(path.join(home, "outside", "att-synthetic"), png); await symlink(path.join(home, "outside"), path.join(home, "files")); }
    assert.equal(await get(avatars, "bot-one"), null); assert.equal(decoded.length, 0);
  });
}

test("SVG, oversized or inconsistent image metadata and decompression-bomb dimensions are rejected before decode", async context => {
  const { avatars, home, decoded } = await fixture(context);
  for (const value of [{ ...attachment(), mime: "image/svg+xml" }, { ...attachment(), size: MAX_BYTES + 1 }, { ...attachment(), width: 100000 }, { ...attachment(), id: "att-../private" }]) assert.equal(avatarDescriptor(value), null);
  const malicious = Buffer.from(png); malicious.writeUInt32BE(100000, 16);
  await writeFile(path.join(home, "files", "att-synthetic"), malicious);
  assert.equal(await get(avatars, "bot-one"), null); assert.equal(decoded.length, 0);
  avatars.clear(); avatars.observeSnapshot(snapshot());
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>');
  await writeFile(path.join(home, "files", "att-synthetic"), svg);
  avatars.observeSnapshot(snapshot([bot("bot-one", { ...attachment(), size: svg.length })]));
  assert.equal(await get(avatars, "bot-one"), null); assert.equal(decoded.length, 0);
  avatars.observeSnapshot(snapshot([bot("bot-one", { ...attachment(), size: png.length + 1 })]));
  await writeFile(path.join(home, "files", "att-synthetic"), png);
  assert.equal(await get(avatars, "bot-one"), null); assert.equal(decoded.length, 0);
});

test("header parsers enforce JPEG and WebP pixel bounds and reject animated or inconsistent WebP canvases", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 32, 0, 64, 1, 1, 0x11, 0, 0xff, 0xda]);
  assert.deepEqual(rasterHeader(jpeg), { mime: "image/jpeg", width: 64, height: 32 });
  const bomb = Buffer.from(jpeg); bomb.writeUInt16BE(65535, 9); assert.throws(() => rasterHeader(bomb));
  const webp = Buffer.alloc(26); webp.write("RIFF"); webp.writeUInt32LE(18, 4); webp.write("WEBPVP8L", 8); webp.writeUInt32LE(5, 16); webp[20] = 0x2f; webp.writeUInt32LE(31 | (63 << 14), 21);
  assert.deepEqual(rasterHeader(webp), { mime: "image/webp", width: 32, height: 64 });
  webp.writeUInt32LE(16383, 21); assert.throws(() => rasterHeader(webp));
  assert.throws(() => rasterHeader(Buffer.from("<svg/>")));
});

for (const change of ["identity event", "identity snapshot", "generation", "avatar revision", "bot removed", "source"] as const) {
  test(`a late avatar after ${change} cannot be returned or cached`, async context => {
    const { avatars, bridge } = await fixture(context);
    let resolve!: (value: string) => void; let trusted = true;
    avatars.load = () => new Promise<string>(done => { resolve = done; });
    const pending = get(avatars, "bot-one", () => { if (!trusted) throw new Error("请求来源不可信"); });
    const rejection = assert.rejects(pending, /变化|来源不可信/);
    if (change === "identity event") bridge.emit("event", { event: "identity.changed", data: { has_identity: true } });
    if (change === "identity snapshot") avatars.observeSnapshot({ ...snapshot(), identity_id: "account-two" });
    if (change === "generation") { bridge.status.generation++; bridge.emit("status", bridge.getStatus()); }
    if (change === "avatar revision") avatars.observeBots([bot("bot-one", attachment("att-replacement"))]);
    if (change === "bot removed") avatars.observeBots([]);
    if (change === "source") trusted = false;
    resolve(`data:image/png;base64,${png.toString("base64")}`); await rejection;
    assert.equal(avatars.cache.size, 0);
  });
}

test("avatar pending work stays capped across account invalidation and cached entries stay bounded", async context => {
  const { avatars } = await fixture(context);
  avatars.observeBots(Array.from({ length: 70 }, (_, index) => bot(`bot-${index}`)));
  for (let index = 0; index < 70; index++) await get(avatars, `bot-${index}`);
  assert.equal(avatars.cache.size, 64); assert(avatars.cacheBytes <= 8 * 1024 * 1024);
  avatars.clear(); avatars.observeSnapshot(snapshot(Array.from({ length: 5 }, (_, index) => bot(`bot-${index}`))));
  const resolves: ((value: null) => void)[] = [];
  avatars.load = () => new Promise(resolve => resolves.push(resolve));
  const pending = Array.from({ length: 4 }, (_, index) => get(avatars, `bot-${index}`).catch(() => null));
  assert.equal(await get(avatars, "bot-4"), null); assert.equal(resolves.length, 4);
  avatars.clear(); avatars.observeSnapshot(snapshot());
  assert.equal(await get(avatars, "bot-one"), null); assert.equal(resolves.length, 4);
  for (const resolve of resolves) resolve(null); await Promise.all(pending); assert.equal(avatars.activeLoads, 0);
});

test("PNG parsing rejects animation, incomplete chunks, trailing content and duplicate headers", () => {
  const iend = png.length - 12;
  assert.equal(png.toString("ascii", iend + 4, iend + 8), "IEND");
  for (const kind of ["acTL", "fcTL", "fdAT", "IHDR"]) {
    const chunk = Buffer.alloc(12); chunk.write(kind, 4);
    assert.throws(() => rasterHeader(Buffer.concat([png.subarray(0, iend), chunk, png.subarray(iend)])));
  }
  assert.throws(() => rasterHeader(png.subarray(0, iend)));
  assert.throws(() => rasterHeader(Buffer.concat([png, Buffer.from("trailing")] )));
  const truncated = Buffer.from(png); truncated.writeUInt32BE(0xffffffff, 33); assert.throws(() => rasterHeader(truncated));
});

test("decoded dimensions, MIME mismatches and oversized output cannot bypass header bounds", async context => {
  const { avatars, decoder, decoded } = await fixture(context);
  avatars.observeBots([bot("bot-one", { ...attachment(), mime: "image/jpeg" })]);
  assert.equal(await get(avatars, "bot-one"), null); assert.equal(decoded.length, 0);
  avatars.observeBots([bot()]);
  decoder.createFromBuffer = () => ({ isEmpty: () => false, getSize: () => ({ width: 4096, height: 4096 }), resize: () => ({ toPNG: () => png }) });
  assert.equal(await get(avatars, "bot-one"), null);
  avatars.cache.clear();
  decoder.createFromBuffer = () => ({ isEmpty: () => false, getSize: () => ({ width: 256, height: 256 }), resize: () => ({ toPNG: () => Buffer.alloc(512 * 1024 + 1) }) });
  assert.equal(await get(avatars, "bot-one"), null);
});

test("negative caching expires and newly present local avatars can be read without a network lookup", async context => {
  const { avatars, home, decoded, bridge } = await fixture(context);
  const file = path.join(home, "files", "att-synthetic"); await rm(file);
  assert.equal(await get(avatars, "bot-one"), null);
  const cached = avatars.cache.get("bot-one"); assert(cached.expiresAt - Date.now() <= 5000); assert(cached.expiresAt > Date.now());
  await writeFile(file, png); assert.equal(await get(avatars, "bot-one"), null); assert.equal(decoded.length, 0);
  cached.expiresAt = 0;
  assert.match(await get(avatars, "bot-one"), /^data:image\/png;base64,/); assert.equal(decoded.length, 1); assert.deepEqual(bridge.calls, []);
});

test("avatar results use encoder output rather than the original file or its metadata", async context => {
  const { avatars, home, decoded } = await fixture(context);
  const metadata = Buffer.from("Comment\0SYNTHETIC_PRIVATE_METADATA");
  const chunk = Buffer.alloc(metadata.length + 12); chunk.writeUInt32BE(metadata.length); chunk.write("tEXt", 4); metadata.copy(chunk, 8);
  const input = Buffer.concat([png.subarray(0, png.length - 12), chunk, png.subarray(png.length - 12)]);
  await writeFile(path.join(home, "files", "att-synthetic"), input);
  avatars.observeBots([bot("bot-one", { ...attachment(), size: input.length })]);
  const result = await get(avatars, "bot-one");
  assert(decoded[0].includes(metadata)); assert.equal(result, `data:image/png;base64,${png.toString("base64")}`);
  assert.notEqual(result, `data:image/png;base64,${input.toString("base64")}`);
});

test("settings inventory bootstrap observations also invalidate cached avatars on a silent account change", async context => {
  const { avatars, bridge } = await fixture(context);
  const { SettingsInventory } = require("../native/settings.cjs");
  const settings = new SettingsInventory(bridge); settings.onSnapshot = (value: unknown) => avatars.observeSnapshot(value);
  context.after(async () => settings.dispose());
  settings.observeSnapshot(snapshot()); await get(avatars, "bot-one"); assert.equal(avatars.cache.size, 1);
  const fence = settings.capture();
  settings.observeSnapshot({ ...snapshot(), identity_id: "replacement-account", bots: [] });
  assert.equal(avatars.cache.size, 0); assert.equal(await get(avatars, "bot-one"), null);
  assert.throws(() => settings.check(fence), /账号或连接已变化/);
});

test("the expected opaque avatar version must match before local reads and changes across accounts", async context => {
  const { avatars, decoded } = await fixture(context);
  const original = avatars.bots.get("bot-one").version;
  assert.equal(await avatars.get("bot-one", "0".repeat(24)), null); assert.equal(decoded.length, 0);
  avatars.observeSnapshot({ ...snapshot(), identity_id: "account-two" });
  assert.notEqual(avatars.bots.get("bot-one").version, original);
  assert.equal(await avatars.get("bot-one", original), null); assert.equal(decoded.length, 0);
  assert.match(await get(avatars, "bot-one"), /^data:image\/png;base64,/);
  await assert.rejects(avatars.get("bot-one", undefined), /头像请求无效/);
});
