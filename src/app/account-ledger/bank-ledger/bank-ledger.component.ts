import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DatabaseService } from '../../shared/services/database.service';
import { AuthService } from '../../shared/services/auth.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

@Component({
  selector: 'app-bank-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  templateUrl: './bank-ledger.component.html',
  styleUrl: './bank-ledger.component.scss'
})
export class BankLedgerComponent implements OnInit {
  currentFarm: any = null;
  bankAccounts: any[] = [];
  selectedBank: any = null;
  ledgerEntries: any[] = [];
  isLoading = true;
  errorMessage = '';
  
  // Bank form
  showBankForm = false;
  isEditingBank = false;
  editingBankId: number | null = null;
  bankForm: any = {
    bank_name: '',
    account_number: '',
    account_holder: '',
    opening_balance: 0
  };
  
  // Transaction form
  showTransactionForm = false;
  transactionType: 'deposit' | 'withdrawal' = 'deposit';
  transactionAmount: number = 0;
  transactionDate: string = '';
  transactionNote: string = '';
  isSubmitting = false;
  
  showDeleteDialog = false;
  deletingId: number | null = null;
  deleteType: 'bank' | 'entry' = 'bank';

  constructor(
    private router: Router,
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.transactionDate = new Date().toISOString().split('T')[0];
    this.loadBanks();
  }

