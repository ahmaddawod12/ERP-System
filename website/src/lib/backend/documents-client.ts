import "server-only";

import {
  DocumentDeleteRequestSchema,
  DocumentDeleteResultSchema,
  DocumentDownloadAccessSchema,
  DocumentGenerateRequestSchema,
  DocumentListPageSchema,
  DocumentPreviewRequestSchema,
  DocumentTaskAcceptedSchema,
  DocumentTaskSchema,
  type DocumentDeleteRequest,
  type DocumentDeleteResult,
  type DocumentDownloadAccess,
  type DocumentGenerateRequest,
  type DocumentListQuery,
  type DocumentPreviewRequest,
  type DocumentTask,
  type DocumentTaskAccepted,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import { z } from "zod";
import { buildCompanyDocumentsApiPath } from "../dal/documents-query";
import { backendRequest } from "./transport";

export type CompanyDocumentsPage = z.infer<typeof DocumentListPageSchema>;

export interface DocumentBackendResult<T> {
  readonly data: T;
  readonly backendRequestId: string;
}

function companyDocumentPath(companyId: number, suffix: string): string {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error("A positive public company ID is required");
  }
  return `/api/v1/companies/${companyId}/${suffix}`;
}

function opaqueSegment(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes("/") || normalized.includes("\\")) {
    throw new Error(`${name} is invalid`);
  }
  return encodeURIComponent(normalized);
}

export async function getCompanyDocuments(
  companyId: number,
  sessionToken: WebSessionToken,
  query: DocumentListQuery,
): Promise<CompanyDocumentsPage> {
  const result = await backendRequest(
    buildCompanyDocumentsApiPath(companyId, query),
    DocumentListPageSchema,
    {
      method: "GET",
      headers: { Authorization: `SmartJobSession ${sessionToken}` },
    },
  );
  if ((result.meta.nextCursor ?? null) !== result.data.nextCursor) {
    throw new Error("The backend returned inconsistent document pagination metadata");
  }
  return result.data;
}

export async function getCompanyDocumentTask(
  companyId: number,
  taskId: string,
  sessionToken: WebSessionToken,
): Promise<DocumentTask> {
  return (await readCompanyDocumentTask(companyId, taskId, sessionToken)).data;
}

export async function readCompanyDocumentTask(
  companyId: number,
  taskId: string,
  sessionToken: WebSessionToken,
): Promise<DocumentBackendResult<DocumentTask>> {
  const result = await backendRequest(
    companyDocumentPath(companyId, `document-tasks/${opaqueSegment(taskId, "Document task ID")}`),
    DocumentTaskSchema,
    {
      method: "GET",
      headers: { Authorization: `SmartJobSession ${sessionToken}` },
    },
  );
  return { data: result.data, backendRequestId: result.meta.requestId };
}

export async function getCompanyDocumentDownload(
  companyId: number,
  documentId: string,
  sessionToken: WebSessionToken,
): Promise<DocumentDownloadAccess> {
  const result = await backendRequest(
    companyDocumentPath(companyId, `documents/${opaqueSegment(documentId, "Document ID")}/download`),
    DocumentDownloadAccessSchema,
    {
      method: "GET",
      headers: { Authorization: `SmartJobSession ${sessionToken}` },
    },
  );
  return result.data;
}

export async function previewCompanyDocument(
  companyId: number,
  input: DocumentPreviewRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<DocumentBackendResult<DocumentTaskAccepted>> {
  const body = DocumentPreviewRequestSchema.parse(input);
  const result = await backendRequest(
    companyDocumentPath(companyId, "document-tasks/preview"),
    DocumentTaskAcceptedSchema,
    {
      method: "POST",
      headers: {
        Authorization: `SmartJobSession ${sessionToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    },
  );
  return { data: result.data, backendRequestId: result.meta.requestId };
}

export async function generateCompanyDocument(
  companyId: number,
  input: DocumentGenerateRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<DocumentBackendResult<DocumentTaskAccepted>> {
  const body = DocumentGenerateRequestSchema.parse(input);
  const result = await backendRequest(
    companyDocumentPath(companyId, "document-tasks/generate"),
    DocumentTaskAcceptedSchema,
    {
      method: "POST",
      headers: {
        Authorization: `SmartJobSession ${sessionToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    },
  );
  return { data: result.data, backendRequestId: result.meta.requestId };
}

export async function deleteCompanyDocument(
  companyId: number,
  documentId: string,
  input: DocumentDeleteRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<DocumentBackendResult<DocumentDeleteResult>> {
  const validatedDocumentId = z.uuid().parse(documentId);
  const body = DocumentDeleteRequestSchema.parse(input);
  const result = await backendRequest(
    companyDocumentPath(companyId, `documents/${validatedDocumentId}`),
    DocumentDeleteResultSchema,
    {
      method: "DELETE",
      headers: {
        Authorization: `SmartJobSession ${sessionToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    },
  );
  if (result.data.documentId !== validatedDocumentId) {
    throw new Error("The backend returned a mismatched document");
  }
  return { data: result.data, backendRequestId: result.meta.requestId };
}
