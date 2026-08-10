import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DatabaseService } from '../../shared/services/database.service';
import { AuthService } from '../../shared/services/auth.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DeleteCodeDialogComponent } from '../../shared/components/delete-code-dialog/delete-code-dialog.component';

@Component({
  selector: 'app-expense-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DeleteCodeDialogComponent],
  templateUrl: './expense-ledger.component.html',
  styleUrl: './expense-ledger.component.scss'
})
export class ExpenseLedgerComponent implements OnInit {
  currentFarm: any = null;
  expenses: any[] = [];
  filteredExpenses: any[] = [];
  isLoading = true;
  errorMessage = '';

  // ── Filter ────────────────────────────────────────────────
  filterDateFrom: string = '';
  filterDateTo: string = '';
  filterCategory: string = '';
  categories: string[] = ['Rent', 'Tea', 'Land', 'Utilities', 'Salary', 'Maintenance', 'Transport', 'Office', 'Other'];

  // ── Form ──────────────────────────────────────────────────
  showForm = false;
  isEditing = false;
  editingId: number | null = null;
  expenseForm: any = {
    transaction_date: '',
    description: '',
    amount: 0,
    category: '',
    payment_type: 'cash',
    notes: ''
  };

  // ── Delete ─────────────────────────────────────────────────
  showDeleteDialog = false;
  showDeleteCodeDialog: boolean = false;
  deletingId: number | null = null;
  isSubmitting = false;

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.expenseForm.transaction_date = new Date().toISOString().split('T')[0];
    this.loadExpenses();
  }

  // ── LOAD ──────────────────────────────────────────────────

  async loadExpenses() {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const result = await this.db.getExpenses(this.currentFarm.farm_id);
      if (result.success) {
        this.expenses = result.data || [];
        this.applyFilters();
      }
    } catch (err: any) {
      this.errorMessage = 'Failed to load expenses: ' + err.message;
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  // ── FILTERS ──────────────────────────────────────────────

  applyFilters() {
    let filtered = [...this.expenses];

    if (this.filterDateFrom) {
      filtered = filtered.filter(e => e.transaction_date >= this.filterDateFrom);
    }
    if (this.filterDateTo) {
      filtered = filtered.filter(e => e.transaction_date <= this.filterDateTo);
    }
    if (this.filterCategory) {
      filtered = filtered.filter(e => e.category === this.filterCategory);
    }

    this.filteredExpenses = filtered;
    this.cdr.detectChanges();
  }

  clearFilters() {
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.filterCategory = '';
    this.filteredExpenses = [...this.expenses];
    this.cdr.detectChanges();
  }

  // ── CALCULATIONS ─────────────────────────────────────────

  getTotalExpenses(): number {
    return this.filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  }

  getCategoryTotal(category: string): number {
    return this.filteredExpenses
      .filter(e => e.category === category)
      .reduce((sum, e) => sum + (e.amount || 0), 0);
  }

  getCategoryCount(category: string): number {
    return this.filteredExpenses.filter(e => e.category === category).length;
  }

  // 🔥 NEW: helper methods for template (no arrow functions)
  getActiveCategoryCount(): number {
    return this.categories.filter(c => this.getCategoryCount(c) > 0).length;
  }

  getAverageExpense(): number {
    if (this.filteredExpenses.length === 0) return 0;
    return this.getTotalExpenses() / this.filteredExpenses.length;
  }

  // ── FORM ──────────────────────────────────────────────────

  openAddForm() {
    this.showForm = true;
    this.isEditing = false;
    this.editingId = null;
    this.expenseForm = {
      transaction_date: new Date().toISOString().split('T')[0],
      description: '',
      amount: 0,
      category: '',
      payment_type: 'cash',
      notes: ''
    };
    this.errorMessage = '';
  }

  editExpense(expense: any) {
    this.showForm = true;
    this.isEditing = true;
    this.editingId = expense.expense_id;
    this.expenseForm = {
      transaction_date: expense.transaction_date,
      description: expense.description,
      amount: expense.amount,
      category: expense.category || '',
      payment_type: expense.payment_type || 'cash',
      notes: expense.notes || ''
    };
    this.errorMessage = '';
  }

  closeForm() {
    this.showForm = false;
    this.isEditing = false;
    this.editingId = null;
  }

  async saveExpense() {
    if (!this.expenseForm.description.trim()) {
      this.errorMessage = 'Description is required';
      return;
    }
    if (!this.expenseForm.amount || this.expenseForm.amount <= 0) {
      this.errorMessage = 'Please enter a valid amount';
      return;
    }
    if (!this.expenseForm.category) {
      this.errorMessage = 'Please select a category';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';

    try {
      if (this.isEditing && this.editingId) {
        await this.db.updateExpense(this.editingId, {
          transaction_date: this.expenseForm.transaction_date,
          description: this.expenseForm.description,
          amount: this.expenseForm.amount,
          category: this.expenseForm.category,
          payment_type: this.expenseForm.payment_type,
          notes: this.expenseForm.notes
        });
      } else {
        await this.db.addExpense({
          farm_id: this.currentFarm.farm_id,
          transaction_date: this.expenseForm.transaction_date,
          description: this.expenseForm.description,
          amount: this.expenseForm.amount,
          category: this.expenseForm.category,
          payment_type: this.expenseForm.payment_type,
          notes: this.expenseForm.notes
        });
      }
      this.closeForm();
      await this.loadExpenses();
    } catch (err: any) {
      this.errorMessage = 'Failed to save expense: ' + err.message;
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }

  // ── DELETE ─────────────────────────────────────────────────

  confirmDelete(id: number) {
    this.deletingId = id;
    this.showDeleteCodeDialog = true;
  }

  onDeleteCodeVerified() {
    this.showDeleteCodeDialog = false;
    this.showDeleteDialog = true;
  }

  onDeleteCodeCancelled() {
    this.showDeleteCodeDialog = false;
    this.deletingId = null;
  }

  async onDeleteConfirmed() {
    if (!this.deletingId) return;
    try {
      await this.db.deleteExpense(this.deletingId);
      this.showDeleteDialog = false;
      this.deletingId = null;
      await this.loadExpenses();
    } catch (err: any) {
      this.errorMessage = 'Failed to delete expense: ' + err.message;
    }
  }

  onDeleteCancelled() {
    this.showDeleteDialog = false;
    this.deletingId = null;
  }

  // ── PDF REPORT ────────────────────────────────────────────

  printReport() {
    const doc = new jsPDF('p', 'mm', 'a4');
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const B: [number, number, number] = [0, 0, 0];
    const G: [number, number, number] = [120, 120, 120];
    const farmName = this.currentFarm?.farm_name || 'Farm';
    const today = new Date().toISOString().split('T')[0];
    const margin = 14;
    const pageWidth = pw - (margin * 2);

    let y = 20;

    // ── HEADER ──────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...B);
    doc.text(farmName.toUpperCase(), pw / 2, y, { align: 'center' });
    y += 8;

    doc.setFontSize(14);
    doc.setTextColor(...B);
    doc.text('EXPENSE LEDGER REPORT', pw / 2, y, { align: 'center' });
    y += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...G);
    doc.text(`Report Date: ${today}`, margin, y);
    doc.text(`Farm ID: ${this.currentFarm?.farm_id || ''}`, pw - margin, y, { align: 'right' });
    y += 10;

    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pw - margin, y);
    y += 8;

    // ── SUMMARY ──────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...B);
    doc.text('SUMMARY', margin, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Total Expenses: Rs. ${this.getTotalExpenses().toLocaleString()}`, margin + 5, y);
    y += 5;
    doc.text(`Total Entries: ${this.filteredExpenses.length}`, margin + 5, y);
    y += 8;

    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pw - margin, y);
    y += 8;

    // ── CATEGORY BREAKDOWN ──────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...B);
    doc.text('CATEGORY BREAKDOWN', margin, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    for (const cat of this.categories) {
      const total = this.getCategoryTotal(cat);
      if (total > 0) {
        const count = this.getCategoryCount(cat);
        doc.text(`${cat}: Rs. ${total.toLocaleString()} (${count} entries)`, margin + 5, y);
        y += 5;
      }
    }
    y += 8;

    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pw - margin, y);
    y += 8;

    // ── TABLE ──────────────────────────────────────────────
    const tableData = this.filteredExpenses.map((e: any) => [
      e.transaction_date || '',
      e.category || '—',
      e.description || '—',
      e.payment_type || '—',
      'Rs. ' + (e.amount || 0).toLocaleString(),
      e.notes || ''
    ]);

    autoTable(doc, {
      startY: y,
      head: [['Date', 'Category', 'Description', 'Payment', 'Amount', 'Notes']],
      body: tableData.length > 0 ? tableData : [['No expenses found', '', '', '', '', '']],
      theme: 'striped',
      headStyles: {
        fontStyle: 'bold',
        fontSize: 8,
        fillColor: [26, 92, 56],
        textColor: [255, 255, 255],
        halign: 'center'
      },
      bodyStyles: {
        fontSize: 8,
        textColor: [0, 0, 0]
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245]
      },
      margin: { left: margin, right: margin },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 25 },
        2: { cellWidth: 40 },
        3: { cellWidth: 22 },
        4: { cellWidth: 25, halign: 'right' },
        5: { cellWidth: 30 }
      },
      tableWidth: pageWidth,
      styles: {
        overflow: 'linebreak',
        cellPadding: 3
      },
      didDrawPage: (data: any) => {
        const pageNumber = (doc as any).internal.getCurrentPageInfo().pageNumber;
        const totalPages = (doc as any).internal.getNumberOfPages();
        doc.setFontSize(7);
        doc.setTextColor(...G);
        doc.text(`Page ${pageNumber} of ${totalPages}`, pw / 2, ph - 8, { align: 'center' });
      }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 8;

    // ── FOOTER ──────────────────────────────────────────────
    doc.setFontSize(7);
    doc.setTextColor(...G);
    const footer = 'Generated by: www.devinfantary.com  |  Contact: 0302 6938217';
    doc.text(footer, pw / 2, ph - 4, { align: 'center' });

    doc.save(`Expense_Report_${today}.pdf`);
  }
}