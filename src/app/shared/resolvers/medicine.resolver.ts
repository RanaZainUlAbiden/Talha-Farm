import { Injectable } from '@angular/core';
import { Resolve, ActivatedRouteSnapshot } from '@angular/router';
import { DatabaseService } from '../services/database.service';
import { FlockService } from '../services/flock.service';

@Injectable({
  providedIn: 'root'
})
export class MedicineResolver implements Resolve<any> {
  constructor(
    private db: DatabaseService,
    private flockService: FlockService
  ) {}

  async resolve(route: ActivatedRouteSnapshot) {
    try {
      const flock = this.flockService.getCurrentFlock();
      if (!flock) return { traders: [], flock: null };

      const result = await this.db.get(
        `SELECT t.*,
          COALESCE(SUM(e.total_amount), 0) as total
         FROM medicine_traders t
         LEFT JOIN medicine_entries e ON t.trader_id = e.trader_id
         WHERE t.flock_id = ?
         GROUP BY t.trader_id
         ORDER BY t.trader_name ASC`,
        [flock.flock_id]
      );

      return {
        traders: result.success ? result.data : [],
        flock,
        timestamp: new Date().getTime()
      };
    } catch (error) {
      return { traders: [], flock: null };
    }
  }
}