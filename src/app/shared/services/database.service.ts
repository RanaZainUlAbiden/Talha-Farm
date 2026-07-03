import { Injectable, NgZone } from '@angular/core';

declare global {
  interface Window {
    electronAPI: {
      dbRun: (sql: string, params?: any[]) => Promise<any>;
      dbGet: (sql: string, params?: any[]) => Promise<any>;
      getMachineId: () => Promise<string>;
    };
  }
}

@Injectable({
  providedIn: 'root'
})
export class DatabaseService {

  constructor(private zone: NgZone) {}

  run(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      window.electronAPI.dbRun(sql, params)
        .then((res: any) => this.zone.run(() => resolve(res)))
        .catch((err: any) => this.zone.run(() => reject(err)));
    });
  }

  get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      window.electronAPI.dbGet(sql, params)
        .then((res: any) => this.zone.run(() => resolve(res)))
        .catch((err: any) => this.zone.run(() => reject(err)));
    });
  }

  getMachineId(): Promise<string> {
    return new Promise((resolve, reject) => {
      window.electronAPI.getMachineId()
        .then((res: string) => this.zone.run(() => resolve(res)))
        .catch((err: any) => this.zone.run(() => reject(err)));
    });
  }
}