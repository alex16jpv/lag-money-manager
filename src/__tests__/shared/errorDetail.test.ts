import { describeError, neverLeft } from "../../shared/errorDetail";

const systemError = (code: string, syscall: string, message: string): Error =>
  Object.assign(new Error(message), { code, syscall });

const dnsError = (code: string): Error =>
  systemError(
    code,
    "getaddrinfo",
    `getaddrinfo ${code} email.us-east-1.amazonaws.com`,
  );

const fetchFailed = (cause: Error): Error =>
  Object.assign(new TypeError("fetch failed"), { cause });

describe("describeError", () => {
  it("names the system code of a network error, which its name alone does not", () => {
    expect(describeError(dnsError("EAI_AGAIN"))).toBe(
      "EAI_AGAIN · getaddrinfo EAI_AGAIN email.us-east-1.amazonaws.com",
    );
  });

  it("reads the code and the message of a wrapped cause, as fetch reports it", () => {
    const failed = fetchFailed(
      systemError(
        "ECONNREFUSED",
        "connect",
        "connect ECONNREFUSED 127.0.0.1:8025",
      ),
    );
    expect(describeError(failed)).toBe(
      "ECONNREFUSED · fetch failed · connect ECONNREFUSED 127.0.0.1:8025",
    );
  });

  it("gives the HTTP status the provider answered with", () => {
    expect(describeError(new Error("Not authorized"), 403)).toBe(
      "HTTP 403 · Not authorized",
    );
  });

  it("never carries an email address or an access key id", () => {
    const detail = describeError(
      new Error(
        "Email address is not verified. The following identities failed the check in region US-EAST-1: Ana.Ruiz+x@Example.com, no-reply@ledgerflow.alexpiral.com (Credential=AKIAABCDEFGHIJKLMNOP)",
      ),
      400,
    );
    expect(detail).toBe(
      "HTTP 400 · Email address is not verified. The following identities failed the check in region US-EAST-1: [address], [address] (Credential=[key])",
    );
  });

  it("keeps only the first line of a signature error, where the session token never is", () => {
    const token =
      "IQoJb3JpZ2luX2VjEJr//////////wEaCXVzLWVhc3QtMSJHMEUCIQD".repeat(4);
    const detail = describeError(
      new Error(
        [
          "The request signature we calculated does not match the signature you provided.",
          "The Canonical String for this request should have been",
          "'POST",
          "/v2/email/outbound-emails",
          `x-amz-security-token:${token}'`,
        ].join("\n"),
      ),
      403,
    );
    expect(detail).toBe(
      "HTTP 403 · The request signature we calculated does not match the signature you provided.",
    );
  });

  it("hides a long token even on the first line", () => {
    expect(
      describeError(
        new Error(`token rejected: ${"a1B2".repeat(12)} (expired)`),
      ),
    ).toBe("token rejected: [token] (expired)");
  });

  it("keeps a long message short, and fast", () => {
    const started = Date.now();
    const detail = describeError(new Error("x ".repeat(100_000)));
    expect(detail?.length).toBe(300);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("says nothing it does not know", () => {
    expect(describeError(undefined)).toBeUndefined();
    expect(describeError(new Error(""))).toBeUndefined();
    expect(describeError("plain words, a@b.co")).toBe("plain words, [address]");
  });
});

describe("neverLeft", () => {
  it.each(["ENOTFOUND", "EAI_AGAIN"])(
    "knows a failed lookup (%s) stopped the request before it reached anyone",
    (code) => {
      expect(neverLeft(dnsError(code))).toBe(true);
      expect(neverLeft(fetchFailed(dnsError(code)))).toBe(true);
    },
  );

  it.each(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"])(
    "knows a connection that did not open (%s) sent nothing",
    (code) => {
      expect(neverLeft(systemError(code, "connect", code))).toBe(true);
    },
  );

  it("reads every address a connection tried, as Node reports several at once", () => {
    const tried = (codes: string[]): Error =>
      Object.assign(new Error(""), {
        code: codes[0],
        errors: codes.map((code) => systemError(code, "connect", code)),
      });
    expect(neverLeft(tried(["ECONNREFUSED", "ENETUNREACH"]))).toBe(true);
    expect(neverLeft(tried(["ECONNREFUSED", "ECONNRESET"]))).toBe(false);
  });

  it("does not trust the code alone: an open socket can report it after writing", () => {
    expect(
      neverLeft(systemError("EHOSTUNREACH", "read", "read EHOSTUNREACH")),
    ).toBe(false);
    expect(
      neverLeft(Object.assign(new Error("x"), { code: "ENOTFOUND" })),
    ).toBe(false);
  });

  it.each(["ECONNRESET", "ETIMEDOUT", "EPIPE"])(
    "cannot say %s did not send it: the request may have been written",
    (code) => {
      expect(neverLeft(systemError(code, "connect", code))).toBe(false);
    },
  );

  it("is false for an answer, and for nothing", () => {
    expect(neverLeft(new Error("slow down"))).toBe(false);
    expect(neverLeft(undefined)).toBe(false);
  });
});
