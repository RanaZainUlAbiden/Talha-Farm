import { Component, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../shared/services/database.service';
import { AuthService } from '../shared/services/auth.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { DateOnlyPipe } from '../shared/pipes/date-format.pipe';

@Component({
  selector: 'app-vaccination',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, DateOnlyPipe],
  templateUrl: './vaccination.component.html',
  styleUrl: './vaccination.component.scss'
})
export class VaccinationComponent implements OnInit {
  currentFarm: any = null;
  batches: any[] = [];
  vaccinations: any[] = [];
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
    if (event.ctrlKey && event.key === 'a') {
      const activeTag = (event.target as HTMLElement)?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      event.preventDefault();
      this.addPendingRow();
    }
    if (event.ctrlKey && event.key === 's') {
      event.preventDefault();
      if (this.hasPendingRows) this.saveAllRows();
    }
  }

  constructor(private db: DatabaseService, private authService: AuthService, private cdr: ChangeDetectorRef) {}

  ngOnInit() { this.currentFarm = this.authService.getCurrentFarm(); this.loadData(); }

  async loadData() {
    const br = await this.db.get(`SELECT * FROM batches WHERE farm_id = ? AND status='active'`, [this.currentFarm.farm_id]);
    this.batches = br.success ? br.data : [];
    const vr = await this.db.get(`SELECT v.*, b.batch_name FROM vaccinations v JOIN batches b ON v.batch_id=b.batch_id WHERE b.farm_id=? ORDER BY v.date ASC`, [this.currentFarm.farm_id]);
    this.vaccinations = vr.success ? vr.data : [];
    this.cdr.detectChanges();
  }

  getBatchName(id: number) { return this.batches.find(b => b.batch_id === id)?.batch_name || '—'; }

  makeNewRow() { return { batch_id: this.batches[0]?.batch_id, date: new Date().toISOString().split('T')[0], vaccine_name: '', dose: '', notes: '', done: 0 }; }
  addPendingRow() { if (!this.isSaving) this.pendingRows.push(this.makeNewRow()); }
  addRowAfter(i: number) { this.pendingRows.splice(i + 1, 0, this.makeNewRow()); }
  removePendingRow(i: number) { this.pendingRows.splice(i, 1); }

  async saveAllRows() {
    if (!this.pendingRows.length || this.isSavingAll) return;
    this.isSavingAll = true;
    for (const row of this.pendingRows) {
      if (!row.batch_id || !row.vaccine_name) continue;
      await this.db.run(`INSERT INTO vaccinations (batch_id, date, vaccine_name, dose, notes, done) VALUES (?,?,?,?,?,?)`, 
        [row.batch_id, row.date, row.vaccine_name, row.dose, row.notes, row.done ? 1 : 0]);
    }
    this.pendingRows = [];
    this.isSavingAll = false;
    await this.loadData();
  }

  cancelAllRows() { this.pendingRows = []; }

  startEdit(v: any) { this.editingId = v.vaccination_id; this.editForm = { batch_id: v.batch_id, date: v.date, vaccine_name: v.vaccine_name, dose: v.dose, notes: v.notes, done: !!v.done }; }
  cancelEdit() { this.editingId = null; }
  async saveEdit(id: number) {
    await this.db.run(`UPDATE vaccinations SET batch_id=?, date=?, vaccine_name=?, dose=?, notes=?, done=? WHERE vaccination_id=?`, [this.editForm.batch_id, this.editForm.date, this.editForm.vaccine_name, this.editForm.dose, this.editForm.notes, this.editForm.done ? 1 : 0, id]);
    this.editingId = null; await this.loadData();
  }

  confirmDelete(id: number) { this.deletingId = id; this.showDeleteDialog = true; }
  async onDeleteConfirmed() { await this.db.run('DELETE FROM vaccinations WHERE vaccination_id=?', [this.deletingId]); this.showDeleteDialog = false; await this.loadData(); }
  onDeleteCancelled() { this.showDeleteDialog = false; }
}