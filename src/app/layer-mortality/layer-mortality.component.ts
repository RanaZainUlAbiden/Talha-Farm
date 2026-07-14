import { Component, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';
import { PendingStateService } from '../shared/services/pending-state.service';
import { PaginationComponent } from '../shared/components/pagination/pagination.component';

@Component({
  selector: 'app-layer-mortality',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe, PaginationComponent],
  templateUrl: './layer-mortality.component.html',
  styleUrl: './layer-mortality.component.scss'
})
export class LayerMortalityComponent implements OnInit {
  currentFarm: any = null;
  batches: any[] = [];
  records: any[] = [];
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

  constructor(private db: DatabaseService, private authService: AuthService, private cdr: ChangeDetectorRef, private pendingState: PendingStateService) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadData();
    const cached = this.pendingState.getState('LayerMortalityComponent');
    if (cached?.farmId === this.currentFarm?.farm_id) this.pendingRows = cached.pendingRows || [];
  }

  ngOnDestroy() { this.pendingState.saveState('LayerMortalityComponent', { farmId: this.currentFarm?.farm_id, pendingRows: this.pendingRows }); }

  async loadData() {
    const br = await this.db.get(`SELECT * FROM batches WHERE farm_id=? AND status='active'`, [this.currentFarm.farm_id]);
    this.batches = br.success ? br.data : [];
    if (!this.currentBatchId && this.batches.length > 0) {
      this.currentBatchId = this.batches[0].batch_id;
    }
    const mr = await this.db.get(`SELECT m.*, b.batch_name FROM layer_mortality m JOIN batches b ON m.batch_id=b.batch_id WHERE b.farm_id=? ORDER BY m.date DESC`, [this.currentFarm.farm_id]);
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