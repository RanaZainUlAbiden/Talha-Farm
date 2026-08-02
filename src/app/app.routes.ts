import { Routes } from '@angular/router';
import { FlockHealthResolver } from './shared/resolvers/flock-health.resolver';
import { LedgerResolver } from './shared/resolvers/ledger.resolver';
import { ExpensesResolver } from './shared/resolvers/expenses.resolver';
import { MedicineResolver } from './shared/resolvers/medicine.resolver';
import { SaleResolver } from './shared/resolvers/sale.resolver';
import { IncomeResolver } from './shared/resolvers/income.resolver';
import { BalanceResolver } from './shared/resolvers/balance.resolver';
import { ReportResolver } from './shared/resolvers/report.resolver';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'activation',
    pathMatch: 'full'
  },
  {
    path: 'activation',
    loadComponent: () =>
      import('./activation/activation.component')
        .then(m => m.ActivationComponent)
  },
  {
    path: 'splash',
    loadComponent: () =>
      import('./splash/splash.component')
        .then(m => m.SplashComponent)
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./auth/login/login.component')
        .then(m => m.LoginComponent)
  },
  {
    path: 'app',
    loadComponent: () =>
      import('./layout/layout.component')
        .then(m => m.LayoutComponent),
    children: [
      {
        path: '',
        redirectTo: 'flock-health',
        pathMatch: 'full'
      },
      {
        path: 'flock-health',
        loadComponent: () =>
          import('./flock-health/flock-health.component')
            .then(m => m.FlockHealthComponent),
        resolve: { data: FlockHealthResolver }
      },
      {
        path: 'expenses',
        loadComponent: () =>
          import('./expenses/expenses.component')
            .then(m => m.ExpensesComponent),
        resolve: { data: ExpensesResolver }
      },
      {
        path: 'ledger',
        loadComponent: () =>
          import('./ledger/ledger.component')
            .then(m => m.LedgerComponent),
        resolve: { data: LedgerResolver }
      },
      {
        path: 'medicine',
        loadComponent: () =>
          import('./medicine/medicine.component')
            .then(m => m.MedicineComponent),
        resolve: { data: MedicineResolver }
      },
      {
        path: 'sale',
        loadComponent: () =>
          import('./sale/sale.component')
            .then(m => m.SaleComponent),
        resolve: { data: SaleResolver }
      },
      {
        path: 'income',
        loadComponent: () =>
          import('./income/income.component')
            .then(m => m.IncomeComponent),
        resolve: { data: IncomeResolver }
      },
      {
        path: 'balance',
        loadComponent: () =>
          import('./balance/balance.component')
            .then(m => m.BalanceComponent),
        resolve: { data: BalanceResolver }
      },
      {
        path: 'report',
        loadComponent: () =>
          import('./report/report.component')
            .then(m => m.ReportComponent),
        resolve: { data: ReportResolver }
      },
      {
        path: 'flock-management',
        loadComponent: () =>
          import('./flock-management/flock-management.component')
            .then(m => m.FlockManagementComponent)
      },
      {
        path: 'batch-management',
        loadComponent: () =>
          import('./batch-management/batch-management.component')
            .then(m => m.BatchManagementComponent)
      },
      {
        path: 'egg-collection',
        loadComponent: () =>
          import('./egg-collection/egg-collection.component')
            .then(m => m.EggCollectionComponent)
      },
      {
        path: 'egg-sales',
        loadComponent: () =>
          import('./egg-sales/egg-sales.component')
            .then(m => m.EggSalesComponent)
      },
      {
        path: 'vaccination',
        loadComponent: () =>
          import('./vaccination/vaccination.component')
            .then(m => m.VaccinationComponent)
      },
      {
        path: 'layer-mortality',
        loadComponent: () =>
          import('./layer-mortality/layer-mortality.component')
            .then(m => m.LayerMortalityComponent)
      },
      {
        path: 'layer-report',
        loadComponent: () =>
          import('./layer-report/layer-report.component')
            .then(m => m.LayerReportComponent)
      },
      // ── Distribution Module Routes ──────────────────────
      {
        path: 'inventory',
        loadComponent: () => import('./inventory/inventory.component').then(m => m.InventoryComponent)
      },
      {
  path: 'distribution-batch',
  loadComponent: () => import('./distribution-batch/distribution-batch.component').then(m => m.DistributionBatchComponent)
},
      {
        path: 'distribution-batch/:productId',
        loadComponent: () => import('./distribution-batch/distribution-batch.component').then(m => m.DistributionBatchComponent)
      },
      {
        path: 'purchase-orders',
        loadComponent: () => import('./purchase-orders/purchase-orders.component').then(m => m.PurchaseOrdersComponent)
      },
      {
        path: 'sales-orders',
        loadComponent: () => import('./sales-orders/sales-orders.component').then(m => m.SalesOrdersComponent)
      },
      {
        path: 'customer-management',
        loadComponent: () => import('./customer-management/customer-management.component').then(m => m.CustomerManagementComponent)
      },
      {
        path: 'supplier-management',
        loadComponent: () => import('./supplier-management/supplier-management.component').then(m => m.SupplierManagementComponent)
      },
      {
        path: 'distribution-report',
        loadComponent: () => import('./distribution-report/distribution-report.component').then(m => m.DistributionReportComponent)
      },
      // ── Account Ledger Routes ────────────────────────────
      {
        path: 'account-ledger',
        loadComponent: () => import('./account-ledger/account-ledger.component').then(m => m.AccountLedgerComponent)
      },
      {
        path: 'customer-ledger',
        loadComponent: () => import('./account-ledger/customer-ledger/customer-ledger.component').then(m => m.CustomerLedgerComponent)
      },
      {
        path: 'customer-ledger/:id',
        loadComponent: () => import('./account-ledger/customer-ledger/customer-ledger.component').then(m => m.CustomerLedgerComponent)
      },
      {
        path: 'supplier-ledger',
        loadComponent: () => import('./account-ledger/supplier-ledger/supplier-ledger.component').then(m => m.SupplierLedgerComponent)
      },
      {
        path: 'supplier-ledger/:id',
        loadComponent: () => import('./account-ledger/supplier-ledger/supplier-ledger.component').then(m => m.SupplierLedgerComponent)
      },
      {
        path: 'bank-ledger',
        loadComponent: () => import('./account-ledger/bank-ledger/bank-ledger.component').then(m => m.BankLedgerComponent)
      },
      // 🔥 NEW: Expense Ledger
      {
        path: 'expense-ledger',
        loadComponent: () => import('./account-ledger/expense-ledger/expense-ledger.component').then(m => m.ExpenseLedgerComponent)
      }
    ]
  },
  // ── Fallback Routes (Outside App) ──────────────────────
  {
    path: 'distribution-batch/:productId',
    loadComponent: () => import('./distribution-batch/distribution-batch.component').then(m => m.DistributionBatchComponent)
  }
];