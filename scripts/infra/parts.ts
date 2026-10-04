export const PARTS = {
  api: { stack: "ledger-flow-api", template: "infra/api.yaml", adopt: true },
  access: {
    stack: "ledger-flow-access",
    template: "infra/access.yaml",
    adopt: true,
  },
  email: { stack: "ledger-flow-email", template: "infra/email.yaml" },
} as const;

export type Part = keyof typeof PARTS;

export const API_SECRETS = [
  { variable: "MONGO_URI", parameter: "MongoUri" },
  { variable: "JWT_SECRET", parameter: "JwtSecret" },
  { variable: "REFRESH_SECRET", parameter: "RefreshSecret" },
  { variable: "API_SECRET", parameter: "ApiSecret" },
  { variable: "TURNSTILE_SECRET", parameter: "TurnstileSecret" },
] as const;

export const secretParameterName = (variable: string): string =>
  `/ledger-flow/api/${variable}`;
