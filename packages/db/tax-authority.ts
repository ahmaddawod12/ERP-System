import { sql } from 'drizzle-orm';
import { getDb } from './client';
import { resolveCompanyByPublicId } from './membership';

const {
  taxAuthorityTokens,
  taxOauthCallbacks,
  taxOauthSessions,
} = require('./schema');

function asDate(value, fallback) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function toIsoString(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toISOString === 'function') return value.toISOString();
  return String(value);
}

function toMillis(value) {
  const parsed = asDate(value, null);
  return parsed ? parsed.getTime() : 0;
}

function mapTokenRow(row) {
  if (!row) return null;
  return {
    accessToken: row.accessTokenEncrypted || '',
    refreshToken: row.refreshTokenEncrypted || '',
    accessTokenExpiresAt: toMillis(row.accessTokenExpiresAt),
    refreshTokenExpiresAt: toMillis(row.refreshTokenExpiresAt),
    authorizedAt: toIsoString(row.authorizedAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

async function createTaxOauthSession(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());
  const expiresAt = asDate(input.expiresAt, new Date(now.getTime() + 10 * 60 * 1000));

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const authId = String(input.authId || '').trim();
    if (!authId) {
      const error = new Error('Authorization session ID is required');
      (error as any).code = 'invalid-argument';
      throw error;
    }

    await tx.insert(taxOauthSessions).values({
      id: authId,
      companyId: company.id,
      userId: String(input.uid || '').trim(),
      state: String(input.state || '').trim(),
      stateNonce: String(input.stateNonce || '').trim(),
      status: 'pending',
      expiresAt,
      createdAt: now,
    });

    return {
      authId,
      companyId: String(company.publicCompanyId),
      uid: String(input.uid || '').trim(),
      state: String(input.state || '').trim(),
    };
  });
}

async function getLatestTaxOauthCallback(authId, options: any = {}) {
  const db = options.db || getDb(options.env);
  const result = await db.execute(sql`
    SELECT
      c.id,
      c.used,
      c.token_exchange_success,
      c.token_exchange_error,
      c.token_exchange_attempted_at
    FROM tax_oauth_callbacks c
    WHERE c.oauth_session_id = ${String(authId || '').trim()}
    ORDER BY c.created_at DESC
    LIMIT 1
  `);
  const row = result.rows?.[0] || null;
  if (!row) return null;
  return {
    id: row.id,
    used: row.used === true,
    tokenExchangeSuccess: row.token_exchange_success === true,
    tokenExchangeError: row.token_exchange_error || null,
    tokenExchangeAttemptedAt: toIsoString(row.token_exchange_attempted_at),
  };
}

