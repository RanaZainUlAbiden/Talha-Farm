import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';

/**
 * Account-wide financial consolidation for the Overview dashboard.
 *
 * READ-ONLY. Every statement in this file is a SELECT — nothing here calls
 * `db.run()`. There are no transactions in this codebase, so a service that
 * both reads and writes across seven modules could half-complete and leave
 * the books inconsistent; consolidation therefore never writes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ACCOUNTING BASIS: ACCRUAL
 * ─────────────────────────────────────────────────────────────────────────
 * The existing reports disagree — `distribution-report.component.ts` is cash
 * basis (`totalPaidSales`, only `bills.amount_paid` counts), while
 * `report.component.ts` and `layer-report.component.ts` count income as
 * recorded. Summing the two produces a number that means nothing.
 *
 * This service standardises on ACCRUAL for one reason: cash basis is not
 * expressible for broiler and layer. `sales`, `egg_sales` and `hen_sales`
 * carry a `payment_type` but no `amount_paid`, and there is no
 * customer-payment table on that side — so there is no way to know how much
 * of a credit sale has since been collected. Accrual is the only basis all
 * three modules can actually produce, so it is the one applied here.
 *
 * Consequence to surface on the dashboard: the distribution slice of
 * `revenue.distribution` will read HIGHER than the Distribution Report's
 * own profit figure, because unpaid bills count here and do not there.
 * `revenue.distributionCollected` is exposed so the dashboard can show the
 * cash-basis figure alongside it, but it is NOT part of any total.
 *
 * `basisLabel` is meant to be rendered verbatim next to the headline number.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DISTRIBUTION COST: COST OF GOODS SOLD, NOT PURCHASES
 * ─────────────────────────────────────────────────────────────────────────
 * Distribution's cost is the purchase cost of the stock that actually SOLD,
 * traced through `batch_transactions` -> `product_batches.purchase_price`.
 * It is not `purchase_orders.total_amount`.
 *
 * Charging every purchase against the period treats buying stock as spending
 * money, when it converts cash into an asset the owner still holds. A shop
 * that had bought Rs 7.24m of stock and sold Rs 12.5k of it read as a Rs 7.24m
 * loss, with Rs 7.23m of that sitting on its own shelves. `qDistributionCogs()`
 * carries the full derivation, including how partly-costed and uncosted sales
 * are handled; `distribution-report.component.ts` computes the same figure the
 * same way, so the two screens agree.
 *
 * Purchase returns are consequently NOT credited against profit any more:
 * stock sent back to a supplier never sold, so its cost never entered COGS.
 * `expenses.purchases` and `expenses.purchaseReturns` are still reported for
 * reference, but neither is part of `expenses.total`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * INTERNAL TRANSFERS
 * ─────────────────────────────────────────────────────────────────────────
 * When distribution "sells" to a broiler flock or layer batch, the app books
 * BOTH sides: a `bills` row (revenue) and a cost row in the target module
 * (expense). At account level those cancel — see `eliminateInternalRows()`
 * below for exactly which rows are dropped and how they are identified.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SCOPING
 * ─────────────────────────────────────────────────────────────────────────
 * Everything is filtered by the logged-in account's `farm_id`, per the
 * multi-tenancy rule. "Per-farm breakdown" means per `farm_units` row (the
 * client-facing "Farm"), NOT per `farms` row — `farms` is the login account,
 * and aggregating across accounts would leak one customer's data into
 * another's dashboard.
 */

/** Inclusive date bounds, 'YYYY-MM-DD'. Omit/null either side for open-ended. */
export interface OverviewDateRange {
  from?: string | null;
  to?: string | null;
}

export interface OverviewRevenue {
  total: number;
  broiler: number;
  layer: number;
  distribution: number;
  /** Cash-basis distribution revenue (bills.amount_paid). Reference only — not in any total. */
  distributionCollected: number;
}

export interface OverviewExpenses {
  total: number;
  /** expenses table, broiler + layer */
  general: number;
  medicine: number;
  feed: number;
  vaccination: number;
  labour: number;
  /** broiler ledger_entries debits, excluding those mirrored from expenses */
  ledgerDebits: number;
  /**
   * Purchase cost of the distribution stock that actually sold in the period.
   * This is the distribution module's cost of sales and IS part of `total`.
   */
  costOfGoodsSold: number;
  /**
   * Gross purchase_orders in the period. Reference only — NOT in `total`.
   * Buying stock is an asset swap, not an expense; `costOfGoodsSold` is the
   * expense. Shown so the dashboard can reconcile purchases to stock on hand.
   */
  purchases: number;
  /** purchase_returns in the period. Reference only — NOT in `total`. */
  purchaseReturns: number;
  /** expense_ledger — the distribution module's own expense book */
  distributionExpenses: number;
  byModule: { broiler: number; layer: number; distribution: number };
}

export interface OverviewAssets {
  /** Sold assets only: sale_amount - purchase_amount */
  realisedGainLoss: number;
  soldCount: number;
  /** purchase_amount of assets still held */
  activeValue: number;
  activeCount: number;
}

export interface OverviewBankAccount {
  bank_id: number;
  bank_name: string;
  account_number: string | null;
  /** Ledger balance as at range.to (or all-time when no upper bound). */
  balance: number;
  /** The stored running balance on bank_accounts, for cross-checking. */
  currentBalance: number;
}

export interface OverviewBank {
  accounts: OverviewBankAccount[];
  total: number;
}

export interface OverviewCash {
  inflow: number;
  outflow: number;
  net: number;
  note: string;
}

export interface OverviewFarmProfit {
  /** null when the flock/batch has no unit_id, or for the distribution row. */
  unitId: number | null;
  unitName: string;
  moduleType: 'broiler' | 'layer' | 'distribution';
  revenue: number;
  expenses: number;
  profit: number;
}

export interface OverviewInternalTransfers {
  /** Number of bills with payment_type = 'internal' inside the range. */
  billCount: number;
  /** Distribution revenue removed (sum of those bills' total_amount). */
  revenueExcluded: number;
  /** Broiler/layer cost rows removed (the matching other side). */
  expenseExcluded: number;
  /** Rows removed on the expense side. */
  expenseRowCount: number;
}

/**
 * Distribution stock still on hand, valued at what it cost to buy. Not part of
 * profit — it is the asset the purchases turned into, reported so a large
 * purchase figure can be reconciled against something visible.
 *
 * Point-in-time, valued as at now: `product_batches` holds only a live quantity
 * with no movement history to rewind, so this ignores `range`.
 */
export interface OverviewInventory {
  /** Cost value of unexpired stock with quantity remaining. */
  value: number;
  /** Units sitting in batches with no purchase price — valued at a fallback rate. */
  unpricedUnits: number;
}

