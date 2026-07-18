import { AppError } from "../http/errors.js";

interface PostgresErrorLike {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly constraint?: unknown;
}

function asPostgresError(error: unknown): PostgresErrorLike | null {
  return error !== null && typeof error === "object"
    ? error as PostgresErrorLike
    : null;
}

export type DatabaseMutationOperation =
  | "business.register"
  | "job.create"
  | "job.complete"
  | "job.update"
  | "job.accept"
  | "job.delete";

export function mapDatabaseError(
  error: unknown,
  operation?: DatabaseMutationOperation,
): unknown {
  if (error instanceof AppError) return error;
  const databaseError = asPostgresError(error);
  const code = typeof databaseError?.code === "string" ? databaseError.code : "";
  const message = typeof databaseError?.message === "string" ? databaseError.message : "";

  if (code === "40001" && message.includes("ENTITY_VERSION_CONFLICT")) {
    return new AppError({
      statusCode: 409,
      code: "STALE_ENTITY_VERSION",
      message: "The job changed before this request was applied.",
      fieldErrors: { entityVersion: ["Reload the job and try again."] },
      cause: error,
    });
  }
  if (
    code === "40001"
    && (message.includes("TAX_CALLBACK_PAYLOAD_CONFLICT")
      || message.includes("TAX_APPROVAL_SESSION_CONFLICT"))
  ) {
    const callbackConflict = message.includes("TAX_CALLBACK_PAYLOAD_CONFLICT");
    return new AppError({
      statusCode: 409,
      code: callbackConflict ? "TAX_CALLBACK_PAYLOAD_CONFLICT" : "TAX_APPROVAL_SESSION_CONFLICT",
      message: callbackConflict
        ? "The callback event ID was already used for different content."
        : "The tax approval session is already bound to another invoice.",
      cause: error,
    });
  }
  if (code === "40001") {
    return new AppError({
      statusCode: 503,
      code: "DATABASE_RETRY_REQUIRED",
      message: "A concurrent database change requires this request to be retried.",
      retryable: true,
      cause: error,
    });
  }
  if (code === "P0002" && message.includes("JOB_NOT_FOUND")) {
    return new AppError({
      statusCode: 404,
      code: "JOB_NOT_FOUND",
      message: "The requested job was not found.",
      cause: error,
    });
  }
  if (code === "P0002" && message.includes("JOB_COMPANY_NOT_FOUND")) {
    return new AppError({
      statusCode: 404,
      code: "WORKSPACE_NOT_FOUND",
      message: "The requested workspace was not found.",
      cause: error,
    });
  }
  if (
    code === "P0002"
    && (message.includes("CLIENT_NOT_FOUND")
      || message.includes("ASSIGNEE_NOT_FOUND")
      || message.includes("INVENTORY_PART_NOT_FOUND"))
  ) {
    const subject = message.includes("CLIENT_")
      ? "client"
      : message.includes("ASSIGNEE_")
        ? "assignee"
        : "inventory part";
    return new AppError({
      statusCode: 404,
      code: "JOB_REFERENCE_NOT_FOUND",
      message: `The selected ${subject} was not found in this workspace.`,
      cause: error,
    });
  }
  if (code === "P0002" && message.includes("UPLOAD_SESSION_NOT_FOUND")) {
    return new AppError({
      statusCode: 404,
      code: "UPLOAD_SESSION_NOT_FOUND",
      message: "The upload session was not found.",
      cause: error,
    });
  }
  if (operation === "business.register" && message.includes("ONBOARDING_ALREADY_COMPLETED")) {
    return new AppError({
      statusCode: 409,
      code: "ONBOARDING_ALREADY_COMPLETED",
      message: "This account already belongs to a workspace.",
      cause: error,
    });
  }
  if (operation === "business.register" && code === "23505") {
    return new AppError({
      statusCode: 409,
      code: "BUSINESS_REGISTRATION_CONFLICT",
      message: "The business profile conflicts with an existing registration.",
      cause: error,
    });
  }
  if (operation === "business.register" && code === "22023") {
    return new AppError({
      statusCode: 400,
      code: "INVALID_BUSINESS_REGISTRATION",
      message: "The business registration contains invalid fields.",
      cause: error,
    });
  }
  if (code === "42501" && operation !== undefined) {
    if (operation === "business.register") {
      return new AppError({
        statusCode: 403,
        code: "BUSINESS_REGISTRATION_FORBIDDEN",
        message: "This account is not allowed to create a workspace.",
        cause: error,
      });
    }
    const operationError = {
      "job.create": {
        code: "JOB_CREATION_FORBIDDEN",
        message: "You are not allowed to create this job.",
      },
      "job.complete": {
        code: "JOB_COMPLETION_FORBIDDEN",
        message: "You are not allowed to complete this job.",
      },
      "job.update": {
        code: "JOB_UPDATE_FORBIDDEN",
        message: "You are not allowed to update this job.",
      },
      "job.accept": {
        code: "JOB_ACCEPT_FORBIDDEN",
        message: "You are not allowed to accept this job.",
      },
      "job.delete": {
        code: "JOB_DELETE_FORBIDDEN",
        message: "You are not allowed to delete this job.",
      },
    }[operation];
    return new AppError({
      statusCode: 403,
      code: operationError.code,
      message: operationError.message,
      cause: error,
    });
  }
  if (
    code === "42501"
    && (message.includes("JOB_CREATION_FORBIDDEN")
      || message.includes("SOLO_PENDING_JOB_FORBIDDEN")
      || message.includes("COMPANY_MEMBERSHIP_REQUIRED")
      || message.includes("JOBS_MODULE_DISABLED"))
  ) {
    return new AppError({
      statusCode: 403,
      code: "JOB_CREATION_FORBIDDEN",
      message: "You are not allowed to create this job.",
      cause: error,
    });
  }
  if (code === "42501") {
    return new AppError({
      statusCode: 403,
      code: "JOB_COMPLETION_FORBIDDEN",
      message: "You are not allowed to complete this job.",
      cause: error,
    });
  }
  if (code === "22023" && message.includes("JOB_NOT_COMPLETABLE")) {
    return new AppError({
      statusCode: 409,
      code: "JOB_NOT_COMPLETABLE",
      message: "The job can no longer be completed from its current state.",
      cause: error,
    });
  }
  if (code === "22023" && message.includes("JOB_NOT_ACCEPTABLE")) {
    return new AppError({
      statusCode: 409,
      code: "JOB_NOT_ACCEPTABLE",
      message: "The job can no longer be accepted from its current state.",
      cause: error,
    });
  }
  if (
    code === "22023"
    && (message.includes("JOB_FINISHED_STATUS_LOCKED")
      || message.includes("JOB_DIRECT_FINISH_FORBIDDEN"))
  ) {
    return new AppError({
      statusCode: 409,
      code: "JOB_STATUS_CONFLICT",
      message: "Use the dedicated completion or acceptance operation for this transition.",
      cause: error,
    });
  }
  if (
    code === "23503"
    && (message.includes("JOB_CERTIFICATE_LOCKED")
      || message.includes("JOB_HAS_LINKED_DOCUMENTS")
      || message.includes("JOB_HAS_INVENTORY_MOVEMENTS")
      || message.includes("JOB_HAS_ATTACHMENTS")
      || message.includes("JOB_HAS_UPLOAD_SESSION"))
  ) {
    return new AppError({
      statusCode: 409,
      code: "JOB_DELETE_CONFLICT",
      message: "The job cannot be deleted while protected records or files reference it.",
      cause: error,
    });
  }
  if (
    code === "22023"
    && (message.includes("INVENTORY_PART") || message.includes("JOB_PART"))
  ) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_JOB_PARTS",
      message: "One or more job parts are invalid.",
      fieldErrors: { partsUsed: ["Check the selected parts and quantities."] },
      cause: error,
    });
  }
  if (
    code === "22023"
    && (message.includes("JOB_PATCH")
      || message.includes("JOB_NOTES_INVALID")
      || message.includes("JOB_ADDRESS_INVALID")
      || message.includes("JOB_CATEGORY_INVALID")
      || message.includes("JOB_PRIORITY_INVALID")
      || message.includes("JOB_DUE_AT_INVALID"))
  ) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_JOB_UPDATE",
      message: "The job update contains invalid fields.",
      cause: error,
    });
  }
  if (
    code === "22023"
    && (message.includes("JOB_TITLE_INVALID")
      || message.includes("JOB_DESCRIPTION_INVALID")
      || message.includes("JOB_LOCATION_INVALID")
      || message.includes("CLIENT_ID_INVALID")
      || message.includes("ASSIGNEE_MEMBER_NO_INVALID")
      || message.includes("JOB_STATUS_INVALID"))
  ) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_JOB",
      message: "The job contains invalid fields.",
      cause: error,
    });
  }
  if (code === "22023" && message.includes("TIME_")) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_JOB_TIME",
      message: "The job time range is invalid.",
      fieldErrors: { timeTo: ["Use a valid time range in 24-hour format."] },
      cause: error,
    });
  }
  if (code === "22023" && message.includes("SIGNING_PERSON_INVALID")) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_SIGNING_PERSON",
      message: "The signing person is invalid.",
      fieldErrors: { signingPerson: ["Enter between 1 and 200 characters."] },
      cause: error,
    });
  }
  if (code === "22023" && message.includes("TRAVEL_DISTANCE_INVALID")) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_TRAVEL_DISTANCE",
      message: "The travel distance is invalid.",
      fieldErrors: { travelDistance: ["Enter a non-negative distance."] },
      cause: error,
    });
  }
  if (
    message.includes("inventory_insufficient")
    || message.includes("UPLOAD_SESSION_ALREADY_CONSUMED")
    || message.includes("UPLOAD_SESSION_EXPIRED")
  ) {
    return new AppError({
      statusCode: 409,
      code: "JOB_COMPLETION_CONFLICT",
      message: "The job could not be completed because related state changed.",
      cause: error,
    });
  }
  if (message.includes("UPLOAD_OBJECT_MISMATCH")) {
    return new AppError({
      statusCode: 409,
      code: "UPLOAD_OBJECT_MISMATCH",
      message: "One or more uploaded files changed before finalization.",
      cause: error,
    });
  }
  if (
    code === "40P01"
    || code === "55P03"
    || code === "57014"
    || code.startsWith("08")
    || code === "57P01"
  ) {
    return new AppError({
      statusCode: 503,
      code: "DATABASE_BUSY",
      message: "The database is temporarily busy. Try again shortly.",
      retryable: true,
      cause: error,
    });
  }

  if (
    code === "P0002"
    && (message.includes("TAX_CALLBACK_RESERVATION_NOT_FOUND")
      || message.includes("TAX_CALLBACK_DOCUMENT_NOT_FOUND")
      || message.includes("TAX_APPROVAL_RESERVATION_NOT_FOUND"))
  ) {
    return new AppError({
      statusCode: 404,
      code: "TAX_CALLBACK_TARGET_NOT_FOUND",
      message: "The callback references a reservation or document that does not exist.",
      cause: error,
    });
  }
  if (
    code === "22023"
    && (message.includes("TAX_CALLBACK_INVALID")
      || message.includes("TAX_CALLBACK_NOT_TAX_INVOICE")
      || message.includes("TAX_APPROVAL_"))
  ) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_TAX_CALLBACK",
      message: "The tax callback payload is invalid.",
      cause: error,
    });
  }

  return error;
}
