import { readSesEvent } from "../../app/email/sesEvents";

const MAIL = {
  timestamp: "2027-01-01T10:00:00.000Z",
  messageId: "0100018f-ses-message",
  destination: ["ana@example.com"],
};

const event = (fields: Record<string, unknown>): string =>
  JSON.stringify({ mail: MAIL, ...fields });

const bounce = (bounceType: string, bounceSubType: string): string =>
  event({
    eventType: "Bounce",
    bounce: {
      bounceType,
      bounceSubType,
      bouncedRecipients: [{ emailAddress: "ana@example.com" }],
      timestamp: "2027-01-01T10:00:05.000Z",
    },
  });

const complaint = (complaintFeedbackType?: string): string =>
  event({
    eventType: "Complaint",
    complaint: {
      complainedRecipients: [{ emailAddress: "ana@example.com" }],
      timestamp: "2027-01-02T08:00:00.000Z",
      ...(complaintFeedbackType && { complaintFeedbackType }),
      complaintSubType: null,
    },
  });

describe("readSesEvent", () => {
  it("reads a delivery", () => {
    expect(
      readSesEvent(
        event({
          eventType: "Delivery",
          delivery: {
            recipients: ["ana@example.com"],
            timestamp: "2027-01-01T10:00:02.000Z",
          },
        }),
      ),
    ).toEqual({
      provider: "ses",
      messageId: MAIL.messageId,
      kind: "delivered",
      recipients: ["ana@example.com"],
      suppress: false,
      at: new Date("2027-01-01T10:00:02.000Z"),
      detail: null,
    });
  });

  it.each([
    ["General"],
    ["NoEmail"],
    ["Suppressed"],
    ["OnAccountSuppressionList"],
  ])("suppresses on a permanent bounce (%s)", (subType) => {
    expect(readSesEvent(bounce("Permanent", subType))).toMatchObject({
      kind: "bounced",
      suppress: true,
      detail: `Permanent/${subType}`,
      at: new Date("2027-01-01T10:00:05.000Z"),
    });
  });

  it.each([
    ["Transient", "MailboxFull"],
    ["Transient", "General"],
    ["Undetermined", "Undetermined"],
  ])("does not suppress on a %s/%s bounce", (type, subType) => {
    expect(readSesEvent(bounce(type, subType))).toMatchObject({
      kind: "bounced",
      suppress: false,
    });
  });

  it("suppresses on a complaint", () => {
    expect(readSesEvent(complaint("abuse"))).toMatchObject({
      kind: "complained",
      suppress: true,
      detail: "abuse",
    });
    expect(readSesEvent(complaint())).toMatchObject({
      suppress: true,
      detail: null,
    });
  });

  it("ignores a not-spam report, which takes a complaint back", () => {
    expect(readSesEvent(complaint("not-spam"))).toBeNull();
  });

  it("acts on the address it sent to when a forward bounced", () => {
    const forwarded = JSON.parse(bounce("Permanent", "General"));
    forwarded.bounce.bouncedRecipients = [
      { emailAddress: "ana.forward@elsewhere.example" },
    ];
    expect(readSesEvent(JSON.stringify(forwarded))?.recipients).toEqual([
      "ana@example.com",
    ]);
  });

  it("with several recipients, keeps the ones that bounced", () => {
    const many = JSON.parse(bounce("Permanent", "General"));
    many.mail.destination = ["Ana <ana@example.com>", "luis@example.com"];
    many.bounce.bouncedRecipients = [
      { emailAddress: "rfc822; ANA@example.com" },
    ];
    expect(readSesEvent(JSON.stringify(many))?.recipients).toEqual([
      "ANA@example.com",
    ]);
  });

  it("reads the older notification format too", () => {
    const old = JSON.parse(bounce("Permanent", "General"));
    delete old.eventType;
    old.notificationType = "Bounce";
    expect(readSesEvent(JSON.stringify(old))).toMatchObject({
      kind: "bounced",
    });
  });

  it.each(["Send", "Open", "Click", "DeliveryDelay", "Reject"])(
    "ignores a %s event",
    (eventType) => {
      expect(readSesEvent(event({ eventType }))).toBeNull();
    },
  );

  it.each([
    ["not JSON", "nope"],
    ["no mail", JSON.stringify({ eventType: "Bounce" })],
    ["a bounce with no bounce", event({ eventType: "Bounce" })],
    ["a complaint with no complaint", event({ eventType: "Complaint" })],
    ["a delivery with no delivery", event({ eventType: "Delivery" })],
  ])("refuses %s", (_name, raw) => {
    expect(() => readSesEvent(raw)).toThrow(/Unreadable email event/);
  });

  it("falls back to the send time when the event time is unreadable", () => {
    const odd = JSON.parse(bounce("Permanent", "General"));
    odd.bounce.timestamp = "yesterday";
    expect(readSesEvent(JSON.stringify(odd))?.at).toEqual(
      new Date(MAIL.timestamp),
    );
  });
});
