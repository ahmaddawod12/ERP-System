import type { Request } from 'express';

function safeHeader(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[A-Za-z0-9._:/@-]{1,256}$/.test(candidate)
    ? candidate
    : undefined;
}

export function logPoisonMessage(request: Request, route: 'preview' | 'generate'): void {
  const envelope = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
  const message = envelope.message && typeof envelope.message === 'object'
    && !Array.isArray(envelope.message)
    ? envelope.message as Record<string, unknown>
    : {};
  const attributes = message.attributes && typeof message.attributes === 'object'
    && !Array.isArray(message.attributes)
    ? message.attributes as Record<string, unknown>
    : {};
  const deliveryAttempt = Number(envelope.deliveryAttempt);
  console.warn('Authenticated poison Pub/Sub message rejected', {
    poisonMessage: true,
    route,
    topic: safeHeader(request.headers['x-goog-pubsub-topic']) ?? 'unknown',
    deliveryAttempt: Number.isSafeInteger(deliveryAttempt) && deliveryAttempt > 0
      ? deliveryAttempt
      : undefined,
    schemaVersion: typeof attributes.schemaVersion === 'string'
      && /^[A-Za-z0-9._-]{1,32}$/.test(attributes.schemaVersion)
      ? attributes.schemaVersion
      : 'unknown',
  });
}
