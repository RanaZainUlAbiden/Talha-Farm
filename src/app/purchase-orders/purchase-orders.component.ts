import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';
import { PaginationComponent } from '../shared/components/pagination/pagination.component';

@Component({
  selector: 'app-purchase-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe, PaginationComponent],
  templateUrl: './purchase-orders.component.html',
  styleUrl: './purchase-orders.component.scss'
})
export class PurchaseOrdersComponent implements OnInit {
  currentFarm: any = null;
  products: any[] = [];
  suppliers: any[] = [];
  orders: any[] = [];
  pendingRows: any[] = [];
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  isSavingAll = false;
  errorMessage = '';

  currentPage = 1;
  pageSize = 20;

  get paginatedOrders() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.orders.slice(start, start + this.pageSize);
  }

  get hasPendingRows() { return this.pendingRows.length > 0; }

  constructor(private db: DatabaseService, private authService: AuthService, private cdr: ChangeDetectorRef) {}

  ngOnInit() { this.currentFarm = this.authService.getCurrentFarm(); this.loadData(); }

  async loadData() {
    const pr = await this.db.get('SELECT * FROM products WHERE farm_id=?', [this.currentFarm.farm_id]);
    this.products = pr.success ? pr.data : [];
    const sr = await this.db.get('SELECT * FROM suppliers WHERE farm_id=?', [this.currentFarm.farm_id]);
    this.suppliers = sr.success ? sr.data : [];
    const or = await this.db.get('SELECT * FROM purchase_orders WHERE farm_id=? ORDER BY date DESC', [this.currentFarm.farm_id]);
    this.orders = or.success ? or.data : [];
    this.cdr.detectChanges();
  }

  getProductName(id: number) { return this.products.find(p => p.product_id === id)?.product_name || '—'; }
  getSupplierName(id: number) { return this.suppliers.find(s => s.supplier_id === id)?.supplier_name || '—'; }

  // ── ROW CREATION ──────────────────────────────────────────

  makeNewRow() {
    return {
      product_id: this.products[0]?.product_id ?? null,
      supplier_id: null,
      date: new Date().toISOString().split('T')[0],
      quantity: null,
      cost_price: null,
      unit: null,
      payment_type: 'cash',
      notes: ''
    };
  }

  addPendingRow() {
    if (this.isSaving) return;
    const row = this.makeNewRow();
    this.pendingRows.push(row);
    // 🔥 FIX: auto-fill cost price immediately since the row is created
    // with a default product already selected (no (change) event fires for that)
    this.onProductSelect(row);
  }

  addRowAfter(i: number) {
    const row = this.makeNewRow();
    this.pendingRows.splice(i + 1, 0, row);
    this.onProductSelect(row);
  }

  removePendingRow(i: number) {
    this.pendingRows.splice(i, 1);
  }

  // ── AUTO-FILL COST PRICE ─────────────────────────────────
  // Works for both pendingRows entries AND editForm, since both
  // are plain objects with product_id / cost_price / unit fields.

  onProductSelect(row: any) {
    if (!row.product_id) {
      row.cost_price = null;
      row.unit = null;
      this.cdr.detectChanges();
      return;
    }

    // 🔥 FIX: product_id coming from a native <select> bound with [ngValue]
    // stays a number, matching product_id in the products array. If you ever
    // see this break again, check that the <option> tags use [ngValue] not [value].
    const product = this.products.find(p => p.product_id === row.product_id);

    if (product) {
      row.cost_price = product.cost_price ? product.cost_price : 0;
      row.unit = product.unit || null;

      if (!product.cost_price) {
        console.warn(`⚠️ No cost price found for ${product.product_name}`);
      }
    } else {
      row.cost_price = null;
      row.unit = null;
      console.warn('⚠️ Product not found for id', row.product_id);
    }

    this.cdr.detectChanges();
  }

  // ── BATCH OPERATIONS ─────────────────────────────────────

  async updateInventoryWithBatch(productId: number, quantity: number, costPrice: number) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const oneYearLater = new Date();
      oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
      const expiryDate = oneYearLater.toISOString().split('T')[0];

      const result = await this.db.addBatch({
        product_id: productId,
        farm_id: this.currentFarm.farm_id,
        manufacturing_date: today,
        expiry_date: expiryDate,
        quantity: quantity,
        purchase_price: costPrice
      });

      if (!result.success) {
        console.error('Failed to add batch:', result.error);
        this.errorMessage = 'Failed to update inventory: ' + result.error;
      }

      return result;
    } catch (error: any) {
      console.error('Failed to update inventory:', error);
      this.errorMessage = 'Error updating inventory: ' + error.message;
      return { success: false, error: error.message };
    }
  }

  async syncCost(productId: number, costPrice: number) {
    await this.db.run('UPDATE products SET cost_price = ? WHERE product_id = ?', [costPrice, productId]);
    // keep local products array in sync so dropdown labels + future auto-fills are correct
    const p = this.products.find(pr => pr.product_id === productId);
    if (p) p.cost_price = costPrice;
  }

  // ── SUPPLIER LEDGER INTEGRATION ─────────────────────────

  async addToSupplierLedger(supplierId: number, purchaseId: number, amount: number, paymentType: string, notes: string) {
    if (!supplierId) return;

    const isPaid = paymentType?.toLowerCase() === 'cash';
    const credit = amount;
    const debit = isPaid ? amount : 0;

    try {
      await this.db.addSupplierLedgerEntry({
        supplier_id: supplierId,
        transaction_date: new Date().toISOString().split('T')[0],
        description: `Purchase Order #${purchaseId}${notes ? ' - ' + notes : ''}`,
        debit: debit,
        credit: credit,
        reference_type: 'purchase',
        reference_id: purchaseId
      });
    } catch (error) {
      console.error('❌ Failed to add supplier ledger entry:', error);
      this.errorMessage = 'Failed to update supplier ledger: ' + (error as any).message;
    }
  }

  async removeFromSupplierLedger(purchaseId: number, supplierId: number) {
    if (!supplierId) return;
    try {
      await this.db.run('DELETE FROM supplier_ledger WHERE reference_id = ? AND reference_type = ?', [purchaseId, 'purchase']);
    } catch (error) {
      console.error('❌ Failed to remove supplier ledger entry:', error);
    }
  }

  async updateSupplierLedgerOnEdit(purchaseId: number, supplierId: number, oldSupplierId: number, amount: number, paymentType: string, notes: string) {
    if (oldSupplierId) {
      await this.db.run('DELETE FROM supplier_ledger WHERE reference_id = ? AND reference_type = ?', [purchaseId, 'purchase']);
    }

    if (supplierId) {
      const isPaid = paymentType?.toLowerCase() === 'cash';
      await this.db.addSupplierLedgerEntry({
        supplier_id: supplierId,
        transaction_date: new Date().toISOString().split('T')[0],
        description: `Purchase Order #${purchaseId}${notes ? ' - ' + notes : ''}`,
        debit: isPaid ? amount : 0,
        credit: amount,
        reference_type: 'purchase',
        reference_id: purchaseId
      });
    }
  }

  // ── SAVE OPERATIONS ──────────────────────────────────────

  async saveAllRows() {
    if (!this.pendingRows.length || this.isSavingAll) return;
    this.isSavingAll = true;
    this.errorMessage = '';

    try {
      for (const row of this.pendingRows) {
        if (!row.product_id || !row.quantity || !row.cost_price) {
          this.errorMessage = 'Please fill all fields for each row';
          continue;
        }
        if (Number(row.quantity) < 0 || Number(row.cost_price) < 0) {
          this.errorMessage = 'Quantity and cost must be positive';
          continue;
        }

        const totalAmount = row.quantity * row.cost_price;
        const paymentType = row.payment_type || 'credit';

        const result = await this.db.run(
          'INSERT INTO purchase_orders (farm_id, supplier_id, product_id, date, quantity, cost_price, total_amount, payment_type, notes) VALUES (?,?,?,?,?,?,?,?,?)',
          [this.currentFarm.farm_id, row.supplier_id, row.product_id, row.date, row.quantity, row.cost_price, totalAmount, paymentType, row.notes]
        );

        if (result.success) {
          const purchaseId = result.lastId;
          const isValidPurchaseId = typeof purchaseId === 'number' && purchaseId > 0;

          if (row.supplier_id && isValidPurchaseId) {
            await this.addToSupplierLedger(row.supplier_id, purchaseId, totalAmount, paymentType, row.notes);
          }

          await this.updateInventoryWithBatch(row.product_id, row.quantity, row.cost_price);
          await this.syncCost(row.product_id, row.cost_price);
        } else {
          console.error('❌ Failed to save purchase:', result.error);
          this.errorMessage = 'Failed to save purchase: ' + result.error;
        }
      }

      this.pendingRows = [];
      await this.loadData();

    } catch (error: any) {
      console.error('❌ Error saving:', error);
      this.errorMessage = 'Error saving: ' + error.message;
    } finally {
      this.isSavingAll = false;
    }
  }

  cancelAllRows() { this.pendingRows = []; }

  // ── EDIT EXISTING ORDER ──────────────────────────────────

  startEdit(o: any) {
    this.editingId = o.purchase_id;
    this.editForm = {
      product_id: o.product_id,
      supplier_id: o.supplier_id,
      date: o.date,
      quantity: o.quantity,
      cost_price: o.cost_price,
      unit: null,
      payment_type: o.payment_type,
      notes: o.notes,
      old_product_id: o.product_id,
      old_quantity: o.quantity,
      old_supplier_id: o.supplier_id
    };
  }

  cancelEdit() { this.editingId = null; }

  async saveEdit(id: number) {
    try {
      const existing = this.orders.find(o => o.purchase_id === id);
      if (!existing) return;

      const oldSupplierId = existing.supplier_id;
      const newSupplierId = this.editForm.supplier_id;
      const newTotal = this.editForm.quantity * this.editForm.cost_price;
      const paymentType = this.editForm.payment_type || 'credit';
      const isPaid = paymentType?.toLowerCase() === 'cash';

      await this.db.run(
        'UPDATE purchase_orders SET supplier_id=?, product_id=?, date=?, quantity=?, cost_price=?, total_amount=?, payment_type=?, notes=? WHERE purchase_id=?',
        [newSupplierId, this.editForm.product_id, this.editForm.date, this.editForm.quantity, this.editForm.cost_price, newTotal, paymentType, this.editForm.notes, id]
      );

      if (oldSupplierId !== newSupplierId) {
        if (oldSupplierId) {
          await this.db.run('DELETE FROM supplier_ledger WHERE reference_id = ? AND reference_type = ?', [id, 'purchase']);
        }
        if (newSupplierId) {
          await this.db.addSupplierLedgerEntry({
            supplier_id: newSupplierId,
            transaction_date: new Date().toISOString().split('T')[0],
            description: `Purchase Order #${id}${this.editForm.notes ? ' - ' + this.editForm.notes : ''}`,
            debit: isPaid ? newTotal : 0,
            credit: newTotal,
            reference_type: 'purchase',
            reference_id: id
          });
        }
      } else if (newSupplierId) {
        await this.db.run(
          'UPDATE supplier_ledger SET debit = ?, credit = ? WHERE reference_id = ? AND reference_type = ?',
          [isPaid ? newTotal : 0, newTotal, id, 'purchase']
        );
      }

      const diff = Number(this.editForm.quantity) - Number(existing.quantity);

      if (diff > 0) {
        await this.updateInventoryWithBatch(this.editForm.product_id, diff, this.editForm.cost_price);
      } else if (diff < 0) {
        await this.deductFromBatches(this.editForm.product_id, Math.abs(diff));
      }

      await this.syncCost(this.editForm.product_id, this.editForm.cost_price);

      this.editingId = null;
      await this.loadData();

    } catch (error: any) {
      console.error('❌ Error saving edit:', error);
      this.errorMessage = 'Error saving edit: ' + error.message;
    }
  }

  async deductFromBatches(productId: number, quantity: number) {
    try {
      const batchesResult = await this.db.getBatchesByProduct(productId, this.currentFarm.farm_id);
      if (!batchesResult.success || !batchesResult.data) return;

      const activeBatches = batchesResult.data
        .filter((b: any) => (b.status === 'active' || b.status === 'expiring') && b.quantity > 0)
        .sort((a: any, b: any) => a.expiry_date.localeCompare(b.expiry_date));

      let remaining = quantity;

      for (const batch of activeBatches) {
        if (remaining <= 0) break;
        const deduct = Math.min(remaining, batch.quantity);
        const newQty = batch.quantity - deduct;

        await this.db.updateBatch(batch.batch_id, { quantity: newQty });
        await this.db.addBatchTransaction(
          batch.batch_id,
          productId,
          'adjustment',
          deduct,
          new Date().toISOString().split('T')[0],
          null,
          `Adjustment from purchase order edit (-${deduct})`
        );

        remaining -= deduct;
      }

      await this.db.updateBatchStatuses();

    } catch (error) {
      console.error('Error deducting from batches:', error);
    }
  }

  confirmDelete(id: number) { this.deletingId = id; this.showDeleteDialog = true; }

  async onDeleteConfirmed() {
    try {
      const order = this.orders.find(o => o.purchase_id === this.deletingId);
      if (order) {
        if (order.supplier_id) {
          await this.removeFromSupplierLedger(this.deletingId!, order.supplier_id);
        }
        await this.deductFromBatches(order.product_id, order.quantity);
      }
      await this.db.run('DELETE FROM purchase_orders WHERE purchase_id=?', [this.deletingId]);
      this.showDeleteDialog = false;
      await this.loadData();

    } catch (error: any) {
      console.error('❌ Error deleting:', error);
      this.errorMessage = 'Error deleting: ' + error.message;
    }
  }

  onDeleteCancelled() { this.showDeleteDialog = false; }
}