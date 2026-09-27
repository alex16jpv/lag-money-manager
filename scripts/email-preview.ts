// npm run email:preview — every template in both languages, sent through EMAIL_PROVIDERS (Mailpit unless set).
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
  const samples: EmailTemplateData = {
    "verify-email": { ...code, notMeToken: SAMPLE_TOKEN },
    "password-reset": code,
    "password-reset-after-undo": code,
    "email-change-confirm": code,
    "password-changed": facts,
    "email-change-requested": {
      ...facts,
      newEmail: "ana.ruiz@work.example",
      undoToken: SAMPLE_TOKEN,
    },
    "new-sign-in": facts,
    "account-deleted": facts,
    "passkey-added": { ...facts, undoToken: SAMPLE_TOKEN },
    "two-factor-on": { ...facts, undoToken: SAMPLE_TOKEN },
    "passkey-removed": facts,
    "two-factor-off": facts,
    "recovery-code-used": { ...facts, left: 7, usedTo: "sign-in" },
  };

  const templates = (Object.keys(samples) as EmailTemplate[]).filter(
    (t) => !values.only || t === values.only,
  );
  const render = <T extends EmailTemplate>(
    template: T,
    locale: "en" | "es",
  ): RenderedEmail =>
    renderEmail(template, samples[template], {
      locale,
      timezone: "America/Bogota",
      appUrl: ENVIRONMENT.APP_URL,
      contact: ENVIRONMENT.EMAIL_REPLY_TO,
    });
  if (templates.length === 0) {
    throw new Error(`No template called ${values.only}`);
  }

  const providers = createEmailProviders();
  let failed = 0;
  for (const template of templates) {
    for (const locale of ["en", "es"] as const) {
      const rendered = render(template, locale);
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
