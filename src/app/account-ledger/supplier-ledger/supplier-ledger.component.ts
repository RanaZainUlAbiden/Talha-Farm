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
    return this.ledgerEntries.reduce((sum, e) => sum + (Number(e.credit) || 0) - (Number(e.debit) || 0), 0);
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
      this.errorMessage = 'Payment amount cannot exceed total payable';
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
    doc.text('SUPPLIER LEDGER REPORT', pw / 2, y, { align: 'center' });
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
    
    // ── SUPPLIER INFO ──────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...B);
    doc.text('Supplier Details', margin, y);
    y += 6;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...B);
    doc.text(`Supplier: ${this.selectedSupplier.supplier_name}`, margin, y);
    doc.text(`Phone: ${this.selectedSupplier.phone || 'N/A'}`, margin + 70, y);
    y += 5;
    doc.text(`Products Supplied: ${this.selectedSupplier.products_supplied || 'N/A'}`, margin, y);
    y += 5;
    // 🔥 FIX: "Current Balance" → "Total Payable"
    doc.text(`Total Payable: Rs. ${this.getSupplierBalance().toLocaleString()}`, margin, y);
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
        fillColor: [21, 101, 192], 
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
        const pageNumber = (doc as any).getNumberOfPages();
        const totalPages = (doc as any).getNumberOfPages();
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
      doc.text(`Total Debit (Payments):   Rs. ${this.getTotalDebit().toLocaleString()}`, margin + 5, y);
      y += 5;
      doc.text(`Total Credit (Purchases): Rs. ${this.getTotalCredit().toLocaleString()}`, margin + 5, y);
      y += 5;
      // 🔥 FIX: "Current Balance" → "Total Payable"
      doc.text(`Total Payable:             Rs. ${this.getSupplierBalance().toLocaleString()}`, margin + 5, y);
      y += 10;
    }
    
    // ── FOOTER ──────────────────────────────────────────────
    doc.setFontSize(7);
    doc.setTextColor(...G);
    const footer = 'Generated by: www.devinfantary.com  |  Contact: 0302 6938217';
    doc.text(footer, pw / 2, ph - 4, { align: 'center' });
    
    // ── SAVE ────────────────────────────────────────────────
    doc.save(`Supplier_Ledger_${this.selectedSupplier.supplier_name}_${today}.pdf`);
  }
}
