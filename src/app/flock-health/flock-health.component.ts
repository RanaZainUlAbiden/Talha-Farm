import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DatabaseService } from '../shared/services/database.service';
import { FlockService } from '../shared/services/flock.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import { PendingStateService } from '../shared/services/pending-state.service';

@Component({
  selector: 'app-flock-health',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  templateUrl: './flock-health.component.html',
  styleUrl: './flock-health.component.scss'
})
export class FlockHealthComponent implements OnInit, OnDestroy {
  currentFlock: any = null;
  healthRecords: any[] = [];
  pendingRows: any[] = [];
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  isSavingAll = false;

  showValidationDialog = false;
  validationMessage = '';

  private subs = new Subscription();

  // ── Computed ─────────────────────────────────────────────────
  get hasPendingRows(): boolean {
    return this.pendingRows.length > 0;
  }

  getRowRemaining(row: any): number {
    return (row.total_birds || 0) - (row.mortality || 0);
  }

  getRowAutoFcr(row: any): number {
    const remaining = this.getRowRemaining(row);
    const feed = row.feed_used || 0;
    const avgW = row.avg_weight || 0;
    if (remaining <= 0 || avgW <= 0 || feed <= 0) return 0;
    return parseFloat((feed / (remaining * avgW)).toFixed(3));
  }

  onRowFeedOrWeightChange(row: any) {
    if (!row.fcrManuallyEdited) {
      row.fcr = this.getRowAutoFcr(row) || null;
    }
  }

  onRowFcrChange(row: any) {
    row.fcrManuallyEdited = true;
  }

  get editRemaining(): number {
    return (this.editForm.total_birds || 0) - (this.editForm.mortality || 0);
  }

  get editAutoFcr(): number {
    const remaining = this.editRemaining;
    const feed = this.editForm.feed_used || 0;
    const avgW = this.editForm.avg_weight || 0;
    if (remaining <= 0 || avgW <= 0 || feed <= 0) return 0;
    return parseFloat((feed / (remaining * avgW)).toFixed(3));
  }

  onEditFeedOrWeightChange() {
    if (!this.editForm.fcrManuallyEdited) {
      this.editForm.fcr = this.editAutoFcr || null;
    }
  }

  onEditFcrChange() {
    this.editForm.fcrManuallyEdited = true;
  }

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

  constructor(
    private db: DatabaseService,
    private flockService: FlockService,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
    private pendingState: PendingStateService
  ) {}

  ngOnInit() {
    const resolved = this.route.snapshot.data['data'];
    if (resolved) {
      this.currentFlock = resolved.flock;
      this.healthRecords = resolved.records || [];

      const cached = this.pendingState.getState('FlockHealthComponent');
      if (cached && cached.flockId === this.currentFlock?.flock_id) {
        this.pendingRows = cached.pendingRows || [];
      }
    }

    this.subs.add(
      this.flockService.currentFlock$.pipe(skip(1)).subscribe(flock => {
        if (flock) {
          this.currentFlock = flock;
          this.editingId = null;
          this.pendingRows = [];
          this.isSaving = false;
          this.pendingState.clearState('FlockHealthComponent');
          this.loadRecords();
        }
      })
    );
  }

  ngOnDestroy() {
    this.pendingState.saveState('FlockHealthComponent', {
      flockId: this.currentFlock?.flock_id,
      pendingRows: this.pendingRows
    });
    this.subs.unsubscribe();
  }

  async loadRecords() {
    if (!this.currentFlock) return;
    const result = await this.db.get(
      `SELECT * FROM flock_health WHERE flock_id = ? ORDER BY week_number ASC`,
      [this.currentFlock.flock_id]
    );
    if (result.success) {
      this.healthRecords = result.data;
      this.cdr.detectChanges();
    }
  }

  // ── Pending Rows (Multi-row add) ─────────────────────────────
  makeNewRow(): any {
    const last = this.healthRecords.length > 0
      ? this.healthRecords[this.healthRecords.length - 1]
      : null;

    return {
      week_number: this.healthRecords.length + this.pendingRows.length + 1,
      total_birds: last ? last.total_birds - last.mortality : null,
      mortality: null,
      feed_used: null,
      avg_weight: null,
      fcr: null,
      fcrManuallyEdited: false
    };
  }

