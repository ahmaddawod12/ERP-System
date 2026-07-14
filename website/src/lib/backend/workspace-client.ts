import "server-only";

import {
  CompanyBootstrapSchema,
  type CompanyBootstrap,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import { backendRequest } from "./transport";

function companyBootstrapPath(companyId: number): string {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error("A positive public company ID is required");
  }
  return `/api/v1/companies/${companyId}/bootstrap`;
}

export async function getCompanyBootstrap(
  companyId: number,
  sessionToken: WebSessionToken,
): Promise<CompanyBootstrap> {
  const result = await backendRequest(
    companyBootstrapPath(companyId),
    CompanyBootstrapSchema,
    {
      method: "GET",
      headers: { Authorization: `SmartJobSession ${sessionToken}` },
    },
  );
  if (result.data.workspace.companyId !== companyId) {
    throw new Error("The backend returned a mismatched workspace");
  }
  return result.data;
}
