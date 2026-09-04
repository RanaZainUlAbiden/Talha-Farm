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
import { FarmUnitService } from '../shared/services/farm-unit.service';
import { Subscription } from 'rxjs';

import { toLocalDateString } from '../shared/utils/date.util';
@Component({
  selector: 'app-hen-sales',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe, PaginationComponent],
  templateUrl: './hen-sales.component.html',
  styleUrl: './hen-sales.component.scss'
})
export class HenSalesComponent implements OnInit, OnDestroy {
  currentFarm: any = null;
  batches: any[] = [];
  sales: any[] = [];
  // All layer farms for this account — drives the unit_id filter below.
  units: any[] = [];
  // The farm currently selected in the sidebar.
  currentUnit: any = null;
  pendingRows: any[] = [];
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  isSavingAll = false;
  errorMessage = '';

  // Available (sellable) hens per batch = initial_birds - mortality - already sold.
  mortalityByBatch: { [batchId: number]: number } = {};
  soldByBatch: { [batchId: number]: number } = {};

  private editOriginalQty = 0;
  private editOriginalBatch: any = null;

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
  get summaryInitial(): number {
    const batches = this.selectedBatchFilter === 'all'
      ? this.batches
      : this.batches.filter(b => String(b.batch_id) === this.selectedBatchFilter);
    return batches.reduce((s, b) => s + (b.initial_birds || 0), 0);
  }

  get summaryMortality(): number {
    if (this.selectedBatchFilter === 'all') {
      return Object.values(this.mortalityByBatch).reduce((s: number, v: number) => s + v, 0);
    }
    return this.mortalityByBatch[+this.selectedBatchFilter] || 0;
  }

  get summarySold(): number {
    const src = this.selectedBatchFilter === 'all'
      ? this.sales
      : this.sales.filter(s => String(s.batch_id) === String(this.selectedBatchFilter));
    return src.reduce((s, sale) => s + (sale.quantity || 0), 0);
  }

  get summaryAlive(): number {
    return Math.max(0, this.summaryInitial - this.summaryMortality - this.summarySold);
  }

  get summaryBatchLabel(): string {
    if (this.selectedBatchFilter === 'all') return 'All Batches';
    return this.getBatchName(+this.selectedBatchFilter);
  }

