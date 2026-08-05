import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';
import { PendingStateService } from '../shared/services/pending-state.service';
import { PaginationComponent } from '../shared/components/pagination/pagination.component';
import { FlockService } from '../shared/services/flock.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-egg-sales',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe, PaginationComponent],
  templateUrl: './egg-sales.component.html',
  styleUrl: './egg-sales.component.scss'
})
export class EggSalesComponent implements OnInit, OnDestroy {
  currentFarm: any = null;
  batches: any[] = [];
  sales: any[] = [];
  pendingRows: any[] = [];
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  isSavingAll = false;
  errorMessage = '';

  // Available (sellable) eggs per batch = collected (total - broken) minus already sold.
  availableByBatch: { [batchId: number]: number } = {};
  collectedByBatch: { [batchId: number]: number } = {};
  private editOriginalQty = 0;
  private editOriginalBatch: any = null;
  private editOriginalDate: string = '';

  currentPage = 1;
  pageSize = 20;

  selectedBatchFilter: string = 'all';
  private subs = new Subscription();

  get filteredSales() {
    if (this.selectedBatchFilter === 'all') return this.sales;
    return this.sales.filter(s => String(s.batch_id) === String(this.selectedBatchFilter));
  }

  get paginatedSales() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredSales.slice(start, start + this.pageSize);
  }

  get hasPendingRows(): boolean { return this.pendingRows.length > 0; }

  // ── Stock Summary (respects batch filter) ────────────────────
  get summaryCollected(): number {
    if (this.selectedBatchFilter === 'all') {
      return Object.values(this.collectedByBatch).reduce((s: number, v: number) => s + v, 0);
    }
    return this.collectedByBatch[+this.selectedBatchFilter] || 0;
  }

  get summarySold(): number {
    const src = this.selectedBatchFilter === 'all'
      ? this.sales
      : this.sales.filter(s => String(s.batch_id) === String(this.selectedBatchFilter));
    return src.reduce((s, sale) => s + (sale.quantity || 0), 0);
  }

  get summaryInStock(): number { return this.summaryCollected - this.summarySold; }

  get summaryBatchLabel(): string {
    if (this.selectedBatchFilter === 'all') return 'All Batches';
    return this.getBatchName(+this.selectedBatchFilter);
  }

  getAvailableEggs(batchId: number): number {
    return Math.max(0, this.availableByBatch[batchId] ?? 0);
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'a') { event.preventDefault(); this.addPendingRow(); }
    if (event.ctrlKey && event.key === 's') { event.preventDefault(); if (this.hasPendingRows) this.saveAllRows(); }
  }

  constructor(private db: DatabaseService, private authService: AuthService, private cdr: ChangeDetectorRef, private pendingState: PendingStateService, private flockService: FlockService) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadData();
    const cached = this.pendingState.getState('EggSalesComponent');
    if (cached?.farmId === this.currentFarm?.farm_id) this.pendingRows = cached.pendingRows || [];
    this.applyActiveBatch(this.flockService.getCurrentFlock());
    this.subs.add(
      this.flockService.currentFlock$.subscribe(flock => this.applyActiveBatch(flock))
    );
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    this.pendingState.saveState('EggSalesComponent', { farmId: this.currentFarm?.farm_id, pendingRows: this.pendingRows });
  }

  private applyActiveBatch(flock: any) {
    if (!flock?.batch_id) return;
    const batchId = String(flock.batch_id);
    if (this.selectedBatchFilter === batchId) return;
    this.selectedBatchFilter = batchId;
    this.currentPage = 1;
    this.cdr.detectChanges();
  }

  async loadData() {
    const bRes = await this.db.get(`SELECT * FROM batches WHERE farm_id = ? AND status = 'active' ORDER BY batch_id DESC`, [this.currentFarm.farm_id]);
    this.batches = bRes.success ? bRes.data : [];
    const sRes = await this.db.get(`SELECT es.*, b.batch_name FROM egg_sales es JOIN batches b ON es.batch_id = b.batch_id WHERE b.farm_id = ? ORDER BY es.date DESC`, [this.currentFarm.farm_id]);
    this.sales = sRes.success ? sRes.data : [];

    // Recompute available eggs per active batch: collected sellable eggs minus sold.
    this.availableByBatch = {};
    for (const b of this.batches) {
      const colRes = await this.db.get(
        `SELECT COALESCE(SUM(total_eggs - broken_eggs), 0) AS collected FROM egg_collection WHERE batch_id = ?`,
        [b.batch_id]
      );
      const soldRes = await this.db.get(
        `SELECT COALESCE(SUM(quantity), 0) AS sold FROM egg_sales WHERE batch_id = ?`,
        [b.batch_id]
      );
      const collected = colRes.success ? Number(colRes.data[0]?.collected || 0) : 0;
      const sold = soldRes.success ? Number(soldRes.data[0]?.sold || 0) : 0;
      this.collectedByBatch[b.batch_id] = collected;
      this.availableByBatch[b.batch_id] = collected - sold;
    }
    this.cdr.detectChanges();
  }

  getBatchName(id: number) { return this.batches.find(b => b.batch_id === id)?.batch_name || '—'; }

  makeNewRow() { return { batch_id: this.selectedBatchFilter !== 'all' ? Number(this.selectedBatchFilter) : (this.batches[0]?.batch_id || null), date: new Date().toISOString().split('T')[0], customer_name: '', grade: 'mixed', quantity: null, rate_per_egg: null, amount: null, payment_type: 'cash' }; }

  addPendingRow() { if (!this.isSaving) { this.editingId = null; this.pendingRows.push(this.makeNewRow()); } }
  addRowAfter(i: number) { this.pendingRows.splice(i + 1, 0, this.makeNewRow()); }
  removePendingRow(i: number) { this.pendingRows.splice(i, 1); }

  async saveAllRows() {
    if (!this.pendingRows.length || this.isSavingAll) return;
    this.errorMessage = '';

    // Validate every row before saving any (presence, negatives, stock).
    const remaining: { [batchId: number]: number } = {};
    for (const row of this.pendingRows) {
      const qty = Number(row.quantity);
      const rate = Number(row.rate_per_egg);
      if (!row.batch_id || !row.date || !row.quantity || !row.rate_per_egg) {
        this.errorMessage = 'Each row needs a batch, date, quantity and rate.';
        this.cdr.detectChanges(); return;
      }
      if (qty <= 0 || rate < 0) {
        this.errorMessage = 'Quantity must be greater than 0 and rate cannot be negative.';
        this.cdr.detectChanges(); return;
      }
      const avail = remaining[row.batch_id] ?? this.getAvailableEggs(row.batch_id);
      if (qty > avail) {
        this.errorMessage = `Only ${avail} egg(s) available for ${this.getBatchName(row.batch_id)}.`;
        this.cdr.detectChanges(); return;
      }
      remaining[row.batch_id] = avail - qty;
    }

    this.isSavingAll = true;
    try {
      const uniqueSyncs = new Map<string, { batchId: number, date: string }>();
      for (const row of this.pendingRows) {
        await this.db.run(`INSERT INTO egg_sales (batch_id, date, customer_name, grade, quantity, rate_per_egg, total_amount, payment_type) VALUES (?,?,?,?,?,?,?,?)`,
          [row.batch_id, row.date, row.customer_name, row.grade, row.quantity, row.rate_per_egg, (row.amount !== null && row.amount !== undefined && row.amount !== '') ? Number(row.amount) : row.quantity * row.rate_per_egg, row.payment_type]);
        uniqueSyncs.set(`${row.batch_id}_${row.date}`, { batchId: Number(row.batch_id), date: row.date });
      }
      for (const sync of uniqueSyncs.values()) {
        await this.syncIncomeForEggSale(sync.date, sync.batchId);
      }
      this.pendingRows = [];
      await this.loadData();
    } finally { this.isSavingAll = false; this.cdr.detectChanges(); }
  }

  cancelAllRows() { this.pendingRows = []; }

  startEdit(s: any) {
    if (this.isSaving) return;
    this.pendingRows = [];
    this.editingId = s.egg_sale_id;
    this.editOriginalQty = Number(s.quantity) || 0;
    this.editOriginalBatch = s.batch_id;
    this.editOriginalDate = s.date;
    this.editForm = { batch_id: s.batch_id, date: s.date, customer_name: s.customer_name, grade: s.grade, quantity: s.quantity, rate_per_egg: s.rate_per_egg, amount: s.total_amount, payment_type: s.payment_type };
  }

  cancelEdit() { if (!this.isSaving) { this.editingId = null; this.editForm = {}; } }

  async saveEdit(id: number) {
    if (this.isSaving) return;
    const qty = Number(this.editForm.quantity);
    const rate = Number(this.editForm.rate_per_egg);
    this.errorMessage = '';
    if (!this.editForm.batch_id || !this.editForm.date || !qty || !this.editForm.rate_per_egg) {
      this.errorMessage = 'Batch, date, quantity and rate are required.'; this.cdr.detectChanges(); return;
    }
    if (qty <= 0 || rate < 0) {
      this.errorMessage = 'Quantity must be greater than 0 and rate cannot be negative.'; this.cdr.detectChanges(); return;
    }
    // The eggs already booked to this sale are available again while editing it,
    // but only for the batch they were originally booked against.
    const currentAvail = this.availableByBatch[this.editForm.batch_id] || 0;
    const allowed = currentAvail +
      (String(this.editForm.batch_id) === String(this.editOriginalBatch) ? this.editOriginalQty : 0);
      
    if (qty > allowed) {
      this.errorMessage = `Only ${allowed} egg(s) available for ${this.getBatchName(this.editForm.batch_id)}.`;
      this.cdr.detectChanges(); return;
    }
    this.isSaving = true; this.editingId = null;
    await this.db.run(`UPDATE egg_sales SET batch_id=?, date=?, customer_name=?, grade=?, quantity=?, rate_per_egg=?, total_amount=?, payment_type=? WHERE egg_sale_id=?`,
      [this.editForm.batch_id, this.editForm.date, this.editForm.customer_name, this.editForm.grade, this.editForm.quantity, this.editForm.rate_per_egg, (this.editForm.amount !== null && this.editForm.amount !== undefined && this.editForm.amount !== '') ? Number(this.editForm.amount) : this.editForm.quantity * this.editForm.rate_per_egg, this.editForm.payment_type, id]);
    
    await this.syncIncomeForEggSale(this.editForm.date, this.editForm.batch_id);
    if (this.editForm.date !== this.editOriginalDate || String(this.editForm.batch_id) !== String(this.editOriginalBatch)) {
      await this.syncIncomeForEggSale(this.editOriginalDate, this.editOriginalBatch);
    }
    
    this.editForm = {};
    await this.loadData();
    this.isSaving = false; this.cdr.detectChanges();
  }

  confirmDelete(id: number) { if (!this.isSaving) { this.deletingId = id; this.showDeleteDialog = true; } }

  async onDeleteConfirmed() {
    if (this.isSaving || !this.deletingId) return;
    this.isSaving = true; this.showDeleteDialog = false;
    
    const sale = this.sales.find((s: any) => s.egg_sale_id === this.deletingId);
    if (sale) {
      const delDate = sale.date;
      const delBatch = sale.batch_id;
      await this.db.run('DELETE FROM egg_sales WHERE egg_sale_id = ?', [this.deletingId]);
      await this.syncIncomeForEggSale(delDate, delBatch);
    } else {
      await this.db.run('DELETE FROM egg_sales WHERE egg_sale_id = ?', [this.deletingId]);
    }
    
    this.deletingId = null; this.isSaving = false;
    await this.loadData();
  }

  onDeleteCancelled() { this.showDeleteDialog = false; this.deletingId = null; }

  async syncIncomeForEggSale(date: string, batchId: number) {
    const sr = await this.db.get(`SELECT SUM(total_amount) as total_amount, SUM(quantity) as total_qty FROM egg_sales WHERE date=? AND batch_id=?`, [date, batchId]);
    const totalAmount = sr.success && sr.data[0] ? Number(sr.data[0].total_amount || 0) : 0;
    const totalQty = sr.success && sr.data[0] ? Number(sr.data[0].total_qty || 0) : 0;

    const exist = await this.db.get(`SELECT income_id FROM income WHERE flock_id=? AND date=? AND source='egg_sale' AND module_type='layer'`, [batchId, date]);
    
    if (totalAmount <= 0) {
      if (exist.success && exist.data.length > 0) {
        await this.db.run(`DELETE FROM income WHERE income_id=?`, [exist.data[0].income_id]);
      }
    } else {
      const desc = `Egg Sale — ${totalQty} eggs`;
      if (exist.success && exist.data.length > 0) {
        await this.db.run(`UPDATE income SET amount=?, description=? WHERE income_id=?`, [totalAmount, desc, exist.data[0].income_id]);
      } else {
        await this.db.run(`INSERT INTO income (flock_id, date, description, amount, source, module_type) VALUES (?, ?, ?, ?, ?, ?)`,
          [batchId, date, desc, totalAmount, 'egg_sale', 'layer']);
      }
    }
  }
}
