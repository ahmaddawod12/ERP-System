import { setDatabaseErrorCode } from './errors';
import { eq } from 'drizzle-orm';
import { getDb, type DatabaseOptions } from './client';
import { companyProfiles } from './schema';
import { getCompanyBusinessInfo } from './read-model';
import { resolveCompanyByPublicId } from './membership';

type CompanyProfileChanges = Partial<Record<
  | 'he_name'
  | 'en_name'
  | 'city'
  | 'address'
  | 'business_type'
  | 'business_phone'
  | 'business_email'
  | 'business_fax'
  | 'accountant_name'
  | 'accountant_email'
  | 'accountant_phone',
  string | null
>> & { vat_number?: unknown };

type UpdateCompanyBusinessInfoInput = {
  companyId: string | number;
  changes?: CompanyProfileChanges;
  now?: string | Date;
};

function asDate(value: unknown, fallback: Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

async function getCompanyBusinessInfoByPublicId(
  companyId: string | number,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const company = await resolveCompanyByPublicId(db, companyId);
  if (!company) {
    return null;
  }
  return getCompanyBusinessInfo(company.id, { db });
}

async function updateCompanyBusinessInfo(
  input: UpdateCompanyBusinessInfoInput,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());
    const changes: CompanyProfileChanges = input.changes ?? {};

    if (Object.prototype.hasOwnProperty.call(changes, 'vat_number')) {
      const error = new Error('vat_number is immutable after onboarding');
      setDatabaseErrorCode(error, 'failed-precondition');
      throw error;
    }

    return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const existingRows = await tx
      .select({ companyId: companyProfiles.companyId })
      .from(companyProfiles)
      .where(eq(companyProfiles.companyId, company.id))
      .limit(1);
    if (!existingRows[0]) {
      const error = new Error('Business info not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const updateData: Partial<typeof companyProfiles.$inferInsert> = {
      lastUpdatedAt: now,
    };
    if (Object.prototype.hasOwnProperty.call(changes, 'he_name')) updateData.heName = changes.he_name || null;
    if (Object.prototype.hasOwnProperty.call(changes, 'en_name')) updateData.enName = changes.en_name || null;
    if (Object.prototype.hasOwnProperty.call(changes, 'city')) updateData.city = changes.city || null;
    if (Object.prototype.hasOwnProperty.call(changes, 'address')) updateData.address = changes.address || null;
    if (Object.prototype.hasOwnProperty.call(changes, 'business_type')) updateData.businessType = changes.business_type || null;
    if (Object.prototype.hasOwnProperty.call(changes, 'business_phone')) updateData.businessPhone = changes.business_phone || null;
    if (Object.prototype.hasOwnProperty.call(changes, 'business_email')) updateData.businessEmail = changes.business_email || null;
    if (Object.prototype.hasOwnProperty.call(changes, 'business_fax')) updateData.businessFax = changes.business_fax || null;
    if (Object.prototype.hasOwnProperty.call(changes, 'accountant_name')) updateData.accountantName = changes.accountant_name || null;
    if (Object.prototype.hasOwnProperty.call(changes, 'accountant_email')) updateData.accountantEmail = changes.accountant_email || null;
    if (Object.prototype.hasOwnProperty.call(changes, 'accountant_phone')) updateData.accountantPhone = changes.accountant_phone || null;

    await tx.update(companyProfiles).set(updateData).where(eq(companyProfiles.companyId, company.id));
    return getCompanyBusinessInfo(company.id, { db: tx });
  });
}

export { getCompanyBusinessInfoByPublicId, updateCompanyBusinessInfo };

