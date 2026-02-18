type AnalyticsPayload = Record<string, unknown>;

export function trackEvent(eventName: string, payload: AnalyticsPayload = {}) {
  if (process.env.NODE_ENV !== "production") {
    console.info("[analytics]", eventName, payload);
  }
}
