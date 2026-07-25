import { Storage } from '@google-cloud/storage';
import { closeDb } from '@smart-job/db';

import { readArchiveRunnerConfig, runMonthlyArchives } from './archive-runner';
import { assertArchiverRuntimeConfig } from './local-platform';
import { runUploadCleanupStartup } from './upload-cleanup';

function structuredLogger() {
  const write = (severity: string, message: unknown, fields: unknown[]) => {
    const payload: Record<string, unknown> = {
      severity,
      message: typeof message === 'string' ? message : 'cloudrun-archiver event',
    };
    if (typeof message !== 'string') payload.value = message;
    if (fields.length === 1 && fields[0] && typeof fields[0] === 'object') {
      Object.assign(payload, fields[0]);
    } else if (fields.length > 0) {
      payload.fields = fields;
    }
    const line = JSON.stringify(payload);
    if (severity === 'ERROR') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };
  return {
    log: (message?: unknown, ...fields: unknown[]) => write('INFO', message, fields),
    warn: (message?: unknown, ...fields: unknown[]) => write('WARNING', message, fields),
    error: (message?: unknown, ...fields: unknown[]) => write('ERROR', message, fields),
  };
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const logger = structuredLogger();
  assertArchiverRuntimeConfig(env);
  const config = readArchiveRunnerConfig(env);
  const bucket = new Storage().bucket(config.bucketName);

  try {
    // Upload-session cleanup is independent; it reports failure but cannot
    // suppress the monthly archive pass.
    await runUploadCleanupStartup({ env, logger });
    const summary = await runMonthlyArchives({ bucket, config, logger });
    logger.log('Monthly archive task finished', summary);
    if (summary.failedCompanies > 0) {
      throw new Error(`${summary.failedCompanies} company archive(s) failed`);
    }
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({
      severity: 'ERROR',
      archiveFailure: true,
      message,
    })}\n`);
    process.exitCode = 1;
  });
}
