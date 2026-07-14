export function requestPath(url: string): string {
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

export function safeErrorIdentity(error: unknown): {
  readonly errorType: string;
  readonly errorCode?: string;
} {
  if (!(error instanceof Error)) {
    return { errorType: typeof error };
  }

  const code = Reflect.get(error, "code");
  return {
    errorType: error.name,
    ...(typeof code === "string" ? { errorCode: code } : {}),
  };
}
