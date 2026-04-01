# Production Deployment Guide

## Prerequisites

- Node.js 20+ runtime
- MySQL 8+ or MongoDB 7+ (depending on `DB_TYPE`)
- A reverse proxy (nginx, Caddy, AWS ALB, etc.) for TLS termination
- Environment variables configured (see `docs/guides/environment-vars.md`)

## Building for Production

```bash
# Install dependencies (production only)
npm ci --omit=dev

# Compile TypeScript
npm run build

# Output: dist/ directory
```

The compiled application entry point is `dist/server.js`.

## Running the Application

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

### Sequelize (MySQL)

Configure pool settings via environment variables:

| Variable           | Default | Production Recommendation                             |
| ------------------ | ------- | ----------------------------------------------------- |
| `SEQ_POOL_MAX`     | `20`    | Match expected concurrent request volume              |
| `SEQ_POOL_MIN`     | `5`     | Keep at 2–5 to maintain warm connections              |
| `SEQ_POOL_ACQUIRE` | `30000` | 30s is usually sufficient; increase for slow networks |
| `SEQ_POOL_IDLE`    | `10000` | Lower to 5000 if connections are scarce               |

### Mongoose (MongoDB)

Connection pooling is handled by the MongoDB driver. The default pool size (usually 5–10) is sufficient for most single-instance deployments. For higher throughput, pass pool options in the `MONGO_URI`:

```
mongodb://user:pass@host:27017/db?maxPoolSize=20&minPoolSize=5
```

## Graceful Shutdown

The application handles `SIGTERM` and `SIGINT` signals for graceful shutdown (implemented in `src/server.ts`):

1. Receives the signal
2. Stops accepting new HTTP connections (`server.close()`)
3. Closes the database connection (Mongoose `disconnect()` or Sequelize `close()`)
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

The `GET /` endpoint returns `200 { "hello": "world!" }` and can be used as a liveness probe.

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

The application applies rate limiting on the `/auth` routes:

- **Window:** 15 minutes
- **Max requests:** 100 per window per IP
- **Headers:** Standard rate limit headers (`RateLimit-*`)

In production behind a reverse proxy, ensure `trust proxy` is set correctly so rate limiting applies to the real client IP, not the proxy IP.

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
- [ ] `CORS_ORIGIN` — your frontend domain(s), not `*`
- [ ] `DB_TYPE` — `SEQ` or `MONGO`
- [ ] Database credentials (`SEQ_*` or `MONGO_URI`)
- [ ] `LOG_LEVEL` — appropriate for production (`info` or `warn`)
- [ ] `BCRYPT_SALT_ROUNDS` — 12+ for production

See `docs/guides/environment-vars.md` for the complete list.
