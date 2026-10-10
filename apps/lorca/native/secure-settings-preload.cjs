const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dotsSecureSettings', Object.freeze({
  initialize: () => ipcRenderer.invoke('lorca:secure-settings-init'),
  submit: values => ipcRenderer.invoke('lorca:secure-settings-submit', values),
  cancel: () => ipcRenderer.invoke('lorca:secure-settings-cancel'),
}));
