# Email Module

> **Status: the sender is built, nothing calls it yet.** This module is the piece every email of the
> app goes through: the password reset (T-207), the email verification (T-209), the email change
> (T-221), the security notices (T-211) and, later, the notification channel (T-131). Bounces and
> complaints are T-223; the AWS guide, alarms and budget are T-224.

## What This Module Does

Turns "send this account this email" into one message a provider accepted, or into an honest answer
about why it did not go. In order, for every send:

1. **The switch.** With `EMAIL_SENDING_ENABLED=false`, or with no provider in `EMAIL_PROVIDERS`,
   nothing is rendered, counted or sent, and the answer is `failed / disabled`.
2. **The template** is rendered in the account's `locale` and time zone — never the request's.
   A malformed input (a code that is not six digits, a token that could break a link, a new
   address the strict validation refuses) throws before anything is counted: it is a bug in the
   caller.
3. **The brakes** (below) are counted, cheapest first. The first one over its limit answers
   `limited` with the seconds until it frees.
4. **The provider chain** sends it, each provider with its own timeout.
5. **The delivery is recorded** in `emaildeliveries`.

```ts
const email = createEmailService();

await email.sendCode({ template: "password-reset", data: { code, token }, recipient, requester });
await email.sendNotice({ template: "password-changed", data: { at, userAgent }, recipient });
```

`recipient` is `{ userId, email, locale, timezone }`, taken from the account. `requester` is
`{ ip, recognizedDevice }` from the request (`clientIp(req)`, `req.recognizedDevice`), and only the
code emails take it: a code email is something a request asks for, a notice is the consequence of
something the owner did.

### What the caller gets back

| Outcome                         | Meaning                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `sent` · `provider, messageId`  | A provider accepted it for delivery. Not proof it arrived: that is T-223       |
| `limited` · `retryAfterSeconds` | A brake stopped it. The seconds are the ones of the brake that stopped it      |
| `failed` · `disabled`           | The switch is off or there is no provider                                      |
| `failed` · `rejected`           | A provider refused the address itself; another provider was not tried          |
| `failed` · `unavailable`        | Every provider answered with a refusal, or the brakes could not be counted: nothing went out |
| `failed` · `unconfirmed`        | A provider timed out or failed without answering: the email **may still arrive** |

What the callers owe to this answer, written down here so each task does not rediscover it:

