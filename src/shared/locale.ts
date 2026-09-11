// English is the default; the front reads user.locale to render and pick copy.
export const LOCALES = {
  en: "en",
  es: "es",
} as const;

export type Locale = keyof typeof LOCALES;

export const DEFAULT_LOCALE: Locale = "en";
