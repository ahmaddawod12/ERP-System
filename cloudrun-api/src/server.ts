import { pathToFileURL } from "node:url";

import { buildApp } from "./app.js";
import {
  createApiRequestAuthenticator,
  createGoogleServiceIdentityVerifier,
  createSupabaseJwtVerifier,
  createSupabaseUserClient,
  createSupabaseWebAuthClient,
} from "./auth/index.js";
import { loadConfig } from "./config.js";
import { createApiDatabaseRuntime } from "./database/runtime.js";
import { createPubSubDocumentTaskPublisher } from "./documents/pubsub-publisher.js";
import { loadApiRuntimeConfig } from "./runtime-config.js";
import { createCompanyFileStorage } from "./storage/company-files.js";
import { createWebSessionCrypto } from "./web-sessions/crypto.js";
import { createWebSessionService } from "./web-sessions/service.js";

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const runtimeConfig = loadApiRuntimeConfig();
  const database = createApiDatabaseRuntime({ config: runtimeConfig.database });
  const jwtVerifier = createSupabaseJwtVerifier({
    issuer: runtimeConfig.supabaseJwt.issuer,
    audiences: runtimeConfig.supabaseJwt.audiences,
  });
  const supabaseUsers = createSupabaseUserClient({
    baseUrl: runtimeConfig.supabaseAuth.baseUrl,
    publishableKey: runtimeConfig.supabaseAuth.publishableKey,
  });
  const supabaseWebAuth = createSupabaseWebAuthClient({
    baseUrl: runtimeConfig.supabaseAuth.baseUrl,
    publishableKey: runtimeConfig.supabaseAuth.publishableKey,
  });
  const webSessionCrypto = createWebSessionCrypto({
    key: runtimeConfig.webSessionEncryption.key,
    keyVersion: runtimeConfig.webSessionEncryption.keyVersion,
  });
  const webSessions = createWebSessionService({
    database,
    jwtVerifier,
    supabaseUsers,
    supabaseWebAuth,
    crypto: webSessionCrypto,
  });
  const authenticator = createApiRequestAuthenticator({ jwtVerifier, webSessions });
  const storage = createCompanyFileStorage(runtimeConfig.supabaseStorage);
  const documentTaskPublisher = runtimeConfig.documentDispatch === undefined
    ? undefined
    : createPubSubDocumentTaskPublisher(runtimeConfig.documentDispatch);
  const internalIdentityVerifier = runtimeConfig.internalIdentity === undefined
    ? undefined
    : createGoogleServiceIdentityVerifier(runtimeConfig.internalIdentity);
  const app = await buildApp({
    config,
    services: {
      database,
      authenticator,
      supabaseUsers,
      webSessions,
      storage,
      storageBucketId: runtimeConfig.supabaseStorage.bucketId,
      ...(documentTaskPublisher === undefined ? {} : { documentTaskPublisher }),
      ...(internalIdentityVerifier === undefined ? {} : { internalIdentityVerifier }),
    },
  }).catch(async (error: unknown) => {
    await database.close().catch(() => undefined);
    throw error;
  });
  let shutdownStarted = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    app.log.info({ signal }, "graceful shutdown started");
    const forceExit = setTimeout(() => {
      app.log.fatal({ signal }, "graceful shutdown timed out");
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    void app.close()
      .then(() => clearTimeout(forceExit))
      .catch((error: unknown) => {
        clearTimeout(forceExit);
        app.log.error({ err: error }, "graceful shutdown failed");
        process.exitCode = 1;
      });
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    app.log.fatal({ err: error }, "service failed to start");
    await app.close().catch(() => undefined);
    throw error;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  void startServer().catch(() => {
    process.exitCode = 1;
  });
}
