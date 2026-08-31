# Production Deployment Guide

The production target is **AWS Lambda + a Function URL**, backed by **MongoDB Atlas**. The application is Mongo-only; there is no SQL backend and no data-migration step.

## Prerequisites

- Node.js 22 (the version CI builds and tests against)
- A MongoDB **replica set** — Atlas is one out of the box. Multi-document transactions (used for balance adjustments) are rejected by a standalone `mongod`, so `MONGO_URI` must point at a replica set
- Environment variables configured (see `docs/guides/environment-vars.md`)
- TLS termination: the Lambda Function URL provides it; a self-hosted `dist/server.js` needs a reverse proxy (nginx, Caddy, AWS ALB, ...)

## Building for Production

```bash
# Install dependencies (production only)
npm ci --omit=dev

# Compile TypeScript
npm run build

# Output: dist/ directory
```

The compiled application entry point is `dist/server.js`.

## AWS Lambda Deployment

The production API runs as a Lambda function using `@codegenie/serverless-express`. The Lambda entry point is `dist/lambda.handler` (compiled from `src/lambda.ts`).

**Routine deploy (once the one-time setup below is done):**

```bash
npm run deploy:lambda
```

### Prerequisites

#### 1. Install AWS CLI v2

No sudo required — user-local install:

```bash
curl -L https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install -i ~/.local/aws-cli -b ~/.local/bin
aws --version   # ~/.local/bin must be on your PATH
```

#### 2. Create the deploy credentials

All options below use the same **least-privilege policy** — it only allows touching this one Lambda function and the keepalive EventBridge rule, so the blast radius of a leaked credential is minimal (adjust the function/rule names if yours differ):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "DeployLambda",
         "Effect": "Allow",
         "Action": [
           "lambda:GetFunction",
           "lambda:GetFunctionConfiguration",
           "lambda:UpdateFunctionCode",
           "lambda:UpdateFunctionConfiguration",
           "lambda:AddPermission",
           "lambda:InvokeFunction"
         ],
         "Resource": "arn:aws:lambda:*:*:function:<your-function-name>*"
       },
       {
         "Sid": "KeepaliveRule",
         "Effect": "Allow",
         "Action": [
           "events:PutRule",
           "events:PutTargets",
           "events:DescribeRule"
         ],
         "Resource": "arn:aws:events:*:*:rule/lag-money-manager-keepalive*"
       }
     ]
   }
   ```

   Optionally attach the AWS-managed `CloudWatchLogsReadOnlyAccess` policy too, so you can read Lambda logs from the CLI when debugging.

##### Option A — dedicated IAM user with access keys (recommended, the currently used setup)

1. Console → *IAM → Users → Create user*, name it e.g. `lag-deploy`. No console access needed.
2. On the permissions step choose *Attach policies directly* → *Create policy* → JSON → paste the policy above. **Replace `<your-function-name>` with the real function name** (an `AccessDeniedException` on deploy usually means this placeholder was left in, or the name does not match).
3. *Security credentials → Create access key → Command Line Interface (CLI)* → on the "Alternatives recommended" notice, tick the confirmation and continue → copy the **Access Key ID** and **Secret Access Key** (the secret is shown only once; if you lose it, delete the key and create a new one).
4. Configure the profile (run it in a regular terminal so the secret is typed interactively, never stored in shell history or logs):

   ```bash
   aws configure --profile lag-deploy
   # AWS Access Key ID: (paste)
   # AWS Secret Access Key: (paste)
   # Default region: the region where the Lambda lives (e.g. us-east-1)
   # Output format: press Enter
   ```

The keys land in `~/.aws/credentials` (kept `600` by the CLI). Rotate them occasionally (*IAM → user → Security credentials*); with this policy a leaked key can only touch this function and the keepalive rule — nothing else in the account.

##### Option B — `aws login` with a dedicated IAM user (temporary credentials)

Browser-based console sign-in; no long-lived secrets on disk, no AWS Organizations required. Needs AWS CLI v2 late 2025 or newer.

> Note: in some accounts/browsers this flow fails with a **400 Bad Request** on the sign-in page (it did in this project's setup). If that happens, fall back to Option A.

1. Same user and policy as Option A, but **enable console access** (set a password; add MFA, recommended) and skip the access key.
2. Configure the profile region and log in:

   ```bash
   aws configure set region <lambda-region> --profile lag-deploy
   aws login --profile lag-deploy
   # Opens the browser: sign in as the lag-deploy IAM user
   ```

Sessions are temporary; when one expires, the deploy scripts re-run `aws login` for you.

##### Option C — IAM Identity Center SSO (accounts already on a paid plan / with Organizations)

> ⚠️ Identity Center requires AWS Organizations. On free-plan accounts, creating an organization upgrades the account to pay-as-you-go and **expires your free-tier credits immediately** — prefer Option A there.

Temporary credentials, nothing sensitive on disk. One-time setup:

1. **Enable IAM Identity Center**: console → *IAM Identity Center* → *Enable*. Note the **AWS access portal URL** (`https://<something>.awsapps.com/start`).
2. **Create your user**: *IAM Identity Center → Users → Add user*, accept the invitation email (+ MFA, recommended).
3. **Create a permission set**: *Permission sets → Create → Custom permission set → Inline policy* → paste the policy above.
4. **Assign it**: *AWS accounts* → your account → *Assign users* → your user + the permission set.
5. Configure the profile:

   ```bash
   aws configure sso
   ```

   | Prompt                  | Value                                          |
   | ----------------------- | ---------------------------------------------- |
   | SSO session name        | anything, e.g. `lag`                           |
   | SSO start URL           | the access portal URL from step 1              |
   | SSO region              | the region where you enabled Identity Center   |
   | SSO registration scopes | accept the default (`sso:account:access`)      |
   | Account / role          | pick your account and the permission set       |
   | Default client region   | the region where the Lambda lives              |
   | Profile name            | e.g. `lag-deploy` (this goes in `.env.deploy`) |

