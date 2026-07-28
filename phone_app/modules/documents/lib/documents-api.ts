import {
  DocumentDeleteRequestSchema,
  DocumentDeleteResultSchema,
  DocumentDetailSchema,
  DocumentDownloadAccessSchema,
  DocumentGenerateRequestSchema,
  DocumentListPageSchema,
  DocumentPreviewRequestSchema,
  DocumentTaskAcceptedSchema,
  DocumentTaskSchema,
  type CursorPage,
  type DocumentDeleteRequest,
  type DocumentDeleteResult,
  type DocumentDetail,
  type DocumentDownloadAccess,
  type DocumentGenerateRequest,
  type DocumentPreviewRequest,
  type DocumentSummary,
  type DocumentTaskAccepted,
  type DocumentTask,
} from '@smart-job/api-contracts';

import { requestApi } from '../../../lib/api/client';
import {
  buildDocumentListPath,
  type NormalizedDocumentListFilters,
} from './document-history-model';

export function fetchDocumentsPage(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly filters: NormalizedDocumentListFilters;
  readonly afterCursor?: string | null;
  readonly signal?: AbortSignal;
}): Promise<CursorPage<DocumentSummary>> {
  return requestApi(
    buildDocumentListPath(input.companyId, input.filters, input.afterCursor ?? null),
    DocumentListPageSchema,
    { uid: input.uid, companyId: input.companyId, signal: input.signal },
  );
}

export function fetchDocumentTask(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly taskId: string;
}): Promise<DocumentTask> {
  const taskId = input.taskId.trim();
  if (!taskId) {
    throw new Error('A document task id is required');
  }
  return requestApi(
    `/api/v1/companies/${input.companyId}/document-tasks/${encodeURIComponent(taskId)}`,
    DocumentTaskSchema,
    { uid: input.uid, companyId: input.companyId },
  );
}

export function fetchDocumentDownloadAccess(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly documentId: string;
}): Promise<DocumentDownloadAccess> {
  const documentId = input.documentId.trim();
  if (!documentId) {
    throw new Error('A document id is required');
  }
  return requestApi(
    `/api/v1/companies/${input.companyId}/documents/${encodeURIComponent(documentId)}/download`,
    DocumentDownloadAccessSchema,
    { uid: input.uid, companyId: input.companyId },
  );
}

export function fetchDocumentDetail(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly documentId: string;
  readonly signal?: AbortSignal;
}): Promise<DocumentDetail> {
  const documentId = input.documentId.trim();
  if (!documentId) throw new Error('A document id is required');
  return requestApi(
    `/api/v1/companies/${input.companyId}/documents/${encodeURIComponent(documentId)}`,
    DocumentDetailSchema,
    {
      uid: input.uid,
      companyId: input.companyId,
      signal: input.signal,
    },
  );
}

export function createDocumentPreviewTask(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly request: DocumentPreviewRequest;
  readonly idempotencyKey: string;
}): Promise<DocumentTaskAccepted> {
  return requestApi(
    `/api/v1/companies/${input.companyId}/document-tasks/preview`,
    DocumentTaskAcceptedSchema,
    {
      method: 'POST',
      body: DocumentPreviewRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function createDocumentGenerationTask(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly request: DocumentGenerateRequest;
  readonly idempotencyKey: string;
}): Promise<DocumentTaskAccepted> {
  return requestApi(
    `/api/v1/companies/${input.companyId}/document-tasks/generate`,
    DocumentTaskAcceptedSchema,
    {
      method: 'POST',
      body: DocumentGenerateRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function deleteDocument(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly documentId: string;
  readonly request: DocumentDeleteRequest;
  readonly idempotencyKey: string;
}): Promise<DocumentDeleteResult> {
  const documentId = input.documentId.trim();
  if (!documentId) {
    throw new Error('A document id is required');
  }
  return requestApi(
    `/api/v1/companies/${input.companyId}/documents/${encodeURIComponent(documentId)}`,
    DocumentDeleteResultSchema,
    {
      method: 'DELETE',
      body: DocumentDeleteRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}
