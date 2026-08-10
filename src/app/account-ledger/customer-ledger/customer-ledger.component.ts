import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DatabaseService } from '../../shared/services/database.service';
import { AuthService } from '../../shared/services/auth.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DeleteCodeDialogComponent } from '../../shared/components/delete-code-dialog/delete-code-dialog.component';

@Component({
  selector: 'app-customer-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DeleteCodeDialogComponent],
  templateUrl: './customer-ledger.component.html',
  styleUrl: './customer-ledger.component.scss'
})
export class CustomerLedgerComponent implements OnInit {
  currentFarm: any = null;
  customers: any[] = [];
  filteredCustomers: any[] = [];
  selectedCustomer: any = null;
  ledgerEntries: any[] = [];
  customerBills: any[] = [];
  isLoading = true;
  errorMessage = '';
  searchTerm: string = '';
  
  // Payment form
  showPaymentForm = false;
  paymentAmount: number = 0;
  paymentDate: string = '';
  paymentNote: string = '';
  isSubmitting = false;
  
  // Bill selection for payment
  selectedBillId: number | null = null;
  showBillSelection: boolean = false;
  unpaidBills: any[] = [];
  
  // Delete dialog
  showDeleteDialog = false;
  showDeleteCodeDialog: boolean = false;
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
    this.customerBills = [];
    this.unpaidBills = [];
    
