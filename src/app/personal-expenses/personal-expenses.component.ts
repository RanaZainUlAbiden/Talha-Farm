import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';
import { toLocalDateString } from '../shared/utils/date.util';

const CATEGORIES = ['Household', 'Medical', 'Education', 'Travel', 'Other'];

function firstOfMonth(): string {
  const d = new Date();
  return toLocalDateString(new Date(d.getFullYear(), d.getMonth(), 1));
}

@Component({
  selector: 'app-personal-expenses',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe],
  templateUrl: './personal-expenses.component.html',
  styleUrl: './personal-expenses.component.scss'
})
export class PersonalExpensesComponent implements OnInit {
  currentFarm: any = null;
  categories = CATEGORIES;

  expenses: any[] = [];
  isLoading = true;
  errorMessage = '';

  bankAccounts: any[] = [];

  fromDate = firstOfMonth();
  toDate = toLocalDateString();

  showForm = false;
  editingId: number | null = null;
  form: any = this.emptyForm();
  formError = '';

  showDeleteDialog = false;
  deletingId: number | null = null;

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    await this.loadBankAccounts();
    await this.loadExpenses();
  }

  private emptyForm() {
    return {
      date: toLocalDateString(),
      category: 'Household',
      description: '',
      amount: null as number | null,
      payment_source: 'cash',
      bank_id: null as number | null,
      notes: ''
    };
  }

  get totalAmount(): number {
    return this.expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  }

  async loadBankAccounts() {
    const result = await this.db.getBankAccounts(this.currentFarm.farm_id);
    this.bankAccounts = result.success ? result.data : [];
  }

  async loadExpenses() {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const result = await this.db.getPersonalExpenses(this.currentFarm.farm_id, this.fromDate, this.toDate);
      this.expenses = result.success ? result.data : [];
      if (!result.success) this.errorMessage = result.error || 'Failed to load personal expenses.';
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  async applyFilter() {
    await this.loadExpenses();
  }

  openAddForm() {
    this.editingId = null;
    this.form = this.emptyForm();
    this.formError = '';
    this.showForm = true;
  }

  openEditForm(e: any) {
    this.editingId = e.pexpense_id;
    this.form = {
      date: e.date,
      category: e.category || 'Household',
      description: e.description || '',
      amount: e.amount,
      payment_source: e.payment_source || 'cash',
      bank_id: e.bank_id || null,
      notes: e.notes || ''
    };
    this.formError = '';
    this.showForm = true;
  }

  cancelForm() {
    this.showForm = false;
    this.editingId = null;
  }

  async saveForm() {
    if (!this.form.date || this.form.amount === null) {
      this.formError = 'Date and amount are required.';
      return;
    }
    this.formError = '';
    try {
      const payload = {
        date: this.form.date,
        category: this.form.category,
        description: this.form.description?.trim() || null,
        amount: this.form.amount || 0,
        payment_source: this.form.payment_source,
        bank_id: this.form.payment_source === 'bank' ? this.form.bank_id : null,
        notes: this.form.notes?.trim() || null
      };

      const result = this.editingId
        ? await this.db.updatePersonalExpense(this.editingId, payload)
        : await this.db.addPersonalExpense({ farm_id: this.currentFarm.farm_id, ...payload });

      if (!result.success) {
        this.formError = result.error || 'Failed to save personal expense.';
        this.cdr.detectChanges();
        return;
      }

      this.showForm = false;
      this.editingId = null;
      await this.loadExpenses();
    } catch (err: any) {
      this.formError = 'Failed to save personal expense: ' + err.message;
      this.cdr.detectChanges();
    }
  }

  confirmDelete(id: number) {
    this.deletingId = id;
    this.errorMessage = '';
    this.showDeleteDialog = true;
  }

  onDeleteCancelled() {
    this.showDeleteDialog = false;
    this.deletingId = null;
  }

  async onDeleteConfirmed() {
    if (this.deletingId === null) return;
    try {
      const result = await this.db.deletePersonalExpense(this.deletingId);
      this.showDeleteDialog = false;
      if (!result.success) {
        this.errorMessage = result.error || 'Failed to delete personal expense.';
        this.cdr.detectChanges();
        return;
      }
      this.deletingId = null;
      await this.loadExpenses();
    } catch (err: any) {
      this.errorMessage = 'Failed to delete personal expense: ' + err.message;
      this.showDeleteDialog = false;
      this.cdr.detectChanges();
    }
  }
}
