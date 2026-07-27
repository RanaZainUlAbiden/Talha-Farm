import { Component, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router'; // 🔥 FIX: Properly imported
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
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
export class SalesOrdersComponent implements OnInit {
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

  currentPage = 1;
  pageSize = 20;

  get paginatedBills() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredBills.slice(start, start + this.pageSize);
  }

  gridItems: any[] = [];
  productSearchTerm: string = '';
  productOptions: any[] = [];
  showProductDropdown: boolean = false;

  customerType: 'walkin' | 'regular' = 'walkin';
  selectedCustomerId: number | null = null;
  selectedCustomer: any = null;

  // ── PAYMENT METHOD ──────────────────────────────────────
  paymentMethod: 'cash' | 'bank' = 'cash';
  customerHasBank: boolean = false;
  customerBankBalance: number = 0;
  customerBankId: number | null = null;

  paidAmount: number = 0;
  isSubmitting: boolean = false;

  // 🔥 FIX: Properly injected Router
  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef,
    private router: Router  // 🔥 FIX: Added proper Router injection
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadData();
  }

  async loadData() {
    const pr = await this.db.get('SELECT * FROM products WHERE farm_id=?', [this.currentFarm.farm_id]);
    this.products = pr.success ? pr.data : [];
    
    // 🔥 FIX: Load calculated stock for each product
    for (const product of this.products) {
      const totalStock = await this.db.getTotalStock(product.product_id);
      product.calculated_stock = totalStock;
    }
    
    const cr = await this.db.get('SELECT * FROM customers WHERE farm_id=?', [this.currentFarm.farm_id]);
    this.customers = cr.success ? cr.data : [];
    await this.loadBills();
    this.cdr.detectChanges();
  }

  async loadBills() {
    const br = await this.db.get('SELECT * FROM bills WHERE farm_id=? ORDER BY bill_date DESC', [this.currentFarm.farm_id]);
    this.allBills = br.success ? br.data : [];
    this.filteredBills = [...this.allBills];
  }

  onBillSearch() {
    const term = this.billSearchTerm.toLowerCase().trim();
    this.filteredBills = term ? this.allBills.filter(b => b.bill_number.toLowerCase().includes(term) || (b.customer_name || '').toLowerCase().includes(term)) : [...this.allBills];
    this.currentPage = 1;
  }

  onCreateNewBill() {
    this.resetForm();
    this.viewMode = 'create';
    this.isEditMode = false;
    this.editingBillId = null;
    this.errorMessage = '';
    this.paymentMethod = 'cash';
  }

  async selectBill(bill: any) {
    this.viewMode = 'edit';
    this.isEditMode = true;
    this.editingBillId = bill.bill_id;
    this.customerType = bill.customer_id ? 'regular' : 'walkin';
    this.selectedCustomerId = bill.customer_id || null;
    this.paidAmount = bill.amount_paid;
    this.errorMessage = '';
    this.paymentMethod = 'cash';

    if (this.selectedCustomerId) {
      await this.checkCustomerBank(this.selectedCustomerId);
    }

    const items = await this.db.get('SELECT * FROM bill_items WHERE bill_id=?', [bill.bill_id]);
    this.gridItems = items.success ? items.data.map((i: any) => ({
      productId: i.product_id, productName: i.product_name, quantity: i.quantity, unitPrice: i.unit_price, totalPrice: i.total_price, itemId: i.item_id
    })) : [];
    this.cdr.detectChanges();
  }

  backToList() {
    this.resetForm();
    this.viewMode = 'list';
    this.errorMessage = '';
    this.paymentMethod = 'cash';
    this.loadBills();
  }

  resetForm() {
    this.gridItems = [];
    this.productSearchTerm = '';
    this.productOptions = [];
    this.showProductDropdown = false;
    this.customerType = 'walkin';
    this.selectedCustomerId = null;
    this.paidAmount = 0;
    this.isEditMode = false;
    this.editingBillId = null;
    this.errorMessage = '';
    this.paymentMethod = 'cash';
    this.customerHasBank = false;
    this.customerBankBalance = 0;
    this.customerBankId = null;
  }

  async getAvailableStock(productId: number): Promise<number> {
    const totalStock = await this.db.getTotalStock(productId);
    return totalStock;
  }

  // ── CUSTOMER BANK METHODS ──────────────────────────────────

  async checkCustomerBank(customerId: number | null) {
    if (!customerId) {
      this.customerHasBank = false;
      this.customerBankBalance = 0;
      this.customerBankId = null;
      this.paymentMethod = 'cash';
      this.cdr.detectChanges();
      return;
    }
    
    try {
      const result = await this.db.getCustomerBankAccount(customerId);
      if (result.success && result.data && result.data.length > 0) {
        this.customerHasBank = true;
        this.customerBankId = result.data[0].bank_id;
        this.customerBankBalance = result.data[0].current_balance || 0;
        this.paymentMethod = 'cash';
      } else {
        this.customerHasBank = false;
        this.customerBankBalance = 0;
        this.customerBankId = null;
        this.paymentMethod = 'cash';
      }
    } catch (error) {
      console.error('Error checking customer bank:', error);
      this.customerHasBank = false;
      this.customerBankBalance = 0;
      this.customerBankId = null;
      this.paymentMethod = 'cash';
    }
    this.cdr.detectChanges();
  }

  onCustomerSelect() {
    this.checkCustomerBank(this.selectedCustomerId);
  }

  async processBankPayment(customerId: number, amount: number, billNumber: string) {
    try {
      const result = await this.db.deductCustomerBank(customerId, amount, `Payment - Bill #${billNumber}`);
      if (result.success) {
        console.log(`✅ Bank payment of ${amount} processed for customer ${customerId}`);
        return true;
      } else {
        this.errorMessage = 'Bank payment failed: ' + (result.error || 'Unknown error');
        return false;
      }
    } catch (error: any) {
      this.errorMessage = 'Bank payment error: ' + error.message;
      return false;
    }
  }

  // 🔥 FIX: Proper navigation with customer ID
  createBankAccount() {
    if (this.selectedCustomerId) {
      this.router.navigate(['/app/bank-ledger'], { 
        queryParams: { customerId: this.selectedCustomerId }
      });
    } else {
      this.router.navigate(['/app/bank-ledger']);
    }
  }

  // ── REAL-TIME PRODUCT SEARCH ──────────────────────────────

  onProductSearch() {
    const term = this.productSearchTerm.trim().toLowerCase();
    
    if (!term) { 
      this.productOptions = []; 
      this.showProductDropdown = false; 
      this.cdr.detectChanges();
      return; 
    }
    
    this.productOptions = this.products.filter(p => 
      p.product_name.toLowerCase().includes(term) ||
      (p.category && p.category.toLowerCase().includes(term)) ||
      (p.unit && p.unit.toLowerCase().includes(term))
    );
    
    this.showProductDropdown = true;
    this.cdr.detectChanges();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.psearch-wrap')) {
      this.showProductDropdown = false;
      this.cdr.detectChanges();
    }
  }

  async selectProductOption(product: any) {
    const existing = this.gridItems.find(i => i.productId === product.product_id);
    if (existing) {
      existing.quantity += 1;
      existing.totalPrice = existing.quantity * existing.unitPrice;
    } else {
      this.gridItems.push({ 
        productId: product.product_id, 
        productName: product.product_name, 
        quantity: 1, 
        unitPrice: product.selling_price, 
        totalPrice: product.selling_price 
      });
    }
    
    this.productSearchTerm = '';
    this.productOptions = [];
    this.showProductDropdown = false;
    
    if (this.customerType === 'walkin') {
      this.paidAmount = this.cartSubtotal;
    }
    
    this.errorMessage = '';
    this.cdr.detectChanges();
  }

  recalcItem(item: any) {
    if (item.quantity < 1) item.quantity = 1;
    item.totalPrice = item.quantity * item.unitPrice;
    if (this.customerType === 'walkin') this.paidAmount = this.cartSubtotal;
  }

  removeItem(item: any) { 
    this.gridItems = this.gridItems.filter(i => i !== item); 
    if (this.customerType === 'walkin') this.paidAmount = this.cartSubtotal; 
  }

  get cartSubtotal() { return this.gridItems.reduce((s, i) => s + i.totalPrice, 0); }

  onPaidAmountChange() { 
    if (this.customerType === 'walkin') {
      this.paidAmount = this.cartSubtotal;
    }
  }

  async getNextBillNumber(): Promise<string> {
    const r = await this.db.get(
      "SELECT COALESCE(MAX(CAST(SUBSTR(bill_number, 6) AS INTEGER)), 0) + 1 as next_number FROM bills WHERE farm_id=? AND bill_number LIKE 'BILL-%'",
      [this.currentFarm.farm_id]
    );
    const nextNumber = r.success && r.data[0] ? r.data[0].next_number : 1;
    return 'BILL-' + String(nextNumber).padStart(3, '0');
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
      
      const effectiveStock = availableStock + existingQty;
      
      if (Number(item.quantity) > effectiveStock) {
        this.errorMessage = `${item.productName} has only ${effectiveStock} in stock.`;
        this.cdr.detectChanges();
        return false;
      }
    }

    return true;
  }

  // ── CUSTOMER LEDGER INTEGRATION ──────────────────────────

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
    console.log(`✅ Added bill ${billNumber}: Total ${totalAmount}, Paid ${paidAmount} to customer ${customerId} ledger`);
  }

  async removeFromCustomerLedger(billId: number, customerId: number) {
    if (!customerId) return;
    
    await this.db.run('DELETE FROM customer_ledger WHERE reference_id = ? AND reference_type IN (?, ?)', [billId, 'bill', 'payment']);
    await this.db.updateCustomerOutstandingBalance(customerId);
    console.log(`✅ Removed bill ${billId} from customer ${customerId} ledger`);
  }

  // ── STOCK OPERATIONS ──────────────────────────────────────

  private async restoreBillStock(billId: number) {
    const existingItems = await this.getBillItems(billId);
    for (const item of existingItems) {
      if (item.product_id) {
        const today = new Date().toISOString().split('T')[0];
        const oneYearLater = new Date();
        oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
        const expiryDate = oneYearLater.toISOString().split('T')[0];
        
        const batchResult = await this.db.addBatch({
          product_id: item.product_id,
          farm_id: this.currentFarm.farm_id,
          manufacturing_date: today,
          expiry_date: expiryDate,
          quantity: item.quantity,
          purchase_price: 0
        });
        
        if (batchResult.success && batchResult.batch_id) {
          await this.db.addBatchTransaction(
            batchResult.batch_id,
            item.product_id,
            'return',
            item.quantity,
            new Date().toISOString().split('T')[0],
            null,
            `Restored from deleted bill ${billId}`
          );
        }
      }
    }
  }

  private async deductFromBatches(productId: number, quantity: number, billId?: number) {
    try {
      const batchesResult = await this.db.getBatchesByProduct(productId, this.currentFarm.farm_id);
      if (!batchesResult.success || !batchesResult.data) {
        console.error('No batches found for product', productId);
        return;
      }
      
      const activeBatches = batchesResult.data
        .filter((b: any) => (b.status === 'active' || b.status === 'expiring') && b.quantity > 0)
        .sort((a: any, b: any) => a.expiry_date.localeCompare(b.expiry_date));
      
      let remainingToDeduct = quantity;
      
      for (const batch of activeBatches) {
        if (remainingToDeduct <= 0) break;
        
        const currentQty = batch.quantity || 0;
        const deductFromThis = Math.min(remainingToDeduct, currentQty);
        const newQty = currentQty - deductFromThis;
        
        await this.db.updateBatch(batch.batch_id, {
          quantity: newQty
        });
        
        await this.db.addBatchTransaction(
          batch.batch_id,
          productId,
          'sale',
          deductFromThis,
          new Date().toISOString().split('T')[0],
          billId || null,
          `Sale order - ${quantity} units`
        );
        
        remainingToDeduct -= deductFromThis;
        console.log(`✅ Deducted ${deductFromThis} from batch ${batch.batch_code}`);
      }
      
      if (remainingToDeduct > 0) {
        console.warn(`⚠️ Only ${quantity - remainingToDeduct} of ${quantity} units available`);
        this.errorMessage = `Not enough stock! Only ${quantity - remainingToDeduct} units available.`;
        this.cdr.detectChanges();
      }
      
      await this.db.updateBatchStatuses();
      
    } catch (error) {
      console.error('Error deducting from batches:', error);
      this.errorMessage = 'Error updating inventory: ' + (error as any).message;
      this.cdr.detectChanges();
    }
  }

  // ── SAVE BILL ─────────────────────────────────────────────

  async saveBill(): Promise<number | null> {
    if (this.gridItems.length === 0 || this.isSubmitting) return null;
    if (!(await this.validateStockForBill())) return null;
    this.isSubmitting = true;

    const customerName = this.customerType === 'regular' ? (this.customers.find(c => c.customer_id === this.selectedCustomerId)?.customer_name || 'Walk-in') : 'Walk-in';
    const billNumber = this.isEditMode ? '' : await this.getNextBillNumber();
    const totalAmount = this.cartSubtotal;
    let savedBillId: number | null = null;

    try {
      if (this.isEditMode && this.editingBillId) {
        savedBillId = this.editingBillId;
        
        const oldBill = this.allBills.find(b => b.bill_id === this.editingBillId);
        const oldCustomerId = oldBill?.customer_id;
        const oldBillNumber = oldBill?.bill_number || '';
        
        await this.restoreBillStock(this.editingBillId);
        
        if (oldCustomerId) {
          await this.removeFromCustomerLedger(this.editingBillId, oldCustomerId);
        }
        
        const effectivePaidAmount = this.paymentMethod === 'bank' ? totalAmount : this.paidAmount;
        
        await this.db.run('UPDATE bills SET customer_id=?, customer_name=?, subtotal=?, total_amount=?, amount_paid=?, payment_type=? WHERE bill_id=?',
          [this.selectedCustomerId, customerName, totalAmount, totalAmount, effectivePaidAmount, this.paymentMethod === 'bank' ? 'bank' : 'cash', this.editingBillId]);
        await this.db.run('DELETE FROM bill_items WHERE bill_id=?', [this.editingBillId]);
        
        for (const item of this.gridItems) {
          await this.db.run('INSERT INTO bill_items (bill_id, product_id, product_name, quantity, unit_price, total_price) VALUES (?,?,?,?,?,?)',
            [this.editingBillId, item.productId, item.productName, item.quantity, item.unitPrice, item.totalPrice]);
        }
        
        for (const item of this.gridItems) {
          await this.deductFromBatches(item.productId, item.quantity, this.editingBillId);
        }
        
        if (this.selectedCustomerId) {
          await this.addToCustomerLedger(
            this.selectedCustomerId, 
            this.editingBillId, 
            totalAmount, 
            effectivePaidAmount, 
            oldBillNumber || billNumber
          );
        }

        if (this.paymentMethod === 'bank' && this.selectedCustomerId) {
          const bankSuccess = await this.processBankPayment(
            this.selectedCustomerId, 
            totalAmount, 
            oldBillNumber || billNumber
          );
          if (!bankSuccess) {
            throw new Error(this.errorMessage || 'Bank payment failed');
          }
        }
        
      } else {
        const effectivePaidAmount = this.paymentMethod === 'bank' ? totalAmount : this.paidAmount;
        
        await this.db.run('INSERT INTO bills (farm_id, bill_number, customer_id, customer_name, bill_date, subtotal, total_amount, amount_paid, payment_type) VALUES (?,?,?,?,?,?,?,?,?)',
          [this.currentFarm.farm_id, billNumber, this.selectedCustomerId, customerName, new Date().toISOString().split('T')[0], totalAmount, totalAmount, effectivePaidAmount, this.paymentMethod === 'bank' ? 'bank' : 'cash']);
        
        const lastBill = await this.db.get('SELECT MAX(bill_id) as bid FROM bills WHERE farm_id=?', [this.currentFarm.farm_id]);
        const billId = lastBill.success && lastBill.data[0] ? lastBill.data[0].bid : null;
        savedBillId = billId;
        
        if (billId) {
          for (const item of this.gridItems) {
            await this.db.run('INSERT INTO bill_items (bill_id, product_id, product_name, quantity, unit_price, total_price) VALUES (?,?,?,?,?,?)',
              [billId, item.productId, item.productName, item.quantity, item.unitPrice, item.totalPrice]);
            
            await this.deductFromBatches(item.productId, item.quantity, billId);
          }
          
          if (this.selectedCustomerId) {
            await this.addToCustomerLedger(
              this.selectedCustomerId, 
              billId, 
              totalAmount, 
              effectivePaidAmount, 
              billNumber
            );
          }

          if (this.paymentMethod === 'bank' && this.selectedCustomerId) {
            const bankSuccess = await this.processBankPayment(
              this.selectedCustomerId, 
              totalAmount, 
              billNumber
            );
            if (!bankSuccess) {
              throw new Error(this.errorMessage || 'Bank payment failed');
            }
          }
        }
      }
      
      this.resetForm();
      this.viewMode = 'list';
      await this.loadBills();
      await this.loadData();
      
    } catch (error: any) {
      this.errorMessage = 'Error saving bill: ' + error.message;
      console.error('Save error:', error);
      this.cdr.detectChanges();
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
    return savedBillId;
  }

  confirmDeleteBill(event: Event, billId: number) {
    event.stopPropagation();
    this.deletingBillId = billId;
    this.showDeleteDialog = true;
  }

  async onDeleteConfirmed() {
    if (!this.deletingBillId) return;
    try {
      const bill = this.allBills.find(b => b.bill_id === this.deletingBillId);
      
      if (bill?.customer_id) {
        await this.removeFromCustomerLedger(this.deletingBillId, bill.customer_id);
      }
      
      await this.restoreBillStock(this.deletingBillId);
      await this.db.run('DELETE FROM bill_items WHERE bill_id=?', [this.deletingBillId]);
      await this.db.run('DELETE FROM bills WHERE bill_id=?', [this.deletingBillId]);
      this.showDeleteDialog = false;
      this.deletingBillId = null;
      await this.loadData();
    } catch (error: any) {
      this.errorMessage = 'Error deleting bill: ' + error.message;
      this.cdr.detectChanges();
    }
  }

  onDeleteCancelled() {
    this.showDeleteDialog = false;
    this.deletingBillId = null;
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
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...B);
    doc.text(farmName.toUpperCase(), pw / 2, y, { align: 'center' }); y += 8;
    doc.setFontSize(12); doc.text('Sales Receipt', pw / 2, y, { align: 'center' }); y += 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Bill #: ' + bill.bill_number, 14, y); doc.text('Date: ' + bill.bill_date, pw - 14, y, { align: 'right' }); y += 6;
    doc.text('Customer: ' + (bill.customer_name || 'Walk-in'), 14, y); y += 4;
    doc.setDrawColor(...B); doc.line(14, y, pw - 14, y); y += 6;

    autoTable(doc, { startY: y, head: [['Product', 'Qty', 'Price', 'Total']], body: billItems.map((i: any) => [i.product_name, String(i.quantity), 'Rs. ' + i.unit_price.toLocaleString(), 'Rs. ' + i.total_price.toLocaleString()]),
      theme: 'plain', headStyles: { fontStyle: 'bold', fontSize: 9, textColor: B, fillColor: false as any }, bodyStyles: { fontSize: 9 }, margin: { left: 14, right: 14 } });
    
    const finalY = (doc as any).lastAutoTable.finalY + 4;
    doc.setDrawColor(...B); doc.line(14, finalY, pw - 14, finalY);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Total: Rs. ' + bill.total_amount.toLocaleString(), 14, finalY + 6);
    doc.text('Paid: Rs. ' + bill.amount_paid.toLocaleString(), 14, finalY + 12);

    const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(120,120,120);
    doc.text(footer, pw / 2, 290, { align: 'center' });

    doc.save(bill.bill_number + '.pdf');
  }
}