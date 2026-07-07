import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  templateUrl: './inventory.component.html',
  styleUrl: './inventory.component.scss'
})
export class InventoryComponent implements OnInit {
  currentFarm: any = null;
  products: any[] = [];
  showNewRow = false;
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  errorMessage = '';
  newRow = { product_name: '', category: 'medicine', unit: '', current_stock: 0, min_stock_alert: 0, cost_price: 0, selling_price: 0 };

  constructor(private db: DatabaseService, private authService: AuthService, private cdr: ChangeDetectorRef) {}

  ngOnInit() { this.currentFarm = this.authService.getCurrentFarm(); this.loadProducts(); }

  async loadProducts() {
    const r = await this.db.get('SELECT * FROM products WHERE farm_id=? ORDER BY product_name ASC', [this.currentFarm.farm_id]);
    this.products = r.success ? r.data : [];
    this.cdr.detectChanges();
  }

  addNewRow() { this.showNewRow = true; this.newRow = { product_name: '', category: 'medicine', unit: '', current_stock: 0, min_stock_alert: 0, cost_price: 0, selling_price: 0 }; }
  cancelNewRow() { this.showNewRow = false; }
  async saveNewRow() {
    if (!this.newRow.product_name.trim()) return;
    this.isSaving = true; this.showNewRow = false;
    await this.db.run('INSERT INTO products (farm_id, product_name, category, unit, current_stock, min_stock_alert, cost_price, selling_price) VALUES (?,?,?,?,?,?,?,?)',
      [this.currentFarm.farm_id, this.newRow.product_name, this.newRow.category, this.newRow.unit, this.newRow.current_stock, this.newRow.min_stock_alert, this.newRow.cost_price, this.newRow.selling_price]);
    this.isSaving = false; await this.loadProducts();
  }

  startEdit(p: any) { this.editingId = p.product_id; this.editForm = { product_name: p.product_name, category: p.category, unit: p.unit, current_stock: p.current_stock, min_stock_alert: p.min_stock_alert, cost_price: p.cost_price, selling_price: p.selling_price }; }
  cancelEdit() { this.editingId = null; }
  async saveEdit(id: number) {
    await this.db.run('UPDATE products SET product_name=?, category=?, unit=?, current_stock=?, min_stock_alert=?, cost_price=?, selling_price=? WHERE product_id=?',
      [this.editForm.product_name, this.editForm.category, this.editForm.unit, this.editForm.current_stock, this.editForm.min_stock_alert, this.editForm.cost_price, this.editForm.selling_price, id]);
    this.editingId = null; await this.loadProducts();
  }

  confirmDelete(id: number) { this.deletingId = id; this.showDeleteDialog = true; }
  async onDeleteConfirmed() { await this.db.run('DELETE FROM products WHERE product_id=?', [this.deletingId]); this.showDeleteDialog = false; await this.loadProducts(); }
  onDeleteCancelled() { this.showDeleteDialog = false; }
}