/**
 * Decode and optionally verify OAuth/OpenID access tokens (JWT).
 * Supports Google, Microsoft, and custom providers (JWKS or decode-only).
 */

import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";

export interface DecodedToken {
  sub: string;
  email?: string;
  name?: string;
  iss?: string;
  provider?: string;
}

export interface AuthGoogleConfig {
  /** Optional: validate audience (client ID). */
  clientId?: string;
}

export interface AuthMicrosoftConfig {
  tenantId: string;
  /** Optional: validate audience (client ID). */
  clientId?: string;
}

export interface AuthCustomConfig {
  /** JWKS URL for signature verification. */
  jwksUrl?: string;
  /** Expected issuer (iss claim). */
  issuer?: string;
  /** If true, only decode payload (no verification). Use for dev or trusted tokens. */
  decodeOnly?: boolean;
}

export interface AuthOptions {
  google?: AuthGoogleConfig;
  microsoft?: AuthMicrosoftConfig;
  custom?: AuthCustomConfig;
}

const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

function normalizePayload(payload: Record<string, unknown>): DecodedToken {
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const email =
    typeof payload.email === "string"
      ? payload.email
      : typeof payload.preferred_username === "string"
        ? payload.preferred_username
        : undefined;
  const name =
    typeof payload.name === "string"
      ? payload.name
      : [payload.given_name, payload.family_name]
          .filter((x) => typeof x === "string")
          .join(" ")
          .trim() || undefined;
  const iss = typeof payload.iss === "string" ? payload.iss : undefined;
  let provider: string | undefined;
  if (iss) {
    if (iss.includes("accounts.google.com")) provider = "google";
    else if (iss.includes("login.microsoftonline.com")) provider = "microsoft";
    else provider = "custom";
  }
  return { sub, email, name, iss, provider };
}

function getGoogleJwksUrl(): URL {
  return new URL(GOOGLE_JWKS_URL);
}

function getMicrosoftJwksUrl(tenantId: string): URL {
  return new URL(
    `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`
  );
}

/**
 * Decode (and optionally verify) an access token JWT.
 * Returns normalized claims (sub, email, name, provider) or null on failure.
 * If no auth options are provided or a provider uses decodeOnly, only decoding is performed (no signature verification).
 */
export async function decodeAccessToken(
  token: string,
  options?: AuthOptions
): Promise<DecodedToken | null> {
  if (!token || typeof token !== "string") return null;

  try {
    const decoded = decodeJwt(token);
    const payload = decoded as unknown as Record<string, unknown>;
    const iss = typeof payload.iss === "string" ? payload.iss : undefined;

    // Determine which provider config applies and whether to verify
    let verifyUrl: URL | null = null;
    let issuer: string | undefined;
    let audience: string | undefined;

    if (options?.google && iss?.includes("accounts.google.com")) {
      verifyUrl = getGoogleJwksUrl();
      issuer = GOOGLE_ISSUER;
      audience = options.google.clientId;
    } else if (
      options?.microsoft &&
      iss?.includes("login.microsoftonline.com")
    ) {
      const tenantId = options.microsoft.tenantId;
      verifyUrl = getMicrosoftJwksUrl(tenantId);
      issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
      audience = options.microsoft.clientId;
    } else if (options?.custom) {
      if (options.custom.decodeOnly) {
        return normalizePayload(payload);
      }
      if (options.custom.jwksUrl) {
        verifyUrl = new URL(options.custom.jwksUrl);
        issuer = options.custom.issuer;
      }
    }

    // No verification configured: decode only
    if (!verifyUrl) {
      return normalizePayload(payload);
    }

    const JWKS = createRemoteJWKSet(verifyUrl);
    const verifyOptions: { issuer?: string; audience?: string } = {};
    if (issuer) verifyOptions.issuer = issuer;
    if (audience) verifyOptions.audience = audience;

    const { payload: verified } = await jwtVerify(token, JWKS, verifyOptions);
    return normalizePayload(verified as unknown as Record<string, unknown>);
  } catch {
    return null;
  }
}
