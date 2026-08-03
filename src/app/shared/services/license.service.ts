import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class LicenseService {
  private readonly LICENSE_KEY = 'farm_license_activated';
  private readonly TRIAL_KEY = 'farm_trial_start_date';
  private readonly TRIAL_DAYS = 7;

  constructor() {}

  /**
   * Start the trial period
   */
  startTrial(): void {
    const today = new Date();
    localStorage.setItem(this.TRIAL_KEY, today.toISOString());
  }

  /**
   * Get trial start date
   */
  getTrialStartDate(): Date | null {
    const data = localStorage.getItem(this.TRIAL_KEY);
    if (!data) return null;
    return new Date(data);
  }

  /**
   * Get trial expiration date
   */
  getTrialExpirationDate(): string | null {
    const start = this.getTrialStartDate();
    if (!start) return null;
    const expiry = new Date(start);
    expiry.setDate(expiry.getDate() + this.TRIAL_DAYS);
    return expiry.toISOString().split('T')[0];
  }

  /**
   * Get days remaining in trial
   */
  getTrialDaysRemaining(): number {
    const start = this.getTrialStartDate();
    if (!start) return this.TRIAL_DAYS;
    
    const now = new Date();
    const diffTime = now.getTime() - start.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const remaining = this.TRIAL_DAYS - diffDays;
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Check if trial is expired
   */
  isTrialExpired(): boolean {
    const start = this.getTrialStartDate();
    if (!start) return false;
    
    const now = new Date();
    const diffTime = now.getTime() - start.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > this.TRIAL_DAYS;
  }

  /**
   * Activate the application with a license key
   */
  activate(): void {
    localStorage.setItem(this.LICENSE_KEY, 'true');
  }

  /**
   * Check if application is activated
   */
  isActivated(): boolean {
    return localStorage.getItem(this.LICENSE_KEY) === 'true';
  }

  /**
   * Deactivate the application
   */
  deactivate(): void {
    localStorage.removeItem(this.LICENSE_KEY);
  }

  /**
   * Get license status
   */
  getStatus(): { 
    activated: boolean; 
    trialExpired: boolean; 
    daysRemaining: number; 
    expiryDate: string | null;
    trialStarted: boolean;
  } {
    const activated = this.isActivated();
    const trialStarted = !!this.getTrialStartDate();
    const trialExpired = this.isTrialExpired();
    const daysRemaining = this.getTrialDaysRemaining();
    const expiryDate = this.getTrialExpirationDate();

    return { 
      activated, 
      trialExpired, 
      daysRemaining, 
      expiryDate,
      trialStarted
    };
  }

  /**
   * Check if application is accessible
   * Returns true if:
   * - Activated, OR
   * - Trial is active (not expired)
   */
  isAccessAllowed(): boolean {
    // If activated, always allow access
    if (this.isActivated()) {
      return true;
    }
    
    // If not activated, check trial
    return !this.isTrialExpired();
  }

  /**
   * Get trial status message
   */
  getTrialStatusMessage(): string {
    if (this.isActivated()) {
      return '✅ License Activated';
    }
    
    if (this.isTrialExpired()) {
      return '⛔ Trial Expired - Contact Support';
    }
    
    const days = this.getTrialDaysRemaining();
    return `🚀 Trial: ${days} day${days > 1 ? 's' : ''} remaining`;
  }
}