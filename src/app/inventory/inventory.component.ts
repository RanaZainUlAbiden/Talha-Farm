import { Component, OnInit, ChangeDetectorRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { PaginationComponent } from '../shared/components/pagination/pagination.component';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, PaginationComponent],
  templateUrl: './inventory.component.html',
  styleUrl: './inventory.component.scss'
})
export class InventoryComponent implements OnInit, AfterViewInit {
  currentFarm: any = null;
  products: any[] = [];
  filteredProducts: any[] = [];
  showNewRow = false;
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  errorMessage = '';
  isLoading = true;
  searchTerm: string = '';
  
  newRow = { 
    product_name: '', 
    category: 'medicine', 
    unit: '', 
    current_stock: 0,
    expiry_date: '',
    min_stock_alert: 0, 
    cost_price: 0, 
    selling_price: 0 
  };

  currentPage = 1;
  pageSize = 20;

  get paginatedProducts() {
    const start = (this.currentPage - 1) * this.pageSize;
    const dataToShow = this.searchTerm ? this.filteredProducts : this.products;
    return dataToShow.slice(start, start + this.pageSize);
  }

  get totalItems() {
    return this.searchTerm ? this.filteredProducts.length : this.products.length;
  }

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {}

  ngOnInit() { 
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadProducts(); 
  }

  ngAfterViewInit() {
    this.cdr.detectChanges();
  }

  filterProducts() {
    if (!this.searchTerm.trim()) {
      this.filteredProducts = [];
      this.currentPage = 1;
      this.cdr.detectChanges();
      return;
    }
    const term = this.searchTerm.toLowerCase().trim();
    this.filteredProducts = this.products.filter(p => 
      p.product_name.toLowerCase().includes(term) ||
      p.category.toLowerCase().includes(term) ||
      (p.unit && p.unit.toLowerCase().includes(term))
    );
    this.currentPage = 1;
    this.cdr.detectChanges();
  }

  clearSearch() {
    this.searchTerm = '';
    this.filteredProducts = [];
    this.currentPage = 1;
    this.cdr.detectChanges();
  }

