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

Create a `.env` file at the project root:

```bash
cp .env.example .env  # if .env.example exists, otherwise create manually
```

Required variables (see `docs/guides/environment-vars.md` for full reference):

```env
# Application
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:3000

# Authentication
JWT_SECRET=your-secure-random-secret-at-least-32-chars
JWT_EXPIRATION=24h
BCRYPT_SALT_ROUNDS=12

# Database type: "SEQ" for MySQL/Sequelize or "MONGO" for MongoDB/Mongoose
DB_TYPE=SEQ

# MySQL (required when DB_TYPE=SEQ)
SEQ_HOST=localhost
SEQ_PORT=3306
SEQ_DATABASE=lag_money_manager
SEQ_USERNAME=lag_user
SEQ_PASSWORD=lag_password

# MySQL root password (for Docker)
MYSQL_ROOT_PASSWORD=root_password

# MongoDB (required when DB_TYPE=MONGO)
MONGO_URI=mongodb://lag_user:lag_password@localhost:27017/lag_money_manager?authSource=admin
MONGO_USERNAME=lag_user
MONGO_PASSWORD=lag_password
MONGO_DATABASE=lag_money_manager
```

## 4. Database Setup

### Start database containers

```bash
docker compose up -d
```

This starts:

- **MySQL** on port 3306
- **phpMyAdmin** on port 8080 (admin UI)
- **MongoDB** on port 27017
- **Mongoku** on port 3100 (admin UI)

### Run migrations (MySQL/Sequelize only)

```bash
npm run db:migrate
```

MongoDB does not require migrations — schemas are created automatically on first write.

### Verify database connections

- MySQL: open http://localhost:8080 (phpMyAdmin)
- MongoDB: open http://localhost:3100 (Mongoku)

## 5. Run the Project

### Development mode (with hot reload)

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
```

If using MongoDB (`DB_TYPE=MONGO`), you'll also see:

```
[INFO] Connected to MongoDB
```

## 6. Verify It Works

### Health check

```bash
curl http://localhost:3000/
```

Expected response:

```json
{ "hello": "world!" }
```

### Register a user

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Test User", "email": "test@example.com", "password": "password123"}'
```

Expected response (201):

```json
{
  "id": "019576a0-d7b6-7d6d-af6a-...",
  "name": "Test User",
  "email": "test@example.com",
  "createdAt": "2026-03-29T...",
  "updatedAt": "2026-03-29T..."
}
```

### Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "password123"}'
```

Expected response (200):

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "019576a0-...",
    "name": "Test User",
    "email": "test@example.com"
  }
}
```

### API documentation

Open http://localhost:3000/api-docs for the interactive Swagger UI.

## 7. Common Startup Errors

```
ERROR
Error: JWT_SECRET is required

CAUSE
The JWT_SECRET environment variable is missing or empty in your .env file.

FIX
Add a JWT_SECRET value to your .env file:
JWT_SECRET=your-secure-random-secret-at-least-32-chars
```

---

```
ERROR
SequelizeConnectionRefusedError: connect ECONNREFUSED 127.0.0.1:3306

CAUSE
MySQL is not running or not reachable on the configured host/port.

FIX
1. Ensure Docker containers are running: docker compose up -d
2. Wait a few seconds for MySQL to initialize
3. Verify SEQ_HOST and SEQ_PORT in .env match your Docker setup
```

---

```
ERROR
MongoServerError: Authentication failed

CAUSE
MongoDB credentials in MONGO_URI don't match the Docker container configuration.

FIX
1. Verify MONGO_USERNAME and MONGO_PASSWORD in .env match docker-compose.yml
2. Ensure the URI includes ?authSource=admin
3. If you changed credentials, recreate the container: docker compose down -v && docker compose up -d
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
3. Or change PORT in .env to a different port
```

---

```
ERROR
Error: No database provider registered for DB_TYPE: XXX

CAUSE
The DB_TYPE environment variable has an invalid value. Must be "SEQ" or "MONGO".

FIX
Set DB_TYPE=SEQ or DB_TYPE=MONGO in your .env file.
```

---

```
ERROR
SequelizeDatabaseError: Table 'lag_money_manager.Users' doesn't exist

CAUSE
Database migrations have not been run.

FIX
Run migrations: npm run db:migrate
```

---

```
ERROR
Cannot find module 'xxx'

CAUSE
Node modules have not been installed after a recent change.

FIX
Run: npm install
```
