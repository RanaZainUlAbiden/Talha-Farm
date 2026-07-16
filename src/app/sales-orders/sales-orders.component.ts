import { Component, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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

  paidAmount: number = 0;
  isSubmitting: boolean = false;

  constructor(private db: DatabaseService, private authService: AuthService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadData();
  }

  async loadData() {
    const pr = await this.db.get('SELECT * FROM products WHERE farm_id=?', [this.currentFarm.farm_id]);
    this.products = pr.success ? pr.data : [];
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
    this.errorMessage = ''; // Clear error when creating new bill
  }

  async selectBill(bill: any) {
    this.viewMode = 'edit';
    this.isEditMode = true;
    this.editingBillId = bill.bill_id;
    this.customerType = bill.customer_id ? 'regular' : 'walkin';
    this.selectedCustomerId = bill.customer_id || null;
    this.paidAmount = bill.amount_paid;
    this.errorMessage = ''; // Clear error when selecting bill

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
  }

  async getAvailableStock(productId: number): Promise<number> {
    const totalStock = await this.db.getTotalStock(productId);
    return totalStock;
  }

  // ====================================================
  // 🟢 REAL-TIME PRODUCT SEARCH - FIXED
  // ====================================================

  onProductSearch() {
    const term = this.productSearchTerm.trim().toLowerCase();
    
    // Hide dropdown if search term is empty
    if (!term) { 
      this.productOptions = []; 
      this.showProductDropdown = false; 
      this.cdr.detectChanges();
      return; 
    }
    
    // 🔥 REAL-TIME FILTER: Search as user types
    this.productOptions = this.products.filter(p => 
      p.product_name.toLowerCase().includes(term) ||
      (p.category && p.category.toLowerCase().includes(term)) ||
      (p.unit && p.unit.toLowerCase().includes(term))
    );
    
    // Show dropdown if there are results OR show empty state
    this.showProductDropdown = true;
    
    // Force change detection for immediate UI update
    this.cdr.detectChanges();
  }

  // Click outside to close dropdown
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.psearch-wrap')) {
      this.showProductDropdown = false;
      this.cdr.detectChanges();
    }
  }

  async selectProductOption(product: any) {
    // Check if product already in cart
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
    
    // Clear search and close dropdown
    this.productSearchTerm = '';
    this.productOptions = [];
    this.showProductDropdown = false;
    
    // Update paid amount for walk-in customers
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

  // ====================================================
  // 🟢 CUSTOMER LEDGER INTEGRATION
  // ====================================================

  async addToCustomerLedger(customerId: number, billId: number, totalAmount: number, paidAmount: number, billNumber: string) {
    if (!customerId) return;
    
    // 1. Add DEBIT for the total bill amount (Customer owes total)
    await this.db.addCustomerLedgerEntry({
      customer_id: customerId,
      transaction_date: new Date().toISOString().split('T')[0],
      description: `Bill #${billNumber}`,
      debit: totalAmount,
      credit: 0,
      reference_type: 'bill',
      reference_id: billId
    });
    
    // 2. If payment was made, add CREDIT for the paid amount
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
    
    // Delete both bill and payment entries
    await this.db.run('DELETE FROM customer_ledger WHERE reference_id = ? AND reference_type IN (?, ?)', [billId, 'bill', 'payment']);
    await this.db.updateCustomerOutstandingBalance(customerId);
    console.log(`✅ Removed bill ${billId} from customer ${customerId} ledger`);
  }

  async updateCustomerLedgerOnEdit(billId: number, customerId: number, oldCustomerId: number, totalAmount: number, paidAmount: number, billNumber: string) {
    // Remove old entries
    if (oldCustomerId) {
      await this.db.run('DELETE FROM customer_ledger WHERE reference_id = ? AND reference_type IN (?, ?)', [billId, 'bill', 'payment']);
      await this.db.updateCustomerOutstandingBalance(oldCustomerId);
    }
    
    // Add new entries if customer exists
    if (customerId) {
      await this.addToCustomerLedger(customerId, billId, totalAmount, paidAmount, billNumber);
    }
    
    console.log(`✅ Updated customer ledger for bill ${billId}`);
  }

  // ====================================================
  // 🟢 Restore stock from BATCHES
  // ====================================================
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

  // ====================================================
  // 🟢 Deduct stock from BATCHES (FIFO)
  // ====================================================
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

  // ====================================================
  // 🟢 Save bill with BATCH + LEDGER integration
  // ====================================================
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
        
        // Get old customer ID for ledger update
        const oldBill = this.allBills.find(b => b.bill_id === this.editingBillId);
        const oldCustomerId = oldBill?.customer_id;
        const oldBillNumber = oldBill?.bill_number || '';
        
        // Restore old stock
        await this.restoreBillStock(this.editingBillId);
        
        // Remove old ledger entries
        if (oldCustomerId) {
          await this.removeFromCustomerLedger(this.editingBillId, oldCustomerId);
        }
        
        // Update bill
        await this.db.run('UPDATE bills SET customer_id=?, customer_name=?, subtotal=?, total_amount=?, amount_paid=?, payment_type=? WHERE bill_id=?',
          [this.selectedCustomerId, customerName, totalAmount, totalAmount, this.paidAmount, 'cash', this.editingBillId]);
        await this.db.run('DELETE FROM bill_items WHERE bill_id=?', [this.editingBillId]);
        
        for (const item of this.gridItems) {
          await this.db.run('INSERT INTO bill_items (bill_id, product_id, product_name, quantity, unit_price, total_price) VALUES (?,?,?,?,?,?)',
            [this.editingBillId, item.productId, item.productName, item.quantity, item.unitPrice, item.totalPrice]);
        }
        
        // Deduct new stock from batches
        for (const item of this.gridItems) {
          await this.deductFromBatches(item.productId, item.quantity, this.editingBillId);
        }
        
        // Add new ledger entries with payment
        if (this.selectedCustomerId) {
          await this.addToCustomerLedger(
            this.selectedCustomerId, 
            this.editingBillId, 
            totalAmount, 
            this.paidAmount, 
            oldBillNumber || billNumber
          );
        }
        
      } else {
        // Create new bill
        await this.db.run('INSERT INTO bills (farm_id, bill_number, customer_id, customer_name, bill_date, subtotal, total_amount, amount_paid, payment_type) VALUES (?,?,?,?,?,?,?,?,?)',
          [this.currentFarm.farm_id, billNumber, this.selectedCustomerId, customerName, new Date().toISOString().split('T')[0], totalAmount, totalAmount, this.paidAmount, 'cash']);
        
        const lastBill = await this.db.get('SELECT MAX(bill_id) as bid FROM bills WHERE farm_id=?', [this.currentFarm.farm_id]);
        const billId = lastBill.success && lastBill.data[0] ? lastBill.data[0].bid : null;
        savedBillId = billId;
        
        if (billId) {
          for (const item of this.gridItems) {
            await this.db.run('INSERT INTO bill_items (bill_id, product_id, product_name, quantity, unit_price, total_price) VALUES (?,?,?,?,?,?)',
              [billId, item.productId, item.productName, item.quantity, item.unitPrice, item.totalPrice]);
            
            await this.deductFromBatches(item.productId, item.quantity, billId);
          }
          
          // Add to customer ledger with payment
          if (this.selectedCustomerId) {
            await this.addToCustomerLedger(
              this.selectedCustomerId, 
              billId, 
              totalAmount, 
              this.paidAmount, 
              billNumber
            );
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

  // ====================================================
  // 🟢 Delete with LEDGER cleanup
  // ====================================================
  async onDeleteConfirmed() {
    if (!this.deletingBillId) return;
    try {
      const bill = this.allBills.find(b => b.bill_id === this.deletingBillId);
      
      // Remove from customer ledger
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