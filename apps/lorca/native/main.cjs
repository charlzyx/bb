const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { LorcaBridge, isTrustedSender, validateCopyText } = require('./bridge.cjs');
const { AttachmentSelections } = require('./attachments.cjs');

const distDirectory = path.resolve(__dirname, '../dist');
const indexPath = path.join(distDirectory, 'index.html');
const devURL = process.env.LORCA_DEV_URL;
if (devURL && !/^http:\/\/127\.0\.0\.1:5178\/$/.test(devURL)) throw new Error('LORCA_DEV_URL must be http://127.0.0.1:5178/');
const trustedURL = devURL || pathToFileURL(indexPath).href;
const bridge = new LorcaBridge({ endpoint: process.env.LORCA_ENDPOINT ?? `ws://127.0.0.1:${process.env.LORCA_PORT ?? '4862'}/ws` });
const selections = new AttachmentSelections();
let window = null;
let choosing = false;
function ensureSender(event) {
  if (!window || window.isDestroyed() || !isTrustedSender(event, window.webContents, trustedURL)) throw new Error('Untrusted Lorca request');
}
function send(channel, value) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, value);
}
bridge.on('event', value => {
  if (value.event === 'identity.changed') selections.clear();
  send('lorca:event', value);
});
bridge.on('status', value => {
  if (value.status !== 'connected') selections.clear();
  send('lorca:status-update', value);
});
ipcMain.handle('lorca:connect', async (event, endpoint) => { ensureSender(event); selections.clear(); return bridge.connect(endpoint); });
ipcMain.handle('lorca:copy-text', (event, text) => { ensureSender(event); clipboard.writeText(validateCopyText(text)); return null; });
ipcMain.handle('lorca:status', event => { ensureSender(event); return bridge.getStatus(); });
ipcMain.handle('lorca:request', (event, method, params) => { ensureSender(event); return bridge.request(method, params); });
ipcMain.handle('lorca:pick-attachments', async event => {
  ensureSender(event);
  if (choosing) throw new Error('A file picker is already open');
  choosing = true;
  const generation = bridge.getStatus().generation;
  const selectionEpoch = selections.epoch;
  try {
    const result = await dialog.showOpenDialog(window, { title: 'Attach files to Lorca', properties: ['openFile', 'multiSelections'] });
    ensureSender(event);
    if (bridge.getStatus().generation !== generation || selections.epoch !== selectionEpoch) throw new Error('The Lorca connection changed. Choose your files again.');
    return result.canceled ? [] : await selections.add(result.filePaths);
  } finally { choosing = false; }
});
ipcMain.handle('lorca:send-attachments', (event, params) => { ensureSender(event); return selections.send(bridge, params); });

function createWindow() {
  window = new BrowserWindow({
    width: 1240, height: 820, minWidth: 760, minHeight: 520, title: 'BB · Lorca', backgroundColor: '#faf9f6',
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
app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', () => bridge.close());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
