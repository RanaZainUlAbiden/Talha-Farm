import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'dateOnly',
  standalone: true
})
export class DateOnlyPipe implements PipeTransform {
  transform(value: string | Date | null): string {
    if (!value) return '—';
    if (typeof value === 'string' && value.includes('T')) {
      return value.split('T')[0];
    }
    return String(value);
  }
}
