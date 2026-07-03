import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private currentFarm: any = null;

  constructor(
    private db: DatabaseService,
    private router: Router
  ) {}

  async login(farmName: string, password: string): Promise<boolean> {
    const result = await this.db.get(
      `SELECT * FROM farms
       WHERE LOWER(farm_name) = LOWER(?)
       AND password_hash = ?`,
      [farmName.trim(), this.hashPassword(password)]
    );

    if (result.success && result.data.length > 0) {
      this.currentFarm = result.data[0];
      localStorage.setItem('currentFarm',
        JSON.stringify(this.currentFarm));
      // Save business type for sidebar
      localStorage.setItem('businessType', this.currentFarm.business_type || 'broiler');
      return true;
    }
    return false;
  }

  async registerFarm(farmName: string, password: string, businessType: string = 'broiler'): Promise<any> {
    const exists = await this.db.get(
      `SELECT * FROM farms WHERE LOWER(farm_name) = LOWER(?)`,
      [farmName.trim()]
    );

    if (exists.success && exists.data.length > 0) {
      return { success: false, error: 'Farm name already exists' };
    }

    const result = await this.db.run(
      `INSERT INTO farms (farm_name, password_hash, business_type) VALUES (?, ?, ?)`,
      [farmName.trim(), this.hashPassword(password), businessType]
    );
    return result;
  }

  async getAllFarms(): Promise<any[]> {
    const result = await this.db.get(
      `SELECT farm_id, farm_name, business_type, created_at FROM farms ORDER BY farm_id ASC`,
      []
    );
    return result.success ? result.data : [];
  }

  async updateFarm(farmId: number, farmName: string,
    password?: string): Promise<any> {
    if (password) {
      return await this.db.run(
        `UPDATE farms SET farm_name = ?, password_hash = ?
         WHERE farm_id = ?`,
        [farmName.trim(), this.hashPassword(password), farmId]
      );
    } else {
      return await this.db.run(
        `UPDATE farms SET farm_name = ? WHERE farm_id = ?`,
        [farmName.trim(), farmId]
      );
    }
  }

  async deleteFarm(farmId: number): Promise<any> {
    return await this.db.run(
      `DELETE FROM farms WHERE farm_id = ?`,
      [farmId]
    );
  }

  getCurrentFarm(): any {
    if (this.currentFarm) return this.currentFarm;
    const stored = localStorage.getItem('currentFarm');
    return stored ? JSON.parse(stored) : null;
  }

  logout(): void {
    this.currentFarm = null;
    localStorage.removeItem('currentFarm');
    localStorage.removeItem('currentFlock');
    localStorage.removeItem('businessType');
    this.router.navigate(['/login']);
  }

  private hashPassword(password: string): string {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  isLoggedIn(): boolean {
    return this.getCurrentFarm() !== null;
  }
}