/** Domain export surface. Definitions remain dependency-ordered in _definitions.ts. */
export {
  DEFAULT_CLIENT_PAGE_SIZE,
  MAX_CLIENT_PAGE_SIZE,
  ClientStatusSchema,
  ClientStatusFilterSchema,
  ClientListQuerySchema,
  ClientSummarySchema,
  ClientListPageSchema,
  ClientCreateRequestSchema,
  ClientUpdateRequestSchema,
  ClientDeleteRequestSchema,
  ClientDeleteDispositionSchema,
  ClientDeleteResultSchema,
} from './_definitions.js';
export type {
  ClientStatus,
  ClientStatusFilter,
  ClientListQuery,
  ClientSummary,
  ClientCreateRequest,
  ClientUpdateRequest,
  ClientDeleteRequest,
  ClientDeleteDisposition,
  ClientDeleteResult,
} from './_definitions.js';
