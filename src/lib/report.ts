import type { TxnRow } from "../types";

export interface DateSales {
  date: string;
  count: number;
  total: number;
}

export function dateKey(datetime: string): string {
  const stamp = datetime.replace("T", " ").trim();
  const day = stamp.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

export function formatReportDate(key: string): string {
  const [year, month, day] = key.split("-");
  if (!year || !month || !day) return key;
  return `${day}-${month}-${year}`;
}

export function formatReportAmount(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function rowDay(row: TxnRow): string {
  return dateKey(row.originalDatetime || row.datetime);
}

function reportable(row: TxnRow): boolean {
  return row.origin !== "extra" && !row.skipped && row.amount > 0 && Boolean(rowDay(row));
}

export function salesByDate(rows: TxnRow[]): DateSales[] {
  const byDay = new Map<string, DateSales>();
  for (const row of rows) {
    if (!reportable(row)) continue;
    const date = rowDay(row);
    const current = byDay.get(date) ?? { date, count: 0, total: 0 };
    current.count += 1;
    current.total = Math.round((current.total + row.amount) * 100) / 100;
    byDay.set(date, current);
  }
  return [...byDay.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function grandTotal(groups: DateSales[]): number {
  return Math.round(groups.reduce((sum, group) => sum + group.total, 0) * 100) / 100;
}
