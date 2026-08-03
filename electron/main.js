const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const { machineIdSync } = require('node-machine-id')
const { autoUpdater } = require('electron-updater')
const { initializeDatabase, runQuery, getQuery } = require('./database')

// Windows specific optimizations
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('high-dpi-support', '1')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

// Set app name for Windows
app.setAppUserModelId('com.devinfantary.poultry-farm')

let mainWindow
let isQuitting = false

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
    icon: path.join(__dirname, '../public/favicon.ico'),
    frame: true,
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    title: 'Talha Protein Farm'
  })

  // Load the Angular app
  const indexPath = path.join(__dirname, '../dist/Poultry-Farm/browser/index.html')
  mainWindow.loadFile(indexPath)

  // Remove default menu
  mainWindow.setMenu(null)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.maximize()
    
    // Check for updates in production
    if (process.env.NODE_ENV === 'production') {
      autoUpdater.checkForUpdatesAndNotify()
    }
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Yes', 'No'],
        title: 'Confirm',
        message: 'Are you sure you want to quit?'
      }).then((result) => {
        if (result.response === 0) {
          isQuitting = true
          app.quit()
        }
      })
    }
    return false
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// ── APP EVENTS ──────────────────────────────────────────────

app.on('renderer-process-crashed', (event, webContents, killed) => {
  console.error('Renderer process crashed:', killed)
  if (mainWindow) {
    dialog.showErrorBox(
      'Application Error',
      'The application encountered an error and will restart.'
    )
    mainWindow.reload()
  }
})

app.on('gpu-process-crashed', (event, killed) => {
  console.error('GPU process crashed:', killed)
})

// ── IPC HANDLERS ────────────────────────────────────────────

ipcMain.handle('db-run', async (event, sql, params) => {
  return runQuery(sql, params)
})

ipcMain.handle('db-get', async (event, sql, params) => {
  return getQuery(sql, params)
})

ipcMain.handle('get-machine-id', async () => {
  return machineIdSync()
})

// ── AUTO UPDATER ────────────────────────────────────────────

autoUpdater.on('update-available', () => {
  if (mainWindow) {
    mainWindow.webContents.send('update_available')
  }
})

autoUpdater.on('update-downloaded', () => {
  if (mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: 'A new version has been downloaded. Restart the application to install the update.',
      buttons: ['Restart Now', 'Later']
    }).then((result) => {
      if (result.response === 0) {
        isQuitting = true
        autoUpdater.quitAndInstall()
      }
    })
  }
})

autoUpdater.on('error', (err) => {
  console.error('Update error:', err)
})

ipcMain.on('restart_app', () => {
  isQuitting = true
  autoUpdater.quitAndInstall()
})

// ── SINGLE INSTANCE ────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(createWindow)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      isQuitting = true
      app.quit()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}