import "server-only";

import {
  JobListPageSchema,
  type JobListQuery,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import type { z } from "zod";
import { backendRequest } from "./transport";
import { buildCompanyJobsApiPath } from "../dal/jobs-query";

export type CompanyJobsPage = z.infer<typeof JobListPageSchema>;

export async function getCompanyJobs(
  companyId: number,
  sessionToken: WebSessionToken,
  query: JobListQuery,
): Promise<CompanyJobsPage> {
  const result = await backendRequest(
    buildCompanyJobsApiPath(companyId, query),
    JobListPageSchema,
    {
      method: "GET",
      headers: { Authorization: `SmartJobSession ${sessionToken}` },
    },
  );

  if ((result.meta.nextCursor ?? null) !== result.data.nextCursor) {
    throw new Error("The backend returned inconsistent job pagination metadata");
  }
  return result.data;
}
