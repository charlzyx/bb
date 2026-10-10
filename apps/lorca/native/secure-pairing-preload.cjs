const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dotsPairing', Object.freeze({
  initialize: () => ipcRenderer.invoke('lorca:secure-pairing-init'),
  submit: values => ipcRenderer.invoke('lorca:secure-pairing-submit', values),
  close: () => ipcRenderer.invoke('lorca:secure-pairing-close'),
  onState: listener => {
    if (typeof listener !== 'function') throw new TypeError('必须提供监听函数');
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('lorca:secure-pairing-state', handler);
    return () => ipcRenderer.removeListener('lorca:secure-pairing-state', handler);
  },
}));
