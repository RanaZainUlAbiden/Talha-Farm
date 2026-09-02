import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject, distinctUntilChanged } from 'rxjs';
import { DatabaseService } from './database.service';

@Injectable({
  providedIn: 'root'
})
export class FarmUnitService {

  private currentUnitSubject = new BehaviorSubject<any>(null);
  private unitsSubject = new BehaviorSubject<any[]>([]);
  private unitsChangedSubject = new Subject<void>();
  private moduleChangedSubject = new Subject<'broiler' | 'layer'>();

  // Compare on module_type too — unit_id alone isn't enough to tell two
  // units apart when the "current" and "next" unit belong to different
  // modules but a caller passes objects that otherwise look equal (e.g.
  // both null/undefined while switching between two modules that each
  // have zero units yet). Mirrors flock.service.ts's flock-vs-batch guard.
  currentUnit$ = this.currentUnitSubject.asObservable().pipe(
    distinctUntilChanged((a, b) => a?.unit_id === b?.unit_id && a?.module_type === b?.module_type)
  );

  units$ = this.unitsSubject.asObservable();

  // Emits whenever units are created/edited/deleted so the sidebar can
  // refresh its selector (wired up once step 3's CRUD screen exists).
  unitsChanged$ = this.unitsChangedSubject.asObservable();

  // Emits whenever the ACTIVE MODULE (broiler/layer) changes — business tab
  // switch or a business-type change — so screens that don't otherwise get
  // a fresh currentUnit$ emission (e.g. the new module also has zero units)
  // still know to reload for the new module.
  moduleChanged$ = this.moduleChangedSubject.asObservable();

  notifyUnitsChanged() {
    this.unitsChangedSubject.next();
  }

  notifyModuleChanged(moduleType: 'broiler' | 'layer') {
    this.moduleChangedSubject.next(moduleType);
  }

  constructor(private db: DatabaseService) {
    const stored = localStorage.getItem('currentUnit');
    if (stored) {
      try {
        this.currentUnitSubject.next(JSON.parse(stored));
      } catch {
        this.currentUnitSubject.next(null);
      }
    }
  }

  setCurrentUnit(unit: any) {
    if (unit === null) {
      this.currentUnitSubject.next(null);
      localStorage.removeItem('currentUnit');
      return;
    }
    const current = this.currentUnitSubject.value;
    if (current?.unit_id === unit?.unit_id && current?.module_type === unit?.module_type) return;
    this.currentUnitSubject.next(unit);
    localStorage.setItem('currentUnit', JSON.stringify(unit));
  }

  getCurrentUnit(): any {
    return this.currentUnitSubject.value;
  }

  async loadUnits(farmId: number, moduleType: string): Promise<any[]> {
    const result = await this.db.get(
      `SELECT * FROM farm_units WHERE farm_id = ? AND module_type = ? ORDER BY unit_id ASC`,
      [farmId, moduleType]
    );
    const units = result.success ? result.data : [];
    this.unitsSubject.next(units);

    const current = this.currentUnitSubject.value;
    const currentBelongsToOtherModule = current && current.module_type !== moduleType;

    // Only auto-select if truly nothing active.
    if (!current && units.length > 0) {
      this.setCurrentUnit(units[0]);
    }

    // If current belongs to another module, DON'T auto-select — let the
    // layout restore the right one from localStorage (lastBroilerUnitId /
    // lastLayerUnitId), same as flock.service.ts does for flocks vs batches.
    // Overwriting it here would reset the selection every time the user
    // switches business tabs and back.

    // If the active unit belongs to THIS module but was deleted, fall back
    // to the first available unit for this module.
    if (current && !currentBelongsToOtherModule && !units.find((u: any) => u.unit_id === current.unit_id)) {
      this.setCurrentUnit(units.length > 0 ? units[0] : null);
    }

    return units;
  }
}
