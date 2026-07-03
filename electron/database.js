const path = require('path')
const fs = require('fs')
const { app } = require('electron')

let db = null

// =============================================
// CREATE ALL TABLES
// =============================================
function createTables(db) {
  // ── Core ───────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS farms (farm_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_name TEXT NOT NULL, password_hash TEXT NOT NULL, business_type TEXT DEFAULT 'broiler', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`)
db.run(`CREATE TABLE IF NOT EXISTS flocks (flock_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, flock_name TEXT NOT NULL, start_date DATE NOT NULL, end_date DATE, status TEXT DEFAULT 'active', FOREIGN KEY (farm_id) REFERENCES farms(farm_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS ledgers (ledger_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, ledger_name TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS expenses (expense_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, ledger_id INTEGER, ledger_entry_id INTEGER, date DATE NOT NULL, description TEXT, amount REAL NOT NULL, bill_available TEXT DEFAULT 'No', payment_type TEXT DEFAULT 'cash', module_type TEXT DEFAULT 'broiler', FOREIGN KEY (flock_id) REFERENCES flocks(flock_id), FOREIGN KEY (ledger_id) REFERENCES ledgers(ledger_id), FOREIGN KEY (ledger_entry_id) REFERENCES ledger_entries(entry_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS ledger_entries (entry_id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, flock_id INTEGER NOT NULL, date DATE NOT NULL, description TEXT, amount REAL NOT NULL, type TEXT DEFAULT 'debit', source TEXT DEFAULT 'manual', FOREIGN KEY (ledger_id) REFERENCES ledgers(ledger_id), FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS medicine_traders (trader_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, trader_name TEXT NOT NULL, FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS medicine_entries (entry_id INTEGER PRIMARY KEY AUTOINCREMENT, trader_id INTEGER NOT NULL, flock_id INTEGER NOT NULL, date DATE NOT NULL, medicine_name TEXT NOT NULL, quantity REAL NOT NULL, price_per_unit REAL NOT NULL, total_amount REAL NOT NULL, FOREIGN KEY (trader_id) REFERENCES medicine_traders(trader_id), FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS sales (sale_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, date DATE NOT NULL, vehicle_number TEXT, broker TEXT, empty_weight REAL, load_weight REAL, bird_weight REAL, rate REAL NOT NULL, total_amount REAL NOT NULL, payment_type TEXT DEFAULT 'cash', driver_name TEXT DEFAULT '', driver_phone TEXT DEFAULT '', receipt_image TEXT, module_type TEXT DEFAULT 'broiler', FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS income (income_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, date DATE NOT NULL, description TEXT, amount REAL NOT NULL, source TEXT DEFAULT 'manual', module_type TEXT DEFAULT 'broiler', FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS flock_health (health_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, week_number INTEGER NOT NULL, total_birds INTEGER NOT NULL, mortality INTEGER DEFAULT 0, feed_used REAL DEFAULT 0, avg_weight REAL DEFAULT 0, fcr REAL DEFAULT 0, FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS balance (balance_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, date DATE NOT NULL, description TEXT, amount REAL NOT NULL, type TEXT NOT NULL, module_type TEXT DEFAULT 'broiler', FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS brokers (broker_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, broker_name TEXT NOT NULL, FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS activation (machine_id TEXT PRIMARY KEY, activation_code TEXT NOT NULL, activated_at DATETIME DEFAULT CURRENT_TIMESTAMP, is_active INTEGER DEFAULT 1);`)

  // ── Layer Module ───────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS batches (batch_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, batch_name TEXT NOT NULL, start_date DATE NOT NULL, initial_birds INTEGER NOT NULL, breed TEXT, status TEXT DEFAULT 'active', FOREIGN KEY (farm_id) REFERENCES farms(farm_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS egg_collection (collection_id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, date DATE NOT NULL, total_eggs INTEGER DEFAULT 0, broken_eggs INTEGER DEFAULT 0, small_grade INTEGER DEFAULT 0, medium_grade INTEGER DEFAULT 0, large_grade INTEGER DEFAULT 0, xl_grade INTEGER DEFAULT 0, FOREIGN KEY (batch_id) REFERENCES batches(batch_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS egg_sales (egg_sale_id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, date DATE NOT NULL, customer_name TEXT, grade TEXT, quantity INTEGER NOT NULL, rate_per_egg REAL NOT NULL, total_amount REAL NOT NULL, payment_type TEXT DEFAULT 'cash', FOREIGN KEY (batch_id) REFERENCES batches(batch_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS vaccinations (vaccination_id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, date DATE NOT NULL, vaccine_name TEXT NOT NULL, dose TEXT, notes TEXT, done INTEGER DEFAULT 0, FOREIGN KEY (batch_id) REFERENCES batches(batch_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS layer_mortality (mortality_id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, date DATE NOT NULL, count INTEGER NOT NULL, reason TEXT, FOREIGN KEY (batch_id) REFERENCES batches(batch_id));`)

  // ── Distribution Module ─────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS products (product_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, product_name TEXT NOT NULL, category TEXT, unit TEXT, current_stock REAL DEFAULT 0, min_stock_alert REAL DEFAULT 0, cost_price REAL DEFAULT 0, selling_price REAL DEFAULT 0, FOREIGN KEY (farm_id) REFERENCES farms(farm_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS customers (customer_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, customer_name TEXT NOT NULL, phone TEXT, address TEXT, outstanding_balance REAL DEFAULT 0, FOREIGN KEY (farm_id) REFERENCES farms(farm_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS suppliers (supplier_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, supplier_name TEXT NOT NULL, phone TEXT, products_supplied TEXT, FOREIGN KEY (farm_id) REFERENCES farms(farm_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS purchase_orders (purchase_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, supplier_id INTEGER, product_id INTEGER NOT NULL, date DATE NOT NULL, quantity REAL NOT NULL, cost_price REAL NOT NULL, total_amount REAL NOT NULL, payment_type TEXT DEFAULT 'cash', notes TEXT, FOREIGN KEY (farm_id) REFERENCES farms(farm_id), FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id), FOREIGN KEY (product_id) REFERENCES products(product_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS sales_orders (order_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, customer_id INTEGER, product_id INTEGER NOT NULL, date DATE NOT NULL, quantity REAL NOT NULL, selling_price REAL NOT NULL, total_amount REAL NOT NULL, payment_type TEXT DEFAULT 'cash', amount_paid REAL DEFAULT 0, notes TEXT, FOREIGN KEY (farm_id) REFERENCES farms(farm_id), FOREIGN KEY (customer_id) REFERENCES customers(customer_id), FOREIGN KEY (product_id) REFERENCES products(product_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS customer_payments (payment_id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, date DATE NOT NULL, amount REAL NOT NULL, notes TEXT, FOREIGN KEY (customer_id) REFERENCES customers(customer_id));`)
}

