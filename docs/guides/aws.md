# The AWS Account, Declared

Everything the API runs on in AWS is declared in `infra/` and deployed with one command, part by
part, so nothing is changed by hand in the console and a session can say, by reading, whether the
account still matches what is declared. The code is not part of it: `npm run deploy:lambda`
([Deployment](./deployment.md)) uploads it exactly as before.

| Part | Stack | Template | What it holds |
| --- | --- | --- | --- |
| `api` | `ledger-flow-api` | `infra/api.yaml` | The Lambda function and every one of its environment variables, its role and the role's log permission, its public URL and the two permissions behind it, its log group (30 days), and the daily rule that keeps Atlas awake and runs the nightly pass, with its permission |
| `access` | `ledger-flow-access` | `infra/access.yaml` | The `lag-deploy` user: what `deploy:lambda` needs, the read-only policy of the email guide, the AWS-managed `SecurityAudit` and what `infra:check` needs |
| `email` | `ledger-flow-email` | `infra/email.yaml` | SES, its events, the alarms and the budget ([Email in Production](./email.md)) |

Why it is built this way (CloudFormation, the secrets in SSM, adopting instead of recreating, the
refusals): [ADR-005](../architecture/decisions/005-aws-declared-in-cloudformation.md).

## Day to day

There are two deploys. **The code** goes with `npm run deploy:lambda` and the deploy profile
(`AWS_PROFILE`), exactly as before T-246. **Everything else** — the Lambda's environment variables,
its memory and timeout, the daily rule, permissions, alarms, the budget — goes with
`npm run deploy:infra -- <part>` and the administrator profile (`INFRA_AWS_PROFILE`, [Signing in](#signing-in)), after the change
is written in `infra/` and merged. Nothing is changed in the AWS console (the one exception is an
emergency, [below](#changes-made-in-the-console)).

| You want to | Change | Then run |
| --- | --- | --- |
| Ship merged code of this repository | — | `npm run deploy:lambda` |
| Change a production variable that is not a secret (a cap, a switch, `LOG_LEVEL`, `CORS_ORIGIN`, …) | `infra/api.yaml`, `ApiFunction` → `Environment` → `Variables` | `npm run deploy:infra -- api`; it applies from the next invocation, with no code deploy |
| Change a secret (`MONGO_URI`, `JWT_SECRET`, `REFRESH_SECRET`, `API_SECRET`, `TURNSTILE_SECRET`) | Its value in Parameter Store, in the AWS console ([The secrets](#the-secrets)) | `npm run deploy:infra -- api` |
| Add a variable the code reads | In the same pull request: its schema in `src/shared/constants.ts`, [Environment Variables](./environment-vars.md), `.env.example`, and its value in `infra/api.yaml` | **First** `npm run deploy:infra -- api`, **then** `npm run deploy:lambda`: code that needs a variable refuses to start without it |
| Add a secret the code reads | As above, but the value goes to SSM, a `NoEcho` parameter in `infra/api.yaml` and an entry in `API_SECRETS` (`scripts/infra/parts.ts`) | Create its SSM parameter, then as above |
| Remove a variable | The code that reads it, then `infra/api.yaml` | **First** `npm run deploy:lambda`, **then** `npm run deploy:infra -- api` |
| Change the daily rule, the memory, the timeout, the logs' retention | `infra/api.yaml` | `npm run deploy:infra -- api` |
| Change what `lag-deploy` may do | `infra/access.yaml` | `npm run deploy:infra -- access` |
| Change an alarm threshold or the budget | `infra/email.yaml`, the parameter's `Default` | `npm run deploy:infra -- email` |
| Deploy everything | — | `npm run deploy:infra -- access`, `-- api`, `-- email`, then `npm run deploy:lambda`. A part with nothing new says "Nothing to deploy" and touches nothing |
| Know whether the account matches `infra/` | — | `npm run infra:check` (read-only; what a session runs after every deploy) |

The tests hold the template to the code: `src/__tests__/infra/apiStack.test.ts` fails when
`infra/api.yaml` names a variable the API does not read, takes a secret from anything but a hidden
parameter, or declares values the production schema of `src/shared/constants.ts` refuses.

## The two commands

```bash
npm run deploy:infra -- <api|access|email>   # an administrator profile: INFRA_AWS_PROFILE
npm run infra:check                           # the deploy profile: AWS_PROFILE
```

**Which part to run.** Each part is one area of the account; run the one whose file you changed.

| Part | What it is, in short | Run it when |
| --- | --- | --- |
| `api` | The server: the Lambda that answers the web client, everything around it (its variables and secrets, memory and timeout, public URL, logs) and the daily rule that keeps Atlas awake and runs the nightly pass (deadline emails, erasing accounts past their 30 days) | You changed `infra/api.yaml` (a variable, a cap, a switch, the daily rule) or a secret in Parameter Store. The most common one |
| `access` | Who may deploy: the `lag-deploy` user and what it is allowed to do (upload the code, read the account) | You changed `infra/access.yaml`. Rare |
| `email` | Sending email: SES, its bounce and complaint events, the alarms that pause SES, and the 1 USD budget | You changed `infra/email.yaml` (an alarm threshold, the budget), or the api part changed the function's name, role or URL |

Not sure which one? Run all three, `access`, `api` and `email`: a part with nothing new says "Nothing
to deploy" and touches nothing. The **code** is none of them: that is `npm run deploy:lambda`.

`deploy:infra` never applies anything on its own. It creates a CloudFormation change set, prints one
line per resource it would add, modify or import (the names of what changes, never a value), and
waits for `yes`; anything else, or Ctrl-C, discards it. It **refuses**, and applies nothing:

- when anything would be removed, replaced or might be replaced;
- when the function's code would change (the template carries a placeholder; only `deploy:lambda`
  uploads code);
- when the stack was changed outside it ([below](#changes-made-in-the-console)): before every update it runs
  CloudFormation's drift detection and names what differs;
- when the stack does not exist: `--import` adopts what was made by hand, `--create` builds it in an
  empty account.

"Nothing to deploy" means the template and its parameters are those of the last deploy, not that
the account matches them: that is `infra:check`'s answer. Every resource of `api` and `access` is
`Retain`, and once deployed those two stacks carry a **stack policy** that makes AWS itself refuse
replacing or removing any of their resources, from this command or from the console, and
**termination protection**.

`infra:check` writes nothing (drift detection only records its result). It:

- runs CloudFormation's drift detection on the three stacks, and names the resources it cannot
  compare;
- lists what the account has (functions, rules, users, roles, policies, topics, log groups, alarms, SES
  identities) and names, by type, anything no stack declares;
- looks where drift detection does not: policies attached to the API's role besides its logs policy
  and the budget's deny, inline ones besides `ledger-flow-send-email`, permissions on the function no
  template gives, CORS on its URL, a second access key or a console password on `lag-deploy`;
- checks that the secrets of the next section exist as `SecureString`.

It prints the names of what differs, never a value, and exits 1 when anything does.

## Signing in

Two AWS profiles, both named in `.env.deploy`:

| Profile | In `.env.deploy` | Used by | How it signs in |
| --- | --- | --- | --- |
| `lag-deploy` | `AWS_PROFILE` | `deploy:lambda`, `infra:check` | Its access key ([Deployment](./deployment.md), Option A): nothing to do, it does not expire |
| The administrator (`ledgerflow-admin` on the owner's machine) | `INFRA_AWS_PROFILE` | `deploy:infra` | `aws login`: you sign in in the browser, with MFA, and the CLI gets temporary credentials |

**Once per machine**, create the administrator profile and sign in (AWS CLI v2 from late 2025 or newer):

```bash
aws configure set region us-east-1 --profile ledgerflow-admin
aws login --profile ledgerflow-admin
```

`aws login` opens the browser; sign in to the AWS account there and come back to the terminal.

**Every time after that, you do not have to sign in first.** `deploy:infra` checks the session before
anything else; when it has expired it runs `aws login --profile <INFRA_AWS_PROFILE>` itself, waits for
the browser sign-in and carries on. Running `aws login --profile ledgerflow-admin` by hand first does
the same. To see which identity a profile is signed in as:
`aws sts get-caller-identity --profile ledgerflow-admin`.

## Changes made in the console

**An emergency change in the console still works** — `EMAIL_SENDING_ENABLED=false` on the Lambda
stops every email on the next invocation — and nothing undoes it by accident: `infra:check` reports
it, and `deploy:infra -- api` refuses to deploy until the same change is in the template or undone in
the console (`--overwrite-drift` deploys anyway, putting the template's values back). A deploy that
changes any variable sends the whole list, so this is what keeps an emergency switch from vanishing
mid-incident.

A change the stack policy forbids (renaming the function, say, which replaces it) is not done
through this command: it is planned with the owner, since it moves the URL.

The email part takes the API's function, role and URL from the `ledger-flow-api` stack's outputs and
keeps the alert address it already has; every other parameter is the template's default.

## The secrets

The five values that must not be in a repository live in SSM Parameter Store as `SecureString`
(free, encrypted with the account's AWS-managed key), and `deploy:infra -- api` reads them and passes
them to CloudFormation as hidden (`NoEcho`) parameters. CloudFormation cannot read a secure string into
a Lambda's environment on its own: only a few resource types accept one.

| Parameter | Variable |
| --- | --- |
| `/ledger-flow/api/MONGO_URI` | `MONGO_URI` |
| `/ledger-flow/api/JWT_SECRET` | `JWT_SECRET` |
| `/ledger-flow/api/REFRESH_SECRET` | `REFRESH_SECRET` |
| `/ledger-flow/api/API_SECRET` | `API_SECRET` |
| `/ledger-flow/api/TURNSTILE_SECRET` | `TURNSTILE_SECRET` |

**Changing a secret in SSM changes nothing in the running API by itself:** the Lambda gets the new
value only when `npm run deploy:infra -- api` runs. So it is always two steps, the value and then the
deploy.

**In the AWS console** (signed in as the administrator, region **N. Virginia, us-east-1**):

1. Type `Parameter Store` in the console's search bar and open it (it is part of Systems Manager).
2. The five parameters are listed by name. To see one, click its name and choose **Show decrypted
   value** (shown on screen only).
3. To change it: **Edit** → paste the new value in **Value** → **Save changes**. Its version goes up by
   one.
4. Run `npm run deploy:infra -- api`. The change set shows `Modify ApiFunction: Environment`; type `yes`.

To add one, **Create parameter**: the name `/ledger-flow/api/<VARIABLE>`, tier **Standard** (free),
type **SecureString**, the KMS key the console proposes (`alias/aws/ssm`), and the value. A new secret
also needs code ([Day to day](#day-to-day)).

**Or from a terminal**, the same change (the value is typed, never left in a file or the history):

```bash
read -rs VALUE && aws ssm put-parameter --profile ledgerflow-admin --region us-east-1 \
  --name /ledger-flow/api/<VARIABLE> --type SecureString --overwrite --value "$VALUE"; unset VALUE
```

`API_SECRET` is shared with the web client's `API_SECRET` in Vercel, so the two change together.
`MONGO_URI` is also in `.env.deploy`, for the index step of `deploy:lambda`.

## Adopting what already existed (once, T-246)

The account was built by hand before T-246, from the Lambda console and the scripts of the time.
Its resources were **adopted**, not recreated: an import change set hands each existing resource to
a stack without touching it, so the function keeps its URL, its logs and its code. `infra/import/`
says, per part, which resource each one is (`resources`) and, where the template declares something
the account did not have yet, what it had (`asItIs`): CloudFormation compares a new template with
the last one it was given, not with the account, so the import has to describe the account as it was
for the next deploy to see the difference.

```bash
# 1. The five secrets, copied from the Lambda into SSM without printing them
P=ledgerflow-admin
for V in MONGO_URI JWT_SECRET REFRESH_SECRET API_SECRET TURNSTILE_SECRET; do
  VALUE="$(aws lambda get-function-configuration --profile $P --region us-east-1 \
    --function-name ledgerflow --query "Environment.Variables.$V" --output text)"
  [ -n "$VALUE" ] && [ "$VALUE" != None ] || { echo "$V is not on the function: stop"; break; }
  aws ssm put-parameter --profile $P --region us-east-1 --name "/ledger-flow/api/$V" \
    --type SecureString --value "$VALUE" --query Version --output text
done; unset VALUE

# 2. Adopt, then apply what the templates add
npm run deploy:infra -- access --import   # 3 imports
npm run deploy:infra -- access            # the check's permission; the keepalive script's permissions go
npm run deploy:infra -- api --import      # 9 imports
npm run infra:check                       # read back before the api changes anything
npm run deploy:infra -- api               # the logs' 30 days, and the outputs
npm run deploy:infra -- email             # nothing to deploy

# 3. Read it back
npm run infra:check
```

`api --import` first compares the function's 20 variables with what `infra/api.yaml` and SSM
declare, and refuses, naming them, if any differs: adopted with a difference, the next change to any
variable would push the declared value. After every import the command runs drift detection, so a
wrong `infra/import/` says so at once rather than at the next deploy.

What stays out of every stack, on purpose:

- **The access key of `lag-deploy`**: a key made by a template would sit in its outputs. An
  administrator creates and rotates it in IAM.
- **The account itself**: the root user's MFA, the billing contact, the free plan.
- **SES's account settings**: the pricing plan and the production access (steps 1 and 6 of the
  email guide), which are requests, not resources.
- **"My Zero-Spend Budget"**, the budget AWS suggests to every account: CloudFormation cannot adopt
  a budget, and it guards the whole account rather than the app.
- **The bucket `cf-templates-…`**, which the CloudFormation console makes for templates uploaded
  through it.
- **What is not AWS**: Cloudflare's DNS and Turnstile, Vercel and its rate limit, Atlas, Sentry.

## A new account

The templates create everything from nothing as well as adopt it (`deploy:infra` makes a `CREATE`
change set when the stack does not exist), in this order: the secrets in SSM, `api`, `deploy:lambda`,
`access`, then the email guide from its step 1 (its stack is created once by hand, step 2, and kept
up to date with `deploy:infra -- email` from then on). **It has not been rehearsed yet**: until it is,
treat it as the plan, not as a tested procedure.
