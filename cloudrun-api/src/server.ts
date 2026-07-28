import { pathToFileURL } from "node:url";

import { buildApp } from "./app.js";
import {
  createApiRequestAuthenticator,
  createGoogleServiceIdentityVerifier,
  createLocalServiceIdentityVerifier,
  createFirebaseTokenVerifier,
  createFirebaseUserClient,
  createFirebaseWebAuthClient,
} from "./auth/index.js";
import { loadConfig } from "./config.js";
import { createApiDatabaseRuntime } from "./database/runtime.js";
import {
  createPubSubDocumentTaskPublisher,
  createPubSubEmailDeliveryPublisher,
} from "./documents/pubsub-publisher.js";
import { loadApiRuntimeConfig } from "./runtime-config.js";
import { createCompanyFileStorage } from "./storage/company-files.js";
import { createArchiveStorage } from "./archives/archive-storage.js";
import { createTaxGatewayClient } from "./tax/gateway-client.js";
import { createWebSessionCrypto } from "./web-sessions/crypto.js";
import { createWebSessionService } from "./web-sessions/service.js";
import { createApiReadinessCheck } from "./readiness.js";

const LOGICAL_COMPANY_FILE_BUCKET_ID = "smart-job-company-files";

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const runtimeConfig = loadApiRuntimeConfig();
  let lastPoolSaturationLogAt = 0;
  const database = createApiDatabaseRuntime({
    config: runtimeConfig.database,
    onPoolSaturation(snapshot) {
      const now = Date.now();
      if (now - lastPoolSaturationLogAt < 60_000) return;
      lastPoolSaturationLogAt = now;
      process.stderr.write(`${JSON.stringify({
        severity: "WARNING",
        databasePoolSaturation: true,
        message: "API database pool is saturated",
        ...snapshot,
      })}\n`);
    },
  });
  const jwtVerifier = createFirebaseTokenVerifier({
    projectId: runtimeConfig.firebaseAuth.projectId,
  });
  const firebaseUsers = createFirebaseUserClient({
    projectId: runtimeConfig.firebaseAuth.projectId,
    verifier: jwtVerifier,
  });
  const firebaseWebAuth = createFirebaseWebAuthClient({
    apiKey: runtimeConfig.firebaseAuth.webApiKey,
    ...(runtimeConfig.firebaseAuth.authBaseUrl === undefined
      ? {}
      : { authBaseUrl: runtimeConfig.firebaseAuth.authBaseUrl }),
    ...(runtimeConfig.firebaseAuth.tokenBaseUrl === undefined
      ? {}
      : { tokenBaseUrl: runtimeConfig.firebaseAuth.tokenBaseUrl }),
  });
  const webSessionCrypto = createWebSessionCrypto({
    key: runtimeConfig.webSessionEncryption.key,
    keyVersion: runtimeConfig.webSessionEncryption.keyVersion,
  });
  const webSessions = createWebSessionService({
    database,
    jwtVerifier,
    firebaseUsers,
    firebaseWebAuth,
    crypto: webSessionCrypto,
  });
  const authenticator = createApiRequestAuthenticator({ jwtVerifier, webSessions });
  const storage = createCompanyFileStorage(runtimeConfig.companyFileStorage);
  const documentTaskPublisher = runtimeConfig.documentDispatch === undefined
    ? undefined
    : createPubSubDocumentTaskPublisher(runtimeConfig.documentDispatch, {
        ...(runtimeConfig.documentDispatch.apiBaseUrl === undefined
          ? {}
          : { apiBaseUrl: runtimeConfig.documentDispatch.apiBaseUrl }),
        ...(runtimeConfig.documentDispatch.metadataTokenUrl === undefined
          ? {}
          : { metadataTokenUrl: runtimeConfig.documentDispatch.metadataTokenUrl }),
      });
  const emailDeliveryPublisher = runtimeConfig.documentDispatch === undefined
    ? undefined
    : createPubSubEmailDeliveryPublisher({
        projectId: runtimeConfig.documentDispatch.projectId,
        topic: runtimeConfig.documentDispatch.emailTopic,
      }, {
        ...(runtimeConfig.documentDispatch.apiBaseUrl === undefined
          ? {}
          : { apiBaseUrl: runtimeConfig.documentDispatch.apiBaseUrl }),
        ...(runtimeConfig.documentDispatch.metadataTokenUrl === undefined
          ? {}
          : { metadataTokenUrl: runtimeConfig.documentDispatch.metadataTokenUrl }),
      });
  const internalIdentityVerifier = runtimeConfig.localIdentityToken !== undefined
    ? createLocalServiceIdentityVerifier({
        token: runtimeConfig.localIdentityToken,
        ...(runtimeConfig.localIdentityEmail === undefined
          ? {}
          : { email: runtimeConfig.localIdentityEmail }),
      })
    : runtimeConfig.internalIdentity === undefined
      ? undefined
      : createGoogleServiceIdentityVerifier(runtimeConfig.internalIdentity);
  const taxGatewayClient = runtimeConfig.taxSubmission.gateway === undefined
    ? undefined
    : createTaxGatewayClient(runtimeConfig.taxSubmission.gateway);
  const archiveBucket = String(process.env.ARCHIVE_BUCKET || "").trim();
  const archiveStorage = archiveBucket
    ? createArchiveStorage({
        bucket: archiveBucket,
        ...(runtimeConfig.documentDispatch?.metadataTokenUrl !== undefined
          ? { metadataTokenUrl: runtimeConfig.documentDispatch.metadataTokenUrl }
          : {}),
        ...(process.env.GCS_API_ENDPOINT
          ? { gcsApiBaseUrl: String(process.env.GCS_API_ENDPOINT).replace(/\/+$/, "") }
          : {}),
      })
    : undefined;
  const app = await buildApp({
    config,
    readinessCheck: createApiReadinessCheck({
      database,
      storage,
      ...(archiveStorage === undefined ? {} : { archiveStorage }),
      ...(documentTaskPublisher === undefined ? {} : { documentTaskPublisher }),
      ...(emailDeliveryPublisher === undefined ? {} : { emailDeliveryPublisher }),
    }),
    services: {
      database,
      authenticator,
      firebaseUsers,
      webSessions,
      storage,
      storageBucketId: LOGICAL_COMPANY_FILE_BUCKET_ID,
      ...(archiveStorage === undefined ? {} : { archiveStorage }),
      ...(documentTaskPublisher === undefined ? {} : { documentTaskPublisher }),
      ...(emailDeliveryPublisher === undefined ? {} : { emailDeliveryPublisher }),
      ...(internalIdentityVerifier === undefined ? {} : { internalIdentityVerifier }),
      taxSubmissionMode: runtimeConfig.taxSubmission.mode,
      ...(taxGatewayClient === undefined ? {} : { taxGatewayClient }),
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
