const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

type LogSeverity = 'INFO' | 'WARNING' | 'ERROR';

function normalizeLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack || null,
    };
  }

  if (value && typeof value === 'object') {
    return value;
  }

  return value ?? null;
}

function writeStructuredLog(
  severity: LogSeverity,
  fallbackMessage: string,
  firstArg: unknown,
  restArgs: unknown[],
): void {
  const payload: Record<string, unknown> = {
    severity,
    message: typeof firstArg === 'string' ? firstArg : fallbackMessage,
  };

  const fields: Record<string, unknown> = {};
  if (typeof firstArg !== 'string') {
    fields.arg0 = normalizeLogValue(firstArg);
  }

  restArgs.forEach((arg: unknown, index: number) => {
    const normalized = normalizeLogValue(arg);
    if (
      normalized &&
      typeof normalized === 'object' &&
      !Array.isArray(normalized)
    ) {
      Object.assign(fields, normalized);
      return;
    }

    fields[`arg${typeof firstArg === 'string' ? index + 1 : index + 1}`] = normalized;
  });

  if (Object.keys(fields).length > 0) {
    payload.fields = fields;
  }

  const line = JSON.stringify(payload);
  if (severity === 'ERROR') {
    rawConsole.error(line);
  } else if (severity === 'WARNING') {
    rawConsole.warn(line);
  } else {
    rawConsole.log(line);
  }
}

export function installStructuredLogging(serviceName: string): void {
  console.log = (firstArg, ...restArgs) => writeStructuredLog('INFO', `${serviceName} log`, firstArg, restArgs);
  console.warn = (firstArg, ...restArgs) => writeStructuredLog('WARNING', `${serviceName} warning`, firstArg, restArgs);
  console.error = (firstArg, ...restArgs) => writeStructuredLog('ERROR', `${serviceName} error`, firstArg, restArgs);
}
