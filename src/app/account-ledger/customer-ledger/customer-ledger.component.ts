import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DatabaseService } from '../../shared/services/database.service';
import { AuthService } from '../../shared/services/auth.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

@Component({
  selector: 'app-customer-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  templateUrl: './customer-ledger.component.html',
  styleUrl: './customer-ledger.component.scss'
})
export class CustomerLedgerComponent implements OnInit {
  currentFarm: any = null;
  customers: any[] = [];
  filteredCustomers: any[] = [];
  selectedCustomer: any = null;
  ledgerEntries: any[] = [];
  isLoading = true;
  errorMessage = '';
  searchTerm: string = '';
  
  // Payment form
  showPaymentForm = false;
  paymentAmount: number = 0;
  paymentDate: string = '';
  paymentNote: string = '';
  isSubmitting = false;
  
  // Delete dialog
  showDeleteDialog = false;
  deletingEntryId: number | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.paymentDate = new Date().toISOString().split('T')[0];
    
    // 🔥 FIX: Use route.params.subscribe to handle navigation properly
    this.route.params.subscribe(params => {
      const customerId = params['id'];
      if (customerId) {
        this.loadCustomerDetail(customerId);
      } else {
        this.loadCustomers();
      }
    });
  }

  // ── LOAD METHODS ──────────────────────────────────────────

  async loadCustomers() {
    this.isLoading = true;
    this.errorMessage = '';
    
    try {
      const result = await this.db.getAllCustomersWithBalance(this.currentFarm.farm_id);
      if (result.success) {
        this.customers = result.data || [];
        this.customers.sort((a, b) => (b.outstanding_balance || 0) - (a.outstanding_balance || 0));
        this.filteredCustomers = [...this.customers];
      }
    } catch (error: any) {
      this.errorMessage = 'Failed to load customers: ' + error.message;
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  async loadCustomerDetail(customerId: number) {
    this.isLoading = true;
    this.errorMessage = '';
    this.selectedCustomer = null;
    this.ledgerEntries = [];
    
    try {
      const customerResult = await this.db.get(
        'SELECT * FROM customers WHERE customer_id = ? AND farm_id = ?',
        [customerId, this.currentFarm.farm_id]
      );
      
      if (customerResult.success && customerResult.data && customerResult.data.length > 0) {
        this.selectedCustomer = customerResult.data[0];
        
        const ledgerResult = await this.db.getCustomerLedgerWithBalance(customerId);
        if (ledgerResult.success) {
          this.ledgerEntries = ledgerResult.data || [];
        }
      } else {
        this.errorMessage = 'Customer not found';
      }
    } catch (error: any) {
      this.errorMessage = 'Failed to load customer details: ' + error.message;
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  // ── SEARCH METHODS ────────────────────────────────────────

  filterCustomers() {
    if (!this.searchTerm.trim()) {
      this.filteredCustomers = [...this.customers];
      return;
    }
    
    const term = this.searchTerm.toLowerCase().trim();
    this.filteredCustomers = this.customers.filter(c => 
      c.customer_name.toLowerCase().includes(term) ||
      (c.phone && c.phone.includes(term))
    );
    this.cdr.detectChanges();
  }

  clearSearch() {
    this.searchTerm = '';
    this.filteredCustomers = [...this.customers];
    this.cdr.detectChanges();
  }

  // ── NAVIGATION METHODS ────────────────────────────────────

  selectCustomer(customer: any) {
    // 🔥 FIX: Use navigateByUrl to ensure proper navigation
    this.router.navigateByUrl(`/app/customer-ledger/${customer.customer_id}`).then(
      (success) => {
        if (!success) {
          console.error('Navigation failed');
          this.router.navigate(['/app/customer-ledger', customer.customer_id]);
        }
      }
    );
  }

  goBack() {
    this.selectedCustomer = null;
    this.ledgerEntries = [];
    this.searchTerm = '';
    // 🔥 FIX: Navigate back to the list view
    this.router.navigate(['/app/customer-ledger']).then(() => {
      this.loadCustomers();
    });
  }

  // ── CALCULATION METHODS ──────────────────────────────────

  getTotalOutstanding(): number {
    return this.filteredCustomers.reduce((sum, c) => sum + (c.outstanding_balance || 0), 0);
  }

  getTotalDebit(): number {
    return this.ledgerEntries.reduce((sum, e) => sum + (e.debit || 0), 0);
  }

  getTotalCredit(): number {
    return this.ledgerEntries.reduce((sum, e) => sum + (e.credit || 0), 0);
  }

  getCustomerBalance(): number {
    if (this.ledgerEntries.length === 0) return 0;
    return this.ledgerEntries[this.ledgerEntries.length - 1]?.balance || 0;
  }

  // ── PAYMENT METHODS ──────────────────────────────────────

  openPaymentForm() {
    this.showPaymentForm = true;
    this.paymentAmount = this.getCustomerBalance();
    this.paymentDate = new Date().toISOString().split('T')[0];
    this.paymentNote = '';
  }

  closePaymentForm() {
    this.showPaymentForm = false;
    this.paymentAmount = 0;
    this.paymentNote = '';
  }

  async submitPayment() {
    if (!this.paymentAmount || this.paymentAmount <= 0) {
      this.errorMessage = 'Please enter a valid payment amount';
      return;
    }
    
    if (this.paymentAmount > this.getCustomerBalance()) {
      this.errorMessage = 'Payment amount cannot exceed outstanding balance';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';

    try {
      await this.db.addCustomerLedgerEntry({
        customer_id: this.selectedCustomer.customer_id,
        transaction_date: this.paymentDate,
        description: this.paymentNote || 'Payment received',
        credit: this.paymentAmount,
        reference_type: 'payment'
      });

      await this.db.updateCustomerOutstandingBalance(this.selectedCustomer.customer_id);

      this.closePaymentForm();
      await this.loadCustomerDetail(this.selectedCustomer.customer_id);
      
    } catch (error: any) {
      this.errorMessage = 'Failed to record payment: ' + error.message;
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }

  // ── DELETE METHODS ──────────────────────────────────────

  confirmDeleteEntry(entryId: number) {
    this.deletingEntryId = entryId;
    this.showDeleteDialog = true;
  }

  async onDeleteConfirmed() {
    if (!this.deletingEntryId) return;
    
    try {
      await this.db.run('DELETE FROM customer_ledger WHERE ledger_id = ?', [this.deletingEntryId]);
      await this.db.updateCustomerOutstandingBalance(this.selectedCustomer.customer_id);
      this.showDeleteDialog = false;
      this.deletingEntryId = null;
      await this.loadCustomerDetail(this.selectedCustomer.customer_id);
    } catch (error: any) {
      this.errorMessage = 'Failed to delete entry: ' + error.message;
    }
  }

  onDeleteCancelled() {
    this.showDeleteDialog = false;
    this.deletingEntryId = null;
  }

  // ── PROFESSIONAL PDF REPORT ──────────────────────────────

  printReport() {
    if (!this.selectedCustomer) return;
    
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
    doc.text('Customer Ledger Report', pw / 2, y, { align: 'center' });
    y += 8;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Report Date: ${today}`, 14, y);
    doc.text(`Farm ID: ${this.currentFarm?.farm_id || ''}`, pw - 14, y, { align: 'right' });
    y += 6;
    
    // ── Customer Info ──────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Customer: ${this.selectedCustomer.customer_name}`, 14, y);
    y += 6;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Phone: ${this.selectedCustomer.phone || 'N/A'}`, 14, y);
    y += 6;
    doc.text(`Address: ${this.selectedCustomer.address || 'N/A'}`, 14, y);
    y += 6;
    doc.text(`Current Balance: Rs. ${this.getCustomerBalance().toLocaleString()}`, 14, y);
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
      head: [['Date', 'Description', 'Debit', 'Credit', 'Balance']],
      body: tableData.length > 0 ? tableData : [['No transactions found', '', '', '', '']],
      theme: 'striped',
      headStyles: { fontStyle: 'bold', fontSize: 9, fillColor: [26, 92, 56], textColor: [255, 255, 255] },
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
    doc.text(`Total Debit (Sales): Rs. ${this.getTotalDebit().toLocaleString()}`, 20, y);
    y += 5;
    doc.text(`Total Credit (Payments): Rs. ${this.getTotalCredit().toLocaleString()}`, 20, y);
    y += 5;
    doc.text(`Current Balance: Rs. ${this.getCustomerBalance().toLocaleString()}`, 20, y);
    y += 8;
    
    // ── Footer ──────────────────────────────────────────────
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';
    doc.text(footer, pw / 2, 285, { align: 'center' });
    
    // ── Save ────────────────────────────────────────────────
    doc.save(`Customer_Ledger_${this.selectedCustomer.customer_name}_${today}.pdf`);
  }
}