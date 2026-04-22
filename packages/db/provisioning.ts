import { eq, sql } from 'drizzle-orm';
import { getDb } from './client';

const {
  appUsers,
  companies,
  companyCounters,
  companyMemberships,
  companyProfiles,
  companySubscriptions,
  inventoryLocations,
  systemCounters,
} = require('./schema');

const COMPANY_PUBLIC_ID_COUNTER_KEY = 'company_public_id';

async function allocatePublicCompanyId(tx) {
  const result = await tx.execute(sql`
    INSERT INTO system_counters (counter_key, next_value, updated_at)
    VALUES (${COMPANY_PUBLIC_ID_COUNTER_KEY}, 2, NOW())
    ON CONFLICT (counter_key)
    DO UPDATE SET
      next_value = system_counters.next_value + 1,
      updated_at = NOW()
    RETURNING next_value - 1 AS allocated_value
  `);

  const row = result.rows?.[0] || null;
  const allocatedValue = Number(row?.allocated_value);
  if (!Number.isInteger(allocatedValue) || allocatedValue < 1) {
    throw new Error('Failed to allocate a public company ID');
  }
  return allocatedValue;
}

function buildCounterRows(companyId) {
  return [
    { companyId, counterKey: 'member_no', nextValue: 2 },
    { companyId, counterKey: 'client_no', nextValue: 1 },
    { companyId, counterKey: 'job_no', nextValue: 1 },
    { companyId, counterKey: 'doc_10', nextValue: 1 },
    { companyId, counterKey: 'doc_200', nextValue: 1 },
    { companyId, counterKey: 'doc_210', nextValue: 1 },
    { companyId, counterKey: 'doc_305', nextValue: 1 },
    { companyId, counterKey: 'doc_330', nextValue: 1 },
    { companyId, counterKey: 'doc_400', nextValue: 1 },
  ];
}

async function createWorkspaceRegistration(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = input.now instanceof Date ? input.now : new Date();

  return db.transaction(async (tx) => {
    const existingMembership = await tx.query.companyMemberships.findFirst({
      where: eq(companyMemberships.userId, input.uid),
      columns: {
        id: true,
      },
    });

    if (existingMembership) {
      const error = new Error('User is already registered with a company');
      (error as any).code = 'already-exists';
      throw error;
    }

    await tx
      .insert(appUsers)
      .values({
        id: input.uid,
        email: input.email,
        displayName: input.name || null,
        phoneNumber: input.phoneNumber || null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appUsers.id,
        set: {
          email: input.email,
          displayName: input.name || null,
          phoneNumber: input.phoneNumber || null,
          updatedAt: now,
        },
      });

    const publicCompanyId = await allocatePublicCompanyId(tx);

    const [company] = await tx.insert(companies).values({
      publicCompanyId,
      accountType: input.accountType,
      createdByUserId: input.uid,
      updatedAt: now,
    }).returning({
      id: companies.id,
      publicCompanyId: companies.publicCompanyId,
    });

    await tx.insert(companyProfiles).values({
      companyId: company.id,
      heName: input.businessData.he_name || null,
      enName: input.businessData.en_name || null,
      vatNumber: input.businessData.vat_number || null,
      businessType: input.businessData.business_type || null,
      city: input.businessData.city || null,
      address: input.businessData.address || null,
      businessEmail: input.businessData.business_email || null,
      businessPhone: input.businessData.business_phone || null,
      businessFax: input.businessData.business_fax || null,
      accountantName: input.businessData.accountant_name || null,
      accountantEmail: input.businessData.accountant_email || null,
      accountantPhone: input.businessData.accountant_phone || null,
      registeredAt: now,
      registeredByUserId: input.uid,
      lastUpdatedAt: now,
    });

    await tx.insert(companySubscriptions).values({
      companyId: company.id,
      tier: input.tier,
      status: 'active',
      enabledModules: input.enabledModules || {},
      updatedAt: now,
    });

    const [membership] = await tx.insert(companyMemberships).values({
      companyId: company.id,
      userId: input.uid,
      memberNo: 1,
      role: input.role,
      status: 'active',
      displayName: input.name || null,
      phoneNumber: input.phoneNumber || null,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    }).returning({
      id: companyMemberships.id,
      memberNo: companyMemberships.memberNo,
    });

    await tx.insert(inventoryLocations).values({
      companyId: company.id,
      locationType: 'company',
      membershipId: null,
      name: 'Company Inventory',
      createdAt: now,
    });

    await tx.insert(inventoryLocations).values({
      companyId: company.id,
      locationType: 'member',
      membershipId: membership.id,
      name: input.name || input.email || 'Member Inventory',
      createdAt: now,
    }).onConflictDoNothing();

    await tx.insert(companyCounters).values(buildCounterRows(company.id));

    return {
      companyId: String(company.publicCompanyId),
      internalCompanyId: company.id,
      membershipId: membership.id,
      memberNo: membership.memberNo,
    };
  });
}

export { COMPANY_PUBLIC_ID_COUNTER_KEY, createWorkspaceRegistration };

