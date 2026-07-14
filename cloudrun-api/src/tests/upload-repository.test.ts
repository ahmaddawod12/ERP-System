import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";

import type { JobAttachmentUploadSessionRequest } from "@smart-job/api-contracts";

import type {
  DatabaseQueryable,
  DatabaseQueryResult,
} from "../database/runtime.js";
import { AppError } from "../http/errors.js";
import type { TenantContext } from "../tenancy/context.js";
import {
  prepareUploadSession,
  readPendingUploadSession,
} from "../uploads/repository.js";

const userId = "b38a0412-bb78-4740-b93b-44474e6bbd77";
const internalCompanyId = "60b37588-8a96-4c79-9394-6b3a341c134a";
const jobId = "d898f234-6a3c-42df-939d-04aa6c8f0b8c";
const attachmentId = "25336d3b-a87e-462e-b1ce-ed2f890c1f44";
const sessionId = "d09324f3-a124-4313-8c46-15dd79eb34f8";
const bucketId = "smart-job-company-files";
const sha256 = createHash("sha256").update("attachment").digest("hex");

function result<Row extends QueryResultRow>(rows: readonly unknown[]): DatabaseQueryResult<Row> {
  return { rowCount: rows.length, rows: rows as unknown as Row[] };
}

function tenant(
  role: TenantContext["workspace"]["role"],
  enabledModules: readonly string[] = ["solojob"],
): TenantContext {
  return {
    internalCompanyId,
    workspace: {
      companyId: 42,
      name: "Upload Workspace",
      accountType: "business",
      role,
      memberNo: role === "dev" ? null : 7,
      enabledModules: [...enabledModules],
    },
  };
}

function createRequest(): JobAttachmentUploadSessionRequest {
  return {
    companyId: 42,
    purpose: "job.create_finished",
    attachments: [{
      attachmentId,
      kind: "photo",
      fileName: "photo.JPG",
      mimeType: "image/jpeg",
      sizeBytes: 10,
      sha256: sha256.toUpperCase(),
    }],
  };
}

function completionRequest(): JobAttachmentUploadSessionRequest {
  return {
    companyId: 42,
    purpose: "job.complete_assigned",
    jobId,
    attachments: [{
      attachmentId,
      kind: "signature",
      fileName: "signature.png",
      mimeType: "image/png",
      sizeBytes: 10,
      sha256,
    }],
  };
}

function hasAppError(code: string, statusCode: number) {
  return (error: unknown): boolean => error instanceof AppError
    && error.code === code
    && error.statusCode === statusCode;
}

test("upload preparation accepts the canonical solojob entitlement and stores owned paths", async () => {
  const now = new Date("2026-07-13T12:00:00.000Z");
  let preparationValues: readonly unknown[] | undefined;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ) {
      assert.match(text, /private\.prepare_api_file_upload_session/);
      preparationValues = values;
      return result<Row>([{
        outcome: "created",
        session_id: sessionId,
        session_expires_at: values?.[7],
        session_signing_failures: 0,
        rate_limit_reset_at: new Date("2026-07-13T12:10:00.000Z"),
      }]);
    },
  };

  const prepared = await prepareUploadSession(transaction, {
    tenant: tenant("manager"),
    userId,
    sessionId,
    request: createRequest(),
    bucketId,
    now,
  });

  assert.equal(prepared.outcome, "ready");
  if (prepared.outcome !== "ready") throw new Error("expected a ready session");
  assert.equal(prepared.created, true);
  assert.equal(prepared.session.purpose, "job.create_finished");
  assert.equal(prepared.session.targetJobId, null);
  assert.equal(prepared.session.expiresAt.toISOString(), "2026-07-13T13:59:00.000Z");
  assert.equal(preparationValues?.[0], prepared.session.id);
  assert.equal(preparationValues?.[1], internalCompanyId);
  assert.equal(preparationValues?.[4], bucketId);
  assert.equal(preparationValues?.[7], prepared.session.expiresAt);

  const objectPrefix = `${internalCompanyId}/${userId}/${prepared.session.id}`;
  assert.equal(preparationValues?.[5], objectPrefix);
  assert.equal(
    prepared.session.attachments[0]?.objectPath,
    `${objectPrefix}/${attachmentId}.jpg`,
  );
  assert.equal(prepared.session.attachments[0]?.sha256, sha256);
  assert.deepEqual(
    JSON.parse(String(preparationValues?.[6])),
    prepared.session.attachments,
  );
});

