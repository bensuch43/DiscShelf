// Collection value rules.
// v0.1: value = your estimate if set, otherwise what you paid.
// v0.3 will slot "latest logged price for this barcode + condition" in front
// of the estimate. Keep that precedence in this one function.

export function itemValue(item) {
  return item.estimatedValue ?? item.pricePaid ?? null;
}

export function totals(items) {
  let paid = 0;
  let value = 0;
  let unpriced = 0;
  for (const item of items) {
    if (item.pricePaid != null) paid += item.pricePaid;
    const v = itemValue(item);
    if (v == null) unpriced += 1; else value += v;
  }
  return { count: items.length, paid, value, unpriced };
}
