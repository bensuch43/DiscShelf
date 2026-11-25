// GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) normalisation and check-digit validation.

export function normaliseBarcode(input) {
  return String(input ?? '').replace(/\D/g, '');
}

/**
 * Returns { ok, empty?, code?, reason?, expected? }.
 * reason: 'length' | 'checksum'. A failed check is a warning, not a block:
 * some sellers print odd codes and the user may still want to save.
 */
export function validateBarcode(input) {
  const code = normaliseBarcode(input);
  if (!code) return { ok: true, empty: true, code: '' };
  if (![8, 12, 13, 14].includes(code.length)) return { ok: false, reason: 'length', code };
  const digits = code.split('').map(Number);
  const check = digits.pop();
  let sum = 0;
  digits.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  const expected = (10 - (sum % 10)) % 10;
  return expected === check ? { ok: true, code } : { ok: false, reason: 'checksum', expected, code };
}
