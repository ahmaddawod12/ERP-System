import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  getDb,
  type DatabaseOptions,
  type SmartJobQueryExecutor,
  type SmartJobTransaction,
} from './client';
import {
  appUsers,
  companies,
  companyCounters,
  companyInvites,
  companyMemberships,
  inventoryLocations,
  jobs,
} from './schema';

type MembershipRole = 'manager' | 'worker' | 'user' | 'basic';
type CounterKey = typeof companyCounters.$inferInsert['counterKey'];

type AppUserInput = {
  uid: string;
  email: string;
  name?: string | null;
  phoneNumber?: string | null;
};

type CreateInviteInput = {
  companyId: string | number;
  code: string;
  targetRole: MembershipRole;
  invitedEmail?: string | null;
  createdByUserId: string;
  now?: string | Date;
  expiresAt?: string | Date;
};

type JoinInviteInput = AppUserInput & {
  companyId: string | number;
  inviteCode: string;
  requestedRole?: MembershipRole;
  now?: string | Date;
};

type CreateManagedMembershipInput = AppUserInput & {
  companyId: string | number;
  role: MembershipRole;
  createdByUserId?: string | null;
  now?: string | Date;
};

type UpdateManagedMembershipInput = {
  companyId: string | number;
  uid: string;
  email?: string | null;
  currentEmail?: string | null;
  name?: string | null;
  phoneNumber?: string | null;
  role?: MembershipRole;
  now?: string | Date;
};

type DeleteManagedMembershipInput = {
  companyId: string | number;
  uid: string;
};

type ActiveMembership = {
  id: string;
  company_id: string;
  member_no: number;
  role: MembershipRole;
  public_company_id: number;
};

function asDate(value: unknown, fallback: Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

async function resolveCompanyByPublicId(
  tx: SmartJobQueryExecutor,
  companyPublicId: string | number,
) {
  const numericCompanyId = Number(companyPublicId);
  if (!Number.isInteger(numericCompanyId) || numericCompanyId < 1) {
    return null;
  }

  const rows = await tx
    .select({
      id: companies.id,
      publicCompanyId: companies.publicCompanyId,
      accountType: companies.accountType,
    })
    .from(companies)
    .where(eq(companies.publicCompanyId, numericCompanyId))
    .limit(1);

  return rows[0] || null;
}

async function upsertAppUser(
  tx: SmartJobTransaction,
  input: AppUserInput,
  now: Date,
) {
  await tx.insert(appUsers).values({
    id: input.uid,
    email: input.email,
    displayName: input.name || null,
    phoneNumber: input.phoneNumber || null,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: appUsers.id,
    set: {
      email: input.email,
      displayName: input.name || null,
      phoneNumber: input.phoneNumber || null,
      updatedAt: now,
    },
  });
}

async function allocateCompanyCounter(
  tx: SmartJobTransaction,
  companyId: string,
  counterKey: CounterKey,
): Promise<number> {
  const result = await tx.execute(sql`
    UPDATE company_counters
    SET next_value = next_value + 1,
        updated_at = NOW()
    WHERE company_id = ${companyId}
      AND counter_key = ${counterKey}
    RETURNING next_value - 1 AS allocated_value
  `);

  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  const allocatedValue = Number(row?.allocated_value);
  if (!Number.isInteger(allocatedValue) || allocatedValue < 1) {
    throw new Error(`Failed to allocate counter ${counterKey}`);
  }
  return allocatedValue;
}

async function findActiveMembership(
  tx: SmartJobQueryExecutor,
  uid: string,
  internalCompanyId: string | null = null,
): Promise<ActiveMembership | null> {
  const result = await tx.execute(sql`
    SELECT
      m.id,
      m.company_id,
      m.member_no,
      m.role,
      c.public_company_id
    FROM company_memberships m
    INNER JOIN companies c ON c.id = m.company_id
    WHERE m.user_id = ${uid}
      AND m.status = 'active'
      ${internalCompanyId ? sql`AND m.company_id = ${internalCompanyId}` : sql``}
    ORDER BY m.joined_at ASC, m.created_at ASC
    LIMIT 1
  `);

  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    member_no: Number(row.member_no),
    role: String(row.role) as MembershipRole,
    public_company_id: Number(row.public_company_id),
  };
}

