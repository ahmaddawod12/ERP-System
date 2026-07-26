import swagger from "@fastify/swagger";
import { cloudLoggingTraceFields } from "@smart-job/observability";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

import { loadConfig } from "./config.js";
import { registerHttpHandlers } from "./http/handlers.js";
import { registerHttpHooks } from "./http/hooks.js";
import { requestPath } from "./http/logging.js";
import { createRequestId } from "./request-id.js";
import { registerArchiveReadRoutes } from "./routes/archives-read.js";
import { registerBootstrapRoutes } from "./routes/bootstrap.js";
import { registerBusinessRegistrationRoutes } from "./routes/business-registration.js";
import { registerClientsReadRoutes } from "./routes/clients-read.js";
import { registerClientMutationRoutes } from "./routes/clients-mutations.js";
import { registerContactRequestRoutes } from "./routes/contact-requests.js";
import { registerDocumentsReadRoutes } from "./routes/documents-read.js";
import { registerDocumentMutationRoutes } from "./routes/documents-mutations.js";
import { registerJobCompletionRoutes } from "./routes/job-completion.js";
import { registerJobCreationRoutes } from "./routes/job-creation.js";
import { registerJobMutationRoutes } from "./routes/job-mutations.js";
import { registerJobsReadRoutes } from "./routes/jobs-read.js";
import { registerInventoryReadRoutes } from "./routes/inventory-read.js";
import { registerInventoryMutationRoutes } from "./routes/inventory-mutations.js";
import { registerInternalDocumentDispatchRoute } from "./routes/internal-document-dispatch.js";
import { registerInternalEmailDispatchRoute } from "./routes/internal-email-dispatch.js";
import { registerInternalTaxCallbackRoute } from "./routes/internal-tax-callback.js";
import { registerInternalTaxSubmissionRoutes } from "./routes/internal-tax-submissions.js";
import { registerInvitationRoutes } from "./routes/invitations.js";
import { registerProfileRoutes } from "./routes/profiles.js";
import { registerPushTokenRoutes } from "./routes/push-token.js";
import { registerSystemRoutes, type ReadinessCheck } from "./routes/system.js";
import { registerSupportRoutes } from "./routes/support.js";
import { registerTaxInvoiceRoutes } from "./routes/tax-invoices.js";
import { registerViewerRoutes } from "./routes/viewer.js";
import { registerWebSessionRoutes } from "./routes/web-sessions.js";
import { registerUploadSessionRoutes } from "./routes/upload-sessions.js";
import { registerUpgradeRequestRoutes } from "./routes/upgrade-requests.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";
import { registerWorkerMutationRoutes } from "./routes/workers-mutations.js";
import { registerWorkersReadRoutes } from "./routes/workers-read.js";
import type { ApiServices } from "./services.js";
import type { ServiceConfig } from "./types.js";

export interface BuildAppOptions {
  readonly config?: ServiceConfig;
  readonly readinessCheck?: ReadinessCheck;
  readonly services?: ApiServices;
  readonly logger?: false | {
    readonly level?: ServiceConfig["logLevel"];
    readonly stream?: NodeJS.WritableStream;
  };
}

const defaultReadinessCheck: ReadinessCheck = () => undefined;

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const logger = options.logger === false
    ? false
    : {
          level: options.logger?.level ?? config.logLevel,
          ...(options.logger?.stream === undefined ? {} : { stream: options.logger.stream }),
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "res.headers.set-cookie",
              "body",
              "req.body",
              "request.body",
              "*.accessToken",
              "*.refreshToken",
              "*.clientSecret",
            ],
            censor: "[REDACTED]",
          },
          serializers: {
            req(request) {
              return {
                id: request.id,
                method: request.method,
                path: requestPath(request.url),
                remoteAddress: request.ip,
              };
            },
          },
          mixin: () => cloudLoggingTraceFields(),
        } satisfies NonNullable<FastifyServerOptions["logger"]>;

  const app = Fastify({
    http: { joinDuplicateHeaders: true },
    logger,
    genReqId: createRequestId,
    requestIdHeader: false,
    requestTimeout: config.requestTimeoutMs,
    handlerTimeout: config.requestTimeoutMs,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Smart-Job ERP API",
        description: "Versioned HTTP API for Smart-Job ERP clients.",
        version: "0.1.0",
      },
    },
    transform: jsonSchemaTransform,
  });

  registerHttpHooks(app);
  registerHttpHandlers(app);
  if (options.services !== undefined) {
    registerBusinessRegistrationRoutes(app, {
      authenticator: options.services.authenticator,
      database: options.services.database,
      supabaseUsers: options.services.supabaseUsers,
      webSessions: options.services.webSessions,
    });
    registerArchiveReadRoutes(app, options.services);
    registerBootstrapRoutes(app, options.services);
    registerClientsReadRoutes(app, options.services);
    registerClientMutationRoutes(app, options.services);
    registerContactRequestRoutes(app, options.services);
    registerDocumentsReadRoutes(app, options.services);
    registerDocumentMutationRoutes(app, options.services);
    registerJobCompletionRoutes(app, options.services);
    registerJobCreationRoutes(app, options.services);
    registerJobMutationRoutes(app, options.services);
    registerJobsReadRoutes(app, options.services);
    registerInventoryReadRoutes(app, options.services);
    registerInventoryMutationRoutes(app, options.services);
    registerInternalDocumentDispatchRoute(app, options.services);
    registerInternalEmailDispatchRoute(app, options.services);
    registerInternalTaxCallbackRoute(app, options.services);
    registerInternalTaxSubmissionRoutes(app, options.services);
    registerInvitationRoutes(app, options.services);
    registerProfileRoutes(app, options.services);
    registerPushTokenRoutes(app, options.services);
    registerSupportRoutes(app, options.services);
    registerTaxInvoiceRoutes(app, options.services);
    registerWorkspaceRoutes(app, options.services);
    registerWorkerMutationRoutes(app, options.services);
    registerWorkersReadRoutes(app, options.services);
    registerViewerRoutes(app, options.services);
    if (
      options.services.storage !== undefined
      && options.services.storageBucketId !== undefined
    ) {
      registerUploadSessionRoutes(app, {
        authenticator: options.services.authenticator,
        database: options.services.database,
        storage: options.services.storage,
        storageBucketId: options.services.storageBucketId,
        supabaseUsers: options.services.supabaseUsers,
      });
    }
    registerUpgradeRequestRoutes(app, options.services);
    registerWebSessionRoutes(app, { webSessions: options.services.webSessions });
    app.addHook("onClose", async () => {
      await options.services?.database.close();
    });
  }
  registerSystemRoutes(app, {
    readinessCheck:
      options.readinessCheck
      ?? options.services?.database.checkReadiness.bind(options.services.database)
      ?? defaultReadinessCheck,
  });

  return app;
}
