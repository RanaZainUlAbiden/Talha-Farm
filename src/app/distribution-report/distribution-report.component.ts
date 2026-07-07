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
  products: any[] = []; purchases: any[] = []; sales: any[] = [];
  isGenerating = false;

  get totalInventoryValue() { return this.products.reduce((s: number, p: any) => s + (p.current_stock * p.cost_price || 0), 0); }
  get totalPurchases() { return this.purchases.reduce((s: number, p: any) => s + (p.total_amount || 0), 0); }
  get totalSales() { return this.sales.reduce((s: number, p: any) => s + (p.total_amount || 0), 0); }

  constructor(private db: DatabaseService, private authService: AuthService, private cdr: ChangeDetectorRef) {}

  ngOnInit() { this.currentFarm = this.authService.getCurrentFarm(); this.loadData(); }

  async loadData() {
    const pr = await this.db.get('SELECT * FROM products WHERE farm_id=?', [this.currentFarm.farm_id]);
    this.products = pr.success ? pr.data : [];
    const pu = await this.db.get('SELECT po.*, p.product_name, s.supplier_name FROM purchase_orders po LEFT JOIN products p ON po.product_id=p.product_id LEFT JOIN suppliers s ON po.supplier_id=s.supplier_id WHERE po.farm_id=? ORDER BY po.date DESC', [this.currentFarm.farm_id]);
    this.purchases = pu.success ? pu.data : [];
    const sa = await this.db.get('SELECT * FROM bills WHERE farm_id=? ORDER BY bill_date DESC, bill_id DESC', [this.currentFarm.farm_id]);
    this.sales = sa.success ? sa.data : [];
    this.cdr.detectChanges();
  }

  async generatePDF() {
    this.isGenerating = true;
    try {
      const doc = new jsPDF(); const pw = doc.internal.pageSize.getWidth(); const ph = doc.internal.pageSize.getHeight();
      const farmName = this.currentFarm?.farm_name || 'Poultry Farm';
      const today = new Date().toLocaleDateString('en-PK');
      const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';
      const formatDate = (d: any) => {
        if (!d) return '—';
        const p = String(d).split('T')[0].split(' ')[0].split('-');
        return (p.length === 3 && p[0].length === 4) ? `${p[2]}-${p[1]}-${p[0]}` : String(d);
      };
      const B: [number,number,number] = [0,0,0]; const G: [number,number,number] = [120,120,120]; const LG: [number,number,number] = [200,200,200];

      // Cover
      let y = 20;
      try { const id = await this.loadImageAsBase64('report-boiler.jpeg'); const ip = doc.getImageProperties(id); const lw = pw - 28; const lh = (ip.height * lw) / ip.width; doc.addImage(id, 'JPEG', (pw - lw) / 2, y, lw, lh); y += lh + 12; } catch {}
      doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...B); doc.text('DISTRIBUTION REPORT', pw / 2, y, { align: 'center' }); y += 9;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(14); doc.setTextColor(...G); doc.text(farmName, pw / 2, y, { align: 'center' }); y += 7;
      doc.setFontSize(11); doc.text('Generated: ' + today, pw / 2, y, { align: 'center' }); y += 8;
      doc.setDrawColor(...B); doc.line(14, y, pw - 14, y); y += 8;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...B); doc.text('SUMMARY', 14, y); y += 6;
      const sum: [string, string][] = [['Total Products', String(this.products.length)], ['Inventory Value', 'Rs. ' + this.totalInventoryValue.toLocaleString()], ['Total Purchases', 'Rs. ' + this.totalPurchases.toLocaleString()], ['Total Sales', 'Rs. ' + this.totalSales.toLocaleString()]];
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      for (const [l, v] of sum) { doc.setTextColor(...G); doc.text(l + ':', 14, y); doc.setTextColor(...B); doc.text(v, 90, y); y += 6; }

      // Inventory
      if (this.products.length > 0) {
        doc.addPage(); doc.setFontSize(8); doc.setTextColor(...G); doc.text(farmName, 14, 9); doc.text(today, pw - 14, 9, { align: 'right' });
        doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(...B); doc.text('INVENTORY', 14, 22); doc.setDrawColor(...B); doc.line(14, 25, pw - 14, 25);
        autoTable(doc, { startY: 30, head: [['Product', 'Category', 'Stock', 'Cost', 'Sell', 'Value']], body: this.products.map(p => [p.product_name, p.category, String(p.current_stock), 'Rs. ' + (p.cost_price||0).toLocaleString(), 'Rs. ' + (p.selling_price||0).toLocaleString(), 'Rs. ' + (p.current_stock * p.cost_price || 0).toLocaleString()]), theme: 'plain', headStyles: { fontStyle: 'bold', fontSize: 9, textColor: B, fillColor: false as any }, bodyStyles: { fontSize: 9, textColor: B }, margin: { left: 14, right: 14 } });
      }

      if (this.purchases.length > 0) {
        doc.addPage(); doc.setFontSize(8); doc.setTextColor(...G); doc.text(farmName, 14, 9); doc.text(today, pw - 14, 9, { align: 'right' });
        doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(...B); doc.text('PURCHASES', 14, 22); doc.setDrawColor(...B); doc.line(14, 25, pw - 14, 25);
        autoTable(doc, { startY: 30, head: [['Date', 'Product', 'Supplier', 'Qty', 'Cost', 'Total']], body: this.purchases.map(p => [formatDate(p.date), p.product_name || '-', p.supplier_name || '-', String(p.quantity), 'Rs. ' + (p.cost_price || 0).toLocaleString(), 'Rs. ' + (p.total_amount || 0).toLocaleString()]), theme: 'plain', headStyles: { fontStyle: 'bold', fontSize: 9, textColor: B, fillColor: false as any }, bodyStyles: { fontSize: 9, textColor: B }, margin: { left: 14, right: 14 } });
      }

      if (this.sales.length > 0) {
        doc.addPage(); doc.setFontSize(8); doc.setTextColor(...G); doc.text(farmName, 14, 9); doc.text(today, pw - 14, 9, { align: 'right' });
        doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(...B); doc.text('SALES BILLS', 14, 22); doc.setDrawColor(...B); doc.line(14, 25, pw - 14, 25);
        autoTable(doc, { startY: 30, head: [['Date', 'Bill #', 'Customer', 'Total', 'Paid', 'Status']], body: this.sales.map(s => [formatDate(s.bill_date), s.bill_number, s.customer_name || 'Walk-in', 'Rs. ' + (s.total_amount || 0).toLocaleString(), 'Rs. ' + (s.amount_paid || 0).toLocaleString(), (s.amount_paid || 0) >= (s.total_amount || 0) ? 'Paid' : 'Unpaid']), theme: 'plain', headStyles: { fontStyle: 'bold', fontSize: 9, textColor: B, fillColor: false as any }, bodyStyles: { fontSize: 9, textColor: B }, margin: { left: 14, right: 14 } });
      }

      // Footer
      const tp = (doc.internal as any).getNumberOfPages();
      for (let i = 1; i <= tp; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(...G); doc.text(footer, pw / 2, ph - 9, { align: 'center' }); doc.text('Page ' + i + ' of ' + tp, pw / 2, ph - 4, { align: 'center' }); }

      doc.save(farmName + '-Distribution-Report.pdf');
    } finally { this.isGenerating = false; this.cdr.detectChanges(); }
  }

  private loadImageAsBase64(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d')!.drawImage(img, 0, 0); resolve(c.toDataURL('image/jpeg')); };
      img.onerror = () => reject(new Error('Logo load failed')); img.src = url;
    });
  }
}
