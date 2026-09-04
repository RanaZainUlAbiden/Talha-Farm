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

  /**
   * The card the user clicked into, or null for the grid. The screen is one
   * component in two states rather than two routes — the detail view is a view
   * of a card, and coming "back" should not reload the whole grid.
   */
  selectedAsset: any = null;
  payments: any[] = [];
  isLoadingPayments = false;
  detailError = '';

  showForm = false;
  editingId: number | null = null;
  form: any = this.emptyForm();
  formError = '';

  showPaymentForm = false;
  paymentForm: any = this.emptyPaymentForm();
  paymentError = '';

  showSellForm = false;
  sellingAsset: any = null;
  sellForm = { sale_date: toLocalDateString(), sale_amount: null as number | null };
  sellError = '';

  showDeleteDialog = false;
  deletingId: number | null = null;

  showDeletePaymentDialog = false;
  deletingPaymentId: number | null = null;

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    await this.loadAssets();
  }

  private emptyForm() {
    return {
      asset_name: '',
      category: 'Vehicle',
      purchase_date: toLocalDateString(),
      total_price: null as number | null,
      initial_payment: null as number | null,
      notes: ''
    };
  }

  private emptyPaymentForm() {
    return {
      date: toLocalDateString(),
      amount: null as number | null,
      notes: ''
    };
  }

  // ── Grid totals ───────────────────────────────────────────

  get activeAssets() {
    return this.assets.filter(a => a.status !== 'sold');
  }

  get soldAssets() {
    return this.assets.filter(a => a.status === 'sold');
  }

  /** Active assets at their full agreed price, not at what has been paid so far. */
  get totalActiveValue(): number {
    return this.activeAssets.reduce((sum, a) => sum + this.agreedPrice(a), 0);
  }

  get totalPaid(): number {
    return this.assets.reduce((sum, a) => sum + this.paidAmount(a), 0);
  }

  /** What is still owed across every asset, sold ones included — selling
   *  something you still owe on does not clear the debt. */
  get totalOutstanding(): number {
    return this.assets.reduce((sum, a) => sum + Math.max(0, this.outstanding(a)), 0);
  }

  get totalRealizedGainLoss(): number {
    return this.soldAssets.reduce((sum, a) => sum + this.gainLoss(a), 0);
  }

  // ── Per-asset figures ─────────────────────────────────────

  /** COALESCE covers rows written before the installments migration. */
  agreedPrice(asset: any): number {
    return Number(asset?.agreed_price ?? asset?.total_price ?? asset?.purchase_amount ?? 0);
  }

  paidAmount(asset: any): number {
    return Number(asset?.amount_paid || 0);
  }

  outstanding(asset: any): number {
    return this.agreedPrice(asset) - this.paidAmount(asset);
  }

  isFullyPaid(asset: any): boolean {
    return this.outstanding(asset) <= 0;
  }

  /** Percent of the agreed price handed over, for the card's progress bar. */
  paidPercent(asset: any): number {
    const price = this.agreedPrice(asset);
    if (price <= 0) return 100;
    return Math.min(100, Math.max(0, (this.paidAmount(asset) / price) * 100));
  }

  /** Measured against the full agreed price, whether or not it is paid off. */
  gainLoss(asset: any): number {
    return (asset.sale_amount || 0) - this.agreedPrice(asset);
  }

  // ── Loading ───────────────────────────────────────────────

  async loadAssets() {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const result = await this.db.getAssets(this.currentFarm.farm_id);
      this.assets = result.success ? result.data : [];
      if (!result.success) this.errorMessage = result.error || 'Failed to load assets.';

      // Keep the open detail view pointed at the refreshed row.
      if (this.selectedAsset) {
        const refreshed = this.assets.find(a => a.asset_id === this.selectedAsset.asset_id);
        this.selectedAsset = refreshed || null;
      }
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  async loadPayments(assetId: number) {
    this.isLoadingPayments = true;
    this.detailError = '';
    try {
      const result = await this.db.getAssetPayments(assetId, this.currentFarm.farm_id);
      this.payments = result.success ? result.data : [];
      if (!result.success) this.detailError = result.error || 'Failed to load payment history.';
    } finally {
      this.isLoadingPayments = false;
      this.cdr.detectChanges();
    }
  }

  // ── Card <-> detail navigation ────────────────────────────

  async openAsset(asset: any) {
    this.selectedAsset = asset;
    this.payments = [];
    this.detailError = '';
    await this.loadPayments(asset.asset_id);
  }

  closeAsset() {
    this.selectedAsset = null;
    this.payments = [];
    this.detailError = '';
  }

  // ── Asset form ────────────────────────────────────────────

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
      total_price: this.agreedPrice(a),
      initial_payment: null,
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
    if (this.form.total_price === null || this.form.total_price < 0) {
      this.formError = 'Total price is required.';
      return;
    }

    const price = Number(this.form.total_price);

    if (this.editingId) {
      // Dropping the agreed price below what has already been paid would leave
      // the asset permanently overpaid and the dashboard's outstanding figure
      // negative. Better caught here than reconciled later.
      const existing = this.assets.find(a => a.asset_id === this.editingId);
      const paid = existing ? this.paidAmount(existing) : 0;
      if (price < paid) {
        this.formError =
          `Rs. ${paid.toLocaleString()} has already been paid on this asset, ` +
          'so the total price cannot be set below that.';
        return;
      }
    } else {
      const down = Number(this.form.initial_payment || 0);
      if (down < 0) {
        this.formError = 'Initial payment cannot be negative.';
        return;
      }
      if (down > price) {
        this.formError = 'The initial payment is more than the total price.';
        return;
      }
    }

    this.formError = '';
    try {
      const payload = {
        asset_name: this.form.asset_name.trim(),
        category: this.form.category,
        purchase_date: this.form.purchase_date,
        total_price: price,
        notes: this.form.notes?.trim() || null
      };

      const result = this.editingId
        ? await this.db.updateAsset(this.editingId, payload)
        : await this.db.addAsset({
            farm_id: this.currentFarm.farm_id,
            ...payload,
            initial_payment: Number(this.form.initial_payment || 0)
          });

      if (!result.success) {
        this.formError = result.error || 'Failed to save asset.';
        this.cdr.detectChanges();
        return;
      }

      this.showForm = false;
      this.editingId = null;
      await this.loadAssets();
      if (this.selectedAsset) await this.loadPayments(this.selectedAsset.asset_id);
    } catch (err: any) {
      this.formError = 'Failed to save asset: ' + err.message;
      this.cdr.detectChanges();
    }
  }

  // ── Payments ──────────────────────────────────────────────

  openPaymentForm() {
    this.paymentForm = this.emptyPaymentForm();
    this.paymentError = '';
    this.showPaymentForm = true;
  }

  cancelPaymentForm() {
    this.showPaymentForm = false;
  }

  async savePayment() {
    if (!this.selectedAsset) return;
    if (!this.paymentForm.date || this.paymentForm.amount === null) {
      this.paymentError = 'Payment date and amount are required.';
      return;
    }
    const amount = Number(this.paymentForm.amount);
    if (amount <= 0) {
      this.paymentError = 'Payment amount must be greater than zero.';
      return;
    }
    // Paying more than was agreed is almost always a typo, and it would push the
    // dashboard's outstanding-installments liability negative. Refused with the
    // real figure so the user can correct either the payment or the total price.
    const owed = this.outstanding(this.selectedAsset);
    if (amount > owed) {
      this.paymentError =
        `Only Rs. ${owed.toLocaleString()} is still outstanding on this asset. ` +
        'Raise the total price first if the amount owed has changed.';
      return;
    }

    this.paymentError = '';
    try {
      const result = await this.db.addAssetPayment({
        asset_id: this.selectedAsset.asset_id,
        farm_id: this.currentFarm.farm_id,
        date: this.paymentForm.date,
        amount,
        notes: this.paymentForm.notes?.trim() || null
      });

      if (!result.success) {
        this.paymentError = result.error || 'Failed to record payment.';
        this.cdr.detectChanges();
        return;
      }

      this.showPaymentForm = false;
      await this.loadAssets();
      await this.loadPayments(this.selectedAsset.asset_id);
    } catch (err: any) {
      this.paymentError = 'Failed to record payment: ' + err.message;
      this.cdr.detectChanges();
    }
  }

  confirmDeletePayment(paymentId: number) {
    this.deletingPaymentId = paymentId;
    this.detailError = '';
    this.showDeletePaymentDialog = true;
  }

  onDeletePaymentCancelled() {
    this.showDeletePaymentDialog = false;
    this.deletingPaymentId = null;
  }

  async onDeletePaymentConfirmed() {
    if (this.deletingPaymentId === null || !this.selectedAsset) return;
    try {
      const result = await this.db.deleteAssetPayment(this.deletingPaymentId, this.currentFarm.farm_id);
      this.showDeletePaymentDialog = false;
      if (!result.success) {
        this.detailError = result.error || 'Failed to delete payment.';
        this.cdr.detectChanges();
        return;
      }
      this.deletingPaymentId = null;
      await this.loadAssets();
      await this.loadPayments(this.selectedAsset.asset_id);
    } catch (err: any) {
      this.detailError = 'Failed to delete payment: ' + err.message;
      this.showDeletePaymentDialog = false;
      this.cdr.detectChanges();
    }
  }

  // ── Selling ───────────────────────────────────────────────

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
      const result = await this.db.sellAsset(
        this.sellingAsset.asset_id, this.sellForm.sale_date, this.sellForm.sale_amount
      );
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

  // ── Deleting an asset ─────────────────────────────────────

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
      // The detail view cannot survive its own asset being deleted.
      if (this.selectedAsset && this.selectedAsset.asset_id === this.deletingId) {
        this.closeAsset();
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
