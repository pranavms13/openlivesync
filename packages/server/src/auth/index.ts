/**
 * Auth module: decode and verify OAuth/OpenID access tokens.
 */

export {
  decodeAccessToken,
  type DecodedToken,
  type AuthOptions,
  type AuthGoogleConfig,
  type AuthMicrosoftConfig,
  type AuthCustomConfig,
} from "./decode-token.js";
export {
  createTokenAuth,
  type CreateTokenAuthOptions,
} from "./token-auth.js";
