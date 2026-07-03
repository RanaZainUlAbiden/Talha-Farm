import { Component, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';
import { PendingStateService } from '../shared/services/pending-state.service';

@Component({
  selector: 'app-egg-sales',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe],
  templateUrl: './egg-sales.component.html',
  styleUrl: './egg-sales.component.scss'
})
export class EggSalesComponent implements OnInit {
  currentFarm: any = null;
  batches: any[] = [];
  sales: any[] = [];
  pendingRows: any[] = [];
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  isSavingAll = false;

  get hasPendingRows(): boolean { return this.pendingRows.length > 0; }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'a') { event.preventDefault(); this.addPendingRow(); }
    if (event.ctrlKey && event.key === 's') { event.preventDefault(); if (this.hasPendingRows) this.saveAllRows(); }
  }

  constructor(private db: DatabaseService, private authService: AuthService, private cdr: ChangeDetectorRef, private pendingState: PendingStateService) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadData();
    const cached = this.pendingState.getState('EggSalesComponent');
    if (cached?.farmId === this.currentFarm?.farm_id) this.pendingRows = cached.pendingRows || [];
  }

  ngOnDestroy() { this.pendingState.saveState('EggSalesComponent', { farmId: this.currentFarm?.farm_id, pendingRows: this.pendingRows }); }

  async loadData() {
    const bRes = await this.db.get(`SELECT * FROM batches WHERE farm_id = ? AND status = 'active' ORDER BY batch_id DESC`, [this.currentFarm.farm_id]);
    this.batches = bRes.success ? bRes.data : [];
    const sRes = await this.db.get(`SELECT es.*, b.batch_name FROM egg_sales es JOIN batches b ON es.batch_id = b.batch_id WHERE b.farm_id = ? ORDER BY es.date DESC`, [this.currentFarm.farm_id]);
    this.sales = sRes.success ? sRes.data : [];
    this.cdr.detectChanges();
  }

  getBatchName(id: number) { return this.batches.find(b => b.batch_id === id)?.batch_name || '—'; }

  makeNewRow() { return { batch_id: this.batches[0]?.batch_id || null, date: new Date().toISOString().split('T')[0], customer_name: '', grade: 'mixed', quantity: null, rate_per_egg: null, payment_type: 'cash' }; }

  addPendingRow() { if (!this.isSaving) { this.editingId = null; this.pendingRows.push(this.makeNewRow()); } }
  addRowAfter(i: number) { this.pendingRows.splice(i + 1, 0, this.makeNewRow()); }
  removePendingRow(i: number) { this.pendingRows.splice(i, 1); }

  async saveAllRows() {
    if (!this.pendingRows.length || this.isSavingAll) return;
    this.isSavingAll = true;
    try {
      for (const row of this.pendingRows) {
        if (!row.batch_id || !row.date || !row.quantity || !row.rate_per_egg) continue;
        await this.db.run(`INSERT INTO egg_sales (batch_id, date, customer_name, grade, quantity, rate_per_egg, total_amount, payment_type) VALUES (?,?,?,?,?,?,?,?)`,
          [row.batch_id, row.date, row.customer_name, row.grade, row.quantity, row.rate_per_egg, row.quantity * row.rate_per_egg, row.payment_type]);
      }
      this.pendingRows = [];
      await this.loadData();
    } finally { this.isSavingAll = false; this.cdr.detectChanges(); }
  }

  cancelAllRows() { this.pendingRows = []; }

  startEdit(s: any) {
    if (this.isSaving) return;
    this.pendingRows = [];
    this.editingId = s.egg_sale_id;
    this.editForm = { batch_id: s.batch_id, date: s.date, customer_name: s.customer_name, grade: s.grade, quantity: s.quantity, rate_per_egg: s.rate_per_egg, payment_type: s.payment_type };
  }

  cancelEdit() { if (!this.isSaving) { this.editingId = null; this.editForm = {}; } }

  async saveEdit(id: number) {
    if (this.isSaving) return;
    this.isSaving = true; this.editingId = null;
    await this.db.run(`UPDATE egg_sales SET batch_id=?, date=?, customer_name=?, grade=?, quantity=?, rate_per_egg=?, total_amount=?, payment_type=? WHERE egg_sale_id=?`,
      [this.editForm.batch_id, this.editForm.date, this.editForm.customer_name, this.editForm.grade, this.editForm.quantity, this.editForm.rate_per_egg, this.editForm.quantity * this.editForm.rate_per_egg, this.editForm.payment_type, id]);
    this.editForm = {};
    await this.loadData();
    this.isSaving = false; this.cdr.detectChanges();
  }

  confirmDelete(id: number) { if (!this.isSaving) { this.deletingId = id; this.showDeleteDialog = true; } }

  async onDeleteConfirmed() {
    if (this.isSaving || !this.deletingId) return;
    this.isSaving = true; this.showDeleteDialog = false;
    await this.db.run('DELETE FROM egg_sales WHERE egg_sale_id = ?', [this.deletingId]);
    this.deletingId = null; this.isSaving = false;
    await this.loadData();
  }

  onDeleteCancelled() { this.showDeleteDialog = false; this.deletingId = null; }
}