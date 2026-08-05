import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

@Component({
  selector: 'app-distribution-report',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './distribution-report.component.html',
  styleUrl: './distribution-report.component.scss'
})
export class DistributionReportComponent implements OnInit {
  currentFarm: any = null;
  products: any[] = [];
  purchases: any[] = [];
  sales: any[] = [];
  expenses: any[] = [];
  customers: any[] = [];
  isGenerating = false;
  isLoading = true;
  errorMessage = '';

  // Features
  sections = {
    inventory: true,
    purchases: true,
    sales: true,
    expenses: true,
    summary: true
  };
  
  dateFrom: string = '';
  dateTo: string = '';

  // ── CALCULATIONS ──────────────────────────────────────────

  /**
   * 🔥 FIX: Inventory Value calculated from actual batch stock
   * Each product's value = (current_stock from batches) * (cost_price)
   */
  get totalInventoryValue(): number {
    let total = 0;
    for (const product of this.products) {
      const stock = product.calculated_stock || 0;
      const costPrice = product.cost_price || 0;
      total += stock * costPrice;
    }
    return total;
  }

  get filteredPurchases(): any[] {
    if (!this.dateFrom && !this.dateTo) return this.purchases;
    return this.purchases.filter((p: any) => {
      const date = p.date ? new Date(p.date).setHours(0,0,0,0) : null;
      if (!date) return false;
      const from = this.dateFrom ? new Date(this.dateFrom).setHours(0,0,0,0) : null;
      const to = this.dateTo ? new Date(this.dateTo).setHours(0,0,0,0) : null;
      if (from && to) return date >= from && date <= to;
      if (from) return date >= from;
      if (to) return date <= to;
      return true;
    });
  }

  get filteredSales(): any[] {
    if (!this.dateFrom && !this.dateTo) return this.sales;
    return this.sales.filter((s: any) => {
      const date = s.bill_date ? new Date(s.bill_date).setHours(0,0,0,0) : null;
      if (!date) return false;
      const from = this.dateFrom ? new Date(this.dateFrom).setHours(0,0,0,0) : null;
      const to = this.dateTo ? new Date(this.dateTo).setHours(0,0,0,0) : null;
      if (from && to) return date >= from && date <= to;
      if (from) return date >= from;
      if (to) return date <= to;
      return true;
    });
  }

  get filteredExpenses(): any[] {
    if (!this.dateFrom && !this.dateTo) return this.expenses;
    return this.expenses.filter((e: any) => {
      const date = e.transaction_date ? new Date(e.transaction_date).setHours(0,0,0,0) : null;
      if (!date) return false;
      const from = this.dateFrom ? new Date(this.dateFrom).setHours(0,0,0,0) : null;
      const to = this.dateTo ? new Date(this.dateTo).setHours(0,0,0,0) : null;
      if (from && to) return date >= from && date <= to;
      if (from) return date >= from;
      if (to) return date <= to;
      return true;
    });
  }

  get totalPurchases(): number {
    return this.filteredPurchases.reduce((sum: number, p: any) => sum + (p.total_amount || 0), 0);
  }

  get totalSales(): number {
    return this.filteredSales.reduce((sum: number, s: any) => sum + (s.total_amount || 0), 0);
  }

  get totalPaidSales(): number {
    return this.filteredSales.reduce((sum: number, s: any) => sum + this.getBillPaidAmount(s), 0);
  }

  get totalExpenses(): number {
    return this.filteredExpenses.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
  }

  get totalProfitLoss(): number {
    return this.totalSales - this.totalPurchases - this.totalExpenses;
  }

  /**
   * 🔥 FIX: Unpaid Sales = Total Sales - Total Paid Sales
   * This is the correct accounting formula
   */
  get totalUnpaidSales(): number {
    return this.filteredSales.reduce((sum: number, s: any) => {
      const total = Number(s.total_amount) || 0;
      return sum + Math.max(total - this.getBillPaidAmount(s), 0);
    }, 0);
  }

  /**
   * Alternative: Unpaid Sales from customer outstanding balances
   * This should match the calculation above
   */
  get totalOutstandingBalance(): number {
    return this.customers.reduce((sum: number, c: any) => sum + (c.outstanding_balance || 0), 0);
  }

  get totalProducts(): number {
    return this.products.length;
  }