  getAvailableHens(batchId: number): number {
    const batch = this.batches.find(b => b.batch_id === batchId);
    const initial = batch?.initial_birds || 0;
    const mortality = this.mortalityByBatch[batchId] || 0;
    const sold = this.soldByBatch[batchId] || 0;
    return Math.max(0, initial - mortality - sold);
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'a') { event.preventDefault(); this.addPendingRow(); }
    if (event.ctrlKey && event.key === 's') { event.preventDefault(); if (this.hasPendingRows) this.saveAllRows(); }
  }

  constructor(private db: DatabaseService, private authService: AuthService, private cdr: ChangeDetectorRef, private pendingState: PendingStateService, private flockService: FlockService, private farmUnitService: FarmUnitService) {}

  async ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    // Load units first — the currentUnit$ subscription below fires
    // synchronously (BehaviorSubject) and its filtering depends on
    // this.units already being populated.
    await this.loadUnits();
    await this.loadData();
    const cached = this.pendingState.getState('HenSalesComponent');
    if (cached?.farmId === this.currentFarm?.farm_id) this.pendingRows = cached.pendingRows || [];
    this.applyActiveBatch(this.flockService.getCurrentFlock());
    this.subs.add(
      this.flockService.currentFlock$.subscribe(flock => this.applyActiveBatch(flock))
    );

    this.subs.add(
      this.farmUnitService.currentUnit$.subscribe(unit => {
        this.currentUnit = unit;
        this.loadData();
      })
    );

    this.subs.add(
      this.farmUnitService.unitsChanged$.subscribe(async () => {
        await this.loadUnits();
        this.loadData();
      })
    );
  }

  async loadUnits() {
    const result = await this.db.getFarmUnits(this.currentFarm.farm_id, 'layer');
    this.units = result.success ? result.data : [];
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    this.pendingState.saveState('HenSalesComponent', { farmId: this.currentFarm?.farm_id, pendingRows: this.pendingRows });
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
    // No farms yet for this account — behave exactly as before the farm
    // selector existed rather than filtering to an empty list.
    const unitId = this.units.length > 0 ? this.currentUnit?.unit_id : undefined;

    const bSql = unitId
      ? `SELECT * FROM batches WHERE farm_id = ? AND status = 'active' AND unit_id = ? ORDER BY batch_id DESC`
      : `SELECT * FROM batches WHERE farm_id = ? AND status = 'active' ORDER BY batch_id DESC`;
    const bParams = unitId ? [this.currentFarm.farm_id, unitId] : [this.currentFarm.farm_id];
    const bRes = await this.db.get(bSql, bParams);
    this.batches = bRes.success ? bRes.data : [];

    const sSql = unitId
      ? `SELECT hs.*, b.batch_name FROM hen_sales hs JOIN batches b ON hs.batch_id = b.batch_id WHERE b.farm_id = ? AND b.unit_id = ? ORDER BY hs.date DESC`
      : `SELECT hs.*, b.batch_name FROM hen_sales hs JOIN batches b ON hs.batch_id = b.batch_id WHERE b.farm_id = ? ORDER BY hs.date DESC`;
    const sParams = unitId ? [this.currentFarm.farm_id, unitId] : [this.currentFarm.farm_id];
    const sRes = await this.db.get(sSql, sParams);
    this.sales = sRes.success ? sRes.data : [];

    this.mortalityByBatch = {};
    this.soldByBatch = {};
    for (const b of this.batches) {
      const mortRes = await this.db.get(
        `SELECT COALESCE(SUM(count), 0) AS total FROM layer_mortality WHERE batch_id = ?`,
        [b.batch_id]
      );
      this.mortalityByBatch[b.batch_id] = mortRes.success ? Number(mortRes.data[0]?.total || 0) : 0;

      const soldRes = await this.db.get(
        `SELECT COALESCE(SUM(quantity), 0) AS total FROM hen_sales WHERE batch_id = ?`,
        [b.batch_id]
      );
      this.soldByBatch[b.batch_id] = soldRes.success ? Number(soldRes.data[0]?.total || 0) : 0;
    }
    this.cdr.detectChanges();
  }

  getBatchName(id: number) { return this.batches.find(b => b.batch_id === id)?.batch_name || '—'; }

  makeNewRow() {
    return {
      batch_id: this.selectedBatchFilter !== 'all' ? Number(this.selectedBatchFilter) : (this.batches[0]?.batch_id || null),
      date: toLocalDateString(),
      customer_name: '',
      quantity: null,
      rate_per_hen: null,
      amount: null,
      payment_type: 'cash'
    };
  }

  addPendingRow() { if (!this.isSaving) { this.editingId = null; this.pendingRows.push(this.makeNewRow()); } }
  addRowAfter(i: number) { this.pendingRows.splice(i + 1, 0, this.makeNewRow()); }
  removePendingRow(i: number) { this.pendingRows.splice(i, 1); }

  async saveAllRows() {
    if (!this.pendingRows.length || this.isSavingAll) return;
    this.errorMessage = '';

    const remaining: { [batchId: number]: number } = {};
    for (const row of this.pendingRows) {
      const qty = Number(row.quantity);
      const rate = Number(row.rate_per_hen);
      if (!row.batch_id || !row.date || !row.quantity || !row.rate_per_hen) {
        this.errorMessage = 'Each row needs a batch, date, quantity and rate.';
        this.cdr.detectChanges(); return;
      }
      if (qty <= 0 || rate < 0) {
        this.errorMessage = 'Quantity must be greater than 0 and rate cannot be negative.';
        this.cdr.detectChanges(); return;
      }
      const avail = remaining[row.batch_id] ?? this.getAvailableHens(row.batch_id);
      if (qty > avail) {
        this.errorMessage = `Only ${avail} hen(s) available for ${this.getBatchName(row.batch_id)}.`;
        this.cdr.detectChanges(); return;
      }
      remaining[row.batch_id] = avail - qty;
    }

    this.isSavingAll = true;
    try {
      for (const row of this.pendingRows) {
        await this.db.run(
          `INSERT INTO hen_sales (batch_id, date, customer_name, quantity, rate_per_hen, total_amount, payment_type) VALUES (?,?,?,?,?,?,?)`,
          [row.batch_id, row.date, row.customer_name, row.quantity, row.rate_per_hen,
           (row.amount !== null && row.amount !== undefined && row.amount !== '') ? Number(row.amount) : row.quantity * row.rate_per_hen,
           row.payment_type]
        );
      }
      const uniqueSyncs = new Map<string, { batchId: number, date: string }>();
      for (const row of this.pendingRows) {
        uniqueSyncs.set(`${row.batch_id}_${row.date}`, { batchId: Number(row.batch_id), date: row.date });
      }
      for (const sync of uniqueSyncs.values()) {
        await this.syncIncomeForHenSale(sync.date, sync.batchId);
      }
      this.pendingRows = [];
      await this.loadData();
    } finally { this.isSavingAll = false; this.cdr.detectChanges(); }
  }

  cancelAllRows() { this.pendingRows = []; }

  startEdit(s: any) {
    if (this.isSaving) return;
    this.pendingRows = [];
    this.editingId = s.hen_sale_id;
    this.editOriginalQty = Number(s.quantity) || 0;
    this.editOriginalBatch = s.batch_id;
    this.editForm = { batch_id: s.batch_id, date: s.date, customer_name: s.customer_name, quantity: s.quantity, rate_per_hen: s.rate_per_hen, amount: s.total_amount, payment_type: s.payment_type };
  }

  cancelEdit() { if (!this.isSaving) { this.editingId = null; this.editForm = {}; } }

  async saveEdit(id: number) {
    if (this.isSaving) return;
    const qty = Number(this.editForm.quantity);
    const rate = Number(this.editForm.rate_per_hen);
    this.errorMessage = '';
    if (!this.editForm.batch_id || !this.editForm.date || !qty || !this.editForm.rate_per_hen) {
      this.errorMessage = 'Batch, date, quantity and rate are required.'; this.cdr.detectChanges(); return;
    }
    if (qty <= 0 || rate < 0) {
      this.errorMessage = 'Quantity must be greater than 0 and rate cannot be negative.'; this.cdr.detectChanges(); return;
    }
    const currentAvail = this.getAvailableHens(this.editForm.batch_id);
    const sameBatch = String(this.editForm.batch_id) === String(this.editOriginalBatch);
    const allowed = currentAvail + (sameBatch ? this.editOriginalQty : 0);

    if (qty > allowed) {
      this.errorMessage = `Only ${allowed} hen(s) available for ${this.getBatchName(this.editForm.batch_id)}.`;
      this.cdr.detectChanges(); return;
    }

    this.isSaving = true; this.editingId = null;
    const oldDate = this.sales.find(s => s.hen_sale_id === id)?.date;
    const oldBatch = this.editOriginalBatch;

    await this.db.run(
      `UPDATE hen_sales SET batch_id=?, date=?, customer_name=?, quantity=?, rate_per_hen=?, total_amount=?, payment_type=? WHERE hen_sale_id=?`,
      [this.editForm.batch_id, this.editForm.date, this.editForm.customer_name, this.editForm.quantity, this.editForm.rate_per_hen,
       (this.editForm.amount !== null && this.editForm.amount !== undefined && this.editForm.amount !== '') ? Number(this.editForm.amount) : this.editForm.quantity * this.editForm.rate_per_hen,
       this.editForm.payment_type, id]
    );

    await this.syncIncomeForHenSale(this.editForm.date, this.editForm.batch_id);
    if (oldDate && (oldDate !== this.editForm.date || String(oldBatch) !== String(this.editForm.batch_id))) {
      await this.syncIncomeForHenSale(oldDate, oldBatch);
    }

    this.editForm = {};
    await this.loadData();
    this.isSaving = false; this.cdr.detectChanges();
  }

  confirmDelete(id: number) { if (!this.isSaving) { this.deletingId = id; this.showDeleteDialog = true; } }

  async onDeleteConfirmed() {
    if (this.isSaving || !this.deletingId) return;
    this.isSaving = true; this.showDeleteDialog = false;

    const sale = this.sales.find((s: any) => s.hen_sale_id === this.deletingId);
    if (sale) {
      const delDate = sale.date;
      const delBatch = sale.batch_id;
      await this.db.run('DELETE FROM hen_sales WHERE hen_sale_id = ?', [this.deletingId]);
      await this.syncIncomeForHenSale(delDate, delBatch);
    } else {
      await this.db.run('DELETE FROM hen_sales WHERE hen_sale_id = ?', [this.deletingId]);
    }

    this.deletingId = null; this.isSaving = false;
    await this.loadData();
  }

  onDeleteCancelled() { this.showDeleteDialog = false; this.deletingId = null; }

  async syncIncomeForHenSale(date: string, batchId: number) {
    const sr = await this.db.get(`SELECT SUM(total_amount) as total_amount, SUM(quantity) as total_qty FROM hen_sales WHERE date=? AND batch_id=?`, [date, batchId]);
    const totalAmount = sr.success && sr.data[0] ? Number(sr.data[0].total_amount || 0) : 0;
    const totalQty = sr.success && sr.data[0] ? Number(sr.data[0].total_qty || 0) : 0;

    const exist = await this.db.get(`SELECT income_id FROM income WHERE flock_id=? AND date=? AND source='hen_sale' AND module_type='layer'`, [batchId, date]);

    if (totalAmount <= 0) {
      if (exist.success && exist.data.length > 0) {
        await this.db.run(`DELETE FROM income WHERE income_id=?`, [exist.data[0].income_id]);
      }
    } else {
      const desc = `Hen Sale — ${totalQty} hens`;
      if (exist.success && exist.data.length > 0) {
        await this.db.run(`UPDATE income SET amount=?, description=? WHERE income_id=?`, [totalAmount, desc, exist.data[0].income_id]);
      } else {
        await this.db.run(`INSERT INTO income (flock_id, date, description, amount, source, module_type) VALUES (?, ?, ?, ?, ?, ?)`,
          [batchId, date, desc, totalAmount, 'hen_sale', 'layer']);
      }
    }
  }
}