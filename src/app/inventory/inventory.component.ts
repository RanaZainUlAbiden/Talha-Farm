import { Component, OnInit, ChangeDetectorRef, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { FormStateService } from '../shared/services/form-state.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { PaginationComponent } from '../shared/components/pagination/pagination.component';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, PaginationComponent],
  templateUrl: './inventory.component.html',
  styleUrl: './inventory.component.scss'
})
export class InventoryComponent implements OnInit, AfterViewInit, OnDestroy {
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

  // ── CATEGORIES ────────────────────────────────────────────
 readonly DEFAULT_CATEGORIES = [];
dbCategories: any[] = [];


  showCategoryModal = false;
  newCategoryName = '';
  categoryError = '';

  get allCategories(): string[] {
  const custom = this.dbCategories.map((c: any) => c.category_name);
  return [...this.DEFAULT_CATEGORIES, ...custom];
}
  newRow = { 
    product_name: '', 
    category: 'medicine', 
    unit: '', 
    current_stock: null as number | null,
    expiry_date: '',
    min_stock_alert: null as number | null,
    cost_price: null as number | null,
    selling_price: null as number | null
  };

  currentPage = 1;
  pageSize = 20;

  // ── STATE PERSISTENCY KEYS ────────────────────────────────
  private readonly FORM_KEY = 'inventory_form_state';

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
    private router: Router,
    private route: ActivatedRoute,
    private formState: FormStateService
  ) {}

 async  ngOnInit() { 
    this.currentFarm = this.authService.getCurrentFarm();
await this.loadCategories();
    this.loadProducts(); 
    
    this.route.queryParams.subscribe(params => {
      if (params['category']) {
        this.searchTerm = params['category'];
        if (this.products.length > 0) {
          this.filterProducts();
        }
      }
    });
  }

  ngAfterViewInit() {
    this.cdr.detectChanges();
  }

  ngOnDestroy() {
    // Save state when component is destroyed
    if (this.showNewRow && !this.isSaving) {
      this.saveState();
    }
  }

  // ── STATE PERSISTENCY METHODS ─────────────────────────────

  private saveState(): void {
    if (this.showNewRow) {
      const state = {
        showNewRow: this.showNewRow,
        newRow: this.newRow,
        searchTerm: this.searchTerm,
        currentPage: this.currentPage
      };
      this.formState.saveState(this.FORM_KEY, state);
      console.log('💾 Inventory state auto-saved');
    }
  }

  private restoreState(): void {
    const state = this.formState.getState(this.FORM_KEY);
    if (state && state.showNewRow) {
      console.log('📂 Restoring Inventory form state:', state);
      this.showNewRow = state.showNewRow;
      if (state.newRow) {
        this.newRow = { ...this.newRow, ...state.newRow };
      }
      if (state.searchTerm) {
        this.searchTerm = state.searchTerm;
      }
      if (state.currentPage) {
        this.currentPage = state.currentPage;
      }
      this.cdr.detectChanges();
    }
  }

  // ── AUTO-SAVE ON INPUT CHANGE ─────────────────────────────

  // ── CATEGORY MANAGEMENT ──────────────────────────────────

  private async loadCategories(): Promise<void> {
  try {
    const result = await this.db.getCategories(this.currentFarm.farm_id);
    this.dbCategories = result.success ? result.data : [];
    if (this.dbCategories.length === 0) {
      for (const cat of this.DEFAULT_CATEGORIES) {
        await this.db.addCategory(this.currentFarm.farm_id, cat);
      }
      const refreshed = await this.db.getCategories(this.currentFarm.farm_id);
      this.dbCategories = refreshed.success ? refreshed.data : [];
    }
  } catch {
    this.dbCategories = [];
  }
}

  openCategoryModal(): void {
    this.newCategoryName = '';
    this.categoryError = '';
    this.showCategoryModal = true;
    this.cdr.detectChanges();
  }

  closeCategoryModal(): void {
    this.showCategoryModal = false;
    this.newCategoryName = '';
    this.categoryError = '';
    this.cdr.detectChanges();
  }

  async saveCategory(): Promise<void> {
  const name = this.newCategoryName.trim().toLowerCase();
  if (!name) { this.categoryError = 'Category name is required.'; return; }
  if (this.allCategories.includes(name)) { this.categoryError = 'Category already exists.'; return; }
  await this.db.addCategory(this.currentFarm.farm_id, name);
  await this.loadCategories();
  this.closeCategoryModal();
}

  onFormChange(): void {
    if (this.showNewRow) {
      this.saveState();
    }
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
      (p.category && p.category.toLowerCase().includes(term)) ||
      (p.unit && p.unit.toLowerCase().includes(term))
    );
    this.currentPage = 1;
    this.cdr.detectChanges();
    this.onFormChange();
  }

  clearSearch() {
    this.searchTerm = '';
    this.filteredProducts = [];
    this.currentPage = 1;
    this.cdr.detectChanges();
    this.onFormChange();
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
      
      // 🔥 Restore state AFTER products are loaded
      this.restoreState();
      
      if (this.searchTerm) this.filterProducts();
      this.cdr.detectChanges();
      
    } catch (error: any) {
      this.errorMessage = 'Failed to load products: ' + error.message;
      console.error('Load error:', error);
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

      if (batches.length > 0) {
        const sorted = [...batches].sort((a: any, b: any) => (a.expiry_date || '').localeCompare(b.expiry_date || ''));
        product.earliest_expiry = sorted[0]?.expiry_date ? sorted[0].expiry_date : null;
      } else {
        product.earliest_expiry = null;
      }

      product.calculated_stock = totalStock;
      product.has_expiring_batches = hasExpiring;
      product.batch_count = batchCount;
      
      console.log(`📊 Product ${product.product_name}: Stock=${totalStock}, Batches=${batchCount}`);
      
    } catch (error) {
      console.error(`Failed to load batch data for product ${product.product_id}:`, error);
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

  getStockDisplay(product: any): number { 
    return product.calculated_stock || 0; 
  }
  
  getBatchCount(product: any): number { 
    return product.batch_count || 0; 
  }
  
  isLowStock(product: any): boolean { 
    const s = product.calculated_stock || 0; 
    const m = product.min_stock_alert || 0; 
    return m > 0 && s <= m; 
  }
  
  isExpiring(product: any): boolean { 
    return product.has_expiring_batches || false; 
  }

  openBatchManagement(productId: number) {
    if (!productId) { 
      this.errorMessage = 'Invalid product ID'; 
      return; 
    }
    const product = this.products.find(p => p.product_id === productId);
    if (!product) { 
      this.errorMessage = 'Product not found'; 
      return; 
    }
    // Save state before navigating
    this.saveState();
    const fullPath = `/app/distribution-batch/${productId}`;
    this.router.navigateByUrl(fullPath).catch(() => {
      this.router.navigate(['app', 'distribution-batch', productId]);
    });
  }

  addNewRow() { 
    this.showNewRow = true; 
    this.newRow = { 
      product_name: '', 
      category: 'medicine', 
      unit: '', 
      current_stock: null,
      expiry_date: '', 
      min_stock_alert: null,
      cost_price: null,
      selling_price: null
    }; 
    this.cdr.detectChanges();
    this.saveState();
  }

  cancelNewRow() { 
    this.showNewRow = false; 
    this.cdr.detectChanges();
    this.formState.clearState(this.FORM_KEY);
  }

  async saveNewRow() {
    if (!this.newRow.product_name.trim()) { 
      this.errorMessage = 'Product name is required'; 
      return; 
    }
    
    this.isSaving = true; 
    this.errorMessage = ''; 
    this.showNewRow = false;
    
    try {
      const result = await this.db.run(
        'INSERT INTO products (farm_id, product_name, category, unit, current_stock, min_stock_alert, cost_price, selling_price) VALUES (?,?,?,?,?,?,?,?)',
        [
          this.currentFarm.farm_id,
          this.newRow.product_name,
          this.newRow.category,
          this.newRow.unit,
          0,
          this.newRow.min_stock_alert || 0,
          this.newRow.cost_price || 0,
          this.newRow.selling_price || 0
        ]
      );
      
      if (result.success) {
        const pr = await this.db.get('SELECT last_insert_rowid() as id', []);
        const productId = pr.success && pr.data && pr.data.length > 0 ? pr.data[0].id : null;
        
        if (productId) {
          const stockToAdd = (this.newRow.current_stock || 0) > 0 ? this.newRow.current_stock || 0 : 0;
          
          if (stockToAdd > 0) {
            const today = new Date().toISOString().split('T')[0];
            const oneYearLater = new Date(); 
            oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
            const expiryDate = this.newRow.expiry_date || oneYearLater.toISOString().split('T')[0];
            
            await this.db.addBatch({ 
              product_id: productId, 
              farm_id: this.currentFarm.farm_id, 
              manufacturing_date: today, 
              expiry_date: expiryDate, 
              quantity: stockToAdd, 
              purchase_price: this.newRow.cost_price || 0
            });
            
            console.log(`✅ Added ${stockToAdd} units to product ${this.newRow.product_name} as batch`);
          }
        }
        
        // 🔥 Clear state on successful save
        this.formState.clearState(this.FORM_KEY);
        await this.loadProducts();
      } else {
        this.errorMessage = 'Failed to save: ' + (result.error || 'Unknown error');
      }
    } catch (error: any) {
      this.errorMessage = 'Failed to save: ' + error.message;
      console.error('Save error:', error);
    } finally {
      this.isSaving = false; 
      this.cdr.detectChanges();
    }
  }

  startEdit(p: any) { 
    this.editingId = p.product_id; 
    this.editForm = { 
      product_name: p.product_name, 
      category: p.category, 
      unit: p.unit, 
      min_stock_alert: p.min_stock_alert, 
      cost_price: p.cost_price, 
      selling_price: p.selling_price 
    }; 
    this.cdr.detectChanges();
  }

  cancelEdit() { 
    this.editingId = null; 
    this.cdr.detectChanges(); 
  }

  async saveEdit(id: number) {
    try {
      await this.db.run(
        'UPDATE products SET product_name=?, category=?, unit=?, min_stock_alert=?, cost_price=?, selling_price=? WHERE product_id=?',
        [this.editForm.product_name, this.editForm.category, this.editForm.unit, this.editForm.min_stock_alert, this.editForm.cost_price, this.editForm.selling_price, id]
      );
      this.editingId = null;
      await this.loadProducts();
    } catch (error: any) {
      this.errorMessage = 'Failed to update: ' + error.message;
      this.cdr.detectChanges();
    }
  }

  confirmDelete(id: number) { 
    this.deletingId = id; 
    this.showDeleteDialog = true; 
    this.cdr.detectChanges();
  }

  async onDeleteConfirmed() {
    try {
      await this.db.run('DELETE FROM product_batches WHERE product_id = ?', [this.deletingId]);
      await this.db.run('DELETE FROM products WHERE product_id=?', [this.deletingId]);
      this.showDeleteDialog = false; 
      this.deletingId = null;
      await this.loadProducts();
    } catch (error: any) {
      this.errorMessage = 'Failed to delete: ' + error.message;
      this.showDeleteDialog = false;
    }
  }

  onDeleteCancelled() { 
    this.showDeleteDialog = false; 
    this.cdr.detectChanges(); 
  }
}
