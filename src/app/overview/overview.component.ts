import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../shared/services/auth.service';
import { OverviewService, OverviewSummary, OverviewDateRange } from '../shared/services/overview.service';
import { toLocalDateString } from '../shared/utils/date.util';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.scss'
})
export class OverviewComponent implements OnInit {
  currentFarm: any = null;
  summary: OverviewSummary | null = null;
  isLoading = true;
  isGenerating = false;

  dateFrom: string = '';
  dateTo: string = '';

  constructor(
    private authService: AuthService,
    private overviewService: OverviewService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();

    // Default range: current month to date.
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    this.dateFrom = toLocalDateString(firstOfMonth);
    this.dateTo = toLocalDateString(today);

    this.loadData();
  }

  async loadData() {
    this.isLoading = true;
    const farmId = this.currentFarm?.farm_id;
    const range: OverviewDateRange = { from: this.dateFrom || null, to: this.dateTo || null };
    this.summary = farmId ? await this.overviewService.getSummary(farmId, range) : null;
    this.isLoading = false;
    this.cdr.detectChanges();
  }

  applyDateFilter() {
    this.loadData();
  }

  clearDateFilter() {
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    this.dateFrom = toLocalDateString(firstOfMonth);
    this.dateTo = toLocalDateString(today);
    this.loadData();
  }

  // ── PDF Generation ──────────────────────────────────────────
  async generatePDF() {
    if (!this.summary) return;
    this.isGenerating = true;

    try {
      const s = this.summary;
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const farmName = this.currentFarm?.farm_name || 'Poultry Farm';
      const today = new Date().toLocaleDateString('en-PK');
      const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';
      const rangeLabel = `${this.dateFrom || 'Start'} to ${this.dateTo || 'Today'}`;

      const BLACK: [number, number, number] = [0, 0, 0];
      const GRAY: [number, number, number] = [120, 120, 120];
      const LGRAY: [number, number, number] = [200, 200, 200];
      const GREEN: [number, number, number] = [26, 92, 56];
      const RED: [number, number, number] = [198, 40, 40];

      const rs = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;

      let y = 20;

      // ── Header ──
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      doc.setTextColor(...BLACK);
      doc.text('TALHA PROTEIN FARMS', 14, y);
      y += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...GRAY);
      doc.text('Chak No 392 JB, Chatala, Toba Tek Singh', 14, y);
      y += 8;

      doc.setFontSize(10);
      doc.setTextColor(...BLACK);
      doc.text(`Overview Report: ${farmName}`, 14, y);
      y += 5;
      doc.setFontSize(9);
      doc.setTextColor(...GRAY);
      doc.text(`Period: ${rangeLabel}  •  Generated: ${today}`, 14, y);
      y += 8;

      doc.setDrawColor(...BLACK);
      doc.setLineWidth(0.5);
      doc.line(14, y, pageWidth - 14, y);
      y += 8;

      // ── Headline block: money in, money out, profit or loss ──
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...BLACK);
      doc.text('FINANCIAL SUMMARY', 14, y);
      y += 3;
      doc.setDrawColor(...BLACK);
      doc.line(14, y, pageWidth - 14, y);
      y += 6;

      const profitLabel = s.profit >= 0 ? 'PROFIT' : 'LOSS';
      autoTable(doc, {
        startY: y,
        body: [
          ['Total Money In', rs(s.moneyIn.total)],
          ['Total Money Out', rs(s.moneyOut.total)],
          ['  Business expenses', rs(s.moneyOut.expenses)],
          ['  Personal', rs(s.moneyOut.personal)],
          ['  Asset payments', rs(s.moneyOut.assetPayments)],
          [
            { content: profitLabel, styles: { fontStyle: 'bold' } },
            { content: rs(s.profit), styles: { fontStyle: 'bold', textColor: s.profit >= 0 ? GREEN : RED } }
          ]
        ],
        theme: 'plain',
        bodyStyles: { fontSize: 10, textColor: BLACK, lineWidth: { bottom: 0.15 }, lineColor: LGRAY },
        columnStyles: { 0: { cellWidth: 120 }, 1: { halign: 'right' } },
        margin: { left: 14, right: 14 }
      });
      y = (doc as any).lastAutoTable.finalY + 10;

