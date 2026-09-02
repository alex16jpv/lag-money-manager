import { DomainValidationError } from "../../domain/errors";
import { currencyDecimals } from "../../shared/currency";
import {
  assertAmountPrecision,
  hasValidPrecision,
  MAX_AMOUNT,
} from "../../shared/money";

describe("currencyDecimals", () => {
  it.each(["JPY", "CLP", "KRW", "VND", "ISK"])("%s has no minor unit", (c) => {
    expect(currencyDecimals(c)).toBe(0);
  });

  it.each(["COP", "USD", "EUR", "MXN", "ARS"])("%s has two", (c) => {
    expect(currencyDecimals(c)).toBe(2);
  });

  // Storage is integer cents, so a third decimal could only be kept by
  // rounding it away. Capped at two until the storage exponent exists.
  it.each(["KWD", "BHD", "JOD"])("%s is capped at two, not three", (c) => {
    expect(currencyDecimals(c)).toBe(2);
  });

  it("falls back to two for an unknown code", () => {
    expect(currencyDecimals("ZZZ")).toBe(2);
    expect(currencyDecimals(undefined)).toBe(2);
  });
});

describe("hasValidPrecision", () => {
  it("accepts amounts that fit the minor unit", () => {
    expect(hasValidPrecision(1000, 0)).toBe(true);
    expect(hasValidPrecision(42.5, 2)).toBe(true);
    expect(hasValidPrecision(0.01, 2)).toBe(true);
  });

  it("rejects amounts with too many decimals", () => {
    expect(hasValidPrecision(1000.5, 0)).toBe(false);
    expect(hasValidPrecision(10.555, 2)).toBe(false);
  });

  // 0.07 * 100 is 7.000000000000001 in binary floating point; an exact
  // comparison would reject a perfectly valid amount.
  it("is not fooled by float representation", () => {
    expect(hasValidPrecision(0.07, 2)).toBe(true);
    expect(hasValidPrecision(1.005, 2)).toBe(false);
    expect(hasValidPrecision(8.29, 2)).toBe(true);
  });
});

describe("assertAmountPrecision", () => {
  it("rejects decimals in a zero-decimal currency", () => {
    expect(() => assertAmountPrecision(1000.5, "JPY", "amount")).toThrow(
      DomainValidationError,
    );
    expect(() => assertAmountPrecision(1000.5, "JPY", "amount")).toThrow(
      "JPY amounts cannot have decimals",
    );
  });

  it("accepts whole amounts in a zero-decimal currency", () => {
    expect(() => assertAmountPrecision(1000, "JPY", "amount")).not.toThrow();
  });

  it("accepts two decimals in a normal currency", () => {
    expect(() => assertAmountPrecision(42.5, "COP", "amount")).not.toThrow();
  });

  it("carries the field and a stable code", () => {
    try {
      assertAmountPrecision(10.5, "JPY", "balance");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainValidationError);
      expect((err as DomainValidationError).field).toBe("balance");
      expect((err as DomainValidationError).code).toBe("AMOUNT_PRECISION");
    }
  });
});

describe("MAX_AMOUNT", () => {
  // The ceiling exists because cents must stay exactly representable; a value
  // above this silently loses precision instead of erroring.
  it("keeps its cents inside the safe integer range", () => {
    expect(MAX_AMOUNT * 100).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(MAX_AMOUNT * 100)).toBe(true);
  });

  it("leaves room for a balance to accumulate several maximum amounts", () => {
    expect(MAX_AMOUNT * 100 * 9).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  // COP, IRR, VND and IDR reach these numbers in ordinary use.
  it("admits an amount a house costs in a low-unit currency", () => {
    expect(MAX_AMOUNT).toBeGreaterThan(1_000_000_000);
  });
});
