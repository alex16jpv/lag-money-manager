import { DateTime } from "luxon";
import { z } from "zod";

import { EmailBudget } from "../../shared/emailBudgets";
import { Locale } from "../../shared/locale";
import { describeDevice } from "./device";
import {
  EmailButton,
  EmailContent,
  Inline,
  renderHtml,
  renderText,
} from "./layout";

interface CodeLink {
  code: string;
  token: string;
}

interface NoticeFacts {
  at: Date;
  userAgent: string | undefined;
}

// A day is "YYYY-MM-DD" in the account's time zone, whole: "kept until" means to the end of it.
type Day = string;

export type AccountExists =
  | { state: "live" }
  | { state: "deleted"; deletedOn: Day; keptUntil: Day }
  | { state: "held"; freeOn: Day };

export interface EmailTemplateData {
  "sign-up": CodeLink;
  "account-exists": AccountExists;
  "verify-email": CodeLink;
  "confirm-deadline": { token: string; deadline: Day };
  "confirm-deadline-reminder": {
    token: string;
    deadline: Day;
    daysLeft: number;
  };
  "password-reset": CodeLink & { deleted?: { deletedOn: Day; keptUntil: Day } };
  "password-reset-after-undo": CodeLink & { restored?: boolean };
  "email-change-confirm": CodeLink & { currentEmail: string };
  "email-change-taken": Record<string, never>;
  "password-changed": NoticeFacts;
  "email-change-requested": NoticeFacts & {
    newEmail: string;
    undoToken: string;
  };
  "new-sign-in": NoticeFacts;
  "account-deleted": NoticeFacts & { keptUntil: Day; restoreToken: string };
  "account-restored": NoticeFacts & {
    deletedOn: Day;
    by: "sign-in" | "reset";
  };
  "passkey-added": NoticeFacts & { undoToken: string };
  "two-factor-on": NoticeFacts & { undoToken: string };
  "passkey-removed": NoticeFacts;
  "two-factor-off": NoticeFacts;
  "recovery-code-used": NoticeFacts & {
    left: number;
    usedTo: "sign-in" | "reset-password";
  };
}

export type EmailTemplate = keyof EmailTemplateData;

interface TemplateMeta {
  // code and link go out on request, with the requester's brakes; a notice tells what already happened.
  kind: "code" | "link" | "notice";
  budget: EmailBudget;
  purpose: string;
  addressDaily: boolean;
  perUser: boolean;
}

export const EMAIL_TEMPLATE_META = {
  "sign-up": {
    kind: "code",
    budget: "security",
    purpose: "sign-up",
    addressDaily: true,
    perUser: false,
  },
  "account-exists": {
    kind: "link",
    budget: "security",
    purpose: "sign-up",
    addressDaily: true,
    perUser: false,
  },
  "verify-email": {
    kind: "code",
    budget: "security",
    purpose: "verify",
    addressDaily: true,
    perUser: true,
  },
  "confirm-deadline": {
    kind: "link",
    budget: "security",
    purpose: "confirm-deadline",
    addressDaily: true,
    perUser: false,
  },
  "confirm-deadline-reminder": {
    kind: "link",
    budget: "security",
    purpose: "confirm-deadline",
    addressDaily: true,
    perUser: false,
  },
  "password-reset": {
    kind: "code",
    budget: "reset",
    purpose: "reset",
    addressDaily: true,
    perUser: false,
  },
  "password-reset-after-undo": {
    kind: "code",
    budget: "reset",
    purpose: "reset-after-undo",
    addressDaily: false,
    perUser: false,
  },
  "email-change-confirm": {
    kind: "code",
    budget: "security",
    purpose: "email-change",
    addressDaily: true,
    perUser: true,
  },
  "email-change-taken": {
    kind: "link",
    budget: "security",
    purpose: "email-change",
    addressDaily: true,
    perUser: true,
  },
  "password-changed": notice("password-changed"),
  "email-change-requested": notice("email-change-requested"),
  "new-sign-in": notice("new-sign-in"),
  "account-deleted": notice("account-deleted"),
  "account-restored": notice("account-restored"),
  "passkey-added": notice("passkey-added"),
  "two-factor-on": notice("two-factor-on"),
  "passkey-removed": notice("passkey-removed"),
  "two-factor-off": notice("two-factor-off"),
  "recovery-code-used": notice("recovery-code-used"),
} as const satisfies Record<EmailTemplate, TemplateMeta>;

function notice<P extends string>(
  purpose: P,
): {
  readonly kind: "notice";
  readonly budget: "security";
  readonly purpose: P;
  readonly addressDaily: true;
  readonly perUser: false;
} {
  return {
    kind: "notice",
    budget: "security",
    purpose,
    addressDaily: true,
    perUser: false,
  } as const;
}

type Meta = typeof EMAIL_TEMPLATE_META;

export type NoticeTemplate = {
  [K in EmailTemplate]: Meta[K]["kind"] extends "notice" ? K : never;
}[EmailTemplate];

// Everything sent on someone's request: through sendCode, with that requester's brakes.
export type CodeTemplate = Exclude<EmailTemplate, NoticeTemplate>;

