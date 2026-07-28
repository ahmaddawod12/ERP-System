import "server-only";

import {
  ClientCreateRequestSchema,
  ClientDeleteRequestSchema,
  ClientDeleteResultSchema,
  ClientListPageSchema,
  ClientSummarySchema,
  ClientUpdateRequestSchema,
  type ClientCreateRequest,
  type ClientDeleteRequest,
  type ClientDeleteResult,
  type ClientListQuery,
  type ClientSummary,
  type ClientUpdateRequest,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import { z } from "zod";
import { backendRequest } from "./transport";
import { buildCompanyClientsApiPath } from "../dal/clients-query";

export type CompanyClientsPage = z.infer<typeof ClientListPageSchema>;

export interface ClientMutationResult<T> {
  readonly data: T;
  readonly backendRequestId: string;
}

function assertPublicCompanyId(companyId: number): void {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error("A positive public company ID is required");
  }
}

function assertClientId(clientId: string): void {
  if (!z.uuid().safeParse(clientId).success) {
    throw new Error("A valid client ID is required");
  }
}

function companyClientsPath(companyId: number): string {
  assertPublicCompanyId(companyId);
  return `/api/v1/companies/${companyId}/clients`;
}

function companyClientPath(companyId: number, clientId: string): string {
  assertClientId(clientId);
  return `${companyClientsPath(companyId)}/${clientId}`;
}

export async function getCompanyClients(
  companyId: number,
  sessionToken: WebSessionToken,
  query: ClientListQuery,
): Promise<CompanyClientsPage> {
  const result = await backendRequest(
    buildCompanyClientsApiPath(companyId, query),
    ClientListPageSchema,
    {
      method: "GET",
      headers: { Authorization: `SmartJobSession ${sessionToken}` },
    },
  );

  if ((result.meta.nextCursor ?? null) !== result.data.nextCursor) {
    throw new Error("The backend returned inconsistent client pagination metadata");
  }
  return result.data;
}

export async function createCompanyClient(
  companyId: number,
  input: ClientCreateRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<ClientMutationResult<ClientSummary>> {
  const body = ClientCreateRequestSchema.parse(input);
  const result = await backendRequest(
    companyClientsPath(companyId),
    ClientSummarySchema,
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

export async function updateCompanyClient(
  companyId: number,
  clientId: string,
  input: ClientUpdateRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<ClientMutationResult<ClientSummary>> {
  const body = ClientUpdateRequestSchema.parse(input);
  const result = await backendRequest(
    companyClientPath(companyId, clientId),
    ClientSummarySchema,
    {
      method: "PATCH",
      headers: {
        Authorization: `SmartJobSession ${sessionToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    },
  );
  if (result.data.clientId !== clientId) {
    throw new Error("The backend returned a mismatched client");
  }
  return { data: result.data, backendRequestId: result.meta.requestId };
}

export async function deleteOrArchiveCompanyClient(
  companyId: number,
  clientId: string,
  input: ClientDeleteRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<ClientMutationResult<ClientDeleteResult>> {
  const body = ClientDeleteRequestSchema.parse(input);
  const result = await backendRequest(
    companyClientPath(companyId, clientId),
    ClientDeleteResultSchema,
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
  if (result.data.clientId !== clientId) {
    throw new Error("The backend returned a mismatched client");
  }
  return { data: result.data, backendRequestId: result.meta.requestId };
}
