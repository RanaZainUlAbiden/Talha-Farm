import { Injectable, NgZone } from '@angular/core';

/**
 * One statement in a batch. A params entry of `{ $lastId: n }` is replaced, in
 * the main process, with the id inserted by operation `n` of the same batch —
 * `n < 0` counts back from the current operation, so `{ $lastId: -1 }` means
 * "the row the previous statement just inserted".
 */
export interface DbBatchOp {
  sql: string;
  params?: any[];
}

declare global {
  interface Window {
    electronAPI: {
      dbRun: (sql: string, params?: any[]) => Promise<any>;
      dbGet: (sql: string, params?: any[]) => Promise<any>;
      dbRunBatch: (ops: DbBatchOp[]) => Promise<any>;
      dbBeginTransaction: () => Promise<any>;
      dbCommitTransaction: () => Promise<any>;
      dbRollbackTransaction: () => Promise<any>;
      getMachineId: () => Promise<string>;
      backupDatabase: () => Promise<any>;
      restoreDatabase: () => Promise<any>;
      getAutoBackupPath: () => Promise<string | null>;
      resetAutoBackupPath: () => Promise<any>;
    };
  }
}

@Injectable({
  providedIn: 'root'
})
export class DatabaseService {
  async backupDatabase(): Promise<any> {
    return window.electronAPI.backupDatabase();
  }

  async restoreDatabase(): Promise<any> {
    return window.electronAPI.restoreDatabase();
  }

  async getAutoBackupPath(): Promise<string | null> {
    return window.electronAPI.getAutoBackupPath();
  }

  async resetAutoBackupPath(): Promise<any> {
    return window.electronAPI.resetAutoBackupPath();
  }

  constructor(private zone: NgZone) {}

  // ── CORE METHODS ──────────────────────────────────────────

