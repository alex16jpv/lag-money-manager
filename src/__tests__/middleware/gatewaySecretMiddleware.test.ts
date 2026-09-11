import { NextFunction, Request, Response } from "express";

import { gatewaySecretMiddleware } from "../../app/middlewares/gatewaySecretMiddleware";
import { ENVIRONMENT } from "../../shared/constants";
import { ApiError } from "../../shared/errors";

jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: { API_SECRET: "s3cret", NODE_ENV: "production" },
}));

const environment = ENVIRONMENT as unknown as {
  API_SECRET?: string;
  NODE_ENV: string;
};

const req = (headers: Record<string, string> = {}): Request =>
  ({ headers }) as unknown as Request;

const run = (request: Request): NextFunction => {
  const next: NextFunction = jest.fn();
  gatewaySecretMiddleware(request, {} as Response, next);
  return next;
};

describe("gatewaySecretMiddleware", () => {
  beforeEach(() => {
    environment.API_SECRET = "s3cret";
    environment.NODE_ENV = "production";
  });

  it("marks a request that carries the secret as coming from the gateway", () => {
    const request = req({ "x-api-secret": "s3cret" });
    expect(run(request)).toHaveBeenCalled();
    expect(request.gatewayTrusted).toBe(true);
  });

  it("rejects a request with the wrong secret", () => {
    const request = req({ "x-api-secret": "wrong!" });
    expect(() => run(request)).toThrow(ApiError);
    expect(request.gatewayTrusted).toBeUndefined();
  });

  it("rejects a request with no secret at all", () => {
    const request = req();
    expect(() => run(request)).toThrow(ApiError);
    expect(request.gatewayTrusted).toBeUndefined();
  });

  it("does not mark the request as trusted where no secret is configured", () => {
    environment.API_SECRET = undefined;
    environment.NODE_ENV = "development";
    const request = req({ "x-api-secret": "anything" });
    expect(run(request)).toHaveBeenCalled();
    expect(request.gatewayTrusted).toBeUndefined();
  });

  it("fails closed in production when the secret is missing", () => {
    environment.API_SECRET = undefined;
    expect(() => run(req())).toThrow(ApiError);
  });
});
