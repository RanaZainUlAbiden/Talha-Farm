import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { FlockService } from '../shared/services/flock.service';
import { AuthService } from '../shared/services/auth.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';
import { PaginationComponent } from '../shared/components/pagination/pagination.component';

@Component({
  selector: 'app-flock-management',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe, PaginationComponent],
  templateUrl: './flock-management.component.html',
  styleUrl: './flock-management.component.scss'
})
export class FlockManagementComponent implements OnInit {
  currentFarm: any = null;
  flocks: any[] = [];
  showNewRow = false;
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  errorMessage = '';

  currentPage = 1;
  pageSize = 10;

  searchTerm: string = '';

  get filteredFlocks(): any[] {
    const term = this.searchTerm.toLowerCase().trim();
    if (!term) return this.flocks;
    return this.flocks.filter(f => f.flock_name?.toLowerCase().includes(term));
  }

  onSearchChange() {
    this.currentPage = 1;
    this.cdr.detectChanges();
  }

  get paginatedFlocks() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredFlocks.slice(start, start + this.pageSize);
  }

  newRow = {
    flock_name: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    status: 'active'
  };

  constructor(
    private db: DatabaseService,
    private flockService: FlockService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.refresh();
  }

  private async refresh() {
    const flocks = await this.flockService.loadFlocks(this.currentFarm.farm_id);
    this.flocks = flocks;
    this.cdr.detectChanges();
  }

  // ── Auto-fill end date when status changes to closed ──────
  onStatusChangeForNew() {
    if (this.newRow.status === 'closed' && !this.newRow.end_date) {
      this.newRow.end_date = new Date().toISOString().split('T')[0];
    }
    if (this.newRow.status === 'active') {
      this.newRow.end_date = '';
    }
  }

  onStatusChangeForEdit() {
    if (this.editForm.status === 'closed' && !this.editForm.end_date) {
      this.editForm.end_date = new Date().toISOString().split('T')[0];
    }
    if (this.editForm.status === 'active') {
      this.editForm.end_date = '';
    }
  }

  // ── Add ────────────────────────────────────────────────────
  async addNewRow() {
    if (this.isSaving) return;
    this.editingId = null;

    const nextNum = await this.flockService.getNextFlockNumber(this.currentFarm.farm_id);
    const year = new Date().getFullYear().toString().slice(-2);

    this.newRow = {
      flock_name: 'F#' + nextNum + '-Y' + year,
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
      status: 'active'
    };
    this.showNewRow = true;
    this.cdr.detectChanges();
  }

  async saveNewRow() {
    if (this.isSaving) return;
    if (!this.newRow.flock_name.trim()) return;

    this.isSaving = true;
    this.showNewRow = false;

    try {
      await this.db.run(
        'INSERT INTO flocks (farm_id, flock_name, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)',
        [
          this.currentFarm.farm_id,
          this.newRow.flock_name.trim(),
          this.newRow.start_date,
          this.newRow.end_date || null,
          this.newRow.status
        ]
      );
      await this.refresh();
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  cancelNewRow() {
    if (this.isSaving) return;
    this.showNewRow = false;
  }

  // ── Edit ───────────────────────────────────────────────────
  startEdit(flock: any) {
    if (this.isSaving) return;
    this.showNewRow = false;
    this.editingId = flock.flock_id;
    this.editForm = {
      flock_name: flock.flock_name,
      start_date: flock.start_date,
      end_date: flock.end_date || '',
      status: flock.status
    };
  }

  cancelEdit() {
    if (this.isSaving) return;
    this.editingId = null;
    this.editForm = {};
  }

  async saveEdit(flockId: number) {
    if (this.isSaving) return;
    if (!this.editForm.flock_name?.trim()) return;

    this.isSaving = true;
    this.editingId = null;

    try {
      await this.db.run(
        'UPDATE flocks SET flock_name = ?, start_date = ?, end_date = ?, status = ? WHERE flock_id = ?',
        [
          this.editForm.flock_name.trim(),
          this.editForm.start_date,
          this.editForm.end_date || null,
          this.editForm.status,
          flockId
        ]
      );
      this.editForm = {};
      await this.refresh();
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  // ── Delete ─────────────────────────────────────────────────
  confirmDelete(flockId: number) {
    if (this.isSaving) return;
    this.deletingId = flockId;
    this.showDeleteDialog = true;
  }

  async onDeleteConfirmed() {
    if (this.isSaving) return;
    this.isSaving = true;
    this.showDeleteDialog = false;

    try {
      if (this.deletingId) {
        await this.db.run('DELETE FROM flock_health     WHERE flock_id = ?', [this.deletingId]);
        await this.db.run('DELETE FROM expenses         WHERE flock_id = ?', [this.deletingId]);
        await this.db.run('DELETE FROM ledger_entries   WHERE flock_id = ?', [this.deletingId]);
        await this.db.run('DELETE FROM ledgers          WHERE flock_id = ?', [this.deletingId]);
        await this.db.run('DELETE FROM medicine_entries WHERE flock_id = ?', [this.deletingId]);
        await this.db.run('DELETE FROM medicine_traders WHERE flock_id = ?', [this.deletingId]);
        await this.db.run('DELETE FROM sales            WHERE flock_id = ?', [this.deletingId]);
        await this.db.run('DELETE FROM income           WHERE flock_id = ?', [this.deletingId]);
        await this.db.run('DELETE FROM balance          WHERE flock_id = ?', [this.deletingId]);
        await this.db.run('DELETE FROM flocks           WHERE flock_id = ?', [this.deletingId]);
        await this.refresh();
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