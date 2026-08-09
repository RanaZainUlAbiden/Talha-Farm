import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { FlockService } from '../shared/services/flock.service';
import { Subscription } from 'rxjs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

@Component({
  selector: 'app-layer-report',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './layer-report.component.html',
  styleUrl: './layer-report.component.scss'
})
export class LayerReportComponent implements OnInit, OnDestroy {
  currentFarm: any = null;
  batches: any[] = [];
  eggCollections: any[] = [];
  eggSales: any[] = [];
  vaccinations: any[] = [];
  mortalities: any[] = [];
  expenses: any[] = [];
  medicineTraders: any[] = [];
  medicineEntries: any[] = [];
  feedTraders: any[] = [];
  feedEntries: any[] = [];
  income: any[] = [];
  isGenerating = false;
  private subs = new Subscription();

  sections = {
    eggCollection: true,
    eggSales: true,
    expenses: true,
    medicine: true,
    feed: true,
    vaccinations: true,
    mortality: true,
    income: true,
    summary: true
  };

  selectedBatchFilter: string = 'all';

  private prefKey(): string {
    const batchId = this.selectedBatchFilter !== 'all' ? this.selectedBatchFilter : (this.batches[0]?.batch_id || 'default');
    return 'layer_report_preferences_' + batchId;
  }

  private loadPreferences() {
    try {
      const stored = localStorage.getItem(this.prefKey());
      if (stored) this.sections = { ...this.sections, ...JSON.parse(stored) };
    } catch {}
  }

  savePreferences() {
    try { localStorage.setItem(this.prefKey(), JSON.stringify(this.sections)); } catch {}
  }

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
  get filteredExpenses() {
    if (this.selectedBatchFilter === 'all') return this.expenses;
    return this.expenses.filter(e => String(e.flock_id) === String(this.selectedBatchFilter));
  }
  get filteredMedicineEntries() {
    if (this.selectedBatchFilter === 'all') return this.medicineEntries;
    return this.medicineEntries.filter(e => String(e.flock_id) === String(this.selectedBatchFilter));
  }
  get filteredFeedEntries() {
    if (this.selectedBatchFilter === 'all') return this.feedEntries;
    return this.feedEntries.filter(e => String(e.flock_id) === String(this.selectedBatchFilter));
  }
  get filteredIncome() {
    if (this.selectedBatchFilter === 'all') return this.income;
    return this.income.filter(e => String(e.flock_id) === String(this.selectedBatchFilter));
  }

  get totalEggs() { return this.filteredEggCollections.reduce((s: number, e: any) => s + (e.total_eggs || 0), 0); }
  get totalEggSales() { return this.filteredEggSales.reduce((s: number, e: any) => s + (e.total_amount || 0), 0); }
  get totalMortality() { return this.filteredMortalities.reduce((s: number, e: any) => s + (e.count || 0), 0); }
  get totalExpenses() { return this.filteredExpenses.reduce((s: number, e: any) => s + (e.amount || 0), 0); }
  get totalMedicineAmount() { return this.filteredMedicineEntries.reduce((s: number, e: any) => s + (e.total_amount || 0), 0); }
  get totalFeedAmount() { return this.filteredFeedEntries.reduce((s: number, e: any) => s + (e.total_amount || 0), 0); }
  get totalIncome() { return this.filteredIncome.reduce((s: number, e: any) => s + (e.amount || 0), 0); }
  get netProfitLoss() { return (this.totalEggSales + this.totalIncome) - (this.totalFeedAmount + this.totalMedicineAmount + this.totalExpenses); }

