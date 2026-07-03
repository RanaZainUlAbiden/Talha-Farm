import { Injectable } from '@angular/core';
import { Resolve, ActivatedRouteSnapshot } from '@angular/router';
import { DatabaseService } from '../services/database.service';
import { FlockService } from '../services/flock.service';

@Injectable({
  providedIn: 'root'
})
export class IncomeResolver implements Resolve<any> {
  constructor(
    private db: DatabaseService,
    private flockService: FlockService
  ) {}

  async resolve(route: ActivatedRouteSnapshot) {
    try {
      const flock = this.flockService.getCurrentFlock();
      if (!flock) return { income: [], flock: null };

      const result = await this.db.get(
        `SELECT * FROM income
         WHERE flock_id = ?
         ORDER BY date DESC, income_id ASC`,
        [flock.flock_id]
      );

      return {
        income: result.success ? result.data : [],
        flock,
        timestamp: new Date().getTime()
      };
    } catch (error) {
      return { income: [], flock: null };
    }
  }
}