async function ensureMemberInventoryLocation(
  tx: SmartJobTransaction,
  companyId: string,
  membershipId: string,
  name: string | null | undefined,
  now: Date,
) {
  await tx.insert(inventoryLocations).values({
    companyId,
    locationType: 'member',
    membershipId,
    name: name || 'Member Inventory',
    createdAt: now,
  }).onConflictDoNothing();
}

async function createCompanyInvite(input: CreateInviteInput, options: DatabaseOptions = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());
  const expiresAt = asDate(input.expiresAt, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
  const normalizedCode = String(input.code || '').trim().toUpperCase();

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const creatorMembership = await findActiveMembership(tx, input.createdByUserId, company.id);
    if (!creatorMembership) {
      const error = new Error('Creator is not an active company member');
      (error as any).code = 'permission-denied';
      throw error;
    }

    const [invite] = await tx.insert(companyInvites).values({
      companyId: company.id,
      code: normalizedCode,
      targetRole: input.targetRole,
      status: 'active',
      invitedEmail: input.invitedEmail || null,
      createdByMembershipId: creatorMembership.id,
      expiresAt,
      createdAt: now,
    }).returning({
      id: companyInvites.id,
      code: companyInvites.code,
      expiresAt: companyInvites.expiresAt,
      targetRole: companyInvites.targetRole,
    });

    if (!invite) {
      throw new Error('Invite insert did not return a record');
    }

    return {
      inviteId: invite.id,
      inviteCode: invite.code,
      expiresAt: invite.expiresAt instanceof Date ? invite.expiresAt.toISOString() : String(invite.expiresAt),
      targetRole: invite.targetRole,
    };
  });
}

async function joinCompanyWithInvite(input: JoinInviteInput, options: DatabaseOptions = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());
  const normalizedInviteCode = String(input.inviteCode || '').trim().toUpperCase();

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const inviteResult = await tx.execute(sql`
      SELECT
        id,
        code,
        target_role,
        status,
        used_by_user_id,
        invited_email,
        expires_at
      FROM company_invites
      WHERE company_id = ${company.id}
        AND code = ${normalizedInviteCode}
      LIMIT 1
      FOR UPDATE
    `);
    const invite = inviteResult.rows?.[0] as Record<string, unknown> | undefined;
    if (!invite) {
      const error = new Error('Invalid invite code');
      (error as any).code = 'invalid-argument';
      throw error;
    }

    const inviteExpiresAt = invite.expires_at ? new Date(String(invite.expires_at)) : null;
    if (inviteExpiresAt && inviteExpiresAt.getTime() < now.getTime()) {
      const error = new Error('Invite code has expired');
      (error as any).code = 'failed-precondition';
      throw error;
    }

    const existingMembership = await findActiveMembership(tx, input.uid);
    if (existingMembership) {
      const existingCompanyId = String(existingMembership.public_company_id || '');
      if (existingCompanyId !== String(company.publicCompanyId)) {
        const error = new Error('User already belongs to another company');
        (error as any).code = 'already-exists';
        throw error;
      }

      if (String(invite.used_by_user_id || '') === input.uid) {
        return {
          companyId: String(company.publicCompanyId),
          role: String(existingMembership.role || 'worker'),
          wid: Number(existingMembership.member_no),
        };
      }

      const error = new Error('User already belongs to this company');
      (error as any).code = 'already-exists';
      throw error;
    }

    if (String(invite.status || 'active') !== 'active') {
      const error = new Error('Invite code is not active');
      (error as any).code = 'failed-precondition';
      throw error;
    }

    const invitedEmail = String(invite.invited_email || '').trim().toLowerCase();
    const inputEmail = String(input.email || '').trim().toLowerCase();
    if (invitedEmail && invitedEmail !== inputEmail) {
      const error = new Error('Invite is restricted to a different email');
      (error as any).code = 'permission-denied';
      throw error;
    }

    const candidateRole = String(invite.target_role || input.requestedRole || 'worker').trim().toLowerCase();
    if (!['manager', 'worker', 'user', 'basic'].includes(candidateRole)) {
      const error = new Error('Invite target role is invalid');
      (error as any).code = 'failed-precondition';
      throw error;
    }
    const resolvedRole = candidateRole as MembershipRole;

    await upsertAppUser(tx, input, now);

    const memberNo = await allocateCompanyCounter(tx, company.id, 'member_no');
    const [membership] = await tx.insert(companyMemberships).values({
      companyId: company.id,
      userId: input.uid,
      memberNo,
      role: resolvedRole,
      status: 'active',
      displayName: input.name || null,
      phoneNumber: input.phoneNumber || null,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    }).returning({
      id: companyMemberships.id,
      memberNo: companyMemberships.memberNo,
      role: companyMemberships.role,
    });

    if (!membership) {
      throw new Error('Membership insert did not return a record');
    }

    await ensureMemberInventoryLocation(tx, company.id, membership.id, input.name || input.email || `Member ${memberNo}`, now);

    await tx.update(companyInvites)
      .set({
        status: 'used',
        usedByUserId: input.uid,
        usedAt: now,
      })
      .where(eq(companyInvites.id, String(invite.id)));

    return {
      companyId: String(company.publicCompanyId),
      role: membership.role,
      wid: membership.memberNo,
    };
  });
}

