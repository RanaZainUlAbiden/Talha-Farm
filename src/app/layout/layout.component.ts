import {
  Component, OnInit, OnDestroy,
  HostListener, ViewEncapsulation, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from '../shared/services/auth.service';
import { FlockService } from '../shared/services/flock.service';
import { DatabaseService } from '../shared/services/database.service';
import { LicenseService } from '../shared/services/license.service';
import { Subscription } from 'rxjs';
import { PendingStateService } from '../shared/services/pending-state.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss',
  encapsulation: ViewEncapsulation.None
})
export class LayoutComponent implements OnInit, OnDestroy {
  currentFarm: any = null;
  currentFlock: any = null;
  flocks: any[] = [];
  batches: any[] = [];
  showFlockDropdown = false;
  sidebarCollapsed = false;
  activeRoute = 'flock-health';
  activeBusinessTab: string = 'broiler';
  private savedBusinessType: string = 'broiler';
  private lastRouteByTab: { [key: string]: string } = {};
  licenseStatus: string = '';
  showLicenseWarning: boolean = false;
  isLicenseActivated: boolean = false;
  private licenseCheckInterval: any = null;

  private subs = new Subscription();

  broilerMenu: any[] = [
    { label: 'Flock Health',  icon: '🐔', route: 'flock-health'    },
    { label: 'Expenses',      icon: '💰', route: 'expenses'         },
    { label: 'Ledger',        icon: '📒', route: 'ledger'           },
    { label: 'Medicine',      icon: '💊', route: 'medicine' },
    { label: 'Feed',          icon: '🌾', route: 'feed' },
    { label: 'Labour',        icon: '👷🏻‍♀️', route: 'labour' },
    { label: 'Vaccination',   icon: '💉', route: 'vaccination' },
    { label: 'Sale',          icon: '🛒', route: 'sale'             },
    { label: 'Income',        icon: '📈', route: 'income'           },
    { label: 'Report',        icon: '📄', route: 'report'           },
    { label: 'Flocks',        icon: '🐣', route: 'flock-management' }
  ];

  layerMenu: any[] = [
    { label: 'Batches',         icon: '🥚', route: 'batch-management' },
    { label: 'Egg Collection',  icon: '📋', route: 'egg-collection'   },
    { label: 'Egg Sales',       icon: '🛒', route: 'egg-sales'        },
    { label: 'Hen Sales',       icon: '🐔', route: 'hen-sales'        },
    { label: 'Medicine',        icon: '💊', route: 'medicine' },
    { label: 'Feed',            icon: '🌾', route: 'feed' },
    { label: 'Vaccination',     icon: '💉', route: 'vaccination' },
    { label: 'Labour',          icon: '👷🏻‍♀️', route: 'labour' },
    { label: 'Mortality',       icon: '⚠️', route: 'layer-mortality'  },
    { label: 'Income',          icon: '📈', route: 'income'           },
    { label: 'Report',          icon: '📄', route: 'layer-report'     }
  ];

  distributionMenu: any[] = [
    { label: 'Inventory',     icon: '📦', route: 'inventory'            },
    { label: 'Purchase',      icon: '📥', route: 'purchase-orders'      },
    { label: 'Purchase Returns', icon: '↪', route: 'purchase-returns'   },
    { label: 'Sales Orders',  icon: '📤', route: 'sales-orders'         },
    { label: 'Returns',       icon: '↩', route: 'sales-returns'         },
    { label: 'Customers',     icon: '👥', route: 'customer-management'  },
    { label: 'Suppliers',     icon: '🏭', route: 'supplier-management'  },
    { label: 'Labour',        icon: '👷🏻‍♀️', route: 'labour-management' },
    { label: 'Account Ledger',icon: '📊', route: 'account-ledger'       }, 
    { label: 'Expense Ledger', icon: '💳', route: 'expense-ledger'      },
    { label: 'Report',        icon: '📄', route: 'distribution-report'  }
  ];

  allMenu: any[] = [
    { label: 'Expenses',      icon: '💰', route: 'expenses'         },
    { label: 'Income',        icon: '📈', route: 'income'           },
    { label: 'Report',        icon: '📄', route: 'report'           },
    { label: 'Flocks',        icon: '🐣', route: 'flock-management' }
  ];

  get menuItems() {
    if (this.savedBusinessType === 'all') {
      switch (this.activeBusinessTab) {
        case 'layer': return this.layerMenu;
        case 'distribution': return this.distributionMenu;
        default: return this.broilerMenu;
      }
    }
    switch (this.savedBusinessType) {
      case 'layer': return this.layerMenu;
      case 'distribution': return this.distributionMenu;
      default: return this.broilerMenu;
    }
  }

  get showBusinessTabs(): boolean {
    return this.savedBusinessType === 'all';
  }

  get isLayerMode(): boolean {
    if (this.savedBusinessType === 'layer') return true;
    if (this.savedBusinessType === 'all' && this.activeBusinessTab === 'layer') return true;
    return false;
  }

