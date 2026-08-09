import { Component, OnInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { FormStateService } from '../shared/services/form-state.service';
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
export class PurchaseOrdersComponent implements OnInit, OnDestroy {
  currentFarm: any = null;
  products: any[] = [];
  suppliers: any[] = [];
  orders: any[] = [];
  filteredOrders: any[] = [];
  pendingRows: any[] = [];
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  isSavingAll = false;
  errorMessage = '';
  isLoading = true;
  searchTerm: string = '';

  currentPage = 1;
  pageSize = 15; // Changed from 20 to 15

  // ── STATE PERSISTENCY KEYS ────────────────────────────────
  private readonly FORM_KEY = 'purchase_orders_form_state';
  private saveTimeout: any = null;

  get paginatedOrders() {
    const start = (this.currentPage - 1) * this.pageSize;
    const dataToShow = this.searchTerm ? this.filteredOrders : this.orders;
    return dataToShow.slice(start, start + this.pageSize);
  }

  get totalItems() {
    return this.searchTerm ? this.filteredOrders.length : this.orders.length;
  }

  get hasPendingRows() { return this.pendingRows.length > 0; }

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef,
    private formState: FormStateService
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadData();
  }

  ngOnDestroy() {
    // Save state when component is destroyed
    if (this.pendingRows.length > 0 && !this.isSavingAll) {
      this.saveState();
    }
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
  }

  // ── STATE PERSISTENCY METHODS ─────────────────────────────

  private saveState(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      if (this.pendingRows.length > 0) {
        const state = {
          pendingRows: this.pendingRows,
          currentPage: this.currentPage,
          searchTerm: this.searchTerm
        };
        this.formState.saveState(this.FORM_KEY, state);
        console.log('💾 Purchase orders state auto-saved');
      } else {
        this.formState.clearState(this.FORM_KEY);
      }
    }, 500);
  }

  private restoreState(): void {
    const state = this.formState.getState(this.FORM_KEY);
    if (state && state.pendingRows && state.pendingRows.length > 0) {
      console.log('📂 Restoring Purchase Orders form state:', state);
      this.pendingRows = state.pendingRows;
      if (state.currentPage) {
        this.currentPage = state.currentPage;
      }
      if (state.searchTerm) {
        this.searchTerm = state.searchTerm;
        this.filterOrders();
      }
      this.cdr.detectChanges();
    }
  }

  // ── AUTO-SAVE ──────────────────────────────────────────────

  onFormChange(): void {
    if (this.pendingRows.length > 0) {
      this.saveState();
    }
  }

  // ── SEARCH / FILTER ────────────────────────────────────────

  filterOrders() {
    if (!this.searchTerm.trim()) {
      this.filteredOrders = [];
      this.currentPage = 1;
      this.cdr.detectChanges();
      return;
    }
    
    const term = this.searchTerm.toLowerCase().trim();
    this.filteredOrders = this.orders.filter(o => {
      // Get supplier name
      const supplier = this.suppliers.find(s => s.supplier_id === o.supplier_id);
      const supplierName = supplier ? supplier.supplier_name.toLowerCase() : '';
      
      // Also search by product name, bill number, or date if needed
      const product = this.products.find(p => p.product_id === o.product_id);
      const productName = product ? product.product_name.toLowerCase() : '';
      
      return supplierName.includes(term) || 
             productName.includes(term) ||
             o.notes?.toLowerCase().includes(term) ||
             o.date?.includes(term);
    });
    
    this.currentPage = 1;
    this.cdr.detectChanges();
    this.onFormChange();
  }

  clearSearch() {
    this.searchTerm = '';
    this.filteredOrders = [];
    this.currentPage = 1;
    this.cdr.detectChanges();
    this.onFormChange();
  }

  async loadData() {
    this.isLoading = true;
    this.errorMessage = '';
    
    try {
      const pr = await this.db.get('SELECT * FROM products WHERE farm_id=? ORDER BY product_name ASC', [this.currentFarm.farm_id]);
      this.products = pr.success ? pr.data : [];
      
      const sr = await this.db.get('SELECT * FROM suppliers WHERE farm_id=? ORDER BY supplier_name ASC', [this.currentFarm.farm_id]);
      this.suppliers = sr.success ? sr.data : [];
      
      const or = await this.db.get('SELECT * FROM purchase_orders WHERE farm_id=? ORDER BY date DESC', [this.currentFarm.farm_id]);
      this.orders = or.success ? or.data : [];
      
      // 🔥 Restore state AFTER data is loaded
      this.restoreState();
      
      // Apply search if there's a search term
      if (this.searchTerm) {
        this.filterOrders();
      }
      
      this.cdr.detectChanges();
    } catch (error: any) {
      this.errorMessage = 'Failed to load data: ' + error.message;
      console.error('Load error:', error);
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  getProductName(id: number) { return this.products.find(p => p.product_id === id)?.product_name || '—'; }
  getSupplierName(id: number) { return this.suppliers.find(s => s.supplier_id === id)?.supplier_name || '—'; }

  makeNewRow() { 
    return { 
      product_id: this.products[0]?.product_id || null, 
      supplier_id: null, 
      date: new Date().toISOString().split('T')[0], 
      quantity: null, 
      cost_price: null, 
      payment_type: 'cash', 
      notes: '' 
    }; 
  }

  addPendingRow() { 
    if (!this.isSaving) {
      this.pendingRows.push(this.makeNewRow());
      this.onFormChange();
      this.cdr.detectChanges();
    }
  }

  addRowAfter(i: number) { 
    this.pendingRows.splice(i + 1, 0, this.makeNewRow());
    this.onFormChange();
    this.cdr.detectChanges();
  }

  removePendingRow(i: number) { 
    this.pendingRows.splice(i, 1);
    this.onFormChange();
    this.cdr.detectChanges();
  }

  onProductSelect(row: any) {
    if (!row.product_id) {
      row.cost_price = null;
      row.unit = null;
      return;
    }
    const product = this.products.find(p => p.product_id === row.product_id);
    if (product) {
      if (product.cost_price) {
        row.cost_price = product.cost_price;
        console.log(`✅ Auto-filled cost price: Rs. ${product.cost_price} for ${product.product_name}`);
      } else {
        row.cost_price = 0;
        console.warn(`⚠️ No cost price found for ${product.product_name}`);
      }
      if (product.unit) {
        row.unit = product.unit;
      }
    }
    this.onFormChange();
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
      
      if (result.success) {
        console.log(`✅ Added ${quantity} units to product ${productId} as batch ${result.batch_code}`);
      } else {
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

  // ── SUPPLIER LEDGER INTEGRATION ─────────────────────────

  async addToSupplierLedger(supplierId: number, purchaseId: number, amount: number, paymentType: string, notes: string) {
    if (!supplierId) {
      console.warn('⚠️ No supplier ID provided, skipping ledger entry');
      return;
    }
    const isPaid = paymentType?.toLowerCase() === 'cash';
    const credit = amount;
    const debit = isPaid ? amount : 0;
    
    try {
      const result = await this.db.addSupplierLedgerEntry({
        supplier_id: supplierId,
        transaction_date: new Date().toISOString().split('T')[0],
        description: `Purchase Order #${purchaseId}${notes ? ' - ' + notes : ''}`,
        debit: debit,
        credit: credit,
        reference_type: 'purchase',
        reference_id: purchaseId
      });
      console.log(`✅ Added ${amount} to supplier ${supplierId} ledger (${paymentType})`, result);
    } catch (error) {
      console.error('❌ Failed to add supplier ledger entry:', error);
      this.errorMessage = 'Failed to update supplier ledger: ' + (error as any).message;
    }
  }

  async removeFromSupplierLedger(purchaseId: number, supplierId: number) {
    if (!supplierId) return;
    try {
      await this.db.run('DELETE FROM supplier_ledger WHERE reference_id = ? AND reference_type = ?', [purchaseId, 'purchase']);
      console.log(`✅ Removed purchase ${purchaseId} from supplier ${supplierId} ledger`);
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
    console.log(`✅ Updated supplier ledger for purchase ${purchaseId}`);
  }

  // ── SAVE OPERATIONS ──────────────────────────────────────

  async saveAllRows() {
    if (!this.pendingRows.length || this.isSavingAll) return;

    // Validate every row up front. If any row is invalid, stop before saving
    // anything so we never silently drop a row the user typed data into.
    for (let i = 0; i < this.pendingRows.length; i++) {
      const row = this.pendingRows[i];
      if (!row.product_id || row.quantity === null || row.quantity === undefined || row.cost_price === null || row.cost_price === undefined) {
        this.errorMessage = `Row ${i + 1}: please fill in product, quantity and cost price.`;
        this.cdr.detectChanges();
        return;
      }
      if (Number(row.quantity) < 0 || Number(row.cost_price) < 0) {
        this.errorMessage = `Row ${i + 1}: quantity and cost must not be negative.`;
        this.cdr.detectChanges();
        return;
      }
    }

    this.isSavingAll = true;
    this.errorMessage = '';
    
    try {
      for (const row of this.pendingRows) {
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
          const batchResult = await this.updateInventoryWithBatch(row.product_id, row.quantity, row.cost_price);
          if (batchResult && batchResult.success && batchResult.batch_id && isValidPurchaseId) {
            await this.db.run('UPDATE purchase_orders SET batch_id = ? WHERE purchase_id = ?', [batchResult.batch_id, purchaseId]);
          }
        } else {
          console.error('❌ Failed to save purchase:', result.error);
          this.errorMessage = 'Failed to save purchase: ' + result.error;
        }
      }
      
      // Clear state on successful save
      this.formState.clearState(this.FORM_KEY);
      this.pendingRows = [];
      this.searchTerm = '';
      this.filteredOrders = [];
      await this.loadData();
      
    } catch (error: any) {
      console.error('❌ Error saving:', error);
      this.errorMessage = 'Error saving: ' + error.message;
    } finally {
      this.isSavingAll = false;
      this.cdr.detectChanges();
    }
  }

  cancelAllRows() {
    this.pendingRows = [];
    this.formState.clearState(this.FORM_KEY);
    this.cdr.detectChanges();
  }

  startEdit(o: any) { 
    this.editingId = o.purchase_id; 
    this.editForm = { 
      product_id: o.product_id, 
      supplier_id: o.supplier_id, 
      date: o.date, 
      quantity: o.quantity, 
      cost_price: o.cost_price, 
      payment_type: o.payment_type, 
      notes: o.notes,
      old_product_id: o.product_id,
      old_quantity: o.quantity,
      old_supplier_id: o.supplier_id,
      batch_id: o.batch_id ?? null
    }; 
    this.cdr.detectChanges();
  }
  
  cancelEdit() { 
    this.editingId = null; 
    this.cdr.detectChanges();
  }

  async saveEdit(id: number) {
    try {
      const existing = this.orders.find(o => o.purchase_id === id);
      if (!existing) return;
      
      const oldSupplierId = existing.supplier_id;
      const newSupplierId = this.editForm.supplier_id;
      const newTotal = this.editForm.quantity * this.editForm.cost_price;
      const paymentType = this.editForm.payment_type || 'credit';
      const isPaid = paymentType?.toLowerCase() === 'cash';
      
      let linkedBatchId: number | null = this.editForm.batch_id ?? null;
      const productChanged = Number(this.editForm.product_id) !== Number(existing.product_id);

      if (productChanged) {
        // The old linked batch belongs to the old product — remove this order's
        // stock from it, then create a fresh batch for the new product.
        if (linkedBatchId) {
          await this.adjustLinkedBatch(linkedBatchId, -Number(existing.quantity), existing.product_id);
        } else {
          await this.deductFromBatches(existing.product_id, Number(existing.quantity));
        }
        const newBatchResult = await this.updateInventoryWithBatch(this.editForm.product_id, this.editForm.quantity, this.editForm.cost_price);
        linkedBatchId = newBatchResult && newBatchResult.success ? newBatchResult.batch_id : null;
      } else {
        const diff = Number(this.editForm.quantity) - Number(existing.quantity);

        if (linkedBatchId) {
          // Keep the linked batch's cost in sync with this order, then apply
          // the quantity delta directly to it instead of guessing via FIFO.
          await this.db.updateBatch(linkedBatchId, { purchase_price: this.editForm.cost_price });
          if (diff !== 0) {
            await this.adjustLinkedBatch(linkedBatchId, diff, this.editForm.product_id);
          }
        } else {
          // Legacy order with no linked batch — fall back to the old FIFO behavior.
          if (diff > 0) {
            const newBatchResult = await this.updateInventoryWithBatch(this.editForm.product_id, diff, this.editForm.cost_price);
            linkedBatchId = newBatchResult && newBatchResult.success ? newBatchResult.batch_id : null;
          } else if (diff < 0) {
            await this.deductFromBatches(this.editForm.product_id, Math.abs(diff));
          }
        }
      }

      await this.db.run(
        'UPDATE purchase_orders SET supplier_id=?, product_id=?, date=?, quantity=?, cost_price=?, total_amount=?, payment_type=?, notes=?, batch_id=? WHERE purchase_id=?',
        [newSupplierId, this.editForm.product_id, this.editForm.date, this.editForm.quantity, this.editForm.cost_price, newTotal, paymentType, this.editForm.notes, linkedBatchId, id]
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
      
      this.editingId = null;
      await this.loadData();
      
    } catch (error: any) {
      console.error('❌ Error saving edit:', error);
      this.errorMessage = 'Error saving edit: ' + error.message;
      this.cdr.detectChanges();
    }
  }

  

  async deductFromBatches(productId: number, quantity: number) {
    try {
      const batchesResult = await this.db.getBatchesByProduct(productId, this.currentFarm.farm_id);
      if (!batchesResult.success || !batchesResult.data) return;
      
      const activeBatches = batchesResult.data
        .filter((b: any) => (b.calculated_status === 'active' || b.calculated_status === 'expiring') && b.quantity > 0)
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

  /**
   * Adjusts a specific batch's quantity by `delta` (positive to add stock,
   * negative to remove). Floors at 0 so it can never go negative even if
   * other sales have already consumed part of this batch. Returns the
   * amount actually applied (may differ from `delta` if floored).
   */
  async adjustLinkedBatch(batchId: number, delta: number, productId: number): Promise<{ success: boolean; appliedDelta: number }> {
    try {
      const r = await this.db.get('SELECT * FROM product_batches WHERE batch_id = ?', [batchId]);
      const batch = r.success && r.data && r.data.length > 0 ? r.data[0] : null;
      if (!batch) {
        return { success: false, appliedDelta: 0 };
      }

      const newQty = Math.max(0, Number(batch.quantity) + delta);
      const appliedDelta = newQty - Number(batch.quantity);

      await this.db.updateBatch(batchId, { quantity: newQty });

      if (appliedDelta !== 0) {
        await this.db.addBatchTransaction(
          batchId,
          productId,
          'adjustment',
          Math.abs(appliedDelta),
          new Date().toISOString().split('T')[0],
          null,
          `Adjustment from purchase order edit (${appliedDelta > 0 ? '+' : ''}${appliedDelta})`
        );
      }

      await this.db.updateBatchStatuses();
      return { success: true, appliedDelta };
    } catch (error) {
      console.error('Error adjusting linked batch:', error);
      return { success: false, appliedDelta: 0 };
    }
  }



  confirmDelete(id: number) { 
    this.deletingId = id; 
    this.showDeleteDialog = true; 
    this.cdr.detectChanges();
  }

  async onDeleteConfirmed() {
    try {
      const order = this.orders.find(o => o.purchase_id === this.deletingId);
      if (order) {
        if (order.supplier_id) {
          await this.removeFromSupplierLedger(this.deletingId!, order.supplier_id);
        }
        if (order.batch_id) {
          await this.adjustLinkedBatch(order.batch_id, -Number(order.quantity), order.product_id);
        } else {
          // Legacy order with no linked batch — fall back to old FIFO behavior.
          await this.deductFromBatches(order.product_id, order.quantity);
        }
      }
      await this.db.run('DELETE FROM purchase_orders WHERE purchase_id=?', [this.deletingId]);
      this.showDeleteDialog = false;
      await this.loadData();
      
    } catch (error: any) {
      console.error('❌ Error deleting:', error);
      this.errorMessage = 'Error deleting: ' + error.message;
      this.cdr.detectChanges();
    }
  }
  
  onDeleteCancelled() { 
    this.showDeleteDialog = false; 
    this.cdr.detectChanges();
  }
}