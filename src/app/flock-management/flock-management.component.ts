import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { DatabaseService } from '../shared/services/database.service';
import { FlockService } from '../shared/services/flock.service';
import { AuthService } from '../shared/services/auth.service';
import { FarmUnitService } from '../shared/services/farm-unit.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';
import { PaginationComponent } from '../shared/components/pagination/pagination.component';

import { toLocalDateString } from '../shared/utils/date.util';
@Component({
  selector: 'app-flock-management',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe, PaginationComponent],
  templateUrl: './flock-management.component.html',
  styleUrl: './flock-management.component.scss'
})
export class FlockManagementComponent implements OnInit, OnDestroy {
  currentFarm: any = null;
  flocks: any[] = [];

  // All broiler farms for this account — populates the create-form dropdown
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

  searchTerm: string = '';

  private subs = new Subscription();

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
    start_date: toLocalDateString(),
    end_date: '',
    status: 'active',
    unit_id: null as number | null
  };

  constructor(
    private db: DatabaseService,
    private flockService: FlockService,
    private authService: AuthService,
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
        this.refresh();
      })
    );

    this.subs.add(
      this.farmUnitService.unitsChanged$.subscribe(async () => {
        await this.loadUnits();
        this.refresh();
      })
    );
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }

  async loadUnits() {
    const result = await this.db.getFarmUnits(this.currentFarm.farm_id, 'broiler');
    this.units = result.success ? result.data : [];
    this.cdr.detectChanges();
  }

  private async refresh() {
    // No farms yet for this account — behave exactly as before the farm
    // selector existed rather than filtering to an empty list.
    // Queries the DB directly (not flockService.loadFlocks) so this page's
    // full list — including closed flocks — never overwrites the sidebar's
    // filtered active-only selector, which shares the same flocksSubject.
    const unitId = this.units.length > 0 ? this.currentUnit?.unit_id : undefined;
    const sql = unitId
      ? `SELECT * FROM flocks WHERE farm_id = ? AND unit_id = ? ORDER BY flock_id ASC`
      : `SELECT * FROM flocks WHERE farm_id = ? ORDER BY flock_id ASC`;
    const params = unitId ? [this.currentFarm.farm_id, unitId] : [this.currentFarm.farm_id];
    const result = await this.db.get(sql, params);
    this.flocks = result.success ? result.data : [];
    this.cdr.detectChanges();
  }

  unitName(unitId: number | null | undefined): string {
    const unit = this.units.find(u => u.unit_id === unitId);
    return unit ? unit.unit_name : '—';
  }

  // ── Auto-fill end date when status changes to closed ──────
  onStatusChangeForNew() {
    if (this.newRow.status === 'closed' && !this.newRow.end_date) {
      this.newRow.end_date = toLocalDateString();
    }
    if (this.newRow.status === 'active') {
      this.newRow.end_date = '';
    }
  }

  onStatusChangeForEdit() {
    if (this.editForm.status === 'closed' && !this.editForm.end_date) {
      this.editForm.end_date = toLocalDateString();
    }
    if (this.editForm.status === 'active') {
      this.editForm.end_date = '';
    }
  }

  // ── Add ────────────────────────────────────────────────────
  async addNewRow() {
    if (this.isSaving) return;
    this.editingId = null;
    this.errorMessage = '';

    if (this.units.length === 0) {
      this.errorMessage = 'No farms set up for Broiler yet. Go to the Farms page and create one before adding a flock.';
      this.cdr.detectChanges();
      return;
    }

    const nextNum = await this.flockService.getNextFlockNumber(this.currentFarm.farm_id);
    const year = new Date().getFullYear().toString().slice(-2);

    this.newRow = {
      flock_name: 'F#' + nextNum + '-Y' + year,
      start_date: toLocalDateString(),
      end_date: '',
      status: 'active',
      unit_id: this.currentUnit?.unit_id ?? this.units[0].unit_id
    };
    this.showNewRow = true;
    this.cdr.detectChanges();
  }

  async saveNewRow() {
    if (this.isSaving) return;
    if (!this.newRow.flock_name.trim()) return;
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
        'INSERT INTO flocks (farm_id, flock_name, start_date, end_date, status, unit_id) VALUES (?, ?, ?, ?, ?, ?)',
        [
          this.currentFarm.farm_id,
          this.newRow.flock_name.trim(),
          this.newRow.start_date,
          this.newRow.end_date || null,
          this.newRow.status,
          this.newRow.unit_id
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
      status: flock.status,
      unit_id: flock.unit_id
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
      // A flock's farm is fixed at creation — unit_id is deliberately not
      // part of this UPDATE.
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
        await this.db.run('DELETE FROM feed_entries     WHERE flock_id = ?', [this.deletingId]);
        await this.db.run('DELETE FROM feed_traders     WHERE flock_id = ?', [this.deletingId]);
        await this.db.run('DELETE FROM vaccinations     WHERE flock_id = ?', [this.deletingId]);
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
