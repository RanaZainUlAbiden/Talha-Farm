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
  selector: 'app-egg-collection',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe, PaginationComponent],
  templateUrl: './egg-collection.component.html',
  styleUrl: './egg-collection.component.scss'
})
export class EggCollectionComponent implements OnInit {
  currentFarm: any = null;
  batches: any[] = [];
  collections: any[] = [];
  pendingRows: any[] = [];
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  isSavingAll = false;
  errorMessage = '';

  currentPage = 1;
  pageSize = 30;

  selectedBatchFilter: string = 'all';

  get filteredCollections() {
    if (this.selectedBatchFilter === 'all') return this.collections;
    return this.collections.filter(c => String(c.batch_id) === String(this.selectedBatchFilter));
  }

  get paginatedCollections() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredCollections.slice(start, start + this.pageSize);
  }

  get hasPendingRows(): boolean { return this.pendingRows.length > 0; }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'a') {
      if ((event.target as HTMLElement)?.tagName === 'INPUT' || (event.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      event.preventDefault();
      this.addPendingRow();
    }
    if (event.ctrlKey && event.key === 's') {
      event.preventDefault();
      if (this.hasPendingRows) this.saveAllRows();
    }
  }

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef,
    private pendingState: PendingStateService
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadData();

    const cached = this.pendingState.getState('EggCollectionComponent');
    if (cached && cached.farmId === this.currentFarm?.farm_id) {
      this.pendingRows = cached.pendingRows || [];
    }
  }

  ngOnDestroy() {
    this.pendingState.saveState('EggCollectionComponent', { farmId: this.currentFarm?.farm_id, pendingRows: this.pendingRows });
  }

  async loadData() {
    const batchResult = await this.db.get(`SELECT * FROM batches WHERE farm_id = ? AND status = 'active' ORDER BY batch_id DESC`, [this.currentFarm.farm_id]);
    this.batches = batchResult.success ? batchResult.data : [];

    const colResult = await this.db.get(
      `SELECT ec.*, b.batch_name FROM egg_collection ec JOIN batches b ON ec.batch_id = b.batch_id WHERE b.farm_id = ? ORDER BY ec.date DESC, ec.collection_id DESC`,
      [this.currentFarm.farm_id]
    );
    this.collections = colResult.success ? colResult.data : [];
    this.cdr.detectChanges();
  }

  getBatchName(batchId: number): string {
    return this.batches.find(b => b.batch_id === batchId)?.batch_name || '—';
  }

  makeNewRow(): any {
    return {
      batch_id: this.batches.length > 0 ? this.batches[0].batch_id : null,
      date: new Date().toISOString().split('T')[0],
      total_eggs: null, broken_eggs: 0, small_grade: 0, medium_grade: 0, large_grade: 0, xl_grade: 0
    };
  }

  addPendingRow() {
    if (this.isSaving) return;
    this.editingId = null;
    this.pendingRows.push(this.makeNewRow());
  }

  addRowAfter(index: number) { this.pendingRows.splice(index + 1, 0, this.makeNewRow()); }
  removePendingRow(index: number) { this.pendingRows.splice(index, 1); }

  // Returns an error message if the row is invalid, otherwise null.
  validateEggRow(row: any): string | null {
    if (!row.batch_id || !row.date || row.total_eggs === null || row.total_eggs === undefined || row.total_eggs === '') {
      return 'Select a batch, date and enter total eggs.';
    }
    const total = Number(row.total_eggs);
    const broken = Number(row.broken_eggs) || 0;
    const small = Number(row.small_grade) || 0;
    const medium = Number(row.medium_grade) || 0;
    const large = Number(row.large_grade) || 0;
    const xl = Number(row.xl_grade) || 0;

    if ([total, broken, small, medium, large, xl].some(v => v < 0)) {
      return 'Quantities cannot be negative.';
    }
    if (broken + small + medium + large + xl > total) {
      return 'Broken + graded eggs cannot exceed total eggs.';
    }
    return null;
  }

  async saveAllRows() {
    if (this.pendingRows.length === 0 || this.isSavingAll) return;
    this.errorMessage = '';
    for (const row of this.pendingRows) {
      const error = this.validateEggRow(row);
      if (error) { this.errorMessage = error; this.cdr.detectChanges(); return; }
    }
    this.isSavingAll = true;
    try {
      const invalidRows: any[] = [];
      for (const row of this.pendingRows) {
        if (!row.batch_id || !row.date || row.total_eggs === null) { invalidRows.push(row); continue; }
        await this.db.run(
          `INSERT INTO egg_collection (batch_id, date, total_eggs, broken_eggs, small_grade, medium_grade, large_grade, xl_grade) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [row.batch_id, row.date, row.total_eggs, row.broken_eggs || 0, row.small_grade || 0, row.medium_grade || 0, row.large_grade || 0, row.xl_grade || 0]
        );
      }
      this.pendingRows = invalidRows;
      if (invalidRows.length === 0) await this.loadData();
    } finally {
      this.isSavingAll = false;
      this.cdr.detectChanges();
    }
  }

  cancelAllRows() { this.pendingRows = []; }

  startEdit(c: any) {
    if (this.isSaving) return;
    this.pendingRows = [];
    this.editingId = c.collection_id;
    this.editForm = { batch_id: c.batch_id, date: c.date, total_eggs: c.total_eggs, broken_eggs: c.broken_eggs, small_grade: c.small_grade, medium_grade: c.medium_grade, large_grade: c.large_grade, xl_grade: c.xl_grade };
  }

  cancelEdit() { if (!this.isSaving) { this.editingId = null; this.editForm = {}; } }

  async saveEdit(id: number) {
    if (this.isSaving) return;
    const error = this.validateEggRow(this.editForm);
    if (error) { this.errorMessage = error; this.cdr.detectChanges(); return; }
    this.isSaving = true;
    this.editingId = null;
    this.errorMessage = '';
    try {
      await this.db.run(
        `UPDATE egg_collection SET batch_id = ?, date = ?, total_eggs = ?, broken_eggs = ?, small_grade = ?, medium_grade = ?, large_grade = ?, xl_grade = ? WHERE collection_id = ?`,
        [this.editForm.batch_id, this.editForm.date, this.editForm.total_eggs, this.editForm.broken_eggs || 0, this.editForm.small_grade || 0, this.editForm.medium_grade || 0, this.editForm.large_grade || 0, this.editForm.xl_grade || 0, id]
      );
      this.editForm = {};
      await this.loadData();
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  confirmDelete(id: number) { if (!this.isSaving) { this.deletingId = id; this.showDeleteDialog = true; } }

  async onDeleteConfirmed() {
    if (this.isSaving || !this.deletingId) return;
    this.isSaving = true;
    this.showDeleteDialog = false;
    try {
      await this.db.run('DELETE FROM egg_collection WHERE collection_id = ?', [this.deletingId]);
      await this.loadData();
    } finally {
      this.deletingId = null;
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  onDeleteCancelled() { this.showDeleteDialog = false; this.deletingId = null; }
}