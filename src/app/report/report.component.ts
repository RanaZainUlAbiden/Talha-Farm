import { Component, OnInit, OnDestroy, ChangeDetectorRef , ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { FlockService } from '../shared/services/flock.service';
import { AuthService } from '../shared/services/auth.service';
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
  sales: any[] = [];
  income: any[] = [];
  health: any[] = [];
  isGenerating = false;
  private subs = new Subscription();

  // ── Section selection ──────────────────────────────────────
  sections = {
    expenses: true,
    ledgers: true,
    medicine: true,
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
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    const resolved = this.route.snapshot.data['data'];
    if (resolved) {
      this.currentFlock     = resolved.flock;
      this.logoUrl          = resolved.logoUrl || null;
      this.expenses         = resolved.expenses         || [];
      this.ledgers          = resolved.ledgers          || [];
      this.ledgerEntries    = resolved.ledgerEntries    || [];
      this.traders          = resolved.traders          || [];
      this.medicineEntries  = resolved.medicineEntries  || [];
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
          this.cdr.detectChanges();
        }
      })
    );
  }

  ngOnDestroy() { this.subs.unsubscribe(); }

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
      const formatDate = (d: any) => d ? String(d).split('T')[0] : '—';

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

      // ════════════════════════════════════════════════════════
      // COVER PAGE
      // ════════════════════════════════════════════════════════
      let coverY = 20;

      // Logo
      // Logo — centered, auto-sized to fit width
if (this.logoUrl) {
  try {
    const imgData = await this.loadImageAsBase64(this.logoUrl);
    
    // Get image properties
    const imgProps = doc.getImageProperties(imgData);
    const maxWidth = pageWidth - 28;  // 14mm margin each side
    const maxHeight = 35;             // Max height in mm
    
    let logoWidth = imgProps.width;
    let logoHeight = imgProps.height;
    
    // Scale to fit width if wider than maxWidth
    if (logoWidth > maxWidth) {
      const ratio = maxWidth / logoWidth;
      logoWidth = maxWidth;
      logoHeight = logoHeight * ratio;
    }
    
    // Scale down if too tall
    if (logoHeight > maxHeight) {
      const ratio = maxHeight / logoHeight;
      logoHeight = maxHeight;
      logoWidth = logoWidth * ratio;
    }
    
    // Center the logo
    const x = (pageWidth - logoWidth) / 2;
    
    doc.addImage(imgData, 'JPEG', x, coverY, logoWidth, logoHeight);
    coverY += logoHeight + 12;
  } catch { /* skip logo on error */ }
}

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(...BLACK);
      doc.text('FARM REPORT', pageWidth / 2, coverY, { align: 'center' });
      coverY += 9;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(14);
      doc.setTextColor(...GRAY);
      doc.text(farmName, pageWidth / 2, coverY, { align: 'center' });
      coverY += 7;

      doc.setFontSize(11);
      doc.text(`Flock: ${flockName}`, pageWidth / 2, coverY, { align: 'center' });
      coverY += 6;
      doc.text(`Generated: ${today}`, pageWidth / 2, coverY, { align: 'center' });
      coverY += 8;

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
        ['Health Records',   `${this.health.length} week${this.health.length === 1 ? '' : 's'}`]
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
          [['Week', 'Total Birds', 'Mortality', 'Remaining', 'Feed (kg)', 'Avg Wt', 'FCR']],
          this.health.map(h => [
            `Week ${h.week_number}`,
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
