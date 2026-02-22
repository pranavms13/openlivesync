import { describe, it, expect, vi } from "vitest";
import { SignJWT } from "jose";
import { createTokenAuth } from "./token-auth.js";
import type { IncomingMessage } from "node:http";

const TEST_SECRET = new TextEncoder().encode("test-secret");

function mockRequest(overrides: { url?: string; headers?: Record<string, string | string[] | undefined> } = {}): IncomingMessage {
  return {
    url: overrides.url ?? "/",
    headers: overrides.headers ?? {},
  } as IncomingMessage;
}

describe("createTokenAuth", () => {
  it("returns UserInfo when token is in query access_token", async () => {
    const token = await new SignJWT({
      sub: "user-q",
      email: "q@example.com",
      name: "Query User",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(TEST_SECRET);

    const onAuth = createTokenAuth({});
    const req = mockRequest({ url: `http://localhost/live?access_token=${token}` });
    const result = await onAuth(req);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("user-q");
    expect(result!.email).toBe("q@example.com");
    expect(result!.name).toBe("Query User");
  });

  it("returns UserInfo when token is in Authorization Bearer header", async () => {
    const token = await new SignJWT({
      sub: "user-h",
      email: "h@example.com",
      name: "Header User",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(TEST_SECRET);

    const onAuth = createTokenAuth({});
    const req = mockRequest({ headers: { authorization: `Bearer ${token}` } });
    const result = await onAuth(req);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("user-h");
    expect(result!.email).toBe("h@example.com");
  });

  it("returns null when no token in request", async () => {
    const onAuth = createTokenAuth({});
    const req = mockRequest({ url: "/live" });
    const result = await onAuth(req);
    expect(result).toBeNull();
  });

  it("returns null when token is invalid", async () => {
    const onAuth = createTokenAuth({});
    const req = mockRequest({ url: "http://localhost/?access_token=not-a-jwt" });
    const result = await onAuth(req);
    expect(result).toBeNull();
  });

  it("uses custom tokenFromRequest when provided", async () => {
    const token = await new SignJWT({ sub: "custom", email: "c@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(TEST_SECRET);

    const tokenFromRequest = vi.fn((req: IncomingMessage) => {
      return (req as { _token?: string })._token ?? null;
    });
    const req = mockRequest() as IncomingMessage & { _token?: string };
    req._token = token;

    const onAuth = createTokenAuth({}, { tokenFromRequest });
    const result = await onAuth(req);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("custom");
    expect(tokenFromRequest).toHaveBeenCalledWith(req);
  });

  it("returns null when tokenFromRequest returns null", async () => {
    const tokenFromRequest = vi.fn(() => null);
    const onAuth = createTokenAuth({}, { tokenFromRequest });
    const result = await onAuth(mockRequest());
    expect(result).toBeNull();
  });
});