async function createManagedWorkerMembership(
  input: CreateManagedMembershipInput,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    await upsertAppUser(tx, input, now);

    const existingMembership = await findActiveMembership(tx, input.uid, company.id);
    if (existingMembership) {
      const error = new Error('User already belongs to this company');
      (error as any).code = 'already-exists';
      throw error;
    }

    const memberNo = await allocateCompanyCounter(tx, company.id, 'member_no');
    const [membership] = await tx.insert(companyMemberships).values({
      companyId: company.id,
      userId: input.uid,
      memberNo,
      role: input.role,
      status: 'active',
      displayName: input.name || null,
      phoneNumber: input.phoneNumber || null,
      invitedByUserId: input.createdByUserId || null,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    }).returning({
      id: companyMemberships.id,
      memberNo: companyMemberships.memberNo,
      role: companyMemberships.role,
    });

    if (!membership) {
      throw new Error('Membership insert did not return a record');
    }

    await ensureMemberInventoryLocation(tx, company.id, membership.id, input.name || input.email || `Member ${memberNo}`, now);

    return {
      companyId: String(company.publicCompanyId),
      wid: membership.memberNo,
      role: membership.role,
    };
  });
}

async function updateManagedWorkerMembership(
  input: UpdateManagedMembershipInput,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const membershipRows = await tx
      .select({
        id: companyMemberships.id,
        memberNo: companyMemberships.memberNo,
        role: companyMemberships.role,
      })
      .from(companyMemberships)
      .where(and(
        eq(companyMemberships.companyId, company.id),
        eq(companyMemberships.userId, input.uid),
        eq(companyMemberships.status, 'active'),
      ))
      .limit(1);
    const membership = membershipRows[0] || null;
    if (!membership) {
      const error = new Error('Worker membership not found');
      (error as any).code = 'not-found';
      throw error;
    }

    if (input.email || input.name !== undefined || input.phoneNumber !== undefined) {
      await upsertAppUser(tx, {
        uid: input.uid,
        email: input.email || input.currentEmail || '',
        name: input.name,
        phoneNumber: input.phoneNumber,
      }, now);
    }

    const updateData: Partial<typeof companyMemberships.$inferInsert> = {
      updatedAt: now,
    };
    if (input.role) updateData.role = input.role;
    if (input.name !== undefined) updateData.displayName = input.name || null;
    if (input.phoneNumber !== undefined) updateData.phoneNumber = input.phoneNumber || null;

    await tx.update(companyMemberships)
      .set(updateData)
      .where(eq(companyMemberships.id, membership.id));

    return {
      companyId: String(company.publicCompanyId),
      wid: membership.memberNo,
      role: input.role || membership.role,
    };
  });
}

