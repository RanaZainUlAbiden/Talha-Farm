import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';
import { toLocalDateString } from '../shared/utils/date.util';

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

  /** Categories are user-defined rows now, not a hardcoded list. */
  categories: any[] = [];
  isLoading = true;
  errorMessage = '';

  fromDate = firstOfMonth();
  toDate = toLocalDateString();

  /**
   * The category card the user clicked into, or null for the grid. One
   * component in two states — the same shape the Assets screen uses.
   */
  selectedCategory: any = null;
  entries: any[] = [];
  isLoadingEntries = false;
  detailError = '';

  showCategoryForm = false;
  editingCategoryId: number | null = null;
  categoryForm = { category_name: '' };
  categoryError = '';

  showForm = false;
  editingId: number | null = null;
  form: any = this.emptyForm();
  formError = '';

  showDeleteDialog = false;
  deletingId: number | null = null;

  showDeleteCategoryDialog = false;
  deletingCategoryId: number | null = null;

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    await this.loadCategories();
  }

  private emptyForm() {
    return {
      date: toLocalDateString(),
      category_id: null as number | null,
      description: '',
      amount: null as number | null,
      notes: ''
    };
  }

  // ── Grid totals ───────────────────────────────────────────

  get grandTotal(): number {
    return this.categories.reduce((sum, c) => sum + Number(c.total_spent || 0), 0);
  }

  get totalEntries(): number {
    return this.categories.reduce((sum, c) => sum + Number(c.entry_count || 0), 0);
  }

  /** Total of the entries currently listed on the detail view. */
  get categoryTotal(): number {
    return this.entries.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  }

  // ── Loading ───────────────────────────────────────────────

  async loadCategories() {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const result = await this.db.getPersonalExpenseCategories(
        this.currentFarm.farm_id, this.fromDate, this.toDate
      );
      this.categories = result.success ? result.data : [];
      if (!result.success) this.errorMessage = result.error || 'Failed to load categories.';

      if (this.selectedCategory) {
        const refreshed = this.categories.find(c => c.category_id === this.selectedCategory.category_id);
        this.selectedCategory = refreshed || null;
      }
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  async loadEntries(category: any) {
    this.isLoadingEntries = true;
    this.detailError = '';
    try {
      const result = await this.db.getPersonalExpensesByCategory(
        this.currentFarm.farm_id, category.category_id, category.category_name,
        this.fromDate, this.toDate
      );
      this.entries = result.success ? result.data : [];
      if (!result.success) this.detailError = result.error || 'Failed to load entries.';
    } finally {
      this.isLoadingEntries = false;
      this.cdr.detectChanges();
    }
  }

  async applyFilter() {
    await this.loadCategories();
    if (this.selectedCategory) await this.loadEntries(this.selectedCategory);
  }

  // ── Card <-> detail navigation ────────────────────────────

  async openCategory(category: any) {
    this.selectedCategory = category;
    this.entries = [];
    this.detailError = '';
    await this.loadEntries(category);
  }

  closeCategory() {
    this.selectedCategory = null;
    this.entries = [];
    this.detailError = '';
  }

  // ── Category add / rename / delete ────────────────────────

  openAddCategoryForm() {
    this.editingCategoryId = null;
    this.categoryForm = { category_name: '' };
    this.categoryError = '';
    this.showCategoryForm = true;
  }

  openRenameCategoryForm(c: any, event?: Event) {
    // The card itself is clickable, so the action buttons on it must not also
    // open the detail view.
    event?.stopPropagation();
    this.editingCategoryId = c.category_id;
    this.categoryForm = { category_name: c.category_name };
    this.categoryError = '';
    this.showCategoryForm = true;
  }

  cancelCategoryForm() {
    this.showCategoryForm = false;
    this.editingCategoryId = null;
  }

  async saveCategoryForm() {
    const name = this.categoryForm.category_name.trim();
    if (!name) {
      this.categoryError = 'A category name is required.';
      return;
    }
    this.categoryError = '';
    try {
      const result = this.editingCategoryId
        ? await this.db.renamePersonalExpenseCategory(this.editingCategoryId, this.currentFarm.farm_id, name)
        : await this.db.addPersonalExpenseCategory(this.currentFarm.farm_id, name);

      if (!result.success) {
        this.categoryError = result.error || 'Failed to save category.';
        this.cdr.detectChanges();
        return;
      }

      this.showCategoryForm = false;
      this.editingCategoryId = null;
      await this.loadCategories();
      if (this.selectedCategory) await this.loadEntries(this.selectedCategory);
    } catch (err: any) {
      this.categoryError = 'Failed to save category: ' + err.message;
      this.cdr.detectChanges();
    }
  }

  confirmDeleteCategory(categoryId: number, event?: Event) {
    event?.stopPropagation();
    this.deletingCategoryId = categoryId;
    this.errorMessage = '';
    this.showDeleteCategoryDialog = true;
  }

  onDeleteCategoryCancelled() {
    this.showDeleteCategoryDialog = false;
    this.deletingCategoryId = null;
  }

  /**
   * The refusal for a category that still has entries comes back from the
   * service as { success: false } with the count in the message — foreign keys
   * are not enforced here, so that check is the only thing keeping a delete from
   * stranding rows no card would ever show again.
   */
  async onDeleteCategoryConfirmed() {
    if (this.deletingCategoryId === null) return;
    try {
      const result = await this.db.deletePersonalExpenseCategory(
        this.deletingCategoryId, this.currentFarm.farm_id
      );
      this.showDeleteCategoryDialog = false;
      if (!result.success) {
        this.errorMessage = result.error || 'Failed to delete category.';
        this.cdr.detectChanges();
        return;
      }
      if (this.selectedCategory && this.selectedCategory.category_id === this.deletingCategoryId) {
        this.closeCategory();
      }
      this.deletingCategoryId = null;
      await this.loadCategories();
    } catch (err: any) {
      this.errorMessage = 'Failed to delete category: ' + err.message;
      this.showDeleteCategoryDialog = false;
      this.cdr.detectChanges();
    }
  }

  // ── Entry add / edit / delete ─────────────────────────────

  openAddForm() {
    this.editingId = null;
    this.form = this.emptyForm();
    // Inside a category, entries default to it; from the grid, to the first one.
    this.form.category_id = this.selectedCategory
      ? this.selectedCategory.category_id
      : (this.categories[0]?.category_id ?? null);
    this.formError = '';
    this.showForm = true;
  }

  openEditForm(e: any) {
    this.editingId = e.pexpense_id;
    this.form = {
      date: e.date,
      category_id: e.category_id ?? this.selectedCategory?.category_id ?? null,
      description: e.description || '',
      amount: e.amount,
      notes: e.notes || ''
    };
    this.formError = '';
    this.showForm = true;
  }

  cancelForm() {
    this.showForm = false;
    this.editingId = null;
  }

  private categoryNameFor(categoryId: number | null): string | null {
    const match = this.categories.find(c => c.category_id === categoryId);
    return match ? match.category_name : null;
  }

  async saveForm() {
    if (!this.form.date || this.form.amount === null) {
      this.formError = 'Date and amount are required.';
      return;
    }
    if (!this.form.category_id) {
      this.formError = 'Select a category.';
      return;
    }
    this.formError = '';
    try {
      // category and category_id are written together so the denormalised name
      // never drifts from the link.
      const payload = {
        date: this.form.date,
        category_id: this.form.category_id,
        category: this.categoryNameFor(this.form.category_id),
        description: this.form.description?.trim() || null,
        amount: this.form.amount || 0,
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
      await this.loadCategories();
      if (this.selectedCategory) await this.loadEntries(this.selectedCategory);
    } catch (err: any) {
      this.formError = 'Failed to save personal expense: ' + err.message;
      this.cdr.detectChanges();
    }
  }

  confirmDelete(id: number) {
    this.deletingId = id;
    this.detailError = '';
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
        this.detailError = result.error || 'Failed to delete personal expense.';
        this.cdr.detectChanges();
        return;
      }
      this.deletingId = null;
      await this.loadCategories();
      if (this.selectedCategory) await this.loadEntries(this.selectedCategory);
    } catch (err: any) {
      this.detailError = 'Failed to delete personal expense: ' + err.message;
      this.showDeleteDialog = false;
      this.cdr.detectChanges();
    }
  }
}
