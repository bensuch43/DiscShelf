// Price-log logic: condition ranking, cheapest-for-condition, valuation.
import { CONFIG } from './config.js';

const RANK = Object.fromEntries(CONFIG.conditions.map((c) => [c.id, c.rank]));
export const conditionLabel = (id) => CONFIG.conditions.find((c) => c.id === id)?.label || 'Not recorded';
export const conditionRank = (id) => RANK[id] ?? 0;

export const logTotal = (log) => (log.price ?? 0) + (log.postage ?? 0);

/** Logs for this want in the wanted condition or better. */
export function eligibleLogs(want, logs) {
  const min = conditionRank(want.wantedCondition);
  return logs.filter((l) => l.wantId === want.id && conditionRank(l.condition) >= min);
}

/** Cheapest eligible log by total (price + postage); ties go to the most recent. */
export function cheapest(want, logs) {
  return eligibleLogs(want, logs).reduce((best, l) => {
    if (!best) return l;
    const d = logTotal(l) - logTotal(best);
    return d < 0 || (d === 0 && (l.seenOn || '') > (best.seenOn || '')) ? l : best;
  }, null);
}

export function ageDays(isoDate, now = new Date()) {
  if (!isoDate) return null;
  return Math.floor((now - new Date(`${isoDate.slice(0, 10)}T00:00:00`)) / 86400000);
}

export const isStale = (log, now = new Date()) => (ageDays(log?.seenOn, now) ?? 0) > CONFIG.priceStaleDays;

/**
 * Latest logged price for the same barcode, used to value an owned item.
 * Matches the item's condition if it has one; otherwise any condition.
 */
export function latestLoggedFor(item, logs) {
  if (!item.ean) return null;
  const matches = logs.filter((l) => l.ean === item.ean && (!item.condition || l.condition === item.condition));
  return matches.reduce((latest, l) => (!latest || (l.seenOn || '') > (latest.seenOn || '') ? l : latest), null);
}
