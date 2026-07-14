import {
  JobListPageSchema,
  type CursorPage,
  type JobSummary,
} from '@smart-job/api-contracts';

import { requestApi } from '../../../lib/api/client';
import {
  buildJobListPath,
  type NormalizedJobListFilters,
} from './job-list-model';

export function fetchJobsPage(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly filters: NormalizedJobListFilters;
  readonly afterCursor?: string | null;
}): Promise<CursorPage<JobSummary>> {
  return requestApi(
    buildJobListPath(input.companyId, input.filters, input.afterCursor ?? null),
    JobListPageSchema,
    {
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}
