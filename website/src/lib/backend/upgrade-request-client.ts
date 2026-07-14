import "server-only";

import {
  UpgradeRequestListPageSchema,
  UpgradeRequestSummarySchema,
  type UpgradeRequestCreateRequest,
  type UpgradeRequestListQuery,
  type UpgradeRequestModerationRequest,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import { backendRequest } from "./transport";

function authorization(sessionToken: WebSessionToken): string {
  return `SmartJobSession ${sessionToken}`;
}

export async function createUpgradeRequest(
  input: UpgradeRequestCreateRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
) {
  const result = await backendRequest(
    "/api/v1/upgrade-requests",
    UpgradeRequestSummarySchema,
    {
      method: "POST",
      headers: {
        Authorization: authorization(sessionToken),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  return { data: result.data, backendRequestId: result.meta.requestId };
}

export async function listUpgradeRequests(
  query: UpgradeRequestListQuery,
  sessionToken: WebSessionToken,
) {
  const search = new URLSearchParams();
  if (query.status !== undefined) search.set("status", query.status);
  if (query.pageSize !== undefined) search.set("pageSize", String(query.pageSize));
  if (query.afterCursor !== undefined) search.set("afterCursor", query.afterCursor);
  const suffix = search.size === 0 ? "" : `?${search.toString()}`;
  const result = await backendRequest(
    `/api/v1/upgrade-requests${suffix}`,
    UpgradeRequestListPageSchema,
    { method: "GET", headers: { Authorization: authorization(sessionToken) } },
  );
  return { ...result.data, backendRequestId: result.meta.requestId };
}

export async function moderateUpgradeRequest(
  requestId: string,
  input: UpgradeRequestModerationRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
) {
  const result = await backendRequest(
    `/api/v1/upgrade-requests/${encodeURIComponent(requestId)}`,
    UpgradeRequestSummarySchema,
    {
      method: "PATCH",
      headers: {
        Authorization: authorization(sessionToken),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  return { data: result.data, backendRequestId: result.meta.requestId };
}
