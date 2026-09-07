/**
 * Environment for the mongod-backed suite (`npm run test:mongo`), applied
 * before any module of the app is loaded.
 *
 * The app itself never reads `.env` (only `server.ts` and the scripts do), so
 * nothing here can inherit the owner's `MONGO_URI`, which points at the real
 * Atlas cluster. The guard below is the second lock: this suite drops its
 * database, so it refuses to run against anything but a local one.
 */
const DEFAULT_URI =
  "mongodb://localhost:27017/lag_money_ob6?replicaSet=rs0&directConnection=true";

const uri = process.env.MONGO_TEST_URI ?? DEFAULT_URI;
const host = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, "http://")).hostname;
if (host !== "localhost" && host !== "127.0.0.1") {
  throw new Error(
    `test:mongo drops its database and refuses to run against ${host}. Point MONGO_TEST_URI at a local mongod.`,
  );
}

process.env.MONGO_URI = uri;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET ??= "ob6-mongo-suite";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
// The suite fires bursts on purpose (ten concurrent writes, replayed batches);
// the limiter is not what is under test here.
process.env.RATE_LIMIT_MAX ??= "100000";
process.env.AUTH_RATE_LIMIT_MAX ??= "10000";
process.env.BCRYPT_SALT_ROUNDS ??= "4";
