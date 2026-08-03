import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LicenseService } from '../shared/services/license.service';

@Component({
  selector: 'app-activation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './activation.component.html',
  styleUrl: './activation.component.scss'
})
export class ActivationComponent implements OnInit {
  activationKey: string = '';
  isLoading: boolean = false;
  errorMessage: string = '';
  isExpired: boolean = false;
  expirationDate: string = '';
  daysRemaining: number = 0;
  isTrialStarted: boolean = false;
  isActivated: boolean = false;
  isClockTampered: boolean = false;
  machineId: string = '';

  constructor(
    private router: Router,
    private licenseService: LicenseService
  ) {}

  async ngOnInit() {
    this.licenseService.updateLastLaunchDate();

    try {
      this.machineId = await (window as any).electronAPI.getMachineId();
    } catch (e) {
      this.machineId = 'Unable to detect';
    }

    const status = await this.licenseService.getStatus();

    if (status.clockTampered) {
      this.isClockTampered = true;
      return;
    }

    // Check if already activated
    if (status.activated) {
      this.isActivated = true;
      this.router.navigate(['/login']);
      return;
    }

    // Check trial status
    if (status.trialStarted) {
      this.isTrialStarted = true;
      this.daysRemaining = status.daysRemaining;
      this.expirationDate = status.expiryDate || '';

      if (status.trialExpired) {
        this.isExpired = true;
        this.expirationDate = status.expiryDate || '';
      }
    } else {
      this.daysRemaining = 7;
    }
  }

copyMachineId() {
  navigator.clipboard.writeText(this.machineId).then(() => {
    // Brief visual feedback - could add a toast later
  });
}

  async activate() {
    if (!this.activationKey.trim()) {
      this.errorMessage = 'Please enter an activation key';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      // Validate against machine ID using hash
      const isValid = await this.licenseService.validateActivationKey(this.activationKey);

      if (isValid) {
        this.licenseService.activate(this.activationKey);
        this.isActivated = true;

        // Navigate to login after a brief delay
        setTimeout(() => {
          this.router.navigate(['/login']);
        }, 500);
      } else {
        this.errorMessage = '❌ Invalid activation key. Please contact support.';
      }
    } catch (error: any) {
      this.errorMessage = '❌ Activation failed: ' + error.message;
    } finally {
      this.isLoading = false;
    }
  }

  startTrial() {
    if (this.isTrialStarted) {
      this.router.navigate(['/login']);
      return;
    }

    this.licenseService.startTrial();
    this.isTrialStarted = true;
    this.daysRemaining = 7;
    this.expirationDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    setTimeout(() => {
      this.router.navigate(['/login']);
    }, 300);
  }

  getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}