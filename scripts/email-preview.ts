// npm run email:preview — every template in both languages, sent through EMAIL_PROVIDERS (Mailpit unless set).
import { setTimeout as sleep } from "timers/promises";
import { parseArgs } from "util";

import type {
  EmailTemplate,
  EmailTemplateData,
  RenderedEmail,
} from "../src/app/email/templates";

process.env.EMAIL_PROVIDERS ??= "mailpit";
process.env.JWT_SECRET ??= "email-preview";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.MONGO_URI ??= "mongodb://localhost:27017/email_preview_unused";

const SAMPLE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const SAMPLE_TOKEN = "q7Xk2mVb9RtL4wPz";
const SAMPLE_DELETED_ON = "2026-09-28";
const SAMPLE_KEPT_UNTIL = "2026-10-28";
const SES_SANDBOX_INTERVAL_MS = 1100;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      to: { type: "string" },
      only: { type: "string" },
    },
  });

  const { ENVIRONMENT } = await import("../src/shared/constants");
  const onlyMailpit = ENVIRONMENT.EMAIL_PROVIDERS.every((p) => p === "mailpit");
  if (!values.to && !onlyMailpit) {
    throw new Error(
      "Sending through a real provider needs --to <an address you own>: a made-up one bounces",
    );
  }
  const to = values.to ?? "preview@example.com";
  const { createEmailProviders } =
    await import("../src/infrastructure/email/emailProviders");
  const { sendThroughChain } = await import("../src/app/email/providerChain");
  const { EMAIL_TEMPLATE_META, renderEmail } =
    await import("../src/app/email/templates");
  const at = new Date();
  const facts = { at, userAgent: SAMPLE_USER_AGENT };
  const code = { code: "482913", token: SAMPLE_TOKEN };
  const deleted = {
    deletedOn: SAMPLE_DELETED_ON,
    keptUntil: SAMPLE_KEPT_UNTIL,
  };
  const samples: EmailTemplateData = {
    "sign-up": code,
    "account-exists": { state: "live" },
    "verify-email": code,
    "confirm-deadline": { token: SAMPLE_TOKEN, deadline: "2026-10-12" },
    "confirm-deadline-reminder": {
      token: SAMPLE_TOKEN,
      deadline: "2026-10-12",
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
      undoToken: SAMPLE_TOKEN,
    },
    "new-sign-in": facts,
    "account-deleted": {
      ...facts,
      keptUntil: SAMPLE_KEPT_UNTIL,
      restoreToken: SAMPLE_TOKEN,
    },
    "account-restored": {
      ...facts,
      deletedOn: SAMPLE_DELETED_ON,
      by: "sign-in",
    },
    "passkey-added": { ...facts, undoToken: SAMPLE_TOKEN },
    "two-factor-on": { ...facts, undoToken: SAMPLE_TOKEN },
    "passkey-removed": facts,
    "two-factor-off": facts,
    "recovery-code-used": { ...facts, left: 7, usedTo: "sign-in" },
  };
  // The other words of a template, each sent as one more email of it.
  const variants: {
    [T in EmailTemplate]?: EmailTemplateData[T][];
  } = {
    "account-exists": [
      { state: "deleted", ...deleted },
      { state: "held", freeOn: "2026-10-05" },
    ],
    "password-reset": [{ ...code, deleted }],
    "password-reset-after-undo": [{ ...code, restored: true }],
    "account-restored": [
      { ...facts, deletedOn: SAMPLE_DELETED_ON, by: "reset" },
    ],
  };

  const templates = (Object.keys(samples) as EmailTemplate[]).filter(
    (t) => !values.only || t === values.only,
  );
  const render = <T extends EmailTemplate>(
    template: T,
    data: EmailTemplateData[T],
    locale: "en" | "es",
  ): RenderedEmail =>
    renderEmail(template, data, {
      locale,
      timezone: "America/Bogota",
      appUrl: ENVIRONMENT.APP_URL,
      contact: ENVIRONMENT.EMAIL_REPLY_TO,
      now: at,
    });
  if (templates.length === 0) {
    throw new Error(`No template called ${values.only}`);
  }

  const providers = createEmailProviders();
  let failed = 0;
  let first = true;
  const sends = templates.flatMap((template) =>
    [samples[template], ...(variants[template] ?? [])].map((data) => ({
      template,
      data,
    })),
  );
  for (const { template, data } of sends) {
    for (const locale of ["en", "es"] as const) {
      // SES's sandbox takes one email a second, and the adapter does not retry a throttled one.
      if (!first && !onlyMailpit) await sleep(SES_SANDBOX_INTERVAL_MS);
      first = false;
      const rendered = render(template, data as never, locale);
      const result = await sendThroughChain(
        providers,
        {
          to,
          from: {
            name: ENVIRONMENT.EMAIL_FROM_NAME,
            address: ENVIRONMENT.EMAIL_FROM_ADDRESS,
          },
          replyTo: ENVIRONMENT.EMAIL_REPLY_TO,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          template,
          budget: EMAIL_TEMPLATE_META[template].budget,
        },
        ENVIRONMENT.EMAIL_PROVIDER_TIMEOUT_MS,
      );
      if (result.accepted) {
        console.log(`${template} (${locale}) → ${result.provider}`);
      } else {
        failed += 1;
        console.error(
          `${template} (${locale}) NOT SENT: ${JSON.stringify(result.failures)}`,
        );
      }
    }
  }
  if (failed > 0) {
    throw new Error(`${failed} emails were not sent`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
