# Environment Variables

All environment variables are validated at startup using Zod schemas in `src/shared/constants.ts`. The application will fail to start if required variables are missing or invalid.

## Application Configuration

| Variable      | Required | Default       | Description                                                        | How to obtain                   |
| ------------- | -------- | ------------- | ------------------------------------------------------------------ | ------------------------------- |
| `PORT`        | No       | `3000`        | HTTP server port                                                   | Choose any available port       |
| `NODE_ENV`    | No       | `development` | Runtime environment: `development`, `production`, or `test`        | Set based on deployment target  |
| `LOG_LEVEL`   | No       | `info`        | Pino log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` | Choose based on verbosity needs |
| `CORS_ORIGIN` | Yes      | —             | Comma-separated list of allowed CORS origins                       | Your frontend URL(s)            |
| `DB_TYPE`     | No       | `MONGO`       | Database backend. Only `MONGO` is supported.                       | Leave as default                |

## Authentication

| Variable             | Required | Default | Description                                                                                   | How to obtain                              |
| -------------------- | -------- | ------- | --------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `JWT_SECRET`         | Yes      | —       | Secret key for signing access & refresh tokens (use 32+ chars in production)                  | Generate with `openssl rand -hex 32`       |
| `JWT_EXPIRATION`     | No       | `15m`   | Access token lifetime (short; renewed via POST /auth/refresh)                                 | e.g. `15m`, `1h`                           |
| `REFRESH_TOKEN_EXPIRATION` | No | `30d`  | Refresh token lifetime. Revoked early when a user changes their password (tokenVersion bump)  | e.g. `7d`, `30d`                           |
| `BCRYPT_SALT_ROUNDS` | No       | `12`    | bcrypt hashing rounds (4-20). Higher = slower + more secure                                   | 10-12 for most apps, 14+ for high security |

## Security / Rate Limiting

| Variable              | Required | Default | Description                                                                                     | How to obtain                       |
| --------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------- | ----------------------------------- |
| `API_SECRET`          | No\*     | —       | Shared secret expected in the `x-api-secret` header (`gatewaySecretMiddleware`). If unset, the gateway check is skipped. **Set a strong value in production.** | Generate with `openssl rand -hex 32` |
| `RATE_LIMIT_MAX`      | No       | `200`   | Global request limit per IP per 15-minute window (in-memory; per-instance under Lambda)         | Tune to expected traffic            |
| `AUTH_RATE_LIMIT_MAX` | No       | `10`    | Strict limit for `/auth/login` and `/auth/register` per IP per 15-min window (MongoDB-backed, shared across instances) | Keep low (5–10) to resist brute force |

\* Not required by the schema, but strongly recommended in production — without it the front-door check is disabled.

## MongoDB / Mongoose

| Variable    | Required | Default | Description                 | How to obtain                                               |
| ----------- | -------- | ------- | --------------------------- | ----------------------------------------------------------- |
| `MONGO_URI` | Yes      | —       | Full MongoDB connection URI. Must point at a **replica set** (required for transactions). | Local: `mongodb://localhost:27017/lag?replicaSet=rs0&directConnection=true`. Prod: MongoDB Atlas `mongodb+srv://…` |

## Example `.env` File

```env
# Application
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:5173
DB_TYPE=MONGO

# Authentication
JWT_SECRET=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
JWT_EXPIRATION=24h
BCRYPT_SALT_ROUNDS=12

# Security / rate limiting
API_SECRET=change-me-in-production
RATE_LIMIT_MAX=200
AUTH_RATE_LIMIT_MAX=10

# MongoDB (single-node replica set from docker-compose in dev)
MONGO_URI=mongodb://localhost:27017/lag?replicaSet=rs0&directConnection=true
```

> **Note:** Money is stored as integer cents, and balance adjustments run inside
> MongoDB transactions, so `MONGO_URI` must point at a replica set. The provided
> `docker-compose.yml` configures a single-node replica set for local development;
> MongoDB Atlas is a replica set by default.