      // ── Stock & assets ──
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...BLACK);
      doc.text('DISTRIBUTION STOCK & ASSETS', 14, y);
      y += 3;
      doc.line(14, y, pageWidth - 14, y);
      y += 6;

      autoTable(doc, {
        startY: y,
        body: [
          ['Distribution Stock Bought (purchase orders)', rs(s.expenses.purchases)],
          ['Distribution Stock Returned to Supplier', rs(s.expenses.purchaseReturns)],
          ['Cost of Goods Sold (charged against profit)', rs(s.expenses.costOfGoodsSold)],
          ['Distribution Stock on Hand, at cost', rs(s.inventory.value)],
          ['Assets Owned (value)', rs(s.assets.activeValue)],
          ['Outstanding Installments', rs(s.assets.outstanding)]
        ],
        theme: 'plain',
        bodyStyles: { fontSize: 10, textColor: BLACK, lineWidth: { bottom: 0.15 }, lineColor: LGRAY },
        columnStyles: { 0: { cellWidth: 120 }, 1: { halign: 'right' } },
        margin: { left: 14, right: 14 }
      });
      y = (doc as any).lastAutoTable.finalY + 10;

      // ── Per-farm breakdown ──
      if (s.perFarm.length > 0) {
        if (y > pageHeight - 60) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(...BLACK);
        doc.text('PER-FARM BREAKDOWN', 14, y);
        y += 3;
        doc.line(14, y, pageWidth - 14, y);
        y += 6;

        autoTable(doc, {
          startY: y,
          head: [['Farm', 'Module', 'Revenue', 'Expenses', 'Profit']],
          body: s.perFarm.map(f => [
            f.unitName,
            f.moduleType,
            rs(f.revenue),
            rs(f.expenses),
            rs(f.profit)
          ]),
          theme: 'plain',
          headStyles: { fontStyle: 'bold', fontSize: 9, textColor: BLACK, lineWidth: { bottom: 0.3 }, lineColor: BLACK },
          bodyStyles: { fontSize: 9, textColor: BLACK, lineWidth: { bottom: 0.15 }, lineColor: LGRAY },
          columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
          margin: { left: 14, right: 14 }
        });
        y = (doc as any).lastAutoTable.finalY + 10;
      }

      // ── Warnings ──
      if (s.warnings.length > 0) {
        if (y > pageHeight - 40) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(...RED);
        doc.text('WARNINGS', 14, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...BLACK);
        for (const w of s.warnings) {
          const lines = doc.splitTextToSize('• ' + w, pageWidth - 28);
          doc.text(lines, 14, y);
          y += lines.length * 4 + 2;
        }
      }

      // ── Footer & page numbers ──
      const totalPages = (doc.internal as any).getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7.5);
        doc.setTextColor(...GRAY);
        doc.setFont('helvetica', 'normal');
        doc.text(footer, pageWidth / 2, pageHeight - 9, { align: 'center' });
        doc.setDrawColor(...LGRAY);
        doc.setLineWidth(0.2);
        doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 4, { align: 'center' });
      }

      await this.printPdf(doc, `${farmName}-Overview-${this.dateFrom}-to-${this.dateTo}.pdf`);
    } finally {
      this.isGenerating = false;
      this.cdr.detectChanges();
    }
  }

  private async printPdf(doc: jsPDF, filename: string) {
    try {
      const dataUri = doc.output('datauristring');
      const base64 = dataUri.split(',')[1];
      const result = await (window as any).electronAPI.printPdfBase64(base64);
      if (!result || !result.success) {
        console.error('Print failed, falling back to save:', result?.error);
        doc.save(filename);
      }
    } catch (e) {
      console.error('Print error, falling back to save:', e);
      doc.save(filename);
    }
  }
}
