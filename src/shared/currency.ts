// Paired with DEFAULT_TIMEZONE (America/Bogota): our defaults describe the
// same persona. The frontend suggests a currency from the browser locale;
// this only applies when a client omits the field entirely.
export const DEFAULT_CURRENCY = "COP";

// ISO 4217 alpha code. Amounts stay 2-decimal for every currency until the
// multi-currency stage brings the minor-units table (JPY=0, BHD=3, ...).
export function isValidCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}
