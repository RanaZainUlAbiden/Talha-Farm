const path = require('path')
const fs = require('fs')
const { app } = require('electron')

let db = null

// =============================================
// CREATE ALL TABLES
// =============================================
function createTables(db) {
  // ── Core ───────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS app_settings (
  farm_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (farm_id, key),
  FOREIGN KEY (farm_id) REFERENCES farms(farm_id)
);`);
  db.run(`CREATE TABLE IF NOT EXISTS farms (farm_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_name TEXT NOT NULL, password_hash TEXT NOT NULL, business_type TEXT DEFAULT 'broiler', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`)

  // ── Farm Units ─────────────────────────────────────────
  // The client calls these "Farms". `farms` is already taken by the login
  // account, so the physical-site level between an account and its
  // flocks/batches lives here as farm_units.
  db.run(`CREATE TABLE IF NOT EXISTS farm_units (
    unit_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id     INTEGER NOT NULL,
    module_type TEXT NOT NULL,
    unit_name   TEXT NOT NULL,
    location    TEXT,
    notes       TEXT,
    status      TEXT DEFAULT 'active',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (farm_id) REFERENCES farms(farm_id)
  );`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_farm_units_farm_module ON farm_units(farm_id, module_type);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_farm_units_status ON farm_units(status);`)

  db.run(`CREATE TABLE IF NOT EXISTS flocks (flock_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, flock_name TEXT NOT NULL, start_date DATE NOT NULL, end_date DATE, status TEXT DEFAULT 'active', unit_id INTEGER, FOREIGN KEY (farm_id) REFERENCES farms(farm_id), FOREIGN KEY (unit_id) REFERENCES farm_units(unit_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS ledgers (ledger_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, ledger_name TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS expenses (expense_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, ledger_id INTEGER, ledger_entry_id INTEGER, date DATE NOT NULL, description TEXT, amount REAL NOT NULL, bill_available TEXT DEFAULT 'No', payment_type TEXT DEFAULT 'cash', module_type TEXT DEFAULT 'broiler', FOREIGN KEY (flock_id) REFERENCES flocks(flock_id), FOREIGN KEY (ledger_id) REFERENCES ledgers(ledger_id), FOREIGN KEY (ledger_entry_id) REFERENCES ledger_entries(entry_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS ledger_entries (entry_id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, flock_id INTEGER NOT NULL, date DATE NOT NULL, description TEXT, amount REAL NOT NULL, type TEXT DEFAULT 'debit', source TEXT DEFAULT 'manual', FOREIGN KEY (ledger_id) REFERENCES ledgers(ledger_id), FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS medicine_traders (trader_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, trader_name TEXT NOT NULL, module_type TEXT DEFAULT 'broiler', FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS medicine_entries (entry_id INTEGER PRIMARY KEY AUTOINCREMENT, trader_id INTEGER NOT NULL, flock_id INTEGER NOT NULL, date DATE NOT NULL, medicine_name TEXT NOT NULL, quantity REAL NOT NULL, price_per_unit REAL NOT NULL, total_amount REAL NOT NULL, module_type TEXT DEFAULT 'broiler', bill_id INTEGER, bill_number TEXT, FOREIGN KEY (trader_id) REFERENCES medicine_traders(trader_id), FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS feed_traders (trader_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, trader_name TEXT NOT NULL, module_type TEXT DEFAULT 'broiler', FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS feed_entries (entry_id INTEGER PRIMARY KEY AUTOINCREMENT, trader_id INTEGER NOT NULL, flock_id INTEGER NOT NULL, date DATE NOT NULL, feed_name TEXT NOT NULL, quantity REAL NOT NULL, price_per_unit REAL NOT NULL, total_amount REAL NOT NULL, module_type TEXT DEFAULT 'broiler', bill_id INTEGER, bill_number TEXT, FOREIGN KEY (trader_id) REFERENCES feed_traders(trader_id), FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS sales (sale_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, date DATE NOT NULL, vehicle_number TEXT, broker TEXT, empty_weight REAL, load_weight REAL, bird_weight REAL, rate REAL NOT NULL, total_amount REAL NOT NULL, payment_type TEXT DEFAULT 'cash', driver_name TEXT DEFAULT '', driver_phone TEXT DEFAULT '', receipt_image TEXT, module_type TEXT DEFAULT 'broiler', FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS income (income_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, date DATE NOT NULL, description TEXT, amount REAL NOT NULL, source TEXT DEFAULT 'manual', module_type TEXT DEFAULT 'broiler', FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS flock_health (health_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, week_number INTEGER NOT NULL, total_birds INTEGER NOT NULL, mortality INTEGER DEFAULT 0, feed_used REAL DEFAULT 0, avg_weight REAL DEFAULT 0, fcr REAL DEFAULT 0, FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS balance (balance_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, date DATE NOT NULL, description TEXT, amount REAL NOT NULL, type TEXT NOT NULL, module_type TEXT DEFAULT 'broiler', FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS brokers (broker_id INTEGER PRIMARY KEY AUTOINCREMENT, flock_id INTEGER NOT NULL, broker_name TEXT NOT NULL, FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
db.run(`CREATE TABLE IF NOT EXISTS activation (machine_id TEXT PRIMARY KEY, activation_code TEXT NOT NULL, trial_start_date TEXT, last_launch_date TEXT, is_permanent INTEGER DEFAULT 0, activated_at DATETIME DEFAULT CURRENT_TIMESTAMP, is_active INTEGER DEFAULT 1,activation_cycle INTEGER DEFAULT 0);`)
  // ── Layer Module ───────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS batches (batch_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, batch_name TEXT NOT NULL, start_date DATE NOT NULL, initial_birds INTEGER NOT NULL, breed TEXT, status TEXT DEFAULT 'active', unit_id INTEGER, FOREIGN KEY (farm_id) REFERENCES farms(farm_id), FOREIGN KEY (unit_id) REFERENCES farm_units(unit_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS egg_collection (collection_id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, date DATE NOT NULL, total_eggs INTEGER DEFAULT 0, broken_eggs INTEGER DEFAULT 0, small_grade INTEGER DEFAULT 0, medium_grade INTEGER DEFAULT 0, large_grade INTEGER DEFAULT 0, xl_grade INTEGER DEFAULT 0, FOREIGN KEY (batch_id) REFERENCES batches(batch_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS egg_sales (egg_sale_id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, date DATE NOT NULL, customer_name TEXT, grade TEXT, quantity INTEGER NOT NULL, rate_per_egg REAL NOT NULL, total_amount REAL NOT NULL, payment_type TEXT DEFAULT 'cash', FOREIGN KEY (batch_id) REFERENCES batches(batch_id));`)
  db.run(`CREATE TABLE IF NOT EXISTS vaccinations (vaccination_id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER, flock_id INTEGER, date DATE NOT NULL, vaccine_name TEXT NOT NULL, dose TEXT, notes TEXT, cost REAL DEFAULT 0, done INTEGER DEFAULT 0, bill_id INTEGER, bill_number TEXT, FOREIGN KEY (batch_id) REFERENCES batches(batch_id), FOREIGN KEY (flock_id) REFERENCES flocks(flock_id));`)
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

  // Bank Accounts
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

  // Bank Ledger – 🔥 ADDED transaction_number column
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
    transaction_number TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bank_id) REFERENCES bank_accounts(bank_id) ON DELETE CASCADE
  );`)

  // 🔥 NEW: Expense Ledger
  db.run(`CREATE TABLE IF NOT EXISTS expense_ledger (
    expense_id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    transaction_date DATE NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT,
    payment_type TEXT DEFAULT 'cash',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (farm_id) REFERENCES farms(farm_id)
  );`)

db.run(`CREATE TABLE IF NOT EXISTS categories (category_id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL, category_name TEXT NOT NULL, category_type TEXT DEFAULT 'product', FOREIGN KEY (farm_id) REFERENCES farms(farm_id));`);
// Dedupe + unique index (scoped per category_type, so "other" can exist once for
// products and once for expenses without colliding) is handled below in the
// alterStatements block so it runs correctly on both fresh and existing installs.

  // ── Sales Returns Module ───────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS sales_returns (
    return_id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    bill_id INTEGER NOT NULL,
    return_number TEXT NOT NULL,
    return_date DATE NOT NULL,
    return_amount REAL NOT NULL,
    refund_amount REAL DEFAULT 0,
    refund_method TEXT DEFAULT 'cash',
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (farm_id) REFERENCES farms(farm_id),
    FOREIGN KEY (bill_id) REFERENCES bills(bill_id)
  );`)

  db.run(`CREATE TABLE IF NOT EXISTS purchase_returns (
    return_id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    purchase_id INTEGER NOT NULL,
    return_number TEXT NOT NULL,
    return_date DATE NOT NULL,
    quantity REAL NOT NULL,
    return_amount REAL NOT NULL,
    refund_method TEXT DEFAULT 'cash',
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (farm_id) REFERENCES farms(farm_id),
    FOREIGN KEY (purchase_id) REFERENCES purchase_orders(purchase_id)
  );`)

  db.run(`CREATE INDEX IF NOT EXISTS idx_purchase_returns_farm ON purchase_returns(farm_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase ON purchase_returns(purchase_id);`)
  db.run(`CREATE TABLE IF NOT EXISTS labour (
    labour_id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    labour_name TEXT NOT NULL,
    phone TEXT,
    role TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (farm_id) REFERENCES farms(farm_id)
  );`)
  db.run(`CREATE TABLE IF NOT EXISTS labour_payments (
    payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    labour_id INTEGER NOT NULL,
    flock_id INTEGER NOT NULL,
    date DATE NOT NULL,
    description TEXT,
    amount REAL NOT NULL,
    payment_type TEXT DEFAULT 'cash',
    module_type TEXT DEFAULT 'broiler',
    FOREIGN KEY (labour_id) REFERENCES labour(labour_id)
  );`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_labour_farm ON labour(farm_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_labour_payments_flock ON labour_payments(flock_id, module_type);`)
  db.run(`CREATE TABLE IF NOT EXISTS hen_sales (
    hen_sale_id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    date DATE NOT NULL,
    customer_name TEXT,
    quantity INTEGER NOT NULL,
    rate_per_hen REAL NOT NULL,
    total_amount REAL NOT NULL,
    payment_type TEXT DEFAULT 'cash',
    FOREIGN KEY (batch_id) REFERENCES batches(batch_id)
  );`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_hen_sales_batch ON hen_sales(batch_id);`)

  db.run(`CREATE TABLE IF NOT EXISTS sales_return_items (
    item_id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id INTEGER NOT NULL,
    bill_id INTEGER NOT NULL,
    bill_item_id INTEGER,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL,
    FOREIGN KEY (return_id) REFERENCES sales_returns(return_id) ON DELETE CASCADE,
    FOREIGN KEY (bill_id) REFERENCES bills(bill_id)
  );`)

  // ── Internal Transfers (Distribution → Broiler/Layer) ─────
  db.run(`CREATE TABLE IF NOT EXISTS internal_transfers (
    transfer_id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL,
    expense_id INTEGER,
    target_module TEXT,
    target_flock_id INTEGER,
    target_type TEXT,
    reference_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bill_id) REFERENCES bills(bill_id)
  );`)

  db.run(`CREATE INDEX IF NOT EXISTS idx_sales_returns_farm ON sales_returns(farm_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_sales_returns_bill ON sales_returns(bill_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_sales_return_items_return ON sales_return_items(return_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_internal_transfers_bill ON internal_transfers(bill_id);`)
  // Indexes for performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer ON customer_ledger(customer_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_customer_ledger_date ON customer_ledger(transaction_date);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier ON supplier_ledger(supplier_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_supplier_ledger_date ON supplier_ledger(transaction_date);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_bank_ledger_bank ON bank_ledger(bank_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_bank_ledger_date ON bank_ledger(transaction_date);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_bank_ledger_number ON bank_ledger(transaction_number);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_customers_bank ON customers(bank_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_expense_ledger_date ON expense_ledger(transaction_date);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_expense_ledger_category ON expense_ledger(category);`)

  // Add indexes for batch
  db.run(`CREATE INDEX IF NOT EXISTS idx_batches_product ON product_batches(product_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_batches_expiry ON product_batches(expiry_date);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_batches_status ON product_batches(status);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_batch ON batch_transactions(batch_id);`)

  // ── Overview Module: Fixed Assets & Personal Expenses ──────
  // Account-level (farm_id scoped), not tied to any flock/batch. Pattern
  // follows bank_accounts. No depreciation — gain/loss is only recognised
  // when an asset is sold (sale_amount - purchase_amount).
  db.run(`CREATE TABLE IF NOT EXISTS assets (
    asset_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id         INTEGER NOT NULL,
    unit_id         INTEGER,
    asset_name      TEXT NOT NULL,
    category        TEXT,
    purchase_date   DATE NOT NULL,
    purchase_amount REAL NOT NULL DEFAULT 0,
    payment_source  TEXT DEFAULT 'cash',
    bank_id         INTEGER,
    status          TEXT DEFAULT 'active',
    sale_date       DATE,
    sale_amount     REAL,
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (farm_id) REFERENCES farms(farm_id),
    FOREIGN KEY (unit_id) REFERENCES farm_units(unit_id),
    FOREIGN KEY (bank_id) REFERENCES bank_accounts(bank_id)
  );`)

  db.run(`CREATE TABLE IF NOT EXISTS personal_expenses (
    pexpense_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id         INTEGER NOT NULL,
    date            DATE NOT NULL,
    category        TEXT,
    description     TEXT,
    amount          REAL NOT NULL DEFAULT 0,
    payment_source  TEXT DEFAULT 'cash',
    bank_id         INTEGER,
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (farm_id) REFERENCES farms(farm_id),
    FOREIGN KEY (bank_id) REFERENCES bank_accounts(bank_id)
  );`)

  db.run(`CREATE INDEX IF NOT EXISTS idx_assets_farm ON assets(farm_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_personal_expenses_farm ON personal_expenses(farm_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_personal_expenses_date ON personal_expenses(date);`)
}

