const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel, listener) => {
  if (typeof listener !== 'function') throw new TypeError('A listener function is required');
  const handler = (_event, value) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld('lorca', Object.freeze({
  connect: endpoint => ipcRenderer.invoke('lorca:connect', endpoint),
  request: (method, params) => ipcRenderer.invoke('lorca:request', method, params),
  copyText: text => ipcRenderer.invoke('lorca:copy-text', text),
  getStatus: () => ipcRenderer.invoke('lorca:status'),
  onEvent: listener => subscribe('lorca:event', listener),
  onStatus: listener => subscribe('lorca:status-update', listener),
  pickAttachments: () => ipcRenderer.invoke('lorca:pick-attachments'),
  sendAttachments: params => ipcRenderer.invoke('lorca:send-attachments', params),
}));
