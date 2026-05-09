/**
 * Format a kiosk's window revenue using its own currency.
 *
 * Locale is fixed to `en-GB` because the recipients (POCs) are UK-based
 * admins reading currency in British conventions; the currency code drives
 * the symbol. No forex normalisation is applied — each kiosk's number is
 * shown in its native currency.
 *
 * Defensive fallback: an invalid ISO 4217 code on a malformed sales_records
 * row would otherwise throw RangeError and abort the whole Inngest step.
 * Prefer emitting a readable string with the literal code.
 */
export function formatRevenueForKiosk(
  revenue: number,
  currency: string,
): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
      maximumFractionDigits: 2,
    }).format(revenue);
  } catch {
    return `${currency} ${revenue.toFixed(2)}`;
  }
}
