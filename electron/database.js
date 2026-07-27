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
  db.run(`CREATE TABLE IF NOT EXISTS customers (customer_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, customer_name TEXT NOT NULL, phone TEXT, address TEXT, outstanding_balance REAL DEFAULT 0, bank_id INTEGER, FOREIGN KEY (farm_id) REFERENCES farms(farm_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS suppliers (supplier_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, supplier_name TEXT NOT NULL, phone TEXT, products_supplied TEXT, FOREIGN KEY (farm_id) REFERENCES farms(farm_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS purchase_orders (purchase_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, supplier_id INTEGER, product_id INTEGER NOT NULL, date DATE NOT NULL, quantity REAL NOT NULL, cost_price REAL NOT NULL, total_amount REAL NOT NULL, payment_type TEXT DEFAULT 'cash', notes TEXT, FOREIGN KEY (farm_id) REFERENCES farms(farm_id), FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id), FOREIGN KEY (product_id) REFERENCES products(product_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS sales_orders (order_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, customer_id INTEGER, product_id INTEGER NOT NULL, date DATE NOT NULL, quantity REAL NOT NULL, selling_price REAL NOT NULL, total_amount REAL NOT NULL, payment_type TEXT DEFAULT 'cash', amount_paid REAL DEFAULT 0, notes TEXT, FOREIGN KEY (farm_id) REFERENCES farms(farm_id), FOREIGN KEY (customer_id) REFERENCES customers(customer_id), FOREIGN KEY (product_id) REFERENCES products(product_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS customer_payments (payment_id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, date DATE NOT NULL, amount REAL NOT NULL, notes TEXT, FOREIGN KEY (customer_id) REFERENCES customers(customer_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS bills (bill_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, bill_number TEXT NOT NULL, customer_id INTEGER, customer_name TEXT, bill_date DATE NOT NULL, subtotal REAL NOT NULL, total_amount REAL NOT NULL, amount_paid REAL NOT NULL, payment_type TEXT DEFAULT 'cash', status TEXT DEFAULT 'completed', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (farm_id) REFERENCES farms(farm_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS bill_items (item_id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id INTEGER NOT NULL, product_id INTEGER, product_name TEXT NOT NULL, quantity REAL NOT NULL, unit_price REAL NOT NULL, total_price REAL NOT NULL, FOREIGN KEY (bill_id) REFERENCES bills(bill_id) ON DELETE CASCADE);`)

  // ── Distribution Batch Module ──────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS product_batches (
    batch_id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    farm_id INTEGER NOT NULL,
    batch_code TEXT NOT NULL,
    manufacturing_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    purchase_price REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (farm_id) REFERENCES farms(farm_id)
  );`)

  db.run(`CREATE TABLE IF NOT EXISTS batch_transactions (
    transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    quantity REAL NOT NULL,
    transaction_date DATE NOT NULL,
    reference_id INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES product_batches(batch_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id)
  );`)

  // ── Account Ledger Module ──────────────────────────────────

  // Customer Ledger
  db.run(`CREATE TABLE IF NOT EXISTS customer_ledger (
    ledger_id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    transaction_date DATE NOT NULL,
    description TEXT,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    reference_type TEXT,
    reference_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE
  );`)

  // Supplier Ledger
  db.run(`CREATE TABLE IF NOT EXISTS supplier_ledger (
    ledger_id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL,
    transaction_date DATE NOT NULL,
    description TEXT,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    reference_type TEXT,
    reference_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE CASCADE
  );`)

  // Bank Accounts - 🔥 FIX: Added customer_id column
  db.run(`CREATE TABLE IF NOT EXISTS bank_accounts (
    bank_id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    customer_id INTEGER,
    bank_name TEXT NOT NULL,
    account_number TEXT,
    account_holder TEXT,
    opening_balance REAL DEFAULT 0,
    current_balance REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (farm_id) REFERENCES farms(farm_id),
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
  );`)

  // Bank Ledger
  db.run(`CREATE TABLE IF NOT EXISTS bank_ledger (
    ledger_id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_id INTEGER NOT NULL,
    transaction_date DATE NOT NULL,
    description TEXT,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    reference_type TEXT,
    reference_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bank_id) REFERENCES bank_accounts(bank_id) ON DELETE CASCADE
  );`)

  // Indexes for performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer ON customer_ledger(customer_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_customer_ledger_date ON customer_ledger(transaction_date);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier ON supplier_ledger(supplier_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_supplier_ledger_date ON supplier_ledger(transaction_date);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_bank_ledger_bank ON bank_ledger(bank_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_bank_ledger_date ON bank_ledger(transaction_date);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_customers_bank ON customers(bank_id);`)

  // Add indexes for performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_batches_product ON product_batches(product_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_batches_expiry ON product_batches(expiry_date);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_batches_status ON product_batches(status);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_batch ON batch_transactions(batch_id);`)
}

