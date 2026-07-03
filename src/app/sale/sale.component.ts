import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DatabaseService } from '../shared/services/database.service';
import { FlockService } from '../shared/services/flock.service';
import { AuthService } from '../shared/services/auth.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';
import { Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import { PendingStateService } from '../shared/services/pending-state.service';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-sale',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe],
  templateUrl: './sale.component.html',
  styleUrl: './sale.component.scss'
})
export class SaleComponent implements OnInit, OnDestroy {
  currentFlock: any = null;
  logoUrl: string | null = null;
  sales: any[] = [];
  brokers: any[] = [];
  groupedSales: any[] = [];
  pendingRows: any[] = [];
  selectedBrokerFilter = 'all';
  showBrokerForm = false;
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  showDeleteBrokerDialog = false;
  deletingId: number | null = null;
  deletingBrokerId: number | null = null;
  isSaving = false;
  isSavingAll = false;
  showValidationDialog = false;
  validationMessage = '';
  private subs = new Subscription();

  brokerForm = { broker_name: '' };

  get hasPendingRows(): boolean {
    return this.pendingRows.length > 0;
  }

  getRowBirdWeight(row: any): number {
    return (row.load_weight || 0) - (row.empty_weight || 0);
  }

  getRowTotal(row: any): number {
    return this.getRowBirdWeight(row) * (row.rate || 0);
  }

  getEditBirdWeight(): number {
    return (this.editForm.load_weight || 0) -
           (this.editForm.empty_weight || 0);
  }

  getEditTotal(): number {
    return this.getEditBirdWeight() * (this.editForm.rate || 0);
  }

  get filteredGroupedSales(): any[] {
    if (this.selectedBrokerFilter === 'all') return this.groupedSales;
    return this.groupedSales.map(group => ({
      ...group,
      sales: group.sales.filter(
        (s: any) => s.broker === this.selectedBrokerFilter
      ),
      totalWeight: group.sales
        .filter((s: any) => s.broker === this.selectedBrokerFilter)
        .reduce((sum: number, s: any) => sum + (s.bird_weight || 0), 0),
      totalAmount: group.sales
        .filter((s: any) => s.broker === this.selectedBrokerFilter)
        .reduce((sum: number, s: any) =>
          sum + (s.total_amount || 0), 0)
    })).filter(group => group.sales.length > 0);
  }

  get grandTotalWeight(): number {
    return this.filteredGroupedSales
      .reduce((sum, g) => sum + g.totalWeight, 0);
  }

  get grandTotalAmount(): number {
    return this.filteredGroupedSales
      .reduce((sum, g) => sum + g.totalAmount, 0);
  }