export interface OverviewSummary {
  basis: 'accrual';
  basisLabel: string;
  range: OverviewDateRange;
  revenue: OverviewRevenue;
  expenses: OverviewExpenses;
  inventory: OverviewInventory;
  businessNetProfit: number;
  personalWithdrawals: number;
  netPosition: number;
  assets: OverviewAssets;
  bank: OverviewBank;
  cash: OverviewCash;
  perFarm: OverviewFarmProfit[];
  internalTransfers: OverviewInternalTransfers;
  /** Non-fatal problems (failed queries, data the basis can't represent). */
  warnings: string[];
}

/** One `GROUP BY unit_id` bucket. */
interface UnitRow {
  unitId: number | null;
  amount: number;
  cashAmount: number;
  rowCount: number;
}

type ModuleKey = 'broiler' | 'layer' | 'distribution';

const BASIS_LABEL =
  'Accrual basis - revenue counted when the sale is recorded, not when it is collected. ' +
  'Distribution cost is the purchase cost of the stock that actually sold; stock still ' +
  'on the shelves is reported as inventory, not charged against profit. ' +
  'Internal farm-to-farm transfers are excluded from both sides.';

const CASH_NOTE =
  'Cash movement over the period, derived from records that carry a payment type ' +
  '(anything not marked "bank" is treated as cash, matching the app default). ' +
  'Medicine, feed and vaccination costs have no payment field and are counted as cash. ' +
  'Ledger debits are amounts owed, not paid, and are excluded. ' +
  'There is no cash account in the database, so this is a period movement, not a balance.';

@Injectable({ providedIn: 'root' })
export class OverviewService {

  constructor(private db: DatabaseService) {}

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Consolidate every module for `farmId`, optionally restricted to a date
   * range. Never throws and never writes: a failed query contributes zero and
   * adds a line to `warnings`.
   */
  async getSummary(farmId: number, range: OverviewDateRange = {}): Promise<OverviewSummary> {
    const warnings: string[] = [];

    if (!farmId) {
      return this.emptySummary(range, ['No farm account is active — nothing to consolidate.']);
    }

    const [
      units,
      broilerSales, eggSales, henSales, broilerIncome, layerIncome,
      distributionBills, internalBills,
      broilerExpenses, layerExpenses,
      broilerMedicine, layerMedicine,
      broilerFeed, layerFeed,
      broilerVaccination, layerVaccination,
      broilerLabour, layerLabour,
      broilerLedgerDebits,
      purchases, purchaseReturns, distributionCogs, inventoryOnHand, distributionExpenses,
      internalExpenseSide,
      assetsRealised, assetsActive, assetPurchases,
      personal,
      bankAccounts
    ] = await Promise.all([
      this.loadUnits(farmId, warnings),

      // ── Revenue ──
      this.unitRows(this.qBroilerSales(farmId, range), warnings),
      this.unitRows(this.qEggSales(farmId, range), warnings),
      this.unitRows(this.qHenSales(farmId, range), warnings),
      this.unitRows(this.qBroilerIncome(farmId, range), warnings),
      this.unitRows(this.qLayerIncome(farmId, range), warnings),
      this.scalarRow(this.qDistributionBills(farmId, range), warnings),
      this.scalarRow(this.qInternalBills(farmId, range), warnings),

      // ── Expenses ──
      this.unitRows(this.qExpenses(farmId, range, 'broiler'), warnings),
      this.unitRows(this.qExpenses(farmId, range, 'layer'), warnings),
      this.unitRows(this.qTraderEntries(farmId, range, 'broiler', 'medicine'), warnings),
      this.unitRows(this.qTraderEntries(farmId, range, 'layer', 'medicine'), warnings),
      this.unitRows(this.qTraderEntries(farmId, range, 'broiler', 'feed'), warnings),
      this.unitRows(this.qTraderEntries(farmId, range, 'layer', 'feed'), warnings),
      this.unitRows(this.qVaccinations(farmId, range, 'broiler'), warnings),
      this.unitRows(this.qVaccinations(farmId, range, 'layer'), warnings),
      this.unitRows(this.qLabour(farmId, range, 'broiler'), warnings),
      this.unitRows(this.qLabour(farmId, range, 'layer'), warnings),
      this.unitRows(this.qLedgerDebits(farmId, range), warnings),
      this.scalarRow(this.qPurchases(farmId, range), warnings),
      this.scalarRow(this.qPurchaseReturns(farmId, range), warnings),
      this.scalarRow(this.qDistributionCogs(farmId, range), warnings),
      this.scalarRow(this.qInventoryOnHand(farmId), warnings),
      this.scalarRow(this.qDistributionExpenses(farmId, range), warnings),
      this.scalarRow(this.qInternalExpenseSide(farmId, range), warnings),

      // ── Assets / personal / bank ──
      this.unitRows(this.qAssetsRealised(farmId, range), warnings),
      this.unitRows(this.qAssetsActive(farmId, range), warnings),
      this.scalarRow(this.qAssetPurchases(farmId, range), warnings),
      this.scalarRow(this.qPersonalExpenses(farmId, range), warnings),
      this.loadBankAccounts(farmId, range, warnings)
    ]);

    // ── Revenue ────────────────────────────────────────────────────────────
    const broilerRevenue = this.sum(broilerSales) + this.sum(broilerIncome);
    const layerRevenue = this.sum(eggSales) + this.sum(henSales) + this.sum(layerIncome);
    const distributionRevenue = this.num(distributionBills['amount']);

    const revenue: OverviewRevenue = {
      total: broilerRevenue + layerRevenue + distributionRevenue,
      broiler: broilerRevenue,
      layer: layerRevenue,
      distribution: distributionRevenue,
      distributionCollected: this.num(distributionBills['paid_amount'])
    };

    // ── Expenses ───────────────────────────────────────────────────────────
    const general = this.sum(broilerExpenses) + this.sum(layerExpenses);
    const medicine = this.sum(broilerMedicine) + this.sum(layerMedicine);
    const feed = this.sum(broilerFeed) + this.sum(layerFeed);
    const vaccination = this.sum(broilerVaccination) + this.sum(layerVaccination);
    const labour = this.sum(broilerLabour) + this.sum(layerLabour);
    const ledgerDebits = this.sum(broilerLedgerDebits);
    // Distribution's cost of sales is COGS, not purchases. See qDistributionCogs().
    // Purchases and purchase returns are reported alongside it for reconciliation
    // but neither enters the total: money spent on stock that has not sold is an
    // asset, and stock handed back to a supplier never sold in the first place.
    const grossPurchases = this.num(purchases['amount']);
    const purchaseReturnsTotal = this.num(purchaseReturns['amount']);
    const costOfGoodsSold = this.num(distributionCogs['amount']);
    const distExpenses = this.num(distributionExpenses['amount']);

    const broilerExpenseTotal =
      this.sum(broilerExpenses) + this.sum(broilerMedicine) + this.sum(broilerFeed) +
      this.sum(broilerVaccination) + this.sum(broilerLabour) + ledgerDebits;
    const layerExpenseTotal =
      this.sum(layerExpenses) + this.sum(layerMedicine) + this.sum(layerFeed) +
      this.sum(layerVaccination) + this.sum(layerLabour);
    const distributionExpenseTotal = costOfGoodsSold + distExpenses;

    const expenses: OverviewExpenses = {
      total: broilerExpenseTotal + layerExpenseTotal + distributionExpenseTotal,
      general,
      medicine,
      feed,
      vaccination,
      labour,
      ledgerDebits,
      costOfGoodsSold,
      purchases: grossPurchases,
      purchaseReturns: purchaseReturnsTotal,
      distributionExpenses: distExpenses,
      byModule: {
        broiler: broilerExpenseTotal,
        layer: layerExpenseTotal,
        distribution: distributionExpenseTotal
      }
    };

    const inventory: OverviewInventory = {
      value: this.num(inventoryOnHand['amount']),
      unpricedUnits: this.num(inventoryOnHand['unpriced_qty'])
    };

    const uncostedUnits = this.num(distributionCogs['uncosted_qty']);
    if (uncostedUnits > 0) {
      warnings.push(
        `${uncostedUnits.toLocaleString()} unit(s) of distribution stock sold in this period are ` +
        'costed at an estimated rate rather than the price recorded on the batch they came from ' +
        '(bills predating the batch module, or batches saved without a purchase price). ' +
        'The Distribution Report breaks this down per product.'
      );
    }
    if (inventory.unpricedUnits > 0) {
      warnings.push(
        `${inventory.unpricedUnits.toLocaleString()} unit(s) of stock on hand sit in batches with no ` +
        'purchase price, so the inventory value shown for them is an estimate.'
      );
    }

    const businessNetProfit = revenue.total - expenses.total;
    const personalWithdrawals = this.num(personal['amount']);
    const netPosition = businessNetProfit - personalWithdrawals;

    // ── Assets ─────────────────────────────────────────────────────────────
    const assets: OverviewAssets = {
      realisedGainLoss: this.sum(assetsRealised),
      soldCount: this.count(assetsRealised),
      activeValue: this.sum(assetsActive),
      activeCount: this.count(assetsActive)
    };

    // ── Cash ───────────────────────────────────────────────────────────────
    const cashInflow =
      this.cash(broilerSales) + this.cash(eggSales) + this.cash(henSales) +
      this.cash(broilerIncome) + this.cash(layerIncome) +
      this.num(distributionBills['cash_amount']) +
      this.num(purchaseReturns['cash_amount']) +
      // Asset sales have no settlement record; proceeds are treated as cash in.
      this.cash(assetsRealised);

    const cashOutflow =
      this.cash(broilerExpenses) + this.cash(layerExpenses) +
      this.cash(broilerMedicine) + this.cash(layerMedicine) +
      this.cash(broilerFeed) + this.cash(layerFeed) +
      this.cash(broilerVaccination) + this.cash(layerVaccination) +
      this.cash(broilerLabour) + this.cash(layerLabour) +
      this.num(purchases['cash_amount']) +
      this.num(distributionExpenses['cash_amount']) +
      this.num(assetPurchases['cash_amount']) +
      this.num(personal['cash_amount']);

    const cash: OverviewCash = {
      inflow: cashInflow,
      outflow: cashOutflow,
      net: cashInflow - cashOutflow,
      note: CASH_NOTE
    };

    // ── Per-farm breakdown ─────────────────────────────────────────────────
    const perFarm = this.buildPerFarm(units, {
      broilerRevenue: [broilerSales, broilerIncome],
      layerRevenue: [eggSales, henSales, layerIncome],
      broilerExpenses: [
        broilerExpenses, broilerMedicine, broilerFeed,
        broilerVaccination, broilerLabour, broilerLedgerDebits
      ],
      layerExpenses: [layerExpenses, layerMedicine, layerFeed, layerVaccination, layerLabour]
    }, distributionRevenue, distributionExpenseTotal);

    // ── Internal transfer diagnostics ──────────────────────────────────────
    const internalTransfers: OverviewInternalTransfers = {
      billCount: this.num(internalBills['row_count']),
      revenueExcluded: this.num(internalBills['amount']),
      expenseExcluded: this.num(internalExpenseSide['amount']),
      expenseRowCount: this.num(internalExpenseSide['row_count'])
    };

    if (Math.abs(internalTransfers.revenueExcluded - internalTransfers.expenseExcluded) > 1) {
      warnings.push(
        'Internal transfers do not balance for this period: ' +
        `${internalTransfers.revenueExcluded.toFixed(2)} removed from distribution revenue but ` +
        `${internalTransfers.expenseExcluded.toFixed(2)} removed from broiler/layer costs. ` +
        'Returns re-date the cost side to the return date, so a period boundary can split a ' +
        'transfer; a persistent gap means orphaned rows from a half-completed save.'
      );
    }

    return {
      basis: 'accrual',
      basisLabel: BASIS_LABEL,
      range,
      revenue,
      expenses,
      inventory,
      businessNetProfit,
      personalWithdrawals,
      netPosition,
      assets,
      bank: bankAccounts,
      cash,
      perFarm,
      internalTransfers,
      warnings
    };
  }

