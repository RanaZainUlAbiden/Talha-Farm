const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const { machineIdSync } = require('node-machine-id')
const { initializeDatabase, runQuery, getQuery } = require('./database')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-gpu')

let mainWindow

async function createWindow() {
  // ✅ SAFE: Wrap database init with error handling
  let dbResult;
  try {
    dbResult = await initializeDatabase()
  } catch (err) {
    console.error('FATAL: Database initialization failed:', err)
    dialog.showErrorBox(
      'Application Error',
      'Failed to start the application.\n\n' +
      'Please try these steps:\n' +
      '1. Restart your computer\n' +
      '2. If the problem persists, contact support\n\n' +
      'Error details: ' + err.message
    )
    app.quit()
    return
  }

  // ✅ If database was recovered, notify user
  if (dbResult && dbResult.recovered) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Data Recovery Notice',
      message: 'The application detected and recovered your data from a corrupted database.\n\nPlease verify that all your records are correct.\n\nA backup of the original corrupted file has been saved for safety.',
      buttons: ['OK']
    })
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#f0f4f8',
    show: false,
    icon: path.join(__dirname, '../public/favicon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
      sandbox: false
    },
    title: 'Talha Protein Farm'
  })

  const indexPath = path.join(__dirname, '../dist/Poultry-Farm/browser/index.html')
  mainWindow.loadFile(indexPath)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('renderer-process-crashed', (event, webContents, killed) => {
  console.error('Renderer process crashed:', killed)
  if (mainWindow) {
    mainWindow.reload()
  }
})

app.on('gpu-process-crashed', (event, killed) => {
  console.error('GPU process crashed:', killed)
})

ipcMain.handle('db-run', async (event, sql, params) => {
  return runQuery(sql, params)
})

ipcMain.handle('db-get', async (event, sql, params) => {
  return getQuery(sql, params)
})

ipcMain.handle('get-machine-id', async () => {
  return machineIdSync()
})

app.on('browser-window-focus', () => {
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(`
      document.querySelectorAll('.inline-input').forEach(el => {
        el.disabled = false;
        el.style.pointerEvents = 'auto';
      });
    `).catch(() => {})
  }
})

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(createWindow)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}