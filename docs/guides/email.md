# Email in Production: SES and Its Guards

How to turn on the email the API sends (the [Email module](../modules/email.md)) with Amazon SES,
and how to put the guards around it that keep the bill under 1 USD a month. It is done once, by
hand, by whoever owns the AWS account, the `alexpiral.com` zone in Cloudflare and the web client's
Vercel project. Nothing here runs in `npm run deploy:lambda`.

Most of it is one CloudFormation stack, `infra/email.yaml`. The rest is what a template cannot do:
the SES pricing plan, the DNS records, the production access request, the captcha and Vercel's
rate limit.

Plan for about an hour of work, plus two waits on AWS: the DNS verification (minutes, up to 72 hours)
and the answer to the production access request (typically within a day).

## What stops the spending, from the inside out

| Guard | Where | Acts in | What it stops |
| --- | --- | --- | --- |
| **The caps** (`EMAIL_DAILY_CAP` 300, `EMAIL_MONTHLY_CAP` 9,000) | The API | The same request | That share's emails, until the UTC day or month ends. 9,000 a month is 0.90 USD à la carte: **this is the spending guarantee** |
| **The switch** (`EMAIL_SENDING_ENABLED=false`) | The Lambda's environment | The next invocation | Every email, when you set it |
| **The alarms** | CloudWatch → SNS → a small Lambda | Within the hour | Every SES send of the account (`PutAccountSendingAttributes`), on too many sends, bounces or complaints |
| **The budget** | AWS Budgets | Hours | Every SES send from the API's role (an IAM deny policy), at 1 USD in the month |

The caps are what hold the bill: they count in MongoDB before anything is sent. The alarms are for
what the caps cannot see, such as a leaked credential sending from outside the API or a burst of
bounces that would hurt the account's reputation. The budget is the last net and the slowest: AWS
updates cost data up to three times a day, 8 to 12 hours apart, so it acts hours after the spend.

## Before you start

- **An administrator of the AWS account**, in the API's region (`us-east-1`). The `lag-deploy` user of
  the [Deployment guide](./deployment.md) can only update the function, and should stay that way.
