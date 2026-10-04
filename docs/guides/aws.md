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

## The two commands

```bash
npm run deploy:infra -- <api|access|email>   # an administrator profile: INFRA_AWS_PROFILE
npm run infra:check                           # the deploy profile: AWS_PROFILE
```

`deploy:infra` never applies anything on its own. It creates a CloudFormation change set, prints one
line per resource it would add, modify or import (the names of what changes, never a value), and
waits for `yes`; anything else, or Ctrl-C, discards it. It **refuses**, and applies nothing:

- when anything would be removed, replaced or might be replaced;
- when the function's code would change (the template carries a placeholder; only `deploy:lambda`
  uploads code);
- when the stack was changed outside it ([below](#changing-something)): before every update it runs
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

Both read `.env.deploy`: `INFRA_AWS_PROFILE` is the administrator (an `aws login` profile with MFA;
`deploy:infra` opens the login when its session has expired), `AWS_PROFILE` stays `lag-deploy`.

## Changing something

Edit the template, open the pull request, and once it is merged run that part:

| To change | Edit | Then |
| --- | --- | --- |
| An environment variable of the API (a cap, a switch, `LOG_LEVEL`, …) | `infra/api.yaml`, `ApiFunction` → `Environment` | `npm run deploy:infra -- api` |
| A secret | SSM, [below](#the-secrets) | `npm run deploy:infra -- api` |
| The daily rule, the memory, the timeout, the logs' retention | `infra/api.yaml` | `npm run deploy:infra -- api` |
| What `lag-deploy` may do | `infra/access.yaml` | `npm run deploy:infra -- access` |
| An alarm threshold, the budget | `infra/email.yaml`, the parameter's `Default` | `npm run deploy:infra -- email` |
| The code | — | `npm run deploy:lambda`, as always |

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

To change one, overwrite it and deploy the api part (the value is typed into the terminal, never
into a file or the history):

```bash
read -rs VALUE && aws ssm put-parameter --profile <admin profile> --region us-east-1 \
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
