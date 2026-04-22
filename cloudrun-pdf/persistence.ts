export function resolveSqlPersistenceBackend(env = process.env): 'sql' | 'firestore' {
  const raw = String(env.SMART_JOB_PERSISTENCE_BACKEND || env.PERSISTENCE_BACKEND || '').trim().toLowerCase();
  if (raw === 'sql') return 'sql';
  if (raw === 'firestore') return 'firestore';
  return String(env.DATABASE_URL || env.SMART_JOB_DATABASE_URL || '').trim() ? 'sql' : 'firestore';
}

export function isSqlPersistenceEnabledForCloudRun(env = process.env): boolean {
  return resolveSqlPersistenceBackend(env) === 'sql';
}

export function getSqlConnectionString(env = process.env): string {
  return String(env.DATABASE_URL || env.SMART_JOB_DATABASE_URL || '').trim();
}