# Environment Variables

All environment variables are validated at startup by the Zod schema in
`src/shared/constants.ts`. The application refuses to start if a required
variable is missing or invalid — the error names the offending variable.

Only the variables listed here are read. Anything else in your `.env` is
ignored (the SQL-era `SEQ_*`, `MYSQL_*`, `MONGO_USERNAME`, `MONGO_PASSWORD`
and `MONGO_DATABASE` variables no longer exist).

## Required

| Variable      | Description                                                                                                           | How to obtain                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `JWT_SECRET`  | Secret for signing access tokens (and refresh tokens unless `REFRESH_SECRET` is set). 32+ chars in production.        | `openssl rand -hex 32`        |
| `CORS_ORIGIN` | Comma-separated list of allowed CORS origins                                                                          | Your frontend URL(s)          |
| `MONGO_URI`   | MongoDB connection URI. Must point at a **replica set** — balance adjustments run inside multi-document transactions. | See [MongoDB](#mongodb) below |

## Application

| Variable    | Default       | Description                                                    |
| ----------- | ------------- | -------------------------------------------------------------- |
| `PORT`      | `3000`        | HTTP server port                                               |
| `NODE_ENV`  | `development` | `development`, `production` or `test`                          |
| `LOG_LEVEL` | `info`        | Pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `DB_TYPE`   | `MONGO`       | Database backend. Only `MONGO` is supported.                   |

`NODE_ENV=production` also turns on HTTPS redirection, stops serving Swagger at
`/api-docs`, disables `autoIndex` (indexes are created by the
`npm run db:sync-indexes` deploy step) and makes a missing `API_SECRET` a fatal
misconfiguration instead of a skipped check.

## Authentication

| Variable                   | Default | Description                                                                                                                               |
| -------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_EXPIRATION`           | `15m`   | Access token lifetime. Short by design; renew with `POST /auth/refresh`.                                                                  |
| `REFRESH_TOKEN_EXPIRATION` | `30d`   | Refresh token lifetime, and the absolute cap of a rotation family (rotation never extends it).                                            |
| `REFRESH_SECRET`           | —       | Optional separate secret for refresh tokens; falls back to `JWT_SECRET`. Lets you rotate the access secret without killing every session. |
| `BCRYPT_SALT_ROUNDS`       | `12`    | bcrypt cost (4–20). Higher = slower and more resistant to offline cracking.                                                               |

## Security and rate limiting

| Variable                 | Default | Description                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `API_SECRET`             | —       | Shared secret expected in the `x-api-secret` header. **See the warning below.**                                                                                                                                                                                                                                                                  |
| `RATE_LIMIT_MAX`         | `1000`  | Per-container brake per 15-minute window, **not a global ceiling**: the store is in memory, so each Lambda container counts on its own (see `deployment.md`). Keyed by **user** once authenticated, and on the public routes by the client IP the gateway states in `x-client-ip` (`req.ip` there is the frontend's server, shared by everyone). |
| `AUTH_RATE_LIMIT_MAX`    | `10`    | Failed `/auth/login` and `/auth/register` attempts per 15-minute window, counted per recognized device or, without a device token, per email and IP (MongoDB-backed, shared across instances). Only failed attempts burn it. Also the cap of `currentPassword` guesses per user.                                                                    |
| `AUTH_EMAIL_RATE_LIMIT_MAX` | `50` | Failed `/auth/login` and `/auth/register` attempts per email per hour from devices without a valid device token, across every IP: the cap of an attack that rotates addresses. It cannot touch a device that already signed in (`docs/modules/auth.md`, Rate Limiting).                                                                |
| `AUTH_IP_RATE_LIMIT_MAX` | `60`    | Per-IP limit for `/auth/login` and `/auth/register` per 15-minute window. Higher than the per-email one on purpose: a carrier NAT puts thousands of unrelated users behind a single address.                                                                                                                                                     |
| `REFRESH_RATE_LIMIT_MAX` | `60`    | Separate, higher limit for `POST /auth/refresh` (a legitimate device refreshes every ~15 min).                                                                                                                                                                                                                                                   |

> **`API_SECRET` is all-or-nothing.** When it is set, **every** request must
> carry a matching `x-api-secret` header or it gets **403 Forbidden** —
> including `/`, `/health/db` and the whole `/auth` surface. Leave it unset in
> local development; set a strong value in production, where a gateway sits in
> front of the API. A stale `API_SECRET` in a local `.env` is the classic
> "the API doesn't respond and I can't see why" symptom — the request log now
> names the reason (`request rejected`, with status and message), so read the
> server output first.

## Email

Nothing sends until `EMAIL_PROVIDERS` names a provider, so a deploy that does not set these changes
nothing. What each limit means, and why it is there: [Email module](../modules/email.md).

| Variable                         | Default                             | Description                                                                                                                               |
| -------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `EMAIL_PROVIDERS`                | —                                   | Comma-separated chain, tried in order: `ses`, `mailpit`. Empty means sending is off. `mailpit` is refused in production.                  |
| `EMAIL_SENDING_ENABLED`          | `true`                              | `false` (or `0`, any case) stops every email at once, without deploying code. Any other value stops the whole API from starting.          |
| `EMAIL_FROM_NAME`                | `Ledger Flow`                       | Sender name: printable ASCII without `"` or `\`, since it goes quoted into a header.                                                     |
| `EMAIL_FROM_ADDRESS`             | `no-reply@ledgerflow.alexpiral.com` | Sender address. SES must have its domain verified.                                                                                        |
| `EMAIL_REPLY_TO`                 | `ledgerflow@alexpiral.com`          | Reply-To, and the contact every email's footer shows.                                                                                     |
| `APP_URL`                        | `https://ledgerflow.alexpiral.com`  | Where every link in an email points (`{APP_URL}/{locale}/…`). Must be https in production; `http://localhost:3001` in development.       |
| `EMAIL_PROVIDER_TIMEOUT_MS`      | `1500`                              | How long each provider gets before the next one is tried.                                                                                 |
| `EMAIL_SES_REGION`               | the Lambda's region                 | SES region, when it is not the one the SDK finds.                                                                                         |
| `EMAIL_SES_CONFIGURATION_SET`    | —                                   | SES configuration set (the one T-223's bounce and complaint events come from).                                                            |
| `MAILPIT_URL`                    | `http://localhost:8025`             | Mailpit's API, for `EMAIL_PROVIDERS=mailpit`.                                                                                             |
| `EMAIL_DAILY_CAP`                | `300`                               | Emails per UTC day, all templates together.                                                                                               |
| `EMAIL_MONTHLY_CAP`              | `9000`                              | Emails per UTC month: 0.90 USD at SES's à la carte price.                                                                                 |
| `EMAIL_RESET_SHARE_PERCENT`      | `30`                                | Share of both caps kept for the password reset.                                                                                           |
| `EMAIL_OTHER_SHARE_PERCENT`      | `20`                                | Share kept for the notification emails of T-131. The rest goes to verification and security notices.                                      |
| `EMAIL_ADDRESS_INTERVAL_SECONDS` | `60`                                | One email per address and purpose in this many seconds.                                                                                   |
| `EMAIL_ADDRESS_DAILY_MAX`        | `5`                                 | Emails per address and purpose in 24 hours.                                                                                               |
| `EMAIL_USER_DAILY_MAX`           | `5`                                 | Verification and email-change emails one account can send in 24 hours, to any address.                                                   |
| `EMAIL_DEVICE_HOURLY_MAX`        | `10`                                | Code emails per recognized device per hour.                                                                                               |
| `EMAIL_IP_HOURLY_MAX`            | `5`                                 | Code emails per IP per hour, for requests without a recognized device (stricter than the device's).                                      |

Like every variable here, a value the schema refuses stops the process from starting, so a typo in a
console edit takes the API down until it is corrected. Startup refuses shares that add up to 100 or more, and a cap so low that the reset or the security
share rounds down to zero. To raise the caps when the app grows, raise SES's own quota first, then
these two (T-224 writes the table of values per spending step).

## MongoDB

| Variable    | Description                                       |
| ----------- | ------------------------------------------------- |
| `MONGO_URI` | Full connection URI, including the database name. |

Money is stored as integer cents and balance adjustments run inside MongoDB
transactions, so the URI **must** point at a replica set:

- **Local:** `mongodb://localhost:27017/lag_money?replicaSet=rs0&directConnection=true` —
  the `docker-compose.yml` here runs a single-node replica set, and
  `directConnection=true` is required to talk to it.
- **Production:** MongoDB Atlas is already a replica set. Its URI has its own
  rules — the database name before the `?`, no `directConnection`, an encoded
  password — all covered in
  [Deployment › The production MONGO_URI](./deployment.md#the-production-mongo-uri).

**Always include the database name** (`/lag_money`) before the query string. A
URI without one connects to a database called `test`, with no warning.

`npm run db:backup` and `npm run db:restore` are the exception: they read
`MONGO_URI` from the environment and **never** from `.env`, because they can
copy or overwrite a production database and must not guess which one — see
[Backup and Restore](./backup-restore.md).

### Indexes

Outside production the application creates the declared indexes right after
connecting, so a brand-new database needs no extra step — start the server and
they are there. Run `npm run db:sync-indexes` by hand only when you have
**removed** an index from a schema: the startup path only creates missing ones,
while the script also drops those no longer declared.

With `NODE_ENV=production` the application never touches indexes. They are
created by the deploy, which requires `MONGO_URI` and aborts if the sync fails —
see [Deployment › Index creation](./deployment.md#index-creation).

## Example `.env` for local development

```env
NODE_ENV=development

# Required
JWT_SECRET=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6
CORS_ORIGIN=http://localhost:3001
MONGO_URI=mongodb://localhost:27017/lag_money?replicaSet=rs0&directConnection=true

# Everything else has a sane default (PORT=3000, JWT_EXPIRATION=15m,
# REFRESH_TOKEN_EXPIRATION=30d, BCRYPT_SALT_ROUNDS=12, LOG_LEVEL=info,
# RATE_LIMIT_MAX=1000, AUTH_RATE_LIMIT_MAX=10, AUTH_EMAIL_RATE_LIMIT_MAX=50, AUTH_IP_RATE_LIMIT_MAX=60,
# REFRESH_RATE_LIMIT_MAX=60, and no email provider: nothing is sent).

# Emails go to the local Mailpit (docker compose up -d mailpit, http://localhost:8025)
EMAIL_PROVIDERS=mailpit
APP_URL=http://localhost:3001

# Do NOT set API_SECRET locally: with it, every request needs the
# x-api-secret header or gets 403.
```
