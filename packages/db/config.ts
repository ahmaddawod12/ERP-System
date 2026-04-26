type PersistenceBackend = 'auto' | 'firestore' | 'sql';
type SslMode = 'disable' | 'require';

type DatabaseEnv = Partial<Record<string, string | undefined>>;

type ReadDatabaseConfigOptions = {
  allowMissingUrl?: boolean;
};

type DatabaseConfig = {
  connectionString: string;
  sslMode: SslMode;
  sslRejectUnauthorized: boolean;
  sslCa: string | null;
  maxConnections: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
};

function getDefaultEnv(): DatabaseEnv {
  const nodeGlobal = globalThis as typeof globalThis & {
    process?: {
      env?: DatabaseEnv;
    };
  };
  return nodeGlobal.process?.env ?? {};
}

export function normalizePersistenceBackend(value?: string | null): PersistenceBackend {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'sql') return 'sql';
  if (normalized === 'firestore') return 'firestore';
  return 'auto';
}

export function normalizeSslMode(value?: string | null): SslMode {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'disable' || normalized === 'false' || normalized === 'off') {
    return 'disable';
  }
  if (normalized === 'require' || normalized === 'true' || normalized === 'on') {
    return 'require';
  }
  return 'disable';
}

export function normalizeSslRejectUnauthorized(value?: string | null): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized === 'false' || normalized === 'off' || normalized === '0') {
    return false;
  }
  return true;
}

export function hasDatabaseUrl(env: DatabaseEnv = getDefaultEnv()): boolean {
  return Boolean(String(env.DATABASE_URL || env.SMART_JOB_DATABASE_URL || '').trim());
}

export function resolvePersistenceBackend(env: DatabaseEnv = getDefaultEnv()): Exclude<PersistenceBackend, 'auto'> {
  const configured = normalizePersistenceBackend(env.SMART_JOB_PERSISTENCE_BACKEND || env.PERSISTENCE_BACKEND);
  if (configured === 'firestore') {
    throw new Error('Firestore persistence is no longer supported for primary ERP data. Configure SQL persistence instead.');
  }
  return 'sql';
}

export function readDatabaseConfig(
  env: DatabaseEnv = getDefaultEnv(),
  options: ReadDatabaseConfigOptions = {},
): DatabaseConfig | null {
  const allowMissingUrl = options.allowMissingUrl === true;
  const connectionString = String(env.DATABASE_URL || env.SMART_JOB_DATABASE_URL || '').trim();

  if (!connectionString) {
    if (allowMissingUrl) return null;
    throw new Error('DATABASE_URL is required when SQL persistence is enabled');
  }

  const sslMode = normalizeSslMode(env.DATABASE_SSL_MODE || env.SMART_JOB_DATABASE_SSL_MODE);
  const sslRejectUnauthorized = normalizeSslRejectUnauthorized(
    env.DATABASE_SSL_REJECT_UNAUTHORIZED || env.SMART_JOB_DATABASE_SSL_REJECT_UNAUTHORIZED,
  );
  const sslCaRaw = String(env.DATABASE_SSL_CA || env.SMART_JOB_DATABASE_SSL_CA || '').trim();
  const sslCa = sslCaRaw ? sslCaRaw.replace(/\\n/g, '\n') : null;
  const maxConnections = Number(env.DATABASE_MAX_CONNECTIONS || env.SMART_JOB_DATABASE_MAX_CONNECTIONS || 10);
  const idleTimeoutMillis = Number(env.DATABASE_IDLE_TIMEOUT_MS || env.SMART_JOB_DATABASE_IDLE_TIMEOUT_MS || 30000);
  const connectionTimeoutMillis = Number(env.DATABASE_CONNECT_TIMEOUT_MS || env.SMART_JOB_DATABASE_CONNECT_TIMEOUT_MS || 10000);

  return {
    connectionString,
    sslMode,
    sslRejectUnauthorized,
    sslCa,
    maxConnections: Number.isFinite(maxConnections) && maxConnections > 0 ? maxConnections : 10,
    idleTimeoutMillis: Number.isFinite(idleTimeoutMillis) && idleTimeoutMillis >= 0 ? idleTimeoutMillis : 30000,
    connectionTimeoutMillis: Number.isFinite(connectionTimeoutMillis) && connectionTimeoutMillis >= 0 ? connectionTimeoutMillis : 10000,
  };
}