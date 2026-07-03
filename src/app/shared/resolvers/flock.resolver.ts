import { Injectable } from '@angular/core';
import { Resolve, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { DatabaseService } from '../services/database.service';
import { FlockService } from '../services/flock.service';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class FlockResolver implements Resolve<any> {
  constructor(
    private db: DatabaseService,
    private flockService: FlockService,
    private authService: AuthService
  ) {}

  async resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot) {
    try {
      const farm = this.authService.getCurrentFarm();
      if (!farm) return { flocks: [], currentFlock: null };

      const flocks = await this.flockService.loadFlocks(farm.farm_id);
      const currentFlock = this.flockService.getCurrentFlock();

      return {
        flocks,
        currentFlock,
        timestamp: new Date().getTime()
      };
    } catch (error) {
      return { flocks: [], currentFlock: null };
    }
  }
}