// =============================================
// ATTEMPT TO RECOVER DATA FROM CORRUPTED DB
// =============================================
function attemptRecovery(dbPath, oldDb, SQL) {
  const tables = ['farms', 'flocks', 'ledgers', 'expenses', 'ledger_entries', 'medicine_traders', 'medicine_entries', 'sales', 'income', 'flock_health', 'balance', 'brokers', 'activation', 'batches', 'egg_collection', 'egg_sales', 'vaccinations', 'layer_mortality', 'products', 'customers', 'suppliers', 'purchase_orders', 'sales_orders', 'customer_payments']
  
  const newDb = new SQL.Database()
  createTables(newDb)
  
  let totalRecovered = 0
  
  for (const table of tables) {
    try {
      const stmt = oldDb.prepare(`SELECT * FROM ${table}`)
      const rows = []
      while (stmt.step()) {
        rows.push(stmt.getAsObject())
      }
      stmt.free()
      
      if (rows.length > 0) {
        const columns = Object.keys(rows[0]).join(', ')
        const placeholders = Object.keys(rows[0]).map(() => '?').join(', ')
        const insertStmt = newDb.prepare(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`)
        
        for (const row of rows) {
          insertStmt.run(Object.values(row))
        }
        insertStmt.free()
        totalRecovered += rows.length
        console.log(`Recovered ${rows.length} rows from ${table}`)
      }
    } catch (tableErr) {
      console.error(`Could not recover table ${table}:`, tableErr.message)
    }
  }
  
  console.log(`Total rows recovered: ${totalRecovered}`)
  return totalRecovered > 0 ? newDb : null
}

// =============================================
// BACKUP CORRUPTED FILE AND START FRESH
// =============================================
function backupAndStartFresh(dbPath, SQL) {
  const backupPath = dbPath + '.corrupted.' + Date.now() + '.bak'
  try {
    fs.copyFileSync(dbPath, backupPath)
    console.log('Corrupted database backed up to:', backupPath)
  } catch (e) {
    console.error('Could not backup corrupted database:', e.message)
  }
  return new SQL.Database()
}

// =============================================
// MAIN INITIALIZE FUNCTION
// =============================================
async function initializeDatabase() {
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs()

  const dbPath = path.join(app.getPath('userData'), 'sng_farm.db')
  let recovered = false

  if (fs.existsSync(dbPath)) {
    try {
      const fileBuffer = fs.readFileSync(dbPath)
      db = new SQL.Database(fileBuffer)
      console.log('Database loaded successfully')
      
      try {
        const result = db.exec('PRAGMA integrity_check')
        if (result[0] && result[0].values[0][0] !== 'ok') {
          console.error('Integrity check failed, attempting recovery...')
          const recoveredDb = attemptRecovery(dbPath, db, SQL)
          if (recoveredDb) {
            db = recoveredDb
            recovered = true
          } else {
            db = backupAndStartFresh(dbPath, SQL)
          }
        }
      } catch (integrityErr) {
        console.error('Integrity check error, attempting recovery:', integrityErr.message)
        const recoveredDb = attemptRecovery(dbPath, db, SQL)
        if (recoveredDb) {
          db = recoveredDb
          recovered = true
        } else {
          db = backupAndStartFresh(dbPath, SQL)
        }
      }
      
    } catch (err) {
      console.error('Database load failed:', err.message)
      db = backupAndStartFresh(dbPath, SQL)
    }
  } else {
    db = new SQL.Database()
  }

  createTables(db)

  const alterStatements = [
    `ALTER TABLE sales ADD COLUMN payment_type TEXT DEFAULT 'cash'`,
    `ALTER TABLE expenses ADD COLUMN payment_type TEXT DEFAULT 'cash'`,
    `ALTER TABLE sales ADD COLUMN driver_name TEXT DEFAULT ''`,
    `ALTER TABLE sales ADD COLUMN driver_phone TEXT DEFAULT ''`,
    `ALTER TABLE expenses ADD COLUMN bill_available TEXT DEFAULT 'No'`,
    `ALTER TABLE ledger_entries ADD COLUMN type TEXT DEFAULT 'debit'`,
    `ALTER TABLE ledger_entries ADD COLUMN source TEXT DEFAULT 'manual'`,
    `ALTER TABLE expenses ADD COLUMN ledger_entry_id INTEGER`,
    `ALTER TABLE farms ADD COLUMN business_type TEXT DEFAULT 'broiler'`,
    `ALTER TABLE expenses ADD COLUMN module_type TEXT DEFAULT 'broiler'`,
    `ALTER TABLE sales ADD COLUMN module_type TEXT DEFAULT 'broiler'`,
    `ALTER TABLE income ADD COLUMN module_type TEXT DEFAULT 'broiler'`,
    `ALTER TABLE balance ADD COLUMN module_type TEXT DEFAULT 'broiler'`,
    `ALTER TABLE flocks ADD COLUMN end_date DATE`,
    `ALTER TABLE sales ADD COLUMN receipt_image TEXT`,
  ]
  
  for (const sql of alterStatements) {
    try { db.run(sql) } catch(e) {}
  }

  try {
    db.run(`
      UPDATE ledger_entries
      SET source = 'expense'
      WHERE entry_id IN (
        SELECT le.entry_id
        FROM ledger_entries le
        INNER JOIN expenses e ON le.ledger_id = e.ledger_id
          AND le.date = e.date
          AND le.amount = e.amount
        WHERE e.ledger_id IS NOT NULL
      )
    `)
  } catch(e) {}

  saveDatabase(dbPath)
  
  if (recovered) {
    console.log('⚠️  Database was recovered from corruption')
  }
  
  return { db, recovered }
}

// =============================================
// SAVE DATABASE
// =============================================
function saveDatabase(dbPath) {
  if (db) {
    try {
      const data = db.export()
      const buffer = Buffer.from(data)
      fs.writeFileSync(dbPath, buffer)
    } catch (err) {
      console.error('Failed to save database:', err.message)
    }
  }
}

// =============================================
// RUN QUERY (INSERT/UPDATE/DELETE)
// =============================================
function runQuery(sql, params = []) {
  try {
    db.run(sql, params)
    const dbPath = path.join(app.getPath('userData'), 'sng_farm.db')
    saveDatabase(dbPath)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// =============================================
// GET QUERY (SELECT)
// =============================================
function getQuery(sql, params = []) {
  try {
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const rows = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject())
    }
    stmt.free()
    return { success: true, data: rows }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

module.exports = { initializeDatabase, runQuery, getQuery }