  async loadProducts() {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const r = await this.db.get('SELECT * FROM products WHERE farm_id=? ORDER BY product_name ASC', [this.currentFarm.farm_id]);
      this.products = r.success ? r.data : [];
      await this.db.updateBatchStatuses();
      for (const product of this.products) {
        await this.loadBatchDataForProduct(product);
      }
      if (this.searchTerm) this.filterProducts();
      this.cdr.detectChanges();
    } catch (error: any) {
      this.errorMessage = 'Failed to load products: ' + error.message;
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  async loadBatchDataForProduct(product: any) {
    try {
      const totalStock = await this.db.getTotalStock(product.product_id);
      const hasExpiring = await this.db.hasExpiringBatches(product.product_id);
      const batchesResult = await this.db.getBatchesByProduct(product.product_id, this.currentFarm.farm_id);
      const batches = batchesResult.success && batchesResult.data ? batchesResult.data : [];
      const batchCount = batches.length;

      // Find earliest expiry date
      if (batches.length > 0) {
        const sorted = [...batches].sort((a: any, b: any) => (a.expiry_date || '').localeCompare(b.expiry_date || ''));
        product.earliest_expiry = sorted[0]?.expiry_date ? sorted[0].expiry_date : null;
      } else {
        product.earliest_expiry = null;
      }

      product.calculated_stock = totalStock;
      product.has_expiring_batches = hasExpiring;
      product.batch_count = batchCount;
    } catch (error) {
      product.calculated_stock = 0;
      product.has_expiring_batches = false;
      product.batch_count = 0;
      product.earliest_expiry = null;
    }
  }

  getMinAlert(product: any): { text: string, class: string } {
    if (!product) return { text: 'N/A', class: '' };
    if (product.has_expiring_batches) return { text: '⚠️ Expiring', class: 'expiry-alert' };
    const stock = product.calculated_stock || 0;
    const minAlert = product.min_stock_alert || 0;
    if (minAlert > 0 && stock <= minAlert) return { text: '⚠️ Low', class: 'low-stock-alert' };
    return { text: '✅ OK', class: 'stock-ok' };
  }

  getStockDisplay(product: any): number { return product.calculated_stock || 0; }
  getBatchCount(product: any): number { return product.batch_count || 0; }
  isLowStock(product: any): boolean { const s = product.calculated_stock || 0; const m = product.min_stock_alert || 0; return m > 0 && s <= m; }
  isExpiring(product: any): boolean { return product.has_expiring_batches || false; }

  openBatchManagement(productId: number) {
    if (!productId) { this.errorMessage = 'Invalid product ID'; return; }
    const product = this.products.find(p => p.product_id === productId);
    if (!product) { this.errorMessage = 'Product not found'; return; }
    const fullPath = `/app/distribution-batch/${productId}`;
    this.router.navigateByUrl(fullPath).catch(() => {
      this.router.navigate(['app', 'distribution-batch', productId]);
    });
  }

  addNewRow() { 
    this.showNewRow = true; 
    this.newRow = { product_name: '', category: 'medicine', unit: '', current_stock: 0, expiry_date: '', min_stock_alert: 0, cost_price: 0, selling_price: 0 }; 
    this.cdr.detectChanges();
  }

  cancelNewRow() { this.showNewRow = false; this.cdr.detectChanges(); }

  async saveNewRow() {
    if (!this.newRow.product_name.trim()) { this.errorMessage = 'Product name is required'; return; }
    this.isSaving = true; this.errorMessage = ''; this.showNewRow = false;
    try {
      const result = await this.db.run(
        'INSERT INTO products (farm_id, product_name, category, unit, current_stock, min_stock_alert, cost_price, selling_price) VALUES (?,?,?,?,?,?,?,?)',
        [this.currentFarm.farm_id, this.newRow.product_name, this.newRow.category, this.newRow.unit, 0, this.newRow.min_stock_alert, this.newRow.cost_price, this.newRow.selling_price]
      );
      if (result.success) {
        const pr = await this.db.get('SELECT last_insert_rowid() as id', []);
        const productId = pr.success && pr.data?.[0] ? pr.data[0].id : null;
        if (productId) {
          const stockToAdd = this.newRow.current_stock > 0 ? this.newRow.current_stock : 0;
          if (stockToAdd > 0) {
            const today = new Date().toISOString().split('T')[0];
            const oneYearLater = new Date(); oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
            const expiryDate = this.newRow.expiry_date || oneYearLater.toISOString().split('T')[0];
            await this.db.addBatch({ product_id: productId, farm_id: this.currentFarm.farm_id, manufacturing_date: today, expiry_date: expiryDate, quantity: stockToAdd, purchase_price: this.newRow.cost_price });
          }
        }
        await this.loadProducts();
      } else {
        this.errorMessage = 'Failed to save: ' + (result.error || 'Unknown error');
      }
    } catch (error: any) {
      this.errorMessage = 'Failed to save: ' + error.message;
    } finally {
      this.isSaving = false; this.cdr.detectChanges();
    }
  }

  startEdit(p: any) { 
    this.editingId = p.product_id; 
    this.editForm = { product_name: p.product_name, category: p.category, unit: p.unit, min_stock_alert: p.min_stock_alert, cost_price: p.cost_price, selling_price: p.selling_price }; 
    this.cdr.detectChanges();
  }

  cancelEdit() { this.editingId = null; this.cdr.detectChanges(); }

  async saveEdit(id: number) {
    try {
      await this.db.run('UPDATE products SET product_name=?, category=?, unit=?, min_stock_alert=?, cost_price=?, selling_price=? WHERE product_id=?', [this.editForm.product_name, this.editForm.category, this.editForm.unit, this.editForm.min_stock_alert, this.editForm.cost_price, this.editForm.selling_price, id]);
      this.editingId = null;
      await this.loadProducts();
    } catch (error: any) {
      this.errorMessage = 'Failed to update: ' + error.message;
      this.cdr.detectChanges();
    }
  }

  confirmDelete(id: number) { this.deletingId = id; this.showDeleteDialog = true; this.cdr.detectChanges(); }

  async onDeleteConfirmed() {
    try {
      await this.db.run('DELETE FROM product_batches WHERE product_id = ?', [this.deletingId]);
      await this.db.run('DELETE FROM products WHERE product_id=?', [this.deletingId]);
      this.showDeleteDialog = false; this.deletingId = null;
      await this.loadProducts();
    } catch (error: any) {
      this.errorMessage = 'Failed to delete: ' + error.message;
      this.showDeleteDialog = false;
    }
  }

  onDeleteCancelled() { this.showDeleteDialog = false; this.cdr.detectChanges(); }
}