export interface RenderContext {
  locale: Locale;
  timezone: string;
  appUrl: string;
  contact: string;
  // When it is sent: a date in this year is written without its year.
  now: Date;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const SHARED = {
  en: {
    fallback: "If the button doesn’t work, open this link:",
    codeNote:
      "Only type this code in Ledger Flow. Nobody from Ledger Flow will ever ask you for it.",
    code24h: "It works for 24 hours. Asking for another one cancels this one.",
    code30m:
      "It works for 30 minutes. Asking for another one cancels this one.",
    when: "When",
    device: "Device",
    why: (reason: string) => `You’re getting this because ${reason}.`,
    security:
      "This is a security notice for your Ledger Flow account. These can’t be turned off: they’re how we tell you what happens to your account.",
    contact: "Questions?",
    notYou: "Not you?",
    reset: "Reset password",
    undo: "Undo the change",
    restore: "Restore account",
    signIn: "Sign in",
    confirmEmail: "Confirm email",
    resetBox: "Reset your password now. It signs out every device.",
    undoFactorBox:
      "Undo it: we remove every passkey, authenticator app and recovery code added since then, sign out every device, and you choose a new password. This link works for 7 days.",
    undoPreview: "If it wasn’t you, undo it from this email.",
    resetPreview: "If it wasn’t you, reset your password now.",
  },
  es: {
    fallback: "Si el botón no funciona, abre este enlace:",
    codeNote:
      "Escribe este código solo en Ledger Flow. Nadie de Ledger Flow te lo va a pedir.",
    code24h: "Vale por 24 horas. Si pides otro, este deja de valer.",
    code30m: "Vale por 30 minutos. Si pides otro, este deja de valer.",
    when: "Cuándo",
    device: "Dispositivo",
    why: (reason: string) => `Recibes este correo porque ${reason}.`,
    security:
      "Es un aviso de seguridad de tu cuenta de Ledger Flow. Estos avisos no se pueden desactivar: así te contamos lo que pasa con tu cuenta.",
    contact: "¿Dudas?",
    notYou: "¿No fuiste tú?",
    reset: "Restablecer contraseña",
    undo: "Deshacer el cambio",
    restore: "Restaurar la cuenta",
    signIn: "Entrar",
    confirmEmail: "Confirmar correo",
    resetBox:
      "Restablece tu contraseña ya. Se cierra la sesión en todos los dispositivos.",
    undoFactorBox:
      "Deshazlo: quitamos las llaves de acceso, la app de autenticación y los códigos de recuperación añadidos desde entonces, se cierra la sesión en todos los dispositivos y eliges una contraseña nueva. El enlace vale por 7 días.",
    undoPreview: "Si no fuiste tú, deshazlo desde este correo.",
    resetPreview: "Si no fuiste tú, restablece tu contraseña ya.",
  },
} as const satisfies Record<Locale, unknown>;

type Shared = (typeof SHARED)[Locale];

interface Box {
  heading: string;
  body: string;
  action?: EmailButton;
}

interface Words {
  subject: string;
  preview: string;
  title: string;
  lead: Inline[];
  line?: string;
  box?: Box;
}

interface CodeWords extends Words {
  button: string;
  reason: string;
}

interface LinkWords extends Words {
  button?: EmailButton;
  reason: string;
}

interface Tools {
  shared: Shared;
  context: RenderContext;
  link: (path: string, token?: string) => string;
  day: (day: Day) => string;
}

type Builder<W, T extends EmailTemplate> = (
  data: EmailTemplateData[T],
  tools: Tools,
) => W;

type ByLocale<W, T extends EmailTemplate> = Record<Locale, Builder<W, T>>;

const CODE_ROUTES: Record<
  Exclude<CodeTemplate, LinkTemplate>,
  { path: string; lifetime: "code24h" | "code30m" }
> = {
  "sign-up": { path: "verify", lifetime: "code24h" },
  "verify-email": { path: "verify", lifetime: "code24h" },
  "password-reset": { path: "reset", lifetime: "code30m" },
  "password-reset-after-undo": { path: "reset", lifetime: "code30m" },
  "email-change-confirm": { path: "confirm-email", lifetime: "code24h" },
};

type LinkTemplate = {
  [K in EmailTemplate]: Meta[K]["kind"] extends "link" ? K : never;
}[EmailTemplate];

type OnlyCode = Exclude<CodeTemplate, LinkTemplate>;

const CODE_WORDS: { [T in OnlyCode]: ByLocale<CodeWords, T> } = {
  "sign-up": {
    en: () => ({
      subject: "Finish creating your Ledger Flow account",
      preview: "Type the code in the app or use the button.",
      title: "Welcome to Ledger Flow",
      lead: [
        "Type this code in the app to confirm this address and finish creating your account.",
      ],
      line: "Didn’t sign up? Ignore this email: without the code, no account is created.",
      button: "Confirm email",
      reason:
        "someone started creating a Ledger Flow account with this address",
    }),
    es: () => ({
      subject: "Termina de crear tu cuenta de Ledger Flow",
      preview: "Escribe el código en la app o usa el botón.",
      title: "Te damos la bienvenida a Ledger Flow",
      lead: [
        "Escribe este código en la app para confirmar esta dirección y terminar de crear tu cuenta.",
      ],
      line: "¿No te registraste? Ignora este correo: sin el código no se crea ninguna cuenta.",
      button: "Confirmar correo",
      reason:
        "alguien empezó a crear una cuenta de Ledger Flow con esta dirección",
    }),
  },
  "verify-email": {
    en: () => ({
      subject: "Confirm your email for Ledger Flow",
      preview: "Type the code in the app or use the button.",
      title: "Confirm your email",
      lead: ["Type this code in Ledger Flow to confirm this address is yours."],
      button: "Confirm email",
      reason: "someone asked to confirm this address for a Ledger Flow account",
    }),
    es: () => ({
      subject: "Confirma tu correo en Ledger Flow",
      preview: "Escribe el código en la app o usa el botón.",
      title: "Confirma tu correo",
      lead: [
        "Escribe este código en Ledger Flow para confirmar que esta dirección es tuya.",
      ],
      button: "Confirmar correo",
      reason:
        "alguien pidió confirmar esta dirección en una cuenta de Ledger Flow",
    }),
  },
  "password-reset": {
    en: (data, { day }) => ({
      subject: "Reset your Ledger Flow password",
      preview: "If you didn’t ask for it, ignore this email.",
      title: "Reset your password",
      lead: [
        data.deleted
          ? `Type this code in Ledger Flow to choose a new password. This account was deleted on ${day(data.deleted.deletedOn)}: choosing one restores it.`
          : "Type this code in Ledger Flow to choose a new password. Your other devices will be signed out.",
      ],
      button: "Choose a new password",
      box: {
        heading: "Didn’t ask for this?",
        body: data.deleted
          ? `Ignore this email: nothing changes, and the account is erased on ${day(data.deleted.keptUntil)} as planned.`
          : "Ignore this email: your password stays the same.",
      },
      reason:
        "someone asked to reset the password of the Ledger Flow account with this address",
    }),
    es: (data, { day }) => ({
      subject: "Restablece tu contraseña de Ledger Flow",
      preview: "Si no lo pediste, ignora este correo.",
      title: "Restablece tu contraseña",
      lead: [
        data.deleted
          ? `Escribe este código en Ledger Flow para elegir una contraseña nueva. Esta cuenta se eliminó el ${day(data.deleted.deletedOn)}: al elegirla, la restauras.`
          : "Escribe este código en Ledger Flow para elegir una contraseña nueva. Se cerrará la sesión en tus otros dispositivos.",
      ],
      button: "Elegir una contraseña nueva",
      box: {
        heading: "¿No lo pediste?",
        body: data.deleted
          ? `Ignora este correo: no cambia nada y la cuenta se borra el ${day(data.deleted.keptUntil)}, como estaba previsto.`
          : "Ignora este correo: tu contraseña sigue igual.",
      },
      reason:
        "alguien pidió restablecer la contraseña de la cuenta de Ledger Flow con esta dirección",
    }),
  },
  "password-reset-after-undo": {
    en: (data) => ({
      subject: "Choose a new password for Ledger Flow",
      preview: data.restored
        ? "You restored your account."
        : "You undid a change to your account.",
      title: "Choose a new password",
      lead: [
        data.restored
          ? "You restored your account from this address, and every device was signed out. Type this code in Ledger Flow to choose a new password: the old one no longer works."
          : "You undid a change to your account from this address, and every device was signed out. Type this code in Ledger Flow to choose a new password: the old one no longer works.",
      ],
      button: "Choose a new password",
      box: {
        heading: "Code expired?",
        body: "Ask for another one with “Forgot your password?” on the Sign in screen.",
      },
      reason: data.restored
        ? "you restored your Ledger Flow account from this address"
        : "you undid a change to your Ledger Flow account from this address",
    }),
    es: (data) => ({
      subject: "Elige una contraseña nueva para Ledger Flow",
      preview: data.restored
        ? "Restauraste tu cuenta."
        : "Deshiciste un cambio en tu cuenta.",
      title: "Elige una contraseña nueva",
      lead: [
        data.restored
          ? "Restauraste tu cuenta desde esta dirección y se cerró la sesión en todos los dispositivos. Escribe este código en Ledger Flow para elegir una contraseña nueva: la anterior ya no sirve."
          : "Deshiciste un cambio en tu cuenta desde esta dirección y se cerró la sesión en todos los dispositivos. Escribe este código en Ledger Flow para elegir una contraseña nueva: la anterior ya no sirve.",
      ],
      button: "Elegir una contraseña nueva",
      box: {
        heading: "¿Se venció el código?",
        body: "Pide otro con «¿Olvidaste tu contraseña?» en la pantalla de Entrar.",
      },
      reason: data.restored
        ? "restauraste tu cuenta de Ledger Flow desde esta dirección"
        : "deshiciste un cambio en tu cuenta de Ledger Flow desde esta dirección",
    }),
  },
  "email-change-confirm": {
    en: (data) => ({
      subject: "Confirm your new email for Ledger Flow",
      preview: "Your account moves to this address once you confirm it.",
      title: "Confirm your new email",
      lead: [
        "Type this code in Ledger Flow to move the account ",
        { strong: maskEmail(data.currentEmail) },
        " to this address. Until you do, it keeps that email. Confirming signs out your other devices.",
      ],
      button: "Confirm new email",
      box: {
        heading: "Didn’t ask for this, or isn’t that your account?",
        body: "Don’t use the code or the button: ignore this email. Nothing changes, and this address isn’t added to any account.",
      },
      reason: "someone asked to use this address for a Ledger Flow account",
    }),
    es: (data) => ({
      subject: "Confirma tu nuevo correo en Ledger Flow",
      preview: "Tu cuenta pasa a esta dirección cuando la confirmes.",
      title: "Confirma tu nuevo correo",
      lead: [
        "Escribe este código en Ledger Flow para pasar la cuenta ",
        { strong: maskEmail(data.currentEmail) },
        " a esta dirección. Mientras no lo hagas, sigue con ese correo. Al confirmar se cierra la sesión en tus otros dispositivos.",
      ],
      button: "Confirmar nuevo correo",
      box: {
        heading: "¿No lo pediste, o esa no es tu cuenta?",
        body: "No uses el código ni el botón: ignora este correo. No cambia nada y esta dirección no se añade a ninguna cuenta.",
      },
      reason: "alguien pidió usar esta dirección en una cuenta de Ledger Flow",
    }),
  },
};

const ACCOUNT_EXISTS_LIVE = {
  en: {
    subject: "You already have a Ledger Flow account",
    reason: "someone tried to sign up for Ledger Flow with this address",
    boxHeading: "Forgot your password?",
  },
  es: {
    subject: "Ya tienes una cuenta de Ledger Flow",
    reason: "alguien intentó registrarse en Ledger Flow con esta dirección",
    boxHeading: "¿Olvidaste tu contraseña?",
  },
} as const;

const DEADLINE = {
  en: {
    preview: "It takes one tap, and nothing in your account changes.",
    line: (date: string) =>
      `The button works until ${date}. After that, signing in first asks for a code sent to this address.`,
    box: {
      heading: "Don’t have a Ledger Flow account?",
      body: "Don’t use the button: ignore this email. Nothing in anybody’s account changes.",
    },
    reason: "a Ledger Flow account uses this address and hasn’t confirmed it",
  },
  es: {
    preview: "Es un toque, y en tu cuenta no cambia nada.",
    line: (date: string) =>
      `El botón vale hasta el ${date}. Después, para entrar te pediremos primero un código enviado a esta dirección.`,
    box: {
      heading: "¿No tienes cuenta en Ledger Flow?",
      body: "No uses el botón: ignora este correo. No cambia nada en ninguna cuenta.",
    },
    reason:
      "una cuenta de Ledger Flow usa esta dirección y todavía no la confirma",
  },
} as const;

const daysLeft = (locale: Locale, days: number): string =>
  locale === "en"
    ? `${days} ${days === 1 ? "day" : "days"} left`
    : `${days === 1 ? "Queda" : "Quedan"} ${days} ${days === 1 ? "día" : "días"}`;

const LINK_WORDS: { [T in LinkTemplate]: ByLocale<LinkWords, T> } = {
  "account-exists": {
    en: (data, { shared, link, day }) => {
      const base = ACCOUNT_EXISTS_LIVE.en;
      if (data.state === "held") {
        return {
          subject: "This address is kept for a Ledger Flow account",
          preview: `This address can’t be used for a new account until ${day(data.freeOn)}.`,
          title: "This address is kept for an account",
          lead: [
            "Someone tried to create a Ledger Flow account with this address. An account moved away from it in the last few days and can still come back to it, so it’s kept for that account until ",
            { strong: day(data.freeOn) },
            ".",
          ],
          line: "If that account is yours, the email about the change has a link to undo it. If not, ignore this email.",
          reason: base.reason,
        };
      }
      const signIn = { label: shared.signIn, url: link("login") };
      const forgot = { label: shared.reset, url: link("forgot") };
      if (data.state === "deleted") {
        return {
          subject: base.subject,
          preview: `Sign in by ${day(data.keptUntil)} to restore it.`,
          title: "Your deleted account can still come back",
          lead: [
            `Someone tried to create a Ledger Flow account with this address. It has one, deleted on ${day(data.deletedOn)}: it’s kept until `,
            { strong: day(data.keptUntil) },
            ", and signing in by then restores it.",
          ],
          line: "After that it’s erased for good, and this address is free for a new account. If it wasn’t you, ignore this email.",
          button: signIn,
          box: {
            heading: base.boxHeading,
            body: "Choosing a new one restores it too. It signs out every device.",
            action: forgot,
          },
          reason: base.reason,
        };
      }
      return {
        subject: base.subject,
        preview: "Sign in with it, or choose a new password if you forgot it.",
        title: "You already have an account",
        lead: [
          "Someone tried to create a Ledger Flow account with this address, and it already has one. If it was you, sign in with it.",
        ],
        line: "If it wasn’t you, ignore this email: nothing changed.",
        button: signIn,
        box: {
          heading: base.boxHeading,
          body: "Choose a new one with a code sent here. It signs out every device.",
          action: forgot,
        },
        reason: base.reason,
      };
    },
    es: (data, { shared, link, day }) => {
      const base = ACCOUNT_EXISTS_LIVE.es;
      if (data.state === "held") {
        return {
          subject:
            "Esta dirección está reservada para una cuenta de Ledger Flow",
          preview: `Esta dirección no se puede usar para una cuenta nueva hasta el ${day(data.freeOn)}.`,
          title: "Esta dirección está reservada para una cuenta",
          lead: [
            "Alguien intentó crear una cuenta de Ledger Flow con esta dirección. Una cuenta dejó de usarla hace pocos días y todavía puede volver a ella, así que queda reservada para esa cuenta hasta el ",
            { strong: day(data.freeOn) },
            ".",
          ],
          line: "Si esa cuenta es tuya, el correo sobre el cambio tiene un enlace para deshacerlo. Si no, ignora este correo.",
          reason: base.reason,
        };
      }
      const signIn = { label: shared.signIn, url: link("login") };
      const forgot = { label: shared.reset, url: link("forgot") };
      if (data.state === "deleted") {
        return {
          subject: base.subject,
          preview: `Entra a más tardar el ${day(data.keptUntil)} para restaurarla.`,
          title: "Tu cuenta eliminada todavía puede volver",
          lead: [
            `Alguien intentó crear una cuenta de Ledger Flow con esta dirección. Tiene una, eliminada el ${day(data.deletedOn)}: se conserva hasta el `,
            { strong: day(data.keptUntil) },
            ", y si entras a más tardar ese día la restauras.",
          ],
          line: "Después se borra para siempre y esta dirección queda libre para una cuenta nueva. Si no fuiste tú, ignora este correo.",
          button: signIn,
          box: {
            heading: base.boxHeading,
            body: "Al elegir una nueva también la restauras. Se cierra la sesión en todos los dispositivos.",
            action: forgot,
          },
          reason: base.reason,
        };
      }
      return {
        subject: base.subject,
        preview:
          "Entra con ella, o elige una contraseña nueva si la olvidaste.",
        title: "Ya tienes una cuenta",
        lead: [
          "Alguien intentó crear una cuenta de Ledger Flow con esta dirección, y ya tiene una. Si fuiste tú, entra con ella.",
        ],
        line: "Si no fuiste tú, ignora este correo: no cambió nada.",
        button: signIn,
        box: {
          heading: base.boxHeading,
          body: "Elige una nueva con un código que llega aquí. Se cierra la sesión en todos los dispositivos.",
          action: forgot,
        },
        reason: base.reason,
      };
    },
  },
  "confirm-deadline": {
    en: (data, { shared, link, day }) => ({
      subject: `Confirm your email for Ledger Flow by ${day(data.deadline)}`,
      preview: DEADLINE.en.preview,
      title: `Confirm your email by ${day(data.deadline)}`,
      lead: [
        "Ledger Flow now asks every account to confirm its email: that way nobody else can use your address, and our security notices reach you. Nothing in your account changes.",
      ],
      line: DEADLINE.en.line(day(data.deadline)),
      button: { label: shared.confirmEmail, url: link("verify", data.token) },
      box: DEADLINE.en.box,
      reason: DEADLINE.en.reason,
    }),
    es: (data, { shared, link, day }) => ({
      subject: `Confirma tu correo de Ledger Flow a más tardar el ${day(data.deadline)}`,
      preview: DEADLINE.es.preview,
      title: `Confirma tu correo a más tardar el ${day(data.deadline)}`,
      lead: [
        "Ledger Flow ahora pide a todas las cuentas confirmar su correo: así nadie más puede usar tu dirección y te llegan nuestros avisos de seguridad. En tu cuenta no cambia nada.",
      ],
      line: DEADLINE.es.line(day(data.deadline)),
      button: { label: shared.confirmEmail, url: link("verify", data.token) },
      box: DEADLINE.es.box,
      reason: DEADLINE.es.reason,
    }),
  },
  "confirm-deadline-reminder": {
    en: (data, { shared, link, day }) => ({
      subject: `${daysLeft("en", data.daysLeft)} to confirm your email for Ledger Flow`,
      preview: DEADLINE.en.preview,
      title: `${daysLeft("en", data.daysLeft)} to confirm your email`,
      lead: [
        "Confirm it by ",
        { strong: day(data.deadline) },
        " to keep signing in as usual. Nothing in your account changes.",
      ],
      line: DEADLINE.en.line(day(data.deadline)),
      button: { label: shared.confirmEmail, url: link("verify", data.token) },
      box: DEADLINE.en.box,
      reason: DEADLINE.en.reason,
    }),
    es: (data, { shared, link, day }) => ({
      subject: `${daysLeft("es", data.daysLeft)} para confirmar tu correo de Ledger Flow`,
      preview: DEADLINE.es.preview,
      title: `${daysLeft("es", data.daysLeft)} para confirmar tu correo`,
      lead: [
        "Confírmalo a más tardar el ",
        { strong: day(data.deadline) },
        " para seguir entrando como siempre. En tu cuenta no cambia nada.",
      ],
      line: DEADLINE.es.line(day(data.deadline)),
      button: { label: shared.confirmEmail, url: link("verify", data.token) },
      box: DEADLINE.es.box,
      reason: DEADLINE.es.reason,
    }),
  },
  "email-change-taken": {
    en: (_data, { shared, link }) => ({
      subject: "Your address was asked for by another Ledger Flow account",
      preview: "Nothing changes: this address already has an account.",
      title: "This address already has an account",
      lead: [
        "Someone asked to move another Ledger Flow account to this address. It already has one, so nothing changes.",
      ],
      line: "If it was you, sign in with this address instead. If it wasn’t, ignore this email.",
      button: { label: shared.signIn, url: link("login") },
      reason: "someone asked to use this address for a Ledger Flow account",
    }),
    es: (_data, { shared, link }) => ({
      subject: "Otra cuenta de Ledger Flow pidió usar tu dirección",
      preview: "No cambia nada: esta dirección ya tiene una cuenta.",
      title: "Esta dirección ya tiene una cuenta",
      lead: [
        "Alguien pidió pasar otra cuenta de Ledger Flow a esta dirección. Ya tiene una, así que no cambia nada.",
      ],
      line: "Si fuiste tú, entra con esta dirección. Si no, ignora este correo.",
      button: { label: shared.signIn, url: link("login") },
      reason: "alguien pidió usar esta dirección en una cuenta de Ledger Flow",
    }),
  },
};

interface NoticeWords extends Words {
  box: Box;
}

const resetBox = ({ shared, link }: Tools): Box => ({
  heading: shared.notYou,
  body: shared.resetBox,
  action: { label: shared.reset, url: link("forgot") },
});

const undoBox = (
  body: string,
  token: string,
  { shared, link }: Tools,
): Box => ({
  heading: shared.notYou,
  body,
  action: { label: shared.undo, url: link("undo", token) },
});

const NOTICE_WORDS: { [T in NoticeTemplate]: ByLocale<NoticeWords, T> } = {
  "password-changed": {
    en: (_data, tools) => ({
      subject: "Your Ledger Flow password was changed",
      preview: "If it wasn’t you, reset it now.",
      title: "Your password was changed",
      lead: [
        "Your other devices were signed out. If you made this change, there’s nothing else to do.",
      ],
      box: {
        ...resetBox(tools),
        body: "Reset your password now. It signs out every device, including the one that changed it.",
      },
    }),
    es: (_data, tools) => ({
      subject: "Se cambió la contraseña de tu cuenta de Ledger Flow",
      preview: "Si no fuiste tú, restablécela ya.",
      title: "Se cambió tu contraseña",
      lead: [
        "Se cerró la sesión en tus otros dispositivos. Si fuiste tú, no tienes que hacer nada más.",
      ],
      box: {
        ...resetBox(tools),
        body: "Restablece tu contraseña ya. Se cierra la sesión en todos los dispositivos, también en el que la cambió.",
      },
    }),
  },
  "email-change-requested": {
    en: (data, tools) => ({
      subject: "Someone asked to change your Ledger Flow email",
      preview: tools.shared.undoPreview,
      title: "A change to your email was requested",
      lead: [
        "A request was made to change your account’s email to ",
        { strong: data.newEmail },
        ". It changes once that address is confirmed.",
      ],
      box: undoBox(
        "Undo it: your account keeps this address, every device is signed out and you choose a new password. This link works for 7 days, even if the change was already confirmed.",
        data.undoToken,
        tools,
      ),
    }),
    es: (data, tools) => ({
      subject: "Se pidió cambiar el correo de tu cuenta de Ledger Flow",
      preview: tools.shared.undoPreview,
      title: "Se pidió cambiar tu correo",
      lead: [
        "Se pidió cambiar el correo de tu cuenta a ",
        { strong: data.newEmail },
        ". El cambio se hace cuando se confirme esa dirección.",
      ],
      box: undoBox(
        "Deshazlo: tu cuenta se queda con esta dirección, se cierra la sesión en todos los dispositivos y eliges una contraseña nueva. El enlace vale por 7 días, aunque el cambio ya se haya confirmado.",
        data.undoToken,
        tools,
      ),
    }),
  },
  "new-sign-in": {
    en: (data, tools) => ({
      subject: `New sign-in to Ledger Flow: ${describeDevice(data.userAgent, "en")}`,
      preview: "If it was you, there’s nothing to do.",
      title: "New sign-in to your account",
      lead: [
        "Your account was signed in on a device we don’t recognize. If it was you, there’s nothing to do.",
      ],
      box: resetBox(tools),
    }),
    es: (data, tools) => ({
      subject: `Nuevo acceso a Ledger Flow: ${describeDevice(data.userAgent, "es")}`,
      preview: "Si fuiste tú, no tienes que hacer nada.",
      title: "Nuevo acceso a tu cuenta",
      lead: [
        "Se inició sesión en tu cuenta desde un dispositivo que no reconocemos. Si fuiste tú, no tienes que hacer nada.",
      ],
      box: resetBox(tools),
    }),
  },
  "account-deleted": {
    en: (data, { shared, link, day }) => ({
      subject: "Your Ledger Flow account was deleted",
      preview: `It’s kept until ${day(data.keptUntil)}. Signing in before then restores it.`,
      title: "Your account was deleted",
      lead: [
        "Every device was signed out. Your account and everything in it are kept until ",
        { strong: day(data.keptUntil) },
        ", and then erased for good. If you change your mind, sign in with this email and your password before then.",
      ],
      box: {
        heading: "Didn’t delete it?",
        body: `Restore it now: every device is signed out and you choose a new password. This link works for 7 days; after that, Forgot your password? also restores it until ${day(data.keptUntil)}.`,
        action: {
          label: shared.restore,
          url: link("restore", data.restoreToken),
        },
      },
    }),
    es: (data, { shared, link, day }) => ({
      subject: "Tu cuenta de Ledger Flow se eliminó",
      preview: `Se conserva hasta el ${day(data.keptUntil)}. Si entras antes, la restauras.`,
      title: "Tu cuenta se eliminó",
      lead: [
        "Se cerró la sesión en todos los dispositivos. Tu cuenta y todo lo que tiene se conservan hasta el ",
        { strong: day(data.keptUntil) },
        ", y después se borran para siempre. Si cambias de idea, entra con este correo y tu contraseña antes de esa fecha.",
      ],
      box: {
        heading: "¿No la eliminaste?",
        body: `Restáurala ya: se cierra la sesión en todos los dispositivos y eliges una contraseña nueva. El enlace vale por 7 días; después, «¿Olvidaste tu contraseña?» también la restaura hasta el ${day(data.keptUntil)}.`,
        action: {
          label: shared.restore,
          url: link("restore", data.restoreToken),
        },
      },
    }),
  },
  "account-restored": {
    en: (data, tools) => ({
      subject: "Your Ledger Flow account was restored",
      preview: tools.shared.resetPreview,
      title: "Your account was restored",
      lead: [
        data.by === "sign-in"
          ? `Your account, deleted on ${tools.day(data.deletedOn)}, was restored by signing in: everything in it is back except the shared groups it left, and it won’t be erased.`
          : `Your account, deleted on ${tools.day(data.deletedOn)}, was restored by choosing a new password: everything in it is back except the shared groups it left, and it won’t be erased. Every other device was signed out.`,
      ],
      box: resetBox(tools),
    }),
    es: (data, tools) => ({
      subject: "Tu cuenta de Ledger Flow se restauró",
      preview: tools.shared.resetPreview,
      title: "Se restauró tu cuenta",
      lead: [
        data.by === "sign-in"
          ? `Tu cuenta, eliminada el ${tools.day(data.deletedOn)}, se restauró al entrar: vuelve todo lo que tenía menos los grupos compartidos que dejó, y ya no se va a borrar.`
          : `Tu cuenta, eliminada el ${tools.day(data.deletedOn)}, se restauró al elegir una contraseña nueva: vuelve todo lo que tenía menos los grupos compartidos que dejó, y ya no se va a borrar. Se cerró la sesión en los demás dispositivos.`,
      ],
      box: resetBox(tools),
    }),
  },
  "passkey-added": {
    en: (data, tools) => ({
      subject: "A passkey was added to your Ledger Flow account",
      preview: tools.shared.undoPreview,
      title: "A passkey was added",
      lead: [
        "A new passkey can now sign in to your account without a password.",
      ],
      box: undoBox(tools.shared.undoFactorBox, data.undoToken, tools),
    }),
    es: (data, tools) => ({
      subject: "Se añadió una llave de acceso a tu cuenta de Ledger Flow",
      preview: tools.shared.undoPreview,
      title: "Se añadió una llave de acceso",
      lead: [
        "Una llave de acceso nueva ya puede entrar a tu cuenta sin contraseña.",
      ],
      box: undoBox(tools.shared.undoFactorBox, data.undoToken, tools),
    }),
  },
  "two-factor-on": {
    en: (data, tools) => ({
      subject: "Two-step verification is on for Ledger Flow",
      preview: tools.shared.undoPreview,
      title: "Two-step verification is on",
      lead: [
        "Signing in now also asks for a code from your authenticator app.",
      ],
      box: undoBox(tools.shared.undoFactorBox, data.undoToken, tools),
    }),
    es: (data, tools) => ({
      subject: "La verificación en dos pasos está activa en Ledger Flow",
      preview: tools.shared.undoPreview,
      title: "La verificación en dos pasos está activa",
      lead: ["Entrar ahora pide también un código de tu app de autenticación."],
      box: undoBox(tools.shared.undoFactorBox, data.undoToken, tools),
    }),
  },
  "passkey-removed": {
    en: (_data, tools) => ({
      subject: "A passkey was removed from your Ledger Flow account",
      preview: tools.shared.resetPreview,
      title: "A passkey was removed",
      lead: ["That passkey can no longer sign in to your account."],
      box: resetBox(tools),
    }),
    es: (_data, tools) => ({
      subject: "Se quitó una llave de acceso de tu cuenta de Ledger Flow",
      preview: tools.shared.resetPreview,
      title: "Se quitó una llave de acceso",
      lead: ["Esa llave de acceso ya no puede entrar a tu cuenta."],
      box: resetBox(tools),
    }),
  },
  "two-factor-off": {
    en: (_data, tools) => ({
      subject: "Two-step verification is off for Ledger Flow",
      preview: tools.shared.resetPreview,
      title: "Two-step verification is off",
      lead: [
        "Signing in no longer asks for a code from your authenticator app.",
      ],
      box: resetBox(tools),
    }),
    es: (_data, tools) => ({
      subject: "La verificación en dos pasos se desactivó en Ledger Flow",
      preview: tools.shared.resetPreview,
      title: "La verificación en dos pasos se desactivó",
      lead: ["Entrar ya no pide un código de tu app de autenticación."],
      box: resetBox(tools),
    }),
  },
  "recovery-code-used": {
    en: (data, tools) => {
      const usedTo =
        data.usedTo === "sign-in" ? "sign in" : "reset your password";
      const rest =
        data.left === 0
          ? "That was your last one: create new codes in Settings › Security."
          : `You have ${data.left} left, and each one works once.`;
      return {
        subject: "A recovery code was used on your Ledger Flow account",
        preview: `${data.left === 0 ? "None left." : `You have ${data.left} left.`} ${tools.shared.resetPreview}`,
        title: "A recovery code was used",
        lead: [`One of your recovery codes was used to ${usedTo}. ${rest}`],
        box: {
          ...resetBox(tools),
          body: "Reset your password now, then create new codes in Settings › Security.",
        },
      };
    },
    es: (data, tools) => {
      const usedTo =
        data.usedTo === "sign-in" ? "entrar" : "restablecer la contraseña";
      const left = data.left === 1 ? "Te queda 1" : `Te quedan ${data.left}`;
      const rest =
        data.left === 0
          ? "Era el último: crea códigos nuevos en Ajustes › Seguridad."
          : `${left} y cada uno sirve una vez.`;
      return {
        subject: "Se usó un código de recuperación en tu cuenta de Ledger Flow",
        preview: `${data.left === 0 ? "No te queda ninguno." : `${left}.`} ${tools.shared.resetPreview}`,
        title: "Se usó un código de recuperación",
        lead: [
          `Se usó uno de tus códigos de recuperación para ${usedTo}. ${rest}`,
        ],
        box: {
          ...resetBox(tools),
          body: "Restablece tu contraseña ya y después crea códigos nuevos en Ajustes › Seguridad.",
        },
      };
    },
  },
};

const CODE_FORMAT = /^\d{6}$/;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{16,}$/;
const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const strictEmail = z.email();

const LOCALE_TAGS: Record<Locale, string> = { en: "en-US", es: "es-CO" };

const MASK = "•••";

// The account's own address in email-change-confirm: enough for its owner to tell it apart, not enough to learn it.
export function maskEmail(email: string): string {
  strictEmail.parse(email);
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const kept = local.length <= 3 ? 1 : 2;
  return `${local.slice(0, kept)}${MASK}${email.slice(at)}`;
}

function assertFormat(value: string, format: RegExp, field: string): void {
  if (!format.test(value)) {
    throw new Error(`Email template input ${field} is malformed`);
  }
}

function linkTo(context: RenderContext, path: string, token?: string): string {
  const base = context.appUrl.replace(/\/+$/, "");
  const url = `${base}/${context.locale}/${path}`;
  if (token === undefined) return url;
  assertFormat(token, TOKEN_FORMAT, "token");
  return `${url}#token=${token}`;
}

function formatDay(day: Day, context: RenderContext): string {
  assertFormat(day, DAY_FORMAT, "day");
  const [year, month, date] = day.split("-").map(Number);
  const thisYear = DateTime.fromJSDate(context.now, {
    zone: context.timezone,
  }).year;
  return new Intl.DateTimeFormat(LOCALE_TAGS[context.locale], {
    ...(year === thisYear ? {} : { year: "numeric" }),
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date, 12)));
}

