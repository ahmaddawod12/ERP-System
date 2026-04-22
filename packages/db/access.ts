import { and, desc, eq } from 'drizzle-orm';
import { getDb } from './client';

const {
  appUsers,
  companies,
  companyMemberships,
} = require('./schema');

function normalizeRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['manager', 'worker', 'user', 'basic', 'dev'].includes(normalized)) {
    return normalized;
  }
  return '';
}

function normalizeAccountType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'business' ? 'business' : (normalized === 'solo' ? 'solo' : '');
}

function asIsoString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toISOString === 'function') return value.toISOString();
  return String(value);
}

function hydrateLegacyProfile(row) {
  if (!row) return null;

  const systemRole = normalizeRole(row.systemRole);
  const workspaceRole = normalizeRole(row.workspaceRole);
  const resolvedRole = workspaceRole || systemRole;
  const memberNo = Number.isFinite(Number(row.memberNo)) ? Number(row.memberNo) : null;

  const profile: any = {
    uid: row.uid,
    email: row.email || '',
    role: resolvedRole || '',
    companyId: row.publicCompanyId == null ? '' : String(row.publicCompanyId),
    accountType: normalizeAccountType(row.accountType),
    name: row.membershipDisplayName || row.userDisplayName || '',
    phoneNumber: row.membershipPhoneNumber || row.userPhoneNumber || '',
    createdAt: asIsoString(row.userCreatedAt),
    updatedAt: asIsoString(row.userUpdatedAt),
    systemRole: systemRole || null,
    membershipId: row.membershipId || null,
    membershipStatus: row.membershipStatus || null,
    internalCompanyId: row.internalCompanyId || null,
  };

  if (memberNo !== null) {
    if (resolvedRole === 'manager') {
      profile.mid = memberNo;
    } else if (['worker', 'user', 'basic'].includes(resolvedRole)) {
      profile.wid = memberNo;
    }
  }

  profile.pushToken = row.pushToken || null;

  return profile;
}

function makeBaseUserQuery(db) {
  return db.select({
    uid: appUsers.id,
    email: appUsers.email,
    userDisplayName: appUsers.displayName,
    pushToken: appUsers.pushToken,
    userPhoneNumber: appUsers.phoneNumber,
    systemRole: appUsers.systemRole,
    userCreatedAt: appUsers.createdAt,
    userUpdatedAt: appUsers.updatedAt,
    membershipId: companyMemberships.id,
    memberNo: companyMemberships.memberNo,
    workspaceRole: companyMemberships.role,
    membershipStatus: companyMemberships.status,
    membershipDisplayName: companyMemberships.displayName,
    membershipPhoneNumber: companyMemberships.phoneNumber,
    internalCompanyId: companies.id,
    publicCompanyId: companies.publicCompanyId,
    accountType: companies.accountType,
  })
    .from(appUsers)
    .leftJoin(companyMemberships, and(
      eq(companyMemberships.userId, appUsers.id),
      eq(companyMemberships.status, 'active'),
    ))
    .leftJoin(companies, eq(companies.id, companyMemberships.companyId));
}

async function getUserProfileByFirebaseUid(uid, options: any = {}) {
  const db = options.db || getDb(options.env);
  const query = makeBaseUserQuery(db)
    .where(eq(appUsers.id, uid))
    .orderBy(desc(companyMemberships.joinedAt), desc(companyMemberships.createdAt))
    .limit(1);

  const rows = await query;
  return hydrateLegacyProfile(rows[0] || null);
}

async function getUserProfileByFirebaseUidForCompany(uid, companyId, options: any = {}) {
  const numericCompanyId = Number(companyId);
  if (!Number.isInteger(numericCompanyId) || numericCompanyId < 1) {
    return null;
  }

  const db = options.db || getDb(options.env);
  const rows = await makeBaseUserQuery(db)
    .where(and(
      eq(appUsers.id, uid),
      eq(companies.publicCompanyId, numericCompanyId),
    ))
    .orderBy(desc(companyMemberships.joinedAt), desc(companyMemberships.createdAt))
    .limit(1);

  return hydrateLegacyProfile(rows[0] || null);
}

export { getUserProfileByFirebaseUid, getUserProfileByFirebaseUidForCompany, hydrateLegacyProfile };

