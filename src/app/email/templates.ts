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

export interface EmailTemplateData {
  "verify-email": CodeLink & { notMeToken?: string };
  "password-reset": CodeLink;
  "password-reset-after-undo": CodeLink;
  "email-change-confirm": CodeLink;
  "password-changed": NoticeFacts;
  "email-change-requested": NoticeFacts & {
    newEmail: string;
    undoToken: string;
  };
  "new-sign-in": NoticeFacts;
  "account-deleted": NoticeFacts;
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
  kind: "code" | "notice";
  budget: EmailBudget;
  purpose: string;
  addressDaily: boolean;
  perUser: boolean;
}

export const EMAIL_TEMPLATE_META = {
  "verify-email": {
    kind: "code",
    budget: "security",
    purpose: "verify",
    addressDaily: true,
    perUser: true,
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
  "password-changed": notice("password-changed"),
  "email-change-requested": notice("email-change-requested"),
  "new-sign-in": notice("new-sign-in"),
  "account-deleted": notice("account-deleted"),
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

export type CodeTemplate = {
  [K in EmailTemplate]: Meta[K]["kind"] extends "code" ? K : never;
}[EmailTemplate];

export type NoticeTemplate = Exclude<EmailTemplate, CodeTemplate>;

export interface RenderContext {
  locale: Locale;
  timezone: string;
  appUrl: string;
  contact: string;
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
    code24h: "Sirve 24 horas. Si pides otro, este deja de servir.",
    code30m: "Sirve 30 minutos. Si pides otro, este deja de servir.",
    when: "Cuándo",
    device: "Dispositivo",
    why: (reason: string) => `Te llega porque ${reason}.`,
    security:
      "Es un aviso de seguridad de tu cuenta de Ledger Flow. Estos avisos no se pueden desactivar: así te contamos lo que pasa con tu cuenta.",
    contact: "¿Dudas?",
    notYou: "¿No fuiste tú?",
    reset: "Restablecer contraseña",
    undo: "Deshacer el cambio",
    resetBox:
      "Restablece tu contraseña ya. Se cierra la sesión en todos los dispositivos.",
    undoFactorBox:
      "Deshazlo: quitamos las llaves de acceso, la app de autenticación y los códigos de recuperación añadidos desde entonces, se cierra la sesión en todos los dispositivos y eliges una contraseña nueva. El enlace sirve 7 días.",
    undoPreview: "Si no fuiste tú, deshazlo desde este correo.",
    resetPreview: "Si no fuiste tú, restablece tu contraseña ya.",
  },
} as const satisfies Record<Locale, unknown>;

type Shared = (typeof SHARED)[Locale];

interface CodeWords {
  subject: string;
  preview: string;
  title: string;
  lead: string;
  button: string;
  boxHeading: string;
  boxBody: string;
  boxAction?: string;
  reason: string;
}

interface NoticeWords {
  subject: string;
  preview: string;
  title: string;
  lead: Inline[];
  extra?: string;
  box: { heading?: string; body: string; action: string };
}

const CODE_WORDS: Record<CodeTemplate, Record<Locale, CodeWords>> = {
  "verify-email": {
    en: {
      subject: "Confirm your email for Ledger Flow",
      preview:
        "Type the code in the app or use the button. It works for 24 hours.",
      title: "Confirm your email",
      lead: "Type this code in Ledger Flow to confirm this address is yours.",
      button: "Confirm email",
      boxHeading: "Didn’t sign up?",
      boxBody:
        "Someone typed your address when signing up. Use “It wasn’t me” to delete that account and free your address.",
      boxAction: "It wasn’t me",
      reason: "someone signed up for Ledger Flow with this address",
    },
    es: {
      subject: "Confirma tu correo en Ledger Flow",
      preview: "Escribe el código en la app o usa el botón. Sirve 24 horas.",
      title: "Confirma tu correo",
      lead: "Escribe este código en Ledger Flow para confirmar que esta dirección es tuya.",
      button: "Confirmar correo",
      boxHeading: "¿No te registraste?",
      boxBody:
        "Alguien escribió tu dirección al registrarse. Usa «No fui yo» para eliminar esa cuenta y liberar tu correo.",
      boxAction: "No fui yo",
      reason: "alguien se registró en Ledger Flow con esta dirección",
    },
  },
  "password-reset": {
    en: {
      subject: "Reset your Ledger Flow password",
      preview:
        "The code works for 30 minutes. If you didn’t ask for it, ignore this email.",
      title: "Reset your password",
      lead: "Type this code in Ledger Flow to choose a new password. Your other devices will be signed out.",
      button: "Choose a new password",
      boxHeading: "Didn’t ask for this?",
      boxBody:
        "Ignore this email. Your password stays the same, and the code and the link stop working in 30 minutes.",
      reason:
        "someone asked to reset the password of the Ledger Flow account with this address",
    },
    es: {
      subject: "Restablece tu contraseña de Ledger Flow",
      preview:
        "El código sirve 30 minutos. Si no lo pediste, ignora este correo.",
      title: "Restablece tu contraseña",
      lead: "Escribe este código en Ledger Flow para elegir una contraseña nueva. Se cerrará la sesión en tus otros dispositivos.",
      button: "Elegir una contraseña nueva",
      boxHeading: "¿No lo pediste?",
      boxBody:
        "Ignora este correo. Tu contraseña sigue igual, y el código y el enlace dejan de servir en 30 minutos.",
      reason:
        "alguien pidió restablecer la contraseña de la cuenta de Ledger Flow con esta dirección",
    },
  },
  "password-reset-after-undo": {
    en: {
      subject: "Choose a new password for Ledger Flow",
      preview:
        "You undid a change to your account. The code works for 30 minutes.",
      title: "Choose a new password",
      lead: "You undid a change to your account from this address, and every device was signed out. Type this code in Ledger Flow to choose a new password: the old one no longer works.",
      button: "Choose a new password",
      boxHeading: "Code expired?",
      boxBody:
        "Ask for another one with “Forgot your password?” on the Sign in screen.",
      reason:
        "you undid a change to your Ledger Flow account from this address",
    },
    es: {
      subject: "Elige una contraseña nueva para Ledger Flow",
      preview: "Deshiciste un cambio en tu cuenta. El código sirve 30 minutos.",
      title: "Elige una contraseña nueva",
      lead: "Deshiciste un cambio en tu cuenta desde esta dirección y se cerró la sesión en todos los dispositivos. Escribe este código en Ledger Flow para elegir una contraseña nueva: la anterior ya no sirve.",
      button: "Elegir una contraseña nueva",
      boxHeading: "¿Se venció el código?",
      boxBody:
        "Pide otro con «¿Olvidaste tu contraseña?» en la pantalla de Entrar.",
      reason:
        "deshiciste un cambio en tu cuenta de Ledger Flow desde esta dirección",
    },
  },
  "email-change-confirm": {
    en: {
      subject: "Confirm your new email for Ledger Flow",
      preview:
        "Your account moves to this address once you confirm it. It works for 24 hours.",
      title: "Confirm your new email",
      lead: "Type this code in Ledger Flow to move your account to this address. Until you do, it keeps its current email. Confirming signs out your other devices.",
      button: "Confirm new email",
      boxHeading: "Didn’t ask for this?",
      boxBody:
        "Ignore this email. Nothing changes, and this address isn’t added to any account.",
      reason: "someone asked to use this address for a Ledger Flow account",
    },
    es: {
      subject: "Confirma tu correo nuevo de Ledger Flow",
      preview:
        "Tu cuenta pasa a esta dirección cuando la confirmes. Sirve 24 horas.",
      title: "Confirma tu correo nuevo",
      lead: "Escribe este código en Ledger Flow para pasar tu cuenta a esta dirección. Mientras no lo hagas, sigue con su correo actual. Al confirmar se cierra la sesión en tus otros dispositivos.",
      button: "Confirmar correo nuevo",
      boxHeading: "¿No lo pediste?",
      boxBody:
        "Ignora este correo. No cambia nada y esta dirección no se añade a ninguna cuenta.",
      reason: "alguien pidió usar esta dirección en una cuenta de Ledger Flow",
    },
  },
};

const CODE_LINKS: Record<
  CodeTemplate,
  { path: string; lifetime: "code24h" | "code30m"; boxPath?: string }
> = {
  "verify-email": { path: "verify", lifetime: "code24h", boxPath: "not-me" },
  "password-reset": { path: "reset", lifetime: "code30m" },
  "password-reset-after-undo": { path: "reset", lifetime: "code30m" },
  "email-change-confirm": { path: "confirm-email", lifetime: "code24h" },
};

type NoticeWordBuilder<T extends NoticeTemplate> = (
  data: EmailTemplateData[T],
  shared: Shared,
  context: RenderContext,
) => NoticeWords;

const NOTICE_WORDS: {
  [T in NoticeTemplate]: Record<Locale, NoticeWordBuilder<T>>;
} = {
  "password-changed": {
    en: (_data, s) => ({
      subject: "Your Ledger Flow password was changed",
      preview: "If it wasn’t you, reset it now.",
      title: "Your password was changed",
      lead: [
        "Your other devices were signed out. If you made this change, there’s nothing else to do.",
      ],
      box: {
        body: "Reset your password now. It signs out every device, including the one that changed it.",
        action: s.reset,
      },
    }),
    es: (_data, s) => ({
      subject: "Se cambió la contraseña de tu cuenta de Ledger Flow",
      preview: "Si no fuiste tú, restablécela ya.",
      title: "Se cambió tu contraseña",
      lead: [
        "Se cerró la sesión en tus otros dispositivos. Si fuiste tú, no tienes que hacer nada más.",
      ],
      box: {
        body: "Restablece tu contraseña ya. Se cierra la sesión en todos los dispositivos, también en el que la cambió.",
        action: s.reset,
      },
    }),
  },
  "email-change-requested": {
    en: (data, s) => ({
      subject: "Your Ledger Flow email is being changed",
      preview: s.undoPreview,
      title: "Your email is being changed",
      lead: [
        "Someone asked to move your account to ",
        { strong: data.newEmail },
        ". It moves once that address is confirmed.",
      ],
      box: {
        body: "Undo it: your account keeps this address, every device is signed out and you choose a new password. This link works for 7 days, even if the change was already confirmed.",
        action: s.undo,
      },
    }),
    es: (data, s) => ({
      subject: "Se pidió cambiar el correo de tu cuenta de Ledger Flow",
      preview: s.undoPreview,
      title: "Se pidió cambiar tu correo",
      lead: [
        "Se pidió pasar tu cuenta a ",
        { strong: data.newEmail },
        ". El cambio se hace cuando se confirme esa dirección.",
      ],
      box: {
        body: "Deshazlo: tu cuenta se queda con esta dirección, se cierra la sesión en todos los dispositivos y eliges una contraseña nueva. El enlace sirve 7 días, aunque el cambio ya se haya confirmado.",
        action: s.undo,
      },
    }),
  },
  "new-sign-in": {
    en: (data, s, context) => ({
      subject: `New sign-in to Ledger Flow: ${describeDevice(data.userAgent, context.locale)}`,
      preview: "If it was you, there’s nothing to do.",
      title: "New sign-in to your account",
      lead: [
        "Your account was signed in on a device we don’t recognize. If it was you, there’s nothing to do.",
      ],
      box: { body: s.resetBox, action: s.reset },
    }),
    es: (data, s, context) => ({
      subject: `Nuevo acceso a Ledger Flow: ${describeDevice(data.userAgent, context.locale)}`,
      preview: "Si fuiste tú, no tienes que hacer nada.",
      title: "Nuevo acceso a tu cuenta",
      lead: [
        "Se inició sesión en tu cuenta desde un dispositivo que no reconocemos. Si fuiste tú, no tienes que hacer nada.",
      ],
      box: { body: s.resetBox, action: s.reset },
    }),
  },
  "account-deleted": {
    en: (_data, _s, context) => ({
      subject: "Your Ledger Flow account was deleted",
      preview:
        "Signing up again with this email and the password it had brings it back.",
      title: "Your account was deleted",
      lead: [
        "Every device was signed out. Your account and your financial history are kept for a while: signing up again with this email and the password it had brings everything back.",
      ],
      extra: `To have it erased for good, write to ${context.contact}: it’s done within 15 business days.`,
      box: {
        heading: "Didn’t delete it?",
        body: "Signing up again with this email and the password it had when it was deleted brings it back. Then change the password in Settings.",
        action: "Create account",
      },
    }),
    es: (_data, _s, context) => ({
      subject: "Tu cuenta de Ledger Flow se eliminó",
      preview:
        "Si te registras de nuevo con este correo y la contraseña que tenía, la recuperas.",
      title: "Tu cuenta se eliminó",
      lead: [
        "Se cerró la sesión en todos los dispositivos. Tu cuenta y tu historial financiero se conservan un tiempo: si te registras de nuevo con este correo y la contraseña que tenía, lo recuperas todo.",
      ],
      extra: `Para borrarla del todo, escribe a ${context.contact}: se hace en 15 días hábiles.`,
      box: {
        heading: "¿No la eliminaste?",
        body: "Si te registras de nuevo con este correo y la contraseña que tenía al eliminarse, la recuperas. Después cambia la contraseña en Ajustes.",
        action: "Crear cuenta",
      },
    }),
  },
  "passkey-added": {
    en: (_data, s) => ({
      subject: "A passkey was added to your Ledger Flow account",
      preview: s.undoPreview,
      title: "A passkey was added",
      lead: [
        "A new passkey can now sign in to your account without a password.",
      ],
      box: { body: s.undoFactorBox, action: s.undo },
    }),
    es: (_data, s) => ({
      subject: "Se añadió una llave de acceso a tu cuenta de Ledger Flow",
      preview: s.undoPreview,
      title: "Se añadió una llave de acceso",
      lead: [
        "Una llave de acceso nueva ya puede entrar a tu cuenta sin contraseña.",
      ],
      box: { body: s.undoFactorBox, action: s.undo },
    }),
  },
  "two-factor-on": {
    en: (_data, s) => ({
      subject: "Two-step verification is on for Ledger Flow",
      preview: s.undoPreview,
      title: "Two-step verification is on",
      lead: [
        "Signing in now also asks for a code from your authenticator app.",
      ],
      box: { body: s.undoFactorBox, action: s.undo },
    }),
    es: (_data, s) => ({
      subject: "La verificación en dos pasos está activa en Ledger Flow",
      preview: s.undoPreview,
      title: "La verificación en dos pasos está activa",
      lead: ["Entrar ahora pide también un código de tu app de autenticación."],
      box: { body: s.undoFactorBox, action: s.undo },
    }),
  },
  "passkey-removed": {
    en: (_data, s) => ({
      subject: "A passkey was removed from your Ledger Flow account",
      preview: s.resetPreview,
      title: "A passkey was removed",
      lead: ["That passkey can no longer sign in to your account."],
      box: { body: s.resetBox, action: s.reset },
    }),
    es: (_data, s) => ({
      subject: "Se quitó una llave de acceso de tu cuenta de Ledger Flow",
      preview: s.resetPreview,
      title: "Se quitó una llave de acceso",
      lead: ["Esa llave de acceso ya no puede entrar a tu cuenta."],
      box: { body: s.resetBox, action: s.reset },
    }),
  },
  "two-factor-off": {
    en: (_data, s) => ({
      subject: "Two-step verification is off for Ledger Flow",
      preview: s.resetPreview,
      title: "Two-step verification is off",
      lead: [
        "Signing in no longer asks for a code from your authenticator app.",
      ],
      box: { body: s.resetBox, action: s.reset },
    }),
    es: (_data, s) => ({
      subject: "La verificación en dos pasos se desactivó en Ledger Flow",
      preview: s.resetPreview,
      title: "La verificación en dos pasos se desactivó",
      lead: ["Entrar ya no pide un código de tu app de autenticación."],
      box: { body: s.resetBox, action: s.reset },
    }),
  },
  "recovery-code-used": {
    en: (data, s) => {
      const usedTo =
        data.usedTo === "sign-in" ? "sign in" : "reset your password";
      const rest =
        data.left === 0
          ? "That was your last one: create new codes in Settings › Security."
          : `You have ${data.left} left, and each one works once.`;
      return {
        subject: "A recovery code was used on your Ledger Flow account",
        preview: `${data.left === 0 ? "None left." : `You have ${data.left} left.`} ${s.resetPreview}`,
        title: "A recovery code was used",
        lead: [`One of your recovery codes was used to ${usedTo}. ${rest}`],
        box: {
          body: "Reset your password now, then create new codes in Settings › Security.",
          action: s.reset,
        },
      };
    },
    es: (data, s) => {
      const usedTo =
        data.usedTo === "sign-in" ? "entrar" : "restablecer la contraseña";
      const left = data.left === 1 ? "Te queda 1" : `Te quedan ${data.left}`;
      const rest =
        data.left === 0
          ? "Era el último: crea códigos nuevos en Ajustes › Seguridad."
          : `${left} y cada uno sirve una vez.`;
      return {
        subject: "Se usó un código de recuperación en tu cuenta de Ledger Flow",
        preview: `${data.left === 0 ? "No te queda ninguno." : `${left}.`} ${s.resetPreview}`,
        title: "Se usó un código de recuperación",
        lead: [
          `Se usó uno de tus códigos de recuperación para ${usedTo}. ${rest}`,
        ],
        box: {
          body: "Restablece tu contraseña ya y después crea códigos nuevos en Ajustes › Seguridad.",
          action: s.reset,
        },
      };
    },
  },
};

const NOTICE_BOX_PATH: Record<NoticeTemplate, "forgot" | "undo" | "register"> =
  {
    "password-changed": "forgot",
    "email-change-requested": "undo",
    "new-sign-in": "forgot",
    "account-deleted": "register",
    "passkey-added": "undo",
    "two-factor-on": "undo",
    "passkey-removed": "forgot",
    "two-factor-off": "forgot",
    "recovery-code-used": "forgot",
  };

const CODE_FORMAT = /^\d{6}$/;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{16,}$/;
const strictEmail = z.email();

const LOCALE_TAGS: Record<Locale, string> = { en: "en-US", es: "es-CO" };

function assertFormat(value: string, format: RegExp, field: string): void {
  if (!format.test(value)) {
    throw new Error(`Email template input ${field} is malformed`);
  }
}

function link(
  context: RenderContext,
  path: string,
  token?: string,
): EmailButton["url"] {
  const base = context.appUrl.replace(/\/+$/, "");
  const url = `${base}/${context.locale}/${path}`;
  if (token === undefined) return url;
  assertFormat(token, TOKEN_FORMAT, "token");
  return `${url}#token=${token}`;
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
  context: RenderContext,
  shared: Shared,
  footer: string,
): Pick<
  EmailContent,
  "locale" | "fallbackLabel" | "footer" | "site" | "contact"
> {
  return {
    locale: context.locale,
    fallbackLabel: shared.fallback,
    footer,
    site: {
      label: new URL(context.appUrl).host,
      url: link(context, "").replace(/\/$/, ""),
    },
    contact: { label: shared.contact, address: context.contact },
  };
}

function codeContent(
  template: CodeTemplate,
  data: CodeLink & { notMeToken?: string },
  context: RenderContext,
): EmailContent {
  assertFormat(data.code, CODE_FORMAT, "code");
  const shared = SHARED[context.locale];
  const words = CODE_WORDS[template][context.locale];
  const links = CODE_LINKS[template];
  let boxAction: EmailButton | undefined;
  const withoutBox = !!links.boxPath && data.notMeToken === undefined;
  if (links.boxPath && words.boxAction && data.notMeToken !== undefined) {
    boxAction = {
      label: words.boxAction,
      url: link(context, links.boxPath, data.notMeToken),
    };
  }
  return {
    ...frame(context, shared, shared.why(words.reason)),
    subject: words.subject,
    preview: words.preview,
    title: words.title,
    lead: [words.lead],
    middle: {
      kind: "code",
      code: data.code,
      note: `${shared[links.lifetime]} ${shared.codeNote}`,
      button: {
        label: words.button,
        url: link(context, links.path, data.token),
      },
    },
    box: withoutBox
      ? undefined
      : { heading: words.boxHeading, body: words.boxBody, action: boxAction },
  };
}

function noticeContent<T extends NoticeTemplate>(
  template: T,
  data: EmailTemplateData[T],
  context: RenderContext,
): EmailContent {
  const shared = SHARED[context.locale];
  const builder = NOTICE_WORDS[template][
    context.locale
  ] as NoticeWordBuilder<T>;
  const words = builder(data, shared, context);
  const boxPath = NOTICE_BOX_PATH[template];
  const undoToken =
    "undoToken" in data && typeof data.undoToken === "string"
      ? data.undoToken
      : undefined;
  if (boxPath === "undo" && undoToken === undefined) {
    throw new Error(`Email template ${template} needs an undo token`);
  }
  return {
    ...frame(context, shared, shared.security),
    subject: words.subject,
    preview: words.preview,
    title: words.title,
    lead: words.lead,
    extra: words.extra,
    middle: {
      kind: "facts",
      facts: [
        { label: shared.when, value: formatWhen(data.at, context) },
        {
          label: shared.device,
          value: [describeDevice(data.userAgent, context.locale)],
        },
      ],
    },
    box: {
      heading: words.box.heading ?? shared.notYou,
      body: words.box.body,
      action: {
        label: words.box.action,
        url: link(context, boxPath, boxPath === "undo" ? undoToken : undefined),
      },
    },
  };
}

const isCodeTemplate = (template: EmailTemplate): template is CodeTemplate =>
  EMAIL_TEMPLATE_META[template].kind === "code";

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
  const content = isCodeTemplate(template)
    ? codeContent(template, data as CodeLink, context)
    : noticeContent(
        template as NoticeTemplate,
        data as EmailTemplateData[NoticeTemplate],
        context,
      );
  return {
    subject: content.subject,
    html: renderHtml(content),
    text: renderText(content),
  };
}