test("upload preparation denies missing job entitlement and disallowed creator roles", async () => {
  const transaction: DatabaseQueryable = {
    async query() {
      throw new Error("database must not run for denied upload requests");
    },
  };

  await assert.rejects(
    prepareUploadSession(transaction, {
      tenant: tenant("manager", ["documents"]),
      userId,
      sessionId,
      request: createRequest(),
      bucketId,
    }),
    hasAppError("UPLOAD_SESSION_FORBIDDEN", 403),
  );
  await assert.rejects(
    prepareUploadSession(transaction, {
      tenant: tenant("worker"),
      userId,
      sessionId,
      request: createRequest(),
      bucketId,
    }),
    hasAppError("UPLOAD_SESSION_FORBIDDEN", 403),
  );
});

test("assigned-job uploads enforce target existence, state, role, and assignment", async (context) => {
  const prepareForRow = async (
    role: TenantContext["workspace"]["role"],
    row: unknown,
  ) => {
    let prepareCalls = 0;
    const transaction: DatabaseQueryable = {
      async query<Row extends QueryResultRow>(
        text: string,
        values?: readonly unknown[],
      ) {
        if (text.includes("FROM public.jobs job")) {
          assert.deepEqual(values, [jobId, internalCompanyId, userId]);
          return result<Row>(row === null ? [] : [row]);
        }
        if (text.includes("private.prepare_api_file_upload_session")) {
          prepareCalls += 1;
          return result<Row>([{
            outcome: "created",
            session_id: sessionId,
            session_expires_at: values?.[7],
            session_signing_failures: 0,
            rate_limit_reset_at: new Date(),
          }]);
        }
        throw new Error(`Unexpected SQL: ${text.slice(0, 80)}`);
      },
    };
    const prepared = await prepareUploadSession(transaction, {
      tenant: tenant(role),
      userId,
      sessionId,
      request: completionRequest(),
      bucketId,
    });
    return { prepared, prepareCalls };
  };

  await context.test("missing target", async () => {
    await assert.rejects(
      prepareForRow("manager", null),
      hasAppError("JOB_NOT_FOUND", 404),
    );
  });

  await context.test("terminal target", async () => {
    await assert.rejects(
      prepareForRow("manager", {
        status: "finished",
        viewer_membership_id: "membership-a",
        assigned_membership_id: "membership-a",
      }),
      hasAppError("JOB_NOT_COMPLETABLE", 409),
    );
  });

  await context.test("wrong worker assignment", async () => {
    await assert.rejects(
      prepareForRow("worker", {
        status: "pending",
        viewer_membership_id: "membership-a",
        assigned_membership_id: "membership-b",
      }),
      hasAppError("UPLOAD_SESSION_FORBIDDEN", 403),
    );
  });

  await context.test("matching worker assignment", async () => {
    const { prepared, prepareCalls } = await prepareForRow("worker", {
      status: "waiting",
      viewer_membership_id: "membership-a",
      assigned_membership_id: "membership-a",
    });
    assert.equal(prepared.outcome, "ready");
    if (prepared.outcome !== "ready") throw new Error("expected a ready session");
    assert.equal(prepared.session.targetJobId, jobId);
    assert.equal(prepareCalls, 1);
  });

  await context.test("basic membership", async () => {
    const transaction: DatabaseQueryable = {
      async query() {
        throw new Error("job lookup must not run for basic memberships");
      },
    };
    await assert.rejects(
      prepareUploadSession(transaction, {
        tenant: tenant("basic"),
        userId,
        sessionId,
        request: completionRequest(),
        bucketId,
      }),
      hasAppError("UPLOAD_SESSION_FORBIDDEN", 403),
    );
  });
});

test("pending upload reads bind the session to its authenticated owner", async () => {
  const expiresAt = new Date("2026-07-13T14:00:00.000Z");
  const expectedAttachment = {
    ...completionRequest().attachments[0],
    objectPath: `${internalCompanyId}/${userId}/${sessionId}/${attachmentId}.png`,
  };
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ) {
      assert.match(text, /AND user_id = \$3::uuid/);
      assert.deepEqual(values, [
        sessionId,
        internalCompanyId,
        userId,
        "job.complete_assigned",
        jobId,
      ]);
      return result<Row>([{
        id: sessionId,
        purpose: "job.complete_assigned",
        target_job_id: jobId,
        expected_manifest: [expectedAttachment],
        expires_at: expiresAt,
      }]);
    },
  };

  const pending = await readPendingUploadSession(transaction, {
    sessionId,
    internalCompanyId,
    userId,
    purpose: "job.complete_assigned",
    targetJobId: jobId,
    now: new Date("2026-07-13T13:00:00.000Z"),
  });

  assert.equal(pending.id, sessionId);
  assert.deepEqual(pending.attachments, [expectedAttachment]);
});
