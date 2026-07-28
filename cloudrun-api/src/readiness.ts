import type { ApiDatabaseRuntime } from "./database/runtime.js";
import type { DocumentTaskPublisher } from "./documents/dispatch.js";
import type { EmailDeliveryPublisher } from "./documents/email-dispatch.js";
import type { CompanyFileStorage } from "./storage/company-files.js";
import type { ArchiveStorage } from "./archives/archive-storage.js";

interface ReadinessDependency {
  checkReadiness(): Promise<void>;
}

function requireDependency(
  name: string,
  dependency: { readonly checkReadiness?: () => Promise<void> } | undefined,
): ReadinessDependency {
  if (!dependency?.checkReadiness) {
    throw new Error(`${name} readiness is not configured`);
  }
  return { checkReadiness: () => dependency.checkReadiness!() };
}

/** Production readiness checks dependencies; `/healthz` remains process-only. */
export function createApiReadinessCheck(services: {
  readonly database: ApiDatabaseRuntime;
  readonly storage: CompanyFileStorage;
  readonly archiveStorage?: ArchiveStorage;
  readonly documentTaskPublisher?: DocumentTaskPublisher;
  readonly emailDeliveryPublisher?: EmailDeliveryPublisher;
}): () => Promise<void> {
  return async () => {
    const dependencies: ReadinessDependency[] = [
      services.database,
      requireDependency("company storage", services.storage),
      requireDependency("archive storage", services.archiveStorage),
      requireDependency("document publisher", services.documentTaskPublisher),
      requireDependency("email publisher", services.emailDeliveryPublisher),
    ];
    await Promise.all(dependencies.map((dependency) => dependency.checkReadiness()));
  };
}
