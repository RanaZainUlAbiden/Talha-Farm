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
import { PaginationComponent } from '../shared/components/pagination/pagination.component';

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe, PaginationComponent],
  templateUrl: './expenses.component.html',
  styleUrl: './expenses.component.scss'
})
export class ExpensesComponent implements OnInit, OnDestroy {
  currentFlock: any = null;
  expenses: any[] = [];
  ledgers: any[] = [];
  pendingRows: any[] = [];
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  isSavingAll = false;

  showValidationDialog = false;
  validationMessage = '';

  currentPage = 1;
  pageSize = 20;

  selectedDateFilter: string = '';
  filteredByDate: boolean = false;

  get filteredExpenses() {
    if (!this.filteredByDate || !this.selectedDateFilter) return this.expenses;
    return this.expenses.filter(e => String(e.date).split('T')[0] === this.selectedDateFilter);
  }

  get paginatedExpenses() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredExpenses.slice(start, start + this.pageSize);
  }

  applyDateFilter() { if (this.selectedDateFilter) { this.filteredByDate = true; this.currentPage = 1; } }
  clearDateFilter() { this.selectedDateFilter = ''; this.filteredByDate = false; this.currentPage = 1; }

  private subs = new Subscription();

  get totalExpenses(): number {
    return this.expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  }

  get hasPendingRows(): boolean {
    return this.pendingRows.length > 0;
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
      this.expenses = resolved.expenses || [];
      this.ledgers = resolved.ledgers || [];

      const cached = this.pendingState.getState('ExpensesComponent');
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
          this.pendingState.clearState('ExpensesComponent');
          this.loadData();
        }
      })
    );
  }

  ngOnDestroy() {
    this.pendingState.saveState('ExpensesComponent', {
      flockId: this.currentFlock?.flock_id,
      pendingRows: this.pendingRows
    });
    this.subs.unsubscribe();
  }

  async loadData() {
    if (!this.currentFlock) return;

    const expensesResult = await this.db.get(
      `SELECT e.*, l.ledger_name
       FROM expenses e
       LEFT JOIN ledgers l ON e.ledger_id = l.ledger_id
       WHERE e.flock_id = ?
       ORDER BY e.date DESC`,
      [this.currentFlock.flock_id]
    );

    const ledgersResult = await this.db.get(
      `SELECT * FROM ledgers WHERE flock_id = ? ORDER BY ledger_name ASC`,
      [this.currentFlock.flock_id]
    );

    if (expensesResult.success) this.expenses = expensesResult.data;
    if (ledgersResult.success) this.ledgers = ledgersResult.data;

    this.cdr.detectChanges();
  }

  // ─── Helper: Ledger Entry Create ─────────────────────────────────
  async createLedgerEntry(ledgerId: number, date: string, description: string, amount: number): Promise<number | null> {
    await this.db.run(
      `INSERT INTO ledger_entries (ledger_id, flock_id, date, description, amount, type, source)
       VALUES (?, ?, ?, ?, ?, 'debit', 'expense')`,
      [ledgerId, this.currentFlock.flock_id, date, description, amount]
    );

    const result = await this.db.get(
      `SELECT entry_id FROM ledger_entries WHERE ledger_id = ? ORDER BY entry_id DESC LIMIT 1`,
      [ledgerId]
    );
    return result.data?.[0]?.entry_id || null;
  }

  // ─── Helper: Ledger Entry Update ─────────────────────────────────
  async updateLedgerEntry(entryId: number, ledgerId: number, date: string, description: string, amount: number): Promise<void> {
    await this.db.run(
      `UPDATE ledger_entries SET date = ?, description = ?, amount = ?, ledger_id = ?
       WHERE entry_id = ?`,
      [date, description, amount, ledgerId, entryId]
    );
  }

  // ─── Helper: Ledger Entry Delete ─────────────────────────────────
  async deleteLedgerEntry(entryId: number): Promise<void> {
    await this.db.run(
      `DELETE FROM ledger_entries WHERE entry_id = ?`,
      [entryId]
    );
  }

  // ─── Helper: Link Expense to Ledger Entry ────────────────────────
  async linkExpenseToLedger(expenseId: number, ledgerEntryId: number): Promise<void> {
    await this.db.run(
      `UPDATE expenses SET ledger_entry_id = ? WHERE expense_id = ?`,
      [ledgerEntryId, expenseId]
    );
  }

  // ─── Helper: Unlink Expense from Ledger ──────────────────────────
  async unlinkExpenseFromLedger(expenseId: number): Promise<void> {
    await this.db.run(
      `UPDATE expenses SET ledger_entry_id = NULL WHERE expense_id = ?`,
      [expenseId]
    );
  }

  // ── Pending Rows (Multi-row add) ─────────────────────────────
  makeNewRow(): any {
    return {
      date: new Date().toISOString().split('T')[0],
      description: '',
      amount: null,
      ledger_id: 'other',
      payment_type: 'cash',
      bill_available: 'No'
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

        const ledgerId = row.ledger_id === 'other' ? null : row.ledger_id;

        // 1. Insert expense
        await this.db.run(
          `INSERT INTO expenses (flock_id, ledger_id, date, description, amount, payment_type, bill_available)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            this.currentFlock.flock_id,
            ledgerId,
            row.date,
            row.description,
            row.amount,
            row.payment_type || 'cash',
            row.bill_available
          ]
        );

        // 2. Agar ledger select hai toh ledger entry create karo
        if (ledgerId) {
          // Get newly inserted expense_id
          const lastExp = await this.db.get(
            `SELECT expense_id FROM expenses WHERE flock_id = ? ORDER BY expense_id DESC LIMIT 1`,
            [this.currentFlock.flock_id]
          );
          const expenseId = lastExp.data?.[0]?.expense_id;

          if (expenseId) {
            // Create ledger entry with source = 'expense'
            const leId = await this.createLedgerEntry(
              ledgerId,
              row.date,
              row.description,
              row.amount
            );
            
            // Link expense to ledger entry
            if (leId) {
              await this.linkExpenseToLedger(expenseId, leId);
            }
          }
        }
        
        insertedCount++;
      }

      this.pendingRows = invalidRows;
      
      if (insertedCount > 0) {
        await this.loadData();
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
  startEdit(expense: any) {
    if (this.isSaving) return;
    this.pendingRows = [];
    this.editingId = expense.expense_id;
    this.editForm = {
      date: expense.date,
      description: expense.description,
      amount: expense.amount,
      ledger_id: expense.ledger_id ? expense.ledger_id : 'other',
      payment_type: expense.payment_type || 'cash',
      bill_available: expense.bill_available,
      ledger_entry_id: expense.ledger_entry_id,
      old_ledger_id: expense.ledger_id  // Track original ledger
    };
  }

  cancelEdit() {
    if (this.isSaving) return;
    this.editingId = null;
    this.editForm = {};
  }

  async saveEdit(expenseId: number) {
    if (this.isSaving) return;

    this.isSaving = true;
    this.editingId = null;

    const newLedgerId = this.editForm.ledger_id === 'other' ? null : this.editForm.ledger_id;
    const oldLedgerId = this.editForm.old_ledger_id;
    const ledgerEntryId = this.editForm.ledger_entry_id;

    try {
      // 1. Update expense record
      await this.db.run(
        `UPDATE expenses SET date = ?, description = ?, amount = ?,
          ledger_id = ?, payment_type = ?, bill_available = ?
         WHERE expense_id = ?`,
        [
          this.editForm.date,
          this.editForm.description,
          this.editForm.amount,
          newLedgerId,
          this.editForm.payment_type || 'cash',
          this.editForm.bill_available,
          expenseId
        ]
      );

      // 2. Handle ledger entry - cases
      if (ledgerEntryId) {
        // Case 1: Pehle ledger entry thi
        if (newLedgerId) {
          // Ab bhi ledger select hai → UPDATE existing entry
          await this.updateLedgerEntry(
            ledgerEntryId,
            newLedgerId,
            this.editForm.date,
            this.editForm.description,
            this.editForm.amount
          );
        } else {
          // Ledger hata diya (Other select kiya) → DELETE entry
          await this.deleteLedgerEntry(ledgerEntryId);
          await this.unlinkExpenseFromLedger(expenseId);
        }
      } else {
        // Case 2: Pehle ledger entry nahi thi
        if (newLedgerId) {
          // Ab ledger select kiya → CREATE new entry
          const leId = await this.createLedgerEntry(
            newLedgerId,
            this.editForm.date,
            this.editForm.description,
            this.editForm.amount
          );
          if (leId) {
            await this.linkExpenseToLedger(expenseId, leId);
          }
        }
        // Agar dono null hain → kuch nahi karna
      }

      this.editForm = {};
      await this.loadData();
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  // ── Delete ─────────────────────────────────────────────────
  confirmDelete(expenseId: number) {
    if (this.isSaving) return;
    this.deletingId = expenseId;
    this.showDeleteDialog = true;
  }

  async onDeleteConfirmed() {
    if (this.isSaving) return;

    this.isSaving = true;
    this.showDeleteDialog = false;

    try {
      if (this.deletingId) {
        const expense = this.expenses.find(e => e.expense_id === this.deletingId);

        // Delete expense
        await this.db.run(
          `DELETE FROM expenses WHERE expense_id = ?`,
          [this.deletingId]
        );

        // Delete linked ledger entry ONLY if source = 'expense'
        if (expense?.ledger_entry_id) {
          // Check if it's expense-sourced (safety check)
          const leResult = await this.db.get(
            `SELECT source FROM ledger_entries WHERE entry_id = ?`,
            [expense.ledger_entry_id]
          );
          
          if (leResult.data?.[0]?.source === 'expense') {
            await this.deleteLedgerEntry(expense.ledger_entry_id);
          }
        }

        await this.loadData();
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