  get isDistributionMode(): boolean {
    if (this.savedBusinessType === 'distribution') return true;
    if (this.savedBusinessType === 'all' && this.activeBusinessTab === 'distribution') return true;
    return false;
  }

  get dropdownItems(): any[] {
    return this.isLayerMode ? this.batches : this.flocks;
  }

  switchBusinessTab(tab: string) {
    this.activeBusinessTab = tab;
    localStorage.setItem('activeBusinessTab', tab);

    // Resume whichever screen was last open in this tab, instead of
    // always jumping back to the first menu item.
    const remembered = this.lastRouteByTab[tab];
    const menuForTab = tab === 'layer' ? this.layerMenu : tab === 'distribution' ? this.distributionMenu : this.broilerMenu;
    const isValidForTab = remembered && menuForTab.some(m => m.route === remembered);
    const targetRoute = isValidForTab ? remembered : (menuForTab[0]?.route || 'flock-health');

    this.activeRoute = targetRoute;
    this.router.navigate(['/app', targetRoute]);
    this.loadActiveBusinessData();
    this.cdr.detectChanges();
  }

  constructor(
    private authService: AuthService,
    private flockService: FlockService,
    private db: DatabaseService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private pendingState: PendingStateService,
    public licenseService: LicenseService // Made public for template access
  ) {}

