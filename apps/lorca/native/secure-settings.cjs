const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { isTrustedSender } = require('./bridge.cjs');
const { rasterHeader } = require('./bot-avatars.cjs');

function validateSecurePreview(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !['dataUrl', 'width', 'height', 'alt'].includes(key))) throw new Error('头像预览无效');
  if (typeof value.dataUrl !== 'string' || value.dataUrl.length > 2_800_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.dataUrl)) throw new Error('头像预览无效');
  const encoded = value.dataUrl.slice('data:image/png;base64,'.length), bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== encoded) throw new Error('头像预览无效');
  const header = rasterHeader(bytes);
  if (header.mime !== 'image/png' || header.width !== header.height || header.width > 512 || value.width !== header.width || value.height !== header.height || typeof value.alt !== 'string' || value.alt.length > 256) throw new Error('头像预览无效');
  return { dataUrl: value.dataUrl, width: header.width, height: header.height, alt: value.alt };
}

function createSecureSettingsEditor({ BrowserWindow, ipcMain, bridge, getParent, getIcon }) {
  const page = path.join(__dirname, 'secure-editor.html');
  const trustedURL = pathToFileURL(page).href;
  const resources = new Set(['secure-editor.html', 'secure-editor.js', 'secure-editor.css'].map(name => pathToFileURL(path.join(__dirname, name)).href));
  resources.add(pathToFileURL(path.join(__dirname, '..', 'public', 'app-icon', '64.png')).href);
  let active = null;
  const trusted = event => {
    if (!active || active.window.isDestroyed() || !isTrustedSender(event, active.window.webContents, trustedURL)) throw new Error('安全设置请求来源不可信');
    try { active.guard(); } catch { finish(active, null, true); throw new Error('Lorca 账号或连接已变化，请刷新后再继续'); }
    return active;
  };
  const finish = (current, value, error) => {
    if (current.settled) return;
    current.settled = true;
    clearInterval(current.timer);
    bridge.removeListener('event', current.invalidate); bridge.removeListener('status', current.invalidate);
    current.parent.removeListener('closed', current.parentClosed);
    if (active === current) active = null;
    if (!current.window.isDestroyed()) current.window.destroy();
    void current.session.clearStorageData().catch(() => {});
    void current.session.clearCache().catch(() => {});
    if (error) current.reject(new Error('Lorca 账号或连接已变化，请刷新后再继续')); else current.resolve(value);
    current.spec = null; current.previewUrl = null; current.validate = null;
  };
  ipcMain.handle('lorca:secure-settings-init', event => trusted(event).spec);
  ipcMain.handle('lorca:secure-settings-cancel', event => { const current = trusted(event); finish(current, null); return null; });
  ipcMain.handle('lorca:secure-settings-submit', (event, value) => {
    const current = trusted(event);
    try { const result = current.validate(value); current.guard(); finish(current, result); return { ok: true }; }
    catch { return { ok: false, error: '填写内容无效：请检查具体连接地址、必填字段和 JSON 格式。未发送任何变更。' }; }
  });
  const edit = (spec, guard, validate) => new Promise((resolve, reject) => {
    if (active) { reject(new Error('已有安全设置窗口打开')); return; }
    let preview;
    try { guard(); preview = spec.preview === undefined ? null : validateSecurePreview(spec.preview); } catch (error) { reject(error); return; }
    const parent = getParent();
    if (!parent || parent.isDestroyed()) { reject(new Error('设置窗口已关闭')); return; }
    const window = new BrowserWindow({
      parent, modal: true, show: false, width: 720, height: 760, minWidth: 520, minHeight: 480,
      title: 'dots · 安全设置', icon: getIcon(), backgroundColor: '#f3f3ef',
      webPreferences: { preload: path.join(__dirname, 'secure-settings-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: false, spellcheck: false, partition: `dots-settings-${randomUUID()}` },
    });
    window.setMenuBarVisibility(false);
    const session = window.webContents.session;
    const current = { window, session, parent, spec: { ...spec, ...(preview ? { preview } : {}) }, previewUrl: preview?.dataUrl, guard, validate, resolve, reject, settled: false, invalidate: null, parentClosed: null, timer: null };
    current.invalidate = () => { try { guard(); } catch { finish(current, null, true); } };
    current.parentClosed = () => finish(current, null, true);
    current.timer = setInterval(current.invalidate, 1000); current.timer.unref?.();
    active = current;
    bridge.on('event', current.invalidate); bridge.on('status', current.invalidate); parent.once('closed', current.parentClosed);
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate', 'will-attach-webview']) contents.on(event, event => event.preventDefault());
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.on('will-download', event => event.preventDefault());
    session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !resources.has(details.url) && !(active === current && !current.settled && details.url === current.previewUrl) }));
    contents.on('render-process-gone', () => finish(current, null, true));
    window.on('closed', () => { try { guard(); finish(current, null); } catch { finish(current, null, true); } });
    window.once('ready-to-show', () => { current.invalidate(); if (!current.settled) window.show(); });
    void window.loadFile(page).catch(() => finish(current, null, true));
  });
  return { edit, close: () => { if (active) finish(active, null, true); } };
}
module.exports = { createSecureSettingsEditor, validateSecurePreview };
