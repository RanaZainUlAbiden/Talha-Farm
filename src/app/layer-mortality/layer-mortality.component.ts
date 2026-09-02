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

@Component({
  selector: 'app-layer-mortality',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe, PaginationComponent],
  templateUrl: './layer-mortality.component.html',
  styleUrl: './layer-mortality.component.scss'
})
export class LayerMortalityComponent implements OnInit, OnDestroy {
  currentFarm: any = null;
  batches: any[] = [];
  records: any[] = [];
  // All layer farms for this account — drives the unit_id filter below.
  units: any[] = [];
  // The farm currently selected in the sidebar.
  currentUnit: any = null;
  pendingRows: any[] = [];
  currentBatchId: number | null = null;
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  isSavingAll = false;

  currentPage = 1;
  pageSize = 20;
  private subs = new Subscription();

  get paginatedRecords() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.records.slice(start, start + this.pageSize);
  }

  get selectedBatch(): any { return this.batches.find(b => b.batch_id === this.currentBatchId) || this.batches[0]; }
   
  get totalMortalityCount(): number { 
    const batchId = this.selectedBatch?.batch_id;
    return this.records.filter(r => r.batch_id === batchId).reduce((sum, r) => sum + (r.count || 0), 0); 
  }
   
  get aliveHens(): number { 
    return (this.selectedBatch?.initial_birds || 0) - this.totalMortalityCount; 
  }
   
  get mortalityRate(): number { 
    const initial = this.selectedBatch?.initial_birds || 0;
    return initial > 0 ? (this.totalMortalityCount / initial) * 100 : 0; 
  }

  get hasPendingRows(): boolean { return this.pendingRows.length > 0; }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'a') {
      const activeTag = (event.target as HTMLElement)?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      event.preventDefault();
      this.addPendingRow();
    }
    if (event.ctrlKey && event.key === 's') {
      event.preventDefault();
      if (this.hasPendingRows) this.saveAllRows();
    }
  }

  constructor(private db: DatabaseService, private authService: AuthService, private cdr: ChangeDetectorRef, private pendingState: PendingStateService, private flockService: FlockService, private farmUnitService: FarmUnitService) {}

  async ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    // Load units first — the currentUnit$ subscription below fires
    // synchronously (BehaviorSubject) and its filtering depends on
    // this.units already being populated.
    await this.loadUnits();
    await this.loadData();
    const cached = this.pendingState.getState('LayerMortalityComponent');
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
    this.pendingState.saveState('LayerMortalityComponent', { farmId: this.currentFarm?.farm_id, pendingRows: this.pendingRows });
  }

  private applyActiveBatch(flock: any) {
    if (!flock?.batch_id) return;
    const batchId = Number(flock.batch_id);
    if (this.currentBatchId === batchId) return;
    this.currentBatchId = batchId;
    this.currentPage = 1;
    this.cdr.detectChanges();
  }

  async loadData() {
    // No farms yet for this account — behave exactly as before the farm
    // selector existed rather than filtering to an empty list.
    const unitId = this.units.length > 0 ? this.currentUnit?.unit_id : undefined;

    const brSql = unitId
      ? `SELECT * FROM batches WHERE farm_id=? AND status='active' AND unit_id=?`
      : `SELECT * FROM batches WHERE farm_id=? AND status='active'`;
    const brParams = unitId ? [this.currentFarm.farm_id, unitId] : [this.currentFarm.farm_id];
    const br = await this.db.get(brSql, brParams);
    this.batches = br.success ? br.data : [];

    if (!this.batches.find(b => b.batch_id === this.currentBatchId)) {
      this.currentBatchId = this.batches.length > 0 ? this.batches[0].batch_id : null;
    }

    const mrSql = unitId
      ? `SELECT m.*, b.batch_name FROM layer_mortality m JOIN batches b ON m.batch_id=b.batch_id WHERE b.farm_id=? AND b.unit_id=? ORDER BY m.date DESC`
      : `SELECT m.*, b.batch_name FROM layer_mortality m JOIN batches b ON m.batch_id=b.batch_id WHERE b.farm_id=? ORDER BY m.date DESC`;
    const mrParams = unitId ? [this.currentFarm.farm_id, unitId] : [this.currentFarm.farm_id];
    const mr = await this.db.get(mrSql, mrParams);
    this.records = mr.success ? mr.data : [];
    this.cdr.detectChanges();
  }

  getBatchName(id: number) { return this.batches.find(b => b.batch_id === id)?.batch_name || '—'; }

  makeNewRow() { 
    const defaultBatchId = this.currentBatchId || this.batches[0]?.batch_id;
    return { batch_id: defaultBatchId, date: new Date().toISOString().split('T')[0], count: null, reason: '' }; 
  }
  addPendingRow() { if (!this.isSaving) this.pendingRows.push(this.makeNewRow()); }
  addRowAfter(i: number) { this.pendingRows.splice(i + 1, 0, this.makeNewRow()); }
  removePendingRow(i: number) { this.pendingRows.splice(i, 1); }

  async saveAllRows() {
    if (!this.pendingRows.length || this.isSavingAll) return;
    this.isSavingAll = true;
    for (const row of this.pendingRows) {
      if (!row.batch_id || !row.date || !row.count || Number(row.count) < 0) continue;
      await this.db.run(`INSERT INTO layer_mortality (batch_id, date, count, reason) VALUES (?,?,?,?)`, [row.batch_id, row.date, row.count, row.reason]);
    }
    this.pendingRows = [];
    this.isSavingAll = false;
    await this.loadData();
  }

  cancelAllRows() { this.pendingRows = []; }

  startEdit(r: any) { this.editingId = r.mortality_id; this.editForm = { batch_id: r.batch_id, date: r.date, count: r.count, reason: r.reason }; }
  cancelEdit() { this.editingId = null; }
  async saveEdit(id: number) {
    if (!this.editForm.count || Number(this.editForm.count) < 0) return;
    await this.db.run(`UPDATE layer_mortality SET batch_id=?, date=?, count=?, reason=? WHERE mortality_id=?`, [this.editForm.batch_id, this.editForm.date, this.editForm.count, this.editForm.reason, id]);
    this.editingId = null; await this.loadData();
  }

  confirmDelete(id: number) { this.deletingId = id; this.showDeleteDialog = true; }
  async onDeleteConfirmed() { await this.db.run('DELETE FROM layer_mortality WHERE mortality_id=?', [this.deletingId]); this.showDeleteDialog = false; await this.loadData(); }
  onDeleteCancelled() { this.showDeleteDialog = false; }
}
