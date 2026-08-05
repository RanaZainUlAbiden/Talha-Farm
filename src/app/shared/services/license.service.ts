import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class LicenseService {
  constructor() {}

  private get api(): any {
    return (window as any).electronAPI.license;
  }

  private async getMachineId(): Promise<string> {
    return (window as any).electronAPI.getMachineId();
  }

  async validateActivationKey(key: string): Promise<boolean> {
    try {
      const result = await this.api.activate(await this.getMachineId(), key);
      return result.success;
    } catch (error) {
      console.error('Failed to validate activation key:', error);
      return false;
    }
  }

  async startTrial(): Promise<void> {
    const machineId = await this.getMachineId();
    const today = new Date().toISOString();
    await this.api.startTrial(machineId, today);
  }

  async activate(key: string): Promise<void> {
    // Already validated via validateActivationKey, just store is handled there
  }

  async isActivated(): Promise<boolean> {
    const status = await this.api.getStatus();
    return status.activated;
  }

  async getLicenseDaysRemaining(): Promise<number> {
    const status = await this.api.getStatus();
    return status.licenseDaysRemaining || 0;
  }

  async getStatus(): Promise<{
    activated: boolean;
    trialExpired: boolean;
    daysRemaining: number;
    expiryDate: string | null;
    trialStarted: boolean;
    clockTampered: boolean;
    licenseDaysRemaining: number;
    activationCycle: number;
  }> {
    const status = await this.api.getStatus();
    const expiryDate = status.activated
      ? new Date(Date.now() + status.licenseDaysRemaining * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : null;
    return {
      activated: status.activated,
      trialExpired: status.trialExpired,
      daysRemaining: status.daysRemaining,
      expiryDate,
      trialStarted: status.trialStarted,
      clockTampered: status.clockTampered,
      licenseDaysRemaining: status.licenseDaysRemaining || 0,
      activationCycle: status.activationCycle || 0
    };
  }

  async updateLastLaunchDate(): Promise<void> {
    const machineId = await this.getMachineId();
    const today = new Date().toISOString();
    await this.api.updateLastLaunch(machineId, today);
  }

  async getTrialStatusMessage(): Promise<string> {
    const status = await this.api.getStatus();
    if (status.activated) {
      const days = status.licenseDaysRemaining || 0;
      return `✅ Licensed - ${days} day${days !== 1 ? 's' : ''} left`;
    }
    if (status.trialExpired) {
      return '⚠️ Trial Expired - Contact Support';
    }
    return `🚀 Trial: ${status.daysRemaining} day${status.daysRemaining !== 1 ? 's' : ''} remaining`;
  }
}