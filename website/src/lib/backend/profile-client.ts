import "server-only";

import {
  BusinessProfileSchema,
  ViewerProfileSchema,
  type BusinessProfile,
  type BusinessProfileUpdateRequest,
  type ViewerProfile,
  type ViewerProfileUpdateRequest,
  type WebSessionToken,
} from "@smart-job/api-contracts";

import { backendRequest } from "./transport";

const VIEWER_PROFILE_PATH = "/api/v1/me/profile";

function assertCompanyId(companyId: number): void {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error("A positive public company ID is required");
  }
}

function companyProfilePath(companyId: number): string {
  assertCompanyId(companyId);
  return `/api/v1/companies/${companyId}/profile`;
}

function viewerProfilePath(companyId: number): string {
  assertCompanyId(companyId);
  return `${VIEWER_PROFILE_PATH}?companyId=${companyId}`;
}

function assertProfileCompanyId(
  profile: { readonly companyId: number | null },
  companyId: number,
): void {
  if (profile.companyId !== companyId) {
    throw new Error("The backend returned a mismatched profile workspace");
  }
}

export interface UpdatedViewerProfile extends ViewerProfile {
  readonly requestId: string;
}

export interface UpdatedBusinessProfile extends BusinessProfile {
  readonly requestId: string;
}

export async function getViewerProfile(
  companyId: number,
  sessionToken: WebSessionToken,
): Promise<ViewerProfile> {
  const result = await backendRequest(
    viewerProfilePath(companyId),
    ViewerProfileSchema,
    {
      method: "GET",
      headers: { Authorization: `SmartJobSession ${sessionToken}` },
    },
  );
  assertProfileCompanyId(result.data, companyId);
  return result.data;
}

export async function getCompanyProfile(
  companyId: number,
  sessionToken: WebSessionToken,
): Promise<BusinessProfile> {
  const result = await backendRequest(
    companyProfilePath(companyId),
    BusinessProfileSchema,
    {
      method: "GET",
      headers: { Authorization: `SmartJobSession ${sessionToken}` },
    },
  );
  assertProfileCompanyId(result.data, companyId);
  return result.data;
}

export async function updateViewerProfile(
  input: ViewerProfileUpdateRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<UpdatedViewerProfile> {
  const result = await backendRequest(VIEWER_PROFILE_PATH, ViewerProfileSchema, {
    method: "PATCH",
    headers: {
      Authorization: `SmartJobSession ${sessionToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  if (input.companyId !== undefined) {
    assertProfileCompanyId(result.data, input.companyId);
  }
  return { ...result.data, requestId: result.meta.requestId };
}

export async function updateCompanyProfile(
  companyId: number,
  input: BusinessProfileUpdateRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<UpdatedBusinessProfile> {
  const result = await backendRequest(
    companyProfilePath(companyId),
    BusinessProfileSchema,
    {
      method: "PATCH",
      headers: {
        Authorization: `SmartJobSession ${sessionToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  assertProfileCompanyId(result.data, companyId);
  return { ...result.data, requestId: result.meta.requestId };
}
