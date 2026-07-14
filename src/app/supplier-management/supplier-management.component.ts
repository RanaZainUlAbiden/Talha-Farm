import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-supplier-management',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  templateUrl: './supplier-management.component.html',
  styleUrl: './supplier-management.component.scss'
})
export class SupplierManagementComponent implements OnInit {
  currentFarm: any = null; suppliers: any[] = []; showNewRow = false; editingId: number | null = null;
  editForm: any = {}; showDeleteDialog = false; deletingId: number | null = null; isSaving = false; errorMessage = '';
  newRow = { supplier_name: '', phone: '', products_supplied: '' };

  constructor(private db: DatabaseService, private authService: AuthService, private cdr: ChangeDetectorRef) {}
  ngOnInit() { this.currentFarm = this.authService.getCurrentFarm(); this.loadSuppliers(); }

  async loadSuppliers() {
    const r = await this.db.get('SELECT * FROM suppliers WHERE farm_id=? ORDER BY supplier_name ASC', [this.currentFarm.farm_id]);
    this.suppliers = r.success ? r.data : []; this.cdr.detectChanges();
  }
  addNewRow() { this.showNewRow = true; this.errorMessage = ''; this.newRow = { supplier_name: '', phone: '', products_supplied: '' }; }
  cancelNewRow() { this.showNewRow = false; }

  // Phone is optional, but if entered must be 7–15 digits (allow + - spaces).
  isValidPhone(phone: string): boolean {
    if (!phone || !phone.trim()) return true;
    const digits = phone.replace(/[\s\-()+]/g, '');
    return /^\d{7,15}$/.test(digits);
  }

  async saveNewRow() {
    if (!this.newRow.supplier_name.trim()) return;
    if (!this.isValidPhone(this.newRow.phone)) {
      this.errorMessage = 'Enter a valid phone number (7–15 digits).'; this.cdr.detectChanges(); return;
    }
    this.isSaving = true; this.showNewRow = false; this.errorMessage = '';
    await this.db.run('INSERT INTO suppliers (farm_id, supplier_name, phone, products_supplied) VALUES (?,?,?,?)', [this.currentFarm.farm_id, this.newRow.supplier_name, this.newRow.phone, this.newRow.products_supplied]);
    this.isSaving = false; await this.loadSuppliers();
  }
  startEdit(s: any) { this.editingId = s.supplier_id; this.errorMessage = ''; this.editForm = { supplier_name: s.supplier_name, phone: s.phone, products_supplied: s.products_supplied }; }
  cancelEdit() { this.editingId = null; }
  async saveEdit(id: number) {
    if (!this.isValidPhone(this.editForm.phone)) {
      this.errorMessage = 'Enter a valid phone number (7–15 digits).'; this.cdr.detectChanges(); return;
    }
    this.errorMessage = '';
    await this.db.run('UPDATE suppliers SET supplier_name=?, phone=?, products_supplied=? WHERE supplier_id=?', [this.editForm.supplier_name, this.editForm.phone, this.editForm.products_supplied, id]);
    this.editingId = null; await this.loadSuppliers();
  }
  confirmDelete(id: number) { this.deletingId = id; this.showDeleteDialog = true; }
  async onDeleteConfirmed() { await this.db.run('DELETE FROM suppliers WHERE supplier_id=?', [this.deletingId]); this.showDeleteDialog = false; await this.loadSuppliers(); }
  onDeleteCancelled() { this.showDeleteDialog = false; }
}