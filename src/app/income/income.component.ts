import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DatabaseService } from '../shared/services/database.service';
import { FlockService } from '../shared/services/flock.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';
import { Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import { PendingStateService } from '../shared/services/pending-state.service';

@Component({
  selector: 'app-income',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe],
  templateUrl: './income.component.html',
  styleUrl: './income.component.scss'
})
export class IncomeComponent implements OnInit, OnDestroy {
  currentFlock: any = null;
  incomeList: any[] = [];
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

  get totalIncome(): number {
    return this.incomeList.reduce((sum, i) => sum + (i.amount || 0), 0);
  }

  get saleIncome(): number {
    return this.incomeList
      .filter(i => i.source === 'sale')
      .reduce((sum, i) => sum + (i.amount || 0), 0);
  }

  get manualIncome(): number {
    return this.incomeList
      .filter(i => i.source === 'manual')
      .reduce((sum, i) => sum + (i.amount || 0), 0);
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
      this.incomeList = resolved.income || [];

      const cached = this.pendingState.getState('IncomeComponent');
      if (cached && cached.flockId === this.currentFlock?.flock_id) {
        this.pendingRows = cached.pendingRows || [];
      }
    }

    this.subs.add(
      this.flockService.currentFlock$.pipe(skip(1)).subscribe(flock => {
        if (flock) {
          this.currentFlock = flock;
          this.pendingRows = [];
          this.editingId = null;
          this.isSaving = false;
          this.pendingState.clearState('IncomeComponent');
          this.loadIncome();
        }
      })
    );
  }

  ngOnDestroy() {
    this.pendingState.saveState('IncomeComponent', {
      flockId: this.currentFlock?.flock_id,
      pendingRows: this.pendingRows
    });
    this.subs.unsubscribe();
  }

  async loadIncome() {
    if (!this.currentFlock) return;
    const result = await this.db.get(
      `SELECT * FROM income
       WHERE flock_id = ?
       ORDER BY date DESC, income_id ASC`,
      [this.currentFlock.flock_id]
    );
    if (result.success) {
      this.incomeList = result.data;
      this.cdr.detectChanges();
    }
  }

  // ── Pending Rows (Multi-row add) ─────────────────────────────
  makeNewRow(): any {
    return {
      date: new Date().toISOString().split('T')[0],
      description: '',
      amount: null
    };
  }

  addPendingRow() {
    if (this.isSaving) return;
    this.editingId = null;
    this.pendingRows.push(this.makeNewRow());
  }

  addRowAfter(index: number) {
    this.pendingRows.splice(index + 1, 0, this.makeNewRow());
  }

  removePendingRow(index: number) {
    this.pendingRows.splice(index, 1);
  }

  async saveAllRows() {
    if (this.pendingRows.length === 0) return;
    if (this.isSavingAll) return;
    this.isSavingAll = true;

    try {
      const invalidRows: any[] = [];
      let insertedCount = 0;

      for (const row of this.pendingRows) {
        if (!row.date || !row.amount) {
          invalidRows.push(row);
          continue;
        }

        await this.db.run(
          `INSERT INTO income (flock_id, date, description, amount, source)
           VALUES (?, ?, ?, ?, 'manual')`,
          [
            this.currentFlock.flock_id,
            row.date,
            row.description,
            row.amount
          ]
        );
        insertedCount++;
      }

      this.pendingRows = invalidRows;
      
      if (insertedCount > 0) {
        await this.loadIncome();
      }

      if (invalidRows.length > 0) {
        this.validationMessage = 'Some rows are missing required fields (Date or Amount) and were not saved.';
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

  // ── Edit ───────────────────────────────────────────────────
  startEdit(income: any) {
    if (this.isSaving) return;
    if (income.source === 'sale') return;    // sale rows are read-only
    this.pendingRows = [];
    this.editingId = income.income_id;
    this.editForm = {
      date: income.date,
      description: income.description,
      amount: income.amount
    };
  }

  cancelEdit() {
    if (this.isSaving) return;
    this.editingId = null;
    this.editForm = {};
  }

  async saveEdit(incomeId: number) {
    if (this.isSaving) return;

    this.isSaving = true;
    this.editingId = null;

    try {
      await this.db.run(
        `UPDATE income SET date = ?, description = ?, amount = ?
         WHERE income_id = ?`,
        [
          this.editForm.date,
          this.editForm.description,
          this.editForm.amount,
          incomeId
        ]
      );
      this.editForm = {};
      await this.loadIncome();
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  // ── Delete ─────────────────────────────────────────────────
  confirmDelete(incomeId: number) {
    if (this.isSaving) return;
    this.deletingId = incomeId;
    this.showDeleteDialog = true;
  }

  async onDeleteConfirmed() {
    if (this.isSaving) return;

    this.isSaving = true;
    this.showDeleteDialog = false;

    try {
      if (this.deletingId) {
        await this.db.run(
          `DELETE FROM income WHERE income_id = ?`,
          [this.deletingId]
        );
        await this.loadIncome();
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