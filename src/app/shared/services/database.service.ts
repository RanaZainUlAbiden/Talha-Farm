import { Injectable, NgZone } from '@angular/core';

declare global {
  interface Window {
    electronAPI: {
      dbRun: (sql: string, params?: any[]) => Promise<any>;
      dbGet: (sql: string, params?: any[]) => Promise<any>;
      getMachineId: () => Promise<string>;
    };
  }
}

@Injectable({
  providedIn: 'root'
})
export class DatabaseService {

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
      return this.run('UPDATE product_batches SET status = "depleted" WHERE batch_id = ?', [batchId]);
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
         AND (status = 'active' OR status = 'expiring' OR status IS NULL OR status = '')
         AND quantity > 0`,
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
        AND (b.status = 'active' OR b.status = 'expiring' OR b.status IS NULL OR b.status = '')
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
         AND (status = 'active' OR status = 'expiring' OR status IS NULL OR status = '')
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
        l.*,
        c.customer_name,
        c.phone,
        c.address,
        (SELECT COALESCE(SUM(debit - credit), 0) FROM customer_ledger WHERE customer_id = ? AND ledger_id <= l.ledger_id) as running_balance
       FROM customer_ledger l
       INNER JOIN customers c ON l.customer_id = c.customer_id
       WHERE l.customer_id = ?
       ORDER BY l.transaction_date ASC, l.ledger_id ASC`,
      [customerId, customerId]
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
        (SELECT COALESCE(SUM(total_amount - amount_paid), 0) FROM bills WHERE customer_id = ?)
       WHERE customer_id = ?`,
      [customerId, customerId]
    );
  }

  async getAllCustomersWithBalance(farmId: number): Promise<any> {
    return this.get(
      `SELECT 
        c.*,
        (SELECT COALESCE(SUM(total_amount - amount_paid), 0) FROM bills WHERE customer_id = c.customer_id) as outstanding_balance
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
        l.*,
        s.supplier_name,
        s.phone,
        (SELECT COALESCE(SUM(credit - debit), 0) FROM supplier_ledger WHERE supplier_id = ? AND ledger_id <= l.ledger_id) as running_balance
       FROM supplier_ledger l
       INNER JOIN suppliers s ON l.supplier_id = s.supplier_id
       WHERE l.supplier_id = ?
       ORDER BY l.transaction_date ASC, l.ledger_id ASC`,
      [supplierId, supplierId]
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
        l.*,
        b.bank_name,
        b.account_number,
        (SELECT COALESCE(SUM(debit - credit), 0) FROM bank_ledger WHERE bank_id = ? AND ledger_id <= l.ledger_id) as running_balance
       FROM bank_ledger l
       INNER JOIN bank_accounts b ON l.bank_id = b.bank_id
       WHERE l.bank_id = ?
       ORDER BY l.transaction_date ASC, l.ledger_id ASC`,
      [bankId, bankId]
    );
  }

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
    
    const result = await this.run(
      `INSERT INTO bank_ledger 
       (bank_id, transaction_date, description, debit, credit, balance, reference_type, reference_id, transaction_number)
       VALUES (?, ?, ?, ?, ?, 
         (SELECT COALESCE(SUM(debit - credit), 0) FROM bank_ledger WHERE bank_id = ?) + ? - ?,
         ?, ?, ?)`,
      [bank_id, transaction_date, description, debit, credit, bank_id, debit, credit, reference_type || null, reference_id || null, transaction_number || null]
    );
    
    if (result.success) {
      await this.run(
        `UPDATE bank_accounts SET current_balance = 
          (SELECT COALESCE(SUM(debit - credit), 0) FROM bank_ledger WHERE bank_id = ?)
         WHERE bank_id = ?`,
        [bank_id, bank_id]
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
}