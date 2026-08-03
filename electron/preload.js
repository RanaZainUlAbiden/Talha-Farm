const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  dbRun: (sql, params) => ipcRenderer.invoke('db-run', sql, params),
  dbGet: (sql, params) => ipcRenderer.invoke('db-get', sql, params),
  
  // System information
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
  
  // Auto-updater
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update_available', () => callback())
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update_downloaded', () => callback())
  },
  restartApp: () => {
    ipcRenderer.send('restart_app')
  }
})