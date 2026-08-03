const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  dbRun: (sql, params) => ipcRenderer.invoke('db-run', sql, params),
  dbGet: (sql, params) => ipcRenderer.invoke('db-get', sql, params),

  // System information
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),

  // License operations
  license: {
    getActivation: () => ipcRenderer.invoke('license-get'),
    startTrial: (machineId, date) => ipcRenderer.invoke('license-start-trial', machineId, date),
    activate: (machineId, code) => ipcRenderer.invoke('license-activate', machineId, code),
    updateLastLaunch: (machineId, date) => ipcRenderer.invoke('license-update-launch', machineId, date),
    getStatus: () => ipcRenderer.invoke('license-status')
  },

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