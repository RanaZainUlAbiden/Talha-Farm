// Local-date formatting for date inputs and DB storage. `toISOString()`
// converts to UTC, which for PKT (UTC+5) shifts any local time before 05:00
// onto the previous day — always build the date string from local
// getFullYear/getMonth/getDate instead.
export function toLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