  addPendingRow() {
    if (this.isSaving) return;
    this.editingId = null;
    this.pendingRows.push(this.makeNewRow());
  }

  addRowAfter(index: number) {
    const newRow = this.makeNewRow();
    this.pendingRows.splice(index + 1, 0, newRow);
    this.recalculateWeekNumbers();
  }

  removePendingRow(index: number) {
    this.pendingRows.splice(index, 1);
    this.recalculateWeekNumbers();
  }

  recalculateWeekNumbers() {
    const baseWeek = this.healthRecords.length;
    this.pendingRows.forEach((row, i) => {
      row.week_number = baseWeek + i + 1;
    });
  }

  async saveAllRows() {
    if (this.pendingRows.length === 0) return;
    if (this.isSavingAll) return;
    this.isSavingAll = true;

    try {
      const invalidRows: any[] = [];
      let insertedCount = 0;

      for (const row of this.pendingRows) {
        if (!row.week_number || !row.total_birds) {
          invalidRows.push(row);
          continue;
        }

        const fcr = row.fcrManuallyEdited
          ? (row.fcr || 0)
          : this.getRowAutoFcr(row);

        await this.db.run(
          `INSERT INTO flock_health
            (flock_id, week_number, total_birds, mortality, feed_used, avg_weight, fcr)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            this.currentFlock.flock_id,
            row.week_number,
            row.total_birds,
            row.mortality || 0,
            row.feed_used || 0,
            row.avg_weight || 0,
            fcr
          ]
        );
        insertedCount++;
      }

      this.pendingRows = invalidRows;
      
      if (insertedCount > 0) {
        await this.loadRecords();
      }

      if (invalidRows.length > 0) {
        this.validationMessage = 'Some rows are missing required fields (Date, Total Birds, etc) and were not saved.';
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

  // ── Edit ─────────────────────────────────────────────────────
  startEdit(record: any) {
    if (this.isSaving) return;
    this.pendingRows = [];
    this.editingId = record.health_id;
    this.editForm = {
      week_number: record.week_number,
      total_birds: record.total_birds,
      mortality: record.mortality,
      feed_used: record.feed_used,
      avg_weight: record.avg_weight,
      fcr: record.fcr,
      fcrManuallyEdited: false
    };
  }

  cancelEdit() {
    if (this.isSaving) return;
    this.editingId = null;
    this.editForm = {};
  }

  async saveEdit(healthId: number) {
    if (this.isSaving) return;

    this.isSaving = true;
    this.editingId = null;

    const fcr = this.editForm.fcrManuallyEdited
      ? (this.editForm.fcr || 0)
      : this.editAutoFcr;

    try {
      await this.db.run(
        `UPDATE flock_health SET
          week_number = ?, total_birds = ?, mortality = ?,
          feed_used = ?, avg_weight = ?, fcr = ?
         WHERE health_id = ?`,
        [
          this.editForm.week_number,
          this.editForm.total_birds,
          this.editForm.mortality,
          this.editForm.feed_used,
          this.editForm.avg_weight,
          fcr,
          healthId
        ]
      );
      this.editForm = {};
      await this.loadRecords();
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  // ── Delete ───────────────────────────────────────────────────
  confirmDelete(healthId: number) {
    if (this.isSaving) return;
    this.deletingId = healthId;
    this.showDeleteDialog = true;
  }

  async onDeleteConfirmed() {
    if (this.isSaving) return;
    this.isSaving = true;
    this.showDeleteDialog = false;

    try {
      if (this.deletingId) {
        await this.db.run(
          `DELETE FROM flock_health WHERE health_id = ?`,
          [this.deletingId]
        );
        await this.loadRecords();
      }
    } finally {
      this.deletingId = null;
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  onDeleteCancelled() {
    this.showDeleteDialog = false;
    this.deletingId = null;
  }
}