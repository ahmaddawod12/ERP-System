import type {
  ApiRequestAuthenticator,
  GoogleServiceIdentityVerifier,
  SupabaseUserClient,
} from "./auth/index.js";
import type { ApiDatabaseRuntime } from "./database/runtime.js";
import type { WebSessionService } from "./web-sessions/service.js";
import type { CompanyFileStorage } from "./storage/company-files.js";
import type { DocumentTaskPublisher } from "./documents/dispatch.js";

export interface ApiServices {
  readonly database: ApiDatabaseRuntime;
  readonly authenticator: ApiRequestAuthenticator;
  readonly supabaseUsers: SupabaseUserClient;
  readonly webSessions: WebSessionService;
  readonly storage?: CompanyFileStorage;
  readonly storageBucketId?: string;
  readonly documentTaskPublisher?: DocumentTaskPublisher;
  readonly internalIdentityVerifier?: GoogleServiceIdentityVerifier;
}
