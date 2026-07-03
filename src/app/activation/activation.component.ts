import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DatabaseService } from '../shared/services/database.service';

@Component({
  selector: 'app-activation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './activation.component.html',
  styleUrl: './activation.component.scss'
})
export class ActivationComponent implements OnInit {
  machineId: string = '';
  activationCode: string = '';
  errorMessage: string = '';
  isChecking: boolean = false;

  constructor(
    private db: DatabaseService,
    private router: Router
  ) {}

  async ngOnInit() {
    this.machineId = await (window as any).electronAPI.getMachineId();
    const result = await this.db.get(
      `SELECT * FROM activation WHERE is_active = 1`, []
    );
    if (result.success && result.data.length > 0) {
      const saved = result.data[0];
      if (this.verifyCode(saved.machine_id, saved.activation_code)) {
        this.router.navigate(['/splash']);
        return;
      }
    }
  }

  private SECRET = 'SNG@PoultryFarm#2024!DevInfantary';

  private hashCode(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    const hex = Math.abs(hash).toString(16).toUpperCase();
    return hex.padStart(8, '0');
  }

  private verifyCode(machineId: string, code: string): boolean {
    const combined = machineId + this.SECRET;
    const expected = this.hashCode(combined);
    const formatted = `SNG-${expected.slice(0,4)}-${expected.slice(4,8)}`;
    return code.toUpperCase() === formatted;
  }

  copyMachineId() {
    navigator.clipboard.writeText(this.machineId);
  }

  async activate() {
    this.errorMessage = '';
    if (!this.activationCode.trim()) {
      this.errorMessage = 'Please enter activation code';
      return;
    }

    this.isChecking = true;

    if (this.verifyCode(this.machineId, this.activationCode.trim())) {
      await this.db.run(
        `INSERT OR REPLACE INTO activation
          (machine_id, activation_code, is_active)
         VALUES (?, ?, 1)`,
        [this.machineId, this.activationCode.trim().toUpperCase()]
      );
      this.router.navigate(['/splash']);
    } else {
      this.errorMessage = 'Invalid activation code. Please contact your provider.';
    }

    this.isChecking = false;
  }
}