  get totalPurchasesCount(): number {
    return this.filteredPurchases.length;
  }

  get totalSalesCount(): number {
    return this.filteredSales.length;
  }

  get totalExpensesCount(): number {
    return this.filteredExpenses.length;
  }

  /**
   * Get product stock from batches
   */
  getProductStock(productId: number): number {
    const product = this.products.find(p => p.product_id === productId);
    return product?.calculated_stock || 0;
  }

  /**
   * Get product inventory value
   */
  getProductValue(product: any): number {
    const stock = product.calculated_stock || 0;
    const costPrice = product.cost_price || 0;
    return stock * costPrice;
  }

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadPreferences();
    this.loadData();
  }

  loadPreferences() {
    const saved = localStorage.getItem('distReportPrefs');
    if (saved) {
      try {
        this.sections = JSON.parse(saved);
      } catch (e) {
        console.error('Error parsing preferences', e);
      }
    }
  }

  savePreferences() {
    localStorage.setItem('distReportPrefs', JSON.stringify(this.sections));
  }

  applyDateFilter() {
    this.cdr.detectChanges();
  }

  clearDateFilter() {
    this.dateFrom = '';
    this.dateTo = '';
    this.cdr.detectChanges();
  }

  // ── LOAD DATA ─────────────────────────────────────────────

  async loadData() {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      // Load products
      const pr = await this.db.get('SELECT * FROM products WHERE farm_id=?', [this.currentFarm.farm_id]);
      this.products = pr.success ? pr.data : [];

      // 🔥 Calculate stock for each product from batches
      for (const product of this.products) {
        const totalStock = await this.db.getTotalStock(product.product_id);
        product.calculated_stock = totalStock;
        
        // Also get batch count for display
        const batchesResult = await this.db.getBatchesByProduct(product.product_id, this.currentFarm.farm_id);
        const batches = batchesResult.success && batchesResult.data ? batchesResult.data : [];
        product.batch_count = batches.length;
        
        // Check for expiring batches
        const hasExpiring = await this.db.hasExpiringBatches(product.product_id);
        product.has_expiring = hasExpiring;
      }

      // Load purchases
      const pu = await this.db.get(
        `SELECT po.*, p.product_name, s.supplier_name 
         FROM purchase_orders po 
         LEFT JOIN products p ON po.product_id = p.product_id 
         LEFT JOIN suppliers s ON po.supplier_id = s.supplier_id 
         WHERE po.farm_id = ? 
         ORDER BY po.date DESC`,
        [this.currentFarm.farm_id]
      );
      this.purchases = pu.success ? pu.data : [];

      // Load sales bills
      const sa = await this.db.get(
        `SELECT * FROM bills WHERE farm_id = ? ORDER BY bill_date DESC, bill_id DESC`,
        [this.currentFarm.farm_id]
      );
      this.sales = sa.success ? sa.data : [];

      // Load customers
      const customersResult = await this.db.getAllCustomersWithBalance(this.currentFarm.farm_id);
      this.customers = customersResult.success ? customersResult.data : [];

      // Load expenses
      const ex = await this.db.get(
        `SELECT * FROM expense_ledger WHERE farm_id = ? ORDER BY transaction_date DESC`,
        [this.currentFarm.farm_id]
      );
      this.expenses = ex.success ? ex.data : [];

      // Determine bill paid status
      for (const bill of this.sales) {
        bill.is_paid = this.getBillPaidAmount(bill) >= (Number(bill.total_amount) || 0);
      }

      console.log('📊 Distribution Report Data:');
      console.log(`Total Products: ${this.totalProducts}`);
      console.log(`Total Purchases: Rs. ${this.totalPurchases.toLocaleString()}`);
      console.log(`Total Sales: Rs. ${this.totalSales.toLocaleString()}`);
      console.log(`Total Paid Sales: Rs. ${this.totalPaidSales.toLocaleString()}`);
      console.log(`Total Unpaid Sales: Rs. ${this.totalUnpaidSales.toLocaleString()}`);
      console.log(`Total Expenses: Rs. ${this.totalExpenses.toLocaleString()}`);
      console.log(`Inventory Value: Rs. ${this.totalInventoryValue.toLocaleString()}`);

    } catch (error: any) {
      this.errorMessage = 'Failed to load data: ' + error.message;
      console.error('Load error:', error);
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  isBillPaid(bill: any): boolean {
    if (bill.is_paid !== undefined) {
      return bill.is_paid;
    }
    return this.getBillPaidAmount(bill) >= (Number(bill.total_amount) || 0);
  }

  getBillPaidAmount(bill: any): number {
    const total = Number(bill?.total_amount) || 0;
    const paid = Number(bill?.amount_paid) || 0;
    return Math.min(Math.max(paid, 0), total);
  }

  // ── PDF GENERATION ────────────────────────────────────────

  async generatePDF() {
    this.isGenerating = true;
    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      const farmName = this.currentFarm?.farm_name || 'Poultry Farm';
      const today = new Date().toLocaleDateString('en-PK');
      const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';
      const margin = 14;
      
      const formatDate = (d: any) => {
        if (!d) return '—';
        const p = String(d).split('T')[0].split(' ')[0].split('-');
        return (p.length === 3 && p[0].length === 4) ? `${p[2]}-${p[1]}-${p[0]}` : String(d);
      };
      
      const B: [number, number, number] = [0, 0, 0];
      const G: [number, number, number] = [120, 120, 120];
      
      let y = 20;

      // ── COVER PAGE ─────────────────────────────────────────

      try {
        const id = await this.loadImageAsBase64('report-boiler.jpeg');
        const ip = doc.getImageProperties(id);
        const lh = 35;
        const lw = (ip.width * lh) / ip.height;
        const tx = margin + lw + 10;
        doc.addImage(id, 'JPEG', margin, y, lw, lh);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.setTextColor(...B);
        doc.text('DISTRIBUTION REPORT', tx, y + 10);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(13);
        doc.setTextColor(...G);
        doc.text(farmName, tx, y + 18);
        doc.setFontSize(10);
        doc.text('Generated: ' + today, tx, y + 25);
        y += lh + 10;
      } catch {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.setTextColor(...B);
        doc.text('DISTRIBUTION REPORT', pw / 2, y, { align: 'center' });
        y += 10;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(12);
        doc.setTextColor(...G);
        doc.text(farmName, pw / 2, y, { align: 'center' });
        y += 8;
        doc.text('Generated: ' + today, pw / 2, y, { align: 'center' });
        y += 15;
      }

      doc.setDrawColor(...B);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pw - margin, y);
      y += 10;

      // ── SUMMARY SECTION ────────────────────────────────────

      if (this.sections.summary) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(...B);
        doc.text('SUMMARY', margin, y);
        y += 8;

        const summaryData = [
          ['Total Products', String(this.totalProducts)],
          ['Total Purchase Orders', String(this.totalPurchasesCount)],
          ['Total Sales Bills', String(this.totalSalesCount)],
          ['Total Expenses Count', String(this.totalExpensesCount)],
          ['Inventory Value (Stock × Cost)', 'Rs. ' + this.totalInventoryValue.toLocaleString()],
          ['Total Purchases', 'Rs. ' + this.totalPurchases.toLocaleString()],
          ['Total Sales', 'Rs. ' + this.totalSales.toLocaleString()],
          ['Total Paid Sales', 'Rs. ' + this.totalPaidSales.toLocaleString()],
          ['Total Unpaid Sales (Sales - Paid)', 'Rs. ' + this.totalUnpaidSales.toLocaleString()],
          ['Total Expenses', 'Rs. ' + this.totalExpenses.toLocaleString()],
          ['Profit / Loss', 'Rs. ' + this.totalProfitLoss.toLocaleString()]
        ];

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        for (const [label, value] of summaryData) {
          doc.setTextColor(...G);
          doc.text(label + ':', margin + 6, y);
          doc.setTextColor(...B);
          doc.text(value, margin + 80, y);
          y += 6;
        }
      }

      // ── INVENTORY TABLE ────────────────────────────────────

      if (this.sections.inventory && this.products.length > 0) {
        doc.addPage();
        this.addPageHeader(doc, farmName, today, 'INVENTORY DETAIL (Current Stock from Batches)');
        
        // Sort products by stock value (highest first)
        const sortedProducts = [...this.products].sort((a, b) => {
          const valA = (a.calculated_stock || 0) * (a.cost_price || 0);
          const valB = (b.calculated_stock || 0) * (b.cost_price || 0);
          return valB - valA;
        });

        const inventoryBody = sortedProducts.map(p => [
          p.product_name,
          p.category || '—',
          String(p.unit || '—'),
          String(p.calculated_stock || 0),
          String(p.batch_count || 0),
          'Rs. ' + (p.cost_price || 0).toLocaleString(),
          'Rs. ' + (p.selling_price || 0).toLocaleString(),
          'Rs. ' + ((p.calculated_stock || 0) * (p.cost_price || 0)).toLocaleString()
        ]);

        autoTable(doc, {
          startY: 35,
          head: [['Product', 'Category', 'Unit', 'Stock', 'Batches', 'Cost', 'Sell', 'Value']],
          body: inventoryBody.length > 0 ? inventoryBody : [['No products found', '', '', '', '', '', '', '']],
          theme: 'striped',
          headStyles: { fontStyle: 'bold', fontSize: 7, fillColor: [26, 92, 56], textColor: [255, 255, 255] },
          bodyStyles: { fontSize: 7, textColor: B },
          margin: { left: margin, right: margin },
          columnStyles: {
            0: { cellWidth: 28 },
            1: { cellWidth: 20 },
            2: { cellWidth: 15 },
            3: { cellWidth: 18, halign: 'right' },
            4: { cellWidth: 18, halign: 'right' },
            5: { cellWidth: 20, halign: 'right' },
            6: { cellWidth: 20, halign: 'right' },
            7: { cellWidth: 25, halign: 'right' }
          }
        });

        const finalY = (doc as any).lastAutoTable.finalY + 6;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...B);
        doc.text(`Total Inventory Value: Rs. ${this.totalInventoryValue.toLocaleString()}`, margin, finalY);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...G);
        doc.text('* Inventory value calculated as: Current Stock × Cost Price', margin, finalY + 5);
      }

      // ── PURCHASES ──────────────────────────────────────────

      if (this.sections.purchases && this.filteredPurchases.length > 0) {
        doc.addPage();
        this.addPageHeader(doc, farmName, today, 'PURCHASE ORDERS');
        
        const purchaseBody = this.filteredPurchases.map(p => [
          formatDate(p.date),
          p.product_name || '—',
          p.supplier_name || '—',
          String(p.quantity || 0),
          'Rs. ' + (p.cost_price || 0).toLocaleString(),
          'Rs. ' + (p.total_amount || 0).toLocaleString(),
          p.payment_type || '—'
        ]);

        autoTable(doc, {
          startY: 35,
          head: [['Date', 'Product', 'Supplier', 'Qty', 'Cost', 'Total', 'Payment']],
          body: purchaseBody.length > 0 ? purchaseBody : [['No purchases found', '', '', '', '', '', '']],
          theme: 'striped',
          headStyles: { fontStyle: 'bold', fontSize: 8, fillColor: [26, 92, 56], textColor: [255, 255, 255] },
          bodyStyles: { fontSize: 8, textColor: B },
          margin: { left: margin, right: margin },
          columnStyles: {
            0: { cellWidth: 25 },
            1: { cellWidth: 30 },
            2: { cellWidth: 30 },
            3: { cellWidth: 15, halign: 'right' },
            4: { cellWidth: 20, halign: 'right' },
            5: { cellWidth: 25, halign: 'right' },
            6: { cellWidth: 20 }
          }
        });

        const finalY = (doc as any).lastAutoTable.finalY + 6;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...B);
        doc.text(`Total Purchases: Rs. ${this.totalPurchases.toLocaleString()}`, margin, finalY);
      }

      // ── SALES ──────────────────────────────────────────────

      if (this.sections.sales && this.filteredSales.length > 0) {
        doc.addPage();
        this.addPageHeader(doc, farmName, today, 'SALES BILLS');
        
        const salesBody = this.filteredSales.map(s => {
          const isPaid = this.isBillPaid(s);
          return [
            formatDate(s.bill_date),
            s.bill_number || '—',
            s.customer_name || 'Walk-in',
            'Rs. ' + (s.total_amount || 0).toLocaleString(),
            'Rs. ' + this.getBillPaidAmount(s).toLocaleString(),
            isPaid ? '✅ Paid' : '❌ Unpaid'
          ];
        });

        autoTable(doc, {
          startY: 35,
          head: [['Date', 'Bill #', 'Customer', 'Total', 'Paid', 'Status']],
          body: salesBody.length > 0 ? salesBody : [['No sales found', '', '', '', '', '']],
          theme: 'striped',
          headStyles: { fontStyle: 'bold', fontSize: 8, fillColor: [26, 92, 56], textColor: [255, 255, 255] },
          bodyStyles: { fontSize: 8, textColor: B },
          margin: { left: margin, right: margin },
          columnStyles: {
            0: { cellWidth: 25 },
            1: { cellWidth: 30 },
            2: { cellWidth: 30 },
            3: { cellWidth: 25, halign: 'right' },
            4: { cellWidth: 25, halign: 'right' },
            5: { cellWidth: 20 }
          }
        });

        const finalY = (doc as any).lastAutoTable.finalY + 6;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...B);
        doc.text(`Total Sales: Rs. ${this.totalSales.toLocaleString()}`, margin, finalY);
        doc.text(`Total Paid: Rs. ${this.totalPaidSales.toLocaleString()}`, margin, finalY + 6);
        doc.text(`Total Unpaid: Rs. ${this.totalUnpaidSales.toLocaleString()}`, margin, finalY + 12);
      }

      // ── EXPENSES ───────────────────────────────────────────

      if (this.sections.expenses && this.filteredExpenses.length > 0) {
        doc.addPage();
        this.addPageHeader(doc, farmName, today, 'DISTRIBUTION EXPENSES');
        
        const expensesBody = this.filteredExpenses.map(e => [
          formatDate(e.transaction_date),
          e.category || '—',
          e.description || '—',
          e.payment_type || 'cash',
          'Rs. ' + (e.amount || 0).toLocaleString()
        ]);

        autoTable(doc, {
          startY: 35,
          head: [['Date', 'Category', 'Description', 'Payment Type', 'Amount']],
          body: expensesBody.length > 0 ? expensesBody : [['No expenses found', '', '', '', '']],
          theme: 'striped',
          headStyles: { fontStyle: 'bold', fontSize: 8, fillColor: [26, 92, 56], textColor: [255, 255, 255] },
          bodyStyles: { fontSize: 8, textColor: B },
          margin: { left: margin, right: margin },
          columnStyles: {
            0: { cellWidth: 25 },
            1: { cellWidth: 35 },
            2: { cellWidth: 70 },
            3: { cellWidth: 25 },
            4: { cellWidth: 25, halign: 'right' }
          }
        });

        const finalY = (doc as any).lastAutoTable.finalY + 6;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...B);
        doc.text(`Total Expenses: Rs. ${this.totalExpenses.toLocaleString()}`, margin, finalY);
      }

      // ── FOOTER ─────────────────────────────────────────────

      const totalPages = (doc.internal as any).getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7.5);
        doc.setTextColor(...G);
        doc.text(footer, pw / 2, ph - 9, { align: 'center' });
        doc.text('Page ' + i + ' of ' + totalPages, pw / 2, ph - 4, { align: 'center' });
      }

      doc.save(farmName + '-Distribution-Report.pdf');

    } catch (error) {
      console.error('PDF Generation Error:', error);
    } finally {
      this.isGenerating = false;
      this.cdr.detectChanges();
    }
  }

  // ── HELPER: Add Page Header ──────────────────────────────

  private addPageHeader(doc: jsPDF, farmName: string, date: string, title: string) {
    const pw = doc.internal.pageSize.getWidth();
    const B: [number, number, number] = [0, 0, 0];
    const G: [number, number, number] = [120, 120, 120];
    
    doc.setFontSize(8);
    doc.setTextColor(...G);
    doc.text(farmName, 14, 9);
    doc.text(date, pw - 14, 9, { align: 'right' });
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...B);
    doc.text(title, 14, 22);
    
    doc.setDrawColor(...B);
    doc.setLineWidth(0.5);
    doc.line(14, 25, pw - 14, 25);
  }

  // ── HELPER: Load Image ────────────────────────────────────

  private loadImageAsBase64(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d')!.drawImage(img, 0, 0);
        resolve(c.toDataURL('image/jpeg'));
      };
      img.onerror = () => reject(new Error('Logo load failed'));
      img.src = url;
    });
  }
}
