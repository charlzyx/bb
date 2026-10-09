const { app, BrowserWindow, ipcMain, dialog, clipboard, Menu, nativeImage } = require('electron');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { LorcaBridge, isTrustedSender, validateCopyText } = require('./bridge.cjs');
const { AttachmentSelections } = require('./attachments.cjs');
const { applicationMenuTemplate } = require('./menu.cjs');
const { APP_NAME, configureApplicationName, configureApplicationBranding } = require('./branding.cjs');
const { SettingsInventory, sanitizeRendererEvent, sanitizeRendererResult, safeRendererError } = require('./settings.cjs');

configureApplicationName(app);
const distDirectory = path.resolve(__dirname, '../dist');
const indexPath = path.join(distDirectory, 'index.html');
const devURL = process.env.LORCA_DEV_URL;
if (devURL && !/^http:\/\/127\.0\.0\.1:5178\/$/.test(devURL)) throw new Error('LORCA_DEV_URL 必须为 http://127.0.0.1:5178/');
const trustedURL = devURL || pathToFileURL(indexPath).href;
const bridge = new LorcaBridge({ endpoint: process.env.LORCA_ENDPOINT ?? `ws://127.0.0.1:${process.env.LORCA_PORT ?? '4862'}/ws` });
const selections = new AttachmentSelections();
const settings = new SettingsInventory(bridge);
let window = null;
let applicationIcon;
let choosing = false;
function ensureSender(event) {
  if (!window || window.isDestroyed() || !isTrustedSender(event, window.webContents, trustedURL)) throw new Error('Lorca 请求来源不可信');
}
function send(channel, value) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, value);
}
bridge.on('event', value => {
  if (value.event === 'identity.changed') selections.clear();
  try {
    const projected = sanitizeRendererEvent(value);
    if (projected) send('lorca:event', projected);
  } catch {
    bridge.close();
    send('lorca:status-update', { ...bridge.getStatus(), status: 'error', detail: 'Lorca 响应不兼容，请重新连接后重试' });
  }
});
bridge.on('status', value => {
  if (value.status !== 'connected') selections.clear();
  send('lorca:status-update', value);
});
ipcMain.handle('lorca:connect', async (event, endpoint) => { ensureSender(event); selections.clear(); return bridge.connect(endpoint); });
ipcMain.handle('lorca:copy-text', (event, text) => { ensureSender(event); clipboard.writeText(validateCopyText(text)); return null; });
ipcMain.handle('lorca:status', event => { ensureSender(event); return bridge.getStatus(); });
ipcMain.handle('lorca:get-settings', async (event, params = {}) => {
  ensureSender(event);
  const fence = settings.capture();
  const result = await settings.get(params);
  ensureSender(event);
  settings.check(fence);
  return result;
});
ipcMain.handle('lorca:request', async (event, method, params) => {
  ensureSender(event);
  const fence = settings.capture();
  try {
    const result = await bridge.request(method, params);
    ensureSender(event);
    return settings.projectResult(method, result, fence);
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
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, partition: 'bb-lorca' },
  });
  window.setMenuBarVisibility(false);
  const contents = window.webContents;
  contents.on('render-process-gone', () => { selections.clear(); bridge.close(); });
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
  window.on('closed', () => { window = null; selections.clear(); bridge.close(); });
  if (devURL) void window.loadURL(devURL); else void window.loadFile(indexPath);
}
app.whenReady().then(() => {
  applicationIcon = configureApplicationBranding(app, nativeImage);
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate()));
  createWindow();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', () => bridge.close());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
