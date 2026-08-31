# Environment Variables

All environment variables are validated at startup by the Zod schema in
`src/shared/constants.ts`. The application refuses to start if a required
variable is missing or invalid — the error names the offending variable.

Only the variables listed here are read. Anything else in your `.env` is
ignored (the SQL-era `SEQ_*`, `MYSQL_*`, `MONGO_USERNAME`, `MONGO_PASSWORD`
and `MONGO_DATABASE` variables no longer exist).

## Required

| Variable      | Description                                                                                      | How to obtain                        |
| ------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `JWT_SECRET`  | Secret for signing access tokens (and refresh tokens unless `REFRESH_SECRET` is set). 32+ chars in production. | `openssl rand -hex 32`               |
| `CORS_ORIGIN` | Comma-separated list of allowed CORS origins                                                     | Your frontend URL(s)                 |
| `MONGO_URI`   | MongoDB connection URI. Must point at a **replica set** — balance adjustments run inside multi-document transactions. | See [MongoDB](#mongodb) below        |

## Application

| Variable    | Default       | Description                                                        |
| ----------- | ------------- | ------------------------------------------------------------------ |
| `PORT`      | `3000`        | HTTP server port                                                   |
| `NODE_ENV`  | `development` | `development`, `production` or `test`                              |
| `LOG_LEVEL` | `info`        | Pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`      |
| `DB_TYPE`   | `MONGO`       | Database backend. Only `MONGO` is supported.                       |

`NODE_ENV=production` also turns on HTTPS redirection, stops serving Swagger at
`/api-docs`, disables `autoIndex` (indexes are created by the
`npm run db:sync-indexes` deploy step) and makes a missing `API_SECRET` a fatal
misconfiguration instead of a skipped check.

## Authentication

| Variable                   | Default | Description                                                                             |
| -------------------------- | ------- | --------------------------------------------------------------------------------------- |
| `JWT_EXPIRATION`           | `15m`   | Access token lifetime. Short by design; renew with `POST /auth/refresh`.                 |
| `REFRESH_TOKEN_EXPIRATION` | `30d`   | Refresh token lifetime, and the absolute cap of a rotation family (rotation never extends it). |
| `REFRESH_SECRET`           | —       | Optional separate secret for refresh tokens; falls back to `JWT_SECRET`. Lets you rotate the access secret without killing every session. |
| `BCRYPT_SALT_ROUNDS`       | `12`    | bcrypt cost (4–20). Higher = slower and more resistant to offline cracking.              |

## Security and rate limiting

| Variable                 | Default | Description                                                                              |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------- |
| `API_SECRET`             | —       | Shared secret expected in the `x-api-secret` header. **See the warning below.**            |
| `RATE_LIMIT_MAX`         | `200`   | Global limit per IP per 15-minute window (in-memory, per-instance under Lambda).           |
| `AUTH_RATE_LIMIT_MAX`    | `10`    | Limit for `/auth/login` and `/auth/register` per 15-minute window (MongoDB-backed, shared across instances). Applied per IP and, on login, per email — the per-email budget only burns on failed attempts. |
| `REFRESH_RATE_LIMIT_MAX` | `60`    | Separate, higher limit for `POST /auth/refresh` (a legitimate device refreshes every ~15 min). |

> **`API_SECRET` is all-or-nothing.** When it is set, **every** request must
> carry a matching `x-api-secret` header or it gets **403 Forbidden** —
> including `/`, `/health/db` and the whole `/auth` surface. Leave it unset in
> local development; set a strong value in production, where a gateway sits in
> front of the API. A stale `API_SECRET` in a local `.env` is the classic
> "the API doesn't respond and I can't see why" symptom — the request log now
> names the reason (`request rejected`, with status and message), so read the
> server output first.

## MongoDB

| Variable    | Description                                                                          |
| ----------- | ------------------------------------------------------------------------------------ |
| `MONGO_URI` | Full connection URI, including the database name.                                     |

Money is stored as integer cents and balance adjustments run inside MongoDB
transactions, so the URI **must** point at a replica set:

- **Local:** `mongodb://localhost:27017/lag_money?replicaSet=rs0&directConnection=true` —
  the `docker-compose.yml` here runs a single-node replica set, and
  `directConnection=true` is required to talk to it.
- **Production:** MongoDB Atlas (`mongodb+srv://…`) is already a replica set.

## Example `.env` for local development

```env
NODE_ENV=development

# Required
JWT_SECRET=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6
CORS_ORIGIN=http://localhost:3001
MONGO_URI=mongodb://localhost:27017/lag_money?replicaSet=rs0&directConnection=true

# Everything else has a sane default (PORT=3000, JWT_EXPIRATION=15m,
# REFRESH_TOKEN_EXPIRATION=30d, BCRYPT_SALT_ROUNDS=12, LOG_LEVEL=info,
# RATE_LIMIT_MAX=200, AUTH_RATE_LIMIT_MAX=10, REFRESH_RATE_LIMIT_MAX=60).

# Do NOT set API_SECRET locally: with it, every request needs the
# x-api-secret header or gets 403.
```
