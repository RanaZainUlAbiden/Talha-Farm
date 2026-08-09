import { Component, OnInit, ChangeDetectorRef, HostListener, OnDestroy, ViewChild, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { FormStateService } from '../shared/services/form-state.service';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PaginationComponent } from '../shared/components/pagination/pagination.component';

@Component({
  selector: 'app-sales-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, DateOnlyPipe, ConfirmDialogComponent, PaginationComponent],
  templateUrl: './sales-orders.component.html',
  styleUrl: './sales-orders.component.scss'
})
export class SalesOrdersComponent implements OnInit, OnDestroy {
  currentFarm: any = null;
  products: any[] = [];
  customers: any[] = [];

  viewMode: 'list' | 'create' | 'edit' = 'list';
  allBills: any[] = [];
  filteredBills: any[] = [];
  billSearchTerm: string = '';
  isEditMode: boolean = false;
  editingBillId: number | null = null;
  showDeleteDialog: boolean = false;
  deletingBillId: number | null = null;
  errorMessage: string = '';
  isLoading: boolean = true;

  currentPage = 1;
  pageSize = 10;

  get paginatedBills() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredBills.slice(start, start + this.pageSize);
  }

  gridItems: any[] = [];
  productSearchTerm: string = '';
  productOptions: any[] = [];
  showProductDropdown: boolean = false;
  highlightedIndex: number = -1;

  @ViewChild('productSearchInput') productSearchInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('paidAmountInput') paidAmountInputRef!: ElementRef<HTMLInputElement>;
  @ViewChildren('qtyInput') qtyInputs!: QueryList<ElementRef<HTMLInputElement>>;

  customerType: 'walkin' | 'regular' | 'internal' = 'walkin';
  selectedCustomerId: number | null = null;
  selectedCustomer: any = null;

  internalTargetModule: string = 'broiler';
  internalTargetFlockId: number | null = null;
  internalFlocks: any[] = [];

  paymentMethod: 'cash' | 'bank' = 'cash';
  customerHasBank: boolean = false;
  customerBankBalance: number = 0;
  customerBankId: number | null = null;

  paidAmount: number = 0;
  isSubmitting: boolean = false;
  private lastCartSubtotal: number = 0;

  // ── STATE PERSISTENCY KEYS ────────────────────────────────
  private readonly FORM_KEY = 'sales_orders_form_state';
  private saveTimeout: any = null;

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private formState: FormStateService
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadData();
  }

  ngOnDestroy() {
    if (this.viewMode !== 'list' && !this.isSubmitting) {
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
      if (this.viewMode !== 'list') {
        const state = {
          viewMode: this.viewMode,
          gridItems: this.gridItems,
          customerType: this.customerType,
          selectedCustomerId: this.selectedCustomerId,
          paidAmount: this.paidAmount,
          paymentMethod: this.paymentMethod,
          customerHasBank: this.customerHasBank,
          customerBankBalance: this.customerBankBalance,
          customerBankId: this.customerBankId,
          internalTargetModule: this.internalTargetModule,
          internalTargetFlockId: this.internalTargetFlockId,
          productSearchTerm: this.productSearchTerm,
          isEditMode: this.isEditMode,
          editingBillId: this.editingBillId,
          currentPage: this.currentPage,
          billSearchTerm: this.billSearchTerm
        };
        this.formState.saveState(this.FORM_KEY, state);
        console.log('💾 Sales orders state auto-saved');
      } else {
        this.formState.clearState(this.FORM_KEY);
      }
    }, 500);
  }

  private restoreState(): void {
    const state = this.formState.getState(this.FORM_KEY);
    if (state && state.viewMode && state.viewMode !== 'list') {
      console.log('📂 Restoring Sales Orders form state:', state);
      this.viewMode = state.viewMode;
      this.gridItems = state.gridItems || [];
      this.customerType = state.customerType || 'walkin';
      this.selectedCustomerId = state.selectedCustomerId || null;
      this.paidAmount = state.paidAmount || 0;
      this.paymentMethod = state.paymentMethod || 'cash';
      this.customerHasBank = state.customerHasBank || false;
      this.customerBankBalance = state.customerBankBalance || 0;
      this.customerBankId = state.customerBankId || null;
      this.internalTargetModule = state.internalTargetModule || 'broiler';
      this.internalTargetFlockId = state.internalTargetFlockId || null;
      this.productSearchTerm = state.productSearchTerm || '';
      this.isEditMode = state.isEditMode || false;
      this.editingBillId = state.editingBillId || null;
      this.currentPage = state.currentPage || 1;
      this.billSearchTerm = state.billSearchTerm || '';
      
      if (this.customerType === 'internal') {
        this.loadInternalTargets();
      }
      if (this.selectedCustomerId) {
        this.checkCustomerBank(this.selectedCustomerId);
      }
      
      if (this.isEditMode && this.editingBillId) {
        this.loadBillItemsForEdit(this.editingBillId);
      }
      
      // Apply search if there's a search term
      if (this.billSearchTerm) {
        this.applySearch();
      }
      
      this.cdr.detectChanges();
    }
  }

  private async loadBillItemsForEdit(billId: number) {
    try {
      const items = await this.db.get('SELECT * FROM bill_items WHERE bill_id=?', [billId]);
      if (items.success && items.data) {
        this.gridItems = items.data.map((i: any) => ({
          productId: i.product_id,
          productName: i.product_name,
          quantity: i.quantity,
          unitPrice: i.unit_price,
          totalPrice: i.total_price,
          itemId: i.item_id
        }));
      }
    } catch (error) {
      console.error('Error loading bill items for edit:', error);
    }
  }

  onFormChange(): void {
    if (this.viewMode !== 'list') {
      this.saveState();
    }
  }

  async loadData() {
    this.isLoading = true;
    this.errorMessage = '';
    
    try {
      const pr = await this.db.get('SELECT * FROM products WHERE farm_id=?', [this.currentFarm.farm_id]);
      this.products = pr.success ? pr.data : [];
      
      for (const product of this.products) {
        const totalStock = await this.db.getTotalStock(product.product_id);
        product.calculated_stock = totalStock;
      }
      
      const cr = await this.db.get('SELECT * FROM customers WHERE farm_id=?', [this.currentFarm.farm_id]);
      this.customers = cr.success ? cr.data : [];
      
      await this.loadBills();
      this.restoreState();
      this.cdr.detectChanges();
    } catch (error: any) {
      this.errorMessage = 'Failed to load data: ' + error.message;
      console.error('Load error:', error);
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  async loadBills() {
    const br = await this.db.get('SELECT * FROM bills WHERE farm_id=? ORDER BY bill_date DESC', [this.currentFarm.farm_id]);
    this.allBills = br.success ? br.data : [];
    this.filteredBills = [...this.allBills];
    
    // If there's a search term, apply it
    if (this.billSearchTerm) {
      this.applySearch();
    }
  }

  // ── SEARCH METHODS (FIXED) ─────────────────────────────────

  onBillSearch() {
    setTimeout(() => {
      this.applySearch();
    }, 0);
  }

  private applySearch() {
    const term = this.billSearchTerm?.toLowerCase().trim() || '';
    
    if (!term) {
      this.filteredBills = [...this.allBills];
      this.currentPage = 1;
      this.cdr.detectChanges();
      this.onFormChange();
      return;
    }
    
    this.filteredBills = this.allBills.filter(bill => {
      const billNumber = (bill.bill_number || '').toLowerCase();
      const customerName = (bill.customer_name || '').toLowerCase();
      const customerId = bill.customer_id ? String(bill.customer_id) : '';
      const billId = bill.bill_id ? String(bill.bill_id) : '';
      
      return billNumber.includes(term) || 
             customerName.includes(term) ||
             customerId.includes(term) ||
             billId.includes(term);
    });
    
    this.currentPage = 1;
    this.cdr.detectChanges();
    this.onFormChange();
    
    console.log(`🔍 Search term: "${term}", Found: ${this.filteredBills.length} bills`);
  }

  clearSearch() {
    this.billSearchTerm = '';
    this.filteredBills = [...this.allBills];
    this.currentPage = 1;
    this.cdr.detectChanges();
    this.onFormChange();
  }

  // ── END SEARCH METHODS ─────────────────────────────────────

  onCreateNewBill() {
    this.resetForm();
    this.viewMode = 'create';
    this.isEditMode = false;
    this.editingBillId = null;
    this.errorMessage = '';
    this.paymentMethod = 'cash';
    this.lastCartSubtotal = 0;
    this.onFormChange();
  }

  async selectBill(bill: any) {
    this.viewMode = 'edit';
    this.isEditMode = true;
    this.editingBillId = bill.bill_id;
    this.errorMessage = '';
    this.lastCartSubtotal = bill.total_amount || 0;
    this.paymentMethod = bill.payment_type === 'bank' ? 'bank' : 'cash';

    // ── FIX: Correctly restore customerType (internal must not map to walkin) ──
    if (bill.payment_type === 'internal') {
      this.customerType = 'internal';
      this.selectedCustomerId = null;
      this.paidAmount = 0;
      // Restore internal transfer targets from the stored internal_transfers record
      const transferRes = await this.db.get(
        'SELECT * FROM internal_transfers WHERE bill_id = ? LIMIT 1',
        [bill.bill_id]
      );
      if (transferRes.success && transferRes.data && transferRes.data.length > 0) {
        const t = transferRes.data[0];
        this.internalTargetModule = t.target_module || 'broiler';
        this.internalTargetFlockId = t.target_flock_id || null;
      } else {
        this.internalTargetModule = 'broiler';
        this.internalTargetFlockId = null;
      }
      await this.loadInternalTargets();
    } else if (bill.customer_id) {
      this.customerType = 'regular';
      this.selectedCustomerId = bill.customer_id;
      this.paidAmount = bill.amount_paid;
      await this.checkCustomerBank(this.selectedCustomerId, true);
    } else {
      this.customerType = 'walkin';
      this.selectedCustomerId = null;
      this.paidAmount = bill.amount_paid;
    }

    const items = await this.db.get('SELECT * FROM bill_items WHERE bill_id=?', [bill.bill_id]);
    this.gridItems = items.success ? items.data.map((i: any) => ({
      productId: i.product_id,
      productName: i.product_name,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      totalPrice: i.total_price,
      itemId: i.item_id,
      batches: [],
      selectedBatchId: null
    })) : [];

    this.cdr.detectChanges();
    this.onFormChange();
  }

  backToList() { 
    this.resetForm(); 
    this.viewMode = 'list'; 
    this.errorMessage = ''; 
    this.paymentMethod = 'cash'; 
    this.loadBills();
    this.formState.clearState(this.FORM_KEY);
    this.cdr.detectChanges();
  }

  resetForm() {
    this.gridItems = []; 
    this.productSearchTerm = ''; 
    this.productOptions = []; 
    this.showProductDropdown = false;
    this.customerType = 'walkin'; 
    this.selectedCustomerId = null; 
    this.paidAmount = 0;
    this.lastCartSubtotal = 0;
    this.isEditMode = false; 
    this.editingBillId = null; 
    this.errorMessage = ''; 
    this.paymentMethod = 'cash';
    this.customerHasBank = false; 
    this.customerBankBalance = 0; 
    this.customerBankId = null;
    this.internalTargetModule = 'broiler'; 
    this.internalTargetFlockId = null; 
    this.internalFlocks = [];
  }

  // ── CUSTOMER TYPE CHANGE ──────────────────────────────────

  async onCustomerTypeChange(type: string) {
    this.customerType = type as 'walkin' | 'regular' | 'internal';
    this.selectedCustomerId = null;
    
    if (type === 'internal') { 
      await this.loadInternalTargets(); 
      this.paidAmount = this.cartSubtotal;
    } else if (type === 'walkin') { 
      this.paidAmount = this.cartSubtotal; 
    } else { 
      this.paidAmount = this.cartSubtotal; 
    }
    
    this.cdr.detectChanges();
    this.onFormChange();
  }

  async loadInternalTargets() {
    if (this.internalTargetModule === 'broiler') {
      const flocks = await this.db.get('SELECT flock_id, flock_name FROM flocks WHERE farm_id=? AND status=?', [this.currentFarm.farm_id, 'active']);
      this.internalFlocks = flocks.success ? flocks.data : [];
    } else {
      const batches = await this.db.get('SELECT batch_id, batch_name FROM batches WHERE farm_id=? AND status=?', [this.currentFarm.farm_id, 'active']);
      this.internalFlocks = batches.success ? batches.data : [];
    }
    this.cdr.detectChanges();
  }

  async getAvailableStock(productId: number): Promise<number> { 
    return await this.db.getTotalStock(productId); 
  }

  // ── CUSTOMER BANK METHODS ──────────────────────────────────

  async checkCustomerBank(customerId: number | null, preservePaymentMethod: boolean = false) {
    if (!customerId) { 
      this.customerHasBank = false; 
      this.customerBankBalance = 0; 
      this.customerBankId = null; 
      this.paymentMethod = 'cash'; 
      return; 
    }
    
    try {
      const result = await this.db.getCustomerBankAccount(customerId);
      if (result.success && result.data && result.data.length > 0) { 
        this.customerHasBank = true; 
        this.customerBankId = result.data[0].bank_id; 
        this.customerBankBalance = result.data[0].current_balance || 0; 
        if (!preservePaymentMethod) this.paymentMethod = 'cash'; 
      } else { 
        this.customerHasBank = false; 
        this.customerBankBalance = 0; 
        this.customerBankId = null; 
        this.paymentMethod = 'cash'; 
      }
    } catch (error) { 
      this.customerHasBank = false; 
      this.customerBankBalance = 0; 
      this.customerBankId = null; 
      this.paymentMethod = 'cash'; 
    }
    
    this.cdr.detectChanges();
    this.onFormChange();
  }

  onCustomerSelect() { 
    this.checkCustomerBank(this.selectedCustomerId); 
    this.onFormChange();
  }

  async processBankPayment(customerId: number, amount: number, billNumber: string) {
    try { 
      const result = await this.db.deductCustomerBank(customerId, amount, `Payment - Bill #${billNumber}`); 
      if (result.success) return true; 
      this.errorMessage = 'Bank payment failed: ' + (result.error || 'Unknown error'); 
      return false; 
    } catch (error: any) { 
      this.errorMessage = 'Bank payment error: ' + error.message; 
      return false; 
    }
  }

  private async addCustomerBankCredit(customerId: number, amount: number, description: string): Promise<any> {
    const bankResult = await this.db.getCustomerBankAccount(customerId);
    if (!bankResult.success || !bankResult.data || bankResult.data.length === 0) {
      return { success: false, error: 'Customer has no bank account' };
    }

    return this.db.addBankLedgerEntry({
      bank_id: bankResult.data[0].bank_id,
      transaction_date: new Date().toISOString().split('T')[0],
      description,
      debit: amount,
      credit: 0,
      reference_type: 'payment',
      reference_id: null
    });
  }

  private async applyBankPaymentChange(oldBill: any, newCustomerId: number | null, newBankPaid: number, billNumber: string): Promise<boolean> {
    const oldCustomerId = oldBill?.payment_type === 'bank' ? oldBill.customer_id : null;
    const oldBankPaid = oldBill?.payment_type === 'bank' ? Number(oldBill.amount_paid || 0) : 0;
    const label = billNumber || oldBill?.bill_number || 'EDIT';

    if (oldCustomerId && oldCustomerId !== newCustomerId && oldBankPaid > 0) {
      const refund = await this.addCustomerBankCredit(oldCustomerId, oldBankPaid, `Refund - Bill #${label}`);
      if (!refund.success) {
        this.errorMessage = 'Bank refund failed: ' + (refund.error || 'Unknown error');
        return false;
      }
    }

    if (!newCustomerId || newBankPaid <= 0) {
      if (oldCustomerId && oldCustomerId === newCustomerId && oldBankPaid > 0) {
        const refund = await this.addCustomerBankCredit(oldCustomerId, oldBankPaid, `Refund - Bill #${label}`);
        if (!refund.success) {
          this.errorMessage = 'Bank refund failed: ' + (refund.error || 'Unknown error');
          return false;
        }
      }
      return true;
    }

    const delta = oldCustomerId === newCustomerId ? newBankPaid - oldBankPaid : newBankPaid;
    if (delta > 0) {
      const deductResult = await this.db.deductCustomerBank(newCustomerId, delta, `Payment - Bill #${label}`);
      if (!deductResult.success) {
        this.errorMessage = 'Bank payment failed: ' + (deductResult.error || 'Unknown error');
        return false;
      }
    } else if (delta < 0) {
      const refund = await this.addCustomerBankCredit(newCustomerId, Math.abs(delta), `Refund - Bill #${label}`);
      if (!refund.success) {
        this.errorMessage = 'Bank refund failed: ' + (refund.error || 'Unknown error');
        return false;
      }
    }

    return true;
  }

  createBankAccount() { 
    this.saveState();
    this.router.navigate(['/app/bank-ledger'], { queryParams: { customerId: this.selectedCustomerId } }); 
  }

  // ── PRODUCT SEARCH ────────────────────────────────────────

  onProductSearch() {
    const term = this.productSearchTerm.trim().toLowerCase();
    if (!term) { 
      this.productOptions = []; 
      this.showProductDropdown = false; 
      this.highlightedIndex = -1;
      return; 
    }
    
    this.productOptions = this.products.filter(p => 
      p.product_name.toLowerCase().includes(term) || 
      (p.category && p.category.toLowerCase().includes(term)) || 
      (p.unit && p.unit.toLowerCase().includes(term))
    );
    
    this.highlightedIndex = this.productOptions.length > 0 ? 0 : -1;
    this.showProductDropdown = true; 
    this.cdr.detectChanges();
    this.onFormChange();
  }

  onProductSearchKeydown(event: KeyboardEvent) {
    if (!this.showProductDropdown || this.productOptions.length === 0) {
      if (event.key === 'Tab') {
        event.preventDefault();
        this.focusPaidAmount();
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.highlightedIndex = Math.min(this.highlightedIndex + 1, this.productOptions.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlightedIndex = Math.max(this.highlightedIndex - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const index = this.highlightedIndex >= 0 ? this.highlightedIndex : 0;
      const product = this.productOptions[index];
      if (product) this.selectProductOption(product);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.focusPaidAmount();
    } else if (event.key === 'Escape') {
      this.showProductDropdown = false;
      this.highlightedIndex = -1;
    }
  }

  private focusPaidAmount() {
    this.showProductDropdown = false;
    setTimeout(() => {
      this.paidAmountInputRef?.nativeElement?.focus();
      this.paidAmountInputRef?.nativeElement?.select();
    }, 0);
  }

  private focusLastQtyInput() {
    setTimeout(() => {
      const inputs = this.qtyInputs?.toArray();
      if (inputs && inputs.length > 0) {
        const last = inputs[inputs.length - 1];
        last.nativeElement.focus();
        last.nativeElement.select();
      }
    }, 0);
  }

  onQtyKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      setTimeout(() => {
        this.productSearchInputRef?.nativeElement?.focus();
      }, 0);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) { 
    if (!(event.target as HTMLElement).closest('.psearch-wrap')) { 
      this.showProductDropdown = false; 
      this.highlightedIndex = -1;
      this.cdr.detectChanges(); 
    } 
  }

  async selectProductOption(product: any) {
    const availableStock = await this.getAvailableStock(product.product_id);
    const existingForCheck = this.gridItems.find(i => i.productId === product.product_id);
    const alreadyInCart = existingForCheck ? existingForCheck.quantity : 0;

    if (availableStock <= 0) {
      this.errorMessage = `${product.product_name} is out of stock.`;
      this.showProductDropdown = false;
      this.cdr.detectChanges();
      return;
    }
    if (alreadyInCart + 1 > availableStock) {
      this.errorMessage = `${product.product_name} has only ${availableStock} in stock.`;
      this.showProductDropdown = false;
      this.cdr.detectChanges();
      return;
    }

    const previousTotal = this.cartSubtotal;
    const existing = this.gridItems.find(i => i.productId === product.product_id);
    if (existing) { 
      existing.quantity += 1; 
      existing.totalPrice = existing.quantity * existing.unitPrice; 
    } else { 
      const newItem: any = { 
        productId: product.product_id, 
        productName: product.product_name, 
        quantity: 1, 
        unitPrice: product.selling_price, 
        totalPrice: product.selling_price,
        batches: [],
        selectedBatchId: null
      };
      
      const batchesResult = await this.db.getBatchesByProduct(product.product_id, this.currentFarm.farm_id);
      if (batchesResult.success && batchesResult.data) {
        newItem.batches = batchesResult.data
          .filter((b: any) => (b.calculated_status === 'active' || b.calculated_status === 'expiring') && b.quantity > 0)
          .sort((a: any, b: any) => (a.expiry_date || '').localeCompare(b.expiry_date || ''));
          
        if (newItem.batches.length > 0) {
          newItem.selectedBatchId = newItem.batches[0].batch_id;
        }
      }
      
      this.gridItems.push(newItem); 
    }
    
    this.productSearchTerm = ''; 
    this.productOptions = []; 
    this.showProductDropdown = false;
    this.highlightedIndex = -1;
    this.syncPaidAmountWithTotal(previousTotal);
    this.errorMessage = ''; 
    this.cdr.detectChanges();
    this.onFormChange();
    this.focusLastQtyInput();
  }

  recalcItem(item: any) { 
    const previousTotal = this.cartSubtotal;
    if (item.quantity < 1) item.quantity = 1; 

    const product = this.products.find(p => p.product_id === item.productId);
    const maxStock = product ? (product.calculated_stock || 0) : null;
    if (maxStock !== null && item.quantity > maxStock) {
      item.quantity = maxStock > 0 ? maxStock : 1;
      this.errorMessage = `${item.productName} has only ${maxStock} in stock.`;
      this.cdr.detectChanges();
    }

    item.totalPrice = item.quantity * item.unitPrice; 
    this.syncPaidAmountWithTotal(previousTotal);
    this.onFormChange();
  }
  
  removeItem(item: any) { 
    const previousTotal = this.cartSubtotal;
    this.gridItems = this.gridItems.filter(i => i !== item); 
    this.syncPaidAmountWithTotal(previousTotal);
    this.onFormChange();
  }
  
  get cartSubtotal() { 
    return this.gridItems.reduce((s, i) => s + i.totalPrice, 0); 
  }
  
  onPaidAmountChange() {
    this.lastCartSubtotal = this.cartSubtotal;
    this.onFormChange();
  }

  markPaid() {
    this.paidAmount = this.cartSubtotal;
    this.lastCartSubtotal = this.cartSubtotal;
    this.onFormChange();
  }

  markUnpaid() {
    this.paidAmount = 0;
    this.lastCartSubtotal = this.cartSubtotal;
    this.onFormChange();
  }

  private syncPaidAmountWithTotal(previousTotal: number = this.lastCartSubtotal) {
    const total = this.cartSubtotal;
    if (this.paidAmount === previousTotal || this.paidAmount === 0) {
      this.paidAmount = total;
    } else if (this.isEditMode && this.paidAmount === previousTotal) {
      this.paidAmount = total;
    }
    this.lastCartSubtotal = total;
  }

  async getNextBillNumber(): Promise<string> {
    const r = await this.db.get("SELECT COALESCE(MAX(CAST(SUBSTR(bill_number, 6) AS INTEGER)), 0) + 1 as next_number FROM bills WHERE farm_id=? AND bill_number LIKE 'BILL-%'", [this.currentFarm.farm_id]);
    return 'BILL-' + String((r.success && r.data[0] ? r.data[0].next_number : 1)).padStart(3, '0');
  }

  private async getBillItems(billId: number): Promise<any[]> { 
    const items = await this.db.get('SELECT * FROM bill_items WHERE bill_id=?', [billId]); 
    return items.success ? items.data : []; 
  }

  private async validateStockForBill(): Promise<boolean> {
    this.errorMessage = '';
    const existingItems = this.isEditMode && this.editingBillId ? await this.getBillItems(this.editingBillId) : [];
    
    for (const item of this.gridItems) {
      const availableStock = await this.getAvailableStock(item.productId);
      const existingQty = existingItems
        .filter((e: any) => Number(e.product_id) === Number(item.productId))
        .reduce((sum: number, e: any) => sum + Number(e.quantity || 0), 0);
      
      if (Number(item.quantity) > availableStock + existingQty) { 
        this.errorMessage = `${item.productName} has only ${availableStock + existingQty} in stock.`; 
        this.cdr.detectChanges(); 
        return false; 
      }
    }
    return true;
  }

  // ── CUSTOMER LEDGER ───────────────────────────────────────

  async addToCustomerLedger(customerId: number, billId: number, totalAmount: number, paidAmount: number, billNumber: string) {
    if (!customerId) return;
    
    await this.db.addCustomerLedgerEntry({ 
      customer_id: customerId, 
      transaction_date: new Date().toISOString().split('T')[0], 
      description: `Bill #${billNumber}`, 
      debit: totalAmount, 
      credit: 0, 
      reference_type: 'bill', 
      reference_id: billId 
    });
    
    if (paidAmount > 0) {
      await this.db.addCustomerLedgerEntry({ 
        customer_id: customerId, 
        transaction_date: new Date().toISOString().split('T')[0], 
        description: `Payment - Bill #${billNumber}`, 
        debit: 0, 
        credit: paidAmount, 
        reference_type: 'payment', 
        reference_id: billId 
      });
    }
    
    await this.db.updateCustomerOutstandingBalance(customerId);
  }

  async removeFromCustomerLedger(billId: number, customerId: number) { 
    if (!customerId) return; 
    await this.db.run('DELETE FROM customer_ledger WHERE reference_id = ? AND reference_type IN (?, ?)', [billId, 'bill', 'payment']); 
    await this.db.updateCustomerOutstandingBalance(customerId); 
  }

  // ── STOCK OPERATIONS ──────────────────────────────────────

  private async restoreBillStock(billId: number) {
    const existingItems = await this.getBillItems(billId);
    const today = new Date().toISOString().split('T')[0];

    // 🔥 FIX: compute the NET outstanding quantity per batch (sale − return)
    // for this bill, not the raw sum of every 'sale' transaction ever logged
    // against it. A bill edited more than once accumulates a 'sale' entry
    // and a 'return' entry on every edit — summing only 'sale' rows without
    // subtracting the matching 'return' rows causes stock that was already
    // restored in a previous edit to be restored AGAIN, inflating stock
    // with phantom units on every subsequent edit.
    const netResult = await this.db.get(
      `SELECT batch_id, product_id,
              SUM(CASE WHEN type = 'sale' THEN quantity WHEN type = 'return' THEN -quantity ELSE 0 END) as net_qty
       FROM batch_transactions
       WHERE reference_id = ? AND type IN ('sale', 'return')
       GROUP BY batch_id, product_id
       HAVING net_qty > 0`,
      [billId]
    );
    const netRows = netResult.success && netResult.data ? netResult.data : [];

    if (netRows.length > 0) {
      for (const row of netRows) {
        if (!row.batch_id) continue;
        const batchResult = await this.db.get('SELECT * FROM product_batches WHERE batch_id = ?', [row.batch_id]);
        if (batchResult.success && batchResult.data && batchResult.data.length > 0) {
          const targetBatch = batchResult.data[0];
          await this.db.updateBatch(targetBatch.batch_id, { quantity: (targetBatch.quantity || 0) + row.net_qty });
          await this.db.addBatchTransaction(
            targetBatch.batch_id,
            row.product_id,
            'return',
            row.net_qty,
            today,
            billId,
            `Restored from deleted/edited sale`
          );
        }
      }
    } else {
      // Legacy bill with no tracked batch_transactions — fall back to
      // restoring against any available batch for each item.
      for (const item of existingItems) {
        if (!item.product_id) continue;

        const batchesResult = await this.db.getBatchesByProduct(item.product_id, this.currentFarm.farm_id);
        let targetBatch = null;

        if (batchesResult.success && batchesResult.data && batchesResult.data.length > 0) {
          targetBatch = batchesResult.data.find((b: any) => b.calculated_status === 'active') || batchesResult.data[0];
        }

        if (targetBatch) {
          await this.db.updateBatch(targetBatch.batch_id, { quantity: (targetBatch.quantity || 0) + item.quantity });
          await this.db.addBatchTransaction(
            targetBatch.batch_id,
            item.product_id,
            'return',
            item.quantity,
            today,
            billId,
            `Restored from deleted/edited sale`
          );
        } else {
          const oneYearLater = new Date();
          oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
          const batchResult = await this.db.addBatch({
            product_id: item.product_id,
            farm_id: this.currentFarm.farm_id,
            manufacturing_date: today,
            expiry_date: oneYearLater.toISOString().split('T')[0],
            quantity: item.quantity,
            purchase_price: 0
          });
          if (batchResult.success && batchResult.batch_id) {
            await this.db.addBatchTransaction(
              batchResult.batch_id,
              item.product_id,
              'return',
              item.quantity,
              today,
              billId,
              `Restored from deleted/edited sale`
            );
          }
        }
      }
    }
  }

  private async cleanupInternalTransfers(billId: number) {
    try {
      const oldTransfers = await this.db.get('SELECT * FROM internal_transfers WHERE bill_id=?', [billId]);
      if (oldTransfers.success && oldTransfers.data) {
        for (const t of oldTransfers.data) {
          const targetType = t.target_type || (t.expense_id ? 'expense' : null);
          const refId = t.reference_id || t.expense_id;

          if (targetType === 'medicine' && refId) {
            await this.db.run('DELETE FROM medicine_entries WHERE entry_id=?', [refId]);
          } else if (targetType === 'feed' && refId) {
            await this.db.run('DELETE FROM feed_entries WHERE entry_id=?', [refId]);
          } else if (targetType === 'vaccination' && refId) {
            await this.db.run('DELETE FROM vaccinations WHERE vaccination_id=?', [refId]);
          } else if (t.expense_id) {
            await this.db.run('DELETE FROM expenses WHERE expense_id=?', [t.expense_id]);
          }
        }
      }
      await this.db.run('DELETE FROM internal_transfers WHERE bill_id=?', [billId]);
    } catch (e) {
      console.error('Error cleaning up internal transfers:', e);
    }
  }

  private async deductFromBatches(productId: number, quantity: number, selectedBatchId: number | null, billId?: number) {
    try {
      const batchesResult = await this.db.getBatchesByProduct(productId, this.currentFarm.farm_id);
      if (!batchesResult.success || !batchesResult.data) return;
      
      let activeBatches = batchesResult.data
        .filter((b: any) => (b.calculated_status === 'active' || b.calculated_status === 'expiring') && b.quantity > 0)
        .sort((a: any, b: any) => (a.expiry_date || '').localeCompare(b.expiry_date || ''));
        
      if (selectedBatchId) {
        const selectedBatch = activeBatches.find((b: any) => b.batch_id === selectedBatchId);
        if (selectedBatch) {
          activeBatches = [selectedBatch, ...activeBatches.filter((b: any) => b.batch_id !== selectedBatchId)];
        }
      }
      
      let remaining = quantity;
      for (const batch of activeBatches) { 
        if (remaining <= 0) break; 
        const deduct = Math.min(remaining, batch.quantity || 0); 
        await this.db.updateBatch(batch.batch_id, { quantity: (batch.quantity || 0) - deduct }); 
        await this.db.addBatchTransaction(
          batch.batch_id, 
          productId, 
          'sale', 
          deduct, 
          new Date().toISOString().split('T')[0], 
          billId || null, 
          'Sale order'
        ); 
        remaining -= deduct; 
      }
      
      await this.db.updateBatchStatuses();
    } catch (error) { 
      console.error('Error deducting:', error); 
    }
  }

  // ── SAVE BILL ─────────────────────────────────────────────

  async saveBill(): Promise<number | null> {
    if (this.gridItems.length === 0 || this.isSubmitting) return null;
    
    if (this.customerType === 'internal' && !this.internalTargetFlockId) { 
      this.errorMessage = 'Please select a target Flock/Batch.'; 
      this.cdr.detectChanges(); 
      return null; 
    }
    
    if (!(await this.validateStockForBill())) return null;
    this.isSubmitting = true;

    const customerName = this.customerType === 'internal' ? 'Own Farm' : 
                         (this.customerType === 'regular' ? 
                           (this.customers.find(c => c.customer_id === this.selectedCustomerId)?.customer_name || 'Walk-in') : 
                           'Walk-in');
    const oldBill = this.isEditMode && this.editingBillId
      ? this.allBills.find(b => b.bill_id === this.editingBillId)
      : null;
    const billNumber = this.isEditMode ? (oldBill?.bill_number || '') : await this.getNextBillNumber();
    const totalAmount = this.cartSubtotal;
    const clampPaidAmount = (amount: number) => Math.min(Math.max(Number(amount) || 0, 0), totalAmount);
    let savedBillId: number | null = null;

    try {
      // ── CALCULATE PAYMENTS ────────────────────────────────────
      
      let effectivePaid = 0;
      let bankDeductAmount = 0;
      let paymentType = 'cash';

      if (this.customerType === 'internal') {
        paymentType = 'internal';
        effectivePaid = 0;

        if (oldBill?.payment_type === 'bank') {
          const bankApplied = await this.applyBankPaymentChange(oldBill, oldBill.customer_id, 0, billNumber);
          if (!bankApplied) {
            this.isSubmitting = false;
            this.cdr.detectChanges();
            return null;
          }
        }
      } else if (this.paymentMethod === 'bank' && this.selectedCustomerId) {
        paymentType = 'bank';
        effectivePaid = clampPaidAmount(this.paidAmount);
        bankDeductAmount = effectivePaid;

        const bankApplied = await this.applyBankPaymentChange(oldBill, this.selectedCustomerId, effectivePaid, billNumber);
        if (!bankApplied) {
          this.isSubmitting = false;
          this.cdr.detectChanges();
          return null;
        }
      } else {
        effectivePaid = clampPaidAmount(this.paidAmount);
        paymentType = 'cash';

        if (oldBill?.payment_type === 'bank') {
          const bankApplied = await this.applyBankPaymentChange(oldBill, this.selectedCustomerId, 0, billNumber);
          if (!bankApplied) {
            this.isSubmitting = false;
            this.cdr.detectChanges();
            return null;
          }
        }
      }

      console.log('📊 Payment Details:', {
        totalAmount,
        paidAmount: this.paidAmount,
        effectivePaid,
        bankDeductAmount,
        paymentMethod: this.paymentMethod,
        paymentType,
        customerId: this.selectedCustomerId
      });

      // ── SAVE OR UPDATE BILL ───────────────────────────────────

      if (this.isEditMode && this.editingBillId) {
        savedBillId = this.editingBillId;
        if (oldBill?.customer_id) await this.removeFromCustomerLedger(this.editingBillId, oldBill.customer_id);
        
        await this.cleanupInternalTransfers(this.editingBillId);
        
        await this.restoreBillStock(this.editingBillId);
        
        await this.db.run(
          'UPDATE bills SET customer_id=?, customer_name=?, subtotal=?, total_amount=?, amount_paid=?, payment_type=? WHERE bill_id=?',
          [this.selectedCustomerId, customerName, totalAmount, totalAmount, effectivePaid, paymentType, this.editingBillId]
        );
        
        await this.db.run('DELETE FROM bill_items WHERE bill_id=?', [this.editingBillId]);
        for (const item of this.gridItems) { 
          await this.db.run(
            'INSERT INTO bill_items (bill_id, product_id, product_name, quantity, unit_price, total_price) VALUES (?,?,?,?,?,?)',
            [this.editingBillId, item.productId, item.productName, item.quantity, item.unitPrice, item.totalPrice]
          ); 
          await this.deductFromBatches(item.productId, item.quantity, item.selectedBatchId, this.editingBillId); 
        }
        
        if (this.selectedCustomerId) {
          await this.addToCustomerLedger(this.selectedCustomerId, this.editingBillId, totalAmount, effectivePaid, billNumber);
        }
      } else {
        await this.db.run(
          'INSERT INTO bills (farm_id, bill_number, customer_id, customer_name, bill_date, subtotal, total_amount, amount_paid, payment_type) VALUES (?,?,?,?,?,?,?,?,?)',
          [this.currentFarm.farm_id, billNumber, this.selectedCustomerId, customerName, 
           new Date().toISOString().split('T')[0], totalAmount, totalAmount, effectivePaid, paymentType]
        );
        
        const lastBill = await this.db.get('SELECT MAX(bill_id) as bid FROM bills WHERE farm_id=?', [this.currentFarm.farm_id]);
        savedBillId = lastBill.success && lastBill.data[0] ? lastBill.data[0].bid : null;
        
        if (savedBillId) {
          for (const item of this.gridItems) { 
            await this.db.run(
              'INSERT INTO bill_items (bill_id, product_id, product_name, quantity, unit_price, total_price) VALUES (?,?,?,?,?,?)',
              [savedBillId, item.productId, item.productName, item.quantity, item.unitPrice, item.totalPrice]
            ); 
            await this.deductFromBatches(item.productId, item.quantity, item.selectedBatchId, savedBillId); 
          }
          
          if (this.selectedCustomerId) {
            await this.addToCustomerLedger(this.selectedCustomerId, savedBillId, totalAmount, effectivePaid, billNumber);
          }
        }
      }

      // ── INTERNAL TRANSFER ──────────────────────────────────────
      
      if (this.customerType === 'internal' && savedBillId && this.internalTargetFlockId) {
        for (const item of this.gridItems) {
          const desc = item.productName + ' × ' + item.quantity;
          const todayDate = new Date().toISOString().split('T')[0];

          const productRes = await this.db.get('SELECT category FROM products WHERE product_id=?', [item.productId]);
          const category = (productRes.success && productRes.data.length > 0) ? (productRes.data[0].category || '').toLowerCase() : '';

          let expenseId = null;
          let targetType = 'expense';
          let referenceId = null;

          if (category === 'medicine') {
            targetType = 'medicine';
            let traderRes = await this.db.get('SELECT trader_id FROM medicine_traders WHERE flock_id=? AND module_type=? AND trader_name=?', [this.internalTargetFlockId, this.internalTargetModule, 'Internal Distribution']);
            let traderId = null;
            if (traderRes.success && traderRes.data.length > 0) {
              traderId = traderRes.data[0].trader_id;
            } else {
              const newTrader = await this.db.run('INSERT INTO medicine_traders (flock_id, trader_name, module_type) VALUES (?, ?, ?)', [this.internalTargetFlockId, 'Internal Distribution', this.internalTargetModule]);
              traderId = newTrader.lastId;
            }
            if (traderId) {
              const entryResult = await this.db.run('INSERT INTO medicine_entries (trader_id, flock_id, date, medicine_name, quantity, price_per_unit, total_amount, module_type) VALUES (?,?,?,?,?,?,?,?)',
                [traderId, this.internalTargetFlockId, todayDate, item.productName, item.quantity, item.unitPrice, item.totalPrice, this.internalTargetModule]);
              referenceId = entryResult.lastId;
            }
          } else if (category === 'feed') {
            targetType = 'feed';
            let traderRes = await this.db.get('SELECT trader_id FROM feed_traders WHERE flock_id=? AND module_type=? AND trader_name=?', [this.internalTargetFlockId, this.internalTargetModule, 'Internal Distribution']);
            let traderId = null;
            if (traderRes.success && traderRes.data.length > 0) {
              traderId = traderRes.data[0].trader_id;
            } else {
              const newTrader = await this.db.run('INSERT INTO feed_traders (flock_id, trader_name, module_type) VALUES (?, ?, ?)', [this.internalTargetFlockId, 'Internal Distribution', this.internalTargetModule]);
              traderId = newTrader.lastId;
            }
            if (traderId) {
              const entryResult = await this.db.run('INSERT INTO feed_entries (trader_id, flock_id, date, feed_name, quantity, price_per_unit, total_amount, module_type) VALUES (?,?,?,?,?,?,?,?)',
                [traderId, this.internalTargetFlockId, todayDate, item.productName, item.quantity, item.unitPrice, item.totalPrice, this.internalTargetModule]);
              referenceId = entryResult.lastId;
            }
          } else if (category === 'vaccine' || category === 'vaccination') {
            targetType = 'vaccination';
            const vaccResult = await this.db.run('INSERT INTO vaccinations (batch_id, flock_id, date, vaccine_name, dose, notes, done) VALUES (?,?,?,?,?,?,?)',
                [this.internalTargetModule === 'layer' ? this.internalTargetFlockId : null, this.internalTargetModule === 'broiler' ? this.internalTargetFlockId : null, todayDate, item.productName, '1', 'Internal Transfer', 1]);
            referenceId = vaccResult.lastId;
          } else {
            targetType = 'expense';
            const expenseResult = await this.db.run(
              'INSERT INTO expenses (flock_id, date, description, amount, module_type) VALUES (?,?,?,?,?)',
              [this.internalTargetFlockId, todayDate, desc, item.totalPrice, this.internalTargetModule]
            );
            expenseId = expenseResult.lastId;
            referenceId = expenseId;
          }

          await this.db.run(
            'INSERT INTO internal_transfers (bill_id, expense_id, target_module, target_flock_id, target_type, reference_id) VALUES (?,?,?,?,?,?)',
            [savedBillId, expenseId, this.internalTargetModule, this.internalTargetFlockId, targetType, referenceId]
          );
        }
      }

      // ── CLEANUP ─────────────────────────────────────────────────
      
      this.formState.clearState(this.FORM_KEY);
      this.resetForm(); 
      this.viewMode = 'list'; 
      await this.loadBills(); 
      await this.loadData();
      
    } catch (error: any) { 
      this.errorMessage = 'Error saving: ' + error.message; 
      console.error('Save error:', error);
    } finally { 
      this.isSubmitting = false; 
      this.cdr.detectChanges(); 
    }
    return savedBillId;
  }

  // ── DELETE METHODS (FIXED) ────────────────────────────────────

  confirmDeleteBill(event: Event, billId: number) { 
    event.stopPropagation();
    event.preventDefault();
    
    console.log('🗑️ Delete clicked for bill:', billId);
    
    this.deletingBillId = billId;
    this.showDeleteDialog = true;
    
    this.cdr.detectChanges();
  }

  async onDeleteConfirmed() {
    if (!this.deletingBillId) return;
    
    console.log('✅ Delete confirmed for bill:', this.deletingBillId);
    
    try {
      const bill = this.allBills.find(b => b.bill_id === this.deletingBillId);

      // 🔥 FIX: refund the customer's bank if this bill was paid via bank —
      // otherwise the deducted amount is lost with no trace once the bill
      // (and its reference) is gone.
      if (bill?.payment_type === 'bank' && bill.customer_id && Number(bill.amount_paid) > 0) {
        const refundOk = await this.applyBankPaymentChange(bill, bill.customer_id, 0, bill.bill_number);
        if (!refundOk) {
          this.cdr.detectChanges();
          return;
        }
      }

      if (bill?.customer_id) {
        await this.removeFromCustomerLedger(this.deletingBillId, bill.customer_id);
      }
      
      await this.cleanupInternalTransfers(this.deletingBillId);
      
      await this.restoreBillStock(this.deletingBillId);
      await this.db.run('DELETE FROM bill_items WHERE bill_id=?', [this.deletingBillId]);
      await this.db.run('DELETE FROM bills WHERE bill_id=?', [this.deletingBillId]);
      
      this.showDeleteDialog = false; 
      this.deletingBillId = null; 
      await this.loadData();
    } catch (error: any) { 
      this.errorMessage = 'Error deleting: ' + error.message; 
      console.error('Delete error:', error);
      this.showDeleteDialog = false;
      this.cdr.detectChanges();
    }
  }

  onDeleteCancelled() { 
    this.showDeleteDialog = false; 
    this.deletingBillId = null; 
    this.cdr.detectChanges();
  }

  async saveAndPrint() { 
    const billId = await this.saveBill(); 
    if (billId == null) return; 
    const r = await this.db.get('SELECT * FROM bills WHERE bill_id=?', [billId]); 
    const bill = r.success && r.data[0] ? r.data[0] : null; 
    if (bill) this.printBill(bill); 
  }

  async printBill(bill: any) {
    const items = await this.db.get('SELECT * FROM bill_items WHERE bill_id=?', [bill.bill_id]);
    const billItems = items.success ? items.data : [];
    const doc = new jsPDF(); 
    const pw = doc.internal.pageSize.getWidth(); 
    const B: [number,number,number] = [0,0,0];
    const farmName = this.currentFarm?.farm_name || 'Farm'; 
    let y = 20;
    
    doc.setFont('helvetica', 'bold'); 
    doc.setFontSize(18); 
    doc.setTextColor(...B);
    doc.text(farmName.toUpperCase(), pw / 2, y, { align: 'center' }); 
    y += 8;
    doc.setFontSize(12); 
    doc.text('Sales Receipt', pw / 2, y, { align: 'center' }); 
    y += 8;
    doc.setFont('helvetica', 'normal'); 
    doc.setFontSize(10);
    doc.text('Bill #: ' + bill.bill_number, 14, y); 
    doc.text('Date: ' + bill.bill_date, pw - 14, y, { align: 'right' }); 
    y += 6;
    doc.text('Customer: ' + (bill.customer_name || 'Walk-in'), 14, y); 
    y += 4;
    doc.setDrawColor(...B); 
    doc.line(14, y, pw - 14, y); 
    y += 6;
    
    autoTable(doc, { 
      startY: y, 
      head: [['Product', 'Qty', 'Price', 'Total']], 
      body: billItems.map((i: any) => [i.product_name, String(i.quantity), 'Rs. ' + i.unit_price.toLocaleString(), 'Rs. ' + i.total_price.toLocaleString()]), 
      theme: 'plain', 
      headStyles: { fontStyle: 'bold', fontSize: 9, textColor: B, fillColor: false as any }, 
      bodyStyles: { fontSize: 9 }, 
      margin: { left: 14, right: 14 } 
    });
    
    const finalY = (doc as any).lastAutoTable.finalY + 4;
    doc.setDrawColor(...B); 
    doc.line(14, finalY, pw - 14, finalY);
    doc.setFont('helvetica', 'bold'); 
    doc.setFontSize(11);
    doc.text('Total: Rs. ' + bill.total_amount.toLocaleString(), 14, finalY + 6);
    doc.text('Paid: Rs. ' + bill.amount_paid.toLocaleString(), 14, finalY + 12);
    
    doc.setFontSize(7.5); 
    doc.setFont('helvetica', 'normal'); 
    doc.setTextColor(120,120,120);
    doc.text('Software By: www.devinfantary.com  |  Contact: 0302 6938217', pw / 2, 290, { align: 'center' });
    doc.save(bill.bill_number + '.pdf');
  }
}