With any of the three options the deploy scripts validate the session before doing anything: an expired `aws login` or SSO session re-opens the browser login automatically, and a missing or broken profile fails fast with a clear message.

#### 3. Deployment settings

Copy the template into `.env.deploy` (gitignored) and fill it in:

```bash
cp .env.deploy.example .env.deploy
```

  | Variable               | Description                                    |
  | ---------------------- | ---------------------------------------------- |
  | `AWS_PROFILE`          | Named CLI profile created in step 2            |
  | `AWS_REGION`           | Region where the function lives                |
  | `LAMBDA_FUNCTION_NAME` | Exact function name from the Lambda console    |
  | `KEEPALIVE_RULE_NAME`  | Optional. EventBridge rule name for keepalive  |
  | `KEEPALIVE_SCHEDULE`   | Optional. Defaults to `rate(1 day)`            |

### Deploying

```bash
npm run deploy:lambda
```

The script (`scripts/deploy-lambda.sh`):

1. Verifies the credentials for `AWS_PROFILE` (access keys are used as-is; an expired `aws login`/SSO session re-opens the browser login; a missing profile fails fast with instructions)
2. Compiles TypeScript to `dist/`
3. Syncs MongoDB indexes (`NODE_ENV=production npm run db:sync-indexes`) **when `MONGO_URI` is set** in the environment or in `.env.deploy`; otherwise it warns and skips — see [Index creation](#index-creation) below
4. Installs **production-only** dependencies into a clean staging directory (`build/lambda-package/`)
5. Zips `dist/ + node_modules/ + package.json` into `build/lambda.zip`
6. Uploads it with `aws lambda update-function-code` and waits for the update to complete
7. Warns if the function's configured handler is not `dist/lambda.handler`

The zip layout requires the function handler to be **`dist/lambda.handler`**. Runtime environment variables (`MONGO_URI`, `JWT_SECRET`, `API_SECRET`, ...) are **not** part of the package — manage them in the Lambda console or with `aws lambda update-function-configuration --environment`.

### Index creation

`autoIndex` is enabled everywhere **except** `NODE_ENV=production` (`src/config/mongoConnection.ts`), so production never builds indexes as a side effect of serving a request. They are created by an explicit deploy step:

```bash
NODE_ENV=production MONGO_URI=<production uri> npm run db:sync-indexes
```

`scripts/sync-indexes.ts` calls `syncIndexes()` on every model (User, Account, Category, Transaction, RateLimit, Budget, IdempotencyKey) — it creates the missing ones and **drops indexes that no longer exist in the schema**. Run it before the new code serves traffic; several correctness guarantees depend on indexes rather than application code (the partial unique index for "one default account per user", the case-insensitive unique category name, and the TTL indexes that expire rate-limit, idempotency and refresh-session documents).

### Required production configuration

| Variable      | Why it matters in production                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGO_URI`   | Must point at a **replica set** — transactions fail otherwise                                                                             |
| `API_SECRET`  | Must be set: with `NODE_ENV=production` a missing value makes every request fail with a 500 "Server misconfiguration" (fail-closed)        |
| `JWT_SECRET`  | Required by the env schema; the process refuses to start without it                                                                       |
| `CORS_ORIGIN` | Required; comma-separated list of allowed origins                                                                                         |

Once `API_SECRET` is set, **every** request must carry the `x-api-secret` header — including `GET /`, `GET /health/db` and `/auth/*`. Requests without it (or with a wrong value) get `403 Access denied`. See `src/app/middlewares/gatewaySecretMiddleware.ts`.

Swagger UI is **not** served in production: `/api-docs` is only mounted when `NODE_ENV !== "production"` (`src/app.ts`).

### Database Keepalive (MongoDB Atlas free tier)

Atlas pauses free clusters after ~60 days without connections, which takes the whole API down (requests fail with `503 Database connection unavailable`). A daily EventBridge rule keeps the cluster active:

```bash
npm run deploy:keepalive
```

The script (`scripts/setup-keepalive.sh`) is idempotent, uses the same credential check as the deploy script, and:

1. Creates/updates an EventBridge rule (default: `rate(1 day)`)
2. Grants EventBridge permission to invoke the function
3. Targets the function with the payload `{"source":"lag.keepalive"}`

`src/lambda.ts` recognizes that payload and runs a database ping instead of routing through Express. Cost: ~30 invocations/month — effectively $0 (Lambda free tier: 1M requests/month; EventBridge scheduled invocations: $1 per million).

To verify it works end to end:

```bash
aws lambda invoke --function-name <name> \
  --payload '{"source":"lag.keepalive"}' \
  --cli-binary-format raw-in-base64-out \
  --profile <profile> --region <region> /dev/stdout
# Expected output: {"ok":true}
```

### Health Check Endpoint

`GET /health/db` (requires the `x-api-secret` header) opens a real database connection and returns `200 {"database":"ok"}`, or `503` if the database is unreachable. Use it to distinguish "Lambda down" from "database down" without digging through CloudWatch logs.

### Database Failure Behavior

- Connection errors return **`503 ServiceUnavailable` — "Database connection unavailable, please try again later"** (instead of a generic 500).
- Mongoose command buffering is disabled and `serverSelectionTimeoutMS` is 5s, so failures surface in ~5s with the real error instead of a 10s `buffering timed out`.
- On Lambda, a failed initial connection is retried on the next request; the process only exits (`process.exit(1)`) when running as a long-lived server, where the orchestrator restarts it.

## Running the Application (long-lived server)

The sections below cover the alternative to Lambda: running `dist/server.js` as a normal process (container, VM, PM2). The Lambda deployment uses `dist/lambda.handler` and none of the reverse-proxy / process-manager setup here.

```bash
NODE_ENV=production node dist/server.js
```

Or with a process manager like PM2:

```bash
pm2 start dist/server.js --name lag-money-manager
```

## HTTPS Configuration

The application enforces HTTPS in production (`NODE_ENV=production`):

- Sets `trust proxy` to `1` (trusts the first proxy hop)
- Redirects all non-HTTPS requests with a `301` to their HTTPS equivalent
- Checks `req.secure` and the `X-Forwarded-Proto` header

**You must terminate TLS at a reverse proxy** (nginx, Caddy, AWS ALB, etc.) in front of the Node.js process. The application itself does not manage TLS certificates.

Example nginx configuration:

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate     /etc/ssl/certs/api.example.com.pem;
    ssl_certificate_key /etc/ssl/private/api.example.com.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Database Connection Pool Tuning

Pool options are set in code (`src/config/mongoConnection.ts`), not through the URI:

| Option                      | Value                                    | Rationale                                                                                                     |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `maxPoolSize`               | `5` on Lambda, `10` elsewhere            | Atlas M0 caps ~500 connections cluster-wide; the driver default of 100 per process exhausts it with a handful of warm Lambda instances |
| `serverSelectionTimeoutMS`  | `5000`                                   | Failures surface in ~5s with the real error                                                                    |
| `bufferCommands`            | `false` (global)                         | No 10s "buffering timed out" masking a connection error                                                        |
| `autoIndex`                 | on except `NODE_ENV=production`          | Production indexes come from `npm run db:sync-indexes`                                                         |

Lambda detection is based on `AWS_LAMBDA_FUNCTION_NAME`, which the runtime sets. Raising throughput means editing that file, not the URI — a `maxPoolSize` query parameter in `MONGO_URI` is overridden by the explicit connect option.

## Graceful Shutdown

The application handles `SIGTERM` and `SIGINT` signals for graceful shutdown (implemented in `src/server.ts`):

1. Receives the signal
2. Stops accepting new HTTP connections (`server.close()`)
3. Closes the database connection (Mongoose `disconnect()`)
4. Logs "Graceful shutdown complete"
5. Exits with code `0`

This ensures in-flight requests complete before the process terminates. Container orchestrators (Docker, Kubernetes) send `SIGTERM` before force-killing.

**Kubernetes deployment tip:** Set `terminationGracePeriodSeconds` to at least 30 to allow pending requests to drain.

## Container Health Checks

### Docker Compose

Add a health check to the application service:

```yaml
services:
  app:
    build: .
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

The `GET /` endpoint returns `200 { "hello": "world!" }` and can be used as a liveness probe. When `API_SECRET` is set the probe must send the `x-api-secret` header too, or it gets a `403` and the container is restarted forever.

### Kubernetes

```yaml
livenessProbe:
  httpGet:
    path: /
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
```

## Rate Limiting

Two layers, both with a 15-minute window:

| Layer                                                | Applies to                                    | Limit                                          | Store                                                              |
| ---------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| Global limiter (`express-rate-limit`, `src/app.ts`)  | Every mounted route, `/` and `/health/db` too | `RATE_LIMIT_MAX` per IP (default `200`)        | In-memory — **per Lambda instance**, so the effective ceiling scales with concurrency |
| Auth limiter (`authRateLimitMiddleware.ts`)          | `/auth/login`, `/auth/register`, `/auth/refresh` | `AUTH_RATE_LIMIT_MAX` (default `10`); refresh uses `REFRESH_RATE_LIMIT_MAX` (default `60`) | MongoDB (`RateLimitModel`), so the limit holds across instances     |

Login is limited on two dimensions: per IP and per target email. The per-email counter is refunded on success, so only failed logins burn that budget. Over-limit responses are `429` with `code: "RATE_LIMITED"` and a `Retry-After` header; the store failing open is deliberate — a Mongo error must not lock everyone out of login.

The global limiter emits standard `RateLimit-*` headers. In production `trust proxy` is set to `1`, so the limiters see the real client IP rather than the proxy's.

## Security Headers

Helmet.js is enabled by default and sets the following headers:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Strict-Transport-Security` (when served over HTTPS)
- `X-XSS-Protection`
- Content Security Policy defaults

## Logging

Pino outputs structured JSON logs in production (`NODE_ENV=production`). Configure `LOG_LEVEL` to control verbosity:

| Level   | Use case                              |
| ------- | ------------------------------------- |
| `error` | Production (minimal output)           |
| `warn`  | Production (with warnings)            |
| `info`  | Default — startup, shutdown, requests |
| `debug` | Troubleshooting                       |
| `trace` | Full verbosity                        |

Pipe logs to a log aggregator (ELK, Datadog, CloudWatch) for monitoring:

```bash
node dist/server.js | pino-transport -t pino-elasticsearch
```

## Environment Variable Checklist

Before deploying, ensure these are set:

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` — strong, unique secret (min 32 characters)
- [ ] `API_SECRET` — required in production; every request must then send `x-api-secret`
- [ ] `CORS_ORIGIN` — your frontend domain(s), not `*`
- [ ] `MONGO_URI` — points at a replica set (Atlas `mongodb+srv://...`)
- [ ] `LOG_LEVEL` — appropriate for production (`info` or `warn`)
- [ ] `BCRYPT_SALT_ROUNDS` — 12+ for production
- [ ] Indexes synced (`npm run db:sync-indexes`) before the new code serves traffic

Optional: `REFRESH_SECRET` (falls back to `JWT_SECRET`; a separate value lets you rotate the access secret without invalidating every session), `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`, `REFRESH_RATE_LIMIT_MAX`, `JWT_EXPIRATION`, `REFRESH_TOKEN_EXPIRATION`.

See `docs/guides/environment-vars.md` for the complete list.
