# Talha Farm

Poultry farm management desktop app. Angular 19 (standalone components, no NgModules) rendered
inside Electron 34, persisting to a SQLite file via **sql.js** (SQLite compiled to WASM).

## Build & run

```bash
ng build                      # Angular -> dist/Poultry-Farm/browser
npm run electron              # ng build && electron .
npm run electron:dev          # electron . only (reuses existing dist/)
npm run electron:build:win    # build + electron-builder --win --x64 -> release/
```

`main.js` loads `dist/Poultry-Farm/browser/index.html` from disk — there is no dev-server wiring,
so **the Angular build must be current before launching Electron**. `ng serve` alone gives you a
renderer with no `window.electronAPI`, so nothing loads.

The DB file lives at `app.getPath('userData')/sng_farm.db`, not in the repo.

## Architecture

```
electron/main.js       owns the app lifecycle + every ipcMain handler; also holds
                       licensing, auto-backup-on-quit, backup/restore, PDF print
electron/database.js   sql.js init, full schema (createTables), migrations,
                       runQuery/getQuery, plus a large set of helper query functions
electron/preload.js    contextBridge -> window.electronAPI  (the ONLY renderer<->main bridge)
src/app/shared/services/database.service.ts
                       Angular wrapper over window.electronAPI; every call is
                       resolved inside NgZone.run() so change detection fires
```

The main process owns the database. The renderer has no direct DB access; `contextIsolation: true`
and `nodeIntegration: false`. Anything new the renderer needs must be added in **all three** places:
an `ipcMain.handle` in `main.js`, a method on the `contextBridge` object in `preload.js`, and a
wrapper in `database.service.ts` (plus the `Window.electronAPI` interface declared at its top).

### SQL goes over the wire

There is no ORM and no repository layer. The renderer builds **raw SQL strings** and ships them to
`db-run` / `db-get`. Components call `this.db.run(sql, params)` and `this.db.get(sql, params)`
directly, all over the app.

- Always use `?` placeholders and pass values in the params array. Never string-interpolate values
  into SQL — the renderer is fully trusted by the main process, so an interpolated value is a real
  injection into the user's data.
- `get()` returns `{ success, data: rows[] }`; `run()` returns `{ success, lastId }`. Check
  `.success` — errors come back as `{ success: false, error }`, they do not throw.
- Every `runQuery` writes the whole DB back to disk with `db.export()` + `writeFileSync`. Writes are
  therefore expensive; avoid per-row loops of `run()` where one statement will do.
- `lastId` for INSERTs uses `last_insert_rowid()` with a `MAX(pk)` fallback driven by
  `PRIMARY_KEY_MAP` in `database.js`. Add new tables to that map or `lastId` comes back `null`.

## Multi-tenancy and module scoping

`farms` is the **login account**, not a physical farm. Login is farm_name + password against
`farms` (`auth.service.ts`), and the row is cached in `localStorage.currentFarm`. Nearly every table
carries a `farm_id` — **every query must filter by it**, or one account sees another's data.

`farms.business_type` is `'broiler' | 'layer' | 'distribution' | 'all'`. It drives which sidebar menu
`layout.component.ts` renders; when it is `'all'`, the layout shows business tabs and switches
menus off `activeBusinessTab` (both persisted in `localStorage`).

Scoping differs per module — this is the main thing to get right:

| Module       | Scope key                          | Core tables                                                  |
|--------------|------------------------------------|--------------------------------------------------------------|
| Broiler      | `currentFlock.flock_id` (`flocks`) | expenses, ledgers, sales, income, balance, flock_health, brokers |
| Layer        | `batch_id` (`batches`)             | egg_collection, egg_sales, hen_sales, layer_mortality, vaccinations |
| Distribution | `farm_id`                          | products, product_batches, purchase_orders, sales_orders, bills, customers, suppliers, *_ledger |

`FlockService` (`currentFlock$`, backed by `localStorage.currentFlock`) holds the active
flock **or** batch; a batch is distinguished by the presence of `batch_id` on the object.

Shared tables (`feed_*`, `medicine_*`, `labour_payments`, `income`, `expenses`, `balance`) are used
by both broiler and layer, and they reuse the **`flock_id` column to hold a `batch_id` when
`module_type = 'layer'`**. Filtering by `flock_id` alone silently mixes broiler and layer rows —
always pair it with `module_type`. See `shared/resolvers/medicine.resolver.ts` for the pattern.

## Known landmines — do not repeat these

- **Migrations run on every launch.** `initializeDatabase()` in `electron/database.js` loops an
  `alterStatements` array with `try { db.run(sql) } catch(e) {}`. Duplicate-column errors are how it
  detects "already applied". Any statement added there **must be idempotent and safe to re-run**,
  because it will execute on every single app start.
- **Live bug: the `vaccinations` rebuild.** That same array contains a
  RENAME → CREATE → `INSERT...SELECT` → DROP rebuild of `vaccinations`. It is not guarded, so it
  re-runs on every launch, and its `INSERT...SELECT` copies only
  `(vaccination_id, batch_id, date, vaccine_name, dose, notes, done)` — dropping **`flock_id`,
  `cost`, `bill_id`, `bill_number`** each time. Broiler vaccination records lose their flock link and
  cost on restart. Do not copy this table-rebuild pattern; fix requires a guard, not another rebuild.
- **Foreign keys are declared but not enforced.** ~50 `FOREIGN KEY` clauses exist in the schema, but
  `PRAGMA foreign_keys = ON` is never issued, so SQLite leaves them off. Nothing cascades, including
  the `ON DELETE CASCADE` on `bill_items`. Deleting a parent row leaves orphans — child rows must be
  deleted explicitly in code (`batch-management.component.ts` already does this by hand).
- **There are no transactions anywhere.** No `BEGIN`/`COMMIT` in either process. Multi-step writes
  (bill + bill_items + ledger entry + stock update) can half-complete and leave inconsistent data.
- **Dates use `toISOString()`** in ~70 places, which converts to UTC. For PKT (UTC+5) any local time
  before 05:00 lands on the **previous day**, so records can be filed under the wrong date. New date
  handling should format from local components, not `toISOString().split('T')[0]`.
- **`flock_health.week_number` is misnamed.** It holds a 1-based **day** index (the UI labels it
  "Day"), not a week. A row's real calendar date is `flock.start_date + (week_number - 1) days` —
  derivable despite the table having no date column of its own.

Also worth knowing: passwords in `auth.service.ts` and license codes in `main.js` use a 32-bit
string hash, not a cryptographic one. The licensing scheme (`activation` table, machine id,
clock-tamper checks, 7-day cycles) is deliberate — leave it alone unless asked.

## Conventions

- Standalone components, lazy-loaded via `loadComponent` in `app.routes.ts`; all app screens are
  children of `/app` (`layout.component.ts`).
- Route resolvers in `shared/resolvers/` prefetch a screen's data before navigation.
- `FormStateService` persists in-progress form data in `localStorage` across navigation.
- Destructive actions go through `DeleteAuthService` + `delete-code-dialog` (a per-farm PIN stored
  in `app_settings` via the `get/setAppSetting` IPC).
- Reports are generated client-side with jsPDF and printed through the `print-pdf-base64` IPC.
- `.spec.ts` files exist from the CLI scaffold but there is no meaningful test suite.