async function deleteManagedWorkerMembership(
  input: DeleteManagedMembershipInput,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const membershipRows = await tx
      .select({
        id: companyMemberships.id,
        memberNo: companyMemberships.memberNo,
      })
      .from(companyMemberships)
      .where(and(
        eq(companyMemberships.companyId, company.id),
        eq(companyMemberships.userId, input.uid),
        eq(companyMemberships.status, 'active'),
      ))
      .limit(1);
    const membership = membershipRows[0] || null;
    if (!membership) {
      const error = new Error('Worker membership not found');
      (error as any).code = 'not-found';
      throw error;
    }

    await tx.delete(inventoryLocations).where(eq(inventoryLocations.membershipId, membership.id));

    // Reset any pending/waiting jobs that were assigned to this worker before the FK cascade nulls the reference
    await tx
      .update(jobs)
      .set({
        status: 'pending',
        assignedMemberNameSnapshot: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(jobs.assignedMembershipId, membership.id),
        inArray(jobs.status, ['pending', 'waiting']),
      ));

    await tx.delete(companyMemberships).where(eq(companyMemberships.id, membership.id));

    return {
      companyId: String(company.publicCompanyId),
      wid: membership.memberNo,
    };
  });
}

async function listCompanyWorkers(
  companyId: string | number,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const company = await resolveCompanyByPublicId(db, companyId);
  if (!company) {
    return [];
  }

  const rows = await db.execute(sql`
    SELECT
      m.member_no,
      m.role,
      u.id AS uid,
      u.email,
      COALESCE(m.display_name, u.display_name, '') AS name,
      COALESCE(m.phone_number, u.phone_number, '') AS phone_number,
      m.joined_at,
      m.updated_at
    FROM company_memberships m
    INNER JOIN app_users u ON u.id = m.user_id
    WHERE m.company_id = ${company.id}
      AND m.status = 'active'
      AND m.role IN ('worker', 'user', 'basic')
    ORDER BY m.joined_at DESC, m.created_at DESC
  `);

  return (rows.rows || []).map((value) => {
    const row = value as Record<string, unknown>;
    return {
    wid: Number(row.member_no),
    uid: row.uid,
    email: row.email || '',
    role: String(row.role || 'worker'),
    name: row.name || '',
    phoneNumber: row.phone_number || '',
    createdAt: row.joined_at instanceof Date ? row.joined_at.toISOString() : String(row.joined_at || ''),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ''),
    };
  });
}

async function getMemberByMemberNo(
  companyId: string | number,
  memberNo: string | number,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const company = await resolveCompanyByPublicId(db, companyId);
  if (!company) return null;

  const rows = await db.execute(sql`
    SELECT
      m.member_no,
      m.role,
      u.id AS uid,
      COALESCE(m.display_name, u.display_name, '') AS name
    FROM company_memberships m
    INNER JOIN app_users u ON u.id = m.user_id
    WHERE m.company_id = ${company.id}
      AND m.member_no = ${Number(memberNo)}
      AND m.status = 'active'
    LIMIT 1
  `);

  const row = (rows.rows || [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    uid: String(row.uid),
    memberNo: Number(row.member_no),
    role: String(row.role || ''),
    name: String(row.name || ''),
  };
}

export { allocateCompanyCounter, createCompanyInvite, createManagedWorkerMembership, deleteManagedWorkerMembership, findActiveMembership, getMemberByMemberNo, joinCompanyWithInvite, listCompanyWorkers, resolveCompanyByPublicId, updateManagedWorkerMembership, upsertAppUser };