  getBrokerName(brokerId: number | null): string {
    if (!brokerId) return '—';
    const broker = this.brokers.find(b => b.broker_id === brokerId);
    return broker ? broker.broker_name : '—';
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'a') {
      const activeTag = (event.target as HTMLElement)?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      event.preventDefault();
      if (this.brokers.length > 0) this.addPendingRow();
    }
    if (event.ctrlKey && event.key === 's') {
      event.preventDefault();
      if (this.hasPendingRows) this.saveAllRows();
    }
  }

  constructor(
    private db: DatabaseService,
    private flockService: FlockService,
    private authService: AuthService,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
    private pendingState: PendingStateService
  ) {}


  ngOnInit() {
    const resolved = this.route.snapshot.data['data'];
    if (resolved) {
      this.currentFlock = resolved.flock;
      this.logoUrl      = resolved.logoUrl || null;
      this.sales = resolved.sales || [];
      this.brokers = resolved.brokers || [];
      this.groupSales();

      const cached = this.pendingState.getState('SaleComponent');
      if (cached && cached.flockId === this.currentFlock?.flock_id) {
        this.pendingRows = cached.pendingRows || [];
      }
    }
    

    this.subs.add(
      this.flockService.currentFlock$.pipe(skip(1)).subscribe(flock => {
        if (flock) {
          this.currentFlock = flock;
          this.sales = [];
          this.groupedSales = [];
          this.pendingRows = [];
          this.editingId = null;
          this.selectedBrokerFilter = 'all';
          this.isSaving = false;
          this.pendingState.clearState('SaleComponent');
          this.loadData();
        }
      })
    );
  }

  ngOnDestroy() {
    this.pendingState.saveState('SaleComponent', {
      flockId: this.currentFlock?.flock_id,
      pendingRows: this.pendingRows
    });
    this.subs.unsubscribe();
  }

  groupSales() {
    const groups: any = {};
    this.sales.forEach(sale => {
      if (!groups[sale.date]) {
        groups[sale.date] = {
          date: sale.date,
          sales: [],
          totalWeight: 0,
          totalAmount: 0
        };
      }
      groups[sale.date].sales.push(sale);
      groups[sale.date].totalWeight += sale.bird_weight || 0;
      groups[sale.date].totalAmount += sale.total_amount || 0;
    });
    this.groupedSales = Object.values(groups)
      .sort((a: any, b: any) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
  }

  async loadData() {
    if (!this.currentFlock) {
      this.sales = [];
      this.groupedSales = [];
      this.cdr.detectChanges();
      return;
    }

    const salesResult = await this.db.get(
      `SELECT * FROM sales
       WHERE flock_id = ?
       ORDER BY date DESC, sale_id ASC`,
      [this.currentFlock.flock_id]
    );

    const brokersResult = await this.db.get(
      `SELECT * FROM brokers
       WHERE flock_id = ?
       ORDER BY broker_name ASC`,
      [this.currentFlock.flock_id]
    );

    if (salesResult.success) {
      this.sales = salesResult.data;
      this.groupSales();
    } else {
      this.sales = [];
      this.groupedSales = [];
    }

    if (brokersResult.success) {
      this.brokers = brokersResult.data;
    } else {
      this.brokers = [];
    }

    this.cdr.detectChanges();
  }

  async syncIncomeForDate(date: string) {
    const dayResult = await this.db.get(
      `SELECT SUM(bird_weight) as total_weight,
              SUM(total_amount) as total_amount
       FROM sales WHERE flock_id = ? AND date = ?`,
      [this.currentFlock.flock_id, date]
    );

    if (!dayResult.success || !dayResult.data[0]) return;

    const totalWeight = dayResult.data[0].total_weight || 0;
    const totalAmount = dayResult.data[0].total_amount || 0;

    if (totalWeight === 0 && totalAmount === 0) {
      await this.db.run(
        `DELETE FROM income
         WHERE flock_id = ? AND date = ? AND source = 'sale'`,
        [this.currentFlock.flock_id, date]
      );
      return;
    }

    const description = `Sale — ${totalWeight.toFixed(0)} kg`;
    const existing = await this.db.get(
      `SELECT * FROM income
       WHERE flock_id = ? AND date = ? AND source = 'sale'`,
      [this.currentFlock.flock_id, date]
    );

    if (existing.success && existing.data.length > 0) {
      await this.db.run(
        `UPDATE income SET description = ?, amount = ?
         WHERE flock_id = ? AND date = ? AND source = 'sale'`,
        [description, totalAmount, this.currentFlock.flock_id, date]
      );
    } else {
      await this.db.run(
        `INSERT INTO income
          (flock_id, date, description, amount, source)
         VALUES (?, ?, ?, ?, 'sale')`,
        [this.currentFlock.flock_id, date, description, totalAmount]
      );
    }
  }

  openBrokerForm() {
    if (this.isSaving) return;
    this.brokerForm = { broker_name: '' };
    this.showBrokerForm = true;
  }

  async saveBroker() {
    if (this.isSaving) return;
    if (!this.brokerForm.broker_name.trim()) return;
    this.isSaving = true;
    this.showBrokerForm = false;
    try {
      await this.db.run(
        `INSERT INTO brokers (flock_id, broker_name) VALUES (?, ?)`,
        [this.currentFlock.flock_id, this.brokerForm.broker_name.trim()]
      );
      await this.loadData();
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  confirmDeleteBroker(brokerId: number) {
    if (this.isSaving) return;
    this.deletingBrokerId = brokerId;
    this.showDeleteBrokerDialog = true;
  }

  async onDeleteBrokerConfirmed() {
    if (this.isSaving) return;
    this.isSaving = true;
    this.showDeleteBrokerDialog = false;
    try {
      if (this.deletingBrokerId) {
        await this.db.run(
          `DELETE FROM brokers WHERE broker_id = ?`,
          [this.deletingBrokerId]
        );
        await this.loadData();
      }
    } finally {
      this.deletingBrokerId = null;
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  onDeleteBrokerCancelled() {
    this.showDeleteBrokerDialog = false;
    this.deletingBrokerId = null;
  }

  makeNewRow(): any {
    return {
      date: new Date().toISOString().split('T')[0],
      vehicle_number: '',
      driver_name: '',
      driver_phone: '',
      broker_id: this.brokers.length > 0 ? this.brokers[0].broker_id : null,
      empty_weight: null,
      load_weight: null,
      rate: null,
      payment_type: 'cash',
      receipt_image: null 
    };
  }

  addPendingRow() {
    if (this.isSaving) return;
    this.editingId = null;
    this.pendingRows.push(this.makeNewRow());
  }

  addRowAfter(index: number) {
    this.pendingRows.splice(index + 1, 0, this.makeNewRow());
  }

  removePendingRow(index: number) {
    this.pendingRows.splice(index, 1);
  }

  async saveAllRows() {
    if (this.pendingRows.length === 0 || this.isSavingAll) return;
    this.isSavingAll = true;
    const datesToSync = new Set<string>();

    try {
      const invalidRows: any[] = [];
      let insertedCount = 0;

      for (const row of this.pendingRows) {
        if (!row.date || !row.empty_weight || !row.load_weight || !row.rate) {
          invalidRows.push(row);
          continue;
        }

        const birdWeight = this.getRowBirdWeight(row);
        const total = this.getRowTotal(row);
        const brokerName = this.getBrokerName(row.broker_id);

        await this.db.run(
          `INSERT INTO sales (flock_id, date, vehicle_number, driver_name, driver_phone, broker, empty_weight, load_weight, bird_weight, rate, total_amount, payment_type, receipt_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [this.currentFlock.flock_id, row.date,
           row.vehicle_number, row.driver_name || '',
           row.driver_phone || '', brokerName,
           row.empty_weight, row.load_weight,
           birdWeight, row.rate, total,
           row.payment_type || 'cash',row.receipt_image || null]
        );

        datesToSync.add(row.date);
        insertedCount++;
      }

      for (const date of datesToSync) {
        await this.syncIncomeForDate(date);
      }

      this.pendingRows = invalidRows;

      if (insertedCount > 0) {
        await this.loadData();
      }

      if (invalidRows.length > 0) {
        this.validationMessage = 'Some rows were missing required fields and were not saved.';
        this.showValidationDialog = true;
      }
    } finally {
      this.isSavingAll = false;
      this.cdr.detectChanges();
    }
  }

  cancelAllRows() {
    this.pendingRows = [];
  }

  startEdit(sale: any) {
    if (this.isSaving) return;
    this.pendingRows = [];
    this.editingId = sale.sale_id;
    const broker = this.brokers.find(b => b.broker_name === sale.broker);
    this.editForm = {
      date: sale.date,
      vehicle_number: sale.vehicle_number,
      driver_name: sale.driver_name || '',
      driver_phone: sale.driver_phone || '',
      broker_id: broker ? broker.broker_id : null,
      empty_weight: sale.empty_weight,
      load_weight: sale.load_weight,
      rate: sale.rate,
      payment_type: sale.payment_type || 'cash',
      receipt_image: sale.receipt_image || null
    };
  }

  cancelEdit() {
    if (this.isSaving) return;
    this.editingId = null;
    this.editForm = {};
  }

  async saveEdit(saleId: number, oldDate: string) {
    if (this.isSaving) return;
    this.isSaving = true;
    this.editingId = null;

    const birdWeight = this.getEditBirdWeight();
    const total = this.getEditTotal();
    const newDate = this.editForm.date;
    const brokerName = this.getBrokerName(this.editForm.broker_id);

    try {
      await this.db.run(
        `UPDATE sales SET date = ?, vehicle_number = ?, driver_name = ?, driver_phone = ?, broker = ?, empty_weight = ?, load_weight = ?, bird_weight = ?, rate = ?, total_amount = ?, payment_type = ?, receipt_image = ? WHERE sale_id = ?`,
        [newDate, this.editForm.vehicle_number,
         this.editForm.driver_name || '',
         this.editForm.driver_phone || '',
         brokerName, this.editForm.empty_weight,
         this.editForm.load_weight, birdWeight,
         this.editForm.rate, total,
         this.editForm.payment_type || 'cash',this.editForm.receipt_image || null, saleId]
      );

      await this.syncIncomeForDate(newDate);
      if (oldDate !== newDate) {
        await this.syncIncomeForDate(oldDate);
      }

      this.editForm = {};
      await this.loadData();
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  confirmDelete(saleId: number) {
    if (this.isSaving) return;
    this.deletingId = saleId;
    this.showDeleteDialog = true;
  }

  async onDeleteConfirmed() {
    if (this.isSaving) return;
    this.isSaving = true;
    this.showDeleteDialog = false;
    try {
      if (this.deletingId) {
        const sale = this.sales.find(s => s.sale_id === this.deletingId);
        await this.db.run(
          `DELETE FROM sales WHERE sale_id = ?`,
          [this.deletingId]
        );
        if (sale) await this.syncIncomeForDate(sale.date);
        await this.loadData();
      }
    } finally {
      this.deletingId = null;
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }
  
    onFileSelected(event: any, target: any) {
    const file = event.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxWidth = 800; let w = img.width, h = img.height;
        if (w > maxWidth) { h = (h * maxWidth) / w; w = maxWidth; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        target.receipt_image = canvas.toDataURL('image/jpeg', 0.7);
        this.cdr.detectChanges();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  openImage(base64: string) {
    const win = window.open('', '_blank');
    if (win) win.document.write('<img src="' + base64 + '" style="max-width:100%;">');
  }

  onDeleteCancelled() {
    this.showDeleteDialog = false;
    this.deletingId = null;
  }

  // ── Load image as base64 ──────────────────────────────────
  private loadImageAsBase64(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d')!.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/jpeg'));
      };
      img.onerror = () => reject(new Error('Logo load failed'));
      img.src = url;
    });
  }

  // ──────────────────────────────────────────────────────────
  // PRINT: Daily Sale (matching farm report style)
  // ──────────────────────────────────────────────────────────
  async printDailySale(group: any) {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const farmName = this.authService.getCurrentFarm()?.farm_name || 'Poultry Farm';
    const flockName = this.currentFlock?.flock_name || '';
    const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';

    const BLACK: [number, number, number] = [0, 0, 0];
    const GRAY: [number, number, number] = [120, 120, 120];
    const LGRAY: [number, number, number] = [200, 200, 200];

    let coverY = 20;

    // Logo
    if (this.logoUrl) {
      try {
        const imgData = await this.loadImageAsBase64(this.logoUrl);
        const imgProps = doc.getImageProperties(imgData);
        const maxWidth = pageWidth - 28;
        const maxHeight = 30;
        let lw = imgProps.width;
        let lh = imgProps.height;
        if (lw > maxWidth) { const r = maxWidth / lw; lw = maxWidth; lh *= r; }
        if (lh > maxHeight) { const r = maxHeight / lh; lh = maxHeight; lw *= r; }
        const x = (pageWidth - lw) / 2;
        doc.addImage(imgData, 'JPEG', x, coverY, lw, lh);
        coverY += lh + 10;
      } catch {}
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...BLACK);
    doc.text('DAILY SALE REPORT', pageWidth / 2, coverY, { align: 'center' });
    coverY += 9;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(...GRAY);
    doc.text(farmName, pageWidth / 2, coverY, { align: 'center' });
    coverY += 7;

    doc.setFontSize(10);
    doc.text(`Flock: ${flockName}`, pageWidth / 2, coverY, { align: 'center' });
    coverY += 6;
    doc.text(`Date: ${String(group.date).split('T')[0]}`, pageWidth / 2, coverY, { align: 'center' });
    coverY += 8;

    doc.setDrawColor(...BLACK);
    doc.setLineWidth(0.5);
    doc.line(14, coverY, pageWidth - 14, coverY);
    coverY += 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BLACK);
    doc.text('SUMMARY', 14, coverY);
    coverY += 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text(`Total Vehicles: ${group.sales.length}`, 14, coverY);
    doc.setTextColor(...BLACK);
    doc.text(`${group.totalWeight.toFixed(0)} kg  |  Rs. ${group.totalAmount.toLocaleString()}`, 70, coverY);
    coverY += 10;

    const body = group.sales.map((s: any) => [
      s.vehicle_number || '—',
      s.driver_name || '—',
      s.broker || '—',
      `${(s.bird_weight || 0).toFixed(0)} kg`,
      `Rs. ${(s.rate || 0).toLocaleString()}`,
      `Rs. ${(s.total_amount || 0).toLocaleString()}`,
      s.payment_type || 'cash'
    ]);

    autoTable(doc, {
      startY: coverY,
      head: [['Vehicle', 'Driver', 'Broker', 'Weight', 'Rate', 'Amount', 'Payment']],
      body,
      foot: [['', '', 'Total', `${group.totalWeight.toFixed(0)} kg`, '', `Rs. ${group.totalAmount.toLocaleString()}`, '']],
      theme: 'plain',
      headStyles: { fontStyle: 'bold', fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { bottom: 0.3 }, lineColor: BLACK },
      bodyStyles: { fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { bottom: 0.15 }, lineColor: LGRAY },
      footStyles: { fontStyle: 'bold', fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { top: 0.3 }, lineColor: BLACK },
      margin: { left: 14, right: 14 }
    });

    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(footer, pageWidth / 2, pageHeight - 9, { align: 'center' });
    doc.setDrawColor(...LGRAY);
    doc.setLineWidth(0.2);
    doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
    doc.setFontSize(8);
    doc.text('Page 1 of 1', pageWidth / 2, pageHeight - 4, { align: 'center' });

    doc.save(`${farmName}-Daily-Sale-${String(group.date).split('T')[0]}.pdf`);
  }

  // ──────────────────────────────────────────────────────────
  // PRINT: Broker Sale (matching farm report style)
  // ──────────────────────────────────────────────────────────
  async printBrokerSale() {
    const brokerName = this.selectedBrokerFilter;
    const allBrokerSales = this.sales.filter((s: any) => s.broker === brokerName);
    if (allBrokerSales.length === 0) return;

    const totalWeight = allBrokerSales.reduce((sum: number, s: any) => sum + (s.bird_weight || 0), 0);
    const totalAmount = allBrokerSales.reduce((sum: number, s: any) => sum + (s.total_amount || 0), 0);

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const farmName = this.authService.getCurrentFarm()?.farm_name || 'Poultry Farm';
    const flockName = this.currentFlock?.flock_name || '';
    const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';

    const BLACK: [number, number, number] = [0, 0, 0];
    const GRAY: [number, number, number] = [120, 120, 120];
    const LGRAY: [number, number, number] = [200, 200, 200];

    let coverY = 20;

    // Logo
    if (this.logoUrl) {
      try {
        const imgData = await this.loadImageAsBase64(this.logoUrl);
        const imgProps = doc.getImageProperties(imgData);
        const maxWidth = pageWidth - 28;
        const maxHeight = 30;
        let lw = imgProps.width;
        let lh = imgProps.height;
        if (lw > maxWidth) { const r = maxWidth / lw; lw = maxWidth; lh *= r; }
        if (lh > maxHeight) { const r = maxHeight / lh; lh = maxHeight; lw *= r; }
        const x = (pageWidth - lw) / 2;
        doc.addImage(imgData, 'JPEG', x, coverY, lw, lh);
        coverY += lh + 10;
      } catch {}
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...BLACK);
    doc.text('BROKER SALE REPORT', pageWidth / 2, coverY, { align: 'center' });
    coverY += 9;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(...GRAY);
    doc.text(farmName, pageWidth / 2, coverY, { align: 'center' });
    coverY += 7;

    doc.setFontSize(10);
    doc.text(`Flock: ${flockName}`, pageWidth / 2, coverY, { align: 'center' });
    coverY += 6;
    doc.text(`Broker: ${brokerName}`, pageWidth / 2, coverY, { align: 'center' });
    coverY += 8;

    doc.setDrawColor(...BLACK);
    doc.setLineWidth(0.5);
    doc.line(14, coverY, pageWidth - 14, coverY);
    coverY += 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BLACK);
    doc.text('SUMMARY', 14, coverY);
    coverY += 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text(`Total Vehicles: ${allBrokerSales.length}`, 14, coverY);
    doc.setTextColor(...BLACK);
    doc.text(`${totalWeight.toFixed(0)} kg  |  Rs. ${totalAmount.toLocaleString()}`, 70, coverY);
    coverY += 10;

    const body = allBrokerSales.map((s: any) => [
      String(s.date).split('T')[0],
      s.vehicle_number || '—',
      s.driver_name || '—',
      `${(s.bird_weight || 0).toFixed(0)} kg`,
      `Rs. ${(s.rate || 0).toLocaleString()}`,
      `Rs. ${(s.total_amount || 0).toLocaleString()}`,
      s.payment_type || 'cash'
    ]);

    autoTable(doc, {
      startY: coverY,
      head: [['Date', 'Vehicle', 'Driver', 'Weight', 'Rate', 'Amount', 'Payment']],
      body,
      foot: [['', '', 'Total', `${totalWeight.toFixed(0)} kg`, '', `Rs. ${totalAmount.toLocaleString()}`, '']],
      theme: 'plain',
      headStyles: { fontStyle: 'bold', fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { bottom: 0.3 }, lineColor: BLACK },
      bodyStyles: { fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { bottom: 0.15 }, lineColor: LGRAY },
      footStyles: { fontStyle: 'bold', fontSize: 9, textColor: BLACK, fillColor: false as any, lineWidth: { top: 0.3 }, lineColor: BLACK },
      margin: { left: 14, right: 14 }
    });

    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(footer, pageWidth / 2, pageHeight - 9, { align: 'center' });
    doc.setDrawColor(...LGRAY);
    doc.setLineWidth(0.2);
    doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
    doc.setFontSize(8);
    doc.text('Page 1 of 1', pageWidth / 2, pageHeight - 4, { align: 'center' });

    doc.save(`${farmName}-Broker-${brokerName}-Sale.pdf`);
  }
}