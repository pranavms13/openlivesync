import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { decodeAccessToken } from "./decode-token.js";

const TEST_SECRET = new TextEncoder().encode("test-secret");

describe("decodeAccessToken", () => {
  it("returns null for empty or invalid token", async () => {
    expect(await decodeAccessToken("")).toBeNull();
    expect(await decodeAccessToken("not-a-jwt")).toBeNull();
  });

  it("decodes JWT payload (decode-only) and normalizes sub, email, name, provider", async () => {
    const token = await new SignJWT({
      sub: "user-123",
      email: "alice@example.com",
      name: "Alice",
      iss: "https://accounts.google.com",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(TEST_SECRET);

    const decoded = await decodeAccessToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.sub).toBe("user-123");
    expect(decoded!.email).toBe("alice@example.com");
    expect(decoded!.name).toBe("Alice");
    expect(decoded!.provider).toBe("google");
  });

  it("uses preferred_username for email when email claim missing (Microsoft-style)", async () => {
    const token = await new SignJWT({
      sub: "oid-456",
      preferred_username: "bob@tenant.com",
      name: "Bob",
      iss: "https://login.microsoftonline.com/tenant-id/v2.0",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(TEST_SECRET);

    const decoded = await decodeAccessToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.email).toBe("bob@tenant.com");
    expect(decoded!.provider).toBe("microsoft");
  });

  it("treats unknown issuer as custom provider", async () => {
    const token = await new SignJWT({
      sub: "custom-user",
      email: "custom@example.com",
      iss: "https://my-auth.example.com",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(TEST_SECRET);

    const decoded = await decodeAccessToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.provider).toBe("custom");
  });
});