  ngOnInit() {
    // 🔥 Check license first
    this.checkLicense();

    this.currentFarm = this.authService.getCurrentFarm();
    if (!this.currentFarm) {
      this.router.navigate(['/login']);
      return;
    }

    this.savedBusinessType = localStorage.getItem('businessType') || 'broiler';

    if (this.savedBusinessType === 'all') {
      this.activeBusinessTab = localStorage.getItem('activeBusinessTab') || 'broiler';
    } else {
      this.activeBusinessTab = this.savedBusinessType;
    }

    try {
      const storedRoutes = localStorage.getItem('lastRouteByTab');
      this.lastRouteByTab = storedRoutes ? JSON.parse(storedRoutes) : {};
    } catch {
      this.lastRouteByTab = {};
    }

    this.subs.add(
      this.flockService.flocks$.subscribe(flocks => {
        this.flocks = flocks;
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.flockService.currentFlock$.subscribe(flock => {
        this.currentFlock = flock;
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.flockService.batchesChanged$.subscribe(() => {
        if (this.isLayerMode) this.loadBatches();
      })
    );

    this.loadActiveBusinessData();

    const currentUrl = this.router.url.split('/').pop();
    if (currentUrl) this.activeRoute = currentUrl;

    // Check license status periodically (every minute)
    this.licenseCheckInterval = setInterval(() => {
      this.checkLicense();
    }, 60000);

    this.loadAutoBackupPath();
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    if (this.licenseCheckInterval) {
      clearInterval(this.licenseCheckInterval);
    }
  }

  
  /**
   * 🔥 Check if license is valid
   */
  private async checkLicense(): Promise<void> {
    const status = await this.licenseService.getStatus();
    
    this.isLicenseActivated = status.activated;
    
    if (!status.activated && status.trialExpired) {
      this.router.navigate(['/activation']);
      return;
    }

    // Show license expiry days if activated, otherwise trial days
    if (status.activated) {
      const daysLeft = await this.licenseService.getLicenseDaysRemaining();
      this.licenseStatus = `✅ Licensed - ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`;
      this.showLicenseWarning = daysLeft <= 1;
    } else {
      this.licenseStatus = await this.licenseService.getTrialStatusMessage();
      this.showLicenseWarning = !status.activated && status.daysRemaining <= 1 && status.daysRemaining > 0;
    }
    
    this.cdr.detectChanges();
  }

   
  /**
   * Navigate to activation page
   */
  navigateToActivation(): void {
    this.router.navigate(['/activation']);
  }


   async loadFlocks() {
    const flocks = await this.flockService.loadFlocks(this.currentFarm.farm_id);
    const current = this.flockService.getCurrentFlock();
    const currentIsFlock = current && !current.batch_id && flocks.some((flock: any) => flock.flock_id === current.flock_id);

    if (!currentIsFlock) {
      // Restore whichever flock was last active in Broiler mode specifically,
      // instead of always falling back to the first flock — switching to
      // Layer/Distribution and back was silently resetting the selection
      // because the single shared "current flock" slot had been overwritten
      // by the other module's selection in the meantime.
      const lastId = localStorage.getItem('lastBroilerFlockId');
      const remembered = lastId ? flocks.find((f: any) => String(f.flock_id) === lastId) : null;
      this.flockService.setCurrentFlock(remembered || (flocks.length > 0 ? flocks[0] : null));
    }

    this.currentFlock = this.flockService.getCurrentFlock();
    if (this.currentFlock?.flock_id) {
      localStorage.setItem('lastBroilerFlockId', String(this.currentFlock.flock_id));
    }
    this.cdr.detectChanges();
  }



  loadActiveBusinessData() {
    this.showFlockDropdown = false;

    if (this.isLayerMode) {
      this.loadBatches();
      return;
    }

    if (this.isDistributionMode) {
      this.currentFlock = null;
      this.cdr.detectChanges();
      return;
    }

    this.loadFlocks();
  }

 

  async loadBatches() {
    const result = await this.db.get(
      'SELECT * FROM batches WHERE farm_id = ? AND status = ?',
      [this.currentFarm.farm_id, 'active']
    );
    this.batches = result.success ? result.data : [];

    const currentIsBatch = this.currentFlock?.batch_id &&
      this.batches.some((batch: any) => batch.batch_id === this.currentFlock.batch_id);

    if (this.batches.length > 0 && !currentIsBatch) {
      // Restore whichever batch was last active in Layer mode specifically —
      // same reasoning as loadFlocks() above, so switching away to
      // Broiler/Distribution and back doesn't reset to the first batch.
      const lastId = localStorage.getItem('lastLayerBatchId');
      const remembered = lastId ? this.batches.find((b: any) => String(b.batch_id) === lastId) : null;
      this.selectBatch(remembered || this.batches[0]);
    } else if (this.batches.length === 0) {
      this.currentFlock = null;
      this.flockService.setCurrentFlock(null);
    } else if (currentIsBatch && this.currentFlock?.batch_id) {
      localStorage.setItem('lastLayerBatchId', String(this.currentFlock.batch_id));
    }

    this.cdr.detectChanges();
  }

  selectBatch(batch: any) {
    const batchAsFlock = { ...batch, flock_name: batch.batch_name, flock_id: batch.batch_id, batch_id: batch.batch_id };
    this.currentFlock = batchAsFlock;
    this.flockService.setCurrentFlock(batchAsFlock);
    if (batch?.batch_id) {
      localStorage.setItem('lastLayerBatchId', String(batch.batch_id));
    }
    this.showFlockDropdown = false;
    this.cdr.detectChanges();
  }

  toggleFlockDropdown(event: Event) {
    event.stopPropagation();
    this.showFlockDropdown = !this.showFlockDropdown;
    this.cdr.detectChanges();
  }

  @HostListener('document:click')
  closeDropdown() {
    this.showFlockDropdown = false;
    this.cdr.detectChanges();
  }

  selectFlock(flock: any) {
    this.flockService.setCurrentFlock(flock);
    if (flock?.flock_id) {
      localStorage.setItem('lastBroilerFlockId', String(flock.flock_id));
    }
    this.showFlockDropdown = false;
    this.cdr.detectChanges();
  }

  goToFlockManagement() {
    this.showFlockDropdown = false;
    if (this.isLayerMode) {
      this.activeRoute = 'batch-management';
      this.router.navigate(['/app', 'batch-management']);
    } else {
      this.activeRoute = 'flock-management';
      this.router.navigate(['/app', 'flock-management']);
    }
    this.cdr.detectChanges();
  }

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.cdr.detectChanges();
  }

  navigate(route: string, queryParams?: any) {
    this.activeRoute = route;
    if (route === 'inventory') {
      this.activeBusinessTab = 'distribution';
    }

    // Remember which screen was open within the current module, so
    // switching business tabs away and back restores it instead of
    // always landing on the first menu item.
    const tabKey = this.savedBusinessType === 'all' ? this.activeBusinessTab : this.savedBusinessType;
    this.lastRouteByTab[tabKey] = route;
    localStorage.setItem('lastRouteByTab', JSON.stringify(this.lastRouteByTab));

    if (queryParams) {
      this.router.navigate(['/app', route], { queryParams });
    } else {
      this.router.navigate(['/app', route]);
    }
    this.cdr.detectChanges();
  }

  logout() {
    this.pendingState.clearAll();
    this.authService.logout();
  }

  autoBackupPath: string | null = null;

  async loadAutoBackupPath() {
    this.autoBackupPath = await this.db.getAutoBackupPath();
    this.cdr.detectChanges();
  }
  


  async backupDatabase() {
    const result = await this.db.backupDatabase();
    if (result.success) {
      alert('Backup saved to: ' + result.path);
    } else if (!result.cancelled) {
      alert('Backup failed: ' + (result.error || 'Unknown error'));
    }
  }

  async restoreDatabase() {
    await this.db.restoreDatabase();
    // App relaunches automatically on success
  }

  async resetAutoBackupLocation() {
    const confirmed = confirm(
      this.autoBackupPath
        ? `Current auto-backup location:\n${this.autoBackupPath}\n\nClear it? You'll be asked to choose a new location next time you close the app.`
        : 'No auto-backup location is set yet. You\'ll be asked to choose one next time you close the app.'
    );
    if (!confirmed) return;
    await this.db.resetAutoBackupPath();
    this.autoBackupPath = null;
    this.cdr.detectChanges();
  }

}
