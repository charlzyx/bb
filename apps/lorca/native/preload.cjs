const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch (error) {
    let message = typeof error?.message === 'string' ? error.message : '本地请求失败，请重试';
    const prefix = `Error invoking remote method '${channel}': `;
    if (message.startsWith(prefix)) message = message.slice(prefix.length);
    if (message.startsWith('Error: ')) message = message.slice(7);
    throw new Error(message);
  }
};
const subscribe = (channel, listener) => {
  if (typeof listener !== 'function') throw new TypeError('必须提供监听函数');
  const handler = (_event, value) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld('lorca', Object.freeze({
  connect: endpoint => invoke('lorca:connect', endpoint),
  request: (method, params) => invoke('lorca:request', method, params),
  copyText: text => invoke('lorca:copy-text', text),
  getStatus: () => invoke('lorca:status'),
  getSettings: (params = {}) => invoke('lorca:get-settings', params),
  settingsAction: action => invoke('lorca:settings-action', action),
  onEvent: listener => subscribe('lorca:event', listener),
  onStatus: listener => subscribe('lorca:status-update', listener),
  pickAttachments: () => invoke('lorca:pick-attachments'),
  sendAttachments: params => invoke('lorca:send-attachments', params),
}));
