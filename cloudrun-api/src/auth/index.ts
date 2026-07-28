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
  createFirebaseTokenVerifier,
  type AuthenticatedUser,
  type FirebaseTokenVerifier,
  type FirebaseTokenVerifierOptions,
} from "./firebase-token.js";
export {
  createFirebaseUserClient,
  type CreateFirebaseUserClientOptions,
  type FirebaseAuthUser,
  type FirebaseUserClient,
} from "./firebase-user-client.js";
export {
  createFirebaseWebAuthClient,
  type CreateFirebaseWebAuthClientOptions,
  type FirebaseWebAuthClient,
  type FirebaseWebAuthSession,
} from "./firebase-web-auth-client.js";
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
