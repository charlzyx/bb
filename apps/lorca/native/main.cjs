const { app, BrowserWindow, ipcMain, dialog, clipboard, Menu, nativeImage } = require('electron');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { LorcaBridge, isTrustedSender, validateCopyText } = require('./bridge.cjs');
const { AttachmentSelections } = require('./attachments.cjs');
const { BotAvatars } = require('./bot-avatars.cjs');
const { WatchingChat } = require('./watching.cjs');
const { applicationMenuTemplate } = require('./menu.cjs');
const { APP_NAME, configureApplicationName, configureApplicationBranding } = require('./branding.cjs');
const { SettingsInventory, sanitizeRendererEvent, sanitizeRendererResult, safeRendererError } = require('./settings.cjs');
const { SettingsEditor } = require('./settings-editor.cjs');
const { createSecureSettingsEditor } = require('./secure-settings.cjs');
const { createPairingFlow } = require('./pairing.cjs');

configureApplicationName(app);
const distDirectory = path.resolve(__dirname, '../dist');
const indexPath = path.join(distDirectory, 'index.html');
const devURL = process.env.LORCA_DEV_URL;
if (devURL && !/^http:\/\/127\.0\.0\.1:5178\/$/.test(devURL)) throw new Error('LORCA_DEV_URL 必须为 http://127.0.0.1:5178/');
const trustedURL = devURL || pathToFileURL(indexPath).href;
const bridge = new LorcaBridge({ endpoint: process.env.LORCA_ENDPOINT ?? `ws://127.0.0.1:${process.env.LORCA_PORT ?? '4862'}/ws` });
const selections = new AttachmentSelections();
const settings = new SettingsInventory(bridge);
const avatars = new BotAvatars(bridge, nativeImage);
const watching = new WatchingChat(bridge);
let pendingRoster = null;
let pairingCapabilities = { invite: false, join: false };
let observedGeneration = bridge.getStatus().generation;
settings.onSnapshot = snapshot => {
  pairingCapabilities = pairing.capabilities(snapshot);
  avatars.observeSnapshot(snapshot);
  watching.observeSnapshot(snapshot);
  if (pendingRoster) {
    const generation = bridge.getStatus().generation, epoch = avatars.epoch, scope = avatars.identity;
    queueMicrotask(() => {
      if (!pendingRoster || bridge.getStatus().generation !== generation || avatars.epoch !== epoch || avatars.identity !== scope) return;
      const roster = pendingRoster; pendingRoster = null;
      avatars.observeBots(roster.data.bots);
      watching.observeChats(roster.data.chats);
      send('lorca:event', sanitizeRendererEvent(roster, scope));
    });
  }
};
let window = null;
let applicationIcon;
let choosing = false;
const secureSettings = createSecureSettingsEditor({ BrowserWindow, ipcMain, bridge, getParent: () => window, getIcon: () => applicationIcon });
const pairing = createPairingFlow({ BrowserWindow, ipcMain, dialog, bridge, inventory: settings, getParent: () => window, getIcon: () => applicationIcon });
settings.editor = new SettingsEditor(bridge, settings, {
  openSecureEditor: secureSettings.edit,
  confirm: async (spec, guard) => {
    guard();
    const needsReview = spec.detail.length > 2500;
    if (needsReview) {
      const reviewed = await secureSettings.edit({ title: '复核设置变更', description: spec.message, review: true, fields: [{ key: 'review', label: '完整变更范围', type: 'review', value: spec.detail }] }, guard, input => {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 0) throw new Error('复核参数无效');
        return true;
      });
      guard(); if (reviewed !== true) return false;
    }
    const result = await dialog.showMessageBox(window, { type: 'warning', title: spec.title, message: spec.message, detail: needsReview ? '完整变更已在隔离复核窗口展示。应用后将修改该账号或执行器的配置；不会自动重发失败的操作。' : spec.detail, buttons: ['取消', '应用变更'], defaultId: 0, cancelId: 0, noLink: true });
    guard(); return result.response === 1;
  },
});
function ensureSender(event) {
  if (!window || window.isDestroyed() || !isTrustedSender(event, window.webContents, trustedURL)) throw new Error('Lorca 请求来源不可信');
}
function send(channel, value) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, value);
}
function updateForeground() {
  watching.setForeground(Boolean(window && !window.isDestroyed() && window.isFocused() && window.isVisible() && !window.isMinimized()));
}
bridge.on('event', value => {
  if (value.event === 'identity.changed') { selections.clear(); pendingRoster = null; }
  try {
    const projected = sanitizeRendererEvent(value, settings.identity ?? '');
    if (value.event === 'roster.changed') {
      if (avatars.identity === undefined) { pendingRoster = value; return; }
      pendingRoster = null;
      watching.observeChats(projected.data.chats);
    }
    if (value.event === 'chat.removed') watching.removeChat(projected.data.chat_id);
    if (projected) send('lorca:event', projected);
  } catch {
    bridge.close();
    send('lorca:status-update', { ...bridge.getStatus(), status: 'error', detail: 'Lorca 响应不兼容，请重新连接后重试' });
  }
});
bridge.on('status', value => {
  if (value.status !== 'connected' || value.generation !== observedGeneration) { selections.clear(); pendingRoster = null; }
  observedGeneration = value.generation;
  send('lorca:status-update', value);
});
ipcMain.handle('lorca:connect', async (event, endpoint) => { ensureSender(event); return bridge.connect(endpoint); });
ipcMain.handle('lorca:set-watching-chat', (event, chatId) => { ensureSender(event); updateForeground(); watching.select(chatId); return null; });
ipcMain.handle('lorca:bot-avatar', (event, botId, expectedAvatarVersion) => {
  ensureSender(event);
  const fence = settings.capture();
  return avatars.get(botId, expectedAvatarVersion, () => { ensureSender(event); settings.check(fence); });
});
ipcMain.handle('lorca:copy-text', (event, text) => { ensureSender(event); clipboard.writeText(validateCopyText(text)); return null; });
ipcMain.handle('lorca:status', event => { ensureSender(event); return bridge.getStatus(); });
ipcMain.handle('lorca:get-settings', async (event, params = {}) => {
  ensureSender(event);
  const fence = settings.capture();
  const result = await settings.get(params);
  ensureSender(event);
  settings.check(fence);
  return { ...result, pairingCapabilities };
});
ipcMain.handle('lorca:open-pairing', async (event, mode) => {
  ensureSender(event);
  if (settings.editor.busy) throw new Error('请先关闭当前设置流程。');
  try { return await pairing.open(mode, () => ensureSender(event)); }
  catch { throw new Error('无法打开设备配对，请检查本地令牌连接并刷新设备列表。'); }
});
ipcMain.handle('lorca:settings-action', async (event, action) => {
  ensureSender(event);
  if (pairing.isActive()) throw new Error('设备配对仍在处理，请先核对其结果。');
  return settings.editor.apply(action, () => ensureSender(event));
});
ipcMain.handle('lorca:request', async (event, method, params) => {
  ensureSender(event);
  const fence = settings.capture();
  try {
    const result = await bridge.request(method, params);
    ensureSender(event);
    const projected = settings.projectResult(method, result, fence);
    if (method === 'chats.create') watching.observeCreated(projected.chat);
    return projected;
  } catch (error) { throw safeRendererError(error); }
});
ipcMain.handle('lorca:pick-attachments', async event => {
  ensureSender(event);
  if (choosing) throw new Error('已有一个文件选择窗口打开');
  choosing = true;
  const generation = bridge.getStatus().generation;
  const selectionEpoch = selections.epoch;
  try {
    const result = await dialog.showOpenDialog(window, { title: '向 dots 添加附件', buttonLabel: '添加附件', properties: ['openFile', 'multiSelections'] });
    ensureSender(event);
    if (bridge.getStatus().generation !== generation || selections.epoch !== selectionEpoch) throw new Error('Lorca 连接已变化，请重新选择文件');
    return result.canceled ? [] : await selections.add(result.filePaths);
  } catch (error) { throw safeRendererError(error); } finally { choosing = false; }
});
ipcMain.handle('lorca:release-attachments', (event, ids) => { ensureSender(event); selections.release(ids); return null; });
ipcMain.handle('lorca:send-attachments', async (event, params) => {
  ensureSender(event);
  const fence = settings.capture();
  try {
    const result = await selections.send(bridge, params);
    ensureSender(event);
    settings.check(fence);
    return sanitizeRendererResult('chats.send', result);
  } catch (error) { throw safeRendererError(error); }
});

