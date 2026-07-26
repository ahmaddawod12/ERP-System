import {
  context,
  propagation,
  trace,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api';

const ALLOWED_ATTRIBUTE_KEYS = new Set([
  'app.operation',
  'app.result',
  'cloud.pubsub.delivery_attempt',
  'cloud.pubsub.schema_version',
  'cloud.pubsub.topic',
  'db.operation.name',
  'error.type',
  'http.request.method',
  'http.response.status_code',
  'rpc.method',
  'server.address',
  'service.name',
  'url.scheme',
]);

export type TraceCarrier = Record<string, string>;

export function safeTraceAttributes(
  candidate: Readonly<Record<string, unknown>>,
): Attributes {
  const attributes: Attributes = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (!ALLOWED_ATTRIBUTE_KEYS.has(key)) continue;
    if (
      typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) {
      attributes[key] = value;
    }
  }
  return attributes;
}

export function injectTraceContext(
  carrier: TraceCarrier = {},
  activeContext: Context = context.active(),
): TraceCarrier {
  propagation.inject(activeContext, carrier);
  return carrier;
}

export function extractTraceContext(
  carrier: Readonly<Record<string, string | undefined>>,
  parent: Context = context.active(),
): Context {
  return propagation.extract(parent, carrier);
}

export function withExtractedTraceContext<T>(
  carrier: Readonly<Record<string, string | undefined>>,
  run: () => T,
): T {
  return context.with(extractTraceContext(carrier), run);
}

export async function withTaskSpan<T>(
  name: string,
  attributes: Readonly<Record<string, unknown>>,
  run: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer('@smart-job/observability');
  return tracer.startActiveSpan(
    name,
    { attributes: safeTraceAttributes(attributes) },
    async (span) => {
      try {
        return await run(span);
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error('Task failed'));
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export function cloudLoggingTraceFields(
  projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim(),
): Record<string, string | boolean> {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!projectId || !spanContext?.traceId) return {};
  return {
    'logging.googleapis.com/trace': `projects/${projectId}/traces/${spanContext.traceId}`,
    'logging.googleapis.com/spanId': spanContext.spanId,
    'logging.googleapis.com/trace_sampled': Boolean(
      spanContext.traceFlags & 0x01,
    ),
  };
}
