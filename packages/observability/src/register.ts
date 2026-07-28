import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';

const enabled = process.env.OTEL_ENABLED?.trim().toLowerCase() === 'true';
const successSampleRatio = Number(process.env.OTEL_SUCCESS_SAMPLE_RATIO ?? '0.05');

if (
  enabled
  && (!Number.isFinite(successSampleRatio)
    || successSampleRatio < 0
    || successSampleRatio > 1)
) {
  throw new Error('OTEL_SUCCESS_SAMPLE_RATIO must be between 0 and 1');
}

let sdk: NodeSDK | undefined;

if (enabled) {
  sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(successSampleRatio),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  sdk.start();
}

async function shutdown(): Promise<void> {
  if (sdk) await sdk.shutdown();
}

process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});

export { enabled as telemetryEnabled, shutdown as shutdownTelemetry };
