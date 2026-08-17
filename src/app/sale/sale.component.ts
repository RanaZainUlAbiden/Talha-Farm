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
import { PaginationComponent } from '../shared/components/pagination/pagination.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-sale',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe, PaginationComponent],
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
  defaultRate: number | null = null;
  private subs = new Subscription();

  brokerForm = { broker_name: '' };

  private readonly farmDisplayName = 'TALHA PROTEIN FARMS';
  private readonly farmAddress = 'Chak No 392 JB, Chatala, Toba Tek Singh';
  private readonly farmPhone1 = 'Muhammad Tariq: 0321-7546630';
  private readonly farmPhone2 = 'Ghulam Abbas: 0322-7778826';
  get hasPendingRows(): boolean { return this.pendingRows.length > 0; }
  getRowBirdWeight(row: any): number { return (row.load_weight || 0) - (row.empty_weight || 0); }
  getRowTotal(row: any): number { return this.getRowBirdWeight(row) * (row.rate || 0); }
  getEditBirdWeight(): number { return (this.editForm.load_weight || 0) - (this.editForm.empty_weight || 0); }
  getEditTotal(): number { return this.getEditBirdWeight() * (this.editForm.rate || 0); }

  currentPage = 1;
  pageSize = 20;

  get paginatedGroupedSales() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredGroupedSales.slice(start, start + this.pageSize);
  }

  get filteredGroupedSales(): any[] {
    let result = this.selectedBrokerFilter === 'all' ? this.groupedSales :
      this.groupedSales.map(group => ({
        ...group,
        sales: group.sales.filter((s: any) => s.broker === this.selectedBrokerFilter),
        totalWeight: group.sales.filter((s: any) => s.broker === this.selectedBrokerFilter).reduce((sum: number, s: any) => sum + (s.bird_weight || 0), 0),
        totalAmount: group.sales.filter((s: any) => s.broker === this.selectedBrokerFilter).reduce((sum: number, s: any) => sum + (s.total_amount || 0), 0)
      })).filter(group => group.sales.length > 0);

    if (this.filteredByDate && this.selectedDateFilter) {
      result = result.filter(group => group.date === this.selectedDateFilter);
    }

    return result;
  }

  get grandTotalWeight(): number { return this.filteredGroupedSales.reduce((sum, g) => sum + g.totalWeight, 0); }
  get grandTotalAmount(): number { return this.filteredGroupedSales.reduce((sum, g) => sum + g.totalAmount, 0); }
  getBrokerName(brokerId: number | null): string { if (!brokerId) return '—'; const broker = this.brokers.find(b => b.broker_id === brokerId); return broker ? broker.broker_name : '—'; }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'a') { event.preventDefault(); if (this.brokers.length > 0) this.addPendingRow(); }
    if (event.ctrlKey && event.key === 's') { event.preventDefault(); if (this.hasPendingRows) this.saveAllRows(); }
  }

  constructor(
    private db: DatabaseService, private flockService: FlockService, private authService: AuthService,
    private route: ActivatedRoute, private cdr: ChangeDetectorRef, private pendingState: PendingStateService
  ) { }

  ngOnInit() {
    const resolved = this.route.snapshot.data['data'];
    if (resolved) {
      this.currentFlock = resolved.flock; this.logoUrl = resolved.logoUrl || 'report-boiler.jpeg';
      this.sales = resolved.sales || []; this.brokers = resolved.brokers || []; this.groupSales();
      const cached = this.pendingState.getState('SaleComponent');
      if (cached && cached.flockId === this.currentFlock?.flock_id) {
        this.pendingRows = cached.pendingRows || [];
        this.defaultRate = cached.defaultRate || null;
      }
    }
    this.subs.add(this.flockService.currentFlock$.pipe(skip(1)).subscribe(flock => {
      if (flock) {
        this.currentFlock = flock; this.sales = []; this.groupedSales = []; this.pendingRows = [];
        this.editingId = null; this.selectedBrokerFilter = 'all'; this.isSaving = false;
        this.defaultRate = null;
        this.pendingState.clearState('SaleComponent'); this.loadData();
      }
    }));
  }

  ngOnDestroy() { this.pendingState.saveState('SaleComponent', { flockId: this.currentFlock?.flock_id, pendingRows: this.pendingRows, defaultRate: this.defaultRate }); this.subs.unsubscribe(); }

  groupSales() { const groups: any = {}; this.sales.forEach(sale => { if (!groups[sale.date]) groups[sale.date] = { date: sale.date, sales: [], totalWeight: 0, totalAmount: 0 }; groups[sale.date].sales.push(sale); groups[sale.date].totalWeight += sale.bird_weight || 0; groups[sale.date].totalAmount += sale.total_amount || 0; }); this.groupedSales = Object.values(groups).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()); }

  async loadData() {
    if (!this.currentFlock) { this.sales = []; this.groupedSales = []; this.cdr.detectChanges(); return; }
    const sr = await this.db.get('SELECT * FROM sales WHERE flock_id = ? AND module_type = ? ORDER BY date DESC, sale_id ASC', [this.currentFlock.flock_id, 'broiler']);
    const br = await this.db.get('SELECT * FROM brokers WHERE flock_id = ? ORDER BY broker_name ASC', [this.currentFlock.flock_id]);
    this.sales = sr.success ? sr.data : []; this.brokers = br.success ? br.data : [];
    if (sr.success) this.groupSales(); else this.groupedSales = [];
    this.cdr.detectChanges();
  }

  async syncIncomeForDate(date: string) {
    const dr = await this.db.get('SELECT SUM(bird_weight) as tw, SUM(total_amount) as ta FROM sales WHERE flock_id=? AND date=?', [this.currentFlock.flock_id, date]);
    if (!dr.success || !dr.data[0]) return;
    const tw = dr.data[0].tw || 0, ta = dr.data[0].ta || 0;
    if (tw === 0 && ta === 0) { await this.db.run('DELETE FROM income WHERE flock_id=? AND date=? AND source=?', [this.currentFlock.flock_id, date, 'sale']); return; }
    const desc = 'Sale — ' + tw.toFixed(0) + ' kg';
    const ex = await this.db.get('SELECT * FROM income WHERE flock_id=? AND date=? AND source=?', [this.currentFlock.flock_id, date, 'sale']);
    if (ex.success && ex.data.length > 0) await this.db.run('UPDATE income SET description=?, amount=? WHERE flock_id=? AND date=? AND source=?', [desc, ta, this.currentFlock.flock_id, date, 'sale']);
    else await this.db.run('INSERT INTO income (flock_id, date, description, amount, source) VALUES (?,?,?,?,?)', [this.currentFlock.flock_id, date, desc, ta, 'sale']);
  }

  openBrokerForm() { if (!this.isSaving) { this.brokerForm = { broker_name: '' }; this.showBrokerForm = true; } }
  async saveBroker() { if (this.isSaving || !this.brokerForm.broker_name.trim()) return; this.isSaving = true; this.showBrokerForm = false; try { await this.db.run('INSERT INTO brokers (flock_id, broker_name) VALUES (?,?)', [this.currentFlock.flock_id, this.brokerForm.broker_name.trim()]); await this.loadData(); } finally { this.isSaving = false; this.cdr.detectChanges(); } }
  confirmDeleteBroker(id: number) { if (!this.isSaving) { this.deletingBrokerId = id; this.showDeleteBrokerDialog = true; } }
  async onDeleteBrokerConfirmed() { if (this.isSaving || !this.deletingBrokerId) return; this.isSaving = true; this.showDeleteBrokerDialog = false; try { await this.db.run('DELETE FROM brokers WHERE broker_id=?', [this.deletingBrokerId]); await this.loadData(); } finally { this.deletingBrokerId = null; this.isSaving = false; this.cdr.detectChanges(); } }
  onDeleteBrokerCancelled() { this.showDeleteBrokerDialog = false; this.deletingBrokerId = null; }

  makeNewRow(): any { return { date: new Date().toISOString().split('T')[0], vehicle_number: '', driver_name: '', driver_phone: '', broker_id: this.brokers.length > 0 ? this.brokers[0].broker_id : null, empty_weight: null, load_weight: null, rate: this.defaultRate, payment_type: 'cash', receipt_image: null }; }
  applyDefaultRateToAll() { if (this.defaultRate !== null) { this.pendingRows.forEach(row => { row.rate = this.defaultRate; }); } }
  addPendingRow() { if (!this.isSaving) { this.editingId = null; this.pendingRows.push(this.makeNewRow()); } }
  addRowAfter(i: number) { this.pendingRows.splice(i + 1, 0, this.makeNewRow()); }
  removePendingRow(i: number) { this.pendingRows.splice(i, 1); }

  async saveAllRows() {
    if (!this.pendingRows.length || this.isSavingAll) return;

    // Validate every row up front so an invalid row is never silently
    // skipped and then lost when pendingRows is cleared.
    for (let i = 0; i < this.pendingRows.length; i++) {
      const row = this.pendingRows[i];
      if (!row.date || !row.empty_weight || !row.load_weight || !row.rate) {
        this.validationMessage = `Row ${i + 1}: please fill in date, empty weight, load weight and rate.`;
        this.showValidationDialog = true;
        this.cdr.detectChanges();
        return;
      }
      if (Number(row.load_weight) <= Number(row.empty_weight)) {
        this.validationMessage = `Row ${i + 1}: load weight must be greater than empty weight.`;
        this.showValidationDialog = true;
        this.cdr.detectChanges();
        return;
      }
    }

    this.isSavingAll = true; const datesToSync = new Set<string>();
    try {
      for (const row of this.pendingRows) {
        const bw = this.getRowBirdWeight(row); const total = this.getRowTotal(row);
        await this.db.run('INSERT INTO sales (flock_id, date, vehicle_number, driver_name, driver_phone, broker, empty_weight, load_weight, bird_weight, rate, total_amount, payment_type, receipt_image, module_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [this.currentFlock.flock_id, row.date, row.vehicle_number, row.driver_name || '', row.driver_phone || '', this.getBrokerName(row.broker_id), row.empty_weight, row.load_weight, bw, row.rate, total, row.payment_type || 'cash', row.receipt_image || null, 'broiler']);
        datesToSync.add(row.date);
      }
      for (const date of datesToSync) await this.syncIncomeForDate(date);
      this.pendingRows = []; await this.loadData();
    } finally { this.isSavingAll = false; this.cdr.detectChanges(); }
  }
  cancelAllRows() { this.pendingRows = []; }

  startEdit(sale: any) { if (this.isSaving) return; this.pendingRows = []; this.editingId = sale.sale_id; const broker = this.brokers.find(b => b.broker_name === sale.broker); this.editForm = { date: sale.date, vehicle_number: sale.vehicle_number, driver_name: sale.driver_name || '', driver_phone: sale.driver_phone || '', broker_id: broker ? broker.broker_id : null, empty_weight: sale.empty_weight, load_weight: sale.load_weight, rate: sale.rate, payment_type: sale.payment_type || 'cash', receipt_image: sale.receipt_image || null }; }
  cancelEdit() { if (!this.isSaving) { this.editingId = null; this.editForm = {}; } }
  async saveEdit(saleId: number, oldDate: string) {
    if (this.isSaving) return;
    if (!this.editForm.date || !this.editForm.empty_weight || !this.editForm.load_weight || !this.editForm.rate || !this.editForm.broker_id) {
      this.validationMessage = 'Please fill in date, empty weight, load weight and rate.';
      this.showValidationDialog = true;
      this.cdr.detectChanges();
      return;
    }
    if (Number(this.editForm.load_weight) <= Number(this.editForm.empty_weight)) {
      this.validationMessage = 'Load weight must be greater than empty weight.';
      this.showValidationDialog = true;
      this.cdr.detectChanges();
      return;
    }
    this.isSaving = true; this.editingId = null;
    const bw = this.getEditBirdWeight(); const total = this.getEditTotal();
    try {
      await this.db.run('UPDATE sales SET date=?, vehicle_number=?, driver_name=?, driver_phone=?, broker=?, empty_weight=?, load_weight=?, bird_weight=?, rate=?, total_amount=?, payment_type=?, receipt_image=? WHERE sale_id=?', [this.editForm.date, this.editForm.vehicle_number, this.editForm.driver_name || '', this.editForm.driver_phone || '', this.getBrokerName(this.editForm.broker_id), this.editForm.empty_weight, this.editForm.load_weight, bw, this.editForm.rate, total, this.editForm.payment_type || 'cash', this.editForm.receipt_image || null, saleId]);
      await this.syncIncomeForDate(this.editForm.date); if (oldDate !== this.editForm.date) await this.syncIncomeForDate(oldDate);
      this.editForm = {}; await this.loadData();
    } finally { this.isSaving = false; this.cdr.detectChanges(); }
  }

  confirmDelete(id: number) { if (!this.isSaving) { this.deletingId = id; this.showDeleteDialog = true; } }
  async onDeleteConfirmed() { if (this.isSaving || !this.deletingId) return; this.isSaving = true; this.showDeleteDialog = false; try { const s = this.sales.find(x => x.sale_id === this.deletingId); await this.db.run('DELETE FROM sales WHERE sale_id=?', [this.deletingId]); if (s) await this.syncIncomeForDate(s.date); await this.loadData(); } finally { this.deletingId = null; this.isSaving = false; this.cdr.detectChanges(); } }
  onDeleteCancelled() { this.showDeleteDialog = false; this.deletingId = null; }

  onFileSelected(event: any, target: any) { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const img = new Image(); img.onload = () => { const canvas = document.createElement('canvas'); const maxWidth = 800; let w = img.width, h = img.height; if (w > maxWidth) { h = (h * maxWidth) / w; w = maxWidth; } canvas.width = w; canvas.height = h; canvas.getContext('2d')!.drawImage(img, 0, 0, w, h); target.receipt_image = canvas.toDataURL('image/jpeg', 0.7); this.cdr.detectChanges(); }; img.src = reader.result as string; }; reader.readAsDataURL(file); }
  openImage(base64: string) { const win = window.open('', '_blank'); if (win) win.document.write('<img src="' + base64 + '" style="max-width:100%;">'); }


  selectedDateFilter: string = '';
  filteredByDate: boolean = false;

  get filteredTotalVehicles(): number {
    return this.filteredGroupedSales.reduce((sum, g) => sum + g.sales.length, 0);
  }

  applyDateFilter() {
    if (this.selectedDateFilter) {
      this.filteredByDate = true;
    }
  }

  clearDateFilter() {
    this.selectedDateFilter = '';
    this.filteredByDate = false;
  }
  private loadImageAsBase64(url: string): Promise<string> { return new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; canvas.getContext('2d')!.drawImage(img, 0, 0); resolve(canvas.toDataURL('image/jpeg')); }; img.onerror = () => reject(new Error('Logo load failed')); img.src = url; }); }

  // PRINT: Daily Sale


  async printDailySale(group: any) {
    const doc = new jsPDF(); const pw = doc.internal.pageSize.getWidth(); const ph = doc.internal.pageSize.getHeight();
    const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';
    const B: [number, number, number] = [0, 0, 0]; const G: [number, number, number] = [120, 120, 120]; const LG: [number, number, number] = [200, 200, 200];
    let y = 20;
    try { const id = await this.loadImageAsBase64('report-boiler.jpeg'); const ip = doc.getImageProperties(id); const lh = 35; const lw = (ip.width * lh) / ip.height; const tx = 14 + lw + 10; doc.addImage(id, 'JPEG', 14, y, lw, lh); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...B); doc.text(this.farmDisplayName, tx, y + 7); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...G); doc.text(this.farmAddress, tx, y + 12); doc.text(this.farmPhone1, tx, y + 17); doc.text(this.farmPhone2, tx, y + 22); doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...B); doc.text('DAILY SALE REPORT', tx, y + 28); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...G); doc.text('Date: ' + String(group.date).split('T')[0], tx, y + 33); doc.text('Vehicles: ' + group.sales.length, tx, y + 38); y += lh + 8; } catch { }
    doc.setDrawColor(...B); doc.line(14, y, pw - 14, y); y += 6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...B); doc.text('SUMMARY', 14, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...G); doc.text('Total Vehicles: ' + group.sales.length, 14, y); doc.setTextColor(...B); doc.text(group.totalWeight.toFixed(0) + ' kg  |  Rs. ' + group.totalAmount.toLocaleString(), 70, y); y += 10;
    const body = group.sales.map((s: any) => [s.vehicle_number || '—', s.driver_name || '—', s.broker || '—', (s.bird_weight || 0).toFixed(0) + ' kg', 'Rs. ' + (s.rate || 0).toLocaleString(), 'Rs. ' + (s.total_amount || 0).toLocaleString(), s.payment_type || 'cash']);
    autoTable(doc, { startY: y, head: [['Vehicle', 'Driver', 'Broker', 'Weight', 'Rate', 'Amount', 'Payment']], body, foot: [['', '', 'Total', group.totalWeight.toFixed(0) + ' kg', '', 'Rs. ' + group.totalAmount.toLocaleString(), '']], theme: 'plain', headStyles: { fontStyle: 'bold', fontSize: 9, textColor: B, fillColor: false as any, lineWidth: { bottom: 0.3 }, lineColor: B }, bodyStyles: { fontSize: 9, textColor: B, fillColor: false as any, lineWidth: { bottom: 0.15 }, lineColor: LG }, footStyles: { fontStyle: 'bold', fontSize: 9, textColor: B, fillColor: false as any, lineWidth: { top: 0.3 }, lineColor: B }, margin: { left: 14, right: 14 } });
    // Print receipt photos
    const photos = group.sales.filter((s: any) => s.receipt_image);
    if (photos.length > 0) {
      let photoY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...B);
      doc.text('PHOTO ATTACHMENTS', 14, photoY); photoY += 8;
      doc.setFont('helvetica', 'normal');
      for (const s of photos) {
        if (photoY > ph - 60) { doc.addPage(); photoY = 20; }
        try {
          doc.addImage(s.receipt_image, 'JPEG', 14, photoY, 45, 45);
          doc.setFontSize(7); doc.setTextColor(...G);
          doc.text((s.vehicle_number || 'Vehicle') + ' - ' + String(s.date).split('T')[0], 14, photoY + 47);
          photoY += 52;
        } catch { }
      }
    };
    doc.setFontSize(7.5); doc.setTextColor(...G); doc.text(footer, pw / 2, ph - 9, { align: 'center' }); doc.text('Page 1 of 1', pw / 2, ph - 4, { align: 'center' });
    this.printPdf(doc, 'Daily-Sale-' + String(group.date).split('T')[0] + '.pdf');
  }

  // PRINT: Broker Sale
  async printBrokerSale() {
    const brokerName = this.selectedBrokerFilter; const allBrokerSales = this.sales.filter((s: any) => s.broker === brokerName);
    if (allBrokerSales.length === 0) return;
    const tw = allBrokerSales.reduce((s: number, x: any) => s + (x.bird_weight || 0), 0); const ta = allBrokerSales.reduce((s: number, x: any) => s + (x.total_amount || 0), 0);
    const doc = new jsPDF(); const pw = doc.internal.pageSize.getWidth(); const ph = doc.internal.pageSize.getHeight();
    const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';
    const B: [number, number, number] = [0, 0, 0]; const G: [number, number, number] = [120, 120, 120]; const LG: [number, number, number] = [200, 200, 200];
    let y = 20;
    try { const id = await this.loadImageAsBase64('report-boiler.jpeg'); const ip = doc.getImageProperties(id); const lh = 35; const lw = (ip.width * lh) / ip.height; const tx = 14 + lw + 10; doc.addImage(id, 'JPEG', 14, y, lw, lh); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...B); doc.text(this.farmDisplayName, tx, y + 7); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...G); doc.text(this.farmAddress, tx, y + 12); doc.text(this.farmPhone1, tx, y + 17); doc.text(this.farmPhone2, tx, y + 22); doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...B); doc.text('BROKER SALE REPORT', tx, y + 28); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...G); doc.text('Broker: ' + brokerName, tx, y + 33); doc.text('Vehicles: ' + allBrokerSales.length, tx, y + 38); y += lh + 8; } catch { }
    doc.setDrawColor(...B); doc.line(14, y, pw - 14, y); y += 6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...B); doc.text('SUMMARY', 14, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...G); doc.text('Total Vehicles: ' + allBrokerSales.length, 14, y); doc.setTextColor(...B); doc.text(tw.toFixed(0) + ' kg  |  Rs. ' + ta.toLocaleString(), 70, y); y += 10;
    const body = allBrokerSales.map((s: any) => [String(s.date).split('T')[0], s.vehicle_number || '—', s.driver_name || '—', (s.bird_weight || 0).toFixed(0) + ' kg', 'Rs. ' + (s.rate || 0).toLocaleString(), 'Rs. ' + (s.total_amount || 0).toLocaleString(), s.payment_type || 'cash']);
    autoTable(doc, { startY: y, head: [['Date', 'Vehicle', 'Driver', 'Weight', 'Rate', 'Amount', 'Payment']], body, foot: [['', '', 'Total', tw.toFixed(0) + ' kg', '', 'Rs. ' + ta.toLocaleString(), '']], theme: 'plain', headStyles: { fontStyle: 'bold', fontSize: 9, textColor: B, fillColor: false as any, lineWidth: { bottom: 0.3 }, lineColor: B }, bodyStyles: { fontSize: 9, textColor: B, fillColor: false as any, lineWidth: { bottom: 0.15 }, lineColor: LG }, footStyles: { fontStyle: 'bold', fontSize: 9, textColor: B, fillColor: false as any, lineWidth: { top: 0.3 }, lineColor: B }, margin: { left: 14, right: 14 } });
    // Print receipt photos
    const photos = allBrokerSales.filter((s: any) => s.receipt_image);
    if (photos.length > 0) {
      let photoY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...B);
      doc.text('PHOTO ATTACHMENTS', 14, photoY); photoY += 8;
      doc.setFont('helvetica', 'normal');
      for (const s of photos) {
        if (photoY > ph - 60) { doc.addPage(); photoY = 20; }
        try {
          doc.addImage(s.receipt_image, 'JPEG', 14, photoY, 45, 45);
          doc.setFontSize(7); doc.setTextColor(...G);
          doc.text((s.vehicle_number || 'Vehicle') + ' - ' + String(s.date).split('T')[0], 14, photoY + 47);
          photoY += 52;
        } catch { }
      }
    };
    doc.setFontSize(7.5); doc.setTextColor(...G); doc.text(footer, pw / 2, ph - 9, { align: 'center' }); doc.text('Page 1 of 1', pw / 2, ph - 4, { align: 'center' });
    this.printPdf(doc, 'Broker-' + brokerName + '-Sale.pdf');
  }

  // PRINT: Driver Receipt — 3-part voucher (Driver / Supervisor / Farm copy) on one page
  async printDriverReceipt(row: any) {
    const isSaved = row.sale_id !== undefined;
    const brokerName = isSaved ? (row.broker || '—') : this.getBrokerName(row.broker_id);
    const birdWeight = isSaved ? (row.bird_weight || 0) : this.getRowBirdWeight(row);
    const totalAmount = isSaved ? (row.total_amount || 0) : this.getRowTotal(row);
    const rate = row.rate || 0;
    const emptyWeight = row.empty_weight || 0;
    const loadWeight = row.load_weight || 0;
    const paymentType = row.payment_type || 'cash';
    const date = row.date ? String(row.date).split('T')[0] : '—';

    const doc = new jsPDF();
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';
    const B: [number, number, number] = [0, 0, 0];
    const G: [number, number, number] = [120, 120, 120];
    const LG: [number, number, number] = [200, 200, 200];

    let logoData: string | null = null;
    let logoW = 0, logoH = 0;
    try {
      logoData = await this.loadImageAsBase64('report-boiler.jpeg');
      const ip = doc.getImageProperties(logoData);
      logoH = 16;
      logoW = (ip.width * logoH) / ip.height;
    } catch { }

    const marginX = 12;
    const usableHeight = ph - 16; // leave room for footer strip
    const sectionHeight = usableHeight / 3;
    const copyLabels = ['DRIVER COPY', 'SUPERVISOR COPY', 'FARM COPY'];

    const drawVoucher = (top: number, label: string) => {
      let y = top + 8;

      // Header row: logo + farm name (left), copy label (right)
      if (logoData) {
        doc.addImage(logoData, 'JPEG', marginX, top + 3, logoW, logoH);
      }
      const textX = marginX + (logoData ? logoW + 6 : 0);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...B);
      doc.text(this.farmDisplayName, textX, top + 9);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...G);
      doc.text(this.farmAddress, textX, top + 13);
      doc.text(this.farmPhone1, textX, top + 17);
      doc.text(this.farmPhone2, textX, top + 21);

      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...B);
      doc.text(label, pw - marginX, top + 8, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...G);
      doc.text('Date: ' + date, pw - marginX, top + 13, { align: 'right' });

      y = top + 24;
      doc.setDrawColor(...B); doc.setLineWidth(0.3);
      doc.line(marginX, y, pw - marginX, y);
      y += 6;

      // Two-column compact details
      const leftCol: [string, string][] = [
        ['Vehicle #', row.vehicle_number || '—'],
        ['Driver Name', row.driver_name || '—'],
        ['Driver Phone', row.driver_phone || '—'],
        ['Broker', brokerName],
      ];
      const rightCol: [string, string][] = [
        ['Empty Wt', emptyWeight.toFixed(0) + ' kg'],
        ['Load Wt', loadWeight.toFixed(0) + ' kg'],
        ['Bird Wt', birdWeight.toFixed(0) + ' kg'],
        ['Rate', 'Rs. ' + rate.toLocaleString()],
      ];

      doc.setFontSize(9);
      let ly = y, ry = y;
      for (const [lbl, val] of leftCol) {
        doc.setFont('helvetica', 'normal'); doc.setTextColor(...G);
        doc.text(lbl + ':', marginX, ly);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(...B);
        doc.text(String(val), marginX + 32, ly);
        ly += 5.5;
      }
      const rightX = pw / 2 + 4;
      for (const [lbl, val] of rightCol) {
        doc.setFont('helvetica', 'normal'); doc.setTextColor(...G);
        doc.text(lbl + ':', rightX, ry);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(...B);
        doc.text(String(val), rightX + 28, ry);
        ry += 5.5;
      }

      y = Math.max(ly, ry) + 2;

      // Total amount + payment type — emphasized line
      doc.setDrawColor(...LG); doc.setLineWidth(0.2);
      doc.line(marginX, y, pw - marginX, y);
      y += 6;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...B);
      doc.text('Total: Rs. ' + totalAmount.toLocaleString(), marginX, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...G);
      doc.text('Payment: ' + paymentType.toUpperCase(), pw - marginX, y, { align: 'right' });

      // Signatures
      const sigY = top + sectionHeight - 8;
      doc.setDrawColor(...B); doc.setLineWidth(0.2);
      doc.setFontSize(7.5); doc.setTextColor(...G);
      doc.text('_______________________', marginX, sigY);
      doc.text('Driver Signature', marginX, sigY + 4);
      doc.text('_______________________', pw - marginX - 45, sigY);
      doc.text('Authorized Signature', pw - marginX - 45, sigY + 4);
    };

    for (let i = 0; i < 3; i++) {
      const top = i * sectionHeight;
      drawVoucher(top, copyLabels[i]);
      if (i < 2) {
        doc.setDrawColor(...LG);
        doc.setLineWidth(0.3);
        (doc as any).setLineDashPattern([2, 1.5], 0);
        doc.line(marginX - 4, top + sectionHeight, pw - marginX + 4, top + sectionHeight);
        (doc as any).setLineDashPattern([], 0);
        doc.setFontSize(6.5); doc.setTextColor(...G);
        doc.text('✂ cut here', pw / 2, top + sectionHeight - 1, { align: 'center' });
      }
    }





    doc.setFontSize(6.5); doc.setTextColor(...G);
    doc.text(footer, pw / 2, ph - 3, { align: 'center' });

    this.printPdf(doc, 'Driver-Receipt-' + (row.vehicle_number || 'vehicle') + '-' + date + '.pdf');
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