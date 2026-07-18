/**
 * Transitional tax handlers.
 *
 * The legacy approval operation never contacted the Tax Authority. Keep its
 * public name during the mobile adoption window, but fail before allocating a
 * number, creating a document, or dispatching a PDF. The authoritative Cloud
 * API workflow will replace this compatibility endpoint.
 */
import type { EdgeFunctionContext } from "../shared-edge-helpers.ts";

export const TAX_SUBMISSION_UNAVAILABLE_MESSAGE =
  "Tax invoice submission is unavailable pending Tax Authority certification.";

export async function getInvoiceApproval(
  _payload: unknown,
  ctx: EdgeFunctionContext,
): Promise<never> {
  throw {
    code: "failed-precondition",
    httpStatus: 503,
    message: TAX_SUBMISSION_UNAVAILABLE_MESSAGE,
    details: { taxSubmissionMode: ctx.env.taxSubmissionMode },
  };
}

export async function taxAuthorityCallbackV1(
  _payload: unknown,
  _ctx: EdgeFunctionContext,
): Promise<never> {
  throw {
    code: "unavailable",
    httpStatus: 501,
    message: "taxAuthorityCallbackV1 not implemented in handler; use /tax/callback endpoint",
  };
}
