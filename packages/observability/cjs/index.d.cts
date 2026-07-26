import type {
  Attributes,
  Context,
  Span,
} from '@opentelemetry/api';

export type TraceCarrier = Record<string, string>;

export function safeTraceAttributes(
  candidate: Readonly<Record<string, unknown>>,
): Attributes;
export function injectTraceContext(
  carrier?: TraceCarrier,
  activeContext?: Context,
): TraceCarrier;
export function extractTraceContext(
  carrier: Readonly<Record<string, string | undefined>>,
  parent?: Context,
): Context;
export function withExtractedTraceContext<T>(
  carrier: Readonly<Record<string, string | undefined>>,
  run: () => T,
): T;
export function withTaskSpan<T>(
  name: string,
  attributes: Readonly<Record<string, unknown>>,
  run: (span: Span) => Promise<T>,
): Promise<T>;
export function cloudLoggingTraceFields(
  projectId?: string,
): Record<string, string | boolean>;
