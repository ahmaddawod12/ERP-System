function hasExplicitPersistenceBackend(env = process.env): boolean {
  const raw = String(env.SMART_JOB_PERSISTENCE_BACKEND || env.PERSISTENCE_BACKEND || '').trim().toLowerCase();
  return raw === 'sql' || raw === 'firestore';
}

function hasSqlConnectionString(env = process.env): boolean {
  return Boolean(String(env.DATABASE_URL || env.SMART_JOB_DATABASE_URL || '').trim());
}

export function resolveSqlPersistenceBackend(env = process.env): 'sql' | 'firestore' {
  const raw = String(env.SMART_JOB_PERSISTENCE_BACKEND || env.PERSISTENCE_BACKEND || '').trim().toLowerCase();
  if (raw === 'firestore') {
    throw new Error('Firestore persistence is no longer supported for primary ERP data. Configure SQL persistence instead.');
  }
  return 'sql';
}

export function assertSafeCloudRunPersistenceConfiguration(env = process.env): 'sql' | 'firestore' {
  const resolvedBackend = resolveSqlPersistenceBackend(env);
  if (!hasSqlConnectionString(env)) {
    throw new Error('SQL persistence is enabled but no DATABASE_URL or SMART_JOB_DATABASE_URL is configured');
  }

  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production' && hasSqlConnectionString(env) && !hasExplicitPersistenceBackend(env)) {
    throw new Error('SMART_JOB_PERSISTENCE_BACKEND must be set explicitly in production when SQL connection settings are present');
  }

  return resolvedBackend;
}

export function isSqlPersistenceEnabledForCloudRun(env = process.env): boolean {
  return assertSafeCloudRunPersistenceConfiguration(env) === 'sql';
}

export function getSqlConnectionString(env = process.env): string {
  assertSafeCloudRunPersistenceConfiguration(env);
  return String(env.DATABASE_URL || env.SMART_JOB_DATABASE_URL || '').trim();
}