function formatWhen(at: Date, context: RenderContext): string[] {
  const parts = new Intl.DateTimeFormat(LOCALE_TAGS[context.locale], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: context.timezone,
    timeZoneName: "shortOffset",
  }).formatToParts(at);
  const hour = parts.findIndex((part) => part.type === "hour");
  const text = (slice: Intl.DateTimeFormatPart[]): string =>
    slice.map((part) => part.value).join("");
  return [text(parts.slice(0, hour)).trimEnd(), text(parts.slice(hour))];
}

function frame(
  tools: Tools,
  footer: string,
): Pick<
  EmailContent,
  "locale" | "fallbackLabel" | "footer" | "site" | "contact"
> {
  const { context, shared } = tools;
  return {
    locale: context.locale,
    fallbackLabel: shared.fallback,
    footer,
    site: {
      label: new URL(context.appUrl).host,
      url: tools.link("").replace(/\/$/, ""),
    },
    contact: { label: shared.contact, address: context.contact },
  };
}

const visible = (
  words: Words,
): Pick<
  EmailContent,
  "subject" | "preview" | "title" | "lead" | "extra" | "box"
> => ({
  subject: words.subject,
  preview: words.preview,
  title: words.title,
  lead: words.lead,
  extra: words.line,
  box: words.box,
});

