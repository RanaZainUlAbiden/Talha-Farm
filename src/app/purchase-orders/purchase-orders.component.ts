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

  makeNewRow() { return { product_id: this.products[0]?.product_id, supplier_id: null, date: new Date().toISOString().split('T')[0], quantity: null, cost_price: null, payment_type: 'cash', notes: '' }; }
  addPendingRow() { if (!this.isSaving) this.pendingRows.push(this.makeNewRow()); }
  addRowAfter(i: number) { this.pendingRows.splice(i + 1, 0, this.makeNewRow()); }
  removePendingRow(i: number) { this.pendingRows.splice(i, 1); }

  async saveAllRows() {
    if (!this.pendingRows.length || this.isSavingAll) return;
    this.isSavingAll = true;
    for (const row of this.pendingRows) {
      if (!row.product_id || !row.quantity || !row.cost_price) continue;
      if (Number(row.quantity) < 0 || Number(row.cost_price) < 0) continue;
      await this.db.run('INSERT INTO purchase_orders (farm_id, supplier_id, product_id, date, quantity, cost_price, total_amount, payment_type, notes) VALUES (?,?,?,?,?,?,?,?,?)',
        [this.currentFarm.farm_id, row.supplier_id, row.product_id, row.date, row.quantity, row.cost_price, row.quantity * row.cost_price, row.payment_type, row.notes]);
      await this.updateStock(row.product_id, row.quantity);
      // Keep the product's cost price in sync with the latest purchase cost.
      await this.syncCost(row.product_id, row.cost_price);
    }
    this.pendingRows = []; this.isSavingAll = false; await this.loadData();
  }

  cancelAllRows() { this.pendingRows = []; }

  async updateStock(productId: number, quantity: number) {
    await this.db.run('UPDATE products SET current_stock = current_stock + ? WHERE product_id = ?', [quantity, productId]);
  }

  async syncCost(productId: number, costPrice: number) {
    await this.db.run('UPDATE products SET cost_price = ? WHERE product_id = ?', [costPrice, productId]);
  }

  startEdit(o: any) { this.editingId = o.purchase_id; this.editForm = { product_id: o.product_id, supplier_id: o.supplier_id, date: o.date, quantity: o.quantity, cost_price: o.cost_price, payment_type: o.payment_type, notes: o.notes, old_quantity: o.quantity }; }
  cancelEdit() { this.editingId = null; }
  async saveEdit(id: number) {
    const existing = this.orders.find(o => o.purchase_id === id);
    await this.db.run('UPDATE purchase_orders SET supplier_id=?, product_id=?, date=?, quantity=?, cost_price=?, total_amount=?, payment_type=?, notes=? WHERE purchase_id=?',
      [this.editForm.supplier_id, this.editForm.product_id, this.editForm.date, this.editForm.quantity, this.editForm.cost_price, this.editForm.quantity * this.editForm.cost_price, this.editForm.payment_type, this.editForm.notes, id]);
    if (existing) {
      if (Number(existing.product_id) === Number(this.editForm.product_id)) {
        const diff = Number(this.editForm.quantity) - Number(existing.quantity);
        if (diff !== 0) await this.updateStock(this.editForm.product_id, diff);
      } else {
        await this.updateStock(existing.product_id, -Number(existing.quantity));
        await this.updateStock(this.editForm.product_id, Number(this.editForm.quantity));
      }
    }
    // Keep inventory cost in sync with the edited purchase cost.
    await this.syncCost(this.editForm.product_id, this.editForm.cost_price);
    this.editingId = null; await this.loadData();
  }

  confirmDelete(id: number) { this.deletingId = id; this.showDeleteDialog = true; }
  async onDeleteConfirmed() {
    const order = this.orders.find(o => o.purchase_id === this.deletingId);
    if (order) await this.updateStock(order.product_id, -order.quantity);
    await this.db.run('DELETE FROM purchase_orders WHERE purchase_id=?', [this.deletingId]);
    this.showDeleteDialog = false; await this.loadData();
  }
  onDeleteCancelled() { this.showDeleteDialog = false; }
}
