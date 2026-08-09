import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';

@Component({
  selector: 'app-sales-returns',
  standalone: true,
  imports: [CommonModule, FormsModule, DateOnlyPipe],
  templateUrl: './sales-returns.component.html',
  styleUrl: './sales-returns.component.scss'
})
export class SalesReturnsComponent implements OnInit {
  currentFarm: any = null;
  bills: any[] = [];
  returns: any[] = [];
  selectedBill: any = null;
  returnRows: any[] = [];
  returnDate = new Date().toISOString().split('T')[0];
  reason = '';
  refundMethod: 'cash' | 'bank' = 'cash';
  isLoading = true;
  isSaving = false;
  errorMessage = '';
  successMessage = '';

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadData();
  }

  // ── Computed getters ─────────────────────────────────────────

  get totalReturnAmount(): number {
    return this.returnRows.reduce((sum, row) => sum + this.getRowReturnAmount(row), 0);
  }

  get totalReturnsAmount(): number {
    return this.returns.reduce((sum, r) => sum + (Number(r.return_amount) || 0), 0);
  }

  get newBillTotal(): number {
    return Math.max((Number(this.selectedBill?.total_amount) || 0) - this.totalReturnAmount, 0);
  }

  get refundDue(): number {
    const paid = Number(this.selectedBill?.amount_paid) || 0;
    return Math.max(paid - this.newBillTotal, 0);
  }

  getRowReturnAmount(row: any): number {
    const qty = Number(row.return_quantity) || 0;
    return qty * (Number(row.unit_price) || 0);
  }

  // ── Data Loading ─────────────────────────────────────────────

  async loadData() {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const [billsResult, returnsResult] = await Promise.all([
        this.db.get(
          `SELECT b.*,
                  COALESCE(SUM(sr.return_amount), 0) AS returned_amount
           FROM bills b
           LEFT JOIN sales_returns sr ON sr.bill_id = b.bill_id
           WHERE b.farm_id = ?
             AND COALESCE(b.status, 'completed') != 'returned'
           GROUP BY b.bill_id
           ORDER BY b.bill_date DESC, b.bill_id DESC`,
          [this.currentFarm.farm_id]
        ),
        this.db.get(
          `SELECT sr.*, b.bill_number, b.customer_name
           FROM sales_returns sr
           JOIN bills b ON b.bill_id = sr.bill_id
           WHERE sr.farm_id = ?
           ORDER BY sr.return_date DESC, sr.return_id DESC`,
          [this.currentFarm.farm_id]
        )
      ]);
      this.bills = billsResult.success ? billsResult.data : [];
      this.returns = returnsResult.success ? returnsResult.data : [];
    } catch (error: any) {
      this.errorMessage = 'Failed to load returns: ' + error.message;
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  // ── Bill Selection ────────────────────────────────────────────

  async selectBill(bill: any) {
    this.selectedBill = bill;
    this.reason = '';
    this.returnDate = new Date().toISOString().split('T')[0];
    this.errorMessage = '';
    this.successMessage = '';

    const itemsResult = await this.db.get(
      `SELECT * FROM bill_items WHERE bill_id = ? AND quantity > 0 ORDER BY item_id ASC`,
      [bill.bill_id]
    );
    const items = itemsResult.success ? itemsResult.data : [];
    this.returnRows = items.map((item: any) => ({
      bill_item_id: item.item_id,
      product_id: item.product_id,
      product_name: item.product_name,
      sold_quantity: Number(item.quantity) || 0,
      unit_price: Number(item.unit_price) || 0,
      return_quantity: null
    }));
    this.cdr.detectChanges();
  }

  clearSelection() {
    this.selectedBill = null;
    this.returnRows = [];
    this.reason = '';
    this.errorMessage = '';
    this.successMessage = '';
    this.cdr.detectChanges();
  }

  // ── Save Return ───────────────────────────────────────────────

  async saveReturn() {
    if (!this.selectedBill || this.isSaving) return;

    // Validate rows
    const rows = this.returnRows.filter(row => (Number(row.return_quantity) || 0) > 0);
    if (rows.length === 0) {
      this.errorMessage = 'Enter at least one return quantity.';
      return;
    }
    for (const row of rows) {
      const qty = Number(row.return_quantity) || 0;
      if (qty <= 0 || qty > row.sold_quantity) {
        this.errorMessage = `Return qty for "${row.product_name}" must be between 1 and ${row.sold_quantity}.`;
        return;
      }
    }

    this.isSaving = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const returnNumber  = await this.getNextReturnNumber();
      const returnAmount  = this.totalReturnAmount;
      const oldPaid       = Number(this.selectedBill.amount_paid) || 0;
      const nextTotal     = this.newBillTotal;
      const nextPaid      = Math.min(oldPaid, nextTotal);
      const refundAmount  = oldPaid - nextPaid;

      // 1. Insert sales_returns header
      const insertReturn = await this.db.run(
        `INSERT INTO sales_returns
          (farm_id, bill_id, return_number, return_date, return_amount, refund_amount, refund_method, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          this.currentFarm.farm_id,
          this.selectedBill.bill_id,
          returnNumber,
          this.returnDate,
          returnAmount,
          refundAmount,
          this.refundMethod,
          this.reason || null
        ]
      );

      if (!insertReturn.success) throw new Error('Failed to create return record: ' + insertReturn.error);
      const returnId = insertReturn.lastId;
      if (!returnId) throw new Error('Return ID not obtained — check PRIMARY_KEY_MAP.');

      // 2. Insert return items + restore stock + reduce bill items
      for (const row of rows) {
        const qty      = Number(row.return_quantity) || 0;
        const rowTotal = qty * (Number(row.unit_price) || 0);

        await this.db.run(
          `INSERT INTO sales_return_items
            (return_id, bill_id, bill_item_id, product_id, product_name, quantity, unit_price, total_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [returnId, this.selectedBill.bill_id, row.bill_item_id, row.product_id ?? null, row.product_name, qty, row.unit_price, rowTotal]
        );

        // Restore stock only if product_id is known (distribution items)
        if (row.product_id) {
          await this.restoreReturnedStock(row, qty, returnId, returnNumber);
        }

        await this.reduceBillItem(row, qty);
      }

      // 3. Update bill totals and status
      const newStatus = nextTotal === 0 ? 'returned' : 'partial_return';
      await this.db.run(
        `UPDATE bills SET subtotal = ?, total_amount = ?, amount_paid = ?, status = ? WHERE bill_id = ?`,
        [nextTotal, nextTotal, nextPaid, newStatus, this.selectedBill.bill_id]
      );

      // 4. Rebuild customer ledger (if customer-linked bill)
      if (this.selectedBill.customer_id) {
        await this.rebuildCustomerLedger(this.selectedBill, nextTotal, nextPaid);
      }

      // 5. Bank refund (if applicable)
      if (refundAmount > 0 && this.refundMethod === 'bank' && this.selectedBill.customer_id) {
        await this.refundCustomerBank(this.selectedBill.customer_id, refundAmount, `Refund - ${returnNumber}`);
      }

      // 6. Rebuild internal-transfer expenses (if internal sale)
      if (this.selectedBill.payment_type === 'internal') {
        await this.rebuildInternalTransferExpenses(this.selectedBill.bill_id);
      }

      this.successMessage = `Return ${returnNumber} saved successfully.`;
      this.clearSelection();
      await this.loadData();
    } catch (error: any) {
      this.errorMessage = 'Failed to save return: ' + error.message;
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  // ── Private Helpers ───────────────────────────────────────────

  private async getNextReturnNumber(): Promise<string> {
    const result = await this.db.get(
      `SELECT COALESCE(MAX(CAST(SUBSTR(return_number, 5) AS INTEGER)), 0) + 1 AS next_number
       FROM sales_returns
       WHERE farm_id = ? AND return_number LIKE 'RET-%'`,
      [this.currentFarm.farm_id]
    );
    const num = result.success && result.data && result.data[0]
      ? result.data[0].next_number
      : 1;
    return 'RET-' + String(num).padStart(3, '0');
  }

  private async restoreReturnedStock(row: any, qty: number, returnId: number, returnNumber: string) {
    // Find the original sale batch transactions for this product on this bill
    const saleTx = await this.db.get(
      `SELECT * FROM batch_transactions
       WHERE reference_id = ? AND product_id = ? AND type = 'sale'
       ORDER BY transaction_date ASC, transaction_id ASC`,
      [this.selectedBill.bill_id, row.product_id]
    );

    let remaining = qty;
    const transactions = saleTx.success ? saleTx.data : [];

    // Restore from the original batches used in the sale (FIFO order)
    for (const tx of transactions) {
      if (remaining <= 0) break;
      const restoreQty = Math.min(remaining, Number(tx.quantity) || 0);
      if (restoreQty <= 0) continue;

      const batchResult = await this.db.get(
        'SELECT * FROM product_batches WHERE batch_id = ?',
        [tx.batch_id]
      );
      if (batchResult.success && batchResult.data && batchResult.data.length > 0) {
        const batch = batchResult.data[0];
        const newQty = (Number(batch.quantity) || 0) + restoreQty;
        await this.db.updateBatch(batch.batch_id, { quantity: newQty, status: 'active' });
        await this.db.addBatchTransaction(
          batch.batch_id, row.product_id, 'return', restoreQty,
          this.returnDate, returnId,
          `${returnNumber} - Bill ${this.selectedBill.bill_number}`
        );
        remaining -= restoreQty;
      }
    }

    // Fallback: restore remaining qty to any active batch of this product
    if (remaining > 0) {
      const batches = await this.db.getBatchesByProduct(row.product_id, this.currentFarm.farm_id);
      if (batches.success && batches.data && batches.data.length > 0) {
        const target = batches.data.find((b: any) => b.calculated_status === 'active' || b.calculated_status === 'expiring')
          || batches.data[0];
        const newQty = (Number(target.quantity) || 0) + remaining;
        await this.db.updateBatch(target.batch_id, { quantity: newQty, status: 'active' });
        await this.db.addBatchTransaction(
          target.batch_id, row.product_id, 'return', remaining,
          this.returnDate, returnId,
          `${returnNumber} - Bill ${this.selectedBill.bill_number} (fallback batch)`
        );
      }
    }

    await this.db.updateBatchStatuses();
  }

  private async reduceBillItem(row: any, qty: number) {
    const remainingQty = Math.max((Number(row.sold_quantity) || 0) - qty, 0);
    if (remainingQty === 0) {
      await this.db.run('DELETE FROM bill_items WHERE item_id = ?', [row.bill_item_id]);
    } else {
      await this.db.run(
        'UPDATE bill_items SET quantity = ?, total_price = ? WHERE item_id = ?',
        [remainingQty, remainingQty * (Number(row.unit_price) || 0), row.bill_item_id]
      );
    }
  }

  private async rebuildCustomerLedger(bill: any, total: number, paid: number) {
    // Remove old ledger entries for this bill
    await this.db.run(
      `DELETE FROM customer_ledger WHERE reference_id = ? AND reference_type IN ('bill', 'payment')`,
      [bill.bill_id]
    );

    if (total > 0) {
      await this.db.addCustomerLedgerEntry({
        customer_id: bill.customer_id,
        transaction_date: this.returnDate,
        description: `Bill #${bill.bill_number} (after return)`,
        debit: total,
        credit: 0,
        reference_type: 'bill',
        reference_id: bill.bill_id
      });
    }

    if (paid > 0) {
      await this.db.addCustomerLedgerEntry({
        customer_id: bill.customer_id,
        transaction_date: this.returnDate,
        description: `Payment - Bill #${bill.bill_number}`,
        debit: 0,
        credit: paid,
        reference_type: 'payment',
        reference_id: bill.bill_id
      });
    }

    await this.db.updateCustomerOutstandingBalance(bill.customer_id);
  }

  private async refundCustomerBank(customerId: number, amount: number, description: string) {
    // getCustomerBankAccount returns { success, data: [] }
    const bankResult = await this.db.getCustomerBankAccount(customerId);
    if (!bankResult.success || !bankResult.data || bankResult.data.length === 0) {
      this.errorMessage += ' (Customer has no linked bank account — bank refund not posted.)';
      return;
    }
    const bank = bankResult.data[0];
    await this.db.addBankLedgerEntry({
      bank_id: bank.bank_id,
      transaction_date: this.returnDate,
      description,
      debit: 0,
      credit: amount,    // Credit bank = money leaving our bank (refund to customer)
      reference_type: 'return',
      reference_id: this.selectedBill.bill_id
    });
  }

  private async rebuildInternalTransferExpenses(billId: number) {
    // Get the original transfer record for this bill
    const transferResult = await this.db.get(
      'SELECT * FROM internal_transfers WHERE bill_id = ? LIMIT 1',
      [billId]
    );
    const transfer = transferResult.success && transferResult.data && transferResult.data.length
      ? transferResult.data[0]
      : null;
    if (!transfer) return;

    // 🔥 FIX: clean up whichever table each transfer actually points at
    // (medicine_entries / feed_entries / vaccinations / expenses), same
    // logic as cleanupInternalTransfers() in sales-orders.component.ts.
    // The old version here only checked expense_id, which is null for
    // medicine/feed/vaccination transfers — leaving those rows orphaned
    // and then miscategorizing the return as a generic expense.
    const oldTransfers = await this.db.get(
      'SELECT * FROM internal_transfers WHERE bill_id = ?',
      [billId]
    );
    for (const row of oldTransfers.success ? oldTransfers.data : []) {
      const targetType = row.target_type || (row.expense_id ? 'expense' : null);
      const refId = row.reference_id || row.expense_id;

      if (targetType === 'medicine' && refId) {
        await this.db.run('DELETE FROM medicine_entries WHERE entry_id = ?', [refId]);
      } else if (targetType === 'feed' && refId) {
        await this.db.run('DELETE FROM feed_entries WHERE entry_id = ?', [refId]);
      } else if (targetType === 'vaccination' && refId) {
        await this.db.run('DELETE FROM vaccinations WHERE vaccination_id = ?', [refId]);
      } else if (row.expense_id) {
        await this.db.run('DELETE FROM expenses WHERE expense_id = ?', [row.expense_id]);
      }
    }
    // Remove old internal_transfer rows
    await this.db.run('DELETE FROM internal_transfers WHERE bill_id = ?', [billId]);

    // 🔥 FIX: re-create each remaining bill item in ITS OWN category table,
    // not always as a generic expense — otherwise every returned
    // medicine/feed/vaccination item permanently loses its category.
    const itemsResult = await this.db.get(
      'SELECT * FROM bill_items WHERE bill_id = ?',
      [billId]
    );

    for (const item of itemsResult.success ? itemsResult.data : []) {
      const productRes = item.product_id
        ? await this.db.get('SELECT category FROM products WHERE product_id = ?', [item.product_id])
        : { success: false, data: [] };
      const category = (productRes.success && productRes.data.length > 0)
        ? (productRes.data[0].category || '').toLowerCase()
        : '';

      let expenseId = null;
      let targetType = 'expense';
      let referenceId = null;

      if (category === 'medicine') {
        targetType = 'medicine';
        let traderRes = await this.db.get(
          'SELECT trader_id FROM medicine_traders WHERE flock_id=? AND module_type=? AND trader_name=?',
          [transfer.target_flock_id, transfer.target_module, 'Internal Distribution']
        );
        let traderId = traderRes.success && traderRes.data.length > 0 ? traderRes.data[0].trader_id : null;
        if (!traderId) {
          const newTrader = await this.db.run(
            'INSERT INTO medicine_traders (flock_id, trader_name, module_type) VALUES (?, ?, ?)',
            [transfer.target_flock_id, 'Internal Distribution', transfer.target_module]
          );
          traderId = newTrader.lastId;
        }
        if (traderId) {
          const entryResult = await this.db.run(
            'INSERT INTO medicine_entries (trader_id, flock_id, date, medicine_name, quantity, price_per_unit, total_amount, module_type) VALUES (?,?,?,?,?,?,?,?)',
            [traderId, transfer.target_flock_id, this.returnDate, item.product_name, item.quantity, item.unit_price, item.total_price, transfer.target_module]
          );
          referenceId = entryResult.lastId;
        }
      } else if (category === 'feed') {
        targetType = 'feed';
        let traderRes = await this.db.get(
          'SELECT trader_id FROM feed_traders WHERE flock_id=? AND module_type=? AND trader_name=?',
          [transfer.target_flock_id, transfer.target_module, 'Internal Distribution']
        );
        let traderId = traderRes.success && traderRes.data.length > 0 ? traderRes.data[0].trader_id : null;
        if (!traderId) {
          const newTrader = await this.db.run(
            'INSERT INTO feed_traders (flock_id, trader_name, module_type) VALUES (?, ?, ?)',
            [transfer.target_flock_id, 'Internal Distribution', transfer.target_module]
          );
          traderId = newTrader.lastId;
        }
        if (traderId) {
          const entryResult = await this.db.run(
            'INSERT INTO feed_entries (trader_id, flock_id, date, feed_name, quantity, price_per_unit, total_amount, module_type) VALUES (?,?,?,?,?,?,?,?)',
            [traderId, transfer.target_flock_id, this.returnDate, item.product_name, item.quantity, item.unit_price, item.total_price, transfer.target_module]
          );
          referenceId = entryResult.lastId;
        }
      } else if (category === 'vaccine' || category === 'vaccination') {
        targetType = 'vaccination';
        const vaccResult = await this.db.run(
          'INSERT INTO vaccinations (batch_id, flock_id, date, vaccine_name, dose, notes, done) VALUES (?,?,?,?,?,?,?)',
          [
            transfer.target_module === 'layer' ? transfer.target_flock_id : null,
            transfer.target_module === 'broiler' ? transfer.target_flock_id : null,
            this.returnDate, item.product_name, '1', 'Internal Transfer (adjusted after return)', 1
          ]
        );
        referenceId = vaccResult.lastId;
      } else {
        targetType = 'expense';
        const expenseResult = await this.db.run(
          'INSERT INTO expenses (flock_id, date, description, amount, module_type) VALUES (?, ?, ?, ?, ?)',
          [transfer.target_flock_id, this.returnDate, `${item.product_name} x ${item.quantity}`, item.total_price, transfer.target_module]
        );
        expenseId = expenseResult.lastId;
        referenceId = expenseId;
      }

      await this.db.run(
        'INSERT INTO internal_transfers (bill_id, expense_id, target_module, target_flock_id, target_type, reference_id) VALUES (?,?,?,?,?,?)',
        [billId, expenseId, transfer.target_module, transfer.target_flock_id, targetType, referenceId]
      );
    }
  }
}
