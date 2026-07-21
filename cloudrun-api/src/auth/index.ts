export {
  isCompactJwt,
  parseAuthorizationCredential,
  parseBearerAuthorization,
  type AuthorizationCredential,
  type AuthorizationHeader,
} from "./authorization.js";
export { AuthError, authErrorToAppError, type AuthErrorCode } from "./errors.js";
export {
  authenticateBearerRequest,
  createApiRequestAuthenticator,
  type ApiRequestAuthenticator,
  type AuthenticatedApiRequest,
  type AuthenticatedBearerRequest,
  type CreateApiRequestAuthenticatorOptions,
} from "./request.js";
export {
  SUPABASE_ASYMMETRIC_JWT_ALGORITHMS,
  createSupabaseJwtVerifier,
  type AuthenticatedUser,
  type SupabaseJwtVerifier,
  type SupabaseJwtVerifierOptions,
} from "./supabase-jwt.js";
export {
  createSupabaseUserClient,
  type CreateSupabaseUserClientOptions,
  type SupabaseAuthUser,
  type SupabaseUserClient,
} from "./supabase-user-client.js";
export {
  createSupabaseWebAuthClient,
  type CreateSupabaseWebAuthClientOptions,
  type SupabaseWebAuthClient,
  type SupabaseWebAuthSession,
  type SupabaseWebAuthUser,
} from "./supabase-web-auth-client.js";
export { requireVerifiedMutationIdentity } from "./mutation.js";
export {
  createGoogleServiceIdentityVerifier,
  createLocalServiceIdentityVerifier,
  serviceIdentityContextUserId,
  type CreateGoogleServiceIdentityVerifierOptions,
  type CreateLocalServiceIdentityVerifierOptions,
  type GoogleServiceIdentity,
  type GoogleServiceIdentityVerifier,
} from "./google-service-identity.js";
