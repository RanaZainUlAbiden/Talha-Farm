import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

@Component({
  selector: 'app-layer-report',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './layer-report.component.html',
  styleUrl: './layer-report.component.scss'
})
export class LayerReportComponent implements OnInit {
  currentFarm: any = null;
  batches: any[] = [];
  eggCollections: any[] = [];
  eggSales: any[] = [];
  vaccinations: any[] = [];
  mortalities: any[] = [];
  isGenerating = false;

  get totalEggs() { return this.eggCollections.reduce((s: number, e: any) => s + (e.total_eggs || 0), 0); }
  get totalEggSales() { return this.eggSales.reduce((s: number, e: any) => s + (e.total_amount || 0), 0); }
  get totalMortality() { return this.mortalities.reduce((s: number, e: any) => s + (e.count || 0), 0); }

  constructor(private db: DatabaseService, private authService: AuthService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadData();
  }

  async loadData() {
    const b = await this.db.get('SELECT * FROM batches WHERE farm_id=?', [this.currentFarm.farm_id]);
    this.batches = b.success ? b.data : [];
    const ec = await this.db.get('SELECT ec.*, b.batch_name FROM egg_collection ec JOIN batches b ON ec.batch_id=b.batch_id WHERE b.farm_id=? ORDER BY ec.date DESC', [this.currentFarm.farm_id]);
    this.eggCollections = ec.success ? ec.data : [];
    const es = await this.db.get('SELECT es.*, b.batch_name FROM egg_sales es JOIN batches b ON es.batch_id=b.batch_id WHERE b.farm_id=? ORDER BY es.date DESC', [this.currentFarm.farm_id]);
    this.eggSales = es.success ? es.data : [];
    const v = await this.db.get('SELECT v.*, b.batch_name FROM vaccinations v JOIN batches b ON v.batch_id=b.batch_id WHERE b.farm_id=? ORDER BY v.date DESC', [this.currentFarm.farm_id]);
    this.vaccinations = v.success ? v.data : [];
    const m = await this.db.get('SELECT m.*, b.batch_name FROM layer_mortality m JOIN batches b ON m.batch_id=b.batch_id WHERE b.farm_id=? ORDER BY m.date DESC', [this.currentFarm.farm_id]);
    this.mortalities = m.success ? m.data : [];
    this.cdr.detectChanges();
  }

  async generatePDF() {
    this.isGenerating = true;
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const farmName = this.currentFarm?.farm_name || 'Poultry Farm';
      const today = new Date().toLocaleDateString('en-PK');
      const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';
      const formatDate = (d: any) => d ? String(d).split('T')[0] : '—';
      const BLACK: [number,number,number] = [0,0,0];
      const GRAY: [number,number,number] = [120,120,120];
      const LGRAY: [number,number,number] = [200,200,200];

      const bwTable = (startY: number, head: string[][], body: any[][], foot?: any[][], amountCol?: number) => {
        const colStyles: any = {};
        if (amountCol !== undefined) colStyles[amountCol] = { halign: 'right' };
        autoTable(doc, { startY, head, body, foot: foot || undefined, theme: 'plain',
          headStyles: { fontStyle: 'bold', fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { bottom: 0.3 }, lineColor: BLACK },
          bodyStyles: { fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { bottom: 0.15 }, lineColor: LGRAY },
          footStyles: { fontStyle: 'bold', fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { top: 0.3 }, lineColor: BLACK },
          columnStyles: colStyles, margin: { left: 14, right: 14 } });
      };

      // Cover
      let coverY = 20;
      try {
        const imgData = await this.loadImageAsBase64('Report-logo.jpeg');
        const imgProps = doc.getImageProperties(imgData);
        const logoWidth = pageWidth - 28;
        const logoHeight = (imgProps.height * logoWidth) / imgProps.width;
        doc.addImage(imgData, 'JPEG', (pageWidth - logoWidth) / 2, coverY, logoWidth, logoHeight);
        coverY += logoHeight + 12;
      } catch {}

      doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...BLACK);
      doc.text('LAYER FARM REPORT', pageWidth / 2, coverY, { align: 'center' }); coverY += 9;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(14); doc.setTextColor(...GRAY);
      doc.text(farmName, pageWidth / 2, coverY, { align: 'center' }); coverY += 7;
      doc.setFontSize(11); doc.text('Generated: ' + today, pageWidth / 2, coverY, { align: 'center' }); coverY += 8;
      doc.setDrawColor(...BLACK); doc.line(14, coverY, pageWidth - 14, coverY); coverY += 8;

      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...BLACK);
      doc.text('SUMMARY', 14, coverY); coverY += 6;
      const summary: [string, string][] = [
        ['Total Batches', String(this.batches.length)],
        ['Total Eggs Collected', this.totalEggs.toLocaleString()],
        ['Total Egg Sales', 'Rs. ' + this.totalEggSales.toLocaleString()],
        ['Total Mortality', this.totalMortality.toLocaleString()]
      ];
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      for (const [l, v] of summary) { doc.setTextColor(...GRAY); doc.text(l + ':', 14, coverY); doc.setTextColor(...BLACK); doc.text(v, 90, coverY); coverY += 6; }

      // Egg Collection
      if (this.eggCollections.length > 0) {
        doc.addPage();
        doc.setFontSize(8); doc.setTextColor(...GRAY); doc.text(farmName, 14, 9); doc.text(today, pageWidth - 14, 9, { align: 'right' });
        doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(...BLACK); doc.text('EGG COLLECTION', 14, 22);
        doc.setDrawColor(...BLACK); doc.line(14, 25, pageWidth - 14, 25);
        bwTable(30, [['Date', 'Batch', 'Total', 'Broken', 'Small', 'Medium', 'Large', 'XL']],
          this.eggCollections.map(e => [formatDate(e.date), e.batch_name, String(e.total_eggs), String(e.broken_eggs), String(e.small_grade), String(e.medium_grade), String(e.large_grade), String(e.xl_grade)]));
      }

      // Egg Sales
      if (this.eggSales.length > 0) {
        doc.addPage();
        doc.setFontSize(8); doc.setTextColor(...GRAY); doc.text(farmName, 14, 9); doc.text(today, pageWidth - 14, 9, { align: 'right' });
        doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(...BLACK); doc.text('EGG SALES', 14, 22);
        doc.setDrawColor(...BLACK); doc.line(14, 25, pageWidth - 14, 25);
        const body = this.eggSales.map(s => [formatDate(s.date), s.batch_name, s.customer_name || '—', s.grade, String(s.quantity), 'Rs. ' + (s.rate_per_egg || 0).toLocaleString(), 'Rs. ' + (s.total_amount || 0).toLocaleString()]);
        bwTable(30, [['Date', 'Batch', 'Customer', 'Grade', 'Qty', 'Rate', 'Amount']], body,
          [['', '', '', '', '', 'Total', 'Rs. ' + this.totalEggSales.toLocaleString()]], 6);
      }

      // Footer
      const totalPages = (doc.internal as any).getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
        doc.text(footer, pageWidth / 2, pageHeight - 9, { align: 'center' });
        doc.text('Page ' + i + ' of ' + totalPages, pageWidth / 2, pageHeight - 4, { align: 'center' });
      }

      doc.save(farmName + '-Layer-Report.pdf');
    } finally { this.isGenerating = false; this.cdr.detectChanges(); }
  }

  private loadImageAsBase64(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d')!.drawImage(img, 0, 0); resolve(c.toDataURL('image/jpeg')); };
      img.onerror = () => reject(new Error('Logo load failed'));
      img.src = url;
    });
  }
}