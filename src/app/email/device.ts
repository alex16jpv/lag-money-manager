import { Locale } from "../../shared/locale";

const OS: [RegExp, string][] = [
  [/iPhone|iPad/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];
const BROWSER: [RegExp, string][] = [
  [/Edg\/|EdgA\/|EdgiOS\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const WORDS: Record<Locale, { on: string; unknown: string }> = {
  en: { on: "on", unknown: "Unknown device" },
  es: { on: "en", unknown: "Dispositivo desconocido" },
};

// The user agent is written by whoever signs in, so only names from the lists above ever reach an email.
export function describeDevice(
  userAgent: string | undefined,
  locale: Locale,
): string {
  const words = WORDS[locale];
  if (!userAgent) return words.unknown;
  const os = OS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const browser = BROWSER.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && os) return `${browser} ${words.on} ${os}`;
  return browser ?? os ?? words.unknown;
}
