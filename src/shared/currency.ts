// Only applied when a client omits the field; the front suggests one from the browser locale.
export const DEFAULT_CURRENCY = "COP";

// ISO 4217 alpha code.
export function isValidCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

// Currencies with no minor unit: ¥1000.50 is not a real amount. Published in the contract as ZeroDecimalCurrency.
export const ZERO_DECIMAL_CURRENCIES: readonly string[] = [
  "AFN",
  "ALL",
  "BIF",
  "CLP",
  "COP",
  "DJF",
  "GNF",
  "HUF",
  "IDR",
  "IQD",
  "IRR",
  "ISK",
  "JPY",
  "KMF",
  "KPW",
  "KRW",
  "LAK",
  "LBP",
  "MGA",
  "MMK",
  "PKR",
  "PYG",
  "RWF",
  "SLL",
  "SOS",
  "SYP",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
  "YER",
];

const ZERO_DECIMAL = new Set(ZERO_DECIMAL_CURRENCIES);

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
  return currency && ZERO_DECIMAL.has(currency) ? 0 : 2;
}
