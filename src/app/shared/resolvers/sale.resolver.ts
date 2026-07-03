import { Injectable } from '@angular/core';
import { Resolve, ActivatedRouteSnapshot } from '@angular/router';
import { DatabaseService } from '../services/database.service';
import { FlockService } from '../services/flock.service';

@Injectable({
  providedIn: 'root'
})
export class SaleResolver implements Resolve<any> {
  constructor(
    private db: DatabaseService,
    private flockService: FlockService
  ) {}

  async resolve(route: ActivatedRouteSnapshot) {
    try {
      const flock = this.flockService.getCurrentFlock();
      if (!flock) return { sales: [], brokers: [], flock: null };

      const salesResult = await this.db.get(
        `SELECT * FROM sales
         WHERE flock_id = ?
         ORDER BY date DESC, sale_id ASC`,
        [flock.flock_id]
      );

      const brokersResult = await this.db.get(
        `SELECT * FROM brokers
         WHERE flock_id = ?
         ORDER BY broker_name ASC`,
        [flock.flock_id]
      );

      return {
        sales: salesResult.success ? salesResult.data : [],
        brokers: brokersResult.success ? brokersResult.data : [],
        flock,
        timestamp: new Date().getTime()
      };
    } catch (error) {
      return { sales: [], brokers: [], flock: null };
    }
  }
}