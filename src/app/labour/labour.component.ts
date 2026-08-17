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
import { PaginationComponent } from '../shared/components/pagination/pagination.component';

@Component({
  selector: 'app-labour',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe, PaginationComponent],
  templateUrl: './labour.component.html',
  styleUrl: './labour.component.scss'
})
export class LabourComponent implements OnInit, OnDestroy {
  currentFlock: any = null;
  roster: any[] = [];
  payments: any[] = [];
  pendingRows: any[] = [];
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  isSavingAll = false;
  errorMessage = '';

  showQuickAdd = false;
  quickAddForm = { labour_name: '', phone: '', role: '' };
  quickAddTargetRow: any = null; // which pending row triggered the quick-add

  currentPage = 1;
  pageSize = 20;

  private subs = new Subscription();

  get hasPendingRows(): boolean { return this.pendingRows.length > 0; }

  get targetId(): number | null {
    return this.currentFlock?.flock_id || this.currentFlock?.batch_id || null;
  }
  get moduleType(): string {
    return this.currentFlock?.batch_id ? 'layer' : 'broiler';
  }

  get paginatedPayments() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.payments.slice(start, start + this.pageSize);
  }

  get totalPaid(): number {
    return this.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
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
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    const resolved = this.route.snapshot.data['data'];
    if (resolved) {
      this.currentFlock = resolved.flock;
      this.roster = resolved.roster || [];
      this.payments = resolved.payments || [];
    }

    this.subs.add(
      this.flockService.currentFlock$.pipe(skip(1)).subscribe(flock => {
        if (flock) {
          this.currentFlock = flock;
          this.pendingRows = [];
          this.editingId = null;
          this.loadRoster();
          this.loadPayments();
        }
      })
    );
  }

  ngOnDestroy() { this.subs.unsubscribe(); }

  async loadRoster() {
    // Roster is farm-wide — fetched via the resolver's farm lookup isn't
    // available here directly, so we derive farm_id from any existing
    // roster/payment row, or re-resolve through a fresh call.
    const farmIdSource = this.roster[0]?.farm_id;
    if (!farmIdSource) return;
    const result = await this.db.get(`SELECT * FROM labour WHERE farm_id = ? ORDER BY labour_name ASC`, [farmIdSource]);
    if (result.success) {
      this.roster = result.data;
      this.cdr.detectChanges();
    }
  }

  async loadPayments() {
    if (!this.targetId) { this.payments = []; this.cdr.detectChanges(); return; }
    const result = await this.db.get(
      `SELECT lp.*, l.labour_name FROM labour_payments lp
       JOIN labour l ON lp.labour_id = l.labour_id
       WHERE lp.flock_id = ? AND lp.module_type = ?
       ORDER BY lp.date ASC`,
      [this.targetId, this.moduleType]
    );
    if (result.success) {
      this.payments = result.data;
      this.currentPage = 1;
      this.cdr.detectChanges();
    }
  }

  getLabourName(labourId: number): string {
    return this.roster.find(l => l.labour_id === labourId)?.labour_name || '—';
  }

  // ── Quick add labour (from within a pending row) ────────────
  openQuickAdd(row: any) {
    this.quickAddTargetRow = row;
    this.quickAddForm = { labour_name: '', phone: '', role: '' };
    this.showQuickAdd = true;
  }
  cancelQuickAdd() { this.showQuickAdd = false; this.quickAddTargetRow = null; }

  async saveQuickAdd() {
    if (!this.quickAddForm.labour_name.trim()) return;
    const farmId = this.currentFlock?.farm_id || this.roster[0]?.farm_id;
    if (!farmId) return;
    const result = await this.db.run(
      `INSERT INTO labour (farm_id, labour_name, phone, role) VALUES (?,?,?,?)`,
      [farmId, this.quickAddForm.labour_name.trim(), this.quickAddForm.phone || '', this.quickAddForm.role || '']
    );
    if (result.success) {
      await this.loadRoster();
      const newLabourId = (result as any).lastId;
      if (this.quickAddTargetRow) {
        this.quickAddTargetRow.labour_id = newLabourId;
      }
    }
    this.showQuickAdd = false;
    this.quickAddTargetRow = null;
    this.cdr.detectChanges();
  }

  // ── Pending rows ─────────────────────────────────────────────
  makeNewRow(): any {
    return {
      labour_id: this.roster.length > 0 ? this.roster[0].labour_id : null,
      date: new Date().toISOString().split('T')[0],
      description: '',
      amount: null,
      payment_type: 'cash'
    };
  }

  addPendingRow() {
    if (this.isSaving) return;
    this.editingId = null;
    this.pendingRows.push(this.makeNewRow());
  }
  addRowAfter(index: number) { this.pendingRows.splice(index + 1, 0, this.makeNewRow()); }
  removePendingRow(index: number) { this.pendingRows.splice(index, 1); }
  cancelAllRows() { this.pendingRows = []; }

  async saveAllRows() {
    if (!this.pendingRows.length || this.isSavingAll || !this.targetId) return;
    this.errorMessage = '';

    for (let i = 0; i < this.pendingRows.length; i++) {
      const row = this.pendingRows[i];
      if (!row.labour_id || !row.date || !row.amount) {
        this.errorMessage = `Row ${i + 1}: select labour, date and amount.`;
        this.cdr.detectChanges();
        return;
      }
      if (Number(row.amount) <= 0) {
        this.errorMessage = `Row ${i + 1}: amount must be greater than 0.`;
        this.cdr.detectChanges();
        return;
      }
    }

    this.isSavingAll = true;
    try {
      for (const row of this.pendingRows) {
        await this.db.run(
          `INSERT INTO labour_payments (labour_id, flock_id, date, description, amount, payment_type, module_type) VALUES (?,?,?,?,?,?,?)`,
          [row.labour_id, this.targetId, row.date, row.description || '', row.amount, row.payment_type || 'cash', this.moduleType]
        );
      }
      this.pendingRows = [];
      await this.loadPayments();
    } finally {
      this.isSavingAll = false;
      this.cdr.detectChanges();
    }
  }

  // ── Edit / delete ─────────────────────────────────────────────
  startEdit(p: any) {
    if (this.isSaving) return;
    this.pendingRows = [];
    this.editingId = p.payment_id;
    this.editForm = {
      labour_id: p.labour_id,
      date: p.date,
      description: p.description,
      amount: p.amount,
      payment_type: p.payment_type || 'cash'
    };
  }
  cancelEdit() { this.editingId = null; this.editForm = {}; }

  async saveEdit(id: number) {
    if (this.isSaving) return;
    if (!this.editForm.labour_id || !this.editForm.date || !this.editForm.amount) {
      this.errorMessage = 'Select labour, date and amount.';
      this.cdr.detectChanges();
      return;
    }
    this.isSaving = true;
    try {
      await this.db.run(
        `UPDATE labour_payments SET labour_id=?, date=?, description=?, amount=?, payment_type=? WHERE payment_id=?`,
        [this.editForm.labour_id, this.editForm.date, this.editForm.description || '', this.editForm.amount, this.editForm.payment_type || 'cash', id]
      );
      this.editingId = null;
      this.editForm = {};
      await this.loadPayments();
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  confirmDelete(id: number) { this.deletingId = id; this.showDeleteDialog = true; }
  onDeleteCancelled() { this.showDeleteDialog = false; this.deletingId = null; }

  async onDeleteConfirmed() {
    if (!this.deletingId) return;
    this.isSaving = true;
    this.showDeleteDialog = false;
    try {
      await this.db.run(`DELETE FROM labour_payments WHERE payment_id=?`, [this.deletingId]);
      await this.loadPayments();
    } finally {
      this.deletingId = null;
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }
}