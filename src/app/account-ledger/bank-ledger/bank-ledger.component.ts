import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
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
  customers: any[] = [];
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
    customer_id: null,
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
    private route: ActivatedRoute,
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.transactionDate = new Date().toISOString().split('T')[0];
    
    this.loadCustomers().then(() => {
      this.loadBanks();
    });
    
    this.route.queryParams.subscribe(params => {
      const customerId = params['customerId'];
      if (customerId) {
        this.bankForm.customer_id = Number(customerId);
        setTimeout(() => {
          this.openBankForm();
        }, 600);
      }
    });
  }

  // ── LOAD METHODS ──────────────────────────────────────────

  async loadCustomers() {
    try {
      const result = await this.db.get(
        'SELECT customer_id, customer_name FROM customers WHERE farm_id = ? ORDER BY customer_name ASC',
        [this.currentFarm.farm_id]
      );
      if (result.success) {
        this.customers = result.data || [];
        console.log(`✅ Loaded ${this.customers.length} customers`);
      }
    } catch (error) {
      console.error('Error loading customers:', error);
    }
  }

  async loadBanks() {
    this.isLoading = true;
    this.errorMessage = '';
    
    try {
      const result = await this.db.getBankAccounts(this.currentFarm.farm_id);
      if (result.success) {
        this.bankAccounts = result.data || [];
        for (const bank of this.bankAccounts) {
          const customer = this.customers.find(c => c.customer_id === bank.customer_id);
          bank.customer_name = customer ? customer.customer_name : '—';
        }
        console.log(`✅ Loaded ${this.bankAccounts.length} bank accounts`);
      }
    } catch (error: any) {
      this.errorMessage = 'Failed to load bank accounts: ' + error.message;
      console.error('Error loading banks:', error);
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
        const customer = this.customers.find(c => c.customer_id === bank.customer_id);
        bank.customer_name = customer ? customer.customer_name : '—';
        this.selectedBank = bank;
        
        const ledgerResult = await this.db.getBankLedgerWithBalance(bankId);
        if (ledgerResult.success) {
          this.ledgerEntries = ledgerResult.data || [];
          console.log(`✅ Loaded ${this.ledgerEntries.length} ledger entries for bank ${bankId}`);
        }
      } else {
        this.errorMessage = 'Bank account not found';
      }
    } catch (error: any) {
      this.errorMessage = 'Failed to load bank details: ' + error.message;
      console.error('Error loading bank detail:', error);
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

  // ── CALCULATION METHODS ──────────────────────────────────

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

  getCustomerName(customerId: number): string {
    if (!customerId) return '—';
    const customer = this.customers.find(c => c.customer_id === customerId);
    return customer ? customer.customer_name : '—';
  }

  // ── Bank Account CRUD ─────────────────────────────────────

  openBankForm(bank?: any) {
    this.showBankForm = true;
    if (bank) {
      this.isEditingBank = true;
      this.editingBankId = bank.bank_id;
      this.bankForm = {
        customer_id: bank.customer_id || null,
        bank_name: bank.bank_name,
        account_number: bank.account_number || '',
        account_holder: bank.account_holder || '',
        opening_balance: bank.opening_balance || 0
      };
    } else {
      this.isEditingBank = false;
      this.editingBankId = null;
      this.bankForm = {
        customer_id: this.bankForm.customer_id || null,
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
      this.cdr.detectChanges();
      return;
    }

    if (!this.bankForm.customer_id) {
      this.errorMessage = 'Please select a customer';
      this.cdr.detectChanges();
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
        const addResult = await this.db.addBankAccount({
          farm_id: this.currentFarm.farm_id,
          customer_id: this.bankForm.customer_id,
          bank_name: this.bankForm.bank_name,
          account_number: this.bankForm.account_number,
          account_holder: this.bankForm.account_holder,
          opening_balance: this.bankForm.opening_balance || 0
        });

        if (addResult && addResult.lastId) {
          await this.db.linkCustomerToBank(this.bankForm.customer_id, addResult.lastId);
        }
      }
      
      this.closeBankForm();
      await this.loadBanks();
      
    } catch (error: any) {
      this.errorMessage = 'Failed to save bank: ' + error.message;
      console.error('Error saving bank:', error);
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
    this.errorMessage = '';
  }

  closeTransactionForm() {
    this.showTransactionForm = false;
    this.transactionAmount = 0;
    this.transactionNote = '';
  }

  async submitTransaction() {
    if (!this.transactionAmount || this.transactionAmount <= 0) {
      this.errorMessage = 'Please enter a valid amount';
      this.cdr.detectChanges();
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
      console.error('Error recording transaction:', error);
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
      console.error('Error deleting:', error);
    }
  }

  onDeleteCancelled() {
    this.showDeleteDialog = false;
    this.deletingId = null;
  }

  // ── PROFESSIONAL PDF REPORT ──────────────────────────────

  printReport() {
    if (!this.selectedBank) return;
    
    const doc = new jsPDF('p', 'mm', 'a4');
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const B: [number, number, number] = [0, 0, 0];
    const G: [number, number, number] = [120, 120, 120];
    const W: [number, number, number] = [255, 255, 255];
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
    doc.text('BANK LEDGER REPORT', pw / 2, y, { align: 'center' });
    y += 8;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...G);
    doc.text(`Report Date: ${today}`, margin, y);
    doc.text(`Farm ID: ${this.currentFarm?.farm_id || ''}`, pw - margin, y, { align: 'right' });
    y += 10;
    
    // ── DIVIDER ─────────────────────────────────────────────
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pw - margin, y);
    y += 8;
    
    // ── BANK INFO ──────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...B);
    doc.text('Bank Details', margin, y);
    y += 6;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...B);
    doc.text(`Bank: ${this.selectedBank.bank_name}`, margin, y);
    doc.text(`Customer: ${this.selectedBank.customer_name || 'N/A'}`, margin + 70, y);
    y += 5;
    doc.text(`Account #: ${this.selectedBank.account_number || 'N/A'}`, margin, y);
    doc.text(`Account Holder: ${this.selectedBank.account_holder || 'N/A'}`, margin + 70, y);
    y += 5;
    doc.text(`Current Balance: Rs. ${this.getBankBalance().toLocaleString()}`, margin, y);
    y += 10;
    
    // ── DIVIDER ─────────────────────────────────────────────
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pw - margin, y);
    y += 8;
    
    // ── TABLE ──────────────────────────────────────────────
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
      headStyles: { 
        fontStyle: 'bold', 
        fontSize: 8, 
        fillColor: [13, 71, 161], 
        textColor: [255, 255, 255],
        halign: 'center'
      },
      bodyStyles: { 
        fontSize: 8, 
        textColor: [0, 0, 0],
        halign: 'center'
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245]
      },
      margin: { left: margin, right: margin },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 60 },
        2: { cellWidth: 35, halign: 'right' },
        3: { cellWidth: 35, halign: 'right' },
        4: { cellWidth: 40, halign: 'right' }
      },
      tableWidth: pageWidth,
      styles: {
        overflow: 'linebreak',
        cellPadding: 4
      },
      didDrawPage: (data: any) => {
        // Add page number
        const pageNumber = (doc as any).internal.getCurrentPageInfo().pageNumber;
        const totalPages = (doc as any).internal.getNumberOfPages();
        doc.setFontSize(7);
        doc.setTextColor(...G);
        doc.text(`Page ${pageNumber} of ${totalPages}`, pw / 2, ph - 8, { align: 'center' });
      }
    });
    
    const finalY = (doc as any).lastAutoTable.finalY + 8;
    
    // ── SUMMARY ─────────────────────────────────────────────
    if (finalY < ph - 40) {
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, finalY, pw - margin, finalY);
      y = finalY + 8;
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...B);
      doc.text('SUMMARY', margin, y);
      y += 6;
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`Total Deposits:     Rs. ${this.getTotalDeposits().toLocaleString()}`, margin + 5, y);
      y += 5;
      doc.text(`Total Withdrawals:  Rs. ${this.getTotalWithdrawals().toLocaleString()}`, margin + 5, y);
      y += 5;
      doc.text(`Current Balance:    Rs. ${this.getBankBalance().toLocaleString()}`, margin + 5, y);
      y += 10;
    }
    
    // ── FOOTER ──────────────────────────────────────────────
    doc.setFontSize(7);
    doc.setTextColor(...G);
    const footer = 'Generated by: www.devinfantary.com  |  Contact: 0302 6938217';
    doc.text(footer, pw / 2, ph - 4, { align: 'center' });
    
    // ── SAVE ────────────────────────────────────────────────
    doc.save(`Bank_Ledger_${this.selectedBank.bank_name}_${today}.pdf`);
  }
}