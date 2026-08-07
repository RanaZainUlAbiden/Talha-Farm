import { Component, OnInit, OnDestroy, ChangeDetectorRef , ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { FlockService } from '../shared/services/flock.service';
import { AuthService } from '../shared/services/auth.service';
import { DatabaseService } from '../shared/services/database.service';
import { Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-report',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './report.component.html',
  styleUrl: './report.component.scss'
})
export class ReportComponent implements OnInit, OnDestroy {
  currentFlock: any = null;
  currentFarm: any = null;
  logoUrl: string | null = null;
  expenses: any[] = [];
  ledgers: any[] = [];
  ledgerEntries: any[] = [];
  traders: any[] = [];
  medicineEntries: any[] = [];
  feedTraders: any[] = [];
  feedEntries: any[] = [];
  vaccinations: any[] = [];
  sales: any[] = [];
  income: any[] = [];
  health: any[] = [];
  isGenerating = false;
  private subs = new Subscription();
  private reportLoadToken = 0;

  // ── Section selection ──────────────────────────────────────
  sections = {
    expenses: true,
    ledgers: true,
    medicine: true,
    feed: true,
    vaccinations: true,
    sales: true,
    income: true,
    health: true,
    profitLoss: true
  };

  // ── Computed ─────────────────────────────────────────────────
  get totalExpenses(): number {
    return this.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  }
  get totalIncome(): number {
    return this.income.reduce((s, i) => s + (i.amount || 0), 0);
  }
  get totalSaleWeight(): number {
    return this.sales.reduce((s, sale) => s + (sale.bird_weight || 0), 0);
  }
  get totalSaleAmount(): number {
    return this.sales.reduce((s, sale) => s + (sale.total_amount || 0), 0);
  }
  get profitLoss(): number {
    return this.totalIncome - this.totalExpenses;
  }

  constructor(
    private flockService: FlockService,
    private authService: AuthService,
    private db: DatabaseService,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    const resolved = this.route.snapshot.data['data'];
    if (resolved) {
      this.currentFlock     = resolved.flock;
      this.logoUrl          = resolved.logoUrl || 'report-boiler.jpeg';
      this.expenses         = resolved.expenses         || [];
      this.ledgers          = resolved.ledgers          || [];
      this.ledgerEntries    = resolved.ledgerEntries    || [];
      this.traders          = resolved.traders          || [];
      this.medicineEntries  = resolved.medicineEntries  || [];
      this.feedTraders      = resolved.feedTraders      || [];
      this.feedEntries      = resolved.feedEntries      || [];
      this.vaccinations     = resolved.vaccinations     || [];
      this.sales            = resolved.sales            || [];
      this.income           = resolved.income           || [];
      this.health           = resolved.health           || [];
    }

    this.loadPreferences();

    this.subs.add(
      this.flockService.currentFlock$.pipe(skip(1)).subscribe(flock => {
        if (flock) {
          this.currentFlock = flock;
          this.loadPreferences();
          this.loadData();
        }
      })
    );
  }

  ngOnDestroy() { this.subs.unsubscribe(); }

