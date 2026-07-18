export class TaxGatewayError extends Error {
  override readonly name = "TaxGatewayError";

  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly safeMessage: string,
    readonly retryable: boolean,
  ) {
    super(safeMessage);
  }
}

export function invalidRequest(message = "The request does not match the tax gateway contract."): TaxGatewayError {
  return new TaxGatewayError(400, "INVALID_REQUEST", message, false);
}

export function dependencyUnavailable(): TaxGatewayError {
  return new TaxGatewayError(
    503,
    "TAX_GATEWAY_NOT_CONFIGURED",
    "The tax gateway is not operationally configured.",
    true,
  );
}

export function taxSubmissionDisabled(): TaxGatewayError {
  return new TaxGatewayError(
    503,
    "TAX_SUBMISSION_DISABLED",
    "Tax invoice submission is unavailable pending Tax Authority certification.",
    false,
  );
}
