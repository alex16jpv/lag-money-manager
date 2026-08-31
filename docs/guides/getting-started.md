# Getting Started

## 1. Prerequisites

| Tool                    | Version            | Verify Command                               |
| ----------------------- | ------------------ | -------------------------------------------- |
| Node.js                 | 20.x or later      | `node --version`                             |
| npm                     | 10.x or later      | `npm --version`                              |
| Docker & Docker Compose | Latest stable      | `docker --version && docker compose version` |
| Git                     | Any recent version | `git --version`                              |

## 2. Clone & Install

```bash
git clone <repository-url> lag-money-manager
cd lag-money-manager
npm install
```

## 3. Environment Setup

```bash
cp .env.example .env
```

Then set a real `JWT_SECRET` (`openssl rand -hex 32`). Only three variables are
required — everything else has a working default:

```env
NODE_ENV=development

JWT_SECRET=<openssl rand -hex 32>
CORS_ORIGIN=http://localhost:3001
MONGO_URI=mongodb://localhost:27017/lag_money?replicaSet=rs0&directConnection=true
```

See [Environment Variables](./environment-vars.md) for the full reference.

> **Do not set `API_SECRET` locally.** Once it has a value, every request must
> send a matching `x-api-secret` header or gets 403 — including `/`,
> `/health/db` and `/auth`.

## 4. Database Setup

```bash
docker compose up -d mongo
```

This starts **MongoDB on port 27017** as a **single-node replica set**. The
replica set is not optional: balance adjustments run inside multi-document
transactions, which a standalone `mongod` rejects. The container healthcheck
runs `rs.initiate()` on first boot, so there is nothing to configure by hand —
give it a few seconds and check it reached `PRIMARY`:

```bash
docker exec lag-money-manager-mongo-1 mongosh --quiet --eval "rs.status().members[0].stateStr"
```

There are no migrations. Collections and indexes are created automatically on
first write (`autoIndex` is on outside production), and the first registered
user gets the default categories seeded.

Optionally, `docker compose up -d` also starts **Mongoku**, a lightweight
MongoDB web UI, on http://localhost:3100.

## 5. Run the Project

### Development mode (hot reload)

```bash
npm run start:dev
```

### Production build

```bash
npm run build
npm start
```

### Healthy startup output

```
[INFO] App listening on port 3000
[INFO] Connected to MongoDB
```

The MongoDB line appears on the first request that touches the database (the
connection is established lazily), or at startup if something probes it early.

## 6. Verify It Works

### Health checks

```bash
curl http://localhost:3000/           # {"hello":"world!"}
curl http://localhost:3000/health/db  # {"database":"ok"}
```

### Register a user

Registration is also a login: it returns a token pair, so there is no second
round-trip.

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"password123","timezone":"America/Bogota","currency":"COP"}'
```

Expected response (201):

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "019576a0-d7b6-7d6d-af6a-...",
    "name": "Test User",
    "email": "test@example.com",
    "timezone": "America/Bogota",
    "currency": "COP",
    "lastLoginAt": "2026-08-31T...",
    "createdAt": "2026-08-31T...",
    "updatedAt": "2026-08-31T..."
  }
}
```

`timezone` and `currency` are optional (they default to `America/Bogota` and
`COP`). The currency is stamped on every account, transaction and budget, and
locks once the user has accounts.

### Use the access token

```bash
TOKEN="<accessToken from the response>"

# The 10 default categories seeded at registration
curl http://localhost:3000/categories -H "Authorization: Bearer $TOKEN"

# First account becomes the default one automatically
curl -X POST http://localhost:3000/accounts -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Cash","type":"CASH","balance":50000}'

# Low-friction capture: amount only, everything else inferred
curl -X POST http://localhost:3000/transactions/quick -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount":12500,"description":"Coffee"}'
```

Access tokens last 15 minutes; renew them with `POST /auth/refresh` using the
refresh token.

### API documentation

Open http://localhost:3000/api-docs for the interactive Swagger UI (not served
when `NODE_ENV=production`).

### Ready-made requests

`requests/*.http` covers every endpoint and runs from VS Code with the REST
Client extension — usually faster than curl.

## 7. Run the Tests

```bash
npm test        # the full suite
npm run ci      # what CI runs: typecheck + typecheck:tests + lint + test
```

## 8. Common Startup Errors

```
ERROR
ZodError: JWT_SECRET: Invalid input: expected string, received undefined

CAUSE
A required environment variable is missing. The schema in
src/shared/constants.ts validates the environment at startup and names the
offending variable (JWT_SECRET, CORS_ORIGIN or MONGO_URI).

FIX
Add the variable to your .env file.
```

---

```
ERROR
MongooseServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017

CAUSE
MongoDB is not running, or MONGO_URI points somewhere else.

FIX
1. Start it: docker compose up -d mongo
2. Give the healthcheck a few seconds to initiate the replica set
3. Check the state: docker exec lag-money-manager-mongo-1 mongosh --quiet --eval "rs.status().ok"
```

---

```
ERROR
MongoServerError: Transaction numbers are only allowed on a replica set member or mongos

CAUSE
MONGO_URI points at a standalone mongod. Balance adjustments need
multi-document transactions, which require a replica set.

FIX
Use the compose service and keep the replica-set parameters in the URI:
MONGO_URI=mongodb://localhost:27017/lag_money?replicaSet=rs0&directConnection=true
(directConnection=true is required for a single-node replica set.)
```

---

```
SYMPTOM
Every request answers 403 Forbidden ("Access denied") and nothing seems wrong.

CAUSE
API_SECRET is set in your .env, so the gateway middleware demands a matching
x-api-secret header on every route.

FIX
Comment API_SECRET out for local development, or send the header.
The server log shows "request rejected" with the status for each blocked call.
```

---

```
ERROR
Error: listen EADDRINUSE: address already in use :::3000

CAUSE
Another process is already using port 3000.

FIX
1. Find the process: lsof -ti:3000
2. Kill it: kill -9 $(lsof -ti:3000)
3. Or change PORT in .env
```

---

```
ERROR
Cannot find module 'xxx'

CAUSE
Dependencies are out of date after a pull.

FIX
Run: npm install
```