    try {
      // 🔥 selectedCustomer.outstanding_balance comes from this query, and is
      // now bills-derived (see DatabaseService.updateCustomerOutstandingBalance).
      // This is what getCustomerBalance() reads from, so it always matches
      // what Sales Orders / Reports show for this customer.
      const customerResult = await this.db.get(
        `SELECT c.*,
          (SELECT COALESCE(SUM(MAX(COALESCE(total_amount, 0) - COALESCE(amount_paid, 0), 0)), 0) FROM bills WHERE customer_id = c.customer_id) as outstanding_balance
         FROM customers c
         WHERE c.customer_id = ? AND c.farm_id = ?`,
        [customerId, this.currentFarm.farm_id]
      );
      
      if (customerResult.success && customerResult.data && customerResult.data.length > 0) {
        this.selectedCustomer = customerResult.data[0];
        
        const ledgerResult = await this.db.getCustomerLedgerWithBalance(customerId);
        if (ledgerResult.success) {
          this.ledgerEntries = ledgerResult.data || [];
        }
        
        // Load customer's unpaid bills
        const billsResult = await this.db.get(
          `SELECT * FROM bills 
           WHERE customer_id = ? 
           AND (COALESCE(amount_paid, 0) < COALESCE(total_amount, 0))
           ORDER BY bill_date ASC`,
          [customerId]
        );
        if (billsResult.success) {
          this.customerBills = billsResult.data || [];
          this.unpaidBills = this.customerBills.filter(b => (b.amount_paid || 0) < (b.total_amount || 0));
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
    this.customerBills = [];
    this.unpaidBills = [];
    this.searchTerm = '';
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

  // 🔥 FIX: read the balance straight off the customer record (bills-derived),
  // instead of trusting the last ledger row's running `balance` field.
  // This is the single change that keeps this screen in sync with
  // Sales Orders and the Distribution Report.
  getCustomerBalance(): number {
    return this.selectedCustomer?.outstanding_balance || 0;
  }

  // ── PAYMENT METHODS ──────────────────────────────────────

  openPaymentForm() {
    this.showPaymentForm = true;
    this.paymentAmount = this.getCustomerBalance();
    this.paymentDate = new Date().toISOString().split('T')[0];
    this.paymentNote = '';
    this.selectedBillId = null;
    
    this.showBillSelection = this.unpaidBills.length > 0;
    if (this.unpaidBills.length === 1) {
      this.selectedBillId = this.unpaidBills[0].bill_id;
    }
  }

  closePaymentForm() {
    this.showPaymentForm = false;
    this.paymentAmount = 0;
    this.paymentNote = '';
    this.selectedBillId = null;
    this.showBillSelection = false;
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
      // 🔥 FIX: apply the payment to the actual bill(s) FIRST. This is the
      // real, authoritative change — everything else (ledger entry, balance
      // recalculation) is derived from this and must happen after it.
      //
      // If a specific bill was selected, pay that one first — but if the
      // entered amount is larger than that bill's outstanding balance
      // (e.g. the form was left at its default "total balance" prefill),
      // any leftover is distributed FIFO across the customer's other
      // unpaid bills instead of being silently discarded. This guarantees
      // the full paymentAmount always lands on real bills, matching the
      // credit amount that gets written to the ledger below.
      let remaining = this.paymentAmount;

      const payOrder = this.selectedBillId
        ? [
            ...this.unpaidBills.filter(b => b.bill_id === this.selectedBillId),
            ...this.unpaidBills.filter(b => b.bill_id !== this.selectedBillId)
          ]
        : this.unpaidBills;

      for (const bill of payOrder) {
        if (remaining <= 0) break;
        const currentPaid = bill.amount_paid || 0;
        const totalAmount = bill.total_amount || 0;
        const outstanding = totalAmount - currentPaid;

        if (outstanding > 0) {
          const payAmount = Math.min(remaining, outstanding);
          const newPaid = currentPaid + payAmount;
          await this.db.run(
            'UPDATE bills SET amount_paid = ? WHERE bill_id = ?',
            [newPaid, bill.bill_id]
          );
          remaining -= payAmount;
        }
      }

      // Log to customer_ledger for the audit trail / PDF statement.
      // This is display-only now — it no longer feeds outstanding_balance.
      //
      // 🔥 FIX: tag each entry with the bill_id it was actually applied to
      // (matching the same distribution used above), so that if Sales
      // Orders later edits that bill and regenerates its ledger entries
      // (which deletes by reference_id), this payment gets replaced
      // instead of surviving as an untagged, double-counted duplicate.
      if (this.selectedBillId) {
        await this.db.addCustomerLedgerEntry({
          customer_id: this.selectedCustomer.customer_id,
          transaction_date: this.paymentDate,
          description: this.paymentNote || 'Payment received',
          credit: this.paymentAmount,
          reference_type: 'payment',
          reference_id: this.selectedBillId
        });
      } else {
        // Distributed across multiple bills — log one tagged entry per bill actually paid.
        let remainingForLog = this.paymentAmount;
        for (const bill of this.unpaidBills) {
          if (remainingForLog <= 0) break;
          const outstanding = (bill.total_amount || 0) - (bill.amount_paid || 0);
          if (outstanding > 0) {
            const payAmount = Math.min(remainingForLog, outstanding);
            await this.db.addCustomerLedgerEntry({
              customer_id: this.selectedCustomer.customer_id,
              transaction_date: this.paymentDate,
              description: this.paymentNote || 'Payment received',
              credit: payAmount,
              reference_type: 'payment',
              reference_id: bill.bill_id
            });
            remainingForLog -= payAmount;
          }
        }
      }

      // 🔥 FIX: recompute AFTER bills are updated, since the balance is
      // now derived from bills.amount_paid vs bills.total_amount
      await this.db.updateCustomerOutstandingBalance(this.selectedCustomer.customer_id);

      this.closePaymentForm();
      await this.loadCustomerDetail(this.selectedCustomer.customer_id);
      
    } catch (error: any) {
      this.errorMessage = 'Failed to record payment: ' + error.message;
      console.error('Payment error:', error);
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }

  // ── DELETE METHODS ──────────────────────────────────────

  confirmDeleteEntry(entryId: number) {
    this.deletingEntryId = entryId;
    this.showDeleteCodeDialog = true;
  }

  onDeleteCodeVerified() {
    this.showDeleteCodeDialog = false;
    this.showDeleteDialog = true;
  }

  onDeleteCodeCancelled() {
    this.showDeleteCodeDialog = false;
    this.deletingEntryId = null;
  }

  async onDeleteConfirmed() {
    if (!this.deletingEntryId) return;
    
    try {
      await this.db.run('DELETE FROM customer_ledger WHERE ledger_id = ?', [this.deletingEntryId]);
      // NOTE: outstanding_balance is derived from `bills`, not from
      // customer_ledger, so deleting a ledger row only removes it from the
      // history/PDF statement — it does NOT and should NOT change the real
      // outstanding balance. To actually reverse a payment, undo it on the
      // bill itself (in Sales Orders) so bills.amount_paid reflects reality.
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
    doc.text('CUSTOMER LEDGER REPORT', pw / 2, y, { align: 'center' });
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
    
    // ── CUSTOMER INFO ──────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...B);
    doc.text('Customer Details', margin, y);
    y += 6;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...B);
    doc.text(`Customer: ${this.selectedCustomer.customer_name}`, margin, y);
    doc.text(`Phone: ${this.selectedCustomer.phone || 'N/A'}`, margin + 70, y);
    y += 5;
    doc.text(`Address: ${this.selectedCustomer.address || 'N/A'}`, margin, y);
    y += 5;
    doc.text(`Current Balance: Rs. ${this.getCustomerBalance().toLocaleString()}`, margin, y);
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
      head: [['Date', 'Description', 'Debit', 'Credit', 'Balance']],
      body: tableData.length > 0 ? tableData : [['No transactions found', '', '', '', '']],
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
        const pageInfo = (doc.internal as any).getCurrentPageInfo?.() || { pageNumber: doc.getNumberOfPages() };
        const pageNumber = pageInfo.pageNumber;
        const totalPages = doc.getNumberOfPages();
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
      doc.text(`Total Debit (Sales):    Rs. ${this.getTotalDebit().toLocaleString()}`, margin + 5, y);
      y += 5;
      doc.text(`Total Credit (Payments): Rs. ${this.getTotalCredit().toLocaleString()}`, margin + 5, y);
      y += 5;
      doc.text(`Current Balance:         Rs. ${this.getCustomerBalance().toLocaleString()}`, margin + 5, y);
      y += 10;
    }
    
    // ── FOOTER ──────────────────────────────────────────────
    doc.setFontSize(7);
    doc.setTextColor(...G);
    const footer = 'Generated by: www.devinfantary.com  |  Contact: 0302 6938217';
    doc.text(footer, pw / 2, ph - 4, { align: 'center' });
    
    // ── SAVE ────────────────────────────────────────────────
    doc.save(`Customer_Ledger_${this.selectedCustomer.customer_name}_${today}.pdf`);
  }
}
