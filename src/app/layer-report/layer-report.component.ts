import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

@Component({
  selector: 'app-layer-report',
  standalone: true,
  imports: [CommonModule, FormsModule],
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

  sections = {
    eggCollection: true,
    eggSales: true,
    vaccinations: true,
    mortality: true,
    summary: true
  };

  private prefKey(): string { return 'layer_report_preferences_' + (this.batches[0]?.batch_id || 'default'); }

  private loadPreferences() {
    try {
      const stored = localStorage.getItem(this.prefKey());
      if (stored) this.sections = JSON.parse(stored);
    } catch {}
  }

  savePreferences() {
    try { localStorage.setItem(this.prefKey(), JSON.stringify(this.sections)); } catch {}
  }

  selectedBatchFilter: string = 'all';

  get filteredEggCollections() {
    if (this.selectedBatchFilter === 'all') return this.eggCollections;
    return this.eggCollections.filter(e => String(e.batch_id) === String(this.selectedBatchFilter));
  }
  get filteredEggSales() {
    if (this.selectedBatchFilter === 'all') return this.eggSales;
    return this.eggSales.filter(e => String(e.batch_id) === String(this.selectedBatchFilter));
  }
  get filteredVaccinations() {
    if (this.selectedBatchFilter === 'all') return this.vaccinations;
    return this.vaccinations.filter(e => String(e.batch_id) === String(this.selectedBatchFilter));
  }
  get filteredMortalities() {
    if (this.selectedBatchFilter === 'all') return this.mortalities;
    return this.mortalities.filter(e => String(e.batch_id) === String(this.selectedBatchFilter));
  }

  get totalEggs() { return this.filteredEggCollections.reduce((s: number, e: any) => s + (e.total_eggs || 0), 0); }
  get totalEggSales() { return this.filteredEggSales.reduce((s: number, e: any) => s + (e.total_amount || 0), 0); }
  get totalMortality() { return this.filteredMortalities.reduce((s: number, e: any) => s + (e.count || 0), 0); }

  constructor(private db: DatabaseService, private authService: AuthService, private cdr: ChangeDetectorRef) {}

  async ngOnInit() { this.currentFarm = this.authService.getCurrentFarm(); await this.loadData(); this.loadPreferences(); }

  async loadData() {
    const b = await this.db.get('SELECT * FROM batches WHERE farm_id=?', [this.currentFarm.farm_id]); this.batches = b.success ? b.data : [];
    const ec = await this.db.get('SELECT ec.*, b.batch_name FROM egg_collection ec JOIN batches b ON ec.batch_id=b.batch_id WHERE b.farm_id=? ORDER BY ec.date DESC', [this.currentFarm.farm_id]); this.eggCollections = ec.success ? ec.data : [];
    const es = await this.db.get('SELECT es.*, b.batch_name FROM egg_sales es JOIN batches b ON es.batch_id=b.batch_id WHERE b.farm_id=? ORDER BY es.date DESC', [this.currentFarm.farm_id]); this.eggSales = es.success ? es.data : [];
    const v = await this.db.get('SELECT v.*, b.batch_name FROM vaccinations v JOIN batches b ON v.batch_id=b.batch_id WHERE b.farm_id=? ORDER BY v.date DESC', [this.currentFarm.farm_id]); this.vaccinations = v.success ? v.data : [];
    const m = await this.db.get('SELECT m.*, b.batch_name FROM layer_mortality m JOIN batches b ON m.batch_id=b.batch_id WHERE b.farm_id=? ORDER BY m.date DESC', [this.currentFarm.farm_id]); this.mortalities = m.success ? m.data : [];
    this.cdr.detectChanges();
  }

  async generatePDF() {
    this.savePreferences();
    this.isGenerating = true;
    try {
      const doc = new jsPDF(); const pageWidth = doc.internal.pageSize.getWidth(); const pageHeight = doc.internal.pageSize.getHeight();
      const farmName = this.currentFarm?.farm_name || 'Poultry Farm'; const today = new Date().toLocaleDateString('en-PK');
      const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';
      const formatDate = (d: any) => { if (!d) return '—'; const p = String(d).split('T')[0].split(' ')[0].split('-'); return (p.length === 3 && p[0].length === 4) ? `${p[2]}-${p[1]}-${p[0]}` : String(d); };
      const BLACK: [number,number,number] = [0,0,0]; const GRAY: [number,number,number] = [120,120,120]; const LGRAY: [number,number,number] = [200,200,200];

      const bwTable = (startY: number, head: string[][], body: any[][], foot?: any[][], amountCol?: number) => {
        const colStyles: any = {}; if (amountCol !== undefined) colStyles[amountCol] = { halign: 'right' };
        autoTable(doc, { startY, head, body, foot: foot || undefined, theme: 'plain', headStyles: { fontStyle: 'bold', fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { bottom: 0.3 }, lineColor: BLACK }, bodyStyles: { fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { bottom: 0.15 }, lineColor: LGRAY }, footStyles: { fontStyle: 'bold', fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { top: 0.3 }, lineColor: BLACK }, columnStyles: colStyles, margin: { left: 14, right: 14 } });
      };

      // Cover
      let coverY = 20;

      // Logo — left side, text on right
      try {
        const imgData = await this.loadImageAsBase64('report-boiler.jpeg');
        const imgProps = doc.getImageProperties(imgData);
        const logoHeight = 35;
        const logoWidth = (imgProps.width * logoHeight) / imgProps.height;
        const textX = 14 + logoWidth + 10;
        doc.addImage(imgData, 'JPEG', 14, coverY, logoWidth, logoHeight);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...BLACK);
        doc.text('LAYER FARM REPORT', textX, coverY + 8);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(...GRAY);
        doc.text(farmName, textX, coverY + 16);
        doc.setFontSize(10);
        doc.text('Generated: ' + today, textX, coverY + 23);
        coverY += logoHeight + 8;
      } catch {}

      doc.setDrawColor(...BLACK); doc.setLineWidth(0.5); doc.line(14, coverY, pageWidth - 14, coverY); coverY += 8;

      if (this.sections.summary) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...BLACK);
        doc.text('SUMMARY', 14, coverY); coverY += 6;
        const batchLabel = this.selectedBatchFilter === 'all'
          ? String(this.batches.length)
          : (this.batches.find(b => String(b.batch_id) === String(this.selectedBatchFilter))?.batch_name || '1');
        const summary: [string, string][] = [
          [this.selectedBatchFilter === 'all' ? 'Total Batches' : 'Batch', batchLabel],
          ['Total Eggs Collected', this.totalEggs.toLocaleString()],
          ['Total Egg Sales', 'Rs. ' + this.totalEggSales.toLocaleString()],
          ['Total Mortality', this.totalMortality.toLocaleString()]
        ];
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
        for (const [l, v] of summary) { doc.setTextColor(...GRAY); doc.text(l + ':', 14, coverY); doc.setTextColor(...BLACK); doc.text(v, 90, coverY); coverY += 6; }
      }

      // Egg Collection
      if (this.sections.eggCollection && this.filteredEggCollections.length > 0) {
        doc.addPage(); doc.setFontSize(8); doc.setTextColor(...GRAY); doc.text(farmName, 14, 9); doc.text(today, pageWidth - 14, 9, { align: 'right' });
        doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(...BLACK); doc.text('EGG COLLECTION', 14, 22); doc.setDrawColor(...BLACK); doc.line(14, 25, pageWidth - 14, 25);
        bwTable(30, [['Date', 'Batch', 'Total', 'Broken', 'Small', 'Medium', 'Large', 'XL']], this.filteredEggCollections.map(e => [formatDate(e.date), e.batch_name, String(e.total_eggs), String(e.broken_eggs), String(e.small_grade), String(e.medium_grade), String(e.large_grade), String(e.xl_grade)]));
      }

      // Egg Sales
      if (this.sections.eggSales && this.filteredEggSales.length > 0) {
        doc.addPage(); doc.setFontSize(8); doc.setTextColor(...GRAY); doc.text(farmName, 14, 9); doc.text(today, pageWidth - 14, 9, { align: 'right' });
        doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(...BLACK); doc.text('EGG SALES', 14, 22); doc.setDrawColor(...BLACK); doc.line(14, 25, pageWidth - 14, 25);
        const body = this.filteredEggSales.map(s => [formatDate(s.date), s.batch_name, s.customer_name || '—', s.grade, String(s.quantity), 'Rs. ' + (s.rate_per_egg || 0).toLocaleString(), 'Rs. ' + (s.total_amount || 0).toLocaleString()]);
        bwTable(30, [['Date', 'Batch', 'Customer', 'Grade', 'Qty', 'Rate', 'Amount']], body, [['', '', '', '', '', 'Total', 'Rs. ' + this.totalEggSales.toLocaleString()]], 6);
      }

      // Vaccinations
      if (this.sections.vaccinations && this.filteredVaccinations.length > 0) {
        // Not yet implemented in PDF
      }

      // Mortality
      if (this.sections.mortality && this.filteredMortalities.length > 0) {
        // Not yet implemented in PDF
      }

      // Footer
      const totalPages = (doc.internal as any).getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(...GRAY); doc.text(footer, pageWidth / 2, pageHeight - 9, { align: 'center' }); doc.text('Page ' + i + ' of ' + totalPages, pageWidth / 2, pageHeight - 4, { align: 'center' }); }

      doc.save(farmName + '-Layer-Report.pdf');
    } finally { this.isGenerating = false; this.cdr.detectChanges(); }
  }

  private loadImageAsBase64(url: string): Promise<string> {
    return new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d')!.drawImage(img, 0, 0); resolve(c.toDataURL('image/jpeg')); }; img.onerror = () => reject(new Error('Logo load failed')); img.src = url; });
  }
}