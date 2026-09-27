import { describeDevice } from "../../app/email/device";
import {
  EMAIL_TEMPLATE_META,
  EmailTemplate,
  EmailTemplateData,
  RenderContext,
  RenderedEmail,
  renderEmail,
} from "../../app/email/templates";
import { Locale } from "../../shared/locale";

const APP_URL = "https://ledgerflow.alexpiral.com";
const CONTACT = "ledgerflow@alexpiral.com";
const CODE = "482913";
const TOKEN = "q7Xk2mVb9RtL4wPz_-AB";
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const AT = new Date("2026-09-27T00:42:00Z");

const facts = { at: AT, userAgent: CHROME_WINDOWS };
const code = { code: CODE, token: TOKEN };
const SAMPLES: EmailTemplateData = {
  "verify-email": { ...code, notMeToken: `${TOKEN}n` },
  "password-reset": code,
  "password-reset-after-undo": code,
  "email-change-confirm": code,
  "password-changed": facts,
  "email-change-requested": {
    ...facts,
    newEmail: "ana.ruiz@work.example",
    undoToken: TOKEN,
  },
  "new-sign-in": facts,
  "account-deleted": facts,
  "passkey-added": { ...facts, undoToken: TOKEN },
  "two-factor-on": { ...facts, undoToken: TOKEN },
  "passkey-removed": facts,
  "two-factor-off": facts,
  "recovery-code-used": { ...facts, left: 7, usedTo: "sign-in" },
};

const TEMPLATES = Object.keys(SAMPLES) as EmailTemplate[];
const LOCALES: Locale[] = ["en", "es"];

const context = (locale: Locale): RenderContext => ({
  locale,
  timezone: "America/Bogota",
  appUrl: APP_URL,
  contact: CONTACT,
});

const render = <T extends EmailTemplate>(
  template: T,
  locale: Locale,
  data: EmailTemplateData[T] = SAMPLES[template],
): RenderedEmail => renderEmail(template, data, context(locale));

const previewOf = (html: string): string =>
  /<div style="display:none;[^"]*">(.*?)(?:&#847;|<\/div>)/.exec(html)?.[1] ??
  "";

