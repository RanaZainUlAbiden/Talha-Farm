import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
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

  // Bill List
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

  // Cart
  gridItems: any[] = [];
  productSearchTerm: string = '';
  productOptions: any[] = [];
  showProductDropdown: boolean = false;

  // Customer
  customerType: 'walkin' | 'regular' = 'walkin';
  selectedCustomerId: number | null = null;
  selectedCustomer: any = null;

  // Payment
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
  }

  async selectBill(bill: any) {
    this.viewMode = 'edit';
    this.isEditMode = true;
    this.editingBillId = bill.bill_id;
    this.customerType = bill.customer_id ? 'regular' : 'walkin';
    this.selectedCustomerId = bill.customer_id || null;
    this.paidAmount = bill.amount_paid;

    const items = await this.db.get('SELECT * FROM bill_items WHERE bill_id=?', [bill.bill_id]);
    this.gridItems = items.success ? items.data.map((i: any) => ({
      productId: i.product_id, productName: i.product_name, quantity: i.quantity, unitPrice: i.unit_price, totalPrice: i.total_price, itemId: i.item_id
    })) : [];
    this.cdr.detectChanges();
  }

  backToList() {
    this.resetForm();
    this.viewMode = 'list';
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
  }

  // Product Search
  onProductSearch() {
    const term = this.productSearchTerm.trim().toLowerCase();
    if (!term) { this.productOptions = []; this.showProductDropdown = false; return; }
    this.productOptions = this.products.filter(p => p.product_name.toLowerCase().includes(term));
    this.showProductDropdown = true;
  }

  selectProductOption(product: any) {
    const existing = this.gridItems.find(i => i.productId === product.product_id);
    if (existing) {
      existing.quantity += 1;
      existing.totalPrice = existing.quantity * existing.unitPrice;
    } else {
      this.gridItems.push({ productId: product.product_id, productName: product.product_name, quantity: 1, unitPrice: product.selling_price, totalPrice: product.selling_price });
    }
    this.productSearchTerm = '';
    this.productOptions = [];
    this.showProductDropdown = false;
    if (this.customerType === 'walkin') this.paidAmount = this.cartSubtotal;
    this.errorMessage = '';
  }

  recalcItem(item: any) {
    if (item.quantity < 1) item.quantity = 1;
    item.totalPrice = item.quantity * item.unitPrice;
    if (this.customerType === 'walkin') this.paidAmount = this.cartSubtotal;
  }

  removeItem(item: any) { this.gridItems = this.gridItems.filter(i => i !== item); if (this.customerType === 'walkin') this.paidAmount = this.cartSubtotal; }

  get cartSubtotal() { return this.gridItems.reduce((s, i) => s + i.totalPrice, 0); }

  onPaidAmountChange() { if (this.customerType === 'walkin') this.paidAmount = this.cartSubtotal; }

  // Generate Bill Number
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

  private getAvailableStock(productId: number, existingItems: any[] = []): number {
    const product = this.products.find(p => Number(p.product_id) === Number(productId));
    const stock = Number(product?.current_stock || 0);
    const existingQuantity = existingItems
      .filter(item => Number(item.product_id) === Number(productId))
      .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

    return stock + existingQuantity;
  }

  private async validateStockForBill(): Promise<boolean> {
    this.errorMessage = '';
    const existingItems = this.isEditMode && this.editingBillId ? await this.getBillItems(this.editingBillId) : [];

    for (const item of this.gridItems) {
      const availableStock = this.getAvailableStock(item.productId, existingItems);
      if (Number(item.quantity) > availableStock) {
        this.errorMessage = `${item.productName} has only ${availableStock} in stock.`;
        this.cdr.detectChanges();
        return false;
      }
    }

    return true;
  }

  private async restoreBillStock(billId: number) {
    const existingItems = await this.getBillItems(billId);
    for (const item of existingItems) {
      if (item.product_id) {
        await this.db.run('UPDATE products SET current_stock = current_stock + ? WHERE product_id = ?', [item.quantity, item.product_id]);
      }
    }
  }

  private async subtractGridStock() {
    for (const item of this.gridItems) {
      if (item.productId) {
        await this.db.run('UPDATE products SET current_stock = current_stock - ? WHERE product_id = ?', [item.quantity, item.productId]);
      }
    }
  }

  // Save Bill — returns the saved bill_id (or null if nothing was saved).
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
        // Update existing bill
        savedBillId = this.editingBillId;
        await this.restoreBillStock(this.editingBillId);
        await this.db.run('UPDATE bills SET customer_id=?, customer_name=?, subtotal=?, total_amount=?, amount_paid=?, payment_type=? WHERE bill_id=?',
          [this.selectedCustomerId, customerName, totalAmount, totalAmount, this.paidAmount, 'cash', this.editingBillId]);
        await this.db.run('DELETE FROM bill_items WHERE bill_id=?', [this.editingBillId]);
        for (const item of this.gridItems) {
          await this.db.run('INSERT INTO bill_items (bill_id, product_id, product_name, quantity, unit_price, total_price) VALUES (?,?,?,?,?,?)',
            [this.editingBillId, item.productId, item.productName, item.quantity, item.unitPrice, item.totalPrice]);
        }
        await this.subtractGridStock();
      } else {
        // Create new bill
        await this.db.run('INSERT INTO bills (farm_id, bill_number, customer_id, customer_name, bill_date, subtotal, total_amount, amount_paid, payment_type) VALUES (?,?,?,?,?,?,?,?,?)',
          [this.currentFarm.farm_id, billNumber, this.selectedCustomerId, customerName, new Date().toISOString().split('T')[0], totalAmount, totalAmount, this.paidAmount, 'cash']);
        // Get last inserted bill_id
        const lastBill = await this.db.get('SELECT MAX(bill_id) as bid FROM bills WHERE farm_id=?', [this.currentFarm.farm_id]);
        const billId = lastBill.success && lastBill.data[0] ? lastBill.data[0].bid : null;
        savedBillId = billId;
        if (billId) {
          for (const item of this.gridItems) {
            await this.db.run('INSERT INTO bill_items (bill_id, product_id, product_name, quantity, unit_price, total_price) VALUES (?,?,?,?,?,?)',
              [billId, item.productId, item.productName, item.quantity, item.unitPrice, item.totalPrice]);
            if (item.productId) await this.db.run('UPDATE products SET current_stock = current_stock - ? WHERE product_id = ?', [item.quantity, item.productId]);
          }
        }
      }
      this.resetForm();
      this.viewMode = 'list';
      await this.loadBills();
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
    await this.restoreBillStock(this.deletingBillId);
    await this.db.run('DELETE FROM bill_items WHERE bill_id=?', [this.deletingBillId]);
    await this.db.run('DELETE FROM bills WHERE bill_id=?', [this.deletingBillId]);
    this.showDeleteDialog = false;
    this.deletingBillId = null;
    await this.loadData();
  }

  onDeleteCancelled() {
    this.showDeleteDialog = false;
    this.deletingBillId = null;
  }

  // Save & Print — prints exactly the bill that was just saved.
  async saveAndPrint() {
    const billId = await this.saveBill();
    if (billId == null) return;
    const r = await this.db.get('SELECT * FROM bills WHERE bill_id=?', [billId]);
    const bill = r.success && r.data[0] ? r.data[0] : null;
    if (bill) this.printBill(bill);
  }

  // Print Bill PDF
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
