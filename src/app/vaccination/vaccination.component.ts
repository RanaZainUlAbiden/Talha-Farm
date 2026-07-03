import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
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
  showNewRow = false;
  editingId: number | null = null;
  editForm: any = {};
  showDeleteDialog = false;
  deletingId: number | null = null;
  isSaving = false;
  newRow = { batch_id: null, date: new Date().toISOString().split('T')[0], vaccine_name: '', dose: '', notes: '', done: 0 };

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

  addNewRow() { this.showNewRow = true; this.newRow = { batch_id: this.batches[0]?.batch_id, date: new Date().toISOString().split('T')[0], vaccine_name: '', dose: '', notes: '', done: 0 }; }
  cancelNewRow() { this.showNewRow = false; }
  async saveNewRow() {
    if (!this.newRow.batch_id || !this.newRow.vaccine_name) return;
    this.isSaving = true; this.showNewRow = false;
    await this.db.run(`INSERT INTO vaccinations (batch_id, date, vaccine_name, dose, notes, done) VALUES (?,?,?,?,?,?)`, [this.newRow.batch_id, this.newRow.date, this.newRow.vaccine_name, this.newRow.dose, this.newRow.notes, this.newRow.done ? 1 : 0]);
    this.isSaving = false; await this.loadData();
  }

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