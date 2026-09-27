import { z } from "zod";

import { EmailEvent } from "../../domain/email/EmailEvent";
import { EMAIL_PROVIDER_NAMES } from "../../shared/constants";

const recipientList = z.array(z.object({ emailAddress: z.string() }));

const sesEventSchema = z.object({
  eventType: z.string().optional(),
  notificationType: z.string().optional(),
  mail: z.object({
    messageId: z.string().min(1),
    timestamp: z.string(),
    destination: z.array(z.string()),
  }),
  bounce: z
    .object({
      bounceType: z.string(),
      bounceSubType: z.string(),
      bouncedRecipients: recipientList,
      timestamp: z.string(),
    })
    .optional(),
  complaint: z
    .object({
      complainedRecipients: recipientList,
      timestamp: z.string(),
      complaintFeedbackType: z.string().optional(),
      complaintSubType: z.string().nullable().optional(),
    })
    .optional(),
  delivery: z
    .object({
      recipients: z.array(z.string()),
      timestamp: z.string(),
    })
    .optional(),
});

type SesEvent = z.infer<typeof sesEventSchema>;

export class UnreadableEmailEvent extends Error {
  constructor(readonly reason: string) {
    super(`Unreadable email event: ${reason}`);
    this.name = "UnreadableEmailEvent";
  }
}

function address(raw: string): string {
  const bracketed = raw.match(/<([^>]+)>/)?.[1] ?? raw;
  return bracketed.replace(/^rfc822;/i, "").trim();
}

// SES reports the final recipient, which a forward can change: the address we sent to is the one to act on.
function affected(event: SesEvent, reported: string[]): string[] {
  const destination = event.mail.destination.map(address);
  if (destination.length === 1) return destination;
  const sentTo = new Set(destination.map((a) => a.toLowerCase()));
  const matched = reported
    .map(address)
    .filter((a) => sentTo.has(a.toLowerCase()));
  return matched.length > 0 ? matched : reported.map(address);
}

function when(...candidates: string[]): Date {
  for (const candidate of candidates) {
    const at = new Date(candidate);
    if (!Number.isNaN(at.getTime())) return at;
  }
  throw new UnreadableEmailEvent("timestamp");
}

export function readSesEvent(message: string): EmailEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(message);
  } catch {
    throw new UnreadableEmailEvent("json");
  }
  const parsed = sesEventSchema.safeParse(json);
  if (!parsed.success) throw new UnreadableEmailEvent("shape");
  const event = parsed.data;
  const type = event.eventType ?? event.notificationType;
  const base = {
    provider: EMAIL_PROVIDER_NAMES.ses,
    messageId: event.mail.messageId,
  };

  if (type === "Delivery") {
    if (!event.delivery) throw new UnreadableEmailEvent("delivery");
    return {
      ...base,
      kind: "delivered",
      recipients: affected(event, event.delivery.recipients),
      suppress: false,
      at: when(event.delivery.timestamp, event.mail.timestamp),
      detail: null,
    };
  }
  if (type === "Bounce") {
    if (!event.bounce) throw new UnreadableEmailEvent("bounce");
    const { bounce } = event;
    return {
      ...base,
      kind: "bounced",
      recipients: affected(
        event,
        bounce.bouncedRecipients.map((r) => r.emailAddress),
      ),
      suppress: bounce.bounceType === "Permanent",
      at: when(bounce.timestamp, event.mail.timestamp),
      detail: `${bounce.bounceType}/${bounce.bounceSubType}`,
    };
  }
  if (type === "Complaint") {
    if (!event.complaint) throw new UnreadableEmailEvent("complaint");
    const { complaint } = event;
    const feedback = complaint.complaintFeedbackType ?? null;
    if (feedback === "not-spam") return null;
    return {
      ...base,
      kind: "complained",
      recipients: affected(
        event,
        complaint.complainedRecipients.map((r) => r.emailAddress),
      ),
      suppress: true,
      at: when(complaint.timestamp, event.mail.timestamp),
      detail: feedback,
    };
  }
  return null;
}
