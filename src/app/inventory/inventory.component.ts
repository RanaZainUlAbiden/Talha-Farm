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
    min_stock_alert: 0, 
    cost_price: 0, 
    selling_price: 0 
  };

  currentPage = 1;
  pageSize = 20;

  private batchCache: Map<number, { total: number, hasExpiring: boolean, count: number }> = new Map();

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
  ) {
    console.log('🔧 InventoryComponent constructor called');
  }

  ngOnInit() { 
    console.log('🔄 ngOnInit called');
    this.currentFarm = this.authService.getCurrentFarm();
    console.log('🏠 Current Farm:', this.currentFarm);
    this.loadProducts(); 
  }

  ngAfterViewInit() {
    console.log('👁️ ngAfterViewInit called');
    this.cdr.detectChanges();
  }

  filterProducts() {
    console.log('🔍 filterProducts called with searchTerm:', this.searchTerm);
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
    console.log(`📊 Filtered ${this.filteredProducts.length} products from ${this.products.length}`);
    this.currentPage = 1;
    this.cdr.detectChanges();
  }

  clearSearch() {
    console.log('🧹 clearSearch called');
    this.searchTerm = '';
    this.filteredProducts = [];
    this.currentPage = 1;
    this.cdr.detectChanges();
  }

  // ====================================================
  // 🟢 FIXED: Better loading with force detection
  // ====================================================
  async loadProducts() {
    console.log('📦 loadProducts started');
    this.isLoading = true;
    this.errorMessage = '';
    
    try {
      this.cdr.detectChanges();
      console.log('📦 Fetching products for farm_id:', this.currentFarm?.farm_id);
      
      const r = await this.db.get('SELECT * FROM products WHERE farm_id=? ORDER BY product_name ASC', [this.currentFarm.farm_id]);
      this.products = r.success ? r.data : [];
      
      console.log(`📦 Loaded ${this.products.length} products from database`);
      console.log('📦 Products data:', JSON.stringify(this.products, null, 2));
      
      if (this.products.length > 0) {
        console.log('📦 First product sample:', {
          id: this.products[0].product_id,
          name: this.products[0].product_name,
          has_id: !!this.products[0].product_id,
          id_type: typeof this.products[0].product_id
        });
      }
      
      console.log('🔄 Updating batch statuses...');
      await this.db.updateBatchStatuses();
      console.log('✅ Batch statuses updated');
      
      console.log('📊 Loading batch data for each product...');
      for (const product of this.products) {
        await this.loadBatchDataForProduct(product);
      }
      
      console.log('📊 Final products with batch data:');
      console.table(this.products.map(p => ({
        ID: p.product_id,
        Name: p.product_name,
        Stock: p.calculated_stock,
        Batches: p.batch_count,
        Expiring: p.has_expiring_batches
      })));
      
      if (this.searchTerm) {
        this.filterProducts();
      }
      
      this.cdr.detectChanges();
      console.log('✅ loadProducts completed successfully');
      
    } catch (error: any) {
      this.errorMessage = 'Failed to load products: ' + error.message;
      console.error('❌ Load error:', error);
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  async loadBatchDataForProduct(product: any) {
    console.log(`📊 Loading batch data for product ID: ${product.product_id}, Name: ${product.product_name}`);
    
    try {
      const totalStock = await this.db.getTotalStock(product.product_id);
      console.log(`📊 Product ${product.product_id} - Total Stock: ${totalStock}`);
      
      const hasExpiring = await this.db.hasExpiringBatches(product.product_id);
      console.log(`📊 Product ${product.product_id} - Has Expiring: ${hasExpiring}`);
      
      const batchesResult = await this.db.getBatchesByProduct(product.product_id, this.currentFarm.farm_id);
      const batchCount = batchesResult.success && batchesResult.data ? batchesResult.data.length : 0;
      console.log(`📊 Product ${product.product_id} - Batch Count: ${batchCount}`);
      
      if (batchesResult.success && batchesResult.data && batchesResult.data.length > 0) {
        console.log(`📊 Product ${product.product_id} - Batches:`, batchesResult.data.map((b: any) => ({
          id: b.batch_id,
          code: b.batch_code,
          qty: b.quantity,
          status: b.status || b.calculated_status
        })));
      }
      
      this.batchCache.set(product.product_id, {
        total: totalStock,
        hasExpiring: hasExpiring,
        count: batchCount
      });
      
      product.calculated_stock = totalStock;
      product.has_expiring_batches = hasExpiring;
      product.batch_count = batchCount;
      
      console.log(`✅ Product ${product.product_name} (ID: ${product.product_id}) - Stock: ${totalStock}, Batches: ${batchCount}, Expiring: ${hasExpiring}`);
      
    } catch (error) {
      console.error(`❌ Failed to load batch data for product ${product.product_id}:`, error);
      product.calculated_stock = 0;
      product.has_expiring_batches = false;
      product.batch_count = 0;
    }
  }

  getMinAlert(product: any): { text: string, class: string } {
    if (!product) return { text: 'N/A', class: '' };
    
    if (product.has_expiring_batches) {
      return { text: '⚠️ Expiring Soon', class: 'expiry-alert' };
    }
    
    const stock = product.calculated_stock || 0;
    const minAlert = product.min_stock_alert || 0;
    if (minAlert > 0 && stock <= minAlert) {
      return { text: '⚠️ Low Stock', class: 'low-stock-alert' };
    }
    
    return { text: '✅ OK', class: 'stock-ok' };
  }

  getStockDisplay(product: any): number {
    return product.calculated_stock || 0;
  }

  getBatchCount(product: any): number {
    const count = product.batch_count || 0;
    console.log(`🔢 getBatchCount for ${product.product_name}: ${count}`);
    return count;
  }

  isLowStock(product: any): boolean {
    const stock = product.calculated_stock || 0;
    const minAlert = product.min_stock_alert || 0;
    return minAlert > 0 && stock <= minAlert;
  }

  isExpiring(product: any): boolean {
    return product.has_expiring_batches || false;
  }

  // ====================================================
  // 🟢 FIXED: Better navigation with error handling
  // ====================================================
  openBatchManagement(productId: number) {
  console.log('🔍 ===== OPEN BATCH MANAGEMENT CALLED =====');
  console.log('🔍 productId received:', productId);
  console.log('🔍 productId type:', typeof productId);
  console.log('🔍 productId is truthy?', !!productId);
  console.log('🔍 Current products array:', this.products);
  
  // Check if productId is valid
  if (!productId || productId === 0 || productId === undefined || productId === null) {
    console.error('❌ Invalid product ID:', productId);
    this.errorMessage = 'Cannot open batch management: Invalid product ID';
    this.cdr.detectChanges();
    return;
  }
  
  // Check if product exists in the products array
  const product = this.products.find(p => p.product_id === productId);
  if (!product) {
    console.error('❌ Product not found with ID:', productId);
    console.log('🔍 Available product IDs:', this.products.map(p => p.product_id));
    this.errorMessage = 'Product not found';
    this.cdr.detectChanges();
    return;
  }
  
  console.log(`✅ Product found: ${product.product_name} (ID: ${productId})`);
  console.log(`✅ Product details:`, {
    id: product.product_id,
    name: product.product_name,
    stock: product.calculated_stock,
    batches: product.batch_count
  });
  
  // 🔥 FIX: Navigate with the FULL path including 'app'
  const fullPath = `/app/distribution-batch/${productId}`;
  console.log(`✅ Navigating to: ${fullPath}`);
  
  try {
    const navigationResult = this.router.navigateByUrl(fullPath);
    console.log('📤 Navigation result (promise):', navigationResult);
    
    // Check if navigation was successful
    navigationResult.then(
      (success) => {
        if (success) {
          console.log('✅ Navigation successful!');
        } else {
          console.error('❌ Navigation returned false!');
          this.errorMessage = 'Navigation failed - route not found?';
          this.cdr.detectChanges();
          
          // 🔥 FALLBACK: Try with array navigation
          console.log('🔄 Trying fallback navigation...');
          this.router.navigate(['app', 'distribution-batch', productId]).then(
            (s) => {
              if (s) {
                console.log('✅ Fallback navigation successful!');
              } else {
                console.error('❌ Fallback navigation failed!');
              }
            },
            (e) => {
              console.error('❌ Fallback navigation error:', e);
            }
          );
        }
      },
      (error) => {
        console.error('❌ Navigation promise rejected:', error);
        this.errorMessage = 'Navigation error: ' + (error.message || error);
        this.cdr.detectChanges();
        
        // 🔥 FALLBACK: Try with array navigation
        console.log('🔄 Trying fallback navigation...');
        this.router.navigate(['app', 'distribution-batch', productId]).then(
          (s) => {
            if (s) {
              console.log('✅ Fallback navigation successful!');
            } else {
              console.error('❌ Fallback navigation failed!');
            }
          },
          (e) => {
            console.error('❌ Fallback navigation error:', e);
          }
        );
      }
    );
  } catch (error: any) {
    console.error('❌ Exception in navigation:', error);
    this.errorMessage = 'Error: ' + (error.message || error);
    this.cdr.detectChanges();
    
    // 🔥 FALLBACK: Try with array navigation
    console.log('🔄 Trying fallback navigation...');
    this.router.navigate(['app', 'distribution-batch', productId]).then(
      (s) => {
        if (s) {
          console.log('✅ Fallback navigation successful!');
        } else {
          console.error('❌ Fallback navigation failed!');
        }
      },
      (e) => {
        console.error('❌ Fallback navigation error:', e);
      }
    );
  }
  
  console.log('🔍 ===== END OPEN BATCH MANAGEMENT =====');
}

  addNewRow() { 
    console.log('➕ addNewRow called');
    this.showNewRow = true; 
    this.newRow = { 
      product_name: '', 
      category: 'medicine', 
      unit: '', 
      current_stock: 0, 
      min_stock_alert: 0, 
      cost_price: 0, 
      selling_price: 0 
    }; 
    this.cdr.detectChanges();
  }

  cancelNewRow() { 
    console.log('❌ cancelNewRow called');
    this.showNewRow = false; 
    this.cdr.detectChanges();
  }

  async saveNewRow() {
    console.log('💾 saveNewRow called');
    console.log('📝 New row data:', this.newRow);
    
    if (!this.newRow.product_name.trim()) {
      console.warn('⚠️ Product name is empty');
      this.errorMessage = 'Product name is required';
      this.cdr.detectChanges();
      return;
    }
    
    this.isSaving = true;
    this.errorMessage = '';
    this.showNewRow = false;
    
    try {
      console.log('📝 Inserting product into database...');
      const result = await this.db.run(
        `INSERT INTO products (farm_id, product_name, category, unit, current_stock, min_stock_alert, cost_price, selling_price) 
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          this.currentFarm.farm_id, 
          this.newRow.product_name, 
          this.newRow.category, 
          this.newRow.unit, 
          0,
          this.newRow.min_stock_alert, 
          this.newRow.cost_price, 
          this.newRow.selling_price
        ]
      );
      
      console.log('📝 Insert result:', result);
      
      if (result.success) {
        const productResult = await this.db.get('SELECT last_insert_rowid() as id', []);
        const productId = productResult.success && productResult.data && productResult.data.length > 0 
          ? productResult.data[0].id 
          : null;
        
        console.log(`📝 New product ID: ${productId}`);
        
        if (productId) {
          const today = new Date().toISOString().split('T')[0];
          const oneYearLater = new Date();
          oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
          const expiryDate = oneYearLater.toISOString().split('T')[0];
          
          const stockToAdd = this.newRow.current_stock > 0 ? this.newRow.current_stock : 0;
          console.log(`📝 Stock to add: ${stockToAdd}`);
          
          if (stockToAdd > 0) {
            console.log('📝 Creating batch...');
            const batchResult = await this.db.addBatch({
              product_id: productId,
              farm_id: this.currentFarm.farm_id,
              manufacturing_date: today,
              expiry_date: expiryDate,
              quantity: stockToAdd,
              purchase_price: this.newRow.cost_price
            });
            
            if (batchResult.success) {
              console.log(`✅ Batch created with ${stockToAdd} units, Batch Code: ${batchResult.batch_code}`);
            } else {
              console.error('❌ Batch creation failed:', batchResult.error);
            }
          }
        }
        
        console.log('🔄 Reloading products...');
        await this.loadProducts();
      } else {
        this.errorMessage = 'Failed to save product: ' + (result.error || 'Unknown error');
        console.error('❌ Save failed:', result.error);
      }
    } catch (error: any) {
      this.errorMessage = 'Failed to save product: ' + error.message;
      console.error('❌ Save error:', error);
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  startEdit(p: any) { 
    console.log(`✏️ startEdit called for product: ${p.product_name} (ID: ${p.product_id})`);
    this.editingId = p.product_id; 
    this.editForm = { 
      product_name: p.product_name, 
      category: p.category, 
      unit: p.unit, 
      current_stock: p.current_stock, 
      min_stock_alert: p.min_stock_alert, 
      cost_price: p.cost_price, 
      selling_price: p.selling_price 
    }; 
    this.cdr.detectChanges();
  }

  cancelEdit() { 
    console.log('❌ cancelEdit called');
    this.editingId = null; 
    this.cdr.detectChanges();
  }

  async saveEdit(id: number) {
    console.log(`💾 saveEdit called for product ID: ${id}`);
    console.log('📝 Edit form data:', this.editForm);
    
    try {
      await this.db.run(
        `UPDATE products SET product_name=?, category=?, unit=?, current_stock=?, min_stock_alert=?, cost_price=?, selling_price=? WHERE product_id=?`,
        [
          this.editForm.product_name, 
          this.editForm.category, 
          this.editForm.unit, 
          0,
          this.editForm.min_stock_alert, 
          this.editForm.cost_price, 
          this.editForm.selling_price, 
          id
        ]
      );
      this.editingId = null;
      console.log('✅ Product updated successfully');
      await this.loadProducts();
    } catch (error: any) {
      this.errorMessage = 'Failed to update product: ' + error.message;
      console.error('❌ Update error:', error);
      this.cdr.detectChanges();
    }
  }

  confirmDelete(id: number) { 
    console.log(`🗑️ confirmDelete called for product ID: ${id}`);
    this.deletingId = id; 
    this.showDeleteDialog = true; 
    this.cdr.detectChanges();
  }

  async onDeleteConfirmed() {
    console.log(`🗑️ onDeleteConfirmed for product ID: ${this.deletingId}`);
    try {
      console.log('📝 Deleting product_batches...');
      await this.db.run('DELETE FROM product_batches WHERE product_id = ?', [this.deletingId]);
      console.log('📝 Deleting product...');
      await this.db.run('DELETE FROM products WHERE product_id=?', [this.deletingId]);
      this.showDeleteDialog = false;
      this.deletingId = null;
      console.log('✅ Product deleted successfully');
      await this.loadProducts();
    } catch (error: any) {
      this.errorMessage = 'Failed to delete product: ' + error.message;
      console.error('❌ Delete error:', error);
      this.showDeleteDialog = false;
      this.cdr.detectChanges();
    }
  }

  onDeleteCancelled() { 
    console.log('❌ onDeleteCancelled called');
    this.showDeleteDialog = false; 
    this.cdr.detectChanges();
  }
}