  // ── Internal transfer elimination ────────────────────────────────────────

  /**
   * The two sides of an internal transfer and how each is recognised.
   *
   * REVENUE SIDE — `bills` rows written by `sales-orders.component.ts` when
   * `customerType === 'internal'`. They are stamped `payment_type = 'internal'`
   * and `amount_paid = total_amount` (there is no receivable — the money never
   * left the owner). Dropped by `COALESCE(payment_type,'cash') <> 'internal'`.
   * Every internal bill is dropped, including one whose cost side failed to
   * write: it is still not an external sale.
   *
   * EXPENSE SIDE — one row per bill item, in whichever table matches the
   * product's category. `internal_transfers` is the join table:
   *
   *   target_type   | table            | key matched against
   *   ------------- | ---------------- | ----------------------------------
   *   'medicine'    | medicine_entries | entry_id
   *   'feed'        | feed_entries     | entry_id
   *   'vaccination' | vaccinations     | vaccination_id
   *   'expense'     | expenses         | expense_id
   *   NULL (legacy) | expenses         | expense_id
   *
   * `target_type` and `reference_id` were added by ALTER after the feature
   * shipped, so rows written before that carry only `expense_id`. Both
   * cleanup paths in the app resolve this as
   * `target_type || (expense_id ? 'expense' : null)` and
   * `reference_id || expense_id` — matched here by
   * `COALESCE(it.reference_id, it.expense_id)`.
   *
   * BELT AND BRACES — `medicine_entries`, `feed_entries` and `vaccinations`
   * also store the originating `bill_id`, and nothing but the internal-transfer
   * paths ever writes it. Those three are therefore excluded on EITHER the
   * reference-id match OR a `bill_id` pointing at an internal bill, so a row
   * whose `internal_transfers` record was lost (there are no transactions —
   * `cleanupInternalTransfers()` deletes the join rows and re-inserts, and a
   * crash between the two orphans them) is still eliminated. `expenses` has no
   * `bill_id` column, so it can only be matched through the join table.
   *
   * RETURNS — `sales-returns.component.ts` does not post reversing entries. It
   * deletes the cost rows, re-creates them at the reduced quantity, and edits
   * `bills.total_amount` in place. So the live rows already reflect all returns
   * and nothing extra needs subtracting on either side. The one wrinkle: the
   * rebuilt cost rows are dated `returnDate`, not the original bill date, so a
   * returned transfer's two sides can land in different periods — that is what
   * the balance warning above detects.
   */
  private internalBillIdsSql(): string {
    return `SELECT b.bill_id FROM bills b
            WHERE b.farm_id = ? AND COALESCE(b.payment_type, 'cash') = 'internal'`;
  }

