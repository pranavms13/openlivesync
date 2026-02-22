/**
 * Helper to use access token only at WebSocket connect (query or header).
 * Returns an onAuth function that reads the token from the request and decodes it.
 */

import type { IncomingMessage } from "node:http";
import type { UserInfo } from "../protocol.js";
import { decodeAccessToken } from "./decode-token.js";
import type { AuthOptions } from "./decode-token.js";

function defaultTokenFromRequest(req: IncomingMessage): string | null {
  const url = req.url ?? "";
  try {
    const u = new URL(url, "http://localhost");
    const fromQuery = u.searchParams.get("access_token");
    if (fromQuery) return fromQuery;
  } catch {
    // ignore URL parse errors
  }
  const auth = req.headers.authorization;
  if (typeof auth === "string" && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim() || null;
  }
  return null;
}

export interface CreateTokenAuthOptions {
  /** Custom way to extract token from the upgrade request. Default: query access_token or Authorization Bearer. */
  tokenFromRequest?: (req: IncomingMessage) => string | null;
}

/**
 * Returns an onAuth function that reads the access token from the request (query or header),
 * decodes it with decodeAccessToken, and returns UserInfo (userId, name, email, provider).
 * Use this so the token is used only at connect; the connection is then recognized for its lifetime.
 */
export function createTokenAuth(
  authOptions: AuthOptions,
  options?: CreateTokenAuthOptions
): (request: IncomingMessage) => Promise<UserInfo | null> {
  const tokenFromRequest = options?.tokenFromRequest ?? defaultTokenFromRequest;

  return async (request: IncomingMessage): Promise<UserInfo | null> => {
    const token = tokenFromRequest(request);
    if (!token) return null;
    const decoded = await decodeAccessToken(token, authOptions);
    if (!decoded) return null;
    return {
      userId: decoded.sub,
      name: decoded.name,
      email: decoded.email,
      provider: decoded.provider,
    };
  };
}