// =============================================
// ATTEMPT TO RECOVER DATA FROM CORRUPTED DB
// =============================================
function attemptRecovery(dbPath, oldDb, SQL) {
  const tables = ['farms', 'flocks', 'ledgers', 'expenses', 'ledger_entries', 'medicine_traders', 'medicine_entries', 'sales', 'income', 'flock_health', 'balance', 'brokers', 'activation', 'batches', 'egg_collection', 'egg_sales', 'vaccinations', 'layer_mortality', 'products', 'customers', 'suppliers', 'purchase_orders', 'sales_orders', 'customer_payments', 'product_batches', 'batch_transactions', 'customer_ledger', 'supplier_ledger', 'bank_accounts', 'bank_ledger']
  
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
    `ALTER TABLE bills ADD COLUMN status TEXT DEFAULT 'completed'`,
    `ALTER TABLE customers ADD COLUMN bank_id INTEGER`,
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
// RUN QUERY (INSERT/UPDATE/DELETE) - FIXED
// =============================================
const PRIMARY_KEY_MAP = {
  purchase_orders: 'purchase_id',
  sales_orders: 'order_id',
  product_batches: 'batch_id',
  batch_transactions: 'transaction_id',
  customer_ledger: 'ledger_id',
  supplier_ledger: 'ledger_id',
  bank_ledger: 'ledger_id',
  suppliers: 'supplier_id',
  customers: 'customer_id',
  products: 'product_id',
  bills: 'bill_id',
  bill_items: 'item_id',
  bank_accounts: 'bank_id',
  customer_payments: 'payment_id',
  flocks: 'flock_id',
  ledgers: 'ledger_id',
  expenses: 'expense_id',
  ledger_entries: 'entry_id',
  medicine_traders: 'trader_id',
  medicine_entries: 'entry_id',
  sales: 'sale_id',
  income: 'income_id',
  flock_health: 'health_id',
  balance: 'balance_id',
  brokers: 'broker_id',
  batches: 'batch_id',
  egg_collection: 'collection_id',
  egg_sales: 'egg_sale_id',
  vaccinations: 'vaccination_id',
  layer_mortality: 'mortality_id',
  farms: 'farm_id'
};

function runQuery(sql, params = []) {
  try {
    const sqlUpper = sql.trim().toUpperCase();
    let lastId = null;

    if (sqlUpper.startsWith('INSERT')) {
      const stmt = db.prepare(sql);
      stmt.run(params);
      stmt.free();

      try {
        const idResult = db.exec('SELECT last_insert_rowid() as id');
        if (idResult && idResult.length > 0 && idResult[0].values && idResult[0].values.length > 0) {
          lastId = idResult[0].values[0][0];
        }
      } catch (e) {
        console.error('last_insert_rowid lookup failed:', e.message);
      }

      if (!lastId) {
        const tableMatch = sql.match(/INSERT\s+INTO\s+["`\[]?(\w+)["`\]]?/i);
        const tableName = tableMatch ? tableMatch[1] : null;
        const pk = tableName ? PRIMARY_KEY_MAP[tableName] : null;
        if (pk) {
          try {
            const fallbackResult = db.exec(`SELECT MAX(${pk}) as id FROM ${tableName}`);
            if (fallbackResult && fallbackResult.length > 0 && fallbackResult[0].values && fallbackResult[0].values.length > 0) {
              lastId = fallbackResult[0].values[0][0];
              console.log(`📝 last_insert_rowid() was unreliable — used MAX(${pk}) fallback: ${lastId}`);
            }
          } catch (e) {
            console.error('Fallback lastId lookup failed:', e.message);
          }
        } else if (tableName) {
          console.warn(`⚠️ No primary key mapping for table "${tableName}" — add it to PRIMARY_KEY_MAP if lastId is needed for it.`);
        }
      }

      console.log(`📝 Last insert ID: ${lastId}`);
    } else {
      db.run(sql, params);
    }

    const dbPath = path.join(app.getPath('userData'), 'sng_farm.db')
    saveDatabase(dbPath)

    return { success: true, lastId: lastId };
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

// ── BATCH OPERATIONS ─────────────────────────────────────────

function getBatchesByProduct(productId, farmId) {
  try {
    const stmt = db.prepare(`
      SELECT 
        b.*,
        p.product_name,
        p.unit,
        julianday(b.expiry_date) - julianday('now') as days_until_expiry,
        CASE 
          WHEN b.status = 'expired' THEN 'expired'
          WHEN julianday(b.expiry_date) - julianday('now') <= 90 AND b.quantity > 0 THEN 'expiring'
          WHEN b.quantity <= 0 THEN 'depleted'
          ELSE 'active'
        END as calculated_status
      FROM product_batches b
      INNER JOIN products p ON b.product_id = p.product_id
      WHERE b.product_id = ? AND b.farm_id = ?
      ORDER BY b.expiry_date ASC
    `)
    stmt.bind([productId, farmId])
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

function addBatch(batchData) {
  try {
    const { product_id, farm_id, batch_code, manufacturing_date, expiry_date, quantity, purchase_price } = batchData
    
    let finalBatchCode = batch_code
    if (!finalBatchCode) {
      const stmt = db.prepare(`SELECT COUNT(*) as count FROM product_batches WHERE product_id = ?`)
      stmt.bind([product_id])
      const result = stmt.getAsObject()
      stmt.free()
      const count = (result.count || 0) + 1
      finalBatchCode = `BATCH-${String(product_id).padStart(3, '0')}-${String(count).padStart(3, '0')}`
    }
    
    const stmt = db.prepare(`
      INSERT INTO product_batches 
      (product_id, farm_id, batch_code, manufacturing_date, expiry_date, quantity, purchase_price, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `)
    stmt.run([product_id, farm_id, finalBatchCode, manufacturing_date, expiry_date, quantity, purchase_price || 0])
    stmt.free()
    
    const batchId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]
    addBatchTransaction(batchId, product_id, 'purchase', quantity, new Date().toISOString().split('T')[0], null, 'Initial batch addition')
    
    return { success: true, batch_id: batchId, batch_code: finalBatchCode }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function updateBatch(batchId, data) {
  try {
    const fields = []
    const values = []
    
    if (data.manufacturing_date !== undefined) { fields.push('manufacturing_date = ?'); values.push(data.manufacturing_date) }
    if (data.expiry_date !== undefined) { fields.push('expiry_date = ?'); values.push(data.expiry_date) }
    if (data.quantity !== undefined) { fields.push('quantity = ?'); values.push(data.quantity) }
    if (data.purchase_price !== undefined) { fields.push('purchase_price = ?'); values.push(data.purchase_price) }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status) }
    
    if (fields.length === 0) return { success: false, error: 'No fields to update' }
    
    values.push(batchId)
    const sql = `UPDATE product_batches SET ${fields.join(', ')} WHERE batch_id = ?`
    db.run(sql, values)
    
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function deleteBatch(batchId) {
  try {
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM batch_transactions WHERE batch_id = ?`)
    stmt.bind([batchId])
    const result = stmt.getAsObject()
    stmt.free()
    
    if (result.count > 0) {
      db.run(`UPDATE product_batches SET status = 'depleted' WHERE batch_id = ?`, [batchId])
      return { success: true, message: 'Batch marked as depleted due to existing transactions' }
    } else {
      db.run(`DELETE FROM product_batches WHERE batch_id = ?`, [batchId])
      return { success: true, message: 'Batch deleted successfully' }
    }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function getTotalStock(productId) {
  try {
    const stmt = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as total 
      FROM product_batches 
      WHERE product_id = ? AND status IN ('active', 'expiring') AND quantity > 0
    `)
    stmt.bind([productId])
    const result = stmt.getAsObject()
    stmt.free()
    return { success: true, total: result.total || 0 }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function getExpiringBatches(farmId, monthsThreshold = 3) {
  try {
    const stmt = db.prepare(`
      SELECT 
        b.*,
        p.product_name,
        p.unit,
        julianday(b.expiry_date) - julianday('now') as days_until_expiry,
        CAST((julianday(b.expiry_date) - julianday('now')) / 30.44 AS INTEGER) as months_until_expiry
      FROM product_batches b
      INNER JOIN products p ON b.product_id = p.product_id
      WHERE b.farm_id = ? 
        AND b.status IN ('active', 'expiring')
        AND b.quantity > 0
        AND julianday(b.expiry_date) - julianday('now') <= (? * 30.44)
        AND julianday(b.expiry_date) - julianday('now') > 0
      ORDER BY b.expiry_date ASC
    `)
    stmt.bind([farmId, monthsThreshold])
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

function hasExpiringBatches(productId, monthsThreshold = 3) {
  try {
    const stmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM product_batches
      WHERE product_id = ?
        AND status IN ('active', 'expiring')
        AND quantity > 0
        AND julianday(expiry_date) - julianday('now') <= (? * 30.44)
        AND julianday(expiry_date) - julianday('now') > 0
    `)
    stmt.bind([productId, monthsThreshold])
    const result = stmt.getAsObject()
    stmt.free()
    return { success: true, hasExpiring: result.count > 0 }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function addBatchTransaction(batchId, productId, type, quantity, transactionDate, referenceId = null, notes = '') {
  try {
    const stmt = db.prepare(`
      INSERT INTO batch_transactions 
      (batch_id, product_id, type, quantity, transaction_date, reference_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run([batchId, productId, type, quantity, transactionDate, referenceId, notes])
    stmt.free()
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function getBatchTransactions(batchId) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM batch_transactions 
      WHERE batch_id = ? 
      ORDER BY transaction_date DESC, created_at DESC
    `)
    stmt.bind([batchId])
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

function getBatchById(batchId) {
  try {
    const stmt = db.prepare(`
      SELECT 
        b.*,
        p.product_name,
        p.unit,
        julianday(b.expiry_date) - julianday('now') as days_until_expiry
      FROM product_batches b
      INNER JOIN products p ON b.product_id = p.product_id
      WHERE b.batch_id = ?
    `)
    stmt.bind([batchId])
    const result = stmt.getAsObject()
    stmt.free()
    return { success: true, data: result }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function updateBatchStatuses() {
  try {
    db.run(`
      UPDATE product_batches 
      SET status = 'expired' 
      WHERE expiry_date < date('now') 
        AND status IN ('active', 'expiring')
    `)
    
    db.run(`
      UPDATE product_batches 
      SET status = 'depleted' 
      WHERE quantity <= 0 
        AND status IN ('active', 'expiring')
    `)
    
    db.run(`
      UPDATE product_batches 
      SET status = 'expiring' 
      WHERE expiry_date >= date('now') 
        AND expiry_date <= date('now', '+3 months')
        AND quantity > 0
        AND status = 'active'
    `)
    
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function migrateExistingStock(farmId) {
  try {
    const stmt = db.prepare(`
      SELECT product_id, product_name, current_stock, cost_price 
      FROM products 
      WHERE farm_id = ? AND current_stock > 0
    `)
    stmt.bind([farmId])
    const products = []
    while (stmt.step()) {
      products.push(stmt.getAsObject())
    }
    stmt.free()
    
    let migrated = 0
    for (const product of products) {
      const checkStmt = db.prepare(`SELECT COUNT(*) as count FROM product_batches WHERE product_id = ?`)
      checkStmt.bind([product.product_id])
      const result = checkStmt.getAsObject()
      checkStmt.free()
      
      if (result.count === 0 && product.current_stock > 0) {
        const today = new Date().toISOString().split('T')[0]
        const oneYearLater = new Date()
        oneYearLater.setFullYear(oneYearLater.getFullYear() + 1)
        const expiryDate = oneYearLater.toISOString().split('T')[0]
        
        const batchCode = `BATCH-${String(product.product_id).padStart(3, '0')}-001`
        
        const insertStmt = db.prepare(`
          INSERT INTO product_batches 
          (product_id, farm_id, batch_code, manufacturing_date, expiry_date, quantity, purchase_price, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
        `)
        insertStmt.run([product.product_id, farmId, batchCode, today, expiryDate, product.current_stock, product.cost_price || 0])
        insertStmt.free()
        
        const batchId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]
        addBatchTransaction(batchId, product.product_id, 'purchase', product.current_stock, today, null, 'Migrated from existing stock')
        
        migrated++
      }
    }
    
    return { success: true, migrated }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// ── LEDGER OPERATIONS ─────────────────────────────────────────

function addCustomerLedgerEntry(entry) {
  try {
    const { customer_id, transaction_date, description, debit = 0, credit = 0, reference_type, reference_id } = entry;
    
    let currentBalance = 0;
    try {
      const stmt = db.prepare(`
        SELECT COALESCE(SUM(debit - credit), 0) as balance 
        FROM customer_ledger 
        WHERE customer_id = ?
      `)
      stmt.bind([customer_id])
      const result = stmt.getAsObject()
      stmt.free()
      currentBalance = result.balance || 0;
    } catch (e) {
      console.error('Error getting balance:', e.message);
    }
    
    const newBalance = currentBalance + debit - credit;
    
    const stmt = db.prepare(`
      INSERT INTO customer_ledger 
      (customer_id, transaction_date, description, debit, credit, balance, reference_type, reference_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run([customer_id, transaction_date, description, debit, credit, newBalance, reference_type || null, reference_id || null])
    stmt.free()
    
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function addSupplierLedgerEntry(entry) {
  try {
    const { supplier_id, transaction_date, description, debit = 0, credit = 0, reference_type, reference_id } = entry;
    
    let currentBalance = 0;
    try {
      const stmt = db.prepare(`
        SELECT COALESCE(SUM(credit - debit), 0) as balance 
        FROM supplier_ledger 
        WHERE supplier_id = ?
      `)
      stmt.bind([supplier_id])
      const result = stmt.getAsObject()
      stmt.free()
      currentBalance = result.balance || 0;
    } catch (e) {
      console.error('Error getting balance:', e.message);
    }
    
    const newBalance = currentBalance + credit - debit;
    
    const stmt = db.prepare(`
      INSERT INTO supplier_ledger 
      (supplier_id, transaction_date, description, debit, credit, balance, reference_type, reference_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run([supplier_id, transaction_date, description, debit, credit, newBalance, reference_type || null, reference_id || null])
    stmt.free()
    
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// 🔥 FIX: addBankLedgerEntry now correctly calculates balance
function addBankLedgerEntry(entry) {
  try {
    const { bank_id, transaction_date, description, debit = 0, credit = 0, reference_type, reference_id } = entry;
    
    // Get current balance
    let currentBalance = 0;
    try {
      const stmt = db.prepare(`
        SELECT COALESCE(SUM(debit - credit), 0) as balance 
        FROM bank_ledger 
        WHERE bank_id = ?
      `)
      stmt.bind([bank_id])
      const result = stmt.getAsObject()
      stmt.free()
      currentBalance = result.balance || 0;
    } catch (e) {
      console.error('Error getting balance:', e.message);
    }
    
    // Calculate new balance: current + deposit - withdrawal
    const newBalance = currentBalance + debit - credit;
    
    const stmt = db.prepare(`
      INSERT INTO bank_ledger 
      (bank_id, transaction_date, description, debit, credit, balance, reference_type, reference_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run([bank_id, transaction_date, description, debit, credit, newBalance, reference_type || null, reference_id || null])
    stmt.free()
    
    // Update bank account current balance
    db.run(`UPDATE bank_accounts SET current_balance = ? WHERE bank_id = ?`, [newBalance, bank_id])
    
    return { success: true, balance: newBalance }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function updateCustomerOutstandingBalance(customerId) {
  try {
    const stmt = db.prepare(`
      SELECT COALESCE(SUM(debit - credit), 0) as balance 
      FROM customer_ledger 
      WHERE customer_id = ?
    `)
    stmt.bind([customerId])
    const result = stmt.getAsObject()
    stmt.free()
    const balance = result.balance || 0;
    
    db.run(`UPDATE customers SET outstanding_balance = ? WHERE customer_id = ?`, [balance, customerId])
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function getCustomerLedgerWithBalance(customerId) {
  try {
    const stmt = db.prepare(`
      SELECT 
        l.*,
        c.customer_name,
        c.phone,
        c.address,
        (SELECT COALESCE(SUM(debit - credit), 0) FROM customer_ledger WHERE customer_id = ? AND ledger_id <= l.ledger_id) as running_balance
      FROM customer_ledger l
      INNER JOIN customers c ON l.customer_id = c.customer_id
      WHERE l.customer_id = ?
      ORDER BY l.transaction_date ASC, l.ledger_id ASC
    `)
    stmt.bind([customerId, customerId])
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

function getSupplierLedgerWithBalance(supplierId) {
  try {
    const stmt = db.prepare(`
      SELECT 
        l.*,
        s.supplier_name,
        s.phone,
        (SELECT COALESCE(SUM(credit - debit), 0) FROM supplier_ledger WHERE supplier_id = ? AND ledger_id <= l.ledger_id) as running_balance
      FROM supplier_ledger l
      INNER JOIN suppliers s ON l.supplier_id = s.supplier_id
      WHERE l.supplier_id = ?
      ORDER BY l.transaction_date ASC, l.ledger_id ASC
    `)
    stmt.bind([supplierId, supplierId])
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

function getBankLedgerWithBalance(bankId) {
  try {
    const stmt = db.prepare(`
      SELECT 
        l.*,
        b.bank_name,
        b.account_number,
        (SELECT COALESCE(SUM(debit - credit), 0) FROM bank_ledger WHERE bank_id = ? AND ledger_id <= l.ledger_id) as running_balance
      FROM bank_ledger l
      INNER JOIN bank_accounts b ON l.bank_id = b.bank_id
      WHERE l.bank_id = ?
      ORDER BY l.transaction_date ASC, l.ledger_id ASC
    `)
    stmt.bind([bankId, bankId])
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

// 🔥 FIX: getBankAccounts now returns accounts with customer info
function getBankAccounts(farmId) {
  try {
    const stmt = db.prepare(`
      SELECT 
        ba.*,
        c.customer_name
      FROM bank_accounts ba
      LEFT JOIN customers c ON ba.customer_id = c.customer_id
      WHERE ba.farm_id = ?
      ORDER BY ba.bank_name ASC
    `)
    stmt.bind([farmId])
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

function getBankAccount(bankId) {
  try {
    const stmt = db.prepare(`
      SELECT 
        ba.*,
        c.customer_name
      FROM bank_accounts ba
      LEFT JOIN customers c ON ba.customer_id = c.customer_id
      WHERE ba.bank_id = ?
    `)
    stmt.bind([bankId])
    const result = stmt.getAsObject()
    stmt.free()
    return { success: true, data: result }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// 🔥 FIXED: addBankAccount now creates a ledger entry for opening balance
function addBankAccount(account) {
  try {
    const { farm_id, customer_id, bank_name, account_number, account_holder, opening_balance = 0 } = account;
    
    // Insert bank account
    const stmt = db.prepare(`
      INSERT INTO bank_accounts 
      (farm_id, customer_id, bank_name, account_number, account_holder, opening_balance, current_balance)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run([farm_id, customer_id || null, bank_name, account_number || null, account_holder || null, opening_balance, opening_balance])
    stmt.free()
    
    const bankId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]
    
    // 🔥 FIX: Add opening balance to bank_ledger
    if (opening_balance > 0) {
      const entry = {
        bank_id: bankId,
        transaction_date: new Date().toISOString().split('T')[0],
        description: 'Opening Balance',
        debit: opening_balance,
        credit: 0,
        reference_type: 'opening',
        reference_id: null
      };
      addBankLedgerEntry(entry);
    }
    
    // Link customer to bank
    if (customer_id && bankId) {
      db.run(`UPDATE customers SET bank_id = ? WHERE customer_id = ?`, [bankId, customer_id])
    }
    
    return { success: true, bank_id: bankId }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
function updateBankAccount(bankId, data) {
  try {
    const fields = []
    const values = []

    if (data.bank_name !== undefined) { fields.push('bank_name = ?'); values.push(data.bank_name); }
    if (data.account_number !== undefined) { fields.push('account_number = ?'); values.push(data.account_number); }
    if (data.account_holder !== undefined) { fields.push('account_holder = ?'); values.push(data.account_holder); }

    if (fields.length === 0) return { success: false, error: 'No fields to update' };

    values.push(bankId);
    const sql = `UPDATE bank_accounts SET ${fields.join(', ')} WHERE bank_id = ?`;
    db.run(sql, values)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function deleteBankAccount(bankId) {
  try {
    db.run(`DELETE FROM bank_accounts WHERE bank_id = ?`, [bankId])
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function getAllCustomersWithBalance(farmId) {
  try {
    const stmt = db.prepare(`
      SELECT 
        c.*,
        (SELECT COALESCE(SUM(debit - credit), 0) FROM customer_ledger WHERE customer_id = c.customer_id) as outstanding_balance
      FROM customers c
      WHERE c.farm_id = ?
      ORDER BY c.customer_name ASC
    `)
    stmt.bind([farmId])
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

function getAllSuppliersWithBalance(farmId) {
  try {
    const stmt = db.prepare(`
      SELECT 
        s.*,
        (SELECT COALESCE(SUM(credit - debit), 0) FROM supplier_ledger WHERE supplier_id = s.supplier_id) as outstanding_balance
      FROM suppliers s
      WHERE s.farm_id = ?
      ORDER BY s.supplier_name ASC
    `)
    stmt.bind([farmId])
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

// ── CUSTOMER BANK METHODS ────────────────────────────────────

function getCustomerBankAccount(customerId) {
  try {
    const stmt = db.prepare(`
      SELECT ba.* 
      FROM bank_accounts ba
      INNER JOIN customers c ON c.bank_id = ba.bank_id
      WHERE c.customer_id = ?
    `)
    stmt.bind([customerId])
    const result = stmt.getAsObject()
    stmt.free()
    return { success: true, data: result }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function getCustomerBankBalance(customerId) {
  try {
    const stmt = db.prepare(`
      SELECT ba.current_balance 
      FROM bank_accounts ba
      INNER JOIN customers c ON c.bank_id = ba.bank_id
      WHERE c.customer_id = ?
    `)
    stmt.bind([customerId])
    const result = stmt.getAsObject()
    stmt.free()
    return { success: true, balance: result.current_balance || 0 }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function deductCustomerBank(customerId, amount, description) {
  try {
    // Get the customer's bank account
    const bankResult = getCustomerBankAccount(customerId);
    if (!bankResult.success || !bankResult.data) {
      return { success: false, error: 'Customer has no bank account' };
    }
    
    const bank = bankResult.data;
    
    // Add withdrawal to bank ledger
    const entry = {
      bank_id: bank.bank_id,
      transaction_date: new Date().toISOString().split('T')[0],
      description: description,
      debit: 0,
      credit: amount,
      reference_type: 'payment',
      reference_id: null
    };
    
    return addBankLedgerEntry(entry);
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function linkCustomerToBank(customerId, bankId) {
  try {
    db.run(`UPDATE customers SET bank_id = ? WHERE customer_id = ?`, [bankId, customerId]);
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function getCustomersWithBankAccounts(farmId) {
  try {
    const stmt = db.prepare(`
      SELECT 
        c.*,
        ba.bank_id,
        ba.bank_name,
        ba.current_balance
      FROM customers c
      LEFT JOIN bank_accounts ba ON c.bank_id = ba.bank_id
      WHERE c.farm_id = ?
      ORDER BY c.customer_name ASC
    `)
    stmt.bind([farmId])
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

module.exports = { 
  initializeDatabase, 
  runQuery, 
  getQuery,
  getBatchesByProduct,
  addBatch,
  updateBatch,
  deleteBatch,
  getTotalStock,
  getExpiringBatches,
  hasExpiringBatches,
  getBatchTransactions,
  getBatchById,
  updateBatchStatuses,
  migrateExistingStock,
  addBatchTransaction,
  // Ledger functions
  addCustomerLedgerEntry,
  addSupplierLedgerEntry,
  addBankLedgerEntry,
  updateCustomerOutstandingBalance,
  getCustomerLedgerWithBalance,
  getSupplierLedgerWithBalance,
  getBankLedgerWithBalance,
  getBankAccounts,
  getBankAccount,
  addBankAccount,
  updateBankAccount,
  deleteBankAccount,
  getAllCustomersWithBalance,
  getAllSuppliersWithBalance,
  // Customer Bank functions
  getCustomerBankAccount,
  getCustomerBankBalance,
  deductCustomerBank,
  linkCustomerToBank,
  getCustomersWithBankAccounts
}