  /** Ids in `target_type`'s table that came from an internal transfer. Params: farmId, targetType. */
  private internalRefIdsSql(): string {
    return `SELECT COALESCE(it.reference_id, it.expense_id) AS ref_id
            FROM internal_transfers it
            JOIN bills b ON b.bill_id = it.bill_id
            WHERE b.farm_id = ? AND it.target_type = ?
              AND COALESCE(it.reference_id, it.expense_id) IS NOT NULL`;
  }

  /**
   * `expenses.expense_id` values that came from an internal transfer. Covers
   * both the legacy shape (expense_id only, target_type NULL) and the current
   * one (target_type = 'expense', reference_id set). Params: farmId, farmId.
   */
  private internalExpenseIdsSql(): string {
    return `SELECT it.expense_id AS ref_id
            FROM internal_transfers it
            JOIN bills b ON b.bill_id = it.bill_id
            WHERE b.farm_id = ? AND it.expense_id IS NOT NULL
            UNION
            SELECT it.reference_id AS ref_id
            FROM internal_transfers it
            JOIN bills b ON b.bill_id = it.bill_id
            WHERE b.farm_id = ? AND it.target_type = 'expense' AND it.reference_id IS NOT NULL`;
  }

  // ── Revenue queries ──────────────────────────────────────────────────────
  //
  // Revenue is taken from the sale tables themselves plus any income row that
  // is NOT a mirror of one. `sale.component.ts`, `egg-sales.component.ts` and
  // `hen-sales.component.ts` each upsert a copy of their sales into `income`
  // tagged source = 'sale' / 'egg_sale' / 'hen_sale'; counting both would
  // double the revenue. (`layer-report.component.ts` filters out 'egg_sale'
  // but not 'hen_sale', so its own summary double-counts hen sales. This
  // service excludes both.)

