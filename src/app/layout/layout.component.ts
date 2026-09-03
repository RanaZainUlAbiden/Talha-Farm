import {
  Component, OnInit, OnDestroy,
  HostListener, ViewEncapsulation, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from '../shared/services/auth.service';
import { FlockService } from '../shared/services/flock.service';
import { FarmUnitService } from '../shared/services/farm-unit.service';
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
  currentUnit: any = null;
  units: any[] = [];
  showUnitDropdown = false;
  sidebarCollapsed = false;
  activeRoute = 'flock-health';
  activeBusinessTab: string = 'broiler';
  private savedBusinessType: string = 'broiler';
  private lastRouteByTab: { [key: string]: string } = {};
  licenseStatus: string = '';
  showLicenseWarning: boolean = false;
  isLicenseActivated: boolean = false;
  licenseExpired: boolean = false;
  licenseExpiredMessage: string = '';
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
    { label: 'Farm Report',   icon: '🏡', route: 'farm-report'      },
    { label: 'Flocks',        icon: '🐣', route: 'flock-management' },
    { label: 'Farms',         icon: '🏠', route: 'farm-units'       }
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
    { label: 'Report',          icon: '📄', route: 'layer-report'     },
    { label: 'Farm Report',     icon: '🏡', route: 'farm-report'      },
    { label: 'Farms',           icon: '🏠', route: 'farm-units'       }
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

  overviewMenu: any[] = [
    { label: 'Dashboard',         icon: '📊', route: 'overview'            },
    { label: 'Assets',            icon: '🏗️', route: 'assets'              },
    { label: 'Personal Expenses', icon: '👛', route: 'personal-expenses'   }
  ];

  get menuItems() {
    if (this.savedBusinessType === 'all') {
      switch (this.activeBusinessTab) {
        case 'layer': return this.layerMenu;
        case 'distribution': return this.distributionMenu;
        case 'overview': return this.overviewMenu;
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

  // Overview only ever exists as a tab within an 'all' account — there is no
  // standalone 'overview' business_type — so unlike isLayerMode/isDistributionMode
  // it doesn't need a top-level savedBusinessType branch.
  get isOverviewMode(): boolean {
    return this.savedBusinessType === 'all' && this.activeBusinessTab === 'overview';
  }

  get dropdownItems(): any[] {
    return this.isLayerMode ? this.batches : this.flocks;
  }

  async switchBusinessTab(tab: string) {
    this.activeBusinessTab = tab;
    localStorage.setItem('activeBusinessTab', tab);

    // Load the new module's units/current-unit BEFORE navigating. The child
    // route component reads farmUnitService's current value the instant it
    // mounts (a BehaviorSubject replays synchronously on subscribe) — if we
    // navigate first, it can mount and subscribe while this is still an
    // in-flight DB call, capturing the OLD module's unit. Awaiting here
    // means the shared state is already correct by the time anything reads it.
    await this.refreshModuleData();
    if (!this.isDistributionMode && !this.isOverviewMode) {
      this.farmUnitService.notifyModuleChanged(this.isLayerMode ? 'layer' : 'broiler');
    }

    // Resume whichever screen was last open in this tab, instead of
    // always jumping back to the first menu item.
    const remembered = this.lastRouteByTab[tab];
    const menuForTab = tab === 'layer' ? this.layerMenu : tab === 'distribution' ? this.distributionMenu : tab === 'overview' ? this.overviewMenu : this.broilerMenu;
    const isValidForTab = remembered && menuForTab.some(m => m.route === remembered);
    const targetRoute = isValidForTab ? remembered : (menuForTab[0]?.route || 'flock-health');

    this.activeRoute = targetRoute;
    this.router.navigate(['/app', targetRoute]);
    this.cdr.detectChanges();
  }

  // Lets the Farms page change the logged-in account's business type without
  // forcing a re-login: mirrors what ngOnInit derives from localStorage, then
  // makes sure the active route still exists in the (possibly new) menu.
  private async onBusinessTypeChanged(newType: string) {
    this.currentFarm = this.authService.getCurrentFarm();
    this.savedBusinessType = newType;
    if (newType === 'all') {
      this.activeBusinessTab = localStorage.getItem('activeBusinessTab') || 'broiler';
    } else {
      this.activeBusinessTab = newType;
    }

    // Same ordering fix as switchBusinessTab(): resolve the new module's
    // units/current-unit before anything (a route change, a child mount)
    // can read the shared state.
    await this.refreshModuleData();
    if (!this.isDistributionMode && !this.isOverviewMode) {
      this.farmUnitService.notifyModuleChanged(this.isLayerMode ? 'layer' : 'broiler');
    }

    const validRoutes = this.menuItems.map((m: any) => m.route);
    if (!validRoutes.includes(this.activeRoute)) {
      const target = this.menuItems[0]?.route || 'flock-health';
      this.activeRoute = target;
      this.router.navigate(['/app', target]);
    }

    this.cdr.detectChanges();
  }

  constructor(
    private authService: AuthService,
    private flockService: FlockService,
    private farmUnitService: FarmUnitService,
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

    this.subs.add(
      this.farmUnitService.units$.subscribe(units => {
        this.units = units;
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.farmUnitService.currentUnit$.subscribe(unit => {
        this.currentUnit = unit;
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.farmUnitService.unitsChanged$.subscribe(() => {
        this.refreshModuleData();
      })
    );

    this.subs.add(
      this.authService.businessTypeChanged$.subscribe(newType => {
        this.onBusinessTypeChanged(newType);
      })
    );

    this.refreshModuleData();

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
   *
   * This runs on a 60s timer, so it must NEVER navigate on its own: a redirect
   * fired mid-session destroys whatever form the user is filling in and loses
   * their work without warning. On expiry we raise a banner instead and let the
   * user finish and save. They leave for /activation only by clicking through
   * it, or on the next app launch (the app already boots to /activation, which
   * forwards to /login when the licence is valid).
   */
  private async checkLicense(): Promise<void> {
    const status = await this.licenseService.getStatus();

    this.isLicenseActivated = status.activated;
    this.licenseExpired = !status.activated && status.trialExpired;

    if (this.licenseExpired) {
      this.licenseExpiredMessage = status.clockTampered
        ? 'System clock problem — licence cannot be verified. Your work is still saved.'
        : 'Trial expired. Your work is still saved — activate to keep using the app.';
    }

    if (status.activated) {
      // An activated licence is permanent — no countdown, no expiry warning.
      this.licenseStatus = '✅ Licensed';
      this.showLicenseWarning = false;
    } else {
      this.licenseStatus = await this.licenseService.getTrialStatusMessage();
      this.showLicenseWarning = this.licenseExpired || (status.daysRemaining <= 1 && status.daysRemaining > 0);
    }

    this.cdr.detectChanges();
  }

   
  /**
   * Navigate to activation page
   */
  navigateToActivation(): void {
    this.router.navigate(['/activation']);
  }


  async refreshModuleData() {
    await this.loadUnitsForActiveModule();
    this.loadActiveBusinessData();
  }

  async loadUnitsForActiveModule() {
    if (this.isDistributionMode || this.isOverviewMode) {
      this.units = [];
      this.currentUnit = null;
      return;
    }

    const moduleType = this.isLayerMode ? 'layer' : 'broiler';
    const units = await this.farmUnitService.loadUnits(this.currentFarm.farm_id, moduleType);
    const current = this.farmUnitService.getCurrentUnit();
    const currentBelongsToModule = current && current.module_type === moduleType &&
      units.some((u: any) => u.unit_id === current.unit_id);

    if (!currentBelongsToModule) {
      // Restore whichever unit was last active in this module specifically —
      // same reasoning as loadFlocks()/loadBatches() below, so switching away
      // to another business tab and back doesn't reset the unit selection.
      const lastIdKey = moduleType === 'layer' ? 'lastLayerUnitId' : 'lastBroilerUnitId';
      const lastId = localStorage.getItem(lastIdKey);
      const remembered = lastId ? units.find((u: any) => String(u.unit_id) === lastId) : null;
      this.farmUnitService.setCurrentUnit(remembered || (units.length > 0 ? units[0] : null));
    }

    this.currentUnit = this.farmUnitService.getCurrentUnit();
    if (this.currentUnit?.unit_id) {
      const lastIdKey = moduleType === 'layer' ? 'lastLayerUnitId' : 'lastBroilerUnitId';
      localStorage.setItem(lastIdKey, String(this.currentUnit.unit_id));
    }
    this.cdr.detectChanges();
  }

  selectUnit(unit: any) {
    this.farmUnitService.setCurrentUnit(unit);
    if (unit?.unit_id) {
      const lastIdKey = this.isLayerMode ? 'lastLayerUnitId' : 'lastBroilerUnitId';
      localStorage.setItem(lastIdKey, String(unit.unit_id));
    }
    this.currentUnit = unit;
    this.showUnitDropdown = false;
    this.loadActiveBusinessData();
    this.cdr.detectChanges();
  }

  toggleUnitDropdown(event: Event) {
    event.stopPropagation();
    this.showUnitDropdown = !this.showUnitDropdown;
    this.cdr.detectChanges();
  }

   async loadFlocks() {
    // No units yet for this account/module — behave exactly as before the
    // farm-selector existed rather than filtering to an empty list.
    const unitId = this.units.length > 0 ? this.currentUnit?.unit_id : undefined;
    const flocks = await this.flockService.loadFlocks(this.currentFarm.farm_id, unitId, true);
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

    if (this.isDistributionMode || this.isOverviewMode) {
      this.currentFlock = null;
      this.cdr.detectChanges();
      return;
    }

    this.loadFlocks();
  }

 

  async loadBatches() {
    // No units yet for this account/module — behave exactly as before the
    // farm-selector existed rather than filtering to an empty list.
    const unitId = this.units.length > 0 ? this.currentUnit?.unit_id : undefined;
    const sql = unitId
      ? 'SELECT * FROM batches WHERE farm_id = ? AND status = ? AND unit_id = ?'
      : 'SELECT * FROM batches WHERE farm_id = ? AND status = ?';
    const params = unitId ? [this.currentFarm.farm_id, 'active', unitId] : [this.currentFarm.farm_id, 'active'];
    const result = await this.db.get(sql, params);
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
    this.showUnitDropdown = false;
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
