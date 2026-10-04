# ADR-005: The AWS Account Declared in CloudFormation

## Status

Accepted (T-246, 2026-10-04)

## Context

Until T-246 the API's AWS account was built by hand: the Lambda function, its role, URL, permissions
and environment variables in the console, the daily rule by a script (`setup-keepalive.sh`), the deploy
user and its policies in IAM. Only the email guards were a template (`infra/email.yaml`). Moving to
another account meant repeating that work from memory, a variable changed in the console left no
trace, and nothing could say whether the account still matched the documentation.

The owner asked for:

- a deploy that creates and configures everything and updates it when something changes;
- the code deploy unchanged;
- the existing account adopted, never deleted or recreated: the function's URL, its logs, the alarms and
  SES's reputation had to survive;
- a dry run he approves before anything changes;
- deploys by part.

He decided four things on 2026-10-04:

- the secrets go to SSM Parameter Store and everything else is written in the repository;
- the infrastructure deploy runs with his administrator profile, while `lag-deploy` stays minimal;
- the API's logs are kept 30 days;
- what is not AWS (Cloudflare, Vercel, Atlas, Sentry) stays as it is.

## Decision

**CloudFormation, three stacks, one script that only applies what it has shown.**

- `infra/api.yaml` (`ledger-flow-api`), `infra/access.yaml` (`ledger-flow-access`) and the existing
  `infra/email.yaml` (`ledger-flow-email`), deployed one at a time with `npm run deploy:infra -- <part>`
  ([The AWS Account, Declared](../../guides/aws.md)).
- **The code stays out.** The function's `Code` is a fixed placeholder that CloudFormation never
  re-uploads, since that text never changes; `npm run deploy:lambda` owns the code. The script refuses
  any change set that would touch `Code`.
- **Every variable is in `infra/api.yaml`**, so a change to one is a reviewed commit. The five secrets
  are hidden (`NoEcho`) parameters that the script fills from SSM `SecureString`s. CloudFormation cannot
  resolve an `ssm-secure` reference into a Lambda's environment; only a few resource types accept one.
- **Adopting, not recreating.** `infra/import/<part>.json` names each existing resource for an import
  change set. CloudFormation compares a new template with the previous one, not with the account, so
  where the template declares more than the account had, the import file describes what it had
  (`asItIs`), and the next deploy shows and applies the difference. Before adopting the function, the
  script compares its 20 live variables with the declared ones.
- **Refusals in the script, and in AWS.** The script refuses:
  - a removal or replacement, including a conditional one;
  - a stack that drifted, since a deploy that changes one variable sends them all and would silently undo
    an emergency switch set in the console;
  - a missing stack without `--import` or `--create`.

  The adopted stacks carry a stack policy that denies `Update:Replace` and `Update:Delete`, and
  termination protection, so the console cannot replace or remove their resources either. Every
  resource is `Retain`.
- **Reading it back.** `npm run infra:check` runs with the deploy profile and writes nothing. It runs
  drift detection, lists resources no stack declares, and checks what drift detection cannot see:
  extra role policies, function permissions, CORS, and access keys or a console login on the deploy
  user.

## Consequences

**Easier:**

- Every change to the account is a diff in a pull request, shown again as a change set before it applies.
- A session can answer "is the account what the repository says?" by reading, with the deploy user.
- A variable, a cap or the daily rule changes without the console, and without a code deploy.
- The adoption kept the URL, the logs, the alarms and SES untouched (`infra:check` matched on 2026-10-04).

**Harder:**

- Changing a production variable now means a commit, a merge and `deploy:infra`, instead of a console
  edit. An emergency console change still works, but the next `deploy:infra -- api` refuses until the
  template says the same.
- Adding a variable the code needs has an order: the infrastructure first, then the code.
- `lag-deploy` carries a list of read permissions that drift detection needs, one per resource type.
  They were taken from CloudFormation's published schemas and checked with
  `iam:SimulatePrincipalPolicy`; a new resource type may need more.
- Creating everything in an empty account (`--create`) is written but **not rehearsed yet**; the
  rehearsal is a later task. The email stack is still created by hand the first time.

## Alternatives Considered

- **Terraform:** good at importing (`import` blocks), but it needs a state file kept somewhere: an
  S3 bucket and a lock table to create and secure first, or a third-party service. It also adds a tool
  and a language next to the CloudFormation the email guards already used.
- **AWS CDK or SAM:** both generate CloudFormation. CDK needs a bootstrap stack with an S3 bucket and
  IAM roles in every account and region. SAM's `sam deploy` cannot import existing resources. Both add a
  build step and a dependency for templates this size.
- **`aws cloudformation deploy` alone:** it cannot import, and it cannot refuse a replacement before
  applying it. The script is a thin layer over the change-set API for exactly those two things.
- **Secrets in Secrets Manager:** 0.40 USD a month per secret, against SSM Parameter Store's free
  standard tier, for features (rotation) the app does not use.
- **The function reading SSM at start-up:** it would keep the secrets out of the Lambda's
  configuration, but `src/shared/constants.ts` validates the environment synchronously on import, and
  every cold start would wait on SSM. Rejected for now.
