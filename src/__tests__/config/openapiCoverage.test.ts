// Real modules, not mocks: this compares the routes Express mounts with the OpenAPI paths.
process.env.JWT_SECRET ??= "openapi-coverage-test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.MONGO_URI ??= "mongodb://localhost:27017/unused";

jest.mock("../../config/mongoConnection", () => ({
  connectMongo: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../shared/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

import { Router } from "express";

import accountRoutes from "../../app/routes/accountRoutes";
import authRoutes from "../../app/routes/authRoutes";
import budgetRoutes from "../../app/routes/budgetRoutes";
import categoryRoutes from "../../app/routes/categoryRoutes";
import statsRoutes from "../../app/routes/statsRoutes";
import syncRoutes from "../../app/routes/syncRoutes";
import transactionRoutes from "../../app/routes/transactionRoutes";
import userRoutes from "../../app/routes/userRoutes";
import { swaggerSpec } from "../../config/swagger";

// Mirrors app.ts: a router mounted there and not here is only caught if it adds paths.
const MOUNTS: Record<string, Router> = {
  "/auth": authRoutes,
  "/users": userRoutes,
  "/accounts": accountRoutes,
  "/categories": categoryRoutes,
  "/transactions": transactionRoutes,
  "/budgets": budgetRoutes,
  "/stats": statsRoutes,
  "/sync": syncRoutes,
};

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}
type Routed = Required<RouteLayer>;
const isRouted = (layer: RouteLayer): layer is Routed => !!layer.route;

const mounted = (): string[] =>
  Object.entries(MOUNTS).flatMap(([prefix, router]) =>
    (router.stack as RouteLayer[]).filter(isRouted).flatMap((layer) => {
      const path = (prefix + layer.route.path)
        .replace(/\/$/, "")
        .replace(/:(\w+)/g, "{$1}");
      return Object.keys(layer.route.methods).map(
        (method) => `${method} ${path}`,
      );
    }),
  );

const documented = (): string[] => {
  const paths = (swaggerSpec as { paths: Record<string, object> }).paths;
  return Object.entries(paths).flatMap(([path, ops]) =>
    Object.keys(ops).map((method) => `${method} ${path}`),
  );
};

// F-22: swagger-jsdoc drops a whole file when a YAML block fails to parse, and only warns on stdout.
describe("OpenAPI covers every mounted route", () => {
  it("documents each route the app mounts, with its method", () => {
    const missing = mounted().filter((r) => !documented().includes(r));
    expect(missing).toEqual([]);
  });

  it("documents nothing the app does not mount", () => {
    const stale = documented().filter((r) => !mounted().includes(r));
    expect(stale).toEqual([]);
  });
});
