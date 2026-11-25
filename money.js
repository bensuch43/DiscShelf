// Money is stored as integer pence to avoid floating-point drift.
import { CONFIG } from './config.js';

const formatter = new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency: CONFIG.currency });

/** "£12.50" / "12.5" / "1,299" -> pence. Empty -> null. Invalid -> NaN. */
export function parsePounds(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/[£,\s]/g, '');
  if (s === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [pounds, decimals = ''] = s.split('.');
  return parseInt(pounds, 10) * 100 + parseInt((decimals + '00').slice(0, 2), 10);
}

export function formatPence(pence) {
  return pence === null || pence === undefined ? '—' : formatter.format(pence / 100);
}

export function penceToInput(pence) {
  return pence === null || pence === undefined ? '' : (pence / 100).toFixed(2);
}
