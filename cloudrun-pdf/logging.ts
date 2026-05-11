const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function normalizeLogValue(value) {
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

function writeStructuredLog(severity, fallbackMessage, firstArg, restArgs) {
  const payload: any = {
    severity,
    message: typeof firstArg === 'string' ? firstArg : fallbackMessage,
  };

  const fields: any = {};
  if (typeof firstArg !== 'string') {
    fields.arg0 = normalizeLogValue(firstArg);
  }

  restArgs.forEach((arg, index) => {
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