  async loadData() {
    const loadToken = ++this.reportLoadToken;
    if (!this.currentFlock?.flock_id) {
      this.expenses = [];
      this.ledgers = [];
      this.ledgerEntries = [];
      this.traders = [];
      this.medicineEntries = [];
      this.feedTraders = [];
      this.feedEntries = [];
      this.vaccinations = [];
      this.sales = [];
      this.income = [];
      this.health = [];
      this.cdr.detectChanges();
      return;
    }

    const flockId = this.currentFlock.flock_id;
    const [
      expenses,
      ledgers,
      ledgerEntries,
      traders,
      medicineEntries,
      feedTraders,
      feedEntries,
      vaccinations,
      sales,
      income,
      health
    ] = await Promise.all([
      this.db.get(
        `SELECT e.*, l.ledger_name FROM expenses e
         LEFT JOIN ledgers l ON e.ledger_id = l.ledger_id
         WHERE e.flock_id = ? ORDER BY e.date ASC`,
        [flockId]
      ),
      this.db.get(
        `SELECT * FROM ledgers WHERE flock_id = ?
         ORDER BY ledger_name ASC`,
        [flockId]
      ),
      this.db.get(
        `SELECT le.*, l.ledger_name FROM ledger_entries le
         JOIN ledgers l ON le.ledger_id = l.ledger_id
         WHERE le.flock_id = ? ORDER BY le.date ASC`,
        [flockId]
      ),
      this.db.get(
        `SELECT * FROM medicine_traders WHERE flock_id = ?
         ORDER BY trader_name ASC`,
        [flockId]
      ),
      this.db.get(
        `SELECT me.*, mt.trader_name FROM medicine_entries me
         JOIN medicine_traders mt ON me.trader_id = mt.trader_id
         WHERE me.flock_id = ? ORDER BY me.date ASC`,
        [flockId]
      ),
      this.db.get(
        `SELECT * FROM feed_traders WHERE flock_id = ? ORDER BY trader_name ASC`,
        [flockId]
      ),
      this.db.get(
        `SELECT fe.*, ft.trader_name FROM feed_entries fe
         JOIN feed_traders ft ON fe.trader_id = ft.trader_id
         WHERE fe.flock_id = ? ORDER BY fe.date ASC`,
        [flockId]
      ),
      this.db.get(
        `SELECT * FROM vaccinations WHERE flock_id = ? ORDER BY date ASC`,
        [flockId]
      ),
      this.db.get(
        `SELECT * FROM sales WHERE flock_id = ?
         ORDER BY date ASC`,
        [flockId]
      ),
      this.db.get(
        `SELECT * FROM income WHERE flock_id = ? AND module_type = 'broiler'
         ORDER BY date ASC`,
        [flockId]
      ),
      this.db.get(
        `SELECT * FROM flock_health WHERE flock_id = ?
         ORDER BY week_number ASC`,
        [flockId]
      )
    ]);

    if (loadToken !== this.reportLoadToken) return;

    this.expenses = expenses.success ? expenses.data : [];
    this.ledgers = ledgers.success ? ledgers.data : [];
    this.ledgerEntries = ledgerEntries.success ? ledgerEntries.data : [];
    this.traders = traders.success ? traders.data : [];
    this.medicineEntries = medicineEntries.success ? medicineEntries.data : [];
    this.feedTraders = feedTraders.success ? feedTraders.data : [];
    this.feedEntries = feedEntries.success ? feedEntries.data : [];
    this.vaccinations = vaccinations.success ? vaccinations.data : [];
    this.sales = sales.success ? sales.data : [];
    this.income = income.success ? income.data : [];
    this.health = health.success ? health.data : [];
    this.cdr.detectChanges();
  }

  // ── Preferences ───────────────────────────────────────────
  private prefKey(): string {
    return `report_preferences_${this.currentFlock?.flock_id || 'default'}`;
  }

  private loadPreferences() {
    try {
      const raw = localStorage.getItem(this.prefKey());
      if (raw) {
        const saved = JSON.parse(raw);
        this.sections = { ...this.sections, ...saved };
      }
    } catch {}
  }

  savePreferences() {
    try {
      localStorage.setItem(this.prefKey(), JSON.stringify(this.sections));
    } catch {}
  }

  // ── Helpers ───────────────────────────────────────────────
  getLedgerEntries(ledgerId: number): any[] {
    return this.ledgerEntries.filter(e => e.ledger_id === ledgerId);
  }
  getLedgerTotal(ledgerId: number): number {
    return this.getLedgerEntries(ledgerId).reduce((s, e) => s + (e.amount || 0), 0);
  }
  getTraderEntries(traderId: number): any[] {
    return this.medicineEntries.filter(e => e.trader_id === traderId);
  }
  getTraderTotal(traderId: number): number {
    return this.getTraderEntries(traderId).reduce((s, e) => s + (e.total_amount || 0), 0);
  }
  getFeedTraderEntries(traderId: number): any[] {
    return this.feedEntries.filter(e => e.trader_id === traderId);
  }
  getFeedTraderTotal(traderId: number): number {
    return this.getFeedTraderEntries(traderId).reduce((s, e) => s + (e.total_amount || 0), 0);
  }

