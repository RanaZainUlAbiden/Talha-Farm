import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { FlockService } from '../shared/services/flock.service';
import { FarmUnitService } from '../shared/services/farm-unit.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';
import { PaginationComponent } from '../shared/components/pagination/pagination.component';

import { toLocalDateString } from '../shared/utils/date.util';
@Component({
  selector: 'app-batch-management',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe, PaginationComponent],
  templateUrl: './batch-management.component.html',
  styleUrl: './batch-management.component.scss'
})
export class BatchManagementComponent implements OnInit, OnDestroy {
  currentFarm: any = null;
  batches: any[] = [];

  // All layer farms for this account — populates the create-form dropdown
  // and resolves unit_id -> unit_name for the read-only edit-form display.
  units: any[] = [];
  // The farm currently selected in the sidebar — drives list filtering.
  currentUnit: any = null;

  showNewRow = false;
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  errorMessage = '';

  currentPage = 1;
  pageSize = 10;

  private subs = new Subscription();

  get paginatedBatches() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.batches.slice(start, start + this.pageSize);
  }

  newRow = { batch_name: '', start_date: toLocalDateString(), end_date: '', initial_birds: null, breed: '', status: 'active', unit_id: null as number | null };

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private flockService: FlockService,
    private farmUnitService: FarmUnitService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    // Load units first — the currentUnit$ subscription below fires
    // synchronously (BehaviorSubject) and its filtering depends on
    // this.units already being populated.
    await this.loadUnits();

    this.subs.add(
      this.farmUnitService.currentUnit$.subscribe(unit => {
        this.currentUnit = unit;
        this.loadBatches();
      })
    );

    this.subs.add(
      this.farmUnitService.unitsChanged$.subscribe(async () => {
        await this.loadUnits();
        this.loadBatches();
      })
    );
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }

  async loadUnits() {
    const result = await this.db.getFarmUnits(this.currentFarm.farm_id, 'layer');
    this.units = result.success ? result.data : [];
    this.cdr.detectChanges();
  }

  async loadBatches() {
    // No farms yet for this account — behave exactly as before the farm
    // selector existed rather than filtering to an empty list.
    const unitId = this.units.length > 0 ? this.currentUnit?.unit_id : undefined;
    const sql = unitId
      ? `SELECT * FROM batches WHERE farm_id = ? AND unit_id = ? ORDER BY batch_id DESC`
      : `SELECT * FROM batches WHERE farm_id = ? ORDER BY batch_id DESC`;
    const params = unitId ? [this.currentFarm.farm_id, unitId] : [this.currentFarm.farm_id];
    const result = await this.db.get(sql, params);
    this.batches = result.success ? result.data : [];
    this.cdr.detectChanges();
  }

  unitName(unitId: number | null | undefined): string {
    const unit = this.units.find(u => u.unit_id === unitId);
    return unit ? unit.unit_name : '—';
  }

  addNewRow() {
    if (this.isSaving) return;
    this.editingId = null;
    this.errorMessage = '';

    if (this.units.length === 0) {
      this.errorMessage = 'No farms set up for Layer yet. Go to the Farms page and create one before adding a batch.';
      this.cdr.detectChanges();
      return;
    }

    this.newRow = {
      batch_name: '',
      start_date: toLocalDateString(),
      end_date: '',
      initial_birds: null,
      breed: '',
      status: 'active',
      unit_id: this.currentUnit?.unit_id ?? this.units[0].unit_id
    };
    this.showNewRow = true;
    this.cdr.detectChanges();
  }

  onStatusChangeForNew() {
    if (this.newRow.status === 'closed' && !this.newRow.end_date) {
      this.newRow.end_date = toLocalDateString();
    } else if (this.newRow.status === 'active') {
      this.newRow.end_date = '';
    }
  }

  onStatusChangeForEdit() {
    if (this.editForm.status === 'closed' && !this.editForm.end_date) {
      this.editForm.end_date = toLocalDateString();
    } else if (this.editForm.status === 'active') {
      this.editForm.end_date = '';
    }
  }

  async saveNewRow() {
    if (this.isSaving || !this.newRow.batch_name.trim()) return;
    if (Number(this.newRow.initial_birds) < 0) {
      this.errorMessage = 'Number of birds cannot be negative.';
      this.cdr.detectChanges();
      return;
    }
    if (!this.newRow.unit_id) {
      this.errorMessage = 'Please select a farm.';
      this.cdr.detectChanges();
      return;
    }
    this.isSaving = true;
    this.showNewRow = false;
    this.errorMessage = '';
    try {
      await this.db.run(
        `INSERT INTO batches (farm_id, batch_name, start_date, end_date, initial_birds, breed, status, unit_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [this.currentFarm.farm_id, this.newRow.batch_name.trim(), this.newRow.start_date, this.newRow.end_date || null, this.newRow.initial_birds || 0, this.newRow.breed || '', this.newRow.status, this.newRow.unit_id]
      );
      await this.loadBatches();
      this.flockService.notifyBatchesChanged();
    } catch {
      this.errorMessage = 'Could not create batch.';
      this.showNewRow = true;
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }



  cancelNewRow() {
    if (!this.isSaving) this.showNewRow = false;
  }

  startEdit(batch: any) {
    if (this.isSaving) return;
    this.showNewRow = false;
    this.errorMessage = '';
    this.editingId = batch.batch_id;
    this.editForm = { batch_name: batch.batch_name, start_date: batch.start_date, end_date: batch.end_date || '', initial_birds: batch.initial_birds, breed: batch.breed || '', status: batch.status, unit_id: batch.unit_id };
  }

  cancelEdit() {
    if (this.isSaving) return;
    this.editingId = null;
    this.editForm = {};
  }

  async saveEdit(batchId: number) {
    if (this.isSaving || !this.editForm.batch_name?.trim()) return;
    if (Number(this.editForm.initial_birds) < 0) {
      this.errorMessage = 'Number of birds cannot be negative.';
      this.cdr.detectChanges();
      return;
    }
    this.isSaving = true;
    this.editingId = null;
    this.errorMessage = '';
    try {
      // A batch's farm is fixed at creation — unit_id is deliberately not
      // part of this UPDATE.
      await this.db.run(
        `UPDATE batches SET batch_name = ?, start_date = ?, end_date = ?, initial_birds = ?, breed = ?, status = ? WHERE batch_id = ?`,
        [this.editForm.batch_name.trim(), this.editForm.start_date, this.editForm.end_date || null, this.editForm.initial_birds || 0, this.editForm.breed || '', this.editForm.status, batchId]
      );
      this.editForm = {};
      await this.loadBatches();
      this.flockService.notifyBatchesChanged();
    } catch {
      this.errorMessage = 'Could not update batch.';
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  confirmDelete(batchId: number) {
    if (this.isSaving) return;
    this.deletingId = batchId;
    this.showDeleteDialog = true;
  }

  async onDeleteConfirmed() {
    if (this.isSaving || !this.deletingId) return;
    const batchId = this.deletingId;
    this.isSaving = true;
    this.showDeleteDialog = false;
    this.errorMessage = '';
    try {
      // Explicitly clean up dependent records — FK cascades are not guaranteed
      // to be enforced (PRAGMA foreign_keys may be OFF), so do this manually.
      await this.db.run('DELETE FROM egg_collection WHERE batch_id = ?', [batchId]);
      await this.db.run('DELETE FROM egg_sales WHERE batch_id = ?', [batchId]);
      await this.db.run('DELETE FROM vaccinations WHERE batch_id = ?', [batchId]);
      await this.db.run('DELETE FROM layer_mortality WHERE batch_id = ?', [batchId]);
      await this.db.run('DELETE FROM batches WHERE batch_id = ?', [batchId]);
      this.batches = this.batches.filter(b => b.batch_id !== batchId);
      this.flockService.notifyBatchesChanged();
    } catch {
      this.errorMessage = 'Could not delete batch.';
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
