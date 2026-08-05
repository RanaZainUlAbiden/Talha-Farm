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

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadData();
  }

  get totalReturnAmount(): number {
    return this.returnRows.reduce((sum, row) => sum + this.getRowReturnAmount(row), 0);
  }

  get newBillTotal(): number {
    return Math.max((Number(this.selectedBill?.total_amount) || 0) - this.totalReturnAmount, 0);
  }

  get refundDue(): number {
    const paid = Number(this.selectedBill?.amount_paid) || 0;
    return Math.max(paid - this.newBillTotal, 0);
  }

  async loadData() {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const [billsResult, returnsResult] = await Promise.all([
        this.db.get(
          `SELECT b.*, COALESCE(SUM(sr.return_amount), 0) AS returned_amount
           FROM bills b
           LEFT JOIN sales_returns sr ON sr.bill_id = b.bill_id
           WHERE b.farm_id = ?
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

  async selectBill(bill: any) {
    this.selectedBill = bill;
    this.reason = '';
    this.returnDate = new Date().toISOString().split('T')[0];
    this.errorMessage = '';

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
  }

  getRowReturnAmount(row: any): number {
    const qty = Number(row.return_quantity) || 0;
    return qty * (Number(row.unit_price) || 0);
  }

  async saveReturn() {
    if (!this.selectedBill || this.isSaving) return;
    const rows = this.returnRows.filter(row => (Number(row.return_quantity) || 0) > 0);
    if (rows.length === 0) {
      this.errorMessage = 'Enter at least one return quantity.';
      return;
    }
    for (const row of rows) {
      const qty = Number(row.return_quantity) || 0;
      if (qty <= 0 || qty > row.sold_quantity) {
        this.errorMessage = `Return quantity for ${row.product_name} cannot exceed sold quantity.`;
        return;
      }
    }

    this.isSaving = true;
    this.errorMessage = '';
    try {
      const returnNumber = await this.getNextReturnNumber();
      const returnAmount = this.totalReturnAmount;
      const oldPaid = Number(this.selectedBill.amount_paid) || 0;
      const nextTotal = this.newBillTotal;
      const nextPaid = Math.min(oldPaid, nextTotal);
      const refundAmount = oldPaid - nextPaid;

      const insertReturn = await this.db.run(
        `INSERT INTO sales_returns
          (farm_id, bill_id, return_number, return_date, return_amount, refund_amount, refund_method, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [this.currentFarm.farm_id, this.selectedBill.bill_id, returnNumber, this.returnDate, returnAmount, refundAmount, this.refundMethod, this.reason]
      );
      const returnId = insertReturn.lastId;

      for (const row of rows) {
        const qty = Number(row.return_quantity) || 0;
        const rowTotal = qty * row.unit_price;
        await this.db.run(
          `INSERT INTO sales_return_items
            (return_id, bill_id, bill_item_id, product_id, product_name, quantity, unit_price, total_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [returnId, this.selectedBill.bill_id, row.bill_item_id, row.product_id, row.product_name, qty, row.unit_price, rowTotal]
        );
        await this.restoreReturnedStock(row, qty, returnId, returnNumber);
        await this.reduceBillItem(row, qty);
      }

      await this.db.run(
        `UPDATE bills SET subtotal = ?, total_amount = ?, amount_paid = ?, status = ? WHERE bill_id = ?`,
        [nextTotal, nextTotal, nextPaid, nextTotal === 0 ? 'returned' : 'partial_return', this.selectedBill.bill_id]
      );

      if (this.selectedBill.customer_id) {
        await this.rebuildCustomerLedger(this.selectedBill, nextTotal, nextPaid);
      }

      if (refundAmount > 0 && this.refundMethod === 'bank' && this.selectedBill.customer_id) {
        await this.refundCustomerBank(this.selectedBill.customer_id, refundAmount, `Refund - ${returnNumber}`);
      }

      if (this.selectedBill.payment_type === 'internal') {
        await this.rebuildInternalTransferExpenses(this.selectedBill.bill_id);
      }

      this.clearSelection();
      await this.loadData();
    } catch (error: any) {
      this.errorMessage = 'Failed to save return: ' + error.message;
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  private async getNextReturnNumber(): Promise<string> {
    const result = await this.db.get(
      `SELECT COALESCE(MAX(CAST(SUBSTR(return_number, 5) AS INTEGER)), 0) + 1 AS next_number
       FROM sales_returns
       WHERE farm_id = ? AND return_number LIKE 'RET-%'`,
      [this.currentFarm.farm_id]
    );
    return 'RET-' + String(result.success && result.data[0] ? result.data[0].next_number : 1).padStart(3, '0');
  }

  private async restoreReturnedStock(row: any, qty: number, returnId: number, returnNumber: string) {
    const saleTx = await this.db.get(
      `SELECT * FROM batch_transactions
       WHERE reference_id = ? AND product_id = ? AND type = 'sale'
       ORDER BY transaction_date ASC, transaction_id ASC`,
      [this.selectedBill.bill_id, row.product_id]
    );
    let remaining = qty;
    const transactions = saleTx.success ? saleTx.data : [];

    for (const tx of transactions) {
      if (remaining <= 0) break;
      const restoreQty = Math.min(remaining, Number(tx.quantity) || 0);
      const batchResult = await this.db.get('SELECT * FROM product_batches WHERE batch_id = ?', [tx.batch_id]);
      if (batchResult.success && batchResult.data.length > 0) {
        const batch = batchResult.data[0];
        await this.db.updateBatch(batch.batch_id, { quantity: (Number(batch.quantity) || 0) + restoreQty, status: 'active' });
        await this.db.addBatchTransaction(batch.batch_id, row.product_id, 'return', restoreQty, this.returnDate, returnId, `${returnNumber} - ${this.selectedBill.bill_number}`);
        remaining -= restoreQty;
      }
    }

    if (remaining > 0) {
      const batches = await this.db.getBatchesByProduct(row.product_id, this.currentFarm.farm_id);
      const target = batches.success && batches.data.length > 0
        ? (batches.data.find((b: any) => b.status === 'active' || b.status === 'expiring') || batches.data[0])
        : null;
      if (target) {
        await this.db.updateBatch(target.batch_id, { quantity: (Number(target.quantity) || 0) + remaining, status: 'active' });
        await this.db.addBatchTransaction(target.batch_id, row.product_id, 'return', remaining, this.returnDate, returnId, `${returnNumber} - ${this.selectedBill.bill_number}`);
      }
    }
    await this.db.updateBatchStatuses();
  }

  private async reduceBillItem(row: any, qty: number) {
    const remainingQty = Math.max((Number(row.sold_quantity) || 0) - qty, 0);
    if (remainingQty === 0) {
      await this.db.run('DELETE FROM bill_items WHERE item_id = ?', [row.bill_item_id]);
      return;
    }
    await this.db.run(
      'UPDATE bill_items SET quantity = ?, total_price = ? WHERE item_id = ?',
      [remainingQty, remainingQty * row.unit_price, row.bill_item_id]
    );
  }

  private async rebuildCustomerLedger(bill: any, total: number, paid: number) {
    await this.db.run('DELETE FROM customer_ledger WHERE reference_id = ? AND reference_type IN (?, ?)', [bill.bill_id, 'bill', 'payment']);
    if (total > 0) {
      await this.db.addCustomerLedgerEntry({
        customer_id: bill.customer_id,
        transaction_date: this.returnDate,
        description: `Bill #${bill.bill_number}`,
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
    const bankResult = await this.db.getCustomerBankAccount(customerId);
    if (!bankResult.success || !bankResult.data.length) {
      this.errorMessage = 'Customer has no bank account. Return saved, but bank refund was not posted.';
      return;
    }
    await this.db.addBankLedgerEntry({
      bank_id: bankResult.data[0].bank_id,
      transaction_date: this.returnDate,
      description,
      debit: amount,
      credit: 0,
      reference_type: 'return',
      reference_id: this.selectedBill.bill_id
    });
  }

  private async rebuildInternalTransferExpenses(billId: number) {
    const transferResult = await this.db.get('SELECT * FROM internal_transfers WHERE bill_id = ? LIMIT 1', [billId]);
    const transfer = transferResult.success && transferResult.data.length ? transferResult.data[0] : null;
    if (!transfer) return;

    const oldTransfers = await this.db.get('SELECT expense_id FROM internal_transfers WHERE bill_id = ?', [billId]);
    for (const row of oldTransfers.success ? oldTransfers.data : []) {
      if (row.expense_id) await this.db.run('DELETE FROM expenses WHERE expense_id = ?', [row.expense_id]);
    }
    await this.db.run('DELETE FROM internal_transfers WHERE bill_id = ?', [billId]);

    const itemsResult = await this.db.get('SELECT * FROM bill_items WHERE bill_id = ?', [billId]);
    for (const item of itemsResult.success ? itemsResult.data : []) {
      const expenseResult = await this.db.run(
        'INSERT INTO expenses (flock_id, date, description, amount, module_type) VALUES (?,?,?,?,?)',
        [transfer.target_flock_id, this.returnDate, `${item.product_name} x ${item.quantity}`, item.total_price, transfer.target_module]
      );
      if (expenseResult.lastId) {
        await this.db.run(
          'INSERT INTO internal_transfers (bill_id, expense_id, target_module, target_flock_id) VALUES (?,?,?,?)',
          [billId, expenseResult.lastId, transfer.target_module, transfer.target_flock_id]
        );
      }
    }
  }
}
