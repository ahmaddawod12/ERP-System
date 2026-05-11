import { isSharedSqlStoreEnabled, runSharedSqlQuery } from './sql-store';

type UserProfileForCompany = {
  uid: string;
  email: string;
  role: string;
  companyId: string;
  accountType: string;
  name: string;
  phoneNumber: string;
  mid?: number;
  wid?: number;
};

export function isSqlAccessStoreEnabled(): boolean {
  return isSharedSqlStoreEnabled();
}

function normalizeRole(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  return ['manager', 'worker', 'user', 'basic', 'dev'].includes(normalized) ? normalized : '';
}

export async function getUserProfileForCompany(uid: string, companyId: string | number): Promise<UserProfileForCompany | null> {
  if (!isSqlAccessStoreEnabled()) {
    return null;
  }

  const result = await runSharedSqlQuery(
    `
      SELECT
        u.id AS uid,
        u.email,
        u.display_name AS user_display_name,
        u.phone_number AS user_phone_number,
        u.system_role,
        m.role AS workspace_role,
        m.member_no,
        c.public_company_id,
        c.account_type
      FROM app_users u
      LEFT JOIN company_memberships m
        ON m.user_id = u.id
       AND m.status = 'active'
      LEFT JOIN companies c
        ON c.id = m.company_id
      WHERE u.id = $1
        AND c.public_company_id = $2
      ORDER BY m.joined_at DESC NULLS LAST, m.created_at DESC NULLS LAST
      LIMIT 1
    `,
    [String(uid || '').trim(), Number(companyId)],
  );

  const row: any = result?.rows?.[0] || null;
  if (!row) {
    return null;
  }

  const role = normalizeRole(row.workspace_role) || normalizeRole(row.system_role);
  const profile: UserProfileForCompany = {
    uid: row.uid,
    email: row.email || '',
    role,
    companyId: row.public_company_id == null ? '' : String(row.public_company_id),
    accountType: row.account_type || '',
    name: row.user_display_name || '',
    phoneNumber: row.user_phone_number || '',
  };

  const memberNo = Number(row.member_no);
  if (Number.isInteger(memberNo) && memberNo > 0) {
    if (role === 'manager') {
      profile.mid = memberNo;
    } else if (['worker', 'user', 'basic'].includes(role)) {
      profile.wid = memberNo;
    }
  }

  return profile;
}