// =============================================
// ATTEMPT TO RECOVER DATA FROM CORRUPTED DB
// =============================================
function attemptRecovery(dbPath, oldDb, SQL) {
  const tables = ['farms', 'farm_units', 'flocks', 'ledgers', 'expenses', 'ledger_entries', 'medicine_traders', 'medicine_entries', 'feed_traders', 'feed_entries', 'sales', 'income', 'flock_health', 'balance', 'brokers', 'activation', 'batches', 'egg_collection', 'egg_sales', 'vaccinations', 'layer_mortality', 'products', 'customers', 'suppliers', 'purchase_orders', 'sales_orders', 'customer_payments', 'product_batches', 'batch_transactions', 'customer_ledger', 'supplier_ledger', 'bank_accounts', 'bank_ledger', 'expense_ledger', 'categories', 'sales_returns', 'sales_return_items', 'internal_transfers','purchase_returns','labour', 'labour_payments', 'hen_sales', 'assets', 'personal_expenses']
  
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
// ONE-TIME REBUILD: make vaccinations.batch_id nullable
// =============================================
// The oldest schema declared vaccinations.batch_id NOT NULL, which blocks
// broiler rows (they carry flock_id and leave batch_id null). SQLite cannot drop
// a NOT NULL constraint in place, so the fix is a table rebuild.
//
// This rebuild previously sat in alterStatements, which runs on EVERY launch. It
// re-created the table from a 7-column INSERT...SELECT, so on every single app
// start it destroyed flock_id, cost, bill_id and bill_number for every existing
// vaccination row. Three things stop that from happening again:
//
//   1. an app_settings flag, so the body runs at most once per database;
//   2. a PRAGMA check, so it only rebuilds a table that actually still has the
//      NOT NULL constraint — on a current schema it just sets the flag;
//   3. the INSERT...SELECT carries every column the table has, computed from
//      PRAGMA rather than hardcoded, so a future column cannot be forgotten.
//
// Same convergent shape as backfillFarmUnits below: the flag is written last, so
// any throw leaves it unset and the next launch retries from wherever it stopped.
function migrateVaccinationsNullableBatchId(db) {
  const MIGRATION_KEY = 'migration_vaccinations_nullable_batch_v1'
  const SETTINGS_SCOPE_APP = 0

  // Mirrors the vaccinations definition in createTables(). Order matters only for
  // readability — the INSERT names its columns explicitly.
  const COLUMNS = [
    'vaccination_id', 'batch_id', 'flock_id', 'date', 'vaccine_name',
    'dose', 'notes', 'cost', 'done', 'bill_id', 'bill_number'
  ]
  const CREATE_SQL = `CREATE TABLE vaccinations (vaccination_id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER, flock_id INTEGER, date DATE NOT NULL, vaccine_name TEXT NOT NULL, dose TEXT, notes TEXT, cost REAL DEFAULT 0, done INTEGER DEFAULT 0, bill_id INTEGER, bill_number TEXT, FOREIGN KEY (batch_id) REFERENCES batches(batch_id), FOREIGN KEY (flock_id) REFERENCES flocks(flock_id))`

  const selectRows = (sql, params = []) => {
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const rows = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()
    return rows
  }

  const alreadyApplied = selectRows(
    `SELECT value FROM app_settings WHERE farm_id = ? AND key = ?`,
    [SETTINGS_SCOPE_APP, MIGRATION_KEY]
  )
  if (alreadyApplied.length > 0) return

  const tableExists = (name) => selectRows(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [name]
  ).length > 0

  // Only the columns the new table and the source table have in common. On a
  // legacy database the ALTER statements above have already added flock_id, cost,
  // bill_id and bill_number by the time this runs, so in practice this is all of
  // COLUMNS — the intersection is here so a truly ancient table still copies what
  // it does have instead of failing the whole INSERT.
  const carriedColumns = (sourceTable) => {
    const present = selectRows(`PRAGMA table_info(${sourceTable})`).map(c => c.name)
    return COLUMNS.filter(c => present.includes(c))
  }

  // Leftover from a run that died between the RENAME and the DROP: the real rows
  // are in vaccinations_old and createTables() has since made an empty (or
  // partly-filled) vaccinations. Fold the missing rows back in rather than
  // dropping the table outright, which would throw that data away.
  if (tableExists('vaccinations_old')) {
    const cols = carriedColumns('vaccinations_old').join(', ')
    db.run(`INSERT OR IGNORE INTO vaccinations (${cols})
            SELECT ${cols} FROM vaccinations_old
            WHERE vaccination_id NOT IN (SELECT vaccination_id FROM vaccinations)`)
    db.run(`DROP TABLE vaccinations_old`)
    console.log('recovered vaccinations rows from an interrupted rebuild')
  }

  const batchIdColumn = selectRows(`PRAGMA table_info(vaccinations)`)
    .find(c => c.name === 'batch_id')
  // notnull === 1 means the old constraint is still there and the rebuild is
  // genuinely needed. Anything else (current schema, or no such column because
  // createTables just made the table fresh) needs no rebuild at all.
  if (batchIdColumn && batchIdColumn.notnull === 1) {
    const cols = carriedColumns('vaccinations').join(', ')
    db.run(`ALTER TABLE vaccinations RENAME TO vaccinations_old`)
    db.run(CREATE_SQL)
    db.run(`INSERT INTO vaccinations (${cols}) SELECT ${cols} FROM vaccinations_old`)
    db.run(`DROP TABLE vaccinations_old`)
    console.log(`vaccinations rebuilt for nullable batch_id — carried columns: ${cols}`)
  }

  db.run(
    `INSERT INTO app_settings (farm_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(farm_id, key) DO UPDATE SET value = excluded.value`,
    [SETTINGS_SCOPE_APP, MIGRATION_KEY, '1']
  )
}

// =============================================
// ONE-TIME BACKFILL: give pre-existing flocks/batches a farm_unit
// =============================================
// Guarded by a flag in app_settings, because everything in alterStatements runs
// on every single launch and this must not.
//
// There are no transactions in this database, and initializeDatabase() writes the
// whole file to disk when it finishes regardless of what threw, so a failure
// partway through WILL be persisted. The design therefore is not "all or nothing"
// but "convergent": the flag is written last, so any throw leaves it unset and
// the next launch re-runs; and every step re-runs to the same end state.
//
// Ordering, per farm and per module: create the unit FIRST, then point the child
// rows at it. Crashing between the two leaves an unreferenced farm_units row —
// harmless, and the next run adopts it via findOrCreateMainUnit instead of
// inserting a second "Main Farm". The reverse order would be unrecoverable: rows
// carrying a unit_id for a unit that does not exist, with foreign keys off and
// nothing left to say what the intent was.
function backfillFarmUnits(db) {
  const MIGRATION_KEY = 'migration_farm_units_v1'
  // app_settings is keyed (farm_id, key). farms.farm_id is AUTOINCREMENT, so it
  // never yields 0 — 0 is reserved here for app-wide rows like a migration flag.
  const SETTINGS_SCOPE_APP = 0
  const DEFAULT_UNIT_NAME = 'Main Farm'

  const selectRows = (sql, params = []) => {
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const rows = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()
    return rows
  }

  const alreadyApplied = selectRows(
    `SELECT value FROM app_settings WHERE farm_id = ? AND key = ?`,
    [SETTINGS_SCOPE_APP, MIGRATION_KEY]
  )
  if (alreadyApplied.length > 0) return

  const findMainUnit = (farmId, moduleType) => {
    const rows = selectRows(
      `SELECT unit_id FROM farm_units WHERE farm_id = ? AND module_type = ? AND unit_name = ?`,
      [farmId, moduleType, DEFAULT_UNIT_NAME]
    )
    return rows.length > 0 ? rows[0].unit_id : null
  }

  const findOrCreateMainUnit = (farmId, moduleType) => {
    const existing = findMainUnit(farmId, moduleType)
    if (existing) return existing
    db.run(
      `INSERT INTO farm_units (farm_id, module_type, unit_name, status) VALUES (?, ?, ?, 'active')`,
      [farmId, moduleType, DEFAULT_UNIT_NAME]
    )
    // Re-select rather than trusting last_insert_rowid(), which this codebase has
    // already found unreliable under sql.js (see the fallback in runQuery).
    return findMainUnit(farmId, moduleType)
  }

  const countPending = (sql, farmId) => selectRows(sql, [farmId])[0].count

  const farms = selectRows(`SELECT farm_id FROM farms`)
  let unitsCreated = 0

  for (const farm of farms) {
    const farmId = farm.farm_id

    const pendingFlocks = countPending(
      `SELECT COUNT(*) AS count FROM flocks WHERE farm_id = ? AND unit_id IS NULL`, farmId
    )
    if (pendingFlocks > 0) {
      const unitId = findOrCreateMainUnit(farmId, 'broiler')
      if (!unitId) throw new Error(`Could not create broiler farm unit for farm ${farmId}`)
      db.run(`UPDATE flocks SET unit_id = ? WHERE farm_id = ? AND unit_id IS NULL`, [unitId, farmId])
      unitsCreated++
    }

    const pendingBatches = countPending(
      `SELECT COUNT(*) AS count FROM batches WHERE farm_id = ? AND unit_id IS NULL`, farmId
    )
    if (pendingBatches > 0) {
      const unitId = findOrCreateMainUnit(farmId, 'layer')
      if (!unitId) throw new Error(`Could not create layer farm unit for farm ${farmId}`)
      db.run(`UPDATE batches SET unit_id = ? WHERE farm_id = ? AND unit_id IS NULL`, [unitId, farmId])
      unitsCreated++
    }
    // A farm with neither flocks nor batches gets no unit.
  }

  // Written only once every farm above has been fully backfilled.
  db.run(
    `INSERT INTO app_settings (farm_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(farm_id, key) DO UPDATE SET value = excluded.value`,
    [SETTINGS_SCOPE_APP, MIGRATION_KEY, '1']
  )

  console.log(`farm_units backfill complete — ${unitsCreated} unit(s) touched across ${farms.length} account(s)`)
}

// migration_farm_units_v1 above only ever runs once — it fixes every flock/batch
// that had a NULL unit_id as of the FIRST launch after farm_units shipped, then
// sets its flag and never runs again. Before flock/batch creation was made to
// require a farm (Farm selector step 4), the create forms could still insert
// unit_id = NULL — those rows are invisible to every farm-filtered dropdown, and
// v1 will never touch them again because its flag is already set. This is a
// second, separately-flagged, idempotent sweep for exactly that gap.
//
// Unlike v1, this does NOT invent a new "Main Farm" — by the time this runs,
// every account that had pending rows during v1 already has at least one
// farm_unit, so orphans found here are assigned to the OLDEST existing unit for
// that farm+module (by created_at, then unit_id as a tiebreak). The one case
// with nothing to assign to is an account whose first-ever flock/batch was
// created through the buggy form before that account ever had any farm_units at
// all — those rows are left NULL and logged; the create-form guard shipped
// alongside this migration stops any new occurrences.
function repairOrphanedUnitIds(db) {
  const MIGRATION_KEY = 'migration_farm_units_orphan_repair_v1'
  const SETTINGS_SCOPE_APP = 0

  const selectRows = (sql, params = []) => {
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const rows = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()
    return rows
  }

  const alreadyApplied = selectRows(
    `SELECT value FROM app_settings WHERE farm_id = ? AND key = ?`,
    [SETTINGS_SCOPE_APP, MIGRATION_KEY]
  )
  if (alreadyApplied.length > 0) return

  const oldestUnit = (farmId, moduleType) => {
    const rows = selectRows(
      `SELECT unit_id FROM farm_units WHERE farm_id = ? AND module_type = ? ORDER BY created_at ASC, unit_id ASC LIMIT 1`,
      [farmId, moduleType]
    )
    return rows.length > 0 ? rows[0].unit_id : null
  }

  const countPending = (sql, farmId) => selectRows(sql, [farmId])[0].count

  const farms = selectRows(`SELECT farm_id FROM farms`)
  let rowsFixed = 0
  let rowsSkipped = 0

  for (const farm of farms) {
    const farmId = farm.farm_id

    const pendingFlocks = countPending(
      `SELECT COUNT(*) AS count FROM flocks WHERE farm_id = ? AND unit_id IS NULL`, farmId
    )
    if (pendingFlocks > 0) {
      const unitId = oldestUnit(farmId, 'broiler')
      if (unitId) {
        db.run(`UPDATE flocks SET unit_id = ? WHERE farm_id = ? AND unit_id IS NULL`, [unitId, farmId])
        rowsFixed += pendingFlocks
      } else {
        rowsSkipped += pendingFlocks
      }
    }

    const pendingBatches = countPending(
      `SELECT COUNT(*) AS count FROM batches WHERE farm_id = ? AND unit_id IS NULL`, farmId
    )
    if (pendingBatches > 0) {
      const unitId = oldestUnit(farmId, 'layer')
      if (unitId) {
        db.run(`UPDATE batches SET unit_id = ? WHERE farm_id = ? AND unit_id IS NULL`, [unitId, farmId])
        rowsFixed += pendingBatches
      } else {
        rowsSkipped += pendingBatches
      }
    }
  }

  // Written only once every farm above has been fully repaired.
  db.run(
    `INSERT INTO app_settings (farm_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(farm_id, key) DO UPDATE SET value = excluded.value`,
    [SETTINGS_SCOPE_APP, MIGRATION_KEY, '1']
  )

  console.log(`orphaned unit_id repair complete — ${rowsFixed} row(s) fixed, ${rowsSkipped} row(s) skipped (no farm to assign to) across ${farms.length} account(s)`)
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
    `ALTER TABLE batches ADD COLUMN end_date DATE`,
        `ALTER TABLE purchase_orders ADD COLUMN status TEXT DEFAULT 'completed'`,
    `ALTER TABLE expenses ADD COLUMN receipt_image TEXT`,
    `ALTER TABLE purchase_orders ADD COLUMN receipt_image TEXT`,
`ALTER TABLE activation ADD COLUMN activation_cycle INTEGER DEFAULT 0`,
    `ALTER TABLE activation ADD COLUMN trial_start_date TEXT`,
`ALTER TABLE activation ADD COLUMN last_launch_date TEXT`,
`ALTER TABLE activation ADD COLUMN is_permanent INTEGER DEFAULT 0`,
    `ALTER TABLE customers ADD COLUMN bank_id INTEGER`,
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
    `ALTER TABLE medicine_traders ADD COLUMN module_type TEXT`,
    `ALTER TABLE medicine_entries ADD COLUMN module_type TEXT`,
    `ALTER TABLE feed_traders ADD COLUMN module_type TEXT`,
    `ALTER TABLE feed_entries ADD COLUMN module_type TEXT`,
    `ALTER TABLE flocks ADD COLUMN end_date DATE`,
    `ALTER TABLE sales ADD COLUMN receipt_image TEXT`,
    `ALTER TABLE bills ADD COLUMN status TEXT DEFAULT 'completed'`,
    `ALTER TABLE customers ADD COLUMN bank_id INTEGER`,
    // 🔥 ADD transaction_number to bank_ledger
    `ALTER TABLE bank_ledger ADD COLUMN transaction_number TEXT`,
    // 🔥 Make vaccinations work for both Broiler and Layer
    `ALTER TABLE vaccinations ADD COLUMN flock_id INTEGER`,
    `ALTER TABLE vaccinations ADD COLUMN cost REAL DEFAULT 0`,
    // NOTE: the "make vaccinations.batch_id nullable" table rebuild used to live
    // here, unguarded, and therefore re-ran on every launch — silently dropping
    // flock_id, cost, bill_id and bill_number every time. It now lives in the
    // flagged, one-shot migrateVaccinationsNullableBatchId() below. Do not put a
    // RENAME/CREATE/INSERT...SELECT/DROP rebuild in this array: everything here
    // runs on every start, and only ALTER-style statements survive that safely.
    `ALTER TABLE internal_transfers ADD COLUMN target_type TEXT`,
    `ALTER TABLE internal_transfers ADD COLUMN reference_id INTEGER`,
    `ALTER TABLE purchase_orders ADD COLUMN batch_id INTEGER`,
    `ALTER TABLE categories ADD COLUMN category_type TEXT DEFAULT 'product'`,
    `ALTER TABLE medicine_entries ADD COLUMN bill_id INTEGER`,
    `ALTER TABLE medicine_entries ADD COLUMN bill_number TEXT`,
    `ALTER TABLE feed_entries ADD COLUMN bill_id INTEGER`,
    `ALTER TABLE feed_entries ADD COLUMN bill_number TEXT`,
    `ALTER TABLE vaccinations ADD COLUMN bill_id INTEGER`,
    `ALTER TABLE vaccinations ADD COLUMN bill_number TEXT`,
    // Farm units (client-facing name: "Farm"). Deliberately NOT added to labour
    // yet — the shared broiler/layer tables overload flock_id to hold a batch_id
    // when module_type = 'layer', and labour needs that ambiguity resolved first.
    `ALTER TABLE flocks ADD COLUMN unit_id INTEGER`,
    `ALTER TABLE batches ADD COLUMN unit_id INTEGER`,
  ]
  
  for (const sql of alterStatements) {
    try { db.run(sql) } catch(e) {}
  }

  // Must run after alterStatements — those add vaccinations.flock_id / cost /
  // bill_id / bill_number to a legacy table, and this copies whatever columns the
  // table has. Running it earlier would rebuild before they exist.
  try {
    migrateVaccinationsNullableBatchId(db)
  } catch (e) {
    console.error('vaccinations rebuild failed, will retry on next launch:', e.message)
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

  try {
    db.run(`DROP INDEX IF EXISTS idx_categories_farm_name`)
  } catch(e) {}

  try {
    db.run(`UPDATE categories SET category_type = 'product' WHERE category_type IS NULL`)
  } catch(e) {}

  try {
    db.run(`
      DELETE FROM categories WHERE category_id NOT IN (
        SELECT MIN(category_id) FROM categories GROUP BY farm_id, category_type, category_name
      )
    `)
  } catch(e) {}

  try {
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_farm_type_name ON categories(farm_id, category_type, category_name)`)
  } catch(e) {}

  try {
    db.run(`
      UPDATE medicine_traders
      SET module_type = 'layer'
      WHERE module_type IS NULL
        AND flock_id IN (SELECT batch_id FROM batches)
        AND flock_id NOT IN (SELECT flock_id FROM flocks);

      UPDATE medicine_traders
      SET module_type = 'broiler'
      WHERE module_type IS NULL
        AND flock_id IN (SELECT flock_id FROM flocks)
        AND flock_id NOT IN (SELECT batch_id FROM batches);

      UPDATE medicine_entries
      SET module_type = (
        SELECT mt.module_type FROM medicine_traders mt
        WHERE mt.trader_id = medicine_entries.trader_id
      )
      WHERE module_type IS NULL;

      UPDATE feed_traders
      SET module_type = 'layer'
      WHERE module_type IS NULL
        AND flock_id IN (SELECT batch_id FROM batches)
        AND flock_id NOT IN (SELECT flock_id FROM flocks);

      UPDATE feed_traders
      SET module_type = 'broiler'
      WHERE module_type IS NULL
        AND flock_id IN (SELECT flock_id FROM flocks)
        AND flock_id NOT IN (SELECT batch_id FROM batches);

      UPDATE feed_entries
      SET module_type = (
        SELECT ft.module_type FROM feed_traders ft
        WHERE ft.trader_id = feed_entries.trader_id
      )
      WHERE module_type IS NULL;
    `)
  } catch(e) {}

  // Must run after alterStatements — it depends on flocks.unit_id / batches.unit_id
  // existing. Swallowing the error here is deliberate: the flag stays unset, so a
  // failure retries on the next launch instead of blocking startup.
  try {
    backfillFarmUnits(db)
  } catch (e) {
    console.error('farm_units backfill failed, will retry on next launch:', e.message)
  }

  // Must run after backfillFarmUnits — it relies on that migration having
  // already created a farm_unit for any account that needed one.
  try {
    repairOrphanedUnitIds(db)
  } catch (e) {
    console.error('orphaned unit_id repair failed, will retry on next launch:', e.message)
  }

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
  farm_units: 'unit_id',
  purchase_returns: 'return_id',
  labour: 'labour_id',
  labour_payments: 'payment_id',
  purchase_orders: 'purchase_id',
  sales_orders: 'order_id',
  product_batches: 'batch_id',
  hen_sales: 'hen_sale_id',
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
  feed_traders: 'trader_id',
  feed_entries: 'entry_id',
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
  farms: 'farm_id',
  expense_ledger: 'expense_id',
  categories: 'category_id',
  sales_returns: 'return_id',
  sales_return_items: 'item_id',
  internal_transfers: 'transfer_id',
  assets: 'asset_id',
  personal_expenses: 'pexpense_id'
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


function getLastInsertId(tableName, pk) {
  try {
    const idResult = db.exec('SELECT last_insert_rowid() as id')
    if (idResult && idResult.length > 0 && idResult[0].values && idResult[0].values.length > 0) {
      const id = idResult[0].values[0][0]
      if (id) return id
    }
  } catch (e) {}
  try {
    const fallback = db.exec(`SELECT MAX(${pk}) as id FROM ${tableName}`)
    if (fallback && fallback.length > 0 && fallback[0].values && fallback[0].values.length > 0) {
      return fallback[0].values[0][0]
    }
  } catch (e) {}
  return null
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
    
    const batchId = getLastInsertId('product_batches', 'batch_id')
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
      WHERE product_id = ? AND quantity > 0 AND expiry_date >= date('now')
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

// ── BANK LEDGER ENTRY ──────────────────────────────────────

function addBankLedgerEntry(entry) {
  try {
    const { bank_id, transaction_date, description, debit = 0, credit = 0, reference_type, reference_id, transaction_number } = entry;
    
    // Get current balance
    let currentBalance = 0;
    try {
      const stmt = db.prepare(`
        SELECT COALESCE(SUM(debit - credit), 0) as balance 
        FROM bank_ledger 
        WHERE bank_id = ?
      `);
      stmt.bind([bank_id]);
      const result = stmt.getAsObject();
      stmt.free();
      currentBalance = result.balance || 0;
    } catch (e) {
      console.error('Error getting bank balance:', e.message);
    }
    
    const newBalance = currentBalance + debit - credit;
    
    // Insert ledger entry
    const stmt = db.prepare(`
      INSERT INTO bank_ledger 
      (bank_id, transaction_date, description, debit, credit, balance, reference_type, reference_id, transaction_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([bank_id, transaction_date, description, debit, credit, newBalance, reference_type || null, reference_id || null, transaction_number || null]);
    stmt.free();
    
    // 🔥 CRITICAL: Update the bank account current balance
    db.run(`UPDATE bank_accounts SET current_balance = ? WHERE bank_id = ?`, [newBalance, bank_id]);
    
    return { success: true };
  } catch (err) {
    console.error('Error adding bank ledger entry:', err);
    return { success: false, error: err.message };
  }
}
function updateCustomerOutstandingBalance(customerId) {
  try {
    const stmt = db.prepare(`
      SELECT COALESCE(SUM(MAX(COALESCE(total_amount, 0) - COALESCE(amount_paid, 0), 0)), 0) as balance 
      FROM bills 
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
        l.ledger_id,
        l.customer_id,
        l.transaction_date,
        l.description,
        l.debit,
        l.credit,
        l.reference_type,
        l.reference_id,
        l.created_at,
        c.customer_name,
        c.phone,
        c.address,
        (SELECT COALESCE(SUM(cl.debit - cl.credit), 0)
         FROM customer_ledger cl
         WHERE cl.customer_id = l.customer_id
           AND (
             cl.transaction_date < l.transaction_date OR
             (cl.transaction_date = l.transaction_date AND cl.ledger_id <= l.ledger_id)
           )) as balance
      FROM customer_ledger l
      INNER JOIN customers c ON l.customer_id = c.customer_id
      WHERE l.customer_id = ?
      ORDER BY l.transaction_date ASC, l.ledger_id ASC
    `)
    stmt.bind([customerId])
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
        l.ledger_id,
        l.supplier_id,
        l.transaction_date,
        l.description,
        l.debit,
        l.credit,
        l.reference_type,
        l.reference_id,
        l.created_at,
        s.supplier_name,
        s.phone,
        (SELECT COALESCE(SUM(sl.credit - sl.debit), 0)
         FROM supplier_ledger sl
         WHERE sl.supplier_id = l.supplier_id
           AND (
             sl.transaction_date < l.transaction_date OR
             (sl.transaction_date = l.transaction_date AND sl.ledger_id <= l.ledger_id)
           )) as balance
      FROM supplier_ledger l
      INNER JOIN suppliers s ON l.supplier_id = s.supplier_id
      WHERE l.supplier_id = ?
      ORDER BY l.transaction_date ASC, l.ledger_id ASC
    `)
    stmt.bind([supplierId])
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
        l.ledger_id,
        l.bank_id,
        l.transaction_date,
        l.description,
        l.debit,
        l.credit,
        l.reference_type,
        l.reference_id,
        l.transaction_number,
        l.created_at,
        b.bank_name,
        b.account_number,
        (SELECT COALESCE(SUM(bl.debit - bl.credit), 0)
         FROM bank_ledger bl
         WHERE bl.bank_id = l.bank_id
           AND (
             bl.transaction_date < l.transaction_date OR
             (bl.transaction_date = l.transaction_date AND bl.ledger_id <= l.ledger_id)
           )) as balance
      FROM bank_ledger l
      INNER JOIN bank_accounts b ON l.bank_id = b.bank_id
      WHERE l.bank_id = ?
      ORDER BY l.transaction_date ASC, l.ledger_id ASC
    `)
    stmt.bind([bankId])
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

function addBankAccount(account) {
  try {
    const { farm_id, customer_id, bank_name, account_number, account_holder, opening_balance = 0 } = account;
    
    const stmt = db.prepare(`
      INSERT INTO bank_accounts 
      (farm_id, customer_id, bank_name, account_number, account_holder, opening_balance, current_balance)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run([farm_id, customer_id || null, bank_name, account_number || null, account_holder || null, opening_balance, opening_balance])
    stmt.free()
    
    const bankId = getLastInsertId('bank_accounts', 'bank_id')
    
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
        (SELECT COALESCE(SUM(MAX(COALESCE(total_amount, 0) - COALESCE(amount_paid, 0), 0)), 0) FROM bills WHERE customer_id = c.customer_id) as outstanding_balance
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
    const bankResult = getCustomerBankAccount(customerId);
    if (!bankResult.success || !bankResult.data) {
      return { success: false, error: 'Customer has no bank account' };
    }
    
    const bank = bankResult.data;
    
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

// ── EXPENSE LEDGER OPERATIONS ──────────────────────────────

function addExpense(expense) {
  try {
    const { farm_id, transaction_date, description, amount, category, payment_type, notes } = expense;
    const stmt = db.prepare(`
      INSERT INTO expense_ledger (farm_id, transaction_date, description, amount, category, payment_type, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run([farm_id, transaction_date, description, amount, category || null, payment_type || 'cash', notes || null])
    stmt.free()
    const expenseId = getLastInsertId('expense_ledger', 'expense_id')
    return { success: true, expense_id: expenseId }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function updateExpense(expenseId, data) {
  try {
    const fields = []
    const values = []
    if (data.transaction_date !== undefined) { fields.push('transaction_date = ?'); values.push(data.transaction_date) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.amount !== undefined) { fields.push('amount = ?'); values.push(data.amount) }
    if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category) }
    if (data.payment_type !== undefined) { fields.push('payment_type = ?'); values.push(data.payment_type) }
    if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes) }
    if (fields.length === 0) return { success: false, error: 'No fields to update' }
    values.push(expenseId)
    const sql = `UPDATE expense_ledger SET ${fields.join(', ')} WHERE expense_id = ?`
    db.run(sql, values)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function deleteExpense(expenseId) {
  try {
    db.run(`DELETE FROM expense_ledger WHERE expense_id = ?`, [expenseId])
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function getExpenses(farmId, startDate = null, endDate = null) {
  try {
    let sql = `SELECT * FROM expense_ledger WHERE farm_id = ?`
    const params = [farmId]
    if (startDate && endDate) {
      sql += ` AND transaction_date BETWEEN ? AND ?`
      params.push(startDate, endDate)
    }
    sql += ` ORDER BY transaction_date DESC`
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

function getExpenseCategories(farmId) {
  try {
    const stmt = db.prepare(`
      SELECT category, SUM(amount) as total, COUNT(*) as count
      FROM expense_ledger
      WHERE farm_id = ?
      GROUP BY category
      ORDER BY total DESC
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


// ── CATEGORY OPERATIONS ──────────────────────────────────

function getCategories(farmId) {
  try {
    const stmt = db.prepare('SELECT * FROM categories WHERE farm_id = ? ORDER BY category_name ASC');
    stmt.bind([farmId]);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function addCategory(farmId, categoryName) {
  try {
    db.run('INSERT OR IGNORE INTO categories (farm_id, category_name) VALUES (?, ?)', [farmId, categoryName.toLowerCase().trim()]);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteCategory(categoryId) {
  try {
    db.run('DELETE FROM categories WHERE category_id = ?', [categoryId]);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── FARM UNIT OPERATIONS ─────────────────────────────────
// These go through runQuery/getQuery rather than raw db.run so that writes are
// flushed to disk — a bare db.run() here only mutates the in-memory database.

function getFarmUnits(farmId, moduleType = null) {
  let sql = `SELECT * FROM farm_units WHERE farm_id = ?`
  const params = [farmId]
  if (moduleType) {
    sql += ` AND module_type = ?`
    params.push(moduleType)
  }
  sql += ` ORDER BY unit_name ASC`
  return getQuery(sql, params)
}

function addFarmUnit(unit) {
  const { farm_id, module_type, unit_name, location, notes, status } = unit
  if (!farm_id || !module_type || !unit_name) {
    return { success: false, error: 'farm_id, module_type and unit_name are required' }
  }
  return runQuery(
    `INSERT INTO farm_units (farm_id, module_type, unit_name, location, notes, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [farm_id, module_type, unit_name, location || null, notes || null, status || 'active']
  )
}

function updateFarmUnit(unitId, data) {
  const fields = []
  const values = []

  if (data.unit_name !== undefined) { fields.push('unit_name = ?'); values.push(data.unit_name) }
  if (data.location !== undefined) { fields.push('location = ?'); values.push(data.location) }
  if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes) }
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status) }
  if (data.module_type !== undefined) { fields.push('module_type = ?'); values.push(data.module_type) }

  if (fields.length === 0) return { success: false, error: 'No fields to update' }

  values.push(unitId)
  return runQuery(`UPDATE farm_units SET ${fields.join(', ')} WHERE unit_id = ?`, values)
}

function deleteFarmUnit(unitId) {
  // Foreign keys are declared but never enforced (PRAGMA foreign_keys is never
  // turned on), so this check is the only thing standing between a delete and a
  // set of flocks/batches pointing at a unit that no longer exists.
  const flockCheck = getQuery(`SELECT COUNT(*) AS count FROM flocks WHERE unit_id = ?`, [unitId])
  if (!flockCheck.success) return flockCheck
  const batchCheck = getQuery(`SELECT COUNT(*) AS count FROM batches WHERE unit_id = ?`, [unitId])
  if (!batchCheck.success) return batchCheck

  const flockCount = flockCheck.data[0].count
  const batchCount = batchCheck.data[0].count

  if (flockCount > 0 || batchCount > 0) {
    const parts = []
    if (flockCount > 0) parts.push(`${flockCount} flock(s)`)
    if (batchCount > 0) parts.push(`${batchCount} batch(es)`)
    return {
      success: false,
      error: `Cannot delete this farm — ${parts.join(' and ')} still assigned to it. Move or delete them first.`
    }
  }

  return runQuery(`DELETE FROM farm_units WHERE unit_id = ?`, [unitId])
}

// ── OVERVIEW MODULE: FIXED ASSETS ────────────────────────
// Account-level (farm_id scoped, not flock/batch scoped). Routes through
// runQuery/getQuery so writes are flushed to disk, matching the farm_units
// pattern above.

function getAssets(farmId, status = null) {
  let sql = `SELECT * FROM assets WHERE farm_id = ?`
  const params = [farmId]
  if (status) {
    sql += ` AND status = ?`
    params.push(status)
  }
  sql += ` ORDER BY purchase_date DESC`
  return getQuery(sql, params)
}

function addAsset(asset) {
  const { farm_id, unit_id, asset_name, category, purchase_date, purchase_amount, payment_source, bank_id, notes } = asset
  if (!farm_id || !asset_name || !purchase_date) {
    return { success: false, error: 'farm_id, asset_name and purchase_date are required' }
  }
  return runQuery(
    `INSERT INTO assets (farm_id, unit_id, asset_name, category, purchase_date, purchase_amount, payment_source, bank_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [farm_id, unit_id || null, asset_name, category || null, purchase_date, purchase_amount || 0, payment_source || 'cash', bank_id || null, notes || null]
  )
}

function updateAsset(assetId, data) {
  const fields = []
  const values = []

  if (data.unit_id !== undefined) { fields.push('unit_id = ?'); values.push(data.unit_id) }
  if (data.asset_name !== undefined) { fields.push('asset_name = ?'); values.push(data.asset_name) }
  if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category) }
  if (data.purchase_date !== undefined) { fields.push('purchase_date = ?'); values.push(data.purchase_date) }
  if (data.purchase_amount !== undefined) { fields.push('purchase_amount = ?'); values.push(data.purchase_amount) }
  if (data.payment_source !== undefined) { fields.push('payment_source = ?'); values.push(data.payment_source) }
  if (data.bank_id !== undefined) { fields.push('bank_id = ?'); values.push(data.bank_id) }
  if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes) }

  if (fields.length === 0) return { success: false, error: 'No fields to update' }

  values.push(assetId)
  return runQuery(`UPDATE assets SET ${fields.join(', ')} WHERE asset_id = ?`, values)
}

function sellAsset(assetId, saleDate, saleAmount) {
  const existing = getQuery(`SELECT status FROM assets WHERE asset_id = ?`, [assetId])
  if (!existing.success) return existing
  if (!existing.data || existing.data.length === 0) {
    return { success: false, error: 'Asset not found' }
  }
  if (existing.data[0].status === 'sold') {
    return { success: false, error: 'Asset is already sold' }
  }

  return runQuery(
    `UPDATE assets SET status = 'sold', sale_date = ?, sale_amount = ? WHERE asset_id = ?`,
    [saleDate, saleAmount, assetId]
  )
}

function deleteAsset(assetId) {
  return runQuery(`DELETE FROM assets WHERE asset_id = ?`, [assetId])
}

// ── OVERVIEW MODULE: PERSONAL EXPENSES ───────────────────
// Account-level (farm_id scoped). Kept separate from the shared `expenses`
// table even though its total rolls into the dashboard's expense figure.

function getPersonalExpenses(farmId, fromDate = null, toDate = null) {
  let sql = `SELECT * FROM personal_expenses WHERE farm_id = ?`
  const params = [farmId]
  if (fromDate && toDate) {
    sql += ` AND date BETWEEN ? AND ?`
    params.push(fromDate, toDate)
  }
  sql += ` ORDER BY date DESC`
  return getQuery(sql, params)
}

function addPersonalExpense(pe) {
  const { farm_id, date, category, description, amount, payment_source, bank_id, notes } = pe
  if (!farm_id || !date) {
    return { success: false, error: 'farm_id and date are required' }
  }
  return runQuery(
    `INSERT INTO personal_expenses (farm_id, date, category, description, amount, payment_source, bank_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [farm_id, date, category || null, description || null, amount || 0, payment_source || 'cash', bank_id || null, notes || null]
  )
}

function updatePersonalExpense(id, data) {
  const fields = []
  const values = []

  if (data.date !== undefined) { fields.push('date = ?'); values.push(data.date) }
  if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category) }
  if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
  if (data.amount !== undefined) { fields.push('amount = ?'); values.push(data.amount) }
  if (data.payment_source !== undefined) { fields.push('payment_source = ?'); values.push(data.payment_source) }
  if (data.bank_id !== undefined) { fields.push('bank_id = ?'); values.push(data.bank_id) }
  if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes) }

  if (fields.length === 0) return { success: false, error: 'No fields to update' }

  values.push(id)
  return runQuery(`UPDATE personal_expenses SET ${fields.join(', ')} WHERE pexpense_id = ?`, values)
}

function deletePersonalExpense(id) {
  return runQuery(`DELETE FROM personal_expenses WHERE pexpense_id = ?`, [id])
}

function getAppSetting(farmId, key) {
  try {
    const stmt = db.prepare('SELECT value FROM app_settings WHERE farm_id = ? AND key = ?');
    stmt.bind([farmId, key]);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return { success: true, value: result ? result.value : null };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function setAppSetting(farmId, key, value) {
  try {
    db.run(
      `INSERT INTO app_settings (farm_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(farm_id, key) DO UPDATE SET value = excluded.value`,
      [farmId, key, value]
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}





module.exports = { 
  getAppSetting,
setAppSetting,
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
  getCustomersWithBankAccounts,
  // Expense Ledger functions
  addExpense,
  updateExpense,
  deleteExpense,
  getExpenses,
  getExpenseCategories,
getCategories,
addCategory,
deleteCategory,
  // Farm unit functions
  getFarmUnits,
  addFarmUnit,
  updateFarmUnit,
  deleteFarmUnit,
  // Overview: fixed asset functions
  getAssets,
  addAsset,
  updateAsset,
  sellAsset,
  deleteAsset,
  // Overview: personal expense functions
  getPersonalExpenses,
  addPersonalExpense,
  updatePersonalExpense,
  deletePersonalExpense
}
