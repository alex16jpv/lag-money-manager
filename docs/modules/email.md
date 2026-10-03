# Email Module

> **Status: the sender and the bounce handling are built; creating an account (T-238), the password reset
> (T-207), the email's confirmation and its deadline (T-209, T-238), the change of email (T-221) and the
> security notices (T-211, T-238) are its callers; nothing sends until `EMAIL_PROVIDERS` names a provider.**
> This module is the piece every email of the app goes through: the password reset and the confirmation
> ([auth.md](auth.md)), the email change (T-221), the security notices (T-211) and, later, the
> notification channel (T-131). Setting SES up in production, with its alarms and budget, is
> [Email in Production](../guides/email.md).

## What This Module Does

Turns "send this account this email" into one message a provider accepted, or into an honest answer
about why it did not go. In order, for every send:

1. **The switch.** With `EMAIL_SENDING_ENABLED=false`, or with no provider in `EMAIL_PROVIDERS`,
   nothing is rendered, counted or sent, and the answer is `failed / disabled`.
2. **The template** is rendered in the account's `locale` and time zone — never the request's.
   A malformed input (a code that is not six digits, a token that could break a link, a new
   address the strict validation refuses) throws before anything is counted: it is a bug in the
   caller.
3. **The suppression list** (below): an address that hard-bounced or complained answers
   `failed / rejected`, before anything is counted.
4. **The brakes** (below) are counted, all at once. Any one over its limit answers `limited` with
   the seconds until it frees.
5. **The provider chain** sends it, each provider with its own timeout.
6. **The delivery is recorded** in `emaildeliveries`, and moves again when the provider reports
   what happened to it.

```ts
const email = createEmailService();

await email.sendCode({ template: "password-reset", data: { code, token }, recipient, requester });
await email.sendNotice({ template: "password-changed", data: { at, userAgent }, recipient });
```

`recipient` is `{ userId, email, locale, timezone }`, taken from the account (for `sign-up`, from the
sign-up that waits: its id and the language and zone chosen, since no account exists yet). `requester` is
`{ ip, recognizedDevice }` from the request (`clientIp(req)`, `req.recognizedDevice`), and only the
emails sent through `sendCode` take it: those are something a request asks for — a code, or a link with
no code (`account-exists`, `email-change-taken`, the deadline emails) —, a notice is the consequence of
something the owner did. The nightly pass sends its deadline emails with no requester.

### What the caller gets back

| Outcome                         | Meaning                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `sent` · `provider, messageId`  | A provider accepted it for delivery. Not proof it arrived: the record learns that later |
| `limited` · `retryAfterSeconds` | A brake stopped it. The seconds are the ones of the brake that stopped it      |
| `failed` · `disabled`           | The switch is off or there is no provider                                      |
| `failed` · `rejected`           | The address is suppressed, or a provider refused it; another provider was not tried |
| `failed` · `unavailable`        | Every provider answered with a refusal or never got the request (the address did not resolve, the connection did not open, the SDK or its credentials did not load), or the brakes could not be counted: nothing went out |
| `failed` · `unconfirmed`        | A provider timed out or failed without answering: the email **may still arrive** |

What the callers owe to this answer, written down here so each task does not rediscover it:

- **A new code replaces the old one only on `sent`.** A send that failed must leave the person with
  the code they already had (the front's `emails.md`, "Tokens and codes"). On `unconfirmed` the
  email may arrive anyway, carrying the new code: the caller keeps the old one working and makes the
  new one work too, until either is used.
- **Forgot your password? and Create account never show the outcome.** Only an address with an
  account can fail in the reset, and only one without in the sign-up, so each answers the same whatever
  happens, and waits at least `email.providerCeilingMs` plus a
  margin so the time does not tell either. `providerCeilingMs` is the number of providers × their
  timeout; the margin has to cover the suppression read, the brakes (one parallel round of MongoDB
  hits, and the refunds when one stops the send) and the delivery row.
- **Brakes that must not tell addresses apart are held first.** `holdBrakes({ template, email,
  requester })` counts a code email's per-address and per-requester brakes for any address, with an
  account or not, and answers `limited` with its seconds or not; it throws when the store cannot count.
  The send that follows passes `brakesHeld: true` and counts only the per-account brake and the caps.
  Forgot your password? and Create account do this, so their `429` is the same for every address (the
  sign-up holds the brakes of `sign-up`, which `account-exists` shares: same purpose, same limits); a
  caller that already knows the account (a Resend with a session) has no need to.
- **`rejected` means the address will not take email**: it bounced for good, it complained, or the
  provider refused it. Asking again does not help.
- **Resend in the verification shows it** (`EMAIL_SEND_FAILED`, [auth.md](auth.md#post-authemailresend)): the address is the person's own.
- **A security notice never blocks what triggered it.** Send it after the change is committed, and
  whatever the outcome, the change stands; the notice is on the record either way.

## Security notices

The notices of T-211, sent through `sendSecurityNotice` (`src/app/services/securityNotice.ts`), which
holds the two rules every one of them follows:

- **Only to a confirmed address** (`emailVerifiedAt`). An address nobody confirmed may be a stranger's,
  registered by somebody else, and a stranger hears from us only when they ask (a verification or a reset
  they requested). So an account that never confirmed its email gets none of these.
- **Never failing what sent it.** The change is committed first; a notice that throws is logged
  (`SECURITY_NOTICE_NOT_SENT`, error) and the request answers as if it had gone. The one exception is
  `email-change-requested`: it goes before the change is saved, and a brake, a cap or no provider refuses
  the change instead (the owner's decision of 2026-09-28, [users.md](users.md#changing-the-email)).

| Notice                   | Sent when                                                                   | By                                    |
| ------------------------ | --------------------------------------------------------------------------- | ------------------------------------- |
| `password-changed`       | A password change in Settings (`PUT /users/:id`), and a reset of a live account | `UserService`, `PasswordResetService` |
| `email-change-requested` | A change of email is asked for: to the old address, with its undo link, before the change is saved | `EmailChangeService.request` |
| `new-sign-in`            | A login whose device token is not one of this email since its last undo, restore link or Log out everywhere | `AuthService.login`   |
| `account-deleted`        | Delete account: the day it is erased, and "Restore account" (`/restore`, 7 days) | `UserService.deleteUser`         |
| `account-restored`       | A deleted account came back by signing in (`/auth/login/restore`) or by a reset, which sends it instead of `password-changed`; its words say which | `AuthService.restore`, `PasswordResetService` |

- **When** is the moment of the change and **Device** the request's user agent read against the fixed list.
- **No notice after an undo, a restore link, `/confirm-email` or a sign-up**: each sends its own email (the
  reset code, or nothing new to say), and a sign-up gives the device its token.
- **Nothing is sent when an account is erased for good**: `account-deleted` already gave the day.
- **`new-sign-in` and the devices** ([auth.md](auth.md#post-authlogin)): a password change and a reset keep
  the devices known; an undo, a restore link and Log out everywhere forget them (the owner's approval E of
  2026-09-28); after a move, only the device that confirmed it holds a token of the new email.
- **`passkey-added`, `two-factor-on`, `passkey-removed`, `two-factor-off` and `recovery-code-used`** are
  rendered and tested, and nothing sends them yet: passkeys and the second step (T-215, T-217) do not
  exist. When they do, the two "added" notices carry an undo link like `email-change-requested`, and the
  undo also removes every passkey, TOTP and recovery code added since that link was issued (its
  `expiresAt` minus 7 days), so a thief with the password cannot leave a factor behind that the owner's
  reset would then ask for.

## Templates

`src/app/email/templates.ts` holds the 19 templates of the front's contract,
`design/spec/screens/emails.md` in `ledger-flow`, with their words in `en` and `es` copied from its
plates (`design/build.mjs`, typographic quotes included). **The contract is the source**: when a word,
a colour or a piece changes there, it changes here in the same way. This repository imports nothing
from the front.

| Template                    | Kind   | Budget   | Brake purpose  | Per account | IP or device |
| --------------------------- | ------ | -------- | -------------- | ----------- | ------------ |
| `sign-up`                   | code   | security | `sign-up`      | no          | yes          |
| `account-exists`            | link   | security | `sign-up`      | no          | yes          |
| `verify-email`              | code   | security | `verify`       | yes         | yes          |
| `confirm-deadline`, `confirm-deadline-reminder` | link | security | `confirm-deadline` | no | no: sent by the nightly pass |
| `password-reset`            | code   | reset    | `reset`        | no          | yes          |
| `password-reset-after-undo` | code   | reset    | `reset-after-undo`, no daily brake | no | no: sent with no requester |
| `email-change-confirm`      | code   | security | `email-change` | yes         | yes          |
| `email-change-taken`        | link   | security | `email-change` | yes         | yes          |
| every other one             | notice | security | its own name   | no          | no           |

A **link** email is sent like a code email, on a request and with its brakes, but carries no code: one
button, or none (`account-exists` for an address kept by an undo link). `sign-up` and `account-exists`
share their brakes, and so do `email-change-confirm` and `email-change-taken`, so the limits are the same
whichever an address gets. **Variants** are the same template with other words, chosen by its data:
`account-exists` (`live`, `deleted` with its two days, `held` with the day the address is free),
`password-reset` (a deleted account's), `password-reset-after-undo` (after a restore) and
`account-restored` (by signing in, or by a reset).

- **The layout** (`src/app/email/layout.ts`) is the contract's "Building it for mail clients": tables
  with `role="presentation"`, inline styles on every element, an `<!--[if mso]>` table of 560px for
  Outlook for Windows, the button as a coloured cell, the hidden preview text followed by its filler.
  The `<style>` block carries only what cannot be inline: the dark palette under
  `prefers-color-scheme: dark` (classes with `!important`, since they must beat inline styles) and the
  narrow-screen padding. Every email also goes as plain text, in the contract's order.
- **Nothing typed by a person goes in**, except two addresses, each validated with the strict email
  schema, HTML-escaped, never written as a link (a client may still auto-link it; nothing in the markup
  can stop Gmail doing so without breaking the address when it is copied) and never in a subject or the
  preview: the new address in `email-change-requested`, and the account's current address in
  `email-change-confirm`, **masked** (`maskEmail`, T-236 and the owner's decision 15): the local part keeps
  its first two characters, or only the first when it has three or fewer, then exactly three `•`; the
  domain stays whole (`ana.ruiz@work.example` → `an•••@work.example`, `ana@x.co` → `a•••@x.co`). It is the
  address as the account stores it, never the request's, and masked because the email goes to an address
  nobody confirmed yet. **The device** is read from the user agent against a fixed list of browsers and systems
  (`device.ts`, the contract's "Browser on OS"): anything else is "Unknown device", so a user agent
  can never put its own words in a subject. The list is the one of Active sessions in the front
  (`features/settings/user-agent.ts`), plus the iOS names of Chrome, Firefox and Edge (`CriOS`,
  `FxiOS`, `EdgiOS`) and Edge on Android (`EdgA`), which would otherwise read as Safari or Chrome
  and invite a wrong "Not you?".
- **Links** are `APP_URL/{locale}/{path}`, and a token always travels in the fragment
  (`#token=…`), never in the query, so no server log or referrer sees it.
- **A day** (deleted on, kept until, a deadline) travels as `YYYY-MM-DD`, already the account's day,
  and is written in its language with the month spelled out; **the year is left out when it is the year
  the email is sent** where the account lives ("October 28"), and written otherwise ("January 3, 2027").
  How long a code or a link works is said once per email, in its note or its box (the owner's approval F).
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
  refuse a suppressed address at send time either; it comes back later as a bounce, and our own
  list (below) is what stops the next one.
- **Each provider gets `EMAIL_PROVIDER_TIMEOUT_MS`** (1.5 s). The chain enforces it itself, even on
  a provider that ignores its abort signal, so `providerCeilingMs` is a real ceiling. A provider that accepted
  just after its timeout may make the next one send a second copy; with one provider that cannot happen.
- **Each failure says what happened to the email** (`EmailProviderError.outcome`), set by the adapter,
  which knows its transport: `refused` (the provider answered no), `neverLeft` (the request never reached
  it) or `mayHaveSent` (anything else). `neverLeft` is a lookup that failed (`ENOTFOUND`, `EAI_AGAIN` from
  `getaddrinfo`), a connection that did not open (`ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH` from
  `connect`, or every address of one that tried several), and for SES an SDK that did not load or
  credentials that did not resolve. The code alone is not enough: an open socket can report
  `EHOSTUNREACH` after it wrote the request.
- **A request that never left is tried once more on the same provider**, inside that same timeout, so
  `providerCeilingMs` still holds. Nothing reached the provider, so nothing can arrive twice. A request
  that may have been written is never tried again: a reset or a timed-out socket (the SES SDK names
  those `TimeoutError`, with `ECONNRESET`, `EPIPE` or `ETIMEDOUT` as their code), or the chain's own
  `Timeout`. After the timeout aborted a send, nothing is tried again either. With `maxAttempts: 1`
  the SDK does not retry on its own.

A future fallback (Resend is the one planned) is one more adapter in `src/infrastructure/email/` and
its name in the list.

| Adapter   | What it is                                                                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ses`     | `@aws-sdk/client-sesv2` `SendEmail` with the Lambda's own role, UTF-8 subject and bodies, `Reply-To`, the tags `template` and `budget`, and `EMAIL_SES_CONFIGURATION_SET` when set. `maxAttempts: 1`: the chain is the retry, and the timeout stays one timeout |
| `mailpit` | Mailpit's HTTP send API (`POST /api/v1/send`), for development and the e2e suite. Refused in production at startup                                                                                                                                                 |

**The SES SDK is loaded on the first send**, not at startup: it weighs 35 ms at require time and
2.8 MB in the zip, and an invocation that sends nothing does not pay the first. A load that failed is
retried on the next send. **The providers are built once per process** (`emailServiceFactory.ts`), so
the reset, the verification and every other email service share one SES client and its connections,
instead of one client each. A connection that sat idle long enough is closed by the other side, so an
email after a long quiet spell may still open a new one.

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
| Account        | `email-user:{userId}`                       | 5 per 24 h                 | `verify-email`, `email-change-confirm`, `email-change-taken` |
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
  on the attempt that crosses it, not on every one it stops after. The `ledger-flow-server-needs-attention`
  alarm ([Email in Production](../guides/email.md#the-alarms)) is a metric filter on it, and on the nightly
  pass's error codes.
- **All the brakes of a send are counted at once**, in one parallel round trip, and then judged.
- **An attempt stopped by one brake gives back the brakes it had already passed**, so an attacker
  whose IP is blocked does not also use up the victim's address. **A send gives back its caps and its
  address's brakes only when nothing went out**: every provider answered with a refusal or never got
  the request (it cost nothing, and nothing reached that inbox), so the account's Send code works at
  once, as its `emailVerification` says. Never after a timeout or a connection that broke without an
  answer: the provider may have sent it, and billed it. The requester's and the account's brakes are
  never given back: they count every try. A code whose address brakes were held for it
  (`holdBrakes`, Forgot your password?) gives back only its caps, the same for every address.
- **If the store cannot count, nothing is sent** (`failed / unavailable`, logged as
  `EMAIL_BRAKES_UNAVAILABLE`), and whatever it did count is given back. The auth limiter fails open because locking everyone out of sign-in is
  worse than a lost limit; here the limit is the spending guarantee, and a missing email is the
  smaller harm.

## Bounces and complaints

`POST /webhooks/email/ses` is where SES reports what became of each email: SES publishes the events
of its configuration set (`EMAIL_SES_CONFIGURATION_SET`) to an SNS topic, and the topic calls this
URL. The route is the only one outside the gateway secret, since AWS does not hold it; what stands in
for it is SNS's signature. **It is not in the OpenAPI document**, like `/` and `/health/db`: that
document is the front's contract (its types, its error codes and its `endpoints.md` are generated
from it), and nothing of the front calls this route. This section is its documentation.

**In production, `EMAIL_PROVIDERS` with `ses` and no `EMAIL_SES_EVENTS_TOPIC_ARN` stops the API from
starting**: sending through SES without receiving its bounces would keep mailing dead addresses and
wear down the SES account's reputation, with nothing but a log line to show for it.

- **Mounted before every body parser and before the gateway secret**, with `express.raw`: the
  signature covers the exact text SNS sent, which arrives as `text/plain`. Its own limits: 128 kB per
  body (an SES event with its headers is a few kB; SNS itself tops at 256 kB) and 120 requests a
  minute per IP, answered with `429`, which SNS retries.
- **What makes a message genuine** (the `ISnsInbox` port in `domain/email`, implemented by
  `SnsInbox`; in the order it is checked, cheapest first, and nothing is fetched before step 4):
  1. `EMAIL_SES_EVENTS_TOPIC_ARN` is set, and the message's `TopicArn` is exactly it. Anybody can
     create a topic of their own and have SNS sign for it, so a valid signature alone proves nothing.
  2. Its `Timestamp` is at most 2 hours old. SNS stops retrying within an hour, so an older message
     is a replay: without this, a captured bounce could suppress an address again after support
     lifted it.
  3. A confirmation carries a `Token` and a `SubscribeURL` on the SNS host of step 4.
  4. `SigningCertURL` is `https://sns.<region of that topic>.amazonaws.com/<file>.pem`: no port, no
     credentials, no query, no fragment. The certificate is fetched over TLS from that host (3 s, no
     redirects), must be in its validity window, and is kept for the life of the instance (at most 8
     of them, the oldest dropped first).
  5. The signature (`SignatureVersion` 1 is SHA-1, 2 is SHA-256) verifies over the fields SNS signs,
     in its order: for a notification `Message`, `MessageId`, `Subject` if present, `Timestamp`,
     `TopicArn`, `Type`; for a (un)subscribe confirmation `SubscribeURL` and `Token` instead of
     `Subject`.

  A message that fails is `403` (SNS does not retry a 4xx). Its reason goes on the request's own log
  line (`code: EMAIL_EVENT_REJECTED`, `errorMessage: <reason>`), so a flood of forged calls is one line
  each and nothing more. When the certificate host does not answer (a network error or a 5xx), the
  answer is `503` instead, which SNS retries: a fault on AWS's side must not throw a real bounce away.
  The `503` body has no `code`: its only reader is SNS, which goes by the status.
- **Only a verified message reaches the database**: the MongoDB connection is opened after the
  signature, so a forged call on a cold start costs no connection.
- **`SubscriptionConfirmation`** is confirmed by visiting its `SubscribeURL`: subscribing the URL to the
  topic is all the setup the app needs. SNS refusing it (a 4xx: an expired token) is a `403`; SNS not
  answering, a `503`. **`UnsubscribeConfirmation`** is logged as an error
  (`EMAIL_EVENTS_UNSUBSCRIBED`): from then on no bounce arrives, and the owner has to know. A
  subscription confirmed this way can be removed by anyone holding the `UnsubscribeURL` of one of its
  notifications; that log line is the signal.
- **What the subscription needs** (`infra/email.yaml` creates it, [Email in Production](../guides/email.md)
  step 4): HTTPS to the Function URL + `/webhooks/email/ses`,
  with **raw message delivery off** (the signature is on SNS's envelope, so a raw body is refused).
- **A notification carries one SES event**, read by `sesEvents.ts` into the provider-neutral
  `EmailEvent` (`delivered`, `bounced` or `complained`). A future provider adds its own route and
  reader, and reuses the rest. Both SES formats are read: `eventType` (event publishing) and
  `notificationType` (identity notifications).

| SES event                                 | Record becomes | Suppresses the address |
| ----------------------------------------- | -------------- | ---------------------- |
| `Delivery`                                | `delivered`    | no                     |
| `Bounce`, `Permanent` (any subtype)       | `bounced`      | yes                    |
| `Bounce`, `Transient` or `Undetermined`   | `bounced`      | no: it may work later  |
| `Complaint`                               | `complained`   | yes                    |
| `Complaint` with feedback `not-spam`      | —              | no: ignored, it takes a complaint back |
| `Send`, `Open`, `Click`, `DeliveryDelay`, … | —            | ignored                |

- **The address acted on is the one we sent to** (`mail.destination`), not the one the bounce
  names: a forward can make the final recipient another address, and suppressing that one would
  leave ours bouncing.
- **The record only moves forward** (`sent` → `delivered` → `bounced` → `complained`): SNS delivers at
  least once and in no promised order, so a repeated or late event never rolls it back. A record
  that no longer exists (past its 30 days) changes nothing, and the suppression still happens.
- **A signed event that cannot be read** is logged (`EMAIL_EVENT_UNREADABLE`) and answered `204`: a
  retry would read the same bytes. A database that fails answers `5xx`, and SNS retries (by default
  three times in about a minute; the subscription of `infra/email.yaml` retries for about 35 minutes,
  and an alarm tells the owner when SNS gives up on one).

### The suppression list: `emailsuppressions`

| Field          | Meaning                                                              |
| -------------- | -------------------------------------------------------------------- |
| `toHash`       | SHA-256 of the address, unique: one row per address, never the address |
| `reason`       | `bounce` or `complaint`: the first one, while it stays suppressed    |
| `provider`, `detail` | Who reported it and how (`Permanent/NoEmail`, `abuse`)         |
| `suppressedAt` | When it was reported                                                 |
| `liftedAt`     | `null` while suppressed; set when support lifts it                   |

- **Every send reads it first**, for every provider: the list is ours, so a fallback provider never
  sends to an address SES already found dead, and it does not depend on SES's own account-level
  list being on. A suppressed code email is not recorded, like one a brake stops; a suppressed
  security notice is recorded as `suppressed`, so the notice is still on the record.
- **It does not expire.** An address that bounced for good stays that way, and each bounce counts
  against the SES account's reputation. Changing the account's email to another address is the way
  out for its owner.
- **Support lifts it**, never the app: `MONGO_URI=<the database> npm run email:unsuppress -- <address>`.
  Lifting marks the row (`liftedAt`); if the address bounces or complains again, it is suppressed
  again with the new reason. This is the one manual help support gives (the "nobody recovers
  accounts by hand" decision is about accounts, not about a mailbox that was full for a week).
- **A new suppression logs `EMAIL_ADDRESS_SUPPRESSED`** (warn, without the address); the same event
  arriving again logs nothing.

## The record: `emaildeliveries`

| Field                     | Meaning                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| `template`, `budget`      | What was sent and which share it spent                                           |
| `userId`                  | The account it was for                                                           |
| `toHash`                  | SHA-256 of the trimmed, lower-cased address. **The address itself is never stored** (see below) |
| `status`                  | `sent` · `failed` · `limited` · `disabled` · `suppressed` when it is written; then `delivered` · `bounced` · `complained` as the provider reports |
| `provider`, `messageId`   | Who accepted it and its id there: the events are matched by the pair (indexed) |
| `failures`                | `{ provider, error, detail? }` for every attempt that failed before the answer: `error` is the provider's reason (the error's name, `HTTP 500`, `Timeout`, `NoMessageId`), `detail` what the error said: the system code, the HTTP status and the first line of the message and of its cause, with any address as `[address]`, any access key id as `[key]` and any run of 32 or more token characters as `[token]`, at most 300 characters. A provider tried twice appears twice |
| `reportedAt`, `report`    | When the provider's last event happened and what it said (`Permanent/NoEmail`, `abuse`) |
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
| `EMAIL_CAP_REACHED`           | error | A daily or monthly cap stopped a send (an alarm emails the owner)    |
| `EMAIL_SEND_FAILED`           | error | No provider accepted it, with each attempt's failure and its `detail` |
| `EMAIL_RECIPIENT_REJECTED`    | warn  | A provider refused the address itself: a data problem, not an outage |
| `EMAIL_PROVIDER_FAILED`       | warn  | A fallback sent it after an earlier provider failed                  |
| `EMAIL_SEND_RETRIED`          | warn  | The same provider sent it on its second try, after a request that never left |
| `EMAIL_SEND_SLOW`             | warn  | A sent email took more than half of `EMAIL_PROVIDER_TIMEOUT_MS` (`durationMs`): the timeout is getting close |
| `EMAIL_BRAKES_UNAVAILABLE`    | error | The brakes could not be counted                                      |
| `EMAIL_REFUND_FAILED`         | error | A counter could not be given back: it over-counts until its window ends |
| `EMAIL_DELIVERY_NOT_RECORDED` | error | The row could not be written                                         |
| `EMAIL_RECIPIENT_SUPPRESSED`  | warn  | A send to an address on the suppression list                         |
| `EMAIL_SUPPRESSIONS_UNAVAILABLE` | error | The suppression list could not be read: nothing was sent          |
| `EMAIL_ADDRESS_SUPPRESSED`    | warn  | A hard bounce or a complaint put a new address on the list           |
| `EMAIL_EVENT_UNREADABLE`      | error | A signed event whose content could not be read                       |
| `EMAIL_EVENTS_SUBSCRIBED`     | info  | The SNS subscription was confirmed                                   |
| `EMAIL_EVENTS_UNSUBSCRIBED`   | error | The subscription was removed: bounces and complaints stop arriving   |

The webhook's refusals are not lines of their own: they ride on the request log line, as its `code`,
with the detail in `errorMessage`: `EMAIL_EVENT_REJECTED` (warn, `403`, the reason),
`EMAIL_EVENTS_CERTIFICATE_UNAVAILABLE` and `EMAIL_EVENTS_SUBSCRIPTION_FAILED` (error, `503`, what did not
answer).

These are log codes, not API error codes: nothing here reaches a response to the front.

## Seeing the emails

`docker compose up -d mailpit` starts Mailpit (UI and API on http://localhost:8025), and
`npm run email:preview` sends every template in both languages to it, with sample data. It sends
through whatever `EMAIL_PROVIDERS` names (Mailpit when unset); with `EMAIL_PROVIDERS=ses`, AWS
credentials and `--to <address>` (required for anything but Mailpit: a made-up address would bounce
and hurt the account's reputation) it sends the 48 of them — every template and its variants, in both
languages — to a real inbox through SES (0.0048 USD, one a second: the sandbox's rate),
which is how the templates are checked in Gmail, Outlook and Apple Mail once SES is set up (T-206).
`--only <template>` sends one. Mailpit's "HTML Check" tab scores each one against the mail clients'
support tables.