const isNotice = (template: EmailTemplate): template is NoticeTemplate =>
  EMAIL_TEMPLATE_META[template].kind === "notice";

const isLink = (template: EmailTemplate): template is LinkTemplate =>
  EMAIL_TEMPLATE_META[template].kind === "link";

function content<T extends EmailTemplate>(
  template: T,
  data: EmailTemplateData[T],
  tools: Tools,
): EmailContent {
  const { shared, context } = tools;
  if (isNotice(template)) {
    const build = NOTICE_WORDS[template][context.locale] as Builder<
      NoticeWords,
      typeof template
    >;
    const words = build(data as EmailTemplateData[typeof template], tools);
    const facts = data as unknown as NoticeFacts;
    return {
      ...frame(tools, shared.security),
      ...visible(words),
      middle: {
        kind: "facts",
        facts: [
          { label: shared.when, value: formatWhen(facts.at, context) },
          {
            label: shared.device,
            value: [describeDevice(facts.userAgent, context.locale)],
          },
        ],
      },
    };
  }
  if (isLink(template)) {
    const build = LINK_WORDS[template][context.locale] as Builder<
      LinkWords,
      typeof template
    >;
    const words = build(data as EmailTemplateData[typeof template], tools);
    return {
      ...frame(tools, shared.why(words.reason)),
      ...visible(words),
      middle: words.button
        ? { kind: "action", button: words.button }
        : undefined,
    };
  }
  const codeTemplate = template as OnlyCode;
  const build = CODE_WORDS[codeTemplate][context.locale] as Builder<
    CodeWords,
    typeof codeTemplate
  >;
  const codeData = data as unknown as CodeLink;
  assertFormat(codeData.code, CODE_FORMAT, "code");
  const words = build(data as EmailTemplateData[typeof codeTemplate], tools);
  const route = CODE_ROUTES[codeTemplate];
  return {
    ...frame(tools, shared.why(words.reason)),
    ...visible(words),
    middle: {
      kind: "code",
      code: codeData.code,
      note: `${shared[route.lifetime]} ${shared.codeNote}`,
      button: {
        label: words.button,
        url: tools.link(route.path, codeData.token),
      },
    },
  };
}

export function renderEmail<T extends EmailTemplate>(
  template: T,
  data: EmailTemplateData[T],
  context: RenderContext,
): RenderedEmail {
  if (template === "email-change-requested") {
    strictEmail.parse(
      (data as EmailTemplateData["email-change-requested"]).newEmail,
    );
  }
  if (template === "recovery-code-used") {
    const { left } = data as EmailTemplateData["recovery-code-used"];
    if (!Number.isInteger(left) || left < 0) {
      throw new Error("Email template input left is malformed");
    }
  }
  if (template === "confirm-deadline-reminder") {
    const { daysLeft: days } =
      data as EmailTemplateData["confirm-deadline-reminder"];
    if (!Number.isInteger(days) || days < 1) {
      throw new Error("Email template input daysLeft is malformed");
    }
  }
  const tools: Tools = {
    shared: SHARED[context.locale],
    context,
    link: (path, token) => linkTo(context, path, token),
    day: (day) => formatDay(day, context),
  };
  const built = content(template, data, tools);
  return {
    subject: built.subject,
    html: renderHtml(built),
    text: renderText(built),
  };
}
