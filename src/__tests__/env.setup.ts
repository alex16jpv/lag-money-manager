/**
 * The minimum environment `shared/constants` validates at import, so a unit
 * test can import the real enums instead of hand-copying them into a mock.
 *
 * Nothing here connects: the URI is a placeholder that only satisfies the
 * schema, and the suite that does talk to a database has its own setup
 * (`src/__tests__/mongo/env.setup.ts`).
 */
process.env.NODE_ENV = "test";
process.env.JWT_SECRET ??= "unit-suite";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
// Set, not defaulted: a MONGO_URI exported in the shell has no business reaching the unit suite.
process.env.MONGO_URI = "mongodb://localhost:27017/lag_money_unit_unused";
