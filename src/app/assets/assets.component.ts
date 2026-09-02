import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';
import { toLocalDateString } from '../shared/utils/date.util';

const CATEGORIES = ['Vehicle', 'Equipment', 'Building', 'Land', 'Other'];

@Component({
  selector: 'app-assets',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe],
  templateUrl: './assets.component.html',
  styleUrl: './assets.component.scss'
})
export class AssetsComponent implements OnInit {
  currentFarm: any = null;
  categories = CATEGORIES;

  assets: any[] = [];
  isLoading = true;
  errorMessage = '';

  bankAccounts: any[] = [];

  showForm = false;
  editingId: number | null = null;
  form: any = this.emptyForm();
  formError = '';

  showSellForm = false;
  sellingAsset: any = null;
  sellForm = { sale_date: toLocalDateString(), sale_amount: null as number | null };
  sellError = '';

  showDeleteDialog = false;
  deletingId: number | null = null;

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    await this.loadBankAccounts();
    await this.loadAssets();
  }

  private emptyForm() {
    return {
      asset_name: '',
      category: 'Vehicle',
      purchase_date: toLocalDateString(),
      purchase_amount: null as number | null,
      payment_source: 'cash',
      bank_id: null as number | null,
      notes: ''
    };
  }

  get activeAssets() {
    return this.assets.filter(a => a.status !== 'sold');
  }

  get soldAssets() {
    return this.assets.filter(a => a.status === 'sold');
  }

  get totalActivePurchaseValue(): number {
    return this.activeAssets.reduce((sum, a) => sum + (a.purchase_amount || 0), 0);
  }

  get totalRealizedGainLoss(): number {
    return this.soldAssets.reduce((sum, a) => sum + this.gainLoss(a), 0);
  }

  gainLoss(asset: any): number {
    return (asset.sale_amount || 0) - (asset.purchase_amount || 0);
  }

  async loadBankAccounts() {
    const result = await this.db.getBankAccounts(this.currentFarm.farm_id);
    this.bankAccounts = result.success ? result.data : [];
  }

  async loadAssets() {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const result = await this.db.getAssets(this.currentFarm.farm_id);
      this.assets = result.success ? result.data : [];
      if (!result.success) this.errorMessage = result.error || 'Failed to load assets.';
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  openAddForm() {
    this.editingId = null;
    this.form = this.emptyForm();
    this.formError = '';
    this.showForm = true;
  }

  openEditForm(a: any) {
    this.editingId = a.asset_id;
    this.form = {
      asset_name: a.asset_name,
      category: a.category || 'Vehicle',
      purchase_date: a.purchase_date,
      purchase_amount: a.purchase_amount,
      payment_source: a.payment_source || 'cash',
      bank_id: a.bank_id || null,
      notes: a.notes || ''
    };
    this.formError = '';
    this.showForm = true;
  }

  cancelForm() {
    this.showForm = false;
    this.editingId = null;
  }

  async saveForm() {
    if (!this.form.asset_name.trim() || !this.form.purchase_date) {
      this.formError = 'Asset name and purchase date are required.';
      return;
    }
    this.formError = '';
    try {
      const payload = {
        asset_name: this.form.asset_name.trim(),
        category: this.form.category,
        purchase_date: this.form.purchase_date,
        purchase_amount: this.form.purchase_amount || 0,
        payment_source: this.form.payment_source,
        bank_id: this.form.payment_source === 'bank' ? this.form.bank_id : null,
        notes: this.form.notes?.trim() || null
      };

      const result = this.editingId
        ? await this.db.updateAsset(this.editingId, payload)
        : await this.db.addAsset({ farm_id: this.currentFarm.farm_id, ...payload });

      if (!result.success) {
        this.formError = result.error || 'Failed to save asset.';
        this.cdr.detectChanges();
        return;
      }

      this.showForm = false;
      this.editingId = null;
      await this.loadAssets();
    } catch (err: any) {
      this.formError = 'Failed to save asset: ' + err.message;
      this.cdr.detectChanges();
    }
  }

  openSellForm(a: any) {
    this.sellingAsset = a;
    this.sellForm = { sale_date: toLocalDateString(), sale_amount: null };
    this.sellError = '';
    this.showSellForm = true;
  }

  cancelSellForm() {
    this.showSellForm = false;
    this.sellingAsset = null;
  }

  async confirmSell() {
    if (!this.sellingAsset || !this.sellForm.sale_date || this.sellForm.sale_amount === null) {
      this.sellError = 'Sale date and sale amount are required.';
      return;
    }
    this.sellError = '';
    try {
      const result = await this.db.sellAsset(this.sellingAsset.asset_id, this.sellForm.sale_date, this.sellForm.sale_amount);
      if (!result.success) {
        this.sellError = result.error || 'Failed to sell asset.';
        this.cdr.detectChanges();
        return;
      }
      this.showSellForm = false;
      this.sellingAsset = null;
      await this.loadAssets();
    } catch (err: any) {
      this.sellError = 'Failed to sell asset: ' + err.message;
      this.cdr.detectChanges();
    }
  }

  confirmDelete(id: number) {
    this.deletingId = id;
    this.errorMessage = '';
    this.showDeleteDialog = true;
  }

  onDeleteCancelled() {
    this.showDeleteDialog = false;
    this.deletingId = null;
  }

  async onDeleteConfirmed() {
    if (this.deletingId === null) return;
    try {
      const result = await this.db.deleteAsset(this.deletingId);
      this.showDeleteDialog = false;
      if (!result.success) {
        this.errorMessage = result.error || 'Failed to delete asset.';
        this.cdr.detectChanges();
        return;
      }
      this.deletingId = null;
      await this.loadAssets();
    } catch (err: any) {
      this.errorMessage = 'Failed to delete asset: ' + err.message;
      this.showDeleteDialog = false;
      this.cdr.detectChanges();
    }
  }
}
