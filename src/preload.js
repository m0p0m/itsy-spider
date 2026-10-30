const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('itsy', {
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, p) => cb(p)),
  onWindows: (cb) => ipcRenderer.on('windows', (_e, list) => cb(list)),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  onCommand: (cb) => ipcRenderer.on('command', (_e, c) => cb(c)),
  setTrapped: (value) => ipcRenderer.send('trap', !!value),
  beat: () => ipcRenderer.send('beat'),
});
