import { parseRequestBody } from "@/lib/api/request";
import { handleRouteError } from "@/lib/api/response";
import { proxyToHttpFunction } from "@/lib/firebase/functions-proxy";
import { callableProxySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

const CALLABLE_REGION_OVERRIDES: Partial<Record<string, string>> = {
  getInvoiceApproval: "me-west1",
};

const HTTP_OPERATION_TO_FUNCTION: Partial<Record<string, string>> = {
  createInviteV1: "createInviteV1",
  joinCompanyV1: "joinCompanyV1",
  requestUpgradeV1: "requestUpgradeV1",
  listUpgradeRequestsV1: "listUpgradeRequestsV1",
  moderateUpgradeRequestV1: "moderateUpgradeRequestV1",
};

const CALLABLE_GATEWAY_BY_REGION: Record<string, string> = {
  "us-central1": "mutationGatewayV1",
  "me-west1": "mutationGatewayMeWest1V1",
};

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, callableProxySchema);
    const region = CALLABLE_REGION_OVERRIDES[body.operation] || "us-central1";

    const httpFunctionName = HTTP_OPERATION_TO_FUNCTION[body.operation];
    if (httpFunctionName) {
      return await proxyToHttpFunction(request, httpFunctionName, body.payload, {
        region,
      });
    }

    return await proxyToHttpFunction(request, CALLABLE_GATEWAY_BY_REGION[region], {
      operation: body.operation,
      payload: body.payload,
    }, {
      region,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}