function createWindow() {
  window = new BrowserWindow({
    width: 1240, height: 820, minWidth: 760, minHeight: 520, title: APP_NAME, icon: applicationIcon, backgroundColor: '#faf9f6',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, partition: 'bb-lorca' },
  });
  window.setMenuBarVisibility(false);
  for (const event of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore']) window.on(event, updateForeground);
  updateForeground();
  const contents = window.webContents;
  contents.on('render-process-gone', () => { watching.select(null); watching.setForeground(false); selections.clear(); bridge.close(); });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-redirect', event => event.preventDefault());
  contents.on('will-frame-navigate', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.on('will-download', event => event.preventDefault());
  contents.session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const url = new URL(details.url);
      if (devURL && (url.origin === new URL(devURL).origin || (url.protocol === 'ws:' && url.hostname === '127.0.0.1' && url.port === '5178'))) allowed = true;
      else if (url.protocol === 'file:') {
        const relative = path.relative(distDirectory, fileURLToPath(url));
        allowed = relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
      } else if (url.protocol === 'data:' || url.protocol === 'blob:') allowed = true;
    } catch {}
    callback({ cancel: !allowed });
  });
  contents.session.webRequest.onHeadersReceived((details, callback) => {
    const connect = devURL ? 'http://127.0.0.1:5178 ws://127.0.0.1:5178' : "'none'";
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src ${connect}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`] } });
  });
  window.on('closed', () => { window = null; watching.setForeground(false); watching.select(null); selections.clear(); bridge.close(); });
  if (devURL) void window.loadURL(devURL); else void window.loadFile(indexPath);
}
app.whenReady().then(() => {
  applicationIcon = configureApplicationBranding(app, nativeImage);
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate()));
  createWindow();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', () => { watching.dispose(); avatars.dispose(); secureSettings.close(); pairing.close(); bridge.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
