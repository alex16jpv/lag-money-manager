# Environment Variables

All environment variables are validated at startup using Zod schemas in `src/shared/constants.ts`. The application will fail to start if required variables are missing or invalid.

## Application Configuration

| Variable      | Required | Default       | Description                                                        | How to obtain                   |
| ------------- | -------- | ------------- | ------------------------------------------------------------------ | ------------------------------- |
| `PORT`        | No       | `3000`        | HTTP server port                                                   | Choose any available port       |
| `NODE_ENV`    | No       | `development` | Runtime environment: `development`, `production`, or `test`        | Set based on deployment target  |
| `LOG_LEVEL`   | No       | `info`        | Pino log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` | Choose based on verbosity needs |
| `CORS_ORIGIN` | Yes      | —             | Comma-separated list of allowed CORS origins                       | Your frontend URL(s)            |

## Authentication

| Variable             | Required | Default | Description                                                                                   | How to obtain                              |
| -------------------- | -------- | ------- | --------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `JWT_SECRET`         | Yes      | —       | Secret key for signing JWT tokens. Must be at least 1 character (use 32+ chars in production) | Generate with `openssl rand -hex 32`       |
| `JWT_EXPIRATION`     | No       | `24h`   | JWT token lifetime (e.g., `1h`, `7d`, `24h`)                                                  | Choose based on security requirements      |
| `BCRYPT_SALT_ROUNDS` | No       | `12`    | bcrypt hashing rounds (4-20). Higher = slower + more secure                                   | 10-12 for most apps, 14+ for high security |

## Database Selection

| Variable  | Required | Default | Description                                                                    | How to obtain                 |
| --------- | -------- | ------- | ------------------------------------------------------------------------------ | ----------------------------- |
| `DB_TYPE` | No       | `SEQ`   | Database backend to use: `SEQ` (MySQL/Sequelize) or `MONGO` (MongoDB/Mongoose) | Choose based on your database |

## MySQL / Sequelize (required when `DB_TYPE=SEQ`)

| Variable       | Required | Default | Description           | How to obtain                                |
| -------------- | -------- | ------- | --------------------- | -------------------------------------------- |
| `SEQ_HOST`     | Yes      | —       | MySQL server hostname | `localhost` for Docker, or your DB host      |
| `SEQ_PORT`     | No       | `3306`  | MySQL server port     | Default MySQL port is 3306                   |
| `SEQ_DATABASE` | Yes      | —       | MySQL database name   | Create with phpMyAdmin or MySQL CLI          |
| `SEQ_USERNAME` | Yes      | —       | MySQL username        | Set in `docker-compose.yml` or your DB admin |
| `SEQ_PASSWORD` | Yes      | —       | MySQL password        | Set in `docker-compose.yml` or your DB admin |

## MongoDB / Mongoose (required when `DB_TYPE=MONGO`)

| Variable    | Required | Default | Description                 | How to obtain                                               |
| ----------- | -------- | ------- | --------------------------- | ----------------------------------------------------------- |
| `MONGO_URI` | Yes      | —       | Full MongoDB connection URI | Format: `mongodb://user:pass@host:port/db?authSource=admin` |

## Docker Compose Only

These variables are used by `docker-compose.yml` and are not read by the application directly:

| Variable              | Required | Default | Description                                 | How to obtain                  |
| --------------------- | -------- | ------- | ------------------------------------------- | ------------------------------ |
| `MYSQL_ROOT_PASSWORD` | Yes      | —       | MySQL root password for Docker container    | Choose a secure password       |
| `MONGO_USERNAME`      | Yes      | —       | MongoDB admin username for Docker container | Choose a username              |
| `MONGO_PASSWORD`      | Yes      | —       | MongoDB admin password for Docker container | Choose a secure password       |
| `MONGO_DATABASE`      | Yes      | —       | MongoDB initial database name               | Use same value as in MONGO_URI |

## Example `.env` File

```env
# Application
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:3000

# Authentication
JWT_SECRET=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
JWT_EXPIRATION=24h
BCRYPT_SALT_ROUNDS=12

# Database type
DB_TYPE=SEQ

# MySQL (for DB_TYPE=SEQ)
SEQ_HOST=localhost
SEQ_PORT=3306
SEQ_DATABASE=lag_money_manager
SEQ_USERNAME=lag_user
SEQ_PASSWORD=lag_password
MYSQL_ROOT_PASSWORD=root_password

# MongoDB (for DB_TYPE=MONGO)
MONGO_URI=mongodb://lag_user:lag_password@localhost:27017/lag_money_manager?authSource=admin
MONGO_USERNAME=lag_user
MONGO_PASSWORD=lag_password
MONGO_DATABASE=lag_money_manager
```
