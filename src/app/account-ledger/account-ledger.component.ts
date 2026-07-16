import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';

@Component({
  selector: 'app-account-ledger',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './account-ledger.component.html',
  styleUrl: './account-ledger.component.scss'
})
export class AccountLedgerComponent implements OnInit {
  currentFarm: any = null;
  isLoading = true;
  errorMessage = '';
  
  customerStats = { total: 0, outstanding: 0 };
  supplierStats = { total: 0, outstanding: 0 };
  bankStats = { total: 0, balance: 0 };
  
  recentCustomers: any[] = [];
  recentSuppliers: any[] = [];

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadDashboard();
  }

  async loadDashboard() {
    this.isLoading = true;
    this.errorMessage = '';
    
    try {
      // ── Load Customer Stats ──────────────────────────────
      const customers = await this.db.getAllCustomersWithBalance(this.currentFarm.farm_id);
      if (customers.success && customers.data) {
        this.recentCustomers = customers.data.slice(0, 5);
        this.customerStats.total = customers.data.length;
        this.customerStats.outstanding = customers.data.reduce((sum: number, c: any) => sum + (c.outstanding_balance || 0), 0);
      }

      // ── Load Supplier Stats ──────────────────────────────
      // 🔥 FIX: Use getAllSuppliersWithBalance to get real outstanding balances
      const suppliers = await this.db.getAllSuppliersWithBalance(this.currentFarm.farm_id);
      if (suppliers.success && suppliers.data) {
        this.recentSuppliers = suppliers.data.slice(0, 5);
        this.supplierStats.total = suppliers.data.length;
        // 🔥 FIX: Sum the outstanding_balance from each supplier
        this.supplierStats.outstanding = suppliers.data.reduce((sum: number, s: any) => sum + (s.outstanding_balance || 0), 0);
      }

      // ── Load Bank Stats ──────────────────────────────────
      const banks = await this.db.getBankAccounts(this.currentFarm.farm_id);
      if (banks.success && banks.data) {
        this.bankStats.total = banks.data.length;
        this.bankStats.balance = banks.data.reduce((sum: number, b: any) => sum + (b.current_balance || 0), 0);
      }

      console.log('✅ Account Ledger Stats:', {
        customers: this.customerStats,
        suppliers: this.supplierStats,
        banks: this.bankStats
      });

    } catch (error: any) {
      this.errorMessage = 'Failed to load dashboard: ' + error.message;
      console.error('Dashboard error:', error);
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  navigateTo(route: string) {
    this.router.navigate(['/app', route]);
  }

  viewCustomerLedger(customerId: number) {
    this.router.navigate(['/app/customer-ledger', customerId]);
  }

  viewSupplierLedger(supplierId: number) {
    this.router.navigate(['/app/supplier-ledger', supplierId]);
  }
}