  run(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      window.electronAPI.dbRun(sql, params)
        .then((res: any) => this.zone.run(() => resolve(res)))
        .catch((err: any) => this.zone.run(() => reject(err)));
    });
  }


  get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      window.electronAPI.dbGet(sql, params)
        .then((res: any) => this.zone.run(() => resolve(res)))
        .catch((err: any) => this.zone.run(() => reject(err)));
    });
  }

  /**
   * Runs an ordered list of statements atomically: either all of them commit or
   * none of them do, and the database file is written once instead of once per
   * statement. Use it for a run of writes with no reads in between; where a
   * later statement needs an id an earlier one inserted, reference it with
   * `{ $lastId: n }` rather than making a round trip for it.
   */
  runBatch(ops: DbBatchOp[]): Promise<any> {
    return new Promise((resolve, reject) => {
      window.electronAPI.dbRunBatch(ops)
        .then((res: any) => this.zone.run(() => resolve(res)))
        .catch((err: any) => this.zone.run(() => reject(err)));
    });
  }

  beginTransaction(): Promise<any> {
    return new Promise((resolve, reject) => {
      window.electronAPI.dbBeginTransaction()
        .then((res: any) => this.zone.run(() => resolve(res)))
        .catch((err: any) => this.zone.run(() => reject(err)));
    });
  }

  commitTransaction(): Promise<any> {
    return new Promise((resolve, reject) => {
      window.electronAPI.dbCommitTransaction()
        .then((res: any) => this.zone.run(() => resolve(res)))
        .catch((err: any) => this.zone.run(() => reject(err)));
    });
  }

  rollbackTransaction(): Promise<any> {
    return new Promise((resolve, reject) => {
      window.electronAPI.dbRollbackTransaction()
        .then((res: any) => this.zone.run(() => resolve(res)))
        .catch((err: any) => this.zone.run(() => reject(err)));
    });
  }

  /**
   * Runs `work` inside one database transaction. Everything it writes commits
   * together, and the database file is written once, on commit; if `work`
   * throws, the whole thing is rolled back and the error is re-thrown for the
   * caller to report.
   *
   * Reads issued inside `work` see the transaction's own uncommitted writes,
   * so a step that has to read back what an earlier step wrote still works.
   *
   * Note that run()/get() report failures as `{ success: false }` instead of
   * throwing — check those results and throw, or a failed write will pass
   * unnoticed and the transaction will commit around it.
   */
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    const started = await this.beginTransaction();
    if (!started || !started.success) {
      throw new Error(started?.error || 'Could not start a database transaction');
    }

    let result: T;
    try {
      result = await work();
    } catch (err) {
      const rolledBack = await this.rollbackTransaction();
      if (!rolledBack || !rolledBack.success) {
        console.error('Rollback failed after a transaction error:', rolledBack?.error);
      }
      throw err;
    }

    // commitTransaction() rolls back by itself if the COMMIT fails, so nothing
    // is left half-applied here either.
    const committed = await this.commitTransaction();
    if (!committed || !committed.success) {
      throw new Error(committed?.error || 'Could not commit the database transaction');
    }

    return result;
  }

  getMachineId(): Promise<string> {
    return new Promise((resolve, reject) => {
      window.electronAPI.getMachineId()
        .then((res: string) => this.zone.run(() => resolve(res)))
        .catch((err: any) => this.zone.run(() => reject(err)));
    });
  }

  // ── BATCH METHODS ──────────────────────────────────────────

  async getBatchesByProduct(productId: number, farmId: number): Promise<any> {
    return this.get(
      `SELECT 
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
      ORDER BY b.expiry_date ASC`,
      [productId, farmId]
    );
  }

  async addBatch(batchData: {
    product_id: number;
    farm_id: number;
    batch_code?: string;
    manufacturing_date: string;
    expiry_date: string;
    quantity: number;
    purchase_price?: number;
  }): Promise<any> {
    const { product_id, farm_id, batch_code, manufacturing_date, expiry_date, quantity, purchase_price } = batchData;
    
    let finalBatchCode = batch_code;
    if (!finalBatchCode) {
      const result = await this.get('SELECT COUNT(*) as count FROM product_batches WHERE product_id = ?', [product_id]);
      const count = (result.success && result.data && result.data.length > 0) ? result.data[0].count + 1 : 1;
      finalBatchCode = `BATCH-${String(product_id).padStart(3, '0')}-${String(count).padStart(3, '0')}`;
    }

    const sql = `
      INSERT INTO product_batches 
      (product_id, farm_id, batch_code, manufacturing_date, expiry_date, quantity, purchase_price, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `;
    
    const result = await this.run(sql, [
      product_id,
      farm_id,
      finalBatchCode,
      manufacturing_date,
      expiry_date,
      quantity,
      purchase_price || 0
    ]);

    if (result.success) {
      const batchId = result.lastId;
      
      if (batchId) {
        await this.addBatchTransaction(
          batchId,
          product_id,
          'purchase',
          quantity,
          new Date().toISOString().split('T')[0],
          null,
          'Initial batch addition'
        );
      }
      
      return { success: true, batch_id: batchId, batch_code: finalBatchCode };
    }
    
    return result;
  }

  async updateBatch(batchId: number, data: any): Promise<any> {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.manufacturing_date !== undefined) { fields.push('manufacturing_date = ?'); values.push(data.manufacturing_date); }
    if (data.expiry_date !== undefined) { fields.push('expiry_date = ?'); values.push(data.expiry_date); }
    if (data.quantity !== undefined) { fields.push('quantity = ?'); values.push(data.quantity); }
    if (data.purchase_price !== undefined) { fields.push('purchase_price = ?'); values.push(data.purchase_price); }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }

    if (fields.length === 0) {
      return { success: false, error: 'No fields to update' };
    }

    values.push(batchId);
    const sql = `UPDATE product_batches SET ${fields.join(', ')} WHERE batch_id = ?`;
    return this.run(sql, values);
  }

  async deleteBatch(batchId: number): Promise<any> {
    const checkResult = await this.get('SELECT COUNT(*) as count FROM batch_transactions WHERE batch_id = ?', [batchId]);
    const hasTransactions = checkResult.success && checkResult.data && checkResult.data.length > 0 && checkResult.data[0].count > 0;

    if (hasTransactions) {
      // A soft delete must actually remove the stock, not just relabel it —
      // otherwise quantity-driven stock calculations (getTotalStock, etc.)
      // keep counting it as if nothing happened. Zero the quantity and log
      // the removal so there's still an audit trail.
      const batchResult = await this.get('SELECT product_id, quantity FROM product_batches WHERE batch_id = ?', [batchId]);
      const batch = batchResult.success && batchResult.data && batchResult.data.length > 0 ? batchResult.data[0] : null;
      const qty = batch ? Number(batch.quantity) : 0;

      const result = await this.run('UPDATE product_batches SET status = "depleted", quantity = 0 WHERE batch_id = ?', [batchId]);

      if (batch && qty > 0) {
        await this.addBatchTransaction(
          batchId,
          batch.product_id,
          'adjustment',
          qty,
          new Date().toISOString().split('T')[0],
          null,
          'Batch deleted — stock zeroed'
        );
      }

      return result;
    } else {
      return this.run('DELETE FROM product_batches WHERE batch_id = ?', [batchId]);
    }
  }

  // 🔥 FIXED: getTotalStock - robust status checking includes NULL/empty status
  async getTotalStock(productId: number): Promise<number> {
    const result = await this.get(
      `SELECT COALESCE(SUM(quantity), 0) as total 
       FROM product_batches 
       WHERE product_id = ? 
         AND quantity > 0
         AND expiry_date >= date('now')`,
      [productId]
    );
    return result.success && result.data && result.data.length > 0 ? result.data[0].total : 0;
  }

  // 🔥 NEW: Debug method to check batch status
  async debugGetTotalStock(productId: number): Promise<any> {
    return this.get(
      `SELECT 
        batch_id,
        batch_code,
        quantity,
        status,
        expiry_date,
        julianday(expiry_date) - julianday('now') as days_until_expiry
       FROM product_batches 
       WHERE product_id = ?`,
      [productId]
    );
  }

  async getExpiringBatches(farmId: number, monthsThreshold: number = 3): Promise<any> {
    return this.get(
      `SELECT 
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
      ORDER BY b.expiry_date ASC`,
      [farmId, monthsThreshold]
    );
  }

  async hasExpiringBatches(productId: number, monthsThreshold: number = 3): Promise<boolean> {
    const result = await this.get(
      `SELECT COUNT(*) as count
       FROM product_batches
       WHERE product_id = ?
         AND quantity > 0
         AND julianday(expiry_date) - julianday('now') <= (? * 30.44)
         AND julianday(expiry_date) - julianday('now') > 0`,
      [productId, monthsThreshold]
    );
    return result.success && result.data && result.data.length > 0 && result.data[0].count > 0;
  }

  async addBatchTransaction(
    batchId: number,
    productId: number,
    type: string,
    quantity: number,
    transactionDate: string,
    referenceId: number | null = null,
    notes: string = ''
  ): Promise<any> {
    return this.run(
      `INSERT INTO batch_transactions 
       (batch_id, product_id, type, quantity, transaction_date, reference_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [batchId, productId, type, quantity, transactionDate, referenceId, notes]
    );
  }

  async getBatchTransactions(batchId: number): Promise<any> {
    return this.get(
      `SELECT * FROM batch_transactions 
       WHERE batch_id = ? 
       ORDER BY transaction_date DESC, created_at DESC`,
      [batchId]
    );
  }

  async getBatchById(batchId: number): Promise<any> {
    const result = await this.get(
      `SELECT 
        b.*,
        p.product_name,
        p.unit,
        julianday(b.expiry_date) - julianday('now') as days_until_expiry
      FROM product_batches b
      INNER JOIN products p ON b.product_id = p.product_id
      WHERE b.batch_id = ?`,
      [batchId]
    );
    return result.success && result.data && result.data.length > 0 ? result.data[0] : null;
  }

  async updateBatchStatuses(): Promise<any> {
    return this.run(`
      UPDATE product_batches SET status = 'expired' 
      WHERE expiry_date < date('now') AND (status IN ('active', 'expiring') OR status IS NULL OR status = '');
      
      UPDATE product_batches SET status = 'depleted' 
      WHERE quantity <= 0 AND (status IN ('active', 'expiring') OR status IS NULL OR status = '');
      
      UPDATE product_batches SET status = 'expiring' 
      WHERE expiry_date >= date('now') 
        AND expiry_date <= date('now', '+3 months')
        AND quantity > 0
        AND (status = 'active' OR status IS NULL OR status = '');
    `, []);
  }

  async migrateExistingStock(farmId: number): Promise<any> {
    const products = await this.get(
      'SELECT product_id, product_name, current_stock, cost_price FROM products WHERE farm_id = ? AND current_stock > 0',
      [farmId]
    );
    
    if (!products.success || !products.data) {
      return { success: false, error: 'Failed to fetch products' };
    }

    let migrated = 0;
    const today = new Date().toISOString().split('T')[0];
    const oneYearLater = new Date();
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
    const expiryDate = oneYearLater.toISOString().split('T')[0];

    for (const product of products.data) {
      const checkResult = await this.get('SELECT COUNT(*) as count FROM product_batches WHERE product_id = ?', [product.product_id]);
      const hasBatches = checkResult.success && checkResult.data && checkResult.data.length > 0 && checkResult.data[0].count > 0;

      if (!hasBatches && product.current_stock > 0) {
        const batchCode = `BATCH-${String(product.product_id).padStart(3, '0')}-001`;
        
        const result = await this.run(
          `INSERT INTO product_batches 
           (product_id, farm_id, batch_code, manufacturing_date, expiry_date, quantity, purchase_price, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
          [product.product_id, farmId, batchCode, today, expiryDate, product.current_stock, product.cost_price || 0]
        );

        if (result.success) {
          const batchId = result.lastId;
          
          if (batchId) {
            await this.addBatchTransaction(
              batchId,
              product.product_id,
              'purchase',
              product.current_stock,
              today,
              null,
              'Migrated from existing stock'
            );
            migrated++;
          }
        }
      }
    }

    return { success: true, migrated };
  }

  // ── CUSTOMER LEDGER METHODS ──────────────────────────────

  async getCustomerLedger(customerId: number): Promise<any> {
    return this.get(
      `SELECT * FROM customer_ledger 
       WHERE customer_id = ? 
       ORDER BY transaction_date ASC, ledger_id ASC`,
      [customerId]
    );
  }

  async getCustomerLedgerWithBalance(customerId: number): Promise<any> {
    return this.get(
      `SELECT 
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
       ORDER BY l.transaction_date ASC, l.ledger_id ASC`,
      [customerId]
    );
  }

  async addCustomerLedgerEntry(entry: {
    customer_id: number;
    transaction_date: string;
    description: string;
    debit?: number;
    credit?: number;
    reference_type?: string;
    reference_id?: number;
  }): Promise<any> {
    const { customer_id, transaction_date, description, debit = 0, credit = 0, reference_type, reference_id } = entry;
    
    return this.run(
      `INSERT INTO customer_ledger 
       (customer_id, transaction_date, description, debit, credit, balance, reference_type, reference_id)
       VALUES (?, ?, ?, ?, ?, 
         (SELECT COALESCE(SUM(debit - credit), 0) FROM customer_ledger WHERE customer_id = ?) + ? - ?,
         ?, ?)`,
      [customer_id, transaction_date, description, debit, credit, customer_id, debit, credit, reference_type || null, reference_id || null]
    );
  }

  async updateCustomerOutstandingBalance(customerId: number): Promise<any> {
    return this.run(
      `UPDATE customers SET outstanding_balance = 
        (SELECT COALESCE(SUM(MAX(COALESCE(total_amount, 0) - COALESCE(amount_paid, 0), 0)), 0) FROM bills WHERE customer_id = ?)
       WHERE customer_id = ?`,
      [customerId, customerId]
    );
  }

  async getAllCustomersWithBalance(farmId: number): Promise<any> {
    return this.get(
      `SELECT 
        c.*,
        (SELECT COALESCE(SUM(MAX(COALESCE(total_amount, 0) - COALESCE(amount_paid, 0), 0)), 0) FROM bills WHERE customer_id = c.customer_id) as outstanding_balance
       FROM customers c
       WHERE c.farm_id = ?
       ORDER BY c.customer_name ASC`,
      [farmId]
    );
  }

  // ── SUPPLIER LEDGER METHODS ──────────────────────────────

  async getSupplierLedger(supplierId: number): Promise<any> {
    return this.get(
      `SELECT * FROM supplier_ledger 
       WHERE supplier_id = ? 
       ORDER BY transaction_date ASC, ledger_id ASC`,
      [supplierId]
    );
  }

  async getSupplierLedgerWithBalance(supplierId: number): Promise<any> {
    return this.get(
      `SELECT 
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
       ORDER BY l.transaction_date ASC, l.ledger_id ASC`,
      [supplierId]
    );
  }

  async addSupplierLedgerEntry(entry: {
    supplier_id: number;
    transaction_date: string;
    description: string;
    debit?: number;
    credit?: number;
    reference_type?: string;
    reference_id?: number;
  }): Promise<any> {
    const { supplier_id, transaction_date, description, debit = 0, credit = 0, reference_type, reference_id } = entry;
    
    return this.run(
      `INSERT INTO supplier_ledger 
       (supplier_id, transaction_date, description, debit, credit, balance, reference_type, reference_id)
       VALUES (?, ?, ?, ?, ?, 
         (SELECT COALESCE(SUM(credit - debit), 0) FROM supplier_ledger WHERE supplier_id = ?) + ? - ?,
         ?, ?)`,
      [supplier_id, transaction_date, description, debit, credit, supplier_id, credit, debit, reference_type || null, reference_id || null]
    );
  }

  async getAllSuppliersWithBalance(farmId: number): Promise<any> {
    return this.get(
      `SELECT 
        s.*,
        (SELECT COALESCE(SUM(credit - debit), 0) FROM supplier_ledger WHERE supplier_id = s.supplier_id) as outstanding_balance
       FROM suppliers s
       WHERE s.farm_id = ?
       ORDER BY s.supplier_name ASC`,
      [farmId]
    );
  }

  // ── BANK LEDGER METHODS ──────────────────────────────────

  async getBankAccounts(farmId: number): Promise<any> {
    return this.get(
      `SELECT 
        ba.*,
        c.customer_name
       FROM bank_accounts ba
       LEFT JOIN customers c ON ba.customer_id = c.customer_id
       WHERE ba.farm_id = ?
       ORDER BY ba.bank_name ASC`,
      [farmId]
    );
  }

  async getBankAccount(bankId: number): Promise<any> {
    const result = await this.get(
      `SELECT 
        ba.*,
        c.customer_name
       FROM bank_accounts ba
       LEFT JOIN customers c ON ba.customer_id = c.customer_id
       WHERE ba.bank_id = ?`,
      [bankId]
    );
    return result.success && result.data && result.data.length > 0 ? result.data[0] : null;
  }

  async addBankAccount(account: {
    farm_id: number;
    customer_id: number;
    bank_name: string;
    account_number?: string;
    account_holder?: string;
    opening_balance?: number;
  }): Promise<any> {
    const { farm_id, customer_id, bank_name, account_number, account_holder, opening_balance = 0 } = account;
    
    const result = await this.run(
      `INSERT INTO bank_accounts 
       (farm_id, customer_id, bank_name, account_number, account_holder, opening_balance, current_balance)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [farm_id, customer_id, bank_name, account_number || null, account_holder || null, opening_balance, opening_balance]
    );
    
    if (result.success && result.lastId && opening_balance > 0) {
      await this.addBankLedgerEntry({
        bank_id: result.lastId,
        transaction_date: new Date().toISOString().split('T')[0],
        description: 'Opening Balance',
        debit: opening_balance,
        credit: 0,
        reference_type: 'opening',
        reference_id: null
      });
    }
    
    if (result.success && result.lastId) {
      await this.linkCustomerToBank(customer_id, result.lastId);
    }
    
    return result;
  }

  async updateBankAccount(bankId: number, data: any): Promise<any> {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.bank_name !== undefined) { fields.push('bank_name = ?'); values.push(data.bank_name); }
    if (data.account_number !== undefined) { fields.push('account_number = ?'); values.push(data.account_number); }
    if (data.account_holder !== undefined) { fields.push('account_holder = ?'); values.push(data.account_holder); }

    if (fields.length === 0) return { success: false, error: 'No fields to update' };

    values.push(bankId);
    const sql = `UPDATE bank_accounts SET ${fields.join(', ')} WHERE bank_id = ?`;
    return this.run(sql, values);
  }

  async deleteBankAccount(bankId: number): Promise<any> {
    return this.run('DELETE FROM bank_accounts WHERE bank_id = ?', [bankId]);
  }

  async getBankLedger(bankId: number): Promise<any> {
    return this.get(
      `SELECT * FROM bank_ledger 
       WHERE bank_id = ? 
       ORDER BY transaction_date ASC, ledger_id ASC`,
      [bankId]
    );
  }

  async getBankLedgerWithBalance(bankId: number): Promise<any> {
    return this.get(
      `SELECT 
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
       ORDER BY l.transaction_date ASC, l.ledger_id ASC`,
      [bankId]
    );
  }
// ── BANK LEDGER ENTRY ──────────────────────────────────────

async addBankLedgerEntry(entry: {
  bank_id: number;
  transaction_date: string;
  description: string;
  debit?: number;
  credit?: number;
  reference_type?: string;
  reference_id?: number | null;
  transaction_number?: string;
}): Promise<any> {
  const { bank_id, transaction_date, description, debit = 0, credit = 0, reference_type, reference_id, transaction_number } = entry;
  
  // Get current balance
  const balanceResult = await this.get(
    'SELECT COALESCE(SUM(debit - credit), 0) as balance FROM bank_ledger WHERE bank_id = ?',
    [bank_id]
  );
  const currentBalance = balanceResult.success && balanceResult.data && balanceResult.data.length > 0 
    ? balanceResult.data[0].balance || 0 
    : 0;
  
  const newBalance = currentBalance + debit - credit;
  
  // Insert ledger entry
  const result = await this.run(
    `INSERT INTO bank_ledger 
     (bank_id, transaction_date, description, debit, credit, balance, reference_type, reference_id, transaction_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [bank_id, transaction_date, description, debit, credit, newBalance, reference_type || null, reference_id || null, transaction_number || null]
  );
  
  // 🔥 CRITICAL: Update the bank account current balance
  if (result.success) {
    await this.run(
      'UPDATE bank_accounts SET current_balance = ? WHERE bank_id = ?',
      [newBalance, bank_id]
    );
  }
  
  return result;
}

  // ── CUSTOMER BANK ACCOUNT METHODS ──────────────────────────

  async getCustomerBankAccount(customerId: number): Promise<any> {
    return this.get(
      `SELECT ba.* 
       FROM bank_accounts ba
       INNER JOIN customers c ON c.bank_id = ba.bank_id
       WHERE c.customer_id = ?`,
      [customerId]
    );
  }

  async getCustomerBankBalance(customerId: number): Promise<number> {
    const result = await this.get(
      `SELECT ba.current_balance 
       FROM bank_accounts ba
       INNER JOIN customers c ON c.bank_id = ba.bank_id
       WHERE c.customer_id = ?`,
      [customerId]
    );
    return result.success && result.data && result.data.length > 0 ? result.data[0].current_balance : 0;
  }

  async deductCustomerBank(customerId: number, amount: number, description: string): Promise<any> {
    const bankResult = await this.getCustomerBankAccount(customerId);
    if (!bankResult.success || !bankResult.data || bankResult.data.length === 0) {
      return { success: false, error: 'Customer has no bank account' };
    }
    
    const bank = bankResult.data[0];
    
    return this.addBankLedgerEntry({
      bank_id: bank.bank_id,
      transaction_date: new Date().toISOString().split('T')[0],
      description: description,
      debit: 0,
      credit: amount,
      reference_type: 'payment',
      reference_id: null
    });
  }

  async linkCustomerToBank(customerId: number, bankId: number): Promise<any> {
    return this.run(
      `UPDATE customers SET bank_id = ? WHERE customer_id = ?`,
      [bankId, customerId]
    );
  }

  async getCustomersWithBankAccounts(farmId: number): Promise<any> {
    return this.get(
      `SELECT 
        c.*,
        ba.bank_id,
        ba.bank_name,
        ba.current_balance
       FROM customers c
       LEFT JOIN bank_accounts ba ON c.bank_id = ba.bank_id
       WHERE c.farm_id = ?
       ORDER BY c.customer_name ASC`,
      [farmId]
    );
  }

  // ── EXPENSE LEDGER METHODS ──────────────────────────────────

  async getExpenses(farmId: number, startDate?: string, endDate?: string): Promise<any> {
    let sql = 'SELECT * FROM expense_ledger WHERE farm_id = ?';
    const params: any[] = [farmId];
    if (startDate && endDate) {
      sql += ' AND transaction_date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }
    sql += ' ORDER BY transaction_date DESC';
    return this.get(sql, params);
  }

  async addExpense(expense: {
    farm_id: number;
    transaction_date: string;
    description: string;
    amount: number;
    category?: string;
    payment_type?: string;
    notes?: string;
  }): Promise<any> {
    const { farm_id, transaction_date, description, amount, category, payment_type, notes } = expense;
    return this.run(
      `INSERT INTO expense_ledger 
       (farm_id, transaction_date, description, amount, category, payment_type, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [farm_id, transaction_date, description, amount, category || null, payment_type || 'cash', notes || null]
    );
  }

  async updateExpense(expenseId: number, data: any): Promise<any> {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.transaction_date !== undefined) { fields.push('transaction_date = ?'); values.push(data.transaction_date); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.amount !== undefined) { fields.push('amount = ?'); values.push(data.amount); }
    if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category); }
    if (data.payment_type !== undefined) { fields.push('payment_type = ?'); values.push(data.payment_type); }
    if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes); }

    if (fields.length === 0) return { success: false, error: 'No fields to update' };
    values.push(expenseId);
    const sql = `UPDATE expense_ledger SET ${fields.join(', ')} WHERE expense_id = ?`;
    return this.run(sql, values);
  }

  async deleteExpense(expenseId: number): Promise<any> {
    return this.run('DELETE FROM expense_ledger WHERE expense_id = ?', [expenseId]);
  }

  async getExpenseCategories(farmId: number): Promise<any> {
    return this.get(
      `SELECT category, SUM(amount) as total, COUNT(*) as count
       FROM expense_ledger
       WHERE farm_id = ?
       GROUP BY category
       ORDER BY total DESC`,
      [farmId]
    );
  }

// ── CATEGORY METHODS ──────────────────────────────────

async getCategories(farmId: number, type: string = 'product'): Promise<any> {
  return this.get('SELECT * FROM categories WHERE farm_id = ? AND category_type = ? ORDER BY category_name ASC', [farmId, type]);
}

async addCategory(farmId: number, categoryName: string, type: string = 'product'): Promise<any> {
  return this.run('INSERT INTO categories (farm_id, category_name, category_type) VALUES (?, ?, ?)', [farmId, categoryName.toLowerCase().trim(), type]);
}

async deleteCategory(categoryId: number): Promise<any> {
  return this.run('DELETE FROM categories WHERE category_id = ?', [categoryId]);
}

  // 🔥 NEW: Force update batch statuses for a specific product
  async forceUpdateBatchStatuses(productId: number): Promise<any> {
    return this.run(`
      UPDATE product_batches 
      SET status = 'expired' 
      WHERE product_id = ? AND expiry_date < date('now') 
        AND (status IN ('active', 'expiring') OR status IS NULL OR status = '');
      
      UPDATE product_batches 
      SET status = 'depleted' 
      WHERE product_id = ? AND quantity <= 0 
        AND (status IN ('active', 'expiring') OR status IS NULL OR status = '');
      
      UPDATE product_batches 
      SET status = 'expiring' 
      WHERE product_id = ? 
        AND expiry_date >= date('now') 
        AND expiry_date <= date('now', '+3 months')
        AND quantity > 0
        AND (status = 'active' OR status IS NULL OR status = '');
    `, [productId, productId, productId]);
  }

  // 🔥 NEW: Get all batches with their calculated status
  async getAllBatchesWithStatus(farmId: number): Promise<any> {
    return this.get(
      `SELECT 
        b.*,
        p.product_name,
        CASE 
          WHEN b.status = 'expired' THEN 'expired'
          WHEN julianday(b.expiry_date) - julianday('now') <= 90 AND b.quantity > 0 THEN 'expiring'
          WHEN b.quantity <= 0 THEN 'depleted'
          WHEN b.status IS NULL OR b.status = '' THEN 'active'
          ELSE b.status
        END as calculated_status
      FROM product_batches b
      INNER JOIN products p ON b.product_id = p.product_id
      WHERE b.farm_id = ?
      ORDER BY p.product_name ASC, b.expiry_date ASC`,
      [farmId]
    );
  }

  // ── FARM UNIT METHODS ──────────────────────────────────────
  // "Farm" in the UI. `farms` is the login account, so the physical-site level
  // is farm_units. Everything here routes through run()/get(), so preload.js
  // needs no new bridge method.

  async getFarmUnits(farmId: number, moduleType?: string): Promise<any> {
    let sql = 'SELECT * FROM farm_units WHERE farm_id = ?';
    const params: any[] = [farmId];
    if (moduleType) {
      sql += ' AND module_type = ?';
      params.push(moduleType);
    }
    sql += ' ORDER BY unit_name ASC';
    return this.get(sql, params);
  }

  async addFarmUnit(unit: {
    farm_id: number;
    module_type: string;
    unit_name: string;
    location?: string;
    notes?: string;
    status?: string;
  }): Promise<any> {
    const { farm_id, module_type, unit_name, location, notes, status } = unit;
    if (!farm_id || !module_type || !unit_name) {
      return { success: false, error: 'farm_id, module_type and unit_name are required' };
    }
    return this.run(
      `INSERT INTO farm_units (farm_id, module_type, unit_name, location, notes, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [farm_id, module_type, unit_name, location || null, notes || null, status || 'active']
    );
  }

  async updateFarmUnit(unitId: number, data: any): Promise<any> {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.unit_name !== undefined) { fields.push('unit_name = ?'); values.push(data.unit_name); }
    if (data.location !== undefined) { fields.push('location = ?'); values.push(data.location); }
    if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes); }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
    if (data.module_type !== undefined) { fields.push('module_type = ?'); values.push(data.module_type); }

    if (fields.length === 0) return { success: false, error: 'No fields to update' };

    values.push(unitId);
    return this.run(`UPDATE farm_units SET ${fields.join(', ')} WHERE unit_id = ?`, values);
  }

  async deleteFarmUnit(unitId: number): Promise<any> {
    // Foreign keys are declared but never enforced in this database, so this
    // check is the only thing preventing flocks/batches from being orphaned.
    const flockCheck = await this.get('SELECT COUNT(*) AS count FROM flocks WHERE unit_id = ?', [unitId]);
    if (!flockCheck.success) return flockCheck;
    const batchCheck = await this.get('SELECT COUNT(*) AS count FROM batches WHERE unit_id = ?', [unitId]);
    if (!batchCheck.success) return batchCheck;

    const flockCount = flockCheck.data?.[0]?.count ?? 0;
    const batchCount = batchCheck.data?.[0]?.count ?? 0;

    if (flockCount > 0 || batchCount > 0) {
      const parts: string[] = [];
      if (flockCount > 0) parts.push(`${flockCount} flock(s)`);
      if (batchCount > 0) parts.push(`${batchCount} batch(es)`);
      return {
        success: false,
        error: `Cannot delete this farm — ${parts.join(' and ')} still assigned to it. Move or delete them first.`
      };
    }

    return this.run('DELETE FROM farm_units WHERE unit_id = ?', [unitId]);
  }

  // ── OVERVIEW: FIXED ASSET METHODS ───────────────────────────
  // Account-level (farm_id scoped, not flock/batch scoped). No depreciation —
  // gain/loss is only recognised when an asset is sold.

  async getAssets(farmId: number, status?: string): Promise<any> {
    let sql = 'SELECT * FROM assets WHERE farm_id = ?';
    const params: any[] = [farmId];
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY purchase_date DESC';
    return this.get(sql, params);
  }

  async addAsset(asset: {
    farm_id: number;
    unit_id?: number;
    asset_name: string;
    category?: string;
    purchase_date: string;
    purchase_amount?: number;
    payment_source?: string;
    bank_id?: number;
    notes?: string;
  }): Promise<any> {
    const { farm_id, unit_id, asset_name, category, purchase_date, purchase_amount, payment_source, bank_id, notes } = asset;
    if (!farm_id || !asset_name || !purchase_date) {
      return { success: false, error: 'farm_id, asset_name and purchase_date are required' };
    }
    return this.run(
      `INSERT INTO assets (farm_id, unit_id, asset_name, category, purchase_date, purchase_amount, payment_source, bank_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [farm_id, unit_id || null, asset_name, category || null, purchase_date, purchase_amount || 0, payment_source || 'cash', bank_id || null, notes || null]
    );
  }

  async updateAsset(assetId: number, data: any): Promise<any> {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.unit_id !== undefined) { fields.push('unit_id = ?'); values.push(data.unit_id); }
    if (data.asset_name !== undefined) { fields.push('asset_name = ?'); values.push(data.asset_name); }
    if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category); }
    if (data.purchase_date !== undefined) { fields.push('purchase_date = ?'); values.push(data.purchase_date); }
    if (data.purchase_amount !== undefined) { fields.push('purchase_amount = ?'); values.push(data.purchase_amount); }
    if (data.payment_source !== undefined) { fields.push('payment_source = ?'); values.push(data.payment_source); }
    if (data.bank_id !== undefined) { fields.push('bank_id = ?'); values.push(data.bank_id); }
    if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes); }

    if (fields.length === 0) return { success: false, error: 'No fields to update' };

    values.push(assetId);
    return this.run(`UPDATE assets SET ${fields.join(', ')} WHERE asset_id = ?`, values);
  }

  async sellAsset(assetId: number, saleDate: string, saleAmount: number): Promise<any> {
    const existing = await this.get('SELECT status FROM assets WHERE asset_id = ?', [assetId]);
    if (!existing.success) return existing;
    if (!existing.data || existing.data.length === 0) {
      return { success: false, error: 'Asset not found' };
    }
    if (existing.data[0].status === 'sold') {
      return { success: false, error: 'Asset is already sold' };
    }

    return this.run(
      `UPDATE assets SET status = 'sold', sale_date = ?, sale_amount = ? WHERE asset_id = ?`,
      [saleDate, saleAmount, assetId]
    );
  }

  async deleteAsset(assetId: number): Promise<any> {
    return this.run('DELETE FROM assets WHERE asset_id = ?', [assetId]);
  }

  // ── OVERVIEW: PERSONAL EXPENSE METHODS ──────────────────────
  // Account-level (farm_id scoped). Kept separate from the shared `expenses`
  // table even though its total rolls into the dashboard's expense figure.

  async getPersonalExpenses(farmId: number, fromDate?: string, toDate?: string): Promise<any> {
    let sql = 'SELECT * FROM personal_expenses WHERE farm_id = ?';
    const params: any[] = [farmId];
    if (fromDate && toDate) {
      sql += ' AND date BETWEEN ? AND ?';
      params.push(fromDate, toDate);
    }
    sql += ' ORDER BY date DESC';
    return this.get(sql, params);
  }

  async addPersonalExpense(pe: {
    farm_id: number;
    date: string;
    category?: string;
    description?: string;
    amount?: number;
    payment_source?: string;
    bank_id?: number;
    notes?: string;
  }): Promise<any> {
    const { farm_id, date, category, description, amount, payment_source, bank_id, notes } = pe;
    if (!farm_id || !date) {
      return { success: false, error: 'farm_id and date are required' };
    }
    return this.run(
      `INSERT INTO personal_expenses (farm_id, date, category, description, amount, payment_source, bank_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [farm_id, date, category || null, description || null, amount || 0, payment_source || 'cash', bank_id || null, notes || null]
    );
  }

  async updatePersonalExpense(id: number, data: any): Promise<any> {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.date !== undefined) { fields.push('date = ?'); values.push(data.date); }
    if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.amount !== undefined) { fields.push('amount = ?'); values.push(data.amount); }
    if (data.payment_source !== undefined) { fields.push('payment_source = ?'); values.push(data.payment_source); }
    if (data.bank_id !== undefined) { fields.push('bank_id = ?'); values.push(data.bank_id); }
    if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes); }

    if (fields.length === 0) return { success: false, error: 'No fields to update' };

    values.push(id);
    return this.run(`UPDATE personal_expenses SET ${fields.join(', ')} WHERE pexpense_id = ?`, values);
  }

  async deletePersonalExpense(id: number): Promise<any> {
    return this.run('DELETE FROM personal_expenses WHERE pexpense_id = ?', [id]);
  }
}
