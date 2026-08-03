const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const { machineIdSync } = require('node-machine-id')
const { autoUpdater } = require('electron-updater')
const { initializeDatabase, runQuery, getQuery } = require('./database')

// Windows specific optimizations
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('high-dpi-support', '1')

// Set app name for Windows
app.setAppUserModelId('com.devinfantary.poultry-farm')

let mainWindow
let isQuitting = false

async function createWindow() {
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

  const indexPath = path.join(__dirname, '../dist/Poultry-Farm/browser/index.html')
  mainWindow.loadFile(indexPath)

  mainWindow.setMenu(null)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.maximize()
    
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

// ═══════════════ LICENSE IPC HANDLERS ═══════════════

const LICENSE_SECRET = 'SNG@PoultryFarm#2024!DevInfantary';

function licenseHashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const hex = Math.abs(hash).toString(16).toUpperCase();
  return hex.padStart(8, '0');
}

function generateExpectedCode(machineId) {
  const combined = machineId + LICENSE_SECRET;
  const hash = licenseHashCode(combined);
  return `DIP-${hash.slice(0, 4)}-${hash.slice(4, 8)}`;
}

ipcMain.handle('license-get', async () => {
  const machineId = machineIdSync();
  return getQuery('SELECT * FROM activation WHERE machine_id = ?', [machineId]);
});

ipcMain.handle('license-start-trial', async (event, machineId, date) => {
  return runQuery(
    'INSERT OR REPLACE INTO activation (machine_id, activation_code, trial_start_date, last_launch_date, is_permanent, is_active) VALUES (?, ?, ?, ?, 0, 1)',
    [machineId, '', date, date]
  );
});

ipcMain.handle('license-activate', async (event, machineId, code) => {
  const expectedCode = generateExpectedCode(machineId);
  if (code.trim().toUpperCase() !== expectedCode) {
    return { success: false, error: 'Invalid activation code' };
  }
  const now = new Date().toISOString();
  return runQuery(
    'INSERT OR REPLACE INTO activation (machine_id, activation_code, trial_start_date, last_launch_date, is_permanent, is_active, activated_at) VALUES (?, ?, ?, ?, 0, 1, ?)',
    [machineId, code, now, now, now]
  );
});

ipcMain.handle('license-update-launch', async (event, machineId, date) => {
  return runQuery('UPDATE activation SET last_launch_date = ? WHERE machine_id = ?', [date, machineId]);
});

ipcMain.handle('license-status', async () => {
  const machineId = machineIdSync();
  const result = await getQuery('SELECT * FROM activation WHERE machine_id = ?', [machineId]);
  const row = result.success && result.data.length > 0 ? result.data[0] : null;

  if (!row) {
    return { 
      activated: false, 
      trialStarted: false, 
      trialExpired: false, 
      daysRemaining: 7, 
      clockTampered: false, 
      licenseDaysRemaining: 0 
    };
  }

  const now = new Date();
  const trialStart = row.trial_start_date ? new Date(row.trial_start_date) : null;
  const lastLaunch = row.last_launch_date ? new Date(row.last_launch_date) : null;
  const activatedAt = row.activated_at ? new Date(row.activated_at) : null;

  // ═══════════════ 🔒 CLOCK TAMPER DETECTION ═══════════════
  let clockTampered = false;

  if (lastLaunch) {
    const lastLaunchTime = lastLaunch.getTime();
    const nowTime = now.getTime();
    const hoursSinceLastLaunch = (nowTime - lastLaunchTime) / (1000 * 60 * 60);

    // 1️⃣ BACKWARD: System clock set to a time before last launch
    if (nowTime < lastLaunchTime) {
      clockTampered = true;
    }

    // 2️⃣ FORWARD JUMP: More than 48 hours since last launch (suspicious)
    //    Normal usage would have daily launches. A gap > 2 days suggests
    //    the user changed the system date forward.
    if (hoursSinceLastLaunch > 48) {
      clockTampered = true;
    }
  }

  // 3️⃣ FUTURE DATE CHECK: System date is more than 8 days ahead of activation/trial
  //    Even if they trickle-change the date 1 day at a time (avoiding the 48hr check),
  //    they can't go beyond 7 days from activation.
  if (!clockTampered) {
    const referenceDate = activatedAt || trialStart;
    if (referenceDate) {
      const daysSinceReference = (now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceReference > 8) {
        clockTampered = true;
      }
    }
  }

  // If clock tampered → deactivate license and lock out
  if (clockTampered) {
    await runQuery('UPDATE activation SET is_active = 0 WHERE machine_id = ?', [machineId]);
    return { 
      activated: false, 
      trialStarted: true, 
      trialExpired: true, 
      daysRemaining: 0, 
      clockTampered: true, 
      licenseDaysRemaining: 0 
    };
  }

  // ═══════════════ CHECK ACTIVATION ═══════════════
  let activated = row.is_active === 1 && row.activation_code && row.activation_code.length > 0;
  let licenseDaysRemaining = 0;

  if (activated && activatedAt) {
    const expiryDate = new Date(activatedAt);
    expiryDate.setDate(expiryDate.getDate() + 7); // 7-day license
    const diffTime = expiryDate.getTime() - now.getTime();
    licenseDaysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (licenseDaysRemaining <= 0) {
      activated = false;
      licenseDaysRemaining = 0;
      await runQuery('UPDATE activation SET is_active = 0 WHERE machine_id = ?', [machineId]);
    }
  }

  // ═══════════════ CHECK TRIAL ═══════════════
  let trialExpired = false;
  let daysRemaining = 7;
  let trialStarted = false;

  if (trialStart) {
    trialStarted = true;
    const diffTime = now.getTime() - trialStart.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    daysRemaining = 7 - diffDays;
    trialExpired = diffDays > 7;
  }

  return {
    activated,
    trialStarted,
    trialExpired,
    daysRemaining: daysRemaining > 0 ? daysRemaining : 0,
    clockTampered: false,
    licenseDaysRemaining: licenseDaysRemaining > 0 ? licenseDaysRemaining : 0
  };
});

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