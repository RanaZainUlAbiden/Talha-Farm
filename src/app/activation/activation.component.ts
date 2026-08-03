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
  
  // Demo keys (in production, these would be validated against a server)
  private readonly DEMO_KEYS = [
    'DEMO-7DAY-TRIAL-2024', 
    'FARM-PRO-2024', 
    'POULTRY-MANAGER-2024',
    'PERMANENT-LICENSE-2024'
  ];

  constructor(
    private router: Router,
    private licenseService: LicenseService
  ) {}

  ngOnInit() {
    // Check if already activated
    if (this.licenseService.isActivated()) {
      this.isActivated = true;
      this.router.navigate(['/login']);
      return;
    }

    // Check trial status
    const status = this.licenseService.getStatus();
    
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

  async activate() {
    if (!this.activationKey.trim()) {
      this.errorMessage = 'Please enter an activation key';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Validate against demo keys (in production, call your server API)
      const isValid = this.DEMO_KEYS.some(key => 
        key.toLowerCase() === this.activationKey.trim().toLowerCase()
      );
      
      if (isValid) {
        this.licenseService.activate();
        this.isActivated = true;
        
        // Show success message before navigating
        this.errorMessage = ''; // Clear any errors
        
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
      // If trial already started, just navigate
      this.router.navigate(['/login']);
      return;
    }
    
    this.licenseService.startTrial();
    this.isTrialStarted = true;
    this.daysRemaining = 7;
    this.expirationDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Navigate to login after a brief delay
    setTimeout(() => {
      this.router.navigate(['/login']);
    }, 300);
  }

  /**
   * Get today's date for display
   */
  getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}