- **A new code replaces the old one only on `sent`.** A send that failed must leave the person with
  the code they already had (the front's `emails.md`, "Tokens and codes"). On `unconfirmed` the
  email may arrive anyway, carrying the new code: the caller keeps the old one working and makes the
  new one work too, until either is used.
- **Forgot your password? never shows the outcome.** Only an address with an account can fail, so
  the endpoint answers the same whatever happens, and waits at least `email.providerCeilingMs` plus a
  margin so the time does not tell either. `providerCeilingMs` is the number of providers × their
  timeout; the margin has to cover the brakes (one parallel round of MongoDB hits, and the refunds
  when one stops the send) and the delivery row.
- **Resend in the verification may show it** (`EMAIL_SEND_FAILED`): the address is the person's own.
- **A security notice never blocks what triggered it.** Send it after the change is committed, and
  whatever the outcome, the change stands; the notice is on the record either way.

## Templates

`src/app/email/templates.ts` holds the 13 templates of the front's contract,
`design/spec/screens/emails.md` in `ledger-flow`, with their words in `en` and `es` copied from its
plates (`design/build.mjs`, typographic quotes included). **The contract is the source**: when a word,
a colour or a piece changes there, it changes here in the same way. This repository imports nothing
from the front.

| Template                    | Kind   | Budget   | Brake purpose  | Per account |
| --------------------------- | ------ | -------- | -------------- | ----------- |
| `verify-email`              | code   | security | `verify`       | yes         |
| `password-reset`            | code   | reset    | `reset`        | no          |
| `password-reset-after-undo` | code   | reset    | `reset-after-undo`, no daily brake | no |
| `email-change-confirm`      | code   | security | `email-change` | yes         |
| every other one             | notice | security | its own name   | no          |

- **The layout** (`src/app/email/layout.ts`) is the contract's "Building it for mail clients": tables
  with `role="presentation"`, inline styles on every element, an `<!--[if mso]>` table of 560px for
  Outlook for Windows, the button as a coloured cell, the hidden preview text followed by its filler.
  The `<style>` block carries only what cannot be inline: the dark palette under
  `prefers-color-scheme: dark` (classes with `!important`, since they must beat inline styles) and the
  narrow-screen padding. Every email also goes as plain text, in the contract's order.
- **Nothing typed by a person goes in**, except the new address in `email-change-requested`, which is
  validated with the strict email schema, HTML-escaped and never written as a link (a client may still
  auto-link it; nothing in the markup can stop Gmail doing so without breaking the address when it is
  copied). **The device** is read from the user agent against a fixed list of browsers and systems
  (`device.ts`, the contract's "Browser on OS"): anything else is "Unknown device", so a user agent
  can never put its own words in a subject. The list is the one of Active sessions in the front
  (`features/settings/user-agent.ts`), plus the iOS names of Chrome, Firefox and Edge (`CriOS`,
  `FxiOS`, `EdgiOS`) and Edge on Android (`EdgA`), which would otherwise read as Safari or Chrome
  and invite a wrong "Not you?".
- **Links** are `APP_URL/{locale}/{path}`, and a token always travels in the fragment
  (`#token=…`), never in the query, so no server log or referrer sees it.
- **When** is `Intl.DateTimeFormat` with `en-US` or `es-CO` and the account's zone, exactly as the
  contract says. The date and the time are two unbreakable pieces in the HTML, so a phone wraps
  between them and never inside "GMT-5" or "p. m.". Intl writes a no-break space before "PM" and
  inside "p. m.": that is on purpose.

**Why hand-written TypeScript and not a template tool.** Measured on 2026-09-26, installed for
production: MJML adds 11.5 MB to the Lambda zip and 246 ms to require; React Email 7.3 MB (and JSX
tooling in a repository that has none); hand-written templates add nothing. The layout is one file, and
the contract already fixes every value, so a tool would buy nothing.

## The provider chain

`EMAIL_PROVIDERS` names the providers in order (`ses`, `mailpit`). Each send tries them in that order:

- **A transport or quota failure** (a timeout, throttling, a paused or suspended account, an error
  nobody classified) goes on to the next provider.
- **A recipient failure** (SES `BadRequestException`, Mailpit HTTP 400) stops: another provider would
  refuse the same address. SES `MessageRejected` is not one: outside the sandbox it means the sender
  identity or the content, which is about the account, so the next provider is tried. SES does not
  refuse a suppressed address at send time either; it comes back later as a bounce (T-223).
- **Each provider gets `EMAIL_PROVIDER_TIMEOUT_MS`** (1.5 s). The chain enforces it itself, even on
  a provider that ignores its abort signal, so `providerCeilingMs` is a real ceiling. A provider that accepted
  just after its timeout may make the next one send a second copy; with one provider that cannot happen.

A future fallback (Resend is the one planned) is one more adapter in `src/infrastructure/email/` and
its name in the list.

| Adapter   | What it is                                                                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ses`     | `@aws-sdk/client-sesv2` `SendEmail` with the Lambda's own role, UTF-8 subject and bodies, `Reply-To`, the tags `template` and `budget`, and `EMAIL_SES_CONFIGURATION_SET` when set. `maxAttempts: 1`: the chain is the retry, and the timeout stays one timeout |
| `mailpit` | Mailpit's HTTP send API (`POST /api/v1/send`), for development and the e2e suite. Refused in production at startup                                                                                                                                                 |

**The SES SDK is loaded on the first send**, not at startup: it weighs 35 ms at require time and
2.8 MB in the zip, and an invocation that sends nothing does not pay the first. A load that failed is
retried on the next send.

**Mailpit through its HTTP API, not SMTP**: it needs no SMTP library in the zip, and the message that
arrives is the same multipart one. The e2e suite of the front reads the code back through the same
API.

## Brakes

Counted in the same MongoDB store as the auth limiter (`ratelimits`, one atomic upsert per key, a TTL
that removes each counter when its window ends), so they hold across Lambda instances. Every limit is
an environment variable of the Lambda: it changes in the console and applies on the next invocation.

| Brake          | Key                                         | Default                    | Applies to                          |
| -------------- | ------------------------------------------- | -------------------------- | ----------------------------------- |
| Address        | `email-address:{purpose}:{hash}`            | 1 per 60 s                 | every email                         |
| Address, day   | `email-address-day:{purpose}:{hash}`        | 5 per 24 h                 | every email but the one after an undo |
| Account        | `email-user:{userId}`                       | 5 per 24 h                 | `verify-email`, `email-change-confirm` |
| Device         | `email-device:{recognizedDevice}`           | 10 per hour                | code emails from a recognized device |
| IP             | `email-ip:{ip}`                             | 5 per hour                 | code emails from any other request  |
| Daily cap      | `email-cap:{budget}:{YYYY-MM-DD}`           | its share of 300           | every email                         |
| Monthly cap    | `email-cap:{budget}:{YYYY-MM}`              | its share of 9,000         | every email                         |

- **Per purpose**: a reset never waits on a verification sent a second before. The email after an
  undo has its own purpose and **no daily brake**: the undo has already stopped the password, so
  anybody's five forgot-password requests for that address must not leave the owner with no way in.
  It is already limited by needing a single-use undo token.
- **Per account** only where the account's owner chooses the address: a session can aim a
  verification or an email change at any address, while a reset always goes to the account's own.
  This keeps an account that spams Resend from blocking the real owner's reset.
- **A recognized device counts on its own, not on its IP**, for the reason the login limiter gives:
  a carrier NAT puts thousands of people behind one address. Without a device token the request
  counts on its IP, with the stricter limit (5 an hour against 10).
- **Security notices take no requester brake**: the action that sends one is already limited, and
  a notice must not be lost to somebody else's traffic on the same network.
- **The caps are money.** 9,000 a month is 0.90 USD at SES's à la carte price, the owner's "at most
  1 USD a month", enforced by the app whatever AWS allows. Each is split by budget —
  `EMAIL_RESET_SHARE_PERCENT` (30) for the reset, `EMAIL_OTHER_SHARE_PERCENT` (20) for what T-131
  adds, the rest for verification and security — rounded down, so the shares never add up to more
  than the cap, and startup refuses a cap so low that the reset or the security share rounds to zero.
  Filling one budget never touches another: registrations cannot use up the resets. The windows are
  calendar UTC days and months, the ones AWS bills in. The monthly cap is split the same way as the
  daily one, so a month of registrations cannot use up the month's resets either.
- **What the reset share does not stop on its own**: 90 resets a day can be spent by someone who
  knows 18 addresses with an account and rotates IPs, and then nobody can reset until UTC midnight.
  The captcha on Forgot your password? (T-207) is what makes that expensive, and `EMAIL_CAP_REACHED`
  is the alarm that says it happened.
- **Reaching a cap logs an error with `code: "EMAIL_CAP_REACHED"`** (`budget`, `period`, `max`), once:
  on the attempt that crosses it, not on every one it stops after. The alarm T-224 builds is a metric
  filter on it.
- **All the brakes of a send are counted at once**, in one parallel round trip, and then judged.
- **An attempt stopped by one brake gives back the brakes it had already passed**, so an attacker
  whose IP is blocked does not also use up the victim's address. **A send gives back its caps only
  when every provider answered with a refusal** (it cost nothing), never after a timeout or a
  connection that failed without an answer: the provider may have sent it, and billed it. It never
  gives back its abuse brakes.
- **If the store cannot count, nothing is sent** (`failed / unavailable`, logged as
  `EMAIL_BRAKES_UNAVAILABLE`), and whatever it did count is given back. The auth limiter fails open because locking everyone out of sign-in is
  worse than a lost limit; here the limit is the spending guarantee, and a missing email is the
  smaller harm.

## The record: `emaildeliveries`

| Field                     | Meaning                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| `template`, `budget`      | What was sent and which share it spent                                           |
| `userId`                  | The account it was for                                                           |
| `toHash`                  | SHA-256 of the trimmed, lower-cased address. **The address itself is never stored** (see below) |
| `status`                  | `sent` · `failed` · `limited` · `disabled`. T-223 adds what the provider reports later |
| `provider`, `messageId`   | Who accepted it and its id there, which T-223's events are matched by            |
| `failures`                | `{ provider, error }` for every provider that failed before the answer           |
| `createdAt`               | TTL index: the row is deleted **30 days** later                                  |

**What is recorded:** every email that reached a provider, and every security notice that was
switched off or stopped by a brake (the contract: a notice that could not go is still on the record).
The exception is a store that cannot count the brakes: MongoDB is down, and the row could not be
written either; the log line is the record then. A template that cannot render is a bug in the caller
and throws. A code email
stopped by a brake or the switch is not recorded: the requester got its answer, the request log has
the line, and a flood of refused requests would otherwise become a flood of rows. A row that cannot
be written is logged (`EMAIL_DELIVERY_NOT_RECORDED`) and does not turn a sent email into a failure.

**The hash is plain SHA-256, not keyed**, the same as the device token's subject: anyone holding a
copy of the database could test a list of addresses against it, but that copy holds every account's
address in the clear in `users` anyway. What the hash buys is that the send record and the brakes'
keys are not a list of addresses of their own, including the addresses that have no account.

## Logs

One line per problem, never the address, never the code:

| `code`                        | Level | When                                                                 |
| ----------------------------- | ----- | -------------------------------------------------------------------- |
| `EMAIL_SENDING_DISABLED`      | warn  | A send while the switch is off or no provider is configured          |
| `EMAIL_CAP_REACHED`           | error | A daily or monthly cap stopped a send (T-224's alarm)                |
| `EMAIL_SEND_FAILED`           | error | No provider accepted it, with each provider's failure                |
| `EMAIL_RECIPIENT_REJECTED`    | warn  | A provider refused the address itself: a data problem, not an outage |
| `EMAIL_PROVIDER_FAILED`       | warn  | A fallback sent it after an earlier provider failed                  |
| `EMAIL_BRAKES_UNAVAILABLE`    | error | The brakes could not be counted                                      |
| `EMAIL_REFUND_FAILED`         | error | A counter could not be given back: it over-counts until its window ends |
| `EMAIL_DELIVERY_NOT_RECORDED` | error | The row could not be written                                         |

These are log codes, not API error codes: nothing here reaches a response.

## Seeing the emails

`docker compose up -d mailpit` starts Mailpit (UI and API on http://localhost:8025), and
`npm run email:preview` sends every template in both languages to it, with sample data. It sends
through whatever `EMAIL_PROVIDERS` names (Mailpit when unset); with `EMAIL_PROVIDERS=ses`, AWS
credentials and `--to <address>` (required for anything but Mailpit: a made-up address would bounce
and hurt the account's reputation) it sends the 26 of them to a real inbox through SES (0.0026 USD),
which is how the templates are checked in Gmail, Outlook and Apple Mail once SES is set up (T-206).
`--only <template>` sends one. Mailpit's "HTML Check" tab scores each one against the mail clients'
support tables.