  getMedicineTraderEntries(traderId: number): any[] {
    return this.filteredMedicineEntries.filter(e => e.trader_id === traderId);
  }
  getMedicineTraderTotal(traderId: number): number {
    return this.getMedicineTraderEntries(traderId).reduce((s, e) => s + (e.total_amount || 0), 0);
  }
  getFeedTraderEntries(traderId: number): any[] {
    return this.filteredFeedEntries.filter(e => e.trader_id === traderId);
  }
  getFeedTraderTotal(traderId: number): number {
    return this.getFeedTraderEntries(traderId).reduce((s, e) => s + (e.total_amount || 0), 0);
  }

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef,
    private flockService: FlockService
  ) {}

  async ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    await this.loadData();
    this.applyActiveBatch(this.flockService.getCurrentFlock());
    this.loadPreferences();
    this.subs.add(
      this.flockService.currentFlock$.subscribe(flock => this.applyActiveBatch(flock))
    );
  }

  ngOnDestroy() { this.subs.unsubscribe(); }

  private applyActiveBatch(flock: any) {
    if (!flock?.batch_id) return;
    const batchId = String(flock.batch_id);
    if (this.selectedBatchFilter === batchId) return;
    this.selectedBatchFilter = batchId;
    this.loadPreferences();
    this.cdr.detectChanges();
  }

  async loadData() {
    if (!this.currentFarm) return;
    const farmId = this.currentFarm.farm_id;

    const [batches, eggColl, eggSale, vacc, mort, exp, medT, medE, feedT, feedE, inc] = await Promise.all([
      this.db.get('SELECT * FROM batches WHERE farm_id = ? ORDER BY batch_id DESC', [farmId]),
      this.db.get('SELECT ec.*, b.batch_name FROM egg_collection ec JOIN batches b ON ec.batch_id = b.batch_id WHERE b.farm_id = ? ORDER BY ec.date DESC', [farmId]),
      this.db.get('SELECT es.*, b.batch_name FROM egg_sales es JOIN batches b ON es.batch_id = b.batch_id WHERE b.farm_id = ? ORDER BY es.date DESC', [farmId]),
      this.db.get('SELECT v.*, b.batch_name FROM vaccinations v JOIN batches b ON v.batch_id = b.batch_id WHERE b.farm_id = ? ORDER BY v.date DESC', [farmId]),
      this.db.get('SELECT lm.*, b.batch_name FROM layer_mortality lm JOIN batches b ON lm.batch_id = b.batch_id WHERE b.farm_id = ? ORDER BY lm.date DESC', [farmId]),
      this.db.get('SELECT e.*, b.batch_name FROM expenses e JOIN batches b ON e.flock_id = b.batch_id WHERE b.farm_id = ? AND e.module_type = ? ORDER BY e.date DESC', [farmId, 'layer']),
      this.db.get('SELECT * FROM medicine_traders WHERE flock_id IN (SELECT batch_id FROM batches WHERE farm_id = ?) AND module_type = ?', [farmId, 'layer']),
      this.db.get('SELECT me.*, mt.trader_name, b.batch_name FROM medicine_entries me JOIN medicine_traders mt ON me.trader_id = mt.trader_id JOIN batches b ON me.flock_id = b.batch_id WHERE b.farm_id = ? AND me.module_type = ? ORDER BY me.date DESC', [farmId, 'layer']),
      this.db.get('SELECT * FROM feed_traders WHERE flock_id IN (SELECT batch_id FROM batches WHERE farm_id = ?) AND module_type = ?', [farmId, 'layer']),
      this.db.get('SELECT fe.*, ft.trader_name, b.batch_name FROM feed_entries fe JOIN feed_traders ft ON fe.trader_id = ft.trader_id JOIN batches b ON fe.flock_id = b.batch_id WHERE b.farm_id = ? AND fe.module_type = ? ORDER BY fe.date DESC', [farmId, 'layer']),
      this.db.get('SELECT i.*, b.batch_name FROM income i JOIN batches b ON i.flock_id = b.batch_id WHERE b.farm_id = ? AND i.module_type = ? ORDER BY i.date DESC', [farmId, 'layer'])
    ]);

    this.batches = batches.success ? batches.data : [];
    this.eggCollections = eggColl.success ? eggColl.data : [];
    this.eggSales = eggSale.success ? eggSale.data : [];
    this.vaccinations = vacc.success ? vacc.data : [];
    this.mortalities = mort.success ? mort.data : [];
    this.expenses = exp.success ? exp.data : [];
    this.medicineTraders = medT.success ? medT.data : [];
    this.medicineEntries = medE.success ? medE.data : [];
    this.feedTraders = feedT.success ? feedT.data : [];
    this.feedEntries = feedE.success ? feedE.data : [];
    this.income = inc.success ? inc.data : [];
    this.cdr.detectChanges();
  }

  async generatePDF() {
    this.isGenerating = true;
    this.savePreferences();

    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const farmName = this.currentFarm?.farm_name || 'Poultry Farm';
      const today = new Date().toLocaleDateString('en-PK');
      const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';
      const formatDate = (d: any) => { if (!d) return '—'; const p = String(d).split('T')[0].split(' ')[0].split('-'); return (p.length === 3 && p[0].length === 4) ? `${p[2]}-${p[1]}-${p[0]}` : String(d); };
      const BLACK: [number,number,number] = [0,0,0];
      const GRAY: [number,number,number] = [120,120,120];
      const LGRAY: [number,number,number] = [200,200,200];

      // Background image
      let bgImgData: string | null = null;
      let bgW = 0; let bgH = 0;
      try {
        bgImgData = await this.loadImageAsBase64('reportimage.png');
        const bgProps = doc.getImageProperties(bgImgData);
        bgW = 140;
        bgH = (bgProps.height * bgW) / bgProps.width;
      } catch {}

      const drawBackground = () => {
        if (bgImgData) {
          doc.saveGraphicsState();
          doc.setGState(new (doc as any).GState({ opacity: 0.08 }));
          doc.addImage(bgImgData, 'PNG', (pageWidth - bgW) / 2, (pageHeight - bgH) / 2, bgW, bgH);
          doc.restoreGraphicsState();
        }
      };

      // BW table helper
      const bwTable = (startY: number, head: string[][], body: any[][], foot?: any[][], amountCol?: number) => {
        const colStyles: any = {};
        if (amountCol !== undefined) colStyles[amountCol] = { halign: 'right' };
        autoTable(doc, {
          startY,
          head,
          body,
          foot: foot || undefined,
          theme: 'plain',
          headStyles: { fontStyle: 'bold', fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { bottom: 0.3 }, lineColor: BLACK },
          bodyStyles: { fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { bottom: 0.15 }, lineColor: LGRAY },
          footStyles: { fontStyle: 'bold', fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { top: 0.3 }, lineColor: BLACK },
          alternateRowStyles: { fillColor: false as any },
          columnStyles: colStyles,
          margin: { left: 14, right: 14 }
        });
        return (doc as any).lastAutoTable.finalY;
      };

      let isFirstSection = true;
      let y = 0;

      const addPage = (title: string) => {
        if (isFirstSection || (pageHeight - y) < 80) {
          doc.addPage();
          drawBackground();
          doc.setDrawColor(...LGRAY);
          doc.setLineWidth(0.3);
          doc.line(14, 12, pageWidth - 14, 12);
          doc.setFontSize(8);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(...GRAY);
          doc.text(farmName, 14, 9);
          doc.text(today, pageWidth - 14, 9, { align: 'right' });
          y = 22;
        } else {
          y += 12;
        }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...BLACK);
        doc.text(title.toUpperCase(), 14, y);
        doc.setDrawColor(...BLACK);
        doc.setLineWidth(0.4);
        doc.line(14, y + 3, pageWidth - 14, y + 3);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...BLACK);
        y += 8;
        isFirstSection = false;
      };

      // Cover page
      let coverY = 20;
      drawBackground();

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

      // Summary
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
          ['Other Income', 'Rs. ' + this.totalIncome.toLocaleString()],
          ['Expenses', 'Rs. ' + this.totalExpenses.toLocaleString()],
          ['Medicine Cost', 'Rs. ' + this.totalMedicineAmount.toLocaleString()],
          ['Total Feed Cost', 'Rs. ' + this.totalFeedAmount.toLocaleString()],
          ['Total Mortality', this.totalMortality.toLocaleString()],
          [this.netProfitLoss >= 0 ? 'Net Profit' : 'Net Loss', 'Rs. ' + Math.abs(this.netProfitLoss).toLocaleString()]
        ];
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
        for (const [l, v] of summary) { doc.setTextColor(...GRAY); doc.text(l + ':', 14, coverY); doc.setTextColor(...BLACK); doc.text(v, 90, coverY); coverY += 6; }
      }

      // Egg Collection
      if (this.sections.eggCollection && this.filteredEggCollections.length > 0) {
        addPage('Egg Collection');
        y = bwTable(y, [['Date', 'Batch', 'Total', 'Broken', 'Small', 'Medium', 'Large', 'XL']],
          this.filteredEggCollections.map(e => [formatDate(e.date), e.batch_name, String(e.total_eggs), String(e.broken_eggs), String(e.small_grade), String(e.medium_grade), String(e.large_grade), String(e.xl_grade)]));
      }

      // Egg Sales
      if (this.sections.eggSales && this.filteredEggSales.length > 0) {
        addPage('Egg Sales');
        const body = this.filteredEggSales.map(s => [formatDate(s.date), s.batch_name, s.customer_name || '—', s.grade, String(s.quantity), 'Rs. ' + (s.rate_per_egg || 0).toLocaleString(), 'Rs. ' + (s.total_amount || 0).toLocaleString()]);
        y = bwTable(y, [['Date', 'Batch', 'Customer', 'Grade', 'Qty', 'Rate', 'Amount']], body, [['', '', '', '', '', 'Total', 'Rs. ' + this.totalEggSales.toLocaleString()]], 6);
      }

      // Expenses
      if (this.sections.expenses && this.filteredExpenses.length > 0) {
        addPage('Expenses');
        y = bwTable(y, [['Date', 'Batch', 'Description', 'Amount (Rs.)']],
          this.filteredExpenses.map(e => [formatDate(e.date), e.batch_name || 'N/A', e.description || 'N/A', (e.amount || 0).toLocaleString()]),
          [['', '', 'Total', this.totalExpenses.toLocaleString()]], 3);
      }

      // Medicine
      if (this.sections.medicine && this.medicineTraders.length > 0) {
        for (const trader of this.medicineTraders) {
          const entries = this.getMedicineTraderEntries(trader.trader_id);
          if (entries.length === 0) continue;
          addPage(`Medicine: ${trader.trader_name}`);
          y = bwTable(y, [['Date', 'Batch', 'Medicine', 'Qty', 'Price/Unit (Rs.)', 'Total (Rs.)']],
            entries.map(e => [formatDate(e.date), e.batch_name || 'N/A', e.medicine_name || 'N/A', e.quantity, (e.price_per_unit || 0).toLocaleString(), (e.total_amount || 0).toLocaleString()]),
            [['', '', '', '', 'Total', this.getMedicineTraderTotal(trader.trader_id).toLocaleString()]], 5);
        }
      }

      // Feed
      if (this.sections.feed && this.feedTraders.length > 0) {
        for (const trader of this.feedTraders) {
          const entries = this.getFeedTraderEntries(trader.trader_id);
          if (entries.length === 0) continue;
          addPage(`Feed: ${trader.trader_name}`);
          y = bwTable(y, [['Date', 'Feed', 'Qty', 'Price/Unit (Rs.)', 'Total (Rs.)']],
            entries.map(e => [formatDate(e.date), e.feed_name || '—', e.quantity, (e.price_per_unit || 0).toLocaleString(), (e.total_amount || 0).toLocaleString()]),
            [['', '', '', 'Total', this.getFeedTraderTotal(trader.trader_id).toLocaleString()]], 4);
        }
      }

      // Vaccinations
      if (this.sections.vaccinations && this.filteredVaccinations.length > 0) {
        addPage('Vaccinations');
        y = bwTable(y, [['Date', 'Batch', 'Vaccine', 'Dose', 'Notes', 'Done']],
          this.filteredVaccinations.map(v => [formatDate(v.date), v.batch_name, v.vaccine_name || '—', v.dose || '—', v.notes || '—', v.done ? 'Yes' : 'No']));
      }

      // Mortality
      if (this.sections.mortality && this.filteredMortalities.length > 0) {
        addPage('Mortality');
        y = bwTable(y, [['Date', 'Batch', 'Count', 'Reason']],
          this.filteredMortalities.map(m => [formatDate(m.date), m.batch_name, String(m.count), m.reason || '—']),
          [['', '', String(this.totalMortality), 'Total']], 2);
      }

      // Income
      if (this.sections.income && this.filteredIncome.length > 0) {
        addPage('Income');
        y = bwTable(y, [['Date', 'Batch', 'Description', 'Source', 'Amount (Rs.)']],
          this.filteredIncome.map(i => [formatDate(i.date), i.batch_name || 'N/A', i.description || 'N/A', i.source === 'egg_sale' ? 'Egg Sale' : 'Manual', (i.amount || 0).toLocaleString()]),
          [['', '', '', 'Total', this.totalIncome.toLocaleString()]], 4);
      }

      // Footer
      const totalPages = (doc.internal as any).getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7.5);
        doc.setTextColor(...GRAY);
        doc.text(footer, pageWidth / 2, pageHeight - 9, { align: 'center' });
        doc.text('Page ' + i + ' of ' + totalPages, pageWidth / 2, pageHeight - 4, { align: 'center' });
      }

      doc.save(farmName + '-Layer-Report.pdf');
    } finally { this.isGenerating = false; this.cdr.detectChanges(); }
  }

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