async function consumeTaxOauthSession(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT
        s.id,
        s.user_id,
        s.state,
        s.status,
        s.expires_at,
        c.public_company_id
      FROM tax_oauth_sessions s
      LEFT JOIN companies c ON c.id = s.company_id
      WHERE s.id = ${String(input.authId || '').trim()}
      LIMIT 1
      FOR UPDATE
    `);
    const session = result.rows?.[0] || null;
    if (!session) {
      return null;
    }
    if (String(session.state || '') !== String(input.state || '')) {
      const error = new Error('Authorization state mismatch');
      (error as any).code = 'permission-denied';
      throw error;
    }
    if (String(session.status || '') !== 'pending') {
      const error = new Error('Authorization session already used');
      (error as any).code = 'already-exists';
      throw error;
    }

    const expiresAt = asDate(session.expires_at, null);
    if (expiresAt && expiresAt.getTime() < now.getTime()) {
      const error = new Error('Authorization session expired');
      (error as any).code = 'deadline-exceeded';
      throw error;
    }

    await tx.update(taxOauthSessions).set({
      status: 'used',
      usedAt: now,
    }).where(sql`${taxOauthSessions.id} = ${String(input.authId || '').trim()}`);

    const inserted = await tx.insert(taxOauthCallbacks).values({
      oauthSessionId: String(input.authId || '').trim(),
      codeHash: String(input.codeHash || '').trim(),
      receivedAt: now,
      used: false,
      createdAt: now,
    }).returning({ id: taxOauthCallbacks.id });

    return {
      authId: String(session.id),
      callbackId: inserted[0]?.id || null,
      companyId: session.public_company_id == null ? '' : String(session.public_company_id),
      uid: String(session.user_id || ''),
      state: String(session.state || ''),
    };
  });
}

async function finalizeTaxOauthCallback(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());
  await db.update(taxOauthCallbacks).set({
    used: true,
    tokenExchangeSuccess: input.tokenExchangeSuccess === true,
    tokenExchangeError: input.tokenExchangeError || null,
    tokenExchangeAttemptedAt: now,
  }).where(sql`${taxOauthCallbacks.id} = ${String(input.callbackId || '').trim()}`);
}

async function getTaxAuthorityTokens(companyId, options: any = {}) {
  const db = options.db || getDb(options.env);
  const company = await resolveCompanyByPublicId(db, companyId);
  if (!company) {
    return null;
  }
  const rows = await db.select({
    accessTokenEncrypted: taxAuthorityTokens.accessTokenEncrypted,
    refreshTokenEncrypted: taxAuthorityTokens.refreshTokenEncrypted,
    accessTokenExpiresAt: taxAuthorityTokens.accessTokenExpiresAt,
    refreshTokenExpiresAt: taxAuthorityTokens.refreshTokenExpiresAt,
    authorizedAt: taxAuthorityTokens.authorizedAt,
    updatedAt: taxAuthorityTokens.updatedAt,
  }).from(taxAuthorityTokens).where(sql`${taxAuthorityTokens.companyId} = ${company.id}`).limit(1);
  return mapTokenRow(rows[0] || null);
}

async function upsertTaxAuthorityTokens(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    await tx.insert(taxAuthorityTokens).values({
      companyId: company.id,
      accessTokenEncrypted: input.accessToken || null,
      refreshTokenEncrypted: input.refreshToken || null,
      accessTokenExpiresAt: asDate(input.accessTokenExpiresAt, null),
      refreshTokenExpiresAt: asDate(input.refreshTokenExpiresAt, null),
      authorizedAt: asDate(input.authorizedAt, now),
      updatedAt: now,
    }).onConflictDoUpdate({
      target: taxAuthorityTokens.companyId,
      set: {
        accessTokenEncrypted: input.accessToken || null,
        refreshTokenEncrypted: input.refreshToken || null,
        accessTokenExpiresAt: asDate(input.accessTokenExpiresAt, null),
        refreshTokenExpiresAt: asDate(input.refreshTokenExpiresAt, null),
        authorizedAt: asDate(input.authorizedAt, now),
        updatedAt: now,
      },
    });

    return getTaxAuthorityTokens(company.publicCompanyId, { db: tx });
  });
}

async function finalizeTaxAuthorityTokenRefresh(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());
  const observedExpiresAt = Number(input.observedAccessTokenExpiresAt || 0);

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const currentResult = await tx.execute(sql`
      SELECT
        access_token_encrypted,
        refresh_token_encrypted,
        access_token_expires_at,
        refresh_token_expires_at,
        authorized_at,
        updated_at
      FROM tax_authority_tokens
      WHERE company_id = ${company.id}
      LIMIT 1
      FOR UPDATE
    `);
    const current = currentResult.rows?.[0] || null;
    const currentExpiresAt = toMillis(current?.access_token_expires_at);

    if (current && currentExpiresAt > observedExpiresAt && Date.now() + (5 * 60 * 1000) < currentExpiresAt) {
      return {
        ...mapTokenRow({
          accessTokenEncrypted: current.access_token_encrypted,
          refreshTokenEncrypted: current.refresh_token_encrypted,
          accessTokenExpiresAt: current.access_token_expires_at,
          refreshTokenExpiresAt: current.refresh_token_expires_at,
          authorizedAt: current.authorized_at,
          updatedAt: current.updated_at,
        }),
        skipped: true,
      };
    }

    await tx.insert(taxAuthorityTokens).values({
      companyId: company.id,
      accessTokenEncrypted: input.accessToken || null,
      refreshTokenEncrypted: input.refreshToken || null,
      accessTokenExpiresAt: asDate(input.accessTokenExpiresAt, null),
      refreshTokenExpiresAt: asDate(input.refreshTokenExpiresAt, null),
      authorizedAt: asDate(input.authorizedAt, now),
      updatedAt: now,
    }).onConflictDoUpdate({
      target: taxAuthorityTokens.companyId,
      set: {
        accessTokenEncrypted: input.accessToken || null,
        refreshTokenEncrypted: input.refreshToken || current?.refresh_token_encrypted || null,
        accessTokenExpiresAt: asDate(input.accessTokenExpiresAt, null),
        refreshTokenExpiresAt: asDate(input.refreshTokenExpiresAt, null),
        authorizedAt: asDate(input.authorizedAt, now),
        updatedAt: now,
      },
    });

    const refreshed = await getTaxAuthorityTokens(company.publicCompanyId, { db: tx });
    return {
      ...refreshed,
      skipped: false,
    };
  });
}

export { consumeTaxOauthSession, createTaxOauthSession, finalizeTaxAuthorityTokenRefresh, finalizeTaxOauthCallback, getLatestTaxOauthCallback, getTaxAuthorityTokens, upsertTaxAuthorityTokens };

