import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

@Component({
  selector: 'app-distribution-report',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './distribution-report.component.html',
  styleUrl: './distribution-report.component.scss'
})
export class DistributionReportComponent implements OnInit {
  currentFarm: any = null;
  products: any[] = [];
  purchases: any[] = [];
  sales: any[] = [];
  customers: any[] = [];
  isGenerating = false;

  // ── CALCULATIONS ──────────────────────────────────────────

  /**
   * 🔥 FIX: Inventory Value = Total Purchases - Total Sales
   * This is the correct accounting formula
   */
  get totalInventoryValue(): number {
    return this.totalPurchases - this.totalSales;
  }

  get totalPurchases(): number {
    return this.purchases.reduce((sum: number, p: any) => sum + (p.total_amount || 0), 0);
  }

  get totalSales(): number {
    return this.sales.reduce((sum: number, s: any) => sum + (s.total_amount || 0), 0);
  }

  get totalPaidSales(): number {
    return this.sales.reduce((sum: number, s: any) => sum + (s.amount_paid || 0), 0);
  }

  get totalUnpaidSales(): number {
    return this.customers.reduce((sum: number, c: any) => sum + (c.outstanding_balance || 0), 0);
  }

  get totalProducts(): number {
    return this.products.length;
  }

  get totalPurchasesCount(): number {
    return this.purchases.length;
  }

  get totalSalesCount(): number {
    return this.sales.length;
  }

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadData();
  }

  // ── LOAD DATA ─────────────────────────────────────────────

  async loadData() {
    // Load products
    const pr = await this.db.get('SELECT * FROM products WHERE farm_id=?', [this.currentFarm.farm_id]);
    this.products = pr.success ? pr.data : [];

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

    // Determine bill paid status
    for (const bill of this.sales) {
      bill.is_paid = (bill.amount_paid || 0) >= (bill.total_amount || 0);
    }

    console.log('📊 Distribution Report Data:');
    console.log(`Total Purchases: Rs. ${this.totalPurchases.toLocaleString()}`);
    console.log(`Total Sales: Rs. ${this.totalSales.toLocaleString()}`);
    console.log(`Inventory Value: Rs. ${this.totalInventoryValue.toLocaleString()}`);

    this.cdr.detectChanges();
  }

  isBillPaid(bill: any): boolean {
    if (bill.is_paid !== undefined) {
      return bill.is_paid;
    }
    return (bill.amount_paid || 0) >= (bill.total_amount || 0);
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

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(...B);
      doc.text('SUMMARY', margin, y);
      y += 8;

      const summaryData = [
        ['Total Products', String(this.totalProducts)],
        ['Total Purchase Orders', String(this.totalPurchasesCount)],
        ['Total Sales Bills', String(this.totalSalesCount)],
        ['Inventory Value (Purchases - Sales)', 'Rs. ' + this.totalInventoryValue.toLocaleString()],
        ['Total Purchases', 'Rs. ' + this.totalPurchases.toLocaleString()],
        ['Total Sales', 'Rs. ' + this.totalSales.toLocaleString()],
        ['Total Paid Sales', 'Rs. ' + this.totalPaidSales.toLocaleString()],
        ['Total Unpaid Sales', 'Rs. ' + this.totalUnpaidSales.toLocaleString()]
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

      // ── INVENTORY TABLE ────────────────────────────────────

      if (this.products.length > 0) {
        doc.addPage();
        this.addPageHeader(doc, farmName, today, 'INVENTORY DETAIL');
        
        const inventoryBody = this.products.map(p => [
          p.product_name,
          p.category || '—',
          String(p.unit || '—'),
          String(p.current_stock || 0),
          'Rs. ' + (p.cost_price || 0).toLocaleString(),
          'Rs. ' + (p.selling_price || 0).toLocaleString(),
          'Rs. ' + ((p.current_stock || 0) * (p.cost_price || 0)).toLocaleString()
        ]);

        autoTable(doc, {
          startY: 35,
          head: [['Product', 'Category', 'Unit', 'Stock', 'Cost', 'Sell', 'Value']],
          body: inventoryBody.length > 0 ? inventoryBody : [['No products found', '', '', '', '', '', '']],
          theme: 'striped',
          headStyles: { fontStyle: 'bold', fontSize: 8, fillColor: [26, 92, 56], textColor: [255, 255, 255] },
          bodyStyles: { fontSize: 8, textColor: B },
          margin: { left: margin, right: margin },
          columnStyles: {
            0: { cellWidth: 35 },
            1: { cellWidth: 25 },
            2: { cellWidth: 20 },
            3: { cellWidth: 20, halign: 'right' },
            4: { cellWidth: 25, halign: 'right' },
            5: { cellWidth: 25, halign: 'right' },
            6: { cellWidth: 30, halign: 'right' }
          }
        });

        const finalY = (doc as any).lastAutoTable.finalY + 6;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...B);
        doc.text(`Total Inventory Value: Rs. ${this.totalInventoryValue.toLocaleString()}`, margin, finalY);
      }

      // ── PURCHASES ──────────────────────────────────────────

      if (this.purchases.length > 0) {
        doc.addPage();
        this.addPageHeader(doc, farmName, today, 'PURCHASE ORDERS');
        
        const purchaseBody = this.purchases.map(p => [
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

      if (this.sales.length > 0) {
        doc.addPage();
        this.addPageHeader(doc, farmName, today, 'SALES BILLS');
        
        const salesBody = this.sales.map(s => {
          const isPaid = this.isBillPaid(s);
          return [
            formatDate(s.bill_date),
            s.bill_number || '—',
            s.customer_name || 'Walk-in',
            'Rs. ' + (s.total_amount || 0).toLocaleString(),
            'Rs. ' + (s.amount_paid || 0).toLocaleString(),
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