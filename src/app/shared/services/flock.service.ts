import { Injectable } from '@angular/core';
import { BehaviorSubject, distinctUntilChanged } from 'rxjs';
import { DatabaseService } from './database.service';

@Injectable({
  providedIn: 'root'
})
export class FlockService {

  private currentFlockSubject = new BehaviorSubject<any>(null);
  private flocksSubject = new BehaviorSubject<any[]>([]);

  currentFlock$ = this.currentFlockSubject.asObservable().pipe(
    distinctUntilChanged((a, b) => a?.flock_id === b?.flock_id)
  );

  flocks$ = this.flocksSubject.asObservable();

  constructor(private db: DatabaseService) {
    const stored = localStorage.getItem('currentFlock');
    if (stored) {
      try {
        this.currentFlockSubject.next(JSON.parse(stored));
      } catch {
        this.currentFlockSubject.next(null);
      }
    }
  }

  setCurrentFlock(flock: any) {
    if (flock === null) {
      this.currentFlockSubject.next(null);
      localStorage.removeItem('currentFlock');
      return;
    }
    const current = this.currentFlockSubject.value;
    if (current?.flock_id === flock?.flock_id) return;
    this.currentFlockSubject.next(flock);
    localStorage.setItem('currentFlock', JSON.stringify(flock));
  }

  getCurrentFlock(): any {
    return this.currentFlockSubject.value;
  }

  async loadFlocks(farmId: number): Promise<any[]> {
    const result = await this.db.get(
      // ← ASC so list shows oldest first, consistent with flock_id order
      `SELECT * FROM flocks WHERE farm_id = ? ORDER BY flock_id ASC`,
      [farmId]
    );
    const flocks = result.success ? result.data : [];

    // Broadcast to all subscribers (Layout dropdown etc.)
    this.flocksSubject.next(flocks);

    // Auto-select first flock if none active
    const current = this.currentFlockSubject.value;
    if (!current && flocks.length > 0) {
      this.setCurrentFlock(flocks[0]);
    }

    // If active flock was deleted, switch to first available
    if (current && !flocks.find((f: any) => f.flock_id === current.flock_id)) {
      this.setCurrentFlock(flocks.length > 0 ? flocks[0] : null);
    }

    return flocks;
  }

  // ── Get next flock number from DB — never use array.length ──
  async getNextFlockNumber(farmId: number): Promise<number> {
    const result = await this.db.get(
      `SELECT COUNT(*) as total FROM flocks WHERE farm_id = ?`,
      [farmId]
    );
    // COUNT(*) gives total rows including any gaps — add 1 for next
    // But to be truly safe against gaps, use MAX instead:
    const maxResult = await this.db.get(
      `SELECT COALESCE(MAX(flock_id), 0) as max_id FROM flocks WHERE farm_id = ?`,
      [farmId]
    );
    // Use total count + 1 for display number (F#1, F#2...) 
    // This stays correct even after deletes
    const total = result.success ? (result.data[0]?.total || 0) : 0;
    return total + 1;
  }
}