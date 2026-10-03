import { describeDevice } from "../../app/email/device";
import {
  EMAIL_TEMPLATE_META,
  EmailTemplate,
  EmailTemplateData,
  maskEmail,
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
const deleted = { deletedOn: "2026-09-19", keptUntil: "2026-10-20" };
const SAMPLES: EmailTemplateData = {
  "sign-up": code,
  "account-exists": { state: "live" },
  "verify-email": code,
  "confirm-deadline": { token: TOKEN, deadline: "2026-10-11" },
  "confirm-deadline-reminder": {
    token: TOKEN,
    deadline: "2026-10-11",
    daysLeft: 4,
  },
  "password-reset": code,
  "password-reset-after-undo": code,
  "email-change-confirm": { ...code, currentEmail: "ana.ruiz@work.example" },
  "email-change-taken": {},
  "password-changed": facts,
  "email-change-requested": {
    ...facts,
    newEmail: "ana.ruiz@work.example",
    undoToken: TOKEN,
  },
  "new-sign-in": facts,
  "account-deleted": { ...facts, keptUntil: "2026-10-20", restoreToken: TOKEN },
  "account-restored": { ...facts, deletedOn: "2026-09-19", by: "sign-in" },
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
  now: AT,
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
        "Vale por 30 minutos. Si pides otro, este deja de valer.",
      );
    });

    it("says how long a code works once, in its note, never in the preview or the lead [F]", () => {
      for (const template of [
        "sign-up",
        "verify-email",
        "password-reset",
        "password-reset-after-undo",
        "email-change-confirm",
      ] as const) {
        for (const locale of LOCALES) {
          const email = render(template, locale);
          expect(previewOf(email.html)).not.toMatch(/24|30|hour|hora|minut/);
          expect(
            email.text.match(/24 hours|24 horas|30 minutes|30 minutos/g),
          ).toHaveLength(1);
        }
      }
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

    it("gives verify-email no box and only its /verify link [T-237]", () => {
      const email = render("verify-email", "en");
      expect(email.html).not.toContain('class="lf-box"');
      expect(email.text).not.toMatch(/Didn.t sign up\?|not-me/);
      expect(hrefsOf(email.html)).toContain(
        `${APP_URL}/en/verify#token=${TOKEN}`,
      );
    });
  });

  describe("sign-up [T-238]", () => {
    it("carries the code that creates the account, its link, and no box", () => {
      const email = render("sign-up", "es");
      expect(email.subject).toBe("Termina de crear tu cuenta de Ledger Flow");
      expect(email.html).toContain(`>${CODE}</td>`);
      expect(hrefsOf(email.html)).toContain(
        `${APP_URL}/es/verify#token=${TOKEN}`,
      );
      expect(email.text).toContain(
        "¿No te registraste? Ignora este correo: sin el código no se crea ninguna cuenta.",
      );
      expect(email.html).not.toContain('class="lf-box"');
      expect(email.text).toContain(
        "Recibes este correo porque alguien empezó a crear una cuenta de Ledger Flow con esta dirección.",
      );
    });
  });

  describe("account-exists [T-238]", () => {
    it("sends a live account to Sign in, with Forgot your password? in the box", () => {
      const email = render("account-exists", "en");
      expect(email.subject).toBe("You already have a Ledger Flow account");
      expect(email.html).not.toMatch(/\d{6}<\/td>/);
      expect(email.html).toContain('class="lf-btn"');
      expect(hrefsOf(email.html)).toEqual(
        expect.arrayContaining([`${APP_URL}/en/login`, `${APP_URL}/en/forgot`]),
      );
      expect(email.text).toContain(
        "If it wasn’t you, ignore this email: nothing changed.",
      );
    });

    it("gives a deleted account its two days, the year left out in the year it is sent", () => {
      const en = render("account-exists", "en", {
        state: "deleted",
        ...deleted,
      });
      expect(en.subject).toBe("You already have a Ledger Flow account");
      expect(previewOf(en.html)).toBe("Sign in by October 20 to restore it.");
      expect(en.text).toContain(
        "It has one, deleted on September 19: it’s kept until October 20, and signing in by then restores it.",
      );
      expect(en.html).toContain(
        '<strong style="font-weight:600">October 20</strong>',
      );
      const es = render("account-exists", "es", {
        state: "deleted",
        ...deleted,
      });
      expect(es.text).toContain(
        "Tiene una, eliminada el 19 de septiembre: se conserva hasta el 20 de octubre, y si entras a más tardar ese día la restauras.",
      );
    });

    it("writes the year of a day in another year", () => {
      const email = render("account-exists", "en", {
        state: "deleted",
        deletedOn: "2026-12-20",
        keptUntil: "2027-01-19",
      });
      expect(email.text).toContain(
        "deleted on December 20: it’s kept until January 19, 2027",
      );
    });

    it("gives an address kept by an undo link its day, and nothing to sign in to", () => {
      const email = render("account-exists", "en", {
        state: "held",
        freeOn: "2026-10-03",
      });
      expect(email.subject).toBe(
        "This address is kept for a Ledger Flow account",
      );
      expect(email.text).toContain("kept for that account until October 3.");
      expect(email.html).not.toMatch(/class="lf-btn2?"/);
      expect(email.html).not.toContain('class="lf-box"');
    });

    it.each(["2026-1-03", "next week", "2026-10-03T00:00"])(
      "refuses the day %p",
      (freeOn) => {
        expect(() =>
          render("account-exists", "en", { state: "held", freeOn }),
        ).toThrow(/malformed/);
      },
    );
  });

  describe("the deadline emails [T-238]", () => {
    it("puts the deadline in the subject and the title, and links /verify with no code", () => {
      const email = render("confirm-deadline", "es");
      expect(email.subject).toBe(
        "Confirma tu correo de Ledger Flow a más tardar el 11 de octubre",
      );
      expect(email.text).toContain(
        "Confirma tu correo a más tardar el 11 de octubre",
      );
      expect(email.text).toContain(
        "El botón vale hasta el 11 de octubre. Después, para entrar te pediremos primero un código enviado a esta dirección.",
      );
      expect(email.html).not.toMatch(/\d{6}<\/td>/);
      expect(hrefsOf(email.html)).toContain(
        `${APP_URL}/es/verify#token=${TOKEN}`,
      );
      expect(email.text).toContain("¿No tienes cuenta en Ledger Flow?");
      expect(email.html).not.toContain('class="lf-btn2"');
    });

    it("counts the days left of the reminder as a number, one day in the singular", () => {
      expect(render("confirm-deadline-reminder", "en").subject).toBe(
        "4 days left to confirm your email for Ledger Flow",
      );
      const one = (locale: Locale): RenderedEmail =>
        render("confirm-deadline-reminder", locale, {
          token: TOKEN,
          deadline: "2026-10-11",
          daysLeft: 1,
        });
      expect(one("en").subject).toBe(
        "1 day left to confirm your email for Ledger Flow",
      );
      expect(one("es").subject).toBe(
        "Queda 1 día para confirmar tu correo de Ledger Flow",
      );
      expect(() =>
        render("confirm-deadline-reminder", "en", {
          token: TOKEN,
          deadline: "2026-10-11",
          daysLeft: 0,
        }),
      ).toThrow(/malformed/);
    });
  });

  describe("email-change-confirm, masked [T-236]", () => {
    it.each([
      ["ana.ruiz@work.example", "an•••@work.example"],
      ["ana+ledger@example.com", "an•••@example.com"],
      ["anab@example.com", "an•••@example.com"],
      ["ana@example.com", "a•••@example.com"],
      ["a@example.com", "a•••@example.com"],
    ])("masks %s as %s", (email, masked) => {
      expect(maskEmail(email)).toBe(masked);
    });

    it("names the account by its masked address in the lead only, escaped", () => {
      for (const locale of LOCALES) {
        const email = render("email-change-confirm", locale, {
          ...code,
          currentEmail: "a'na@work.example",
        });
        expect(email.html).toContain(
          '<strong style="font-weight:600">a&#39;•••@work.example</strong>',
        );
        expect(email.text).toContain("a'•••@work.example");
        expect(email.subject).not.toContain("work.example");
        expect(previewOf(email.html)).not.toContain("work.example");
      }
    });

    it("refuses an address the strict validation would not accept", () => {
      expect(() =>
        render("email-change-confirm", "en", {
          ...code,
          currentEmail: '"><b>@x',
        }),
      ).toThrow();
    });
  });

  describe("email-change-taken [T-238]", () => {
    it("tells the inbox nothing changes, with Sign in and no code", () => {
      const email = render("email-change-taken", "en");
      expect(email.subject).toBe(
        "Your address was asked for by another Ledger Flow account",
      );
      expect(email.html).not.toMatch(/\d{6}<\/td>/);
      expect(hrefsOf(email.html)).toContain(`${APP_URL}/en/login`);
      expect(email.html).not.toContain('class="lf-box"');
    });
  });

  describe("the words of a deleted account [T-238]", () => {
    it("tells password-reset of a deleted account that the new password restores it", () => {
      const email = render("password-reset", "en", { ...code, deleted });
      expect(email.text).toContain(
        "This account was deleted on September 19: choosing one restores it.",
      );
      expect(email.text).toContain(
        "Ignore this email: nothing changes, and the account is erased on October 20 as planned.",
      );
    });

    it("words password-reset-after-undo for a restore", () => {
      const email = render("password-reset-after-undo", "es", {
        ...code,
        restored: true,
      });
      expect(previewOf(email.html)).toBe("Restauraste tu cuenta.");
      expect(email.text).toContain(
        "Recibes este correo porque restauraste tu cuenta de Ledger Flow desde esta dirección.",
      );
    });

    it("says how account-restored came back", () => {
      expect(render("account-restored", "en").text).toContain(
        "Your account, deleted on September 19, was restored by signing in:",
      );
      expect(
        render("account-restored", "es", {
          ...facts,
          deletedOn: "2026-09-19",
          by: "reset",
        }).text,
      ).toContain(
        "se restauró al elegir una contraseña nueva: vuelve todo lo que tenía menos los grupos compartidos que dejó, y ya no se va a borrar. Se cerró la sesión en los demás dispositivos.",
      );
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
        "A request was made to change your account’s email to ana.o'ruiz@work.example. It changes once that address is confirmed.",
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

    it("gives the deleted account the day it is erased and its restore link [T-238]", () => {
      const email = render("account-deleted", "es");
      expect(previewOf(email.html)).toBe(
        "Se conserva hasta el 20 de octubre. Si entras antes, la restauras.",
      );
      expect(email.html).toContain(
        '<strong style="font-weight:600">20 de octubre</strong>',
      );
      expect(email.text).not.toContain("15 días hábiles");
      expect(hrefsOf(email.html)).toContain(
        `${APP_URL}/es/restore#token=${TOKEN}`,
      );
      expect(email.text).toContain("Restaurar la cuenta:");
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
