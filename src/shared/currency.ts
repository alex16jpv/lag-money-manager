// Only applied when a client omits the field; the front suggests one from the browser locale.
export const DEFAULT_CURRENCY = "COP";

// ISO 4217 alpha code.
export function isValidCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

// Currencies with no minor unit: ¥1000.50 is not a real amount.
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

/**
 * Decimal places an amount may carry in this currency.
 *
 * Two for everything except the zero-decimal list. The ISO three-decimal
 * currencies (KWD, BHD, JOD, OMR, TND) are deliberately capped at two: storage
 * is integer cents (x100), so a third decimal could only be stored by rounding
 * it away. Rejecting it is honest; silently losing a fils is not. Supporting
 * them properly needs the storage exponent, which belongs to multi-currency
 * stage 3.
 */
export function currencyDecimals(currency?: string): number {
  return currency && ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
}
