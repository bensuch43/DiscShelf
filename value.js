// Collection value rules, in order of precedence:
//   1. your own estimate (a deliberate override)
//   2. the latest price you logged for the same barcode (+ condition, if recorded)
//   3. what you paid
// Keep that precedence in this one function.
import { latestLoggedFor, logTotal } from './prices.js';

export function valueDetail(item, logs = []) {
  if (item.estimatedValue != null) return { value: item.estimatedValue, source: 'estimate' };
  const log = latestLoggedFor(item, logs);
  if (log) return { value: logTotal(log), source: 'logged', log };
  if (item.pricePaid != null) return { value: item.pricePaid, source: 'paid' };
  return { value: null, source: null };
}

export const itemValue = (item, logs = []) => valueDetail(item, logs).value;

export function totals(items, logs = []) {
  let paid = 0;
  let value = 0;
  let unpriced = 0;
  for (const item of items) {
    if (item.pricePaid != null) paid += item.pricePaid;
    const v = itemValue(item, logs);
    if (v == null) unpriced += 1; else value += v;
  }
  return { count: items.length, paid, value, unpriced };
}
