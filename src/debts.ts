// Debt helpers: fixed-bill link repair and the paydown chart window.
import type { BucketItem, Debt } from "./types.js";

// Debts link to fixed bills by the bill item's stable id. Older CSV exports
// stored the link by bill name; remap those name-based links to ids on import.
export function resolveFixedDebtLinks(billItems: BucketItem[], debts: Debt[]): Debt[] {
  const byId = new Set(billItems.map(b => b.id).filter(Boolean));
  const nameToId: Record<string, string> = {};
  billItems.forEach(b => { if (b.id) nameToId[b.name] = b.id; });
  return debts.map(d => (
    (d.linkedType === "fixed" && d.linkedBucketId && !byId.has(d.linkedBucketId) && nameToId[d.linkedBucketId])
      ? { ...d, linkedBucketId: nameToId[d.linkedBucketId] }
      : d
  ));
}

// Reconstruct a "last 12 months" debt paydown window from current balances and
// monthly principal. We have no stored history, so this assumes a steady payment.
// Returns a stacked series where paid + remaining = total (constant) at each step.
export interface DebtWindowPoint {
  i: number;
  paid: number;
  remaining: number;
  total: number;
}
export interface DebtWindow {
  // Months in the window, 1..12.
  N: number;
  // Combined monthly principal across all debts.
  P: number;
  // Combined current balance.
  C: number;
  windowPaid: number;
  startTotal: number;
  series: DebtWindowPoint[];
  paidPct: number;
}
export function buildDebtWindow(debts: Debt[], monthsElapsed: number): DebtWindow {
  const N = Math.max(1, Math.min(12, monthsElapsed || 1));
  const P = debts.reduce((s, d) => s + (d.monthlyPrincipal || d.monthly || 0), 0);
  const C = debts.reduce((s, d) => s + (d.balance || 0), 0);
  const windowPaid = P * N;
  const startTotal = C + windowPaid;
  const series: DebtWindowPoint[] = [];
  for (let i = 0; i <= N; i++) {
    const paid = P * i;
    series.push({ i, paid, remaining: startTotal - paid, total: startTotal });
  }
  const paidPct = startTotal > 0 ? Math.round((windowPaid / startTotal) * 100) : 0;
  return { N, P, C, windowPaid, startTotal, series, paidPct };
}
