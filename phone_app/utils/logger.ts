type LogArgs = readonly unknown[];

const REDACTED = '[REDACTED]';
const MAX_LOG_DEPTH = 4;
const isDevRuntime = typeof __DEV__ === 'boolean' ? __DEV__ : process.env.NODE_ENV !== 'production';
const sensitiveKeyPattern = /(?:authorization|cookie|credential|email|phone|secret|password|token|url|uri|storagePath|(?:^|_)(?:uid|id)$|(?:company|client|job|document|member|task|request|session|device|upload|archive)Id)/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const phonePattern = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const labelledIdentifierPattern = /\b(uid|companyId|clientId|jobId|documentId|memberId|taskId|userId)\s*[:=]\s*[^\s,}]+/gi;
const secretQueryPattern = /([?&](?:access_token|refresh_token|token|signature|key)=)[^&\s]+/gi;

function redactString(value: string): string {
  const opaqueValue = value.trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(opaqueValue)) return REDACTED;
  return value
    .replace(emailPattern, '[REDACTED_EMAIL]')
    .replace(uuidPattern, '[REDACTED_ID]')
    .replace(jwtPattern, '[REDACTED_TOKEN]')
    .replace(phonePattern, '[REDACTED_PHONE]')
    .replace(labelledIdentifierPattern, (_match, label: string) => `${label}=${REDACTED}`)
    .replace(secretQueryPattern, `$1${REDACTED}`);
}

function sanitizeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  key?: string,
): unknown {
  if (key && sensitiveKeyPattern.test(key)) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }
  if (typeof value !== 'object') return String(value);
  if (depth >= MAX_LOG_DEPTH) return '[TRUNCATED]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, 50)) {
    result[entryKey] = sanitizeValue(entryValue, depth + 1, seen, entryKey);
  }
  return result;
}

export function sanitizeLogValue(value: unknown): unknown {
  return sanitizeValue(value, 0, new WeakSet<object>());
}

function sanitizeArgs(args: LogArgs): unknown[] {
  return args.map((argument) => sanitizeLogValue(argument));
}

export const logger = {
  debug: (...args: LogArgs) => {
    if (isDevRuntime) console.debug(...sanitizeArgs(args));
  },
  info: (...args: LogArgs) => {
    if (isDevRuntime) console.info(...sanitizeArgs(args));
  },
  warn: (...args: LogArgs) => {
    console.warn(...sanitizeArgs(args));
  },
  error: (...args: LogArgs) => {
    console.error(...sanitizeArgs(args));
  },
};