- For the API's function (`LAMBDA_FUNCTION_NAME` in `.env.deploy`; it must have run at least once, so
  that its log group exists — the daily keepalive sees to that), its **execution role** and its
  **Function URL**. Read them rather than copy them from the console, with the deploy profile:

  ```bash
  aws lambda get-function-configuration --function-name <function name> --query Role
  aws lambda get-function-url-config --function-name <function name> --query FunctionUrl
  ```

  The role's ARN is `arn:aws:iam::<account>:role<path><name>`. **Its path matters**: a role the Lambda
  console created lives under `/service-role/`, and the budget can only deny the role it names by its
  exact ARN. With the deploy user the second command needs `lambda:GetFunctionUrlConfig` (the
  read-only policy of [Checking each step](#checking-each-step)); an administrator profile reads it as is.
- **An address for the alerts.** Every alarm, pause and budget threshold is emailed there.
- **An address for the DMARC reports** (step 3). A separate alias is better: the reports are daily XML
  attachments from every large mailbox provider.

## 1. The SES pricing plan: à la carte

SES bills per email, and there are two plans that matter here: **à la carte** at 0.10 USD per 1,000
and **Essentials** at 0.16 USD per 1,000, with no monthly fee either way. Since 2026-07-21 an account
that had not used SES since 2025-06-01 starts on Essentials. The caps assume à la carte.

From a terminal, with an administrator profile (`NONE` is à la carte, no plan):

```bash
aws sesv2 put-account-pricing-attributes --plan NONE --region us-east-1 --profile <admin profile>
```

Or SES console → _Pricing plan_ → **Cancel plan**. Plans are per Region: on any Region but the API's
(`us-east-1`), that page shows another Region's plan. When Essentials was applied by
default, the change takes effect immediately and the account is on à la carte.

## 2. Deploy the stack, without the webhook yet

CloudFormation console, in `us-east-1` → _Create stack → With new resources_ → _Upload a template
file_ → `infra/email.yaml` from this repository. Name the stack `ledger-flow-email`.

| Parameter | Value |
| --- | --- |
| `ApiFunctionName` | The API's function name (`LAMBDA_FUNCTION_NAME`) |
| `ApiRoleName` | The name at the end of the role's ARN |
| `ApiRolePath` | The role's path, between `role` and the name: `/service-role/` for a role the Lambda console created, `/` for one with no path. Required: a wrong one leaves the budget unable to deny the role |
| `AlertEmail` | The address for the alerts |
| `WebhookUrl` | **Leave it empty** for now (step 4) |
| The rest | Keep the defaults: they are the 1 USD a month limits ([Raising the limits](#raising-the-limits)) |

Acknowledge that the stack creates named IAM resources, and create it. The same from a terminal, with
an administrator profile:

```bash
aws cloudformation deploy --stack-name ledger-flow-email --template-file infra/email.yaml \
  --capabilities CAPABILITY_NAMED_IAM --region us-east-1 --profile <admin profile> \
  --parameter-overrides ApiFunctionName=<function name> ApiRoleName=<role name> \
  ApiRolePath=<role path> AlertEmail=<address>
```

Then **confirm the subscription**: AWS emails the alert address ("AWS Notification - Subscription
Confirmation"). Until you open its link, no alarm reaches you.

What the stack creates:

| Resource | What it is |
| --- | --- |
| The domain identity `ledgerflow.alexpiral.com` | Easy DKIM (2048-bit) and the MAIL FROM `bounce.ledgerflow.alexpiral.com`. **Kept** if the stack is deleted, so the DNS records keep working |
| The configuration set `ledger-flow` | Reputation metrics on, open and click tracking off (it publishes no open or click events). Also the identity's default, so every send goes through it |
| The topic `ledger-flow-email-events` | Where the configuration set publishes `Bounce`, `Complaint` and `Delivery`, signed with SHA-256 |
| The policy `ledger-flow-send-email` on the API's role | `ses:SendEmail` as `no-reply@ledgerflow.alexpiral.com` only, through that configuration set |
| The topic `ledger-flow-email-alerts` | Emails you every alarm and every pause |
| The topic `ledger-flow-email-trip` and the pause Lambda | The alarms that pause SES publish here, and the Lambda pauses sending for the account and tells you |
| Five sending alarms | [When a guard trips](#when-a-guard-trips) |
| Three more alarms | A cap reached, the webhook's subscription removed, and an SES event SNS could not deliver |
| The budget `ledger-flow-ses` and its action | Emails you at 50 % of the month; at 100 % attaches `ledger-flow-deny-email` to the API's role |

## 3. The DNS records, in Cloudflare

The stack's _Outputs_ tab gives the values. In Cloudflare, `alexpiral.com` → _DNS → Records_, add
each one with **Proxy status: DNS only** and TTL _Auto_. Paste the full names: Cloudflare shows them
relative to the zone.

| Type | Name | Content | Output |
| --- | --- | --- | --- |
| CNAME | `<token 1>._domainkey.ledgerflow.alexpiral.com` | `<token 1>.dkim.amazonses.com` | `DkimRecord1` |
| CNAME | `<token 2>._domainkey.ledgerflow.alexpiral.com` | `<token 2>.dkim.amazonses.com` | `DkimRecord2` |
| CNAME | `<token 3>._domainkey.ledgerflow.alexpiral.com` | `<token 3>.dkim.amazonses.com` | `DkimRecord3` |
| MX | `bounce.ledgerflow.alexpiral.com` | `feedback-smtp.us-east-1.amazonses.com`, priority 10 | `MailFromMxRecord` |
| TXT | `bounce.ledgerflow.alexpiral.com` | `v=spf1 include:amazonses.com ~all` | `MailFromSpfRecord` |
| TXT | `_dmarc.ledgerflow.alexpiral.com` | `v=DMARC1; p=quarantine; adkim=s; aspf=s; rua=mailto:<reports address>` | — |

Copy each DKIM name and target exactly as the output shows them.

**Nothing else changes.** Not the records of `alexpiral.com` itself (its MX, SPF and DMARC are
Proton's), and not the CNAME of `ledgerflow.alexpiral.com` to Vercel. Why this is enough:

- **That CNAME rules out any TXT or MX on `ledgerflow.alexpiral.com` itself**, and none is needed.
  DMARC passes on DKIM alone: SES signs with `d=ledgerflow.alexpiral.com`, exactly the From's domain,
  which is what the inherited `adkim=s` (strict) asks for.
- **The MAIL FROM** lives on `bounce.ledgerflow.alexpiral.com`, with its own MX and SPF. With
  `aspf=s` it does not align with the From, and it does not have to: DKIM already did.
- **The DMARC record** keeps `p=quarantine`, the same as the one inherited from `alexpiral.com`, so
  nothing gets weaker, and adds `rua` to receive reports. The reports address needs no
  authorization record while it is on `alexpiral.com`, the same organizational domain.

Then wait for SES: console → _Identities_ → `ledgerflow.alexpiral.com`. Both _DKIM configuration_ and
_Custom MAIL FROM domain_ must read **Successful**. It usually takes minutes, and at most 72 hours.

## 4. Connect SES's events to the API

**The order matters.** The webhook only accepts signed messages from the topic in
`EMAIL_SES_EVENTS_TOPIC_ARN`, and SNS sends the subscription's confirmation seconds after it is
created.

1. Lambda console → the API's function → _Configuration → Environment variables_, add:

   | Variable | Value |
   | --- | --- |
   | `EMAIL_SES_CONFIGURATION_SET` | `ledger-flow` (output `ConfigurationSet`) |
   | `EMAIL_SES_EVENTS_TOPIC_ARN` | output `EventsTopicArn` |

   Leave `EMAIL_PROVIDERS` unset for now. A saved variable applies from the next invocation.
2. **Update the stack** (_Update → Use existing template_) with `WebhookUrl` = the Function URL +
   `webhooks/email/ses`. The Function URL already ends in `/`:
   `https://<id>.lambda-url.us-east-1.on.aws/webhooks/email/ses`, with a single slash before
   `webhooks`.
3. Check: SNS console → _Topics_ → `ledger-flow-email-events` → _Subscriptions_. The HTTPS one must be
   **Confirmed**, and the API's log has a line with `code: EMAIL_EVENTS_SUBSCRIBED`.

   Still _Pending confirmation_ means the API refused the confirmation: the log line has
   `code: EMAIL_EVENT_REJECTED` and the reason. Most likely the variable of step 1 was not saved
   yet. Fix it, select the subscription and choose _Request confirmation_.

The subscription is created with raw message delivery **off** (the API verifies SNS's signed
envelope) and a delivery policy that keeps retrying for about 35 minutes instead of SNS's default 3
retries in a minute. The webhook accepts a message up to 2 hours old.

## 5. Try it in the sandbox

A new SES account is in the **sandbox**: it only sends to verified addresses, at most 200 a day.
That is enough to check everything before AWS lets it out.

1. SES console → _Identities → Create identity → Email address_: your own address. Open the link that
   arrives.
2. From this repository, with an administrator profile (the deploy user cannot send), send every
   template in both languages to it:

   ```bash
   AWS_PROFILE=<admin profile> AWS_REGION=us-east-1 EMAIL_PROVIDERS=ses \
   EMAIL_SES_CONFIGURATION_SET=ledger-flow APP_URL=https://ledgerflow.alexpiral.com \
   EMAIL_PROVIDER_TIMEOUT_MS=10000 npm run email:preview -- --to <your address>
   ```

   26 emails, 0.0026 USD, about 30 seconds: through a real provider the preview sends one a second,
   the sandbox's rate. `APP_URL` makes their links point at production instead of the `localhost` of
   `.env`, and the longer timeout covers the first send, which also loads the SDK and your
   credentials on your machine. The preview sends straight through the provider: it needs no
   database and writes no record.
3. **Check the authentication.** In Gmail, _Show original_: `DKIM: 'PASS' with domain
   ledgerflow.alexpiral.com` and `DMARC: 'PASS'`. In Outlook, the `Authentication-Results` header:
   `dkim=pass header.d=ledgerflow.alexpiral.com` and `dmarc=pass`. Do it in both before going further.
4. **Check the templates** in Gmail, Outlook and Apple Mail, in light and dark mode: the contract is
   `design/spec/screens/emails.md` of the web client, and this is the first time they arrive through
   a real provider.
5. **Check the guard end to end.** Force an alarm into ALARM:

   ```bash
   aws cloudwatch set-alarm-state --alarm-name ledger-flow-email-sends-per-hour \
     --state-value ALARM --state-reason "Testing the guard" --region us-east-1 --profile <admin profile>
   aws sesv2 get-account --region us-east-1 --profile <admin profile> --query SendingEnabled
   ```

   Two emails arrive, the alarm's and "Ledger Flow: SES sending is paused", and the second command
   prints `false`. Resume sending:

   ```bash
   aws sesv2 put-account-sending-attributes --sending-enabled --region us-east-1 --profile <admin profile>
   ```

   The alarm goes back to its real state at its next evaluation.

## 6. Ask for production access

SES console → _Account dashboard → Request production access_:

- **Mail type:** Transactional.
- **Website URL:** `https://ledgerflow.alexpiral.com`.
- **Use case description:**

  > Ledger Flow (https://ledgerflow.alexpiral.com) is a personal finance web app. We only send
  > transactional email to our own users, triggered by something they did: email verification
  > codes, password reset codes and security notices (password changed, email changed, new
  > sign-in). No marketing, no mailing lists, no purchased or shared addresses. We expect fewer than
  > 50 emails a day, and we ask for a daily sending quota of 300: we do not need more. A configuration
  > set publishes Bounce, Complaint and Delivery events to SNS, and our API stops emailing any
  > address that hard-bounces or complains. Sending is also capped in the application (300 a day,
  > 9,000 a month), and CloudWatch alarms pause sending on unusual volume, bounces or complaints.
  > Every email says why it was sent to its recipient.

The form has no field for the quota, and AWS neither documents a minimum nor promises to grant a
lower one: the request asks for it in the description. Whatever quota AWS grants, the caps keep the
month at 9,000 emails and the sends alarm pauses SES above 100 in an hour. The answer also says the
maximum send rate (emails a second): check it in the _Account dashboard_, since a send over it fails
and the API does not retry it.

## 7. The captcha: Cloudflare Turnstile

Cloudflare dashboard → _Turnstile → Add widget_:

- **Name:** Ledger Flow. **Hostname:** `ledgerflow.alexpiral.com`.
- **Widget mode:** Managed. The web client will run it with `appearance: "interaction-only"` (its
  `design/spec/screens/access.md`, built with the password reset), so most people never see it and
  only a suspicious request is asked for a click. Vercel's preview deployments are not in the
  hostname list, so the widget does not work there: they use the test keys.

Keep the **site key** and the **secret key**. The secret goes in the Lambda as `TURNSTILE_SECRET`
([Environment Variables](./environment-vars.md)): the API checks with it every Forgot your password?,
every Resend of the email's confirmation and every sign-up that sends a captcha, and without it those
answer `503` and send nothing. The site key goes in Vercel → the web client's project → _Settings →
Environment Variables_ as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, for **Production**, and the web client is
redeployed (it is read at build time): without it, Sign in keeps "Forgot your password?" inactive with
"(soon)". Development and the e2e suite use Cloudflare's test keys (site key `1x00000000000000000000AA`
and secret `1x0000000000000000000000000000000AA` always pass), never these; production refuses to start
with a test secret.

It comes before the next step on purpose: with `EMAIL_PROVIDERS` set and no `TURNSTILE_SECRET`,
production refuses to start, since the captcha is what keeps strangers from spending the email budget.

## 8. Turn sending on

With production access granted, add `EMAIL_PROVIDERS=ses` to the Lambda's environment.
`EMAIL_SES_EVENTS_TOPIC_ARN` (step 4) and `TURNSTILE_SECRET` (step 7) must already be there: without
either, production refuses to start. From then on Forgot your password? emails its codes, and a sign-up
from the web client emails its confirmation once the client sends the captcha with it (T-210).

## 9. One rate limit on the web client's sign-in

Vercel's Hobby plan allows one rate-limit rule per project. It goes on the routes where the web
client signs in, so a flood from one address is turned away before it reaches the Lambda.

Vercel → the web client's project → _Firewall → Configure → New rule_:

- **If** _Request Path_ matches the expression `^/api/auth/(login|register|forgot|reset)$` **and**
  _Method_ equals `POST`;
- **Then** _Rate Limit_: fixed window of 60 seconds, 10 requests, keyed on **IP**, answering the
  default `429`.

Save and publish it. `/api/auth/refresh` stays out on purpose: a session refreshes on its own, and
many sessions share one address behind a carrier NAT; the API's own limiter covers it. `forgot` and
`reset` are the password reset's (T-208); the routes the email's confirmation adds to the web client
(T-210) join this expression.

## After the web client confirms emails: invitations wait for it

Not one of the nine steps: it waits until the web client can confirm an email (T-210) and this guide's
step 8 is done. Then add `EMAIL_VERIFICATION_REQUIRED=true` to the Lambda. From the next invocation,
inviting, seeing and answering invitations addressed to an email wait until that email is confirmed
(the owner's decision 3); before that, nobody could confirm one and every invitation would stop.
Production refuses to start with it and no `EMAIL_PROVIDERS`. Turning it off again (`false`) puts
invitations back as they were, with no deploy.

## Checking each step

Every step can be checked by reading, without writing anything, so the owner does by hand only what has
to be manual and a session confirms it landed. This inline policy on the deploy user
(`ledger-flow-email-read`) is what that reading needs; it writes nothing:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["lambda:GetFunctionUrlConfig"],
      "Resource": "arn:aws:lambda:us-east-1:<account>:function:<function name>" },
    { "Effect": "Allow", "Action": ["cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents"],
      "Resource": "arn:aws:cloudformation:us-east-1:<account>:stack/ledger-flow-email/*" },
    { "Effect": "Allow",
      "Action": ["ses:GetAccount", "ses:ListEmailIdentities", "ses:GetEmailIdentity",
                 "ses:GetConfigurationSet", "sns:ListSubscriptionsByTopic", "sns:GetTopicAttributes",
                 "cloudwatch:DescribeAlarms", "budgets:ViewBudget",
                 "budgets:DescribeBudgetActionsForBudget", "iam:SimulatePrincipalPolicy"],
      "Resource": "*" }
  ]
}
```

Every command below runs with `--profile <deploy profile> --region us-east-1`.

| After step | Read | Expect |
| --- | --- | --- |
| 1 | `aws sesv2 get-account --query PricingAttributes` | `CurrentPlan` is `NONE` (à la carte), with no `NextPlan` |
| 2 | `aws cloudformation describe-stacks --stack-name ledger-flow-email` | `CREATE_COMPLETE` (`UPDATE_COMPLETE` after step 4); the outputs carry the DNS records of step 3, `ConfigurationSet`, `EventsTopicArn` and `PauseFunction` |
| 2 | `aws budgets describe-budget-actions-for-budget --account-id <account> --budget-name ledger-flow-ses` | `Status` is `STANDBY`, and `Roles` is `[<role name>]` |
| 2 | `aws iam simulate-principal-policy --policy-source-arn <BudgetActionRole ARN> --action-names iam:AttachRolePolicy --resource-arns <the API role's ARN> --context-entries Key=iam:PolicyARN,Values=<ledger-flow-deny-email ARN>,Type=string` | `EvalDecision` is `allowed`: the budget can deny the role it names, path included |
| 3 | `aws sesv2 get-email-identity --email-identity ledgerflow.alexpiral.com` | `DkimAttributes.Status` and `MailFromAttributes.MailFromDomainStatus` are `SUCCESS` |
| 4 | `aws sns list-subscriptions-by-topic --topic-arn <EventsTopicArn>` | The HTTPS subscription has a real ARN, not `PendingConfirmation` |
| 6 | `aws sesv2 get-account` | `ProductionAccessEnabled` and `SendingEnabled` are `true`, `EnforcementStatus` is `HEALTHY`, and `SendQuota` says the quota granted |
| 8 | `aws lambda get-function-configuration --function-name <function name> --query "keys(Environment.Variables)"` | `EMAIL_PROVIDERS`, `EMAIL_SES_CONFIGURATION_SET`, `EMAIL_SES_EVENTS_TOPIC_ARN` and `TURNSTILE_SECRET` are there. The query prints the names only; the values still travel in the answer, so never drop it |
| Any | `aws cloudwatch describe-alarms --alarm-name-prefix ledger-flow` | Every alarm `OK` or `INSUFFICIENT_DATA` |

## When a guard trips

| You get | What happened | What stops | What to do |
| --- | --- | --- | --- |
| "ALARM: ledger-flow-email-sends-per-hour" (or `bounces-per-hour`, `complaints-per-day`, `bounce-rate`, `complaint-rate`) and "SES sending is paused" | More sends, bounces or complaints than the app can explain | Every SES send of the account: the API answers `failed / unavailable` and logs `EMAIL_SEND_FAILED` | Find out why (below), then resume with `aws sesv2 put-account-sending-attributes --sending-enabled` |
| "SES could NOT be paused" | An alarm fired and the pause Lambda failed; Lambda retries it twice | Nothing yet | Pause it yourself: `aws sesv2 put-account-sending-attributes --no-sending-enabled`, or `EMAIL_SENDING_ENABLED=false` on the Lambda |
| "ALARM: ledger-flow-email-cap-reached" | The app reached a daily or monthly cap (`EMAIL_CAP_REACHED`) | That share's emails, until the UTC day or month ends. SES keeps working | Growth: [Raising the limits](#raising-the-limits). Abuse: look at the brakes' log lines, and `EMAIL_SENDING_ENABLED=false` to stop everything now |
| "ALARM: ledger-flow-email-events-unsubscribed" | The webhook's subscription was removed (`EMAIL_EVENTS_UNSUBSCRIBED`) | Bounces and complaints stop arriving: the suppression list stops growing | Update the stack with `WebhookUrl` empty, then again with the URL: CloudFormation creates the subscription anew, with its delivery policy |
| "ALARM: ledger-flow-email-events-undelivered" | SNS gave up on an event after its retries: the API was down, answered `5xx`, or refused it (`EMAIL_EVENT_REJECTED` in its log) | That bounce or complaint is lost: the address is not suppressed | Find the API's answers in its log around that hour. A lost bounce comes back as a new one the next time that address is emailed |
| The budget's email at 50 % | SES spent half of the month's budget | Nothing | Check the spend in Cost Explorer: the caps should make this impossible |
| The budget action's email | SES spent the whole budget | Every SES send from the API's role: `AccessDenied`, logged as `EMAIL_SEND_FAILED` | Find out how the caps were passed, then undo it yourself — do not wait for the new month: Budgets → `ledger-flow-ses` → _Actions_ → reverse it, or detach `ledger-flow-deny-email` from the role in IAM. While it is attached, the stack cannot be deleted |

**Finding out why.** CloudWatch → _Logs Insights_ on `/aws/lambda/<the API's function>`:

```
fields @timestamp, code, template, budget, errorMessage
| filter code like /^EMAIL_/
| sort @timestamp desc
| limit 200
```

The SES console's _Reputation metrics_ shows the bounce and complaint rates as SES sees them. SES
reviews an account at a 5 % bounce rate or a 0.1 % complaint rate, and may pause it at 10 % or 0.5 %.

**An alarm acts once, when it goes into ALARM.** If you resume while it is still in ALARM, nothing
pauses SES again until it goes back to OK and breaches again.

## The alarms

All of them count absolute numbers first: with a few emails a day, one bounce would already be a
10 % rate. The rates only count once the day has 200 emails.

| Alarm | Pauses SES | Fires when |
| --- | --- | --- |
| `ledger-flow-email-sends-per-hour` | yes | More than 100 emails in an hour (a third of the daily cap) |
| `ledger-flow-email-bounces-per-hour` | yes | More than 10 bounces in an hour |
| `ledger-flow-email-complaints-per-day` | yes | 3 or more complaints in a day |
| `ledger-flow-email-bounce-rate` | yes | A bounce rate of 5 % or more, in a day with at least 200 emails |
| `ledger-flow-email-complaint-rate` | yes | A complaint rate of 0.1 % or more, in a day with at least 200 emails |
| `ledger-flow-email-cap-reached` | no | The API logged `EMAIL_CAP_REACHED` |
| `ledger-flow-email-events-unsubscribed` | no | The API logged `EMAIL_EVENTS_UNSUBSCRIBED` |
| `ledger-flow-email-events-undelivered` | no | SNS failed to deliver an SES event to the webhook, after its retries |

The pause is **account-wide** (`PutAccountSendingAttributes`), because everything SES sends from this
account is Ledger Flow's. The last three only tell you: pausing SES would not fix any of them.

## Raising the limits

When the app grows, five values move together, one row at a time. Each step keeps the monthly cap at
90 % of the budget (à la carte, 0.10 USD per 1,000) and the daily cap at a thirtieth of the month.

| Monthly spend | `EMAIL_MONTHLY_CAP` | `EMAIL_DAILY_CAP` | SES daily quota | `SendsPerHourAlarm` | `BouncesPerHourAlarm` | `ComplaintsPerDayAlarm` | `MonthlyBudgetUsd` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **1 USD** (today) | 9,000 | 300 | 300 | 100 | 10 | 3 | 1 |
| 5 USD | 45,000 | 1,500 | 1,500 | 500 | 25 | 5 | 5 |
| 20 USD | 180,000 | 6,000 | 6,000 | 2,000 | 100 | 15 | 20 |

- The two caps are environment variables of the Lambda: they apply on the next invocation.
- The SES quota is a request: _Service Quotas → Amazon Simple Email Service → Sending quota_, or the
  SES console. It can take a day.
- The alarms and the budget are the stack's parameters: _Update → Use existing template_ and change
  them.
- The absolute bounce and complaint thresholds grow slower than the volume, so they stay under the
  line at which SES itself would pause the account. The rate alarms stay as they are.

**Raising: AWS first, the app last.** First the SES quota, then the stack's parameters, and only then
the caps. **Lowering: the other way round.** The app's caps must never let through more than AWS's
guards accept: the sends alarm would pause everything, the resets included.

## What the guards cost

All of it fits in AWS's always-free tiers, as long as nothing else in the account uses them:

- **CloudWatch:** 10 alarm metrics (six single-metric alarms, the three log and SNS ones included,
  and two rate alarms of two metrics each) and 2 custom metrics from the log filters, against 10 of each free. Beyond the free tier, 0.10 USD
  per alarm metric and 0.30 USD per custom metric, a month.
- **Budgets:** one budget with an action; the first two are free.
- **SNS and Lambda:** a few messages and invocations a month.

The budget counts SES's spend before credits and refunds: credits in the account would otherwise
keep it at zero while SES spends.

The stack itself costs nothing to keep. Deleting it removes everything but the domain identity. That
identity still names `ledger-flow` as its default configuration set, which is gone with the stack:
before deleting the stack, clear the identity's default configuration set in the SES console and
remove `EMAIL_SES_CONFIGURATION_SET` from the Lambda, so nothing sends through a set that no longer
exists.