  private qBroilerSales(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId];
    const sql =
      `SELECT f.unit_id AS unit_id,
              COALESCE(SUM(s.total_amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN COALESCE(s.payment_type,'cash') <> 'bank'
                                THEN s.total_amount ELSE 0 END), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM sales s
       JOIN flocks f ON f.flock_id = s.flock_id
       WHERE f.farm_id = ? AND COALESCE(s.module_type,'broiler') = 'broiler'` +
      this.dateClause('s.date', range, params) +
      ` GROUP BY f.unit_id`;
    return [sql, params];
  }

  private qEggSales(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId];
    const sql =
      `SELECT b.unit_id AS unit_id,
              COALESCE(SUM(es.total_amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN COALESCE(es.payment_type,'cash') <> 'bank'
                                THEN es.total_amount ELSE 0 END), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM egg_sales es
       JOIN batches b ON b.batch_id = es.batch_id
       WHERE b.farm_id = ?` +
      this.dateClause('es.date', range, params) +
      ` GROUP BY b.unit_id`;
    return [sql, params];
  }

  private qHenSales(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId];
    const sql =
      `SELECT b.unit_id AS unit_id,
              COALESCE(SUM(hs.total_amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN COALESCE(hs.payment_type,'cash') <> 'bank'
                                THEN hs.total_amount ELSE 0 END), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM hen_sales hs
       JOIN batches b ON b.batch_id = hs.batch_id
       WHERE b.farm_id = ?` +
      this.dateClause('hs.date', range, params) +
      ` GROUP BY b.unit_id`;
    return [sql, params];
  }

  private qBroilerIncome(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId];
    const sql =
      `SELECT f.unit_id AS unit_id,
              COALESCE(SUM(i.amount), 0) AS amount,
              COALESCE(SUM(i.amount), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM income i
       JOIN flocks f ON f.flock_id = i.flock_id
       WHERE f.farm_id = ? AND COALESCE(i.module_type,'broiler') = 'broiler'
         AND COALESCE(i.source,'manual') <> 'sale'` +
      this.dateClause('i.date', range, params) +
      ` GROUP BY f.unit_id`;
    return [sql, params];
  }

  private qLayerIncome(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId];
    const sql =
      `SELECT b.unit_id AS unit_id,
              COALESCE(SUM(i.amount), 0) AS amount,
              COALESCE(SUM(i.amount), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM income i
       JOIN batches b ON b.batch_id = i.flock_id
       WHERE b.farm_id = ? AND i.module_type = 'layer'
         AND COALESCE(i.source,'manual') NOT IN ('egg_sale','hen_sale')` +
      this.dateClause('i.date', range, params) +
      ` GROUP BY b.unit_id`;
    return [sql, params];
  }

  /** External distribution sales. Internal bills are dropped here. */
  private qDistributionBills(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId];
    const sql =
      `SELECT COALESCE(SUM(bl.total_amount), 0) AS amount,
              COALESCE(SUM(bl.amount_paid), 0) AS paid_amount,
              COALESCE(SUM(CASE WHEN COALESCE(bl.payment_type,'cash') = 'cash'
                                THEN bl.amount_paid ELSE 0 END), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM bills bl
       WHERE bl.farm_id = ? AND COALESCE(bl.payment_type,'cash') <> 'internal'` +
      this.dateClause('bl.bill_date', range, params);
    return [sql, params];
  }

  /** The revenue side that was eliminated — diagnostic only. */
  private qInternalBills(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId];
    const sql =
      `SELECT COALESCE(SUM(bl.total_amount), 0) AS amount,
              0 AS cash_amount,
              COUNT(*) AS row_count
       FROM bills bl
       WHERE bl.farm_id = ? AND COALESCE(bl.payment_type,'cash') = 'internal'` +
      this.dateClause('bl.bill_date', range, params);
    return [sql, params];
  }

  // ── Expense queries ──────────────────────────────────────────────────────

  private qExpenses(farmId: number, range: OverviewDateRange, module: 'broiler' | 'layer'): [string, any[]] {
    const layer = module === 'layer';
    // Shared table: flock_id holds a batch_id when module_type = 'layer'.
    const join = layer
      ? 'JOIN batches u ON u.batch_id = e.flock_id'
      : 'JOIN flocks u ON u.flock_id = e.flock_id';
    const moduleWhere = layer
      ? `e.module_type = 'layer'`
      : `COALESCE(e.module_type,'broiler') = 'broiler'`;

    const params: any[] = [farmId, farmId, farmId];
    const sql =
      `SELECT u.unit_id AS unit_id,
              COALESCE(SUM(e.amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN COALESCE(e.payment_type,'cash') <> 'bank'
                                THEN e.amount ELSE 0 END), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM expenses e
       ${join}
       WHERE u.farm_id = ? AND ${moduleWhere}
         AND e.expense_id NOT IN (${this.internalExpenseIdsSql()})` +
      this.dateClause('e.date', range, params) +
      ` GROUP BY u.unit_id`;
    return [sql, params];
  }

  /** medicine_entries / feed_entries share a shape, so share a builder. */
  private qTraderEntries(
    farmId: number,
    range: OverviewDateRange,
    module: 'broiler' | 'layer',
    kind: 'medicine' | 'feed'
  ): [string, any[]] {
    const layer = module === 'layer';
    const table = kind === 'medicine' ? 'medicine_entries' : 'feed_entries';
    const join = layer
      ? 'JOIN batches u ON u.batch_id = t.flock_id'
      : 'JOIN flocks u ON u.flock_id = t.flock_id';
    const moduleWhere = layer
      ? `t.module_type = 'layer'`
      : `COALESCE(t.module_type,'broiler') = 'broiler'`;

    const params: any[] = [farmId, farmId, kind, farmId];
    const sql =
      `SELECT u.unit_id AS unit_id,
              COALESCE(SUM(t.total_amount), 0) AS amount,
              COALESCE(SUM(t.total_amount), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM ${table} t
       ${join}
       WHERE u.farm_id = ? AND ${moduleWhere}
         AND t.entry_id NOT IN (${this.internalRefIdsSql()})
         AND COALESCE(t.bill_id, 0) NOT IN (${this.internalBillIdsSql()})` +
      this.dateClause('t.date', range, params) +
      ` GROUP BY u.unit_id`;
    return [sql, params];
  }

  /**
   * `vaccinations` serves both modules off two nullable columns. A row that
   * somehow carries both is attributed to layer only, so it cannot be counted
   * twice.
   */
  private qVaccinations(farmId: number, range: OverviewDateRange, module: 'broiler' | 'layer'): [string, any[]] {
    const layer = module === 'layer';
    const join = layer
      ? 'JOIN batches u ON u.batch_id = v.batch_id'
      : 'JOIN flocks u ON u.flock_id = v.flock_id';
    const moduleWhere = layer ? 'v.batch_id IS NOT NULL' : 'v.batch_id IS NULL AND v.flock_id IS NOT NULL';

    const params: any[] = [farmId, farmId, 'vaccination', farmId];
    const sql =
      `SELECT u.unit_id AS unit_id,
              COALESCE(SUM(v.cost), 0) AS amount,
              COALESCE(SUM(v.cost), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM vaccinations v
       ${join}
       WHERE u.farm_id = ? AND ${moduleWhere}
         AND v.vaccination_id NOT IN (${this.internalRefIdsSql()})
         AND COALESCE(v.bill_id, 0) NOT IN (${this.internalBillIdsSql()})` +
      this.dateClause('v.date', range, params) +
      ` GROUP BY u.unit_id`;
    return [sql, params];
  }

  private qLabour(farmId: number, range: OverviewDateRange, module: 'broiler' | 'layer'): [string, any[]] {
    const layer = module === 'layer';
    const join = layer
      ? 'JOIN batches u ON u.batch_id = lp.flock_id'
      : 'JOIN flocks u ON u.flock_id = lp.flock_id';
    const moduleWhere = layer
      ? `lp.module_type = 'layer'`
      : `COALESCE(lp.module_type,'broiler') = 'broiler'`;

    const params: any[] = [farmId];
    const sql =
      `SELECT u.unit_id AS unit_id,
              COALESCE(SUM(lp.amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN COALESCE(lp.payment_type,'cash') <> 'bank'
                                THEN lp.amount ELSE 0 END), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM labour_payments lp
       ${join}
       WHERE u.farm_id = ? AND ${moduleWhere}` +
      this.dateClause('lp.date', range, params) +
      ` GROUP BY u.unit_id`;
    return [sql, params];
  }

  /**
   * Broiler-only — `ledgers` hang off `flocks`. Debits sourced from the
   * expenses screen are skipped because `expenses` already counts them;
   * same guard as `report.component.ts`. Ledger debits are obligations, not
   * payments, so they contribute nothing to the cash figure.
   */
  private qLedgerDebits(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId];
    const sql =
      `SELECT f.unit_id AS unit_id,
              COALESCE(SUM(le.amount), 0) AS amount,
              0 AS cash_amount,
              COUNT(*) AS row_count
       FROM ledger_entries le
       JOIN flocks f ON f.flock_id = le.flock_id
       WHERE f.farm_id = ? AND le.type = 'debit'
         AND COALESCE(le.source,'manual') <> 'expense'` +
      this.dateClause('le.date', range, params) +
      ` GROUP BY f.unit_id`;
    return [sql, params];
  }

  /**
   * Fallback purchase rate per product, as a CTE body. Consumes ONE `?` (farm_id).
   *
   * `products.cost_price` alone is not dependable: `inventory.component.ts` is
   * the only writer, so it is whatever was last typed by hand and purchase
   * orders never refresh it. The chain falls through to the weighted-average
   * rate across that product's purchase orders, then to its most recent batch
   * that carries a price. Products that come up empty on all three rate 0, and
   * whatever they cost is reported as uncosted rather than buried.
   */
  private productRateCte(): string {
    return `SELECT p.product_id AS product_id,
                   COALESCE(
                     NULLIF(p.cost_price, 0),
                     NULLIF((SELECT CASE WHEN COALESCE(SUM(po.quantity), 0) > 0
                                         THEN SUM(po.total_amount) / SUM(po.quantity)
                                         ELSE 0 END
                             FROM purchase_orders po
                             WHERE po.product_id = p.product_id AND po.farm_id = p.farm_id), 0),
                     NULLIF((SELECT pb.purchase_price
                             FROM product_batches pb
                             WHERE pb.product_id = p.product_id AND pb.farm_id = p.farm_id
                               AND COALESCE(pb.purchase_price, 0) > 0
                             ORDER BY pb.batch_id DESC LIMIT 1), 0),
                     0) AS unit_cost
            FROM products p
            WHERE p.farm_id = ?`;
  }

  /**
   * COST OF GOODS SOLD for the distribution module — the purchase cost of the
   * stock that actually left on the period's bills.
   *
   * `sales-orders.component.ts` deducts stock oldest-expiry-first and writes one
   * `batch_transactions` row per batch it draws from (`type = 'sale'`,
   * `reference_id = bills.bill_id`); the rate is `purchase_price` on the batch
   * that row points at. Stock coming back is `type = 'return'` and is netted
   * off, otherwise an edited bill charges its goods twice — a bill edit posts a
   * `return` and then re-deducts a fresh `sale`.
   *
   * `return` rows overload `reference_id`: `restoreBillStock()` puts a
   * `bills.bill_id` there, `restoreReturnedStock()` puts a
   * `sales_returns.return_id`. Both id spaces start at 1, so the join also
   * requires the note to start with that return's `return_number` — which the
   * sales-return path always writes and the bill-edit path ("Restored from
   * deleted/edited sale") never does.
   *
   * `type = 'purchase'` and `type = 'adjustment'` are excluded deliberately:
   * adjustments are stock leaving for a purchase edit, a purchase return or a
   * batch deletion. None of it sold, so none of it is a cost of sales.
   *
   * Sales returns need no further handling — `sales-returns.component.ts`
   * rewrites `bills.total_amount` in place as well as posting the `return`
   * rows, so both revenue and cost already net out.
   *
   * Units on `bill_items` that no priced batch draw covers — bills predating
   * the batch module, batches saved with `purchase_price = 0`, or a FIFO walk
   * that ran out of stock — are re-priced at `productRateCte()`'s fallback
   * rather than left at zero, which would overstate profit. Whatever is still
   * uncosted after that is returned as `uncosted_qty` and warned about.
   *
   * Internal bills are INCLUDED here, even though `qDistributionBills()` drops
   * them from revenue. Goods transferred to a flock or batch were genuinely
   * consumed by the business; `eliminateInternalRows()` removes the mirrored
   * broiler/layer cost row (which stands at the bill's selling price), so the
   * purchase cost has to remain or the transfer would cost the account nothing.
   *
   * `cash_amount` is 0: no cash moves when stock sells, it moved when the stock
   * was bought. The cash statement keeps using `qPurchases()` for that.
   *
   * Batch draws against a bill with no surviving `bill_items` line are not
   * picked up. A fully returned bill nets to roughly zero anyway, so the
   * omission is immaterial and this stays a single grouped query.
   */
  private qDistributionCogs(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId, farmId, farmId, farmId, farmId];
    const sql =
      `WITH tx AS (
         SELECT bt.reference_id AS bill_id,
                bt.product_id   AS product_id,
                bt.quantity     AS net_qty,
                CASE WHEN COALESCE(pb.purchase_price, 0) > 0
                     THEN bt.quantity * pb.purchase_price ELSE 0 END AS priced_cost,
                CASE WHEN COALESCE(pb.purchase_price, 0) > 0
                     THEN 0 ELSE bt.quantity END AS unpriced_qty
         FROM batch_transactions bt
         JOIN product_batches pb ON pb.batch_id = bt.batch_id
         WHERE pb.farm_id = ? AND bt.type = 'sale' AND bt.reference_id IS NOT NULL

         UNION ALL

         SELECT COALESCE(sr.bill_id, bt.reference_id) AS bill_id,
                bt.product_id   AS product_id,
                -bt.quantity    AS net_qty,
                CASE WHEN COALESCE(pb.purchase_price, 0) > 0
                     THEN -(bt.quantity * pb.purchase_price) ELSE 0 END AS priced_cost,
                CASE WHEN COALESCE(pb.purchase_price, 0) > 0
                     THEN 0 ELSE -bt.quantity END AS unpriced_qty
         FROM batch_transactions bt
         JOIN product_batches pb ON pb.batch_id = bt.batch_id
         LEFT JOIN sales_returns sr
                ON sr.return_id = bt.reference_id
               AND sr.farm_id = ?
               AND bt.notes LIKE sr.return_number || '%'
         WHERE pb.farm_id = ? AND bt.type = 'return' AND bt.reference_id IS NOT NULL
       ),
       drawn AS (
         SELECT bill_id, product_id,
                SUM(net_qty)      AS net_qty,
                SUM(priced_cost)  AS priced_cost,
                SUM(unpriced_qty) AS unpriced_qty
         FROM tx
         GROUP BY bill_id, product_id
       ),
       rate AS (
         ${this.productRateCte()}
       ),
       sold AS (
         SELECT bi.bill_id AS bill_id, bi.product_id AS product_id,
                COALESCE(SUM(bi.quantity), 0) AS qty
         FROM bill_items bi
         JOIN bills b ON b.bill_id = bi.bill_id
         WHERE b.farm_id = ?` + this.dateClause('b.bill_date', range, params) + `
         GROUP BY bi.bill_id, bi.product_id
       )
       SELECT COALESCE(SUM(
                COALESCE(d.priced_cost, 0)
                + (MAX(COALESCE(d.unpriced_qty, 0), 0)
                   + MAX(s.qty - COALESCE(d.net_qty, 0), 0)) * COALESCE(r.unit_cost, 0)
              ), 0) AS amount,
              0 AS cash_amount,
              COALESCE(SUM(
                CASE WHEN COALESCE(r.unit_cost, 0) > 0 THEN 0
                     ELSE MAX(COALESCE(d.unpriced_qty, 0), 0)
                          + MAX(s.qty - COALESCE(d.net_qty, 0), 0) END
              ), 0) AS uncosted_qty,
              COUNT(*) AS row_count
       FROM sold s
       LEFT JOIN drawn d
              ON d.bill_id = s.bill_id
             AND (d.product_id = s.product_id
                  OR (d.product_id IS NULL AND s.product_id IS NULL))
       LEFT JOIN rate r ON r.product_id = s.product_id`;
    return [sql, params];
  }

  /**
   * Distribution stock on hand, valued at what it cost to buy — the asset the
   * purchases turned into, and the reason a large purchase figure is not a loss.
   *
   * Same stock filter `DatabaseService.getTotalStock()` applies (quantity left,
   * not past expiry) so value and quantity describe the same stock. Batches with
   * no recorded price fall back to `productRateCte()`, matching how
   * `qDistributionCogs()` prices the same units.
   *
   * `range` is ignored: `product_batches` carries a live quantity and no
   * movement history to rewind, so this can only ever be "as at now".
   */
  private qInventoryOnHand(farmId: number): [string, any[]] {
    const params: any[] = [farmId, farmId];
    const sql =
      `WITH rate AS (
         ${this.productRateCte()}
       )
       SELECT COALESCE(SUM(CASE WHEN COALESCE(pb.purchase_price, 0) > 0
                                THEN pb.quantity * pb.purchase_price
                                ELSE pb.quantity * COALESCE(r.unit_cost, 0) END), 0) AS amount,
              0 AS cash_amount,
              COALESCE(SUM(CASE WHEN COALESCE(pb.purchase_price, 0) > 0
                                THEN 0 ELSE pb.quantity END), 0) AS unpriced_qty,
              COUNT(*) AS row_count
       FROM product_batches pb
       LEFT JOIN rate r ON r.product_id = pb.product_id
       WHERE pb.farm_id = ? AND pb.quantity > 0 AND pb.expiry_date >= date('now')`;
    return [sql, params];
  }

  private qPurchases(farmId: number, range: OverviewDateRange): [string, any[]] {

    const params: any[] = [farmId];
    const sql =
      `SELECT COALESCE(SUM(po.total_amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN COALESCE(po.payment_type,'cash') <> 'bank'
                                THEN po.total_amount ELSE 0 END), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM purchase_orders po
       WHERE po.farm_id = ?` +
      this.dateClause('po.date', range, params);
    return [sql, params];
  }

  private qPurchaseReturns(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId];
    const sql =
      `SELECT COALESCE(SUM(pr.return_amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN COALESCE(pr.refund_method,'cash') <> 'bank'
                                THEN pr.return_amount ELSE 0 END), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM purchase_returns pr
       WHERE pr.farm_id = ?` +
      this.dateClause('pr.return_date', range, params);
    return [sql, params];
  }

  private qDistributionExpenses(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId];
    const sql =
      `SELECT COALESCE(SUM(el.amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN COALESCE(el.payment_type,'cash') <> 'bank'
                                THEN el.amount ELSE 0 END), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM expense_ledger el
       WHERE el.farm_id = ?` +
      this.dateClause('el.transaction_date', range, params);
    return [sql, params];
  }

  /**
   * The broiler/layer cost rows that were eliminated — diagnostic only, so the
   * dashboard can show what cancelled and the balance check above has both
   * sides to compare.
   */
  private qInternalExpenseSide(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [];

    const expensesParams: any[] = [farmId, farmId];
    const expensesSql =
      `SELECT e.amount AS amt FROM expenses e
       WHERE e.expense_id IN (${this.internalExpenseIdsSql()})` +
      this.dateClause('e.date', range, expensesParams);

    const medicineParams: any[] = [farmId, 'medicine', farmId];
    const medicineSql =
      `SELECT me.total_amount AS amt FROM medicine_entries me
       WHERE (me.entry_id IN (${this.internalRefIdsSql()})
              OR COALESCE(me.bill_id, 0) IN (${this.internalBillIdsSql()}))` +
      this.dateClause('me.date', range, medicineParams);

    const feedParams: any[] = [farmId, 'feed', farmId];
    const feedSql =
      `SELECT fe.total_amount AS amt FROM feed_entries fe
       WHERE (fe.entry_id IN (${this.internalRefIdsSql()})
              OR COALESCE(fe.bill_id, 0) IN (${this.internalBillIdsSql()}))` +
      this.dateClause('fe.date', range, feedParams);

    const vaccParams: any[] = [farmId, 'vaccination', farmId];
    const vaccSql =
      `SELECT v.cost AS amt FROM vaccinations v
       WHERE (v.vaccination_id IN (${this.internalRefIdsSql()})
              OR COALESCE(v.bill_id, 0) IN (${this.internalBillIdsSql()}))` +
      this.dateClause('v.date', range, vaccParams);

    params.push(...expensesParams, ...medicineParams, ...feedParams, ...vaccParams);

    const sql =
      `SELECT COALESCE(SUM(amt), 0) AS amount, 0 AS cash_amount, COUNT(*) AS row_count
       FROM (
         ${expensesSql}
         UNION ALL
         ${medicineSql}
         UNION ALL
         ${feedSql}
         UNION ALL
         ${vaccSql}
       )`;
    return [sql, params];
  }

  // ── Asset / personal queries ─────────────────────────────────────────────

  /** Sold assets only — this app books no depreciation, so gain is realised on sale. */
  private qAssetsRealised(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId];
    const sql =
      `SELECT a.unit_id AS unit_id,
              COALESCE(SUM(COALESCE(a.sale_amount,0) - COALESCE(a.purchase_amount,0)), 0) AS amount,
              COALESCE(SUM(COALESCE(a.sale_amount,0)), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM assets a
       WHERE a.farm_id = ? AND COALESCE(a.status,'active') = 'sold'` +
      this.dateClause('a.sale_date', range, params) +
      ` GROUP BY a.unit_id`;
    return [sql, params];
  }

  /**
   * Assets still held. This is a stock, not a flow, so only the upper bound of
   * the range applies — "what was owned as at range.to".
   */
  private qAssetsActive(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId];
    const sql =
      `SELECT a.unit_id AS unit_id,
              COALESCE(SUM(a.purchase_amount), 0) AS amount,
              0 AS cash_amount,
              COUNT(*) AS row_count
       FROM assets a
       WHERE a.farm_id = ? AND COALESCE(a.status,'active') = 'active'` +
      this.dateClause('a.purchase_date', { to: range.to }, params) +
      ` GROUP BY a.unit_id`;
    return [sql, params];
  }

  /** Every asset bought in the range, sold or not — the cash that went out. */
  private qAssetPurchases(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId];
    const sql =
      `SELECT COALESCE(SUM(a.purchase_amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN COALESCE(a.payment_source,'cash') <> 'bank'
                                THEN a.purchase_amount ELSE 0 END), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM assets a
       WHERE a.farm_id = ?` +
      this.dateClause('a.purchase_date', range, params);
    return [sql, params];
  }

  /**
   * Owner's drawings. Not a business expense — it sits below the profit line,
   * which is why it is subtracted from profit rather than added to expenses.
   */
  private qPersonalExpenses(farmId: number, range: OverviewDateRange): [string, any[]] {
    const params: any[] = [farmId];
    const sql =
      `SELECT COALESCE(SUM(pe.amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN COALESCE(pe.payment_source,'cash') <> 'bank'
                                THEN pe.amount ELSE 0 END), 0) AS cash_amount,
              COUNT(*) AS row_count
       FROM personal_expenses pe
       WHERE pe.farm_id = ?` +
      this.dateClause('pe.date', range, params);
    return [sql, params];
  }

  // ── Loaders ──────────────────────────────────────────────────────────────

  private async loadUnits(farmId: number, warnings: string[]): Promise<any[]> {
    const res = await this.db.get(
      `SELECT unit_id, unit_name, module_type FROM farm_units
       WHERE farm_id = ? ORDER BY module_type ASC, unit_name ASC`,
      [farmId]
    );
    if (!res?.success) {
      warnings.push('Could not load farms: ' + (res?.error || 'unknown error'));
      return [];
    }
    return res.data || [];
  }

  /**
   * Own bank accounts only. `bank_accounts` rows with a `customer_id` belong to
   * a customer and are used to settle their receivable — they are not the
   * business's money.
   *
   * `addBankLedgerEntry()` posts the opening balance as a ledger debit, so the
   * ledger is self-contained: balance = SUM(debit) - SUM(credit). Computing it
   * that way (rather than reading `current_balance`) is what makes the figure
   * respect `range.to`; `currentBalance` is returned alongside so the dashboard
   * can flag a drift between the two.
   */
  private async loadBankAccounts(
    farmId: number,
    range: OverviewDateRange,
    warnings: string[]
  ): Promise<OverviewBank> {
    const params: any[] = [];
    const ledgerParams: any[] = [];
    const asOf = this.dateClause('bl.transaction_date', { to: range.to }, ledgerParams);
    params.push(...ledgerParams, farmId);

    const res = await this.db.get(
      `SELECT ba.bank_id, ba.bank_name, ba.account_number, ba.current_balance,
              COALESCE((SELECT SUM(bl.debit - bl.credit) FROM bank_ledger bl
                        WHERE bl.bank_id = ba.bank_id${asOf}), 0) AS balance
       FROM bank_accounts ba
       WHERE ba.farm_id = ? AND ba.customer_id IS NULL
       ORDER BY ba.bank_name ASC`,
      params
    );

    if (!res?.success) {
      warnings.push('Could not load bank balances: ' + (res?.error || 'unknown error'));
      return { accounts: [], total: 0 };
    }

    const accounts: OverviewBankAccount[] = (res.data || []).map((r: any) => ({
      bank_id: r.bank_id,
      bank_name: r.bank_name,
      account_number: r.account_number ?? null,
      balance: this.num(r.balance),
      currentBalance: this.num(r.current_balance)
    }));

    return {
      accounts,
      total: accounts.reduce((s, a) => s + a.balance, 0)
    };
  }

  // ── Per-farm assembly ────────────────────────────────────────────────────

  /**
   * Profit per `farm_units` row. Flocks and batches with no `unit_id` — every
   * record created before step 4 added the column — fall into an "Unassigned"
   * bucket per module rather than being dropped. Distribution is farm-level
   * with no unit at all, so it gets its own row.
   */
  private buildPerFarm(
    units: any[],
    parts: {
      broilerRevenue: UnitRow[][];
      layerRevenue: UnitRow[][];
      broilerExpenses: UnitRow[][];
      layerExpenses: UnitRow[][];
    },
    distributionRevenue: number,
    distributionExpenses: number
  ): OverviewFarmProfit[] {
    const buckets = new Map<string, OverviewFarmProfit>();

    const key = (module: ModuleKey, unitId: number | null) => `${module}:${unitId ?? 'none'}`;

    const bucket = (module: ModuleKey, unitId: number | null): OverviewFarmProfit => {
      const k = key(module, unitId);
      let b = buckets.get(k);
      if (!b) {
        const unit = unitId != null ? units.find(u => u.unit_id === unitId) : null;
        b = {
          unitId,
          unitName: unit?.unit_name || (unitId != null ? `Farm #${unitId}` : 'Unassigned'),
          moduleType: module,
          revenue: 0,
          expenses: 0,
          profit: 0
        };
        buckets.set(k, b);
      }
      return b;
    };

    // Seed every known unit so a farm with no activity still shows as zero
    // rather than silently vanishing from the dashboard.
    for (const u of units) {
      const module: ModuleKey = u.module_type === 'layer' ? 'layer' : 'broiler';
      bucket(module, u.unit_id);
    }

    const apply = (groups: UnitRow[][], module: ModuleKey, field: 'revenue' | 'expenses') => {
      for (const rows of groups) {
        for (const row of rows) {
          bucket(module, row.unitId)[field] += row.amount;
        }
      }
    };

    apply(parts.broilerRevenue, 'broiler', 'revenue');
    apply(parts.layerRevenue, 'layer', 'revenue');
    apply(parts.broilerExpenses, 'broiler', 'expenses');
    apply(parts.layerExpenses, 'layer', 'expenses');

    if (distributionRevenue !== 0 || distributionExpenses !== 0) {
      const dist = bucket('distribution', null);
      dist.unitName = 'Distribution';
      dist.revenue += distributionRevenue;
      dist.expenses += distributionExpenses;
    }

    const out = Array.from(buckets.values());
    for (const b of out) b.profit = b.revenue - b.expenses;

    return out.sort((a, b) => b.profit - a.profit);
  }

  // ── Plumbing ─────────────────────────────────────────────────────────────

  /**
   * Appends the range predicates and pushes their params. `column` is always a
   * literal from this file — never user input — so interpolating it is safe;
   * the bounds themselves go in as `?` params.
   */
  private dateClause(column: string, range: OverviewDateRange, params: any[]): string {
    let sql = '';
    if (range.from) { sql += ` AND ${column} >= ?`; params.push(range.from); }
    if (range.to) { sql += ` AND ${column} <= ?`; params.push(range.to); }
    return sql;
  }

  /** Runs a grouped query. `db.get()` reports failure in `.success`, it does not throw. */
  private async unitRows([sql, params]: [string, any[]], warnings: string[]): Promise<UnitRow[]> {
    const res = await this.db.get(sql, params);
    if (!res?.success) {
      warnings.push('Consolidation query failed: ' + (res?.error || 'unknown error'));
      return [];
    }
    return (res.data || []).map((r: any) => ({
      unitId: r.unit_id ?? null,
      amount: this.num(r.amount),
      cashAmount: this.num(r.cash_amount),
      rowCount: this.num(r.row_count)
    }));
  }

  /** Runs an ungrouped aggregate and returns its single row (empty on failure). */
  private async scalarRow([sql, params]: [string, any[]], warnings: string[]): Promise<Record<string, any>> {
    const res = await this.db.get(sql, params);
    if (!res?.success) {
      warnings.push('Consolidation query failed: ' + (res?.error || 'unknown error'));
      return {};
    }
    return (res.data && res.data[0]) || {};
  }

  private sum(rows: UnitRow[]): number {
    return rows.reduce((s, r) => s + r.amount, 0);
  }

  private cash(rows: UnitRow[]): number {
    return rows.reduce((s, r) => s + r.cashAmount, 0);
  }

  private count(rows: UnitRow[]): number {
    return rows.reduce((s, r) => s + r.rowCount, 0);
  }

  private num(value: any): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  private emptySummary(range: OverviewDateRange, warnings: string[]): OverviewSummary {
    return {
      basis: 'accrual',
      basisLabel: BASIS_LABEL,
      range,
      revenue: { total: 0, broiler: 0, layer: 0, distribution: 0, distributionCollected: 0 },
      expenses: {
        total: 0, general: 0, medicine: 0, feed: 0, vaccination: 0, labour: 0,
        ledgerDebits: 0, costOfGoodsSold: 0, purchases: 0, purchaseReturns: 0,
        distributionExpenses: 0,
        byModule: { broiler: 0, layer: 0, distribution: 0 }
      },
      inventory: { value: 0, unpricedUnits: 0 },
      businessNetProfit: 0,
      personalWithdrawals: 0,
      netPosition: 0,
      assets: { realisedGainLoss: 0, soldCount: 0, activeValue: 0, activeCount: 0 },
      bank: { accounts: [], total: 0 },
      cash: { inflow: 0, outflow: 0, net: 0, note: CASH_NOTE },
      perFarm: [],
      internalTransfers: { billCount: 0, revenueExcluded: 0, expenseExcluded: 0, expenseRowCount: 0 },
      warnings
    };
  }
}
