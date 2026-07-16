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
  selector: 'app-supplier-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  templateUrl: './supplier-ledger.component.html',
  styleUrl: './supplier-ledger.component.scss'
})
export class SupplierLedgerComponent implements OnInit {
  currentFarm: any = null;
  suppliers: any[] = [];
  filteredSuppliers: any[] = [];
  selectedSupplier: any = null;
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
      const supplierId = params['id'];
      if (supplierId) {
        this.loadSupplierDetail(supplierId);
      } else {
        this.loadSuppliers();
      }
    });
  }

  // ── LOAD METHODS ──────────────────────────────────────────

  async loadSuppliers() {
    this.isLoading = true;
    this.errorMessage = '';
    
    try {
      const result = await this.db.getAllSuppliersWithBalance(this.currentFarm.farm_id);
      if (result.success) {
        this.suppliers = result.data || [];
        this.filteredSuppliers = [...this.suppliers];
      }
    } catch (error: any) {
      this.errorMessage = 'Failed to load suppliers: ' + error.message;
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  async loadSupplierDetail(supplierId: number) {
    this.isLoading = true;
    this.errorMessage = '';
    this.selectedSupplier = null;
    this.ledgerEntries = [];
    
    try {
      const supplierResult = await this.db.get(
        'SELECT * FROM suppliers WHERE supplier_id = ? AND farm_id = ?',
        [supplierId, this.currentFarm.farm_id]
      );
      
      if (supplierResult.success && supplierResult.data && supplierResult.data.length > 0) {
        this.selectedSupplier = supplierResult.data[0];
        
        const ledgerResult = await this.db.getSupplierLedgerWithBalance(supplierId);
        if (ledgerResult.success) {
          this.ledgerEntries = ledgerResult.data || [];
        }
      } else {
        this.errorMessage = 'Supplier not found';
      }
    } catch (error: any) {
      this.errorMessage = 'Failed to load supplier details: ' + error.message;
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  // ── SEARCH METHODS ────────────────────────────────────────

  filterSuppliers() {
    if (!this.searchTerm.trim()) {
      this.filteredSuppliers = [...this.suppliers];
      return;
    }
    
    const term = this.searchTerm.toLowerCase().trim();
    this.filteredSuppliers = this.suppliers.filter(s => 
      s.supplier_name.toLowerCase().includes(term) ||
      (s.phone && s.phone.includes(term))
    );
    this.cdr.detectChanges();
  }

  clearSearch() {
    this.searchTerm = '';
    this.filteredSuppliers = [...this.suppliers];
    this.cdr.detectChanges();
  }

  // ── NAVIGATION METHODS ────────────────────────────────────

  selectSupplier(supplier: any) {
    // 🔥 FIX: Use navigateByUrl to ensure proper navigation
    this.router.navigateByUrl(`/app/supplier-ledger/${supplier.supplier_id}`).then(
      (success) => {
        if (!success) {
          console.error('Navigation failed');
          this.router.navigate(['/app/supplier-ledger', supplier.supplier_id]);
        }
      }
    );
  }

  goBack() {
    this.selectedSupplier = null;
    this.ledgerEntries = [];
    this.searchTerm = '';
    // 🔥 FIX: Navigate back to the list view
    this.router.navigate(['/app/supplier-ledger']).then(() => {
      this.loadSuppliers();
    });
  }

  // ── CALCULATION METHODS ──────────────────────────────────

  getTotalPayable(): number {
    return this.filteredSuppliers.reduce((sum, s) => sum + (s.outstanding_balance || 0), 0);
  }

  getTotalDebit(): number {
    return this.ledgerEntries.reduce((sum, e) => sum + (e.debit || 0), 0);
  }

  getTotalCredit(): number {
    return this.ledgerEntries.reduce((sum, e) => sum + (e.credit || 0), 0);
  }

  getSupplierBalance(): number {
    if (this.ledgerEntries.length === 0) return 0;
    return this.ledgerEntries[this.ledgerEntries.length - 1]?.balance || 0;
  }

  // ── PAYMENT METHODS ──────────────────────────────────────

  openPaymentForm() {
    this.showPaymentForm = true;
    this.paymentAmount = this.getSupplierBalance();
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
    
    if (this.paymentAmount > this.getSupplierBalance()) {
      this.errorMessage = 'Payment amount cannot exceed outstanding balance';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';

    try {
      await this.db.addSupplierLedgerEntry({
        supplier_id: this.selectedSupplier.supplier_id,
        transaction_date: this.paymentDate,
        description: this.paymentNote || 'Payment made',
        debit: this.paymentAmount,
        reference_type: 'payment'
      });

      this.closePaymentForm();
      await this.loadSupplierDetail(this.selectedSupplier.supplier_id);
      
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
      await this.db.run('DELETE FROM supplier_ledger WHERE ledger_id = ?', [this.deletingEntryId]);
      this.showDeleteDialog = false;
      this.deletingEntryId = null;
      await this.loadSupplierDetail(this.selectedSupplier.supplier_id);
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
    if (!this.selectedSupplier) return;
    
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
    doc.text('Supplier Ledger Report', pw / 2, y, { align: 'center' });
    y += 8;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Report Date: ${today}`, 14, y);
    doc.text(`Farm ID: ${this.currentFarm?.farm_id || ''}`, pw - 14, y, { align: 'right' });
    y += 6;
    
    // ── Supplier Info ──────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Supplier: ${this.selectedSupplier.supplier_name}`, 14, y);
    y += 6;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Phone: ${this.selectedSupplier.phone || 'N/A'}`, 14, y);
    y += 6;
    doc.text(`Products Supplied: ${this.selectedSupplier.products_supplied || 'N/A'}`, 14, y);
    y += 6;
    doc.text(`Current Balance: Rs. ${this.getSupplierBalance().toLocaleString()}`, 14, y);
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
    doc.text(`Total Debit (Payments): Rs. ${this.getTotalDebit().toLocaleString()}`, 20, y);
    y += 5;
    doc.text(`Total Credit (Purchases): Rs. ${this.getTotalCredit().toLocaleString()}`, 20, y);
    y += 5;
    doc.text(`Current Balance: Rs. ${this.getSupplierBalance().toLocaleString()}`, 20, y);
    y += 8;
    
    // ── Footer ──────────────────────────────────────────────
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    const footer = 'Software By: www.devinfantary.com  |  Contact: 0302 6938217';
    doc.text(footer, pw / 2, 285, { align: 'center' });
    
    // ── Save ────────────────────────────────────────────────
    doc.save(`Supplier_Ledger_${this.selectedSupplier.supplier_name}_${today}.pdf`);
  }
}