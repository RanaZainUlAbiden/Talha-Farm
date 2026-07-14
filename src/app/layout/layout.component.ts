import {
  Component, OnInit, OnDestroy,
  HostListener, ViewEncapsulation, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from '../shared/services/auth.service';
import { FlockService } from '../shared/services/flock.service';
import { DatabaseService } from '../shared/services/database.service';
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

  private subs = new Subscription();

  broilerMenu = [
    { label: 'Flock Health',  icon: '🐔', route: 'flock-health'    },
    { label: 'Expenses',      icon: '💰', route: 'expenses'         },
    { label: 'Ledger',        icon: '📒', route: 'ledger'           },
    { label: 'Medicine',      icon: '💊', route: 'medicine'         },
    { label: 'Sale',          icon: '🛒', route: 'sale'             },
    { label: 'Income',        icon: '📈', route: 'income'           },
    { label: 'Report',        icon: '📄', route: 'report'           },
    { label: 'Flocks',        icon: '🐣', route: 'flock-management' }
  ];

  layerMenu = [
    { label: 'Batches',         icon: '🥚', route: 'batch-management' },
    { label: 'Egg Collection',  icon: '📋', route: 'egg-collection'   },
    { label: 'Egg Sales',       icon: '🛒', route: 'egg-sales'        },
    { label: 'Vaccination',     icon: '💉', route: 'vaccination'      },
    { label: 'Mortality',       icon: '⚠️', route: 'layer-mortality'  },
    { label: 'Income',          icon: '📈', route: 'income'           },
    { label: 'Report',          icon: '📄', route: 'layer-report'     }
  ];

  distributionMenu = [
    { label: 'Inventory',     icon: '📦', route: 'inventory'            },
    { label: 'Purchase',      icon: '📥', route: 'purchase-orders'      },
    { label: 'Sales Orders',  icon: '📤', route: 'sales-orders'         },
    { label: 'Customers',     icon: '👥', route: 'customer-management'  },
    { label: 'Suppliers',     icon: '🏭', route: 'supplier-management'  },
    { label: 'Income',        icon: '📈', route: 'income'               },
    { label: 'Report',        icon: '📄', route: 'distribution-report'  }
  ];

  allMenu = [
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
    const firstRoute = this.menuItems[0]?.route || 'flock-health';
    this.activeRoute = firstRoute;
    this.router.navigate(['/app', firstRoute]);
    this.loadActiveBusinessData();
    this.cdr.detectChanges();
  }

  constructor(
    private authService: AuthService,
    private flockService: FlockService,
    private db: DatabaseService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private pendingState: PendingStateService
  ) {}

  ngOnInit() {
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

    // Refresh the batch selector / "Create First Batch" prompt whenever
    // batches are added, edited or removed in batch-management.
    this.subs.add(
      this.flockService.batchesChanged$.subscribe(() => {
        if (this.isLayerMode) this.loadBatches();
      })
    );

    this.loadActiveBusinessData();

    const currentUrl = this.router.url.split('/').pop();
    if (currentUrl) this.activeRoute = currentUrl;
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
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

  async loadFlocks() {
    const flocks = await this.flockService.loadFlocks(this.currentFarm.farm_id);
    const current = this.flockService.getCurrentFlock();
    const currentIsFlock = current && !current.batch_id && flocks.some((flock: any) => flock.flock_id === current.flock_id);

    if (!currentIsFlock) {
      this.flockService.setCurrentFlock(flocks.length > 0 ? flocks[0] : null);
    }

    this.currentFlock = this.flockService.getCurrentFlock();
    this.cdr.detectChanges();
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
      this.selectBatch(this.batches[0]);
    } else if (this.batches.length === 0) {
      this.currentFlock = null;
      this.flockService.setCurrentFlock(null);
    }

    this.cdr.detectChanges();
  }

  selectBatch(batch: any) {
    // Persist the batch through FlockService (shaped like a flock) so that
    // flock-scoped pages (Income, etc.) also see the active batch.
    const batchAsFlock = { ...batch, flock_name: batch.batch_name, flock_id: batch.batch_id, batch_id: batch.batch_id };
    this.currentFlock = batchAsFlock;
    this.flockService.setCurrentFlock(batchAsFlock);
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

  navigate(route: string) {
    this.activeRoute = route;
    this.router.navigate(['/app', route]);
    this.cdr.detectChanges();
  }

  logout() {
    this.pendingState.clearAll();
    this.authService.logout();
  }
}
