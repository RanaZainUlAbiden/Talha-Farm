import { Injectable } from '@angular/core';
import { Resolve, ActivatedRouteSnapshot } from '@angular/router';
import { DatabaseService } from '../services/database.service';
import { FlockService } from '../services/flock.service';

@Injectable({
  providedIn: 'root'
})
export class ReportResolver implements Resolve<any> {
  constructor(
    private db: DatabaseService,
    private flockService: FlockService
  ) {}

  async resolve(route: ActivatedRouteSnapshot) {
    try {
      const flock = this.flockService.getCurrentFlock();
      if (!flock) return { flock: null };

      const [
        expenses,
        ledgers,
        ledgerEntries,
        traders,
        medicineEntries,
        feedTraders,
        feedEntries,
        vaccinations,
        sales,
        income,
        health
      ] = await Promise.all([
        this.db.get(
          `SELECT e.*, l.ledger_name FROM expenses e
           LEFT JOIN ledgers l ON e.ledger_id = l.ledger_id
           WHERE e.flock_id = ? ORDER BY e.date ASC`,
          [flock.flock_id]
        ),
        this.db.get(
          `SELECT * FROM ledgers WHERE flock_id = ?
           ORDER BY ledger_name ASC`,
          [flock.flock_id]
        ),
        this.db.get(
          `SELECT le.*, l.ledger_name FROM ledger_entries le
           JOIN ledgers l ON le.ledger_id = l.ledger_id
           WHERE le.flock_id = ? ORDER BY le.date ASC`,
          [flock.flock_id]
        ),
        this.db.get(
          `SELECT * FROM medicine_traders WHERE flock_id = ?
           ORDER BY trader_name ASC`,
          [flock.flock_id]
        ),
        this.db.get(
          `SELECT me.*, mt.trader_name FROM medicine_entries me
           JOIN medicine_traders mt ON me.trader_id = mt.trader_id
           WHERE me.flock_id = ? ORDER BY me.date ASC`,
          [flock.flock_id]
        ),
        this.db.get(
          `SELECT * FROM feed_traders WHERE flock_id = ?
           ORDER BY trader_name ASC`,
          [flock.flock_id]
        ),
        this.db.get(
          `SELECT fe.*, ft.trader_name FROM feed_entries fe
           JOIN feed_traders ft ON fe.trader_id = ft.trader_id
           WHERE fe.flock_id = ? ORDER BY fe.date ASC`,
          [flock.flock_id]
        ),
        this.db.get(
          `SELECT * FROM vaccinations
           WHERE flock_id = ? ORDER BY date ASC`,
          [flock.flock_id]
        ),
        this.db.get(
          `SELECT * FROM sales WHERE flock_id = ?
           ORDER BY date ASC`,
          [flock.flock_id]
        ),
        this.db.get(
          `SELECT * FROM income WHERE flock_id = ? AND module_type = 'broiler'
           ORDER BY date ASC`,
          [flock.flock_id]
        ),
        this.db.get(
          `SELECT * FROM flock_health WHERE flock_id = ?
           ORDER BY week_number ASC`,
          [flock.flock_id]
        )
      ]);

      return {
        flock,
        expenses: expenses.success ? expenses.data : [],
        ledgers: ledgers.success ? ledgers.data : [],
        ledgerEntries: ledgerEntries.success ? ledgerEntries.data : [],
        traders: traders.success ? traders.data : [],
        medicineEntries: medicineEntries.success ? medicineEntries.data : [],
        feedTraders: feedTraders.success ? feedTraders.data : [],
        feedEntries: feedEntries.success ? feedEntries.data : [],
        vaccinations: vaccinations.success ? vaccinations.data : [],
        sales: sales.success ? sales.data : [],
        income: income.success ? income.data : [],
        health: health.success ? health.data : [],
        timestamp: new Date().getTime()
      };
    } catch (error) {
      return { flock: null };
    }
  }
}
