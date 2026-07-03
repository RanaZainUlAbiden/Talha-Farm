const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  dbRun: (sql, params) => ipcRenderer.invoke('db-run', sql, params),
  dbGet: (sql, params) => ipcRenderer.invoke('db-get', sql, params),
  getMachineId: () => ipcRenderer.invoke('get-machine-id')
})