  async loadBanks() {
    this.isLoading = true;
    this.errorMessage = '';
    
    try {
      const result = await this.db.getBankAccounts(this.currentFarm.farm_id);
      if (result.success) {
        this.bankAccounts = result.data || [];
      }
    } catch (error: any) {
      this.errorMessage = 'Failed to load bank accounts: ' + error.message;
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  async loadBankDetail(bankId: number) {
    this.isLoading = true;
    this.errorMessage = '';
    this.selectedBank = null;
    this.ledgerEntries = [];
    
    try {
      const bank = await this.db.getBankAccount(bankId);
      if (bank) {
        this.selectedBank = bank;
        const ledgerResult = await this.db.getBankLedgerWithBalance(bankId);
        if (ledgerResult.success) {
          this.ledgerEntries = ledgerResult.data || [];
        }
      } else {
        this.errorMessage = 'Bank account not found';
      }
    } catch (error: any) {
      this.errorMessage = 'Failed to load bank details: ' + error.message;
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  selectBank(bank: any) {
    this.selectedBank = bank;
    this.loadBankDetail(bank.bank_id);
  }

  goBack() {
    this.selectedBank = null;
    this.ledgerEntries = [];
    this.loadBanks();
  }

  getTotalBalance(): number {
    return this.bankAccounts.reduce((sum, b) => sum + (b.current_balance || 0), 0);
  }

  getBankBalance(): number {
    if (this.ledgerEntries.length === 0) return 0;
    return this.ledgerEntries[this.ledgerEntries.length - 1]?.balance || 0;
  }

  getTotalDeposits(): number {
    return this.ledgerEntries.reduce((sum, e) => sum + (e.debit || 0), 0);
  }

  getTotalWithdrawals(): number {
    return this.ledgerEntries.reduce((sum, e) => sum + (e.credit || 0), 0);
  }

  // ── Bank Account CRUD ─────────────────────────────────────

  openBankForm(bank?: any) {
    this.showBankForm = true;
    if (bank) {
      this.isEditingBank = true;
      this.editingBankId = bank.bank_id;
      this.bankForm = {
        bank_name: bank.bank_name,
        account_number: bank.account_number || '',
        account_holder: bank.account_holder || '',
        opening_balance: bank.opening_balance || 0
      };
    } else {
      this.isEditingBank = false;
      this.editingBankId = null;
      this.bankForm = {
        bank_name: '',
        account_number: '',
        account_holder: '',
        opening_balance: 0
      };
    }
  }

  closeBankForm() {
    this.showBankForm = false;
    this.isEditingBank = false;
    this.editingBankId = null;
  }

  async saveBank() {
    if (!this.bankForm.bank_name.trim()) {
      this.errorMessage = 'Bank name is required';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';

    try {
      if (this.isEditingBank && this.editingBankId) {
        await this.db.updateBankAccount(this.editingBankId, {
          bank_name: this.bankForm.bank_name,
          account_number: this.bankForm.account_number,
          account_holder: this.bankForm.account_holder
        });
      } else {
        await this.db.addBankAccount({
          farm_id: this.currentFarm.farm_id,
          bank_name: this.bankForm.bank_name,
          account_number: this.bankForm.account_number,
          account_holder: this.bankForm.account_holder,
          opening_balance: this.bankForm.opening_balance || 0
        });
      }
      
      this.closeBankForm();
      await this.loadBanks();
    } catch (error: any) {
      this.errorMessage = 'Failed to save bank: ' + error.message;
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }

  // ── Transactions ──────────────────────────────────────────

  openTransactionForm(type: 'deposit' | 'withdrawal') {
    this.transactionType = type;
    this.showTransactionForm = true;
    this.transactionAmount = 0;
    this.transactionDate = new Date().toISOString().split('T')[0];
    this.transactionNote = '';
  }

  closeTransactionForm() {
    this.showTransactionForm = false;
    this.transactionAmount = 0;
    this.transactionNote = '';
  }

  async submitTransaction() {
    if (!this.transactionAmount || this.transactionAmount <= 0) {
      this.errorMessage = 'Please enter a valid amount';
      return;
    }

    if (this.transactionType === 'withdrawal' && this.transactionAmount > this.getBankBalance()) {
      this.errorMessage = 'Insufficient balance';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';

    try {
      const isDeposit = this.transactionType === 'deposit';
      await this.db.addBankLedgerEntry({
        bank_id: this.selectedBank.bank_id,
        transaction_date: this.transactionDate,
        description: this.transactionNote || (isDeposit ? 'Deposit' : 'Withdrawal'),
        debit: isDeposit ? this.transactionAmount : 0,
        credit: isDeposit ? 0 : this.transactionAmount,
        reference_type: this.transactionType,
      });

      this.closeTransactionForm();
      await this.loadBankDetail(this.selectedBank.bank_id);
    } catch (error: any) {
      this.errorMessage = 'Failed to record transaction: ' + error.message;
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }

  // ── Delete ─────────────────────────────────────────────────

  confirmDelete(id: number, type: 'bank' | 'entry') {
    this.deletingId = id;
    this.deleteType = type;
    this.showDeleteDialog = true;
  }

  async onDeleteConfirmed() {
    if (!this.deletingId) return;

    try {
      if (this.deleteType === 'bank') {
        await this.db.deleteBankAccount(this.deletingId);
        this.showDeleteDialog = false;
        this.deletingId = null;
        await this.loadBanks();
      } else {
        await this.db.run('DELETE FROM bank_ledger WHERE ledger_id = ?', [this.deletingId]);
        await this.loadBankDetail(this.selectedBank.bank_id);
        this.showDeleteDialog = false;
        this.deletingId = null;
      }
    } catch (error: any) {
      this.errorMessage = 'Failed to delete: ' + error.message;
    }
  }

  onDeleteCancelled() {
    this.showDeleteDialog = false;
    this.deletingId = null;
  }

  // ── PROFESSIONAL PDF REPORT ──────────────────────────────

  printReport() {
    if (!this.selectedBank) return;
    
    const doc = new jsPDF();
    const pw = doc.internal.pageSize.getWidth();
    const B: [number, number, number] = [0, 0, 0];
    const farmName = this.currentFarm?.farm_name || 'Farm';
    const today = new Date().toISOString().split('T')[0];
    
    let y = 20;
    
    // ── Header ──────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...B);
    doc.text(farmName.toUpperCase(), pw / 2, y, { align: 'center' });
    y += 8;
    
    doc.setFontSize(12);
    doc.text('Bank Ledger Report', pw / 2, y, { align: 'center' });
    y += 8;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Report Date: ${today}`, 14, y);
    doc.text(`Farm ID: ${this.currentFarm?.farm_id || ''}`, pw - 14, y, { align: 'right' });
    y += 6;
    
    // ── Bank Info ──────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Bank: ${this.selectedBank.bank_name}`, 14, y);
    y += 6;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Account #: ${this.selectedBank.account_number || 'N/A'}`, 14, y);
    y += 6;
    doc.text(`Account Holder: ${this.selectedBank.account_holder || 'N/A'}`, 14, y);
    y += 6;
    doc.text(`Current Balance: Rs. ${this.getBankBalance().toLocaleString()}`, 14, y);
    y += 8;
    
    doc.setDrawColor(...B);
    doc.line(14, y, pw - 14, y);
    y += 6;
    
    // ── Table ──────────────────────────────────────────────
    const tableData = this.ledgerEntries.map((entry: any) => [
      entry.transaction_date || '',
      entry.description || '—',
      entry.debit > 0 ? 'Rs. ' + entry.debit.toLocaleString() : '—',
      entry.credit > 0 ? 'Rs. ' + entry.credit.toLocaleString() : '—',
      'Rs. ' + (entry.balance || 0).toLocaleString()
    ]);
    
    autoTable(doc, {
      startY: y,
      head: [['Date', 'Description', 'Deposit', 'Withdrawal', 'Balance']],
      body: tableData.length > 0 ? tableData : [['No transactions found', '', '', '', '']],
      theme: 'striped',
      headStyles: { fontStyle: 'bold', fontSize: 9, fillColor: [249, 168, 37], textColor: [0, 0, 0] },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 60 },
        2: { cellWidth: 35, halign: 'right' },
        3: { cellWidth: 35, halign: 'right' },
        4: { cellWidth: 40, halign: 'right' }
      }
    });
    
    const finalY = (doc as any).lastAutoTable.finalY + 6;
    
    // ── Summary ─────────────────────────────────────────────
    doc.setDrawColor(...B);
    doc.line(14, finalY, pw - 14, finalY);
    y = finalY + 6;
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('SUMMARY', 14, y);
    y += 6;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Total Deposits: Rs. ${this.getTotalDeposits().toLocaleString()}`, 20, y);
    y += 5;
    doc.text(`Total Withdrawals: Rs. ${this.getTotalWithdrawals().toLocaleString()}`, 20, y);
    y += 5;
    doc.text(`Current Balance: Rs. ${this.getBankBalance().toLocaleString()}`, 20, y);
    y += 8;
    
    // ── Footer ──────────────────────────────────────────────
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';
    doc.text(footer, pw / 2, 285, { align: 'center' });
    
    // ── Save ────────────────────────────────────────────────
    doc.save(`Bank_Ledger_${this.selectedBank.bank_name}_${today}.pdf`);
  }
}