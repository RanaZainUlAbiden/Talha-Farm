import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { FlockService } from '../shared/services/flock.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';
import { PaginationComponent } from '../shared/components/pagination/pagination.component';

@Component({
  selector: 'app-batch-management',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe, PaginationComponent],
  templateUrl: './batch-management.component.html',
  styleUrl: './batch-management.component.scss'
})
export class BatchManagementComponent implements OnInit {
  currentFarm: any = null;
  batches: any[] = [];
  showNewRow = false;
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  errorMessage = '';

  currentPage = 1;
  pageSize = 10;

  get paginatedBatches() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.batches.slice(start, start + this.pageSize);
  }

  newRow = { batch_name: '', start_date: new Date().toISOString().split('T')[0], initial_birds: null, breed: '', status: 'active' };

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private flockService: FlockService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadBatches();
  }

  async loadBatches() {
    const result = await this.db.get(
      `SELECT * FROM batches WHERE farm_id = ? ORDER BY batch_id DESC`,
      [this.currentFarm.farm_id]
    );
    this.batches = result.success ? result.data : [];
    this.cdr.detectChanges();
  }

  addNewRow() {
    if (this.isSaving) return;
    this.editingId = null;
    this.errorMessage = '';
    this.newRow = { batch_name: '', start_date: new Date().toISOString().split('T')[0], initial_birds: null, breed: '', status: 'active' };
    this.showNewRow = true;
    this.cdr.detectChanges();
  }

  async saveNewRow() {
    if (this.isSaving || !this.newRow.batch_name.trim()) return;
    if (Number(this.newRow.initial_birds) < 0) {
      this.errorMessage = 'Number of birds cannot be negative.';
      this.cdr.detectChanges();
      return;
    }
    this.isSaving = true;
    this.showNewRow = false;
    this.errorMessage = '';
    try {
      await this.db.run(
        `INSERT INTO batches (farm_id, batch_name, start_date, initial_birds, breed, status) VALUES (?, ?, ?, ?, ?, ?)`,
        [this.currentFarm.farm_id, this.newRow.batch_name.trim(), this.newRow.start_date, this.newRow.initial_birds || 0, this.newRow.breed || '', this.newRow.status]
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
    this.editForm = { batch_name: batch.batch_name, start_date: batch.start_date, initial_birds: batch.initial_birds, breed: batch.breed || '', status: batch.status };
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
      await this.db.run(
        `UPDATE batches SET batch_name = ?, start_date = ?, initial_birds = ?, breed = ?, status = ? WHERE batch_id = ?`,
        [this.editForm.batch_name.trim(), this.editForm.start_date, this.editForm.initial_birds || 0, this.editForm.breed || '', this.editForm.status, batchId]
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