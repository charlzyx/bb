const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { isTrustedSender } = require('./bridge.cjs');

const ERROR = '配对状态或连接已变化，请检查设备列表后再继续。';
const UNKNOWN = '配对结果尚不确定。请先在官方客户端核对设备；此进程暂不允许再次生成或加入。请求不会自动重发，连接变化或重启也不代表撤销。新设备可能仍在后台加入；配对码最长有效十分钟。';
const TIMEOUT = 600_000;
const ACCEPT_TIMEOUT = 610_000;
function invalid() { throw new Error('配对信息无效，请在另一台设备重新获取完整配对码。'); }
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid(); return value; }
function text(value, maximum = 256, empty = false) { if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value) || (!empty && !value.trim())) invalid(); return value; }
function canonicalBase64(value, bytes) { text(value, 128); if (!/^[A-Za-z0-9_-]+$/.test(value) || Buffer.from(value, 'base64url').length !== bytes || Buffer.from(value, 'base64url').toString('base64url') !== value) invalid(); return value; }
function relay(value) {
  text(value, 2048);
  let url; try { url = new URL(value); } catch { invalid(); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || /[\\\s]/.test(value)) invalid();
  return { href: url.href, origin: url.origin };
}
function parsePairingString(value) {
  const code = text(value, 8192).trim();
  if (!code.startsWith('lorca://pair?') || code.includes('#')) invalid();
  const values = new Map();
  for (const pair of code.slice('lorca://pair?'.length).split('&')) {
    const index = pair.indexOf('='); if (index < 1) invalid();
    const key = pair.slice(0, index); if (!['relay', 'id', 'ek', 'n'].includes(key) || values.has(key)) invalid();
    let value; try { value = decodeURIComponent(pair.slice(index + 1)); } catch { invalid(); }
    values.set(key, value);
  }
  if (values.size !== 4) invalid();
  const identity = canonicalBase64(values.get('id'), 32);
  canonicalBase64(values.get('ek'), 32);
  const nonce = canonicalBase64(values.get('n'), 16), destination = relay(values.get('relay'));
  return { code, nonce, relay: destination.href, origin: destination.origin, identityId: createHash('sha256').update(identity).digest('hex').slice(0, 16) };
}
function snapshot(value) {
  const input = object(value); if (typeof input.has_identity !== 'boolean') invalid();
  return {
    hasIdentity: input.has_identity,
    identityId: input.identity_id == null ? null : text(input.identity_id),
    deviceId: input.this_device_id == null ? null : text(input.this_device_id),
    relay: input.relay_url == null ? null : text(input.relay_url, 2048),
  };
}
function sameScope(left, right) { return left.hasIdentity === right.hasIdentity && left.identityId === right.identityId && left.deviceId === right.deviceId && left.relay === right.relay; }
function device(value) { const input = object(value); return { id: text(input.id), name: text(input.name, 256, true), os: text(input.os, 64, true), ...(input.model === undefined ? {} : { model: text(input.model, 256, true) }) }; }
function visible(value) { return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`); }

function createPairingFlow({ BrowserWindow, ipcMain, dialog, bridge, inventory, getParent, getIcon, now = Date.now }) {
  const page = path.join(__dirname, 'secure-pairing.html'), trustedURL = pathToFileURL(page).href;
  const resources = new Set(['secure-pairing.html', 'secure-pairing.js', 'secure-pairing.css'].map(name => pathToFileURL(path.join(__dirname, name)).href));
  resources.add(pathToFileURL(path.join(__dirname, '..', 'public', 'app-icon', '64.png')).href);
  let active = null;
  const unknownScopes = new Set();
  const scopeKey = (status, mode) => `${text(status.endpoint, 160)}:${mode}`;
  function capabilities(value) {
    try {
      const status = bridge.getStatus(), source = snapshot(value);
      if (status.status !== 'connected' || status.authMode !== 'token') return { invite: false, join: false };
      return { invite: !unknownScopes.has(scopeKey(status, 'invite')) && source.hasIdentity && Boolean(source.identityId && source.deviceId && source.relay && relay(source.relay)), join: !unknownScopes.has(scopeKey(status, 'join')) && !source.hasIdentity };
    } catch { return { invite: false, join: false }; }
  }
  function guard(current, joining = false) {
    current.trusted();
    const status = bridge.getStatus();
    if (current.released || status.status !== 'connected' || status.authMode !== 'token' || status.generation !== current.fence.generation || current.invalid) throw new Error(ERROR);
    if (!joining) inventory.check(current.fence);
    else if (inventory.identity !== undefined && inventory.identity !== 'false:' && inventory.identity !== `true:${current.expected.identityId}`) throw new Error(ERROR);
  }
  async function read(current, joining = false) {
    guard(current, joining);
    const value = await bridge.sendValidated('bootstrap', {});
    guard(current, joining);
    const scope = snapshot(value);
    if (!joining && current.source && !sameScope(scope, current.source)) throw new Error(ERROR);
    inventory.observeSnapshot(value);
    guard(current, joining);
    return scope;
  }
  function view(current) {
    return { mode: current.mode, phase: current.phase, detail: current.detail, pairingString: current.phase === 'waiting' && !current.closed ? current.code : null,
      remainingSeconds: current.expiresAt ? Math.max(0, Math.ceil((current.expiresAt - now()) / 1000)) : null,
      device: current.result?.status === 'completed' ? current.result.device : null };
  }
  function publish(current) { if (current.window && !current.window.isDestroyed() && !current.closed) current.window.webContents.send('lorca:secure-pairing-state', view(current)); }
  function setPhase(current, phase, detail, result) {
    current.phase = phase; current.detail = detail;
    if (phase !== 'waiting') current.code = null;
    if (result) current.result = result;
    publish(current);
  }
  function cleanWindow(current) {
    if (!current.window || current.cleaned) return;
    current.cleaned = true;
    if (!current.window.isDestroyed()) current.window.destroy();
    void current.session.clearStorageData().catch(() => {}); void current.session.clearCache().catch(() => {});
  }
  function settle(current) { if (!current.settled) { current.settled = true; current.resolve(current.result ?? { status: current.submitted ? 'unknownOutcome' : 'cancelled' }); } }
  function release(current) {
    if (current.released) return;
    current.released = true; clearInterval(current.timer);
    bridge.removeListener('event', current.onEvent); bridge.removeListener('status', current.onStatus);
    current.parent?.removeListener('closed', current.onParentClosed);
    if (current.result?.status === 'unknownOutcome') unknownScopes.add(current.scopeKey);
    current.code = null; current.nonce = null; current.expected = null;
    if (active === current) active = null;
  }
  function cancelInvite(current) {
    if (current.cleanup) return current.cleanup;
    if (!current.nonce) return Promise.resolve();
    current.cancelSent = true;
    current.cleanup = (async () => {
      try {
        await read(current);
        guard(current);
        await bridge.sendValidated('pair.cancel', { nonce: current.nonce });
        guard(current);
      } catch {}
    })();
    return current.cleanup;
  }
  function closeCurrent(current, invalidated = false) {
    if (current.closed) return;
    current.closed = true; current.code = null;
    if (invalidated) current.invalid = true;
    if (!current.result) current.result = { status: current.submitted ? 'unknownOutcome' : 'cancelled' };
    cleanWindow(current); settle(current);
    if (current.operation) return;
    if (current.mode === 'invite' && current.nonce && current.phase !== 'completed') {
      current.operation = true; void cancelInvite(current).finally(() => { current.operation = false; release(current); });
    } else release(current);
  }
  function trusted(event) {
    const current = active;
    if (!current || current.closed || !current.window || current.window.isDestroyed() || !isTrustedSender(event, current.window.webContents, trustedURL)) throw new Error('配对请求来源不可信');
    try { guard(current, current.acceptSubmitted); } catch { closeCurrent(current, true); throw new Error(ERROR); }
    return current;
  }
  async function confirm(current, detail) {
    guard(current);
    const result = await dialog.showMessageBox(current.window, { type: 'warning', title: '确认设备配对', message: current.mode === 'invite' ? '是否允许持码设备加入此账号？' : '是否将本机加入配对码对应的账号？', detail: visible(detail), buttons: ['取消', current.mode === 'invite' ? '生成一次性配对码' : '加入账号'], defaultId: 0, cancelId: 0, noLink: true });
    guard(current); if (current.closed) throw new Error(ERROR);
    return result.response === 1;
  }
  async function startInvite(current) {
    const destination = relay(current.source.relay);
    const accepted = await confirm(current, `配对码最长十分钟内单次有效。任何持有码的人都可自动获得此账号的账户解密密钥（DEK），同步聊天记录及服务商凭据，没有第二次审批。请仅交给你信任的新设备。\n\n新设备还可通过账号安排智能体在已配对的执行器上工作，并管理执行器功能。智能体可按其访问权限和自动审查规则读取/修改文件、调用工具或运行程序；不保证每次都在执行器本机再次询问。\n\n生成操作可能注册本机并创建中继访问凭据。\n中继：${destination.origin}\n账号标识：${current.source.identityId}\n本机标识：${current.source.deviceId}\n\n关闭窗口仅停止显示或等待；尽力撤销不能撤回已经授予的设备访问。`);
    if (!accepted) { setPhase(current, 'ready', '尚未生成配对码。'); return; }
    await read(current); guard(current); if (current.closed) throw new Error(ERROR);
    current.submitted = true; setPhase(current, 'creating', '正在生成配对码，请勿重复操作。');
    const raw = object(await bridge.sendValidated('pair.start', {}));
    guard(current);
    current.nonce = canonicalBase64(raw.nonce, 16);
    const parsed = parsePairingString(raw.pairing_string);
    if (parsed.nonce !== current.nonce || parsed.identityId !== current.source.identityId || parsed.relay !== destination.href) throw new Error(ERROR);
    if (current.closed) { await cancelInvite(current); return; }
    current.code = parsed.code; current.expiresAt = now() + TIMEOUT; current.nextPoll = now();
    setPhase(current, 'waiting', '仅把完整配对码交给你信任的新设备。持码者可直接加入账号，无需再次批准。');
  }
  async function join(current, input) {
    const values = object(input); if (Object.keys(values).some(key => !['pairingString', 'deviceName'].includes(key))) invalid();
    const parsed = parsePairingString(values.pairingString);
    const deviceName = values.deviceName === undefined ? '' : text(values.deviceName, 128, true).trim();
    const accepted = await confirm(current, `本机将获得并持久保存该账号的账户解密密钥（DEK），同步聊天记录及服务商凭据。请确认配对码来自你自己的可信设备。\n\n若本机运行 Lorca 执行器，加入后同账号的其他设备也可安排智能体在本机工作，并管理本机的执行器功能。智能体可按其访问权限和自动审查规则读取/修改文件、调用工具或运行程序；不保证每次都在本机再次询问。\n\n中继：${parsed.origin}\n账号标识：${parsed.identityId}\n本机名称：${deviceName || '使用本机现有名称'}\n\n此请求会取代同一本地服务中其他客户端正在等待的加入请求。关闭窗口不会停止服务中的加入操作，也不会撤销已经授予的设备访问。`);
    if (!accepted) { setPhase(current, 'ready', '尚未发送加入请求。'); return; }
    await read(current); guard(current); if (current.closed) throw new Error(ERROR);
    current.expected = { identityId: parsed.identityId, relay: parsed.relay }; current.acceptSubmitted = true; current.submitted = true;
    setPhase(current, 'joining', '正在等待另一台设备处理。不要重复提交；关闭此窗口不会停止后台加入。');
    const accepting = bridge.sendValidated('pair.accept', { pairing_string: parsed.code, ...(deviceName ? { device_name: deviceName } : {}) }, { timeoutMs: ACCEPT_TIMEOUT });
    parsed.code = ''; values.pairingString = '';
    const result = object(await accepting);
    guard(current, true);
    const joined = device(result);
    if (text(result.identity_id) !== current.expected.identityId) throw new Error(ERROR);
    const source = await read(current, true);
    if (!source.hasIdentity || source.identityId !== current.expected.identityId || source.deviceId !== joined.id || !source.relay || relay(source.relay).href !== current.expected.relay) throw new Error(ERROR);
    setPhase(current, 'completed', '本机已加入账号。请检查设备列表和同步状态。', { status: 'completed', device: joined });
  }
  async function poll(current) {
    if (current.polling || current.operation || current.phase !== 'waiting' || current.closed || now() < current.nextPoll) return;
    current.polling = true; current.nextPoll = now() + 1500;
    try {
      await read(current); guard(current);
      const response = object(await bridge.sendValidated('pair.status', { nonce: current.nonce }));
      guard(current);
      if (current.closed || current.phase !== 'waiting') return;
      if (response.state === 'completed') setPhase(current, 'completed', '已登记设备并发送配对回复，请在新设备确认加入结果；同步未必完成。', { status: 'completed', device: device(response.device) });
      else if (response.state === 'failed') setPhase(current, 'unknownOutcome', '本次配对未能继续，但服务可能已经登记设备。' + UNKNOWN, { status: 'unknownOutcome' });
      else if (response.state !== 'waiting') throw new Error(ERROR);
    } catch { if (!current.closed) setPhase(current, 'unknownOutcome', UNKNOWN, { status: 'unknownOutcome' }); }
    finally { current.polling = false; }
  }
  async function submit(event, values) {
    const current = trusted(event);
    if (current.operation || current.phase !== 'ready') return { ok: false, error: '已有配对操作正在处理，请勿重复提交。' };
    if (current.mode === 'invite') { try { if (Object.keys(object(values)).length) invalid(); } catch { return { ok: false, error: '配对参数无效。' }; } }
    else { try { const input = object(values); if (Object.keys(input).some(key => !['pairingString', 'deviceName'].includes(key))) invalid(); parsePairingString(input.pairingString); if (input.deviceName !== undefined) text(input.deviceName, 128, true); } catch { return { ok: false, error: '请输入完整、有效且使用 HTTPS 中继的配对码，并检查设备名称。' }; } }
    current.operation = true; setPhase(current, 'confirming', '请核对系统确认窗口中的授权范围。');
    try { if (current.mode === 'invite') await startInvite(current); else await join(current, values); return { ok: true }; }
    catch {
      if (current.mode === 'invite' && current.nonce && current.phase !== 'completed') await cancelInvite(current);
      if (!current.closed) setPhase(current, current.submitted ? 'unknownOutcome' : 'failed', current.submitted ? UNKNOWN : ERROR, { status: current.submitted ? 'unknownOutcome' : 'failed' });
      return { ok: false, error: current.submitted ? UNKNOWN : ERROR };
    } finally { current.operation = false; if (current.closed) release(current); }
  }
  ipcMain.handle('lorca:secure-pairing-init', event => view(trusted(event)));
  ipcMain.handle('lorca:secure-pairing-submit', submit);
  ipcMain.handle('lorca:secure-pairing-close', event => { closeCurrent(trusted(event)); return null; });
  async function open(mode, trustedCaller = () => {}) {
    if (!['invite', 'join'].includes(mode)) throw new Error('配对入口无效');
    const scope = scopeKey(bridge.getStatus(), mode);
    if (unknownScopes.has(scope)) throw new Error(UNKNOWN);
    if (active) throw new Error('已有配对流程或尚未结束的加入请求，请先等待结果。');
    const current = { mode, scopeKey: scope, trusted: trustedCaller, fence: inventory.capture(), source: null, phase: 'ready', detail: '', code: null, nonce: null, expected: null, expiresAt: null, nextPoll: 0, operation: true, polling: false, submitted: false, acceptSubmitted: false, cancelSent: false, invalid: false, closed: false, released: false, settled: false, cleaned: false, window: null, parent: null, session: null, timer: null, result: null, resolve: null, onEvent: null, onStatus: null, onParentClosed: null };
    const result = new Promise(resolve => { current.resolve = resolve; }); active = current;
    current.onStatus = () => { try { guard(current, current.acceptSubmitted); } catch { closeCurrent(current, true); } };
    current.onEvent = event => {
      if (event.event === 'identity.changed' && current.acceptSubmitted) {
        if (event.data?.has_identity !== true) closeCurrent(current, true);
        else { current.transitioned = true; publish(current); }
        return;
      }
      if (event.event === 'snapshot' && current.acceptSubmitted) {
        try { const source = snapshot(event.data); if (source.hasIdentity ? source.identityId !== current.expected.identityId || !source.relay || relay(source.relay).href !== current.expected.relay : current.transitioned || !sameScope(source, current.source)) throw new Error(ERROR); if (source.hasIdentity) current.transitioned = true; }
        catch { closeCurrent(current, true); } return;
      }
      if (event.event === 'snapshot' && current.source) { try { if (!sameScope(snapshot(event.data), current.source)) throw new Error(ERROR); } catch { closeCurrent(current, true); } }
      if (event.event === 'relay.status' && current.source && event.data?.url !== current.source.relay && !current.acceptSubmitted) closeCurrent(current, true);
      if (event.event === 'identity.changed' || event.event === 'snapshot') current.onStatus();
    };
    current.onParentClosed = () => closeCurrent(current, true);
    bridge.on('event', current.onEvent); bridge.on('status', current.onStatus);
    try {
      current.source = await read(current);
      if (!capabilities({ has_identity: current.source.hasIdentity, identity_id: current.source.identityId, this_device_id: current.source.deviceId, relay_url: current.source.relay })[mode]) throw new Error(ERROR);
      if (current.closed) return result;
      current.parent = getParent(); if (!current.parent || current.parent.isDestroyed()) throw new Error(ERROR);
      current.parent.once('closed', current.onParentClosed);
      const window = new BrowserWindow({ parent: current.parent, modal: true, show: false, width: 680, height: 720, minWidth: 480, minHeight: 480, title: 'dots · 设备配对', icon: getIcon(), backgroundColor: '#f3f3ef', webPreferences: { preload: path.join(__dirname, 'secure-pairing-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: false, spellcheck: false, partition: `dots-pairing-${randomUUID()}` } });
      current.window = window; current.session = window.webContents.session;
      window.setMenuBarVisibility(false);
      const contents = window.webContents, session = current.session;
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate', 'will-attach-webview']) contents.on(event, event => event.preventDefault());
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); session.setPermissionCheckHandler(() => false);
      session.on('will-download', event => event.preventDefault());
      session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !resources.has(details.url) }));
      contents.on('render-process-gone', () => closeCurrent(current));
      window.on('closed', () => closeCurrent(current));
      window.once('ready-to-show', () => { try { guard(current); if (!current.closed) window.show(); } catch { closeCurrent(current, true); } });
      current.detail = mode === 'invite' ? '生成前需要系统确认。持码设备将获得账号访问和同步凭据。' : '配对码仅在此隔离窗口处理。只允许尚未加入账号的本机使用此入口。';
      const openedAt = now();
      current.timer = setInterval(() => {
        if (current.closed) return;
        try { guard(current, current.acceptSubmitted); } catch { closeCurrent(current, true); return; }
        if (!current.submitted && now() - openedAt >= 300_000) { closeCurrent(current); return; }
        if (current.phase === 'waiting' && now() >= current.expiresAt) { setPhase(current, 'unknownOutcome', UNKNOWN, { status: 'unknownOutcome' }); void cancelInvite(current); }
        if (current.phase === 'waiting') { publish(current); void poll(current); }
      }, 1000); current.timer.unref?.();
      void window.loadFile(page).catch(() => closeCurrent(current));
    } catch { current.result = { status: 'failed' }; closeCurrent(current, true); }
    finally { current.operation = false; if (current.closed) release(current); }
    return result;
  }
  return { open, capabilities, isActive: () => active !== null, close: () => { if (active) closeCurrent(active); } };
}
module.exports = { createPairingFlow, parsePairingString };