const hrefsOf = (html: string): string[] =>
  [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe("email templates", () => {
  it("has metadata for every template it renders", () => {
    expect(Object.keys(EMAIL_TEMPLATE_META).sort()).toEqual(
      [...TEMPLATES].sort(),
    );
  });

  describe.each(TEMPLATES)("%s", (template) => {
    it.each(LOCALES)("renders html and text in %s", (locale) => {
      const email = render(template, locale);
      expect(email.subject).toContain("Ledger Flow");
      expect(email.html.startsWith("<!DOCTYPE html>")).toBe(true);
      expect(email.html).toContain(`<html lang="${locale}"`);
      expect(email.html).toContain(
        '<meta name="color-scheme" content="light dark">',
      );
      expect(email.html).toContain("@media (prefers-color-scheme: dark)");
      expect(email.html).not.toMatch(/<img|<script|url\(/i);
      expect(previewOf(email.html).length).toBeGreaterThan(0);
      expect(email.text.split("\n")[0]).toBe("Ledger Flow");
      expect(email.text).toContain("\n--\n");
    });

    it.each(LOCALES)(
      "links only to the app in %s, or to the contact",
      (locale) => {
        const hrefs = hrefsOf(render(template, locale).html);
        expect(hrefs.length).toBeGreaterThan(0);
        for (const href of hrefs) {
          expect(
            href === `mailto:${CONTACT}` ||
              href === `${APP_URL}/${locale}` ||
              href.startsWith(`${APP_URL}/${locale}/`),
          ).toBe(true);
          expect(href).not.toContain("?");
        }
      },
    );

    it("never puts the code in the subject or the preview", () => {
      for (const locale of LOCALES) {
        const email = render(template, locale);
        expect(email.subject).not.toContain(CODE);
        expect(previewOf(email.html)).not.toContain(CODE);
      }
    });
  });

  describe("code emails", () => {
    it("carries the code in the body and the token in the fragment", () => {
      const email = render("password-reset", "es");
      expect(email.html).toContain(`>${CODE}</td>`);
      expect(hrefsOf(email.html)).toContain(
        `${APP_URL}/es/reset#token=${TOKEN}`,
      );
      expect(email.text).toContain(`\n    ${CODE}\n`);
      expect(email.text).toContain(
        `Elegir una contraseña nueva: ${APP_URL}/es/reset#token=${TOKEN}`,
      );
      expect(email.text).toContain(
        "Sirve 30 minutos. Si pides otro, este deja de servir.",
      );
    });

    it("gives verify-email its own not-me link", () => {
      const hrefs = hrefsOf(render("verify-email", "en").html);
      expect(hrefs).toContain(`${APP_URL}/en/verify#token=${TOKEN}`);
      expect(hrefs).toContain(`${APP_URL}/en/not-me#token=${TOKEN}n`);
    });

    it("says why it arrived in the footer", () => {
      expect(render("email-change-confirm", "en").text).toContain(
        "You’re getting this because someone asked to use this address for a Ledger Flow account.",
      );
    });

    it.each([
      ["a code that is not six digits", { code: "12345", token: TOKEN }],
      ["a code with letters", { code: "12a456", token: TOKEN }],
      ["a short token", { code: CODE, token: "abc" }],
      [
        "a token that would break the link",
        { code: CODE, token: `${TOKEN}#x` },
      ],
    ])("refuses %s", (_label, data) => {
      expect(() => render("password-reset", "en", data)).toThrow(/malformed/);
    });

    it("refuses verify-email without its not-me token", () => {
      const data = {
        code: CODE,
        token: TOKEN,
      } as EmailTemplateData["verify-email"];
      expect(() => render("verify-email", "en", data)).toThrow(/box token/);
    });
  });

  describe("security notices", () => {
    it("states when in the account's zone and language, and the device", () => {
      const en = render("password-changed", "en").text;
      expect(en).toMatch(/When: Sep 26, 2026, 7:42\sPM GMT-5/);
      expect(en).toContain("Device: Chrome on Windows");
      const es = render("password-changed", "es").text;
      expect(es).toMatch(/Cuándo: 26 de sept de 2026, 7:42\sp\.\sm\.\sGMT-5/);
      expect(es).toContain("Dispositivo: Chrome en Windows");
    });

    it("keeps the date and the time from breaking inside", () => {
      expect(render("new-sign-in", "en").html).toMatch(
        /<span style="white-space:nowrap">Sep 26, 2026,<\/span> <span style="white-space:nowrap">7:42.PM GMT-5<\/span>/,
      );
    });

    it("carries the security footer and no primary button", () => {
      const email = render("new-sign-in", "en");
      expect(email.text).toContain(
        "This is a security notice for your Ledger Flow account.",
      );
      expect(email.html).not.toContain('class="lf-btn"');
      expect(hrefsOf(email.html)).toContain(`${APP_URL}/en/forgot`);
    });

    it("puts the device in the new-sign-in subject, from the fixed list only", () => {
      expect(render("new-sign-in", "es").subject).toBe(
        "Nuevo acceso a Ledger Flow: Chrome en Windows",
      );
      const hostile = render("new-sign-in", "en", {
        at: AT,
        userAgent: "<b>Visit evil.example</b> Windows Firefox/1",
      });
      expect(hostile.subject).toBe(
        "New sign-in to Ledger Flow: Firefox on Windows",
      );
      expect(hostile.html).not.toContain("evil.example");
    });

    it("escapes the new address and never links it", () => {
      const email = render("email-change-requested", "en", {
        ...facts,
        newEmail: "ana.o'ruiz@work.example",
        undoToken: TOKEN,
      });
      expect(email.html).toContain(
        '<strong style="font-weight:600">ana.o&#39;ruiz@work.example</strong>',
      );
      expect(hrefsOf(email.html).join(" ")).not.toContain("work.example");
      expect(email.subject).not.toContain("work.example");
      expect(previewOf(email.html)).not.toContain("work.example");
      expect(email.text).toContain(
        "Someone asked to move your account to ana.o'ruiz@work.example. It moves once that address is confirmed.",
      );
    });

    it("refuses a new address the strict validation would not accept", () => {
      expect(() =>
        render("email-change-requested", "en", {
          ...facts,
          newEmail: '"><script>@x',
          undoToken: TOKEN,
        }),
      ).toThrow();
    });

    it("links the undo notices to /undo with their token", () => {
      for (const template of [
        "email-change-requested",
        "passkey-added",
        "two-factor-on",
      ] as const) {
        expect(hrefsOf(render(template, "en").html)).toContain(
          `${APP_URL}/en/undo#token=${TOKEN}`,
        );
      }
    });

    it("tells the deleted account how to erase it for good", () => {
      const email = render("account-deleted", "es");
      expect(email.text).toContain(
        `Para borrarla del todo, escribe a ${CONTACT}: se hace en 15 días hábiles.`,
      );
      expect(hrefsOf(email.html)).toContain(`${APP_URL}/es/register`);
    });
  });

  describe("recovery-code-used", () => {
    const withLeft = (left: number, locale: Locale): RenderedEmail =>
      render("recovery-code-used", locale, {
        ...facts,
        left,
        usedTo: "reset-password",
      });

    it("counts what is left, in both languages", () => {
      expect(withLeft(7, "en").text).toContain(
        "One of your recovery codes was used to reset your password. You have 7 left, and each one works once.",
      );
      expect(withLeft(1, "es").text).toContain(
        "para restablecer la contraseña. Te queda 1 y cada uno sirve una vez.",
      );
      expect(withLeft(3, "es").text).toContain("Te quedan 3 y cada uno");
    });

    it("says it was the last one, and so does the preview", () => {
      const en = withLeft(0, "en");
      expect(en.text).toContain(
        "That was your last one: create new codes in Settings › Security.",
      );
      expect(previewOf(en.html)).toMatch(/^None left\./);
      expect(previewOf(withLeft(0, "es").html)).toMatch(
        /^No te queda ninguno\./,
      );
    });

    it.each([-1, 1.5, Number.NaN])("refuses %p left", (left) => {
      expect(() => withLeft(left, "en")).toThrow(/malformed/);
    });
  });

  it("builds links from an app url with a trailing slash", () => {
    const email = renderEmail("password-changed", facts, {
      ...context("en"),
      appUrl: `${APP_URL}/`,
    });
    expect(hrefsOf(email.html)).toContain(`${APP_URL}/en/forgot`);
    expect(hrefsOf(email.html)).toContain(`${APP_URL}/en`);
  });
});

describe("describeDevice", () => {
  it.each([
    [CHROME_WINDOWS, "en", "Chrome on Windows"],
    [CHROME_WINDOWS, "es", "Chrome en Windows"],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "en",
      "Safari on iOS",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/130.0",
      "en",
      "Firefox on Linux",
    ],
    ["Firefox/130.0", "en", "Firefox"],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
      "en",
      "Chrome on iOS",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15",
      "es",
      "Firefox en iOS",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/140.0 Mobile/15E148 Safari/605.1.15",
      "en",
      "Edge on iOS",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 EdgA/140.0.0.0",
      "en",
      "Edge on Android",
    ],
    ["curl/8.5.0", "en", "Unknown device"],
    ["", "es", "Dispositivo desconocido"],
    [undefined, "en", "Unknown device"],
  ] as const)("reads %p in %s as %s", (userAgent, locale, expected) => {
    expect(describeDevice(userAgent, locale)).toBe(expected);
  });
});
