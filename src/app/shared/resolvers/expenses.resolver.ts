import { Injectable } from '@angular/core';
import { Resolve, ActivatedRouteSnapshot } from '@angular/router';
import { DatabaseService } from '../services/database.service';
import { FlockService } from '../services/flock.service';

@Injectable({
  providedIn: 'root'
})
export class ExpensesResolver implements Resolve<any> {
  constructor(
    private db: DatabaseService,
    private flockService: FlockService
  ) {}

  async resolve(route: ActivatedRouteSnapshot) {
    try {
      const flock = this.flockService.getCurrentFlock();
      if (!flock) return { expenses: [], ledgers: [], flock: null };

      const expensesResult = await this.db.get(
        `SELECT e.*, l.ledger_name 
         FROM expenses e
         LEFT JOIN ledgers l ON e.ledger_id = l.ledger_id
         WHERE e.flock_id = ?
         ORDER BY e.date DESC`,
        [flock.flock_id]
      );

      const ledgersResult = await this.db.get(
        `SELECT * FROM ledgers WHERE flock_id = ? ORDER BY ledger_name ASC`,
        [flock.flock_id]
      );

      return {
        expenses: expensesResult.success ? expensesResult.data : [],
        ledgers: ledgersResult.success ? ledgersResult.data : [],
        flock,
        timestamp: new Date().getTime()
      };
    } catch (error) {
      return { expenses: [], ledgers: [], flock: null };
    }
  }
}