  // ── PDF Generation ────────────────────────────────────────
  async generatePDF() {
    this.isGenerating = true;
    this.savePreferences();

    try {
      const doc        = new jsPDF();
      const pageWidth  = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const flockName  = this.currentFlock?.flock_name || 'Unknown Flock';
      const farmName   = this.currentFarm?.farm_name   || 'Poultry Farm';
      const today      = new Date().toLocaleDateString('en-PK');
      const footer     = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';
      const formatDate = (d: any) => {
        if (!d) return '—';
        const p = String(d).split('T')[0].split(' ')[0].split('-');
        return (p.length === 3 && p[0].length === 4) ? `${p[2]}-${p[1]}-${p[0]}` : String(d);
      };

      const BLACK: [number,number,number]       = [0,   0,   0  ];
      const GRAY:  [number,number,number]       = [120, 120, 120];
      const LGRAY: [number,number,number]       = [200, 200, 200];

      // ── BW table style ───────────────────────────────────
      const bwTable = (startY: number, head: string[][], body: any[][], foot?: any[][], amountCol?: number, extraColumnStyles: any = {}) => {
        const colStyles: any = { ...extraColumnStyles };
        if (amountCol !== undefined) {
          colStyles[amountCol] = { ...(colStyles[amountCol] || {}), halign: 'right' };
        }
        autoTable(doc, {
          startY,
          head,
          body,
          foot: foot || undefined,
          theme: 'plain',
          headStyles: {
            fontStyle: 'bold',
            fontSize: 9,
            textColor: BLACK,
            fillColor: false as any,
            lineWidth: { bottom: 0.3 },
            lineColor: BLACK
          },
          bodyStyles: {
            fontSize: 9,
            textColor: BLACK,
            fillColor: false as any,
            lineWidth: { bottom: 0.15 },
            lineColor: LGRAY
          },
          footStyles: {
            fontStyle: 'bold',
            fontSize: 9,
            textColor: BLACK,
            fillColor: false as any,
            lineWidth: { top: 0.3 },
            lineColor: BLACK
          },
          alternateRowStyles: { fillColor: false as any },
          columnStyles: colStyles,
          margin: { left: 14, right: 14 }
        });
        y = (doc as any).lastAutoTable.finalY;
      };

      // ── Footer helper ─────────────────────────────────────
      const drawFooter = (pageNum: number, totalPagesRef: { val: number }) => {
        doc.setPage(pageNum);
        doc.setFontSize(7.5);
        doc.setTextColor(...GRAY);
        doc.setFont('helvetica', 'normal');
        doc.text(footer, pageWidth / 2, pageHeight - 9, { align: 'center' });
        doc.setDrawColor(...LGRAY);
        doc.setLineWidth(0.2);
        doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
        doc.setTextColor(...GRAY);
        doc.text(`Page ${pageNum} of ${totalPagesRef.val}`, pageWidth / 2, pageHeight - 4, { align: 'center' });
      };

      // ── Background helper ─────────────────────────────────
      let bgImgData: string | null = null;
      let bgW = 0; let bgH = 0;
      try {
        bgImgData = await this.loadImageAsBase64('reportimage.png');
        const bgProps = doc.getImageProperties(bgImgData);
        bgW = 140; // a little large
        bgH = (bgProps.height * bgW) / bgProps.width;
      } catch {}

      const drawBackground = () => {
        if (bgImgData) {
          doc.saveGraphicsState();
          doc.setGState(new (doc as any).GState({ opacity: 0.1 }));
          doc.addImage(bgImgData, 'PNG', (pageWidth - bgW) / 2, (pageHeight - bgH) / 2, bgW, bgH);
          doc.restoreGraphicsState();
        }
      };

      // Draw background on first page
      drawBackground();

      // ════════════════════════════════════════════════════════
      // COVER PAGE
      // ════════════════════════════════════════════════════════
      let coverY = 20;

      // Logo
  // Logo — left side, text on right
try {
  const imgData = await this.loadImageAsBase64(this.logoUrl || 'report-boiler.jpeg');
  const imgProps = doc.getImageProperties(imgData);
  const logoHeight = 35;
  const logoWidth = (imgProps.width * logoHeight) / imgProps.height;
  const textX = 14 + logoWidth + 10;

  doc.addImage(imgData, 'JPEG', 14, coverY, logoWidth, logoHeight);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...BLACK);
  doc.text('FARM REPORT', textX, coverY + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(...GRAY);
  doc.text(farmName, textX, coverY + 16);

  doc.setFontSize(10);
  doc.text('Flock: ' + flockName, textX, coverY + 23);
  doc.text('Generated: ' + today, textX, coverY + 30);

  coverY += logoHeight + 8;
} catch {}

// Line below logo section
doc.setDrawColor(...BLACK);
doc.setLineWidth(0.5);
doc.line(14, coverY, pageWidth - 14, coverY);
coverY += 8;

     

      // Summary block
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...BLACK);
      doc.text('SUMMARY', 14, coverY);
      coverY += 6;

      const summaryLines: [string, string][] = [
        ['Total Income',     `Rs. ${this.totalIncome.toLocaleString()}`],
        ['Total Expenses',   `Rs. ${this.totalExpenses.toLocaleString()}`],
        [this.profitLoss >= 0 ? 'Net Profit' : 'Net Loss',
                             `Rs. ${Math.abs(this.profitLoss).toLocaleString()}`],
        ['Total Weight Sold',`${this.totalSaleWeight.toFixed(0)} kg`],
        ['Total Sale Amount',`Rs. ${this.totalSaleAmount.toLocaleString()}`],
        ['Health Records',   `${this.health.length} day${this.health.length === 1 ? '' : 's'}`]
      ];

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      for (const [label, value] of summaryLines) {
        doc.setTextColor(...GRAY);
        doc.text(label + ':', 14, coverY);
        doc.setTextColor(...BLACK);
        doc.text(value, 90, coverY);
        coverY += 6;
      }

      // ════════════════════════════════════════════════════════
      // addPage helper
      // ════════════════════════════════════════════════════════
      let y = 0;
      let isFirstSection = true;

      const addPage = (title: string) => {
        if (isFirstSection || (pageHeight - y) < 80) {
          doc.addPage();
          drawBackground();
          // Thin top border line
          doc.setDrawColor(...LGRAY);
          doc.setLineWidth(0.3);
          doc.line(14, 12, pageWidth - 14, 12);

          // Header text
          doc.setFontSize(8);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(...GRAY);
          doc.text(farmName, 14, 9);
          doc.text(flockName, pageWidth / 2, 9, { align: 'center' });
          doc.text(today, pageWidth - 14, 9, { align: 'right' });

          y = 22;
        } else {
          y += 12; // gap between sections on the same page
        }

        // Section title
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

      // ════════════════════════════════════════════════════════
      // EXPENSES
      // ════════════════════════════════════════════════════════
      if (this.sections.expenses && this.expenses.length > 0) {
        addPage('Expenses');
        bwTable(
          y,
          [['Date', 'Ledger', 'Description', 'Amount (Rs.)']],
          this.expenses.map(e => [
            formatDate(e.date),
            e.ledger_name || '—',
            e.description || '—',
            (e.amount || 0).toLocaleString()
          ]),
          [['', '', 'Total', this.totalExpenses.toLocaleString()]],
          3
        );
      }

      // ════════════════════════════════════════════════════════
      // LEDGER PAGES
      // ════════════════════════════════════════════════════════
      if (this.sections.ledgers) {
        for (const ledger of this.ledgers) {
          const entries = this.getLedgerEntries(ledger.ledger_id);
          if (entries.length === 0) continue;
          addPage(`Ledger: ${ledger.ledger_name}`);
          bwTable(
            y,
            [['Date', 'Description', 'Amount (Rs.)']],
            entries.map(e => [formatDate(e.date), e.description || '—', (e.amount || 0).toLocaleString()]),
            [['', 'Total', this.getLedgerTotal(ledger.ledger_id).toLocaleString()]],
            2
          );
        }
      }

      // ════════════════════════════════════════════════════════
      // MEDICINE PAGES
      // ════════════════════════════════════════════════════════
      if (this.sections.medicine) {
        for (const trader of this.traders) {
          const entries = this.getTraderEntries(trader.trader_id);
          if (entries.length === 0) continue;
          addPage(`Medicine: ${trader.trader_name}`);
          bwTable(
            y,
            [['Date', 'Medicine', 'Qty', 'Price/Unit (Rs.)', 'Total (Rs.)']],
            entries.map(e => [
              formatDate(e.date),
              e.medicine_name,
              e.quantity,
              (e.price_per_unit || 0).toLocaleString(),
              (e.total_amount   || 0).toLocaleString()
            ]),
            [['', '', '', 'Total', this.getTraderTotal(trader.trader_id).toLocaleString()]],
            4
          );
        }
      }

      // ════════════════════════════════════════════════════════
      // SALES
      // ════════════════════════════════════════════════════════
      if (this.sections.sales && this.sales.length > 0) {
        addPage('Sale Records');
        bwTable(
          y,
          [['Date', 'Vehicle', 'Broker', 'Bird Wt (kg)', 'Rate', 'Amount (Rs.)']],
          this.sales.map(s => [
            formatDate(s.date),
            s.vehicle_number || '—',
            s.broker         || '—',
            (s.bird_weight   || 0).toFixed(0),
            (s.rate          || 0).toLocaleString(),
            (s.total_amount  || 0).toLocaleString()
          ]),
          [['', '', '', `${this.totalSaleWeight.toFixed(0)} kg`, '', this.totalSaleAmount.toLocaleString()]],
          5
        );
      }

      // ════════════════════════════════════════════════════════
      // FEED PAGES
      // ════════════════════════════════════════════════════════
      if (this.sections.feed) {
        for (const trader of this.feedTraders) {
          const entries = this.getFeedTraderEntries(trader.trader_id);
          if (entries.length === 0) continue;
          addPage(`Feed: ${trader.trader_name}`);
          bwTable(
            y,
            [['Date', 'Feed', 'Qty', 'Price/Unit (Rs.)', 'Total (Rs.)']],
            entries.map(e => [
              formatDate(e.date),
              e.feed_name || e.Feed_name,
              e.quantity,
              (e.price_per_unit || 0).toLocaleString(),
              (e.total_amount   || 0).toLocaleString()
            ]),
            [['', '', '', 'Total', this.getFeedTraderTotal(trader.trader_id).toLocaleString()]],
            4
          );
        }
      }

      // ════════════════════════════════════════════════════════
      // VACCINATIONS
      // ════════════════════════════════════════════════════════
      if (this.sections.vaccinations && this.vaccinations.length > 0) {
        addPage('Vaccinations');
        bwTable(
          y,
          [['Date', 'Vaccine', 'Dose', 'Notes']],
          this.vaccinations.map(v => [
            formatDate(v.date),
            v.vaccine_name || '—',
            v.dose || '—',
            v.notes || '—'
          ])
        );
      }

      // ════════════════════════════════════════════════════════
      // INCOME
      // ════════════════════════════════════════════════════════
      if (this.sections.income && this.income.length > 0) {
        addPage('Income');
        bwTable(
          y,
          [['Date', 'Description', 'Source', 'Amount (Rs.)']],
          this.income.map(i => [
            formatDate(i.date),
            i.description || '—',
            i.source === 'sale' ? 'Sale' : 'Manual',
            (i.amount || 0).toLocaleString()
          ]),
          [['', '', 'Total', this.totalIncome.toLocaleString()]],
          3
        );
      }

      // ════════════════════════════════════════════════════════
      // FLOCK HEALTH
      // ════════════════════════════════════════════════════════
      if (this.sections.health && this.health.length > 0) {
        addPage('Flock Health');
        bwTable(
          y,
          [['Day', 'Total Birds', 'Mortality', 'Remaining', 'Feed (kg)', 'Avg Wt', 'FCR']],
          this.health.map(h => [
            `Day ${h.week_number}`,
            (h.total_birds || 0).toLocaleString(),
            (h.mortality   || 0).toLocaleString(),
            ((h.total_birds - h.mortality) || 0).toLocaleString(),
            (h.feed_used   || 0).toLocaleString(),
            h.avg_weight   || '0',
            h.fcr          || '0'
          ])
        );
      }

      // ════════════════════════════════════════════════════════
      // PROFIT / LOSS SUMMARY
      // ════════════════════════════════════════════════════════
      if (this.sections.profitLoss) {
        addPage('Profit / Loss Summary');
        bwTable(
          y,
          [],
          [
            ['Total Income',   `Rs. ${this.totalIncome.toLocaleString()}`],
            ['Total Expenses', `Rs. ${this.totalExpenses.toLocaleString()}`],
            [
              this.profitLoss >= 0 ? 'NET PROFIT' : 'NET LOSS',
              `Rs. ${Math.abs(this.profitLoss).toLocaleString()}`
            ]
          ],
          undefined,
          1,
          {
            0: { fontStyle: 'bold', cellWidth: 100 },
            1: { halign: 'right', fontStyle: 'bold' }
          }
        );
      }

      // ── Footer & page numbers on every page ───────────────
      const totalPages = (doc.internal as any).getNumberOfPages();
      const totalRef = { val: totalPages };
      for (let i = 1; i <= totalPages; i++) {
        drawFooter(i, totalRef);
      }

      doc.save(`${farmName}-${flockName}-Report.pdf`);

    } finally {
      this.isGenerating = false;
      this.cdr.detectChanges();
    }
  }

  // ── Load image as base64 ──────────────────────────────────
  private loadImageAsBase64(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = img.width;
        canvas.height = img.height;
        canvas.getContext('2d')!.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/jpeg'));
      };
      img.onerror = () => reject(new Error('Logo load failed'));
      img.src = url;
    });
  }
}
