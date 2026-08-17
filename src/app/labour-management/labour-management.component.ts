import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { PaginationComponent } from '../shared/components/pagination/pagination.component';

@Component({
  selector: 'app-labour-management',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, PaginationComponent],
  templateUrl: './labour-management.component.html',
  styleUrl: './labour-management.component.scss'
})
export class LabourManagementComponent implements OnInit {
  currentFarm: any = null;
  roster: any[] = [];
  isLoading = true;
  errorMessage = '';

  showForm = false;
  editingId: number | null = null;
  form = { labour_name: '', phone: '', role: '' };

  showDeleteDialog = false;
  deletingId: number | null = null;

  currentPage = 1;
  pageSize = 20;

  get paginatedRoster() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.roster.slice(start, start + this.pageSize);
  }

  constructor(
    private db: DatabaseService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentFarm = this.authService.getCurrentFarm();
    this.loadData();
  }

  async loadData() {
    this.isLoading = true;
    try {
      const result = await this.db.get(
        `SELECT l.*, COALESCE(SUM(lp.amount), 0) as total_paid
         FROM labour l
         LEFT JOIN labour_payments lp ON l.labour_id = lp.labour_id
         WHERE l.farm_id = ?
         GROUP BY l.labour_id
         ORDER BY l.labour_name ASC`,
        [this.currentFarm.farm_id]
      );
      this.roster = result.success ? result.data : [];
      this.currentPage = 1;
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  openAddForm() {
    this.editingId = null;
    this.form = { labour_name: '', phone: '', role: '' };
    this.showForm = true;
  }

  openEditForm(l: any) {
    this.editingId = l.labour_id;
    this.form = { labour_name: l.labour_name, phone: l.phone || '', role: l.role || '' };
    this.showForm = true;
  }

  cancelForm() { this.showForm = false; this.editingId = null; }

  async saveForm() {
    if (!this.form.labour_name.trim()) return;
    this.errorMessage = '';
    try {
      if (this.editingId) {
        await this.db.run(
          `UPDATE labour SET labour_name=?, phone=?, role=? WHERE labour_id=?`,
          [this.form.labour_name.trim(), this.form.phone, this.form.role, this.editingId]
        );
      } else {
        await this.db.run(
          `INSERT INTO labour (farm_id, labour_name, phone, role) VALUES (?,?,?,?)`,
          [this.currentFarm.farm_id, this.form.labour_name.trim(), this.form.phone, this.form.role]
        );
      }
      this.showForm = false;
      this.editingId = null;
      await this.loadData();
    } catch (error: any) {
      this.errorMessage = 'Error saving: ' + error.message;
      this.cdr.detectChanges();
    }
  }

  confirmDelete(id: number) { this.deletingId = id; this.showDeleteDialog = true; }
  onDeleteCancelled() { this.showDeleteDialog = false; this.deletingId = null; }

  async onDeleteConfirmed() {
    if (!this.deletingId) return;
    try {
      // Payments already recorded for this labourer are kept for history —
      // only the roster entry is removed, matching how other Distribution
      // deletes in this app behave.
      await this.db.run(`DELETE FROM labour WHERE labour_id=?`, [this.deletingId]);
      this.showDeleteDialog = false;
      this.deletingId = null;
      await this.loadData();
    } catch (error: any) {
      this.errorMessage = 'Error deleting: ' + error.message;
      this.showDeleteDialog = false;
      this.cdr.detectChanges();
    }
  }
}