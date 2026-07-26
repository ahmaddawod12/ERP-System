import { setDatabaseErrorCode } from './errors';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  getDb,
  type DatabaseOptions,
  type SmartJobTransaction,
} from './client';
import {
  companyMemberships,
  inventoryBalances,
  inventoryLocations,
  inventoryParts,
} from './schema';
import {
  allocateCompanyCounter,
  findActiveMembership,
  resolveCompanyByPublicId,
} from './membership';

type UnknownRecord = Record<string, unknown>;
type DateInput = string | number | Date | null | undefined;
type InventoryPartSqlRow = {
  id: string;
  part_no: number;
  name: string;
  active: boolean;
  low_threshold: unknown;
  created_at: unknown;
  updated_at: unknown;
  archived_at: unknown;
  quantity_on_hand: unknown;
  location_id: string | null;
};

type InventoryMutationInput = {
  companyId: string | number;
  partId?: unknown;
  partName?: unknown;
  quantity?: unknown;
  lowThreshold?: unknown;
  active?: boolean;
  targetUid?: string;
  createdByUserId?: string;
  now?: DateInput;
};

type ReplacementPart = {
  id?: unknown;
  name?: unknown;
  quantity?: unknown;
  lowThreshold?: unknown;
  active?: boolean;
};

type ReplaceInventoryInput = {
  companyId: string | number;
  targetUid: string;
  parts?: readonly ReplacementPart[];
  now?: DateInput;
};

type PickPart = { id?: unknown; name?: unknown; quantity?: unknown };
type PickInventoryInput = {
  companyId: string | number;
  targetUid: string;
  createdByUserId: string;
  partsToPick?: readonly PickPart[];
  now?: DateInput;
};

type InventoryUsage = { id?: unknown; quantity?: unknown };
type DeductInventoryInput = {
  companyId: string | number;
  targetUid?: string;
  jobId?: string | null;
  partsUsed?: readonly InventoryUsage[];
  now?: DateInput;
};

function asDate(value: DateInput, fallback: Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function mapInventoryPartSqlRow(value: unknown): InventoryPartSqlRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as UnknownRecord;
  return {
    id: String(row.id),
    part_no: Number(row.part_no),
    name: String(row.name || ''),
    active: row.active === true,
    low_threshold: row.low_threshold,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
    quantity_on_hand: row.quantity_on_hand,
    location_id: row.location_id ? String(row.location_id) : null,
  };
}

function requireNumericId(value: unknown, fieldName: string): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    const error = new Error(`${fieldName} is required`);
    setDatabaseErrorCode(error, 'invalid-argument');
    throw error;
  }
  return numeric;
}

function requireFiniteNonNegative(value: unknown, fieldName: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    const error = new Error(`${fieldName} must be a non-negative finite number`);
    setDatabaseErrorCode(error, 'invalid-argument');
    throw error;
  }
  return numeric;
}

function normalizePartName(value: unknown, fieldName = 'partName'): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    const error = new Error(`${fieldName} is required`);
    setDatabaseErrorCode(error, 'invalid-argument');
    throw error;
  }
  if (normalized.length > 120) {
    const error = new Error(`${fieldName} exceeds 120 characters`);
    setDatabaseErrorCode(error, 'invalid-argument');
    throw error;
  }
  return normalized;
}

async function getCompanyInventoryLocation(
  tx: SmartJobTransaction,
  companyInternalId: string,
) {
  const rows = await tx
    .select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(and(
      eq(inventoryLocations.companyId, companyInternalId),
      eq(inventoryLocations.locationType, 'company'),
      isNull(inventoryLocations.membershipId),
    ))
    .limit(1);
  return rows[0] || null;
}

async function getMemberInventoryLocation(
  tx: SmartJobTransaction,
  companyInternalId: string,
  targetUid: string,
) {
  const membershipRows = await tx
    .select({
      id: companyMemberships.id,
      memberNo: companyMemberships.memberNo,
    })
    .from(companyMemberships)
    .where(and(
      eq(companyMemberships.companyId, companyInternalId),
      eq(companyMemberships.userId, String(targetUid || '').trim()),
      eq(companyMemberships.status, 'active'),
    ))
    .limit(1);
  const membership = membershipRows[0] || null;
  if (!membership) {
    const error = new Error('Target user membership not found');
    setDatabaseErrorCode(error, 'not-found');
    throw error;
  }

  const locationRows = await tx
    .select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(and(
      eq(inventoryLocations.companyId, companyInternalId),
      eq(inventoryLocations.locationType, 'member'),
      eq(inventoryLocations.membershipId, membership.id),
    ))
    .limit(1);
  const location = locationRows[0] || null;
  if (!location) {
    const error = new Error('Member inventory location not found');
    setDatabaseErrorCode(error, 'failed-precondition');
    throw error;
  }

  return {
    membershipId: membership.id,
    memberNo: membership.memberNo,
    locationId: location.id,
  };
}

async function lockCompanyInventoryPartAllocation(
  tx: SmartJobTransaction,
  companyInternalId: string,
) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`inventory_part_no:${companyInternalId}`}))`);
}

async function allocateInventoryPartNo(
  tx: SmartJobTransaction,
  companyInternalId: string,
): Promise<number> {
  await lockCompanyInventoryPartAllocation(tx, companyInternalId);
  try {
    return await allocateCompanyCounter(tx, companyInternalId, 'part_no');
  } catch {
    await tx.execute(sql`
      INSERT INTO company_counters (company_id, counter_key, next_value, updated_at)
      VALUES (${companyInternalId}, 'part_no', 2, NOW())
      ON CONFLICT (company_id, counter_key) DO NOTHING
    `);
    return allocateCompanyCounter(tx, companyInternalId, 'part_no');
  }
}

async function getInventoryPartByNo(
  tx: SmartJobTransaction,
  companyInternalId: string,
  partNo: unknown,
) {
  const normalizedPartNo = requireNumericId(partNo, 'partId');
  const rows = await tx
    .select({
      id: inventoryParts.id,
      partNo: inventoryParts.partNo,
      name: inventoryParts.name,
      active: inventoryParts.active,
      lowThreshold: inventoryParts.lowThreshold,
      createdAt: inventoryParts.createdAt,
      updatedAt: inventoryParts.updatedAt,
      archivedAt: inventoryParts.archivedAt,
    })
    .from(inventoryParts)
    .where(and(
      eq(inventoryParts.companyId, companyInternalId),
      eq(inventoryParts.partNo, normalizedPartNo),
    ))
    .limit(1);
  return rows[0] || null;
}

async function getCompanyInventoryPart(
  tx: SmartJobTransaction,
  companyInternalId: string,
  partNo: unknown,
): Promise<InventoryPartSqlRow | null> {
  const normalizedPartNo = requireNumericId(partNo, 'partId');
  const rows = await tx.execute(sql`
    SELECT
      p.id,
      p.part_no,
      p.name,
      p.active,
      p.low_threshold,
      p.created_at,
      p.updated_at,
      p.archived_at,
      b.quantity_on_hand,
      b.location_id
    FROM inventory_parts p
    LEFT JOIN inventory_locations l
      ON l.company_id = p.company_id
      AND l.location_type = 'company'
      AND l.membership_id IS NULL
    LEFT JOIN inventory_balances b
      ON b.part_id = p.id
      AND b.location_id = l.id
    WHERE p.company_id = ${companyInternalId}
      AND p.part_no = ${normalizedPartNo}
    LIMIT 1
  `);
  return mapInventoryPartSqlRow(rows.rows?.[0]);
}

async function getInventoryPartAtLocation(
  tx: SmartJobTransaction,
  companyInternalId: string,
  locationId: string,
  partNo: unknown,
): Promise<InventoryPartSqlRow | null> {
  const normalizedPartNo = requireNumericId(partNo, 'partId');
  const rows = await tx.execute(sql`
    SELECT
      p.id,
      p.part_no,
      p.name,
      p.active,
      p.low_threshold,
      p.created_at,
      p.updated_at,
      p.archived_at,
      b.quantity_on_hand,
      b.location_id
    FROM inventory_parts p
    INNER JOIN inventory_balances b
      ON b.part_id = p.id
      AND b.location_id = ${locationId}
    WHERE p.company_id = ${companyInternalId}
      AND p.part_no = ${normalizedPartNo}
    LIMIT 1
  `);
  return mapInventoryPartSqlRow(rows.rows?.[0]);
}

async function upsertLocationBalance(
  tx: SmartJobTransaction,
  locationId: string,
  partId: string,
  quantity: number,
  now: Date,
) {
  await tx.execute(sql`
    INSERT INTO inventory_balances (location_id, part_id, quantity_on_hand, updated_at)
    VALUES (${locationId}, ${partId}, ${String(quantity)}, ${now})
    ON CONFLICT (location_id, part_id)
    DO UPDATE SET
      quantity_on_hand = EXCLUDED.quantity_on_hand,
      updated_at = EXCLUDED.updated_at
  `);
}

async function addCompanyInventoryPart(
  input: InventoryMutationInput & { createdByUserId: string },
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }
    const location = await getCompanyInventoryLocation(tx, company.id);
    if (!location) {
      const error = new Error('Company inventory location not found');
      setDatabaseErrorCode(error, 'failed-precondition');
      throw error;
    }

    const partNo = await allocateInventoryPartNo(tx, company.id);
    const creatorMembership = await findActiveMembership(tx, input.createdByUserId, company.id);
    const quantity = requireFiniteNonNegative(input.quantity ?? 0, 'quantity');
    const lowThreshold = requireFiniteNonNegative(input.lowThreshold ?? 0, 'lowThreshold');

    const [part] = await tx.insert(inventoryParts).values({
      companyId: company.id,
      partNo,
      name: normalizePartName(input.partName),
      active: input.active !== false,
      lowThreshold: String(lowThreshold),
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }).returning({
      id: inventoryParts.id,
      partNo: inventoryParts.partNo,
    });

    if (!part) {
      throw new Error('Inventory part insert did not return a record');
    }

    await tx.insert(inventoryBalances).values({
      locationId: location.id,
      partId: part.id,
      quantityOnHand: String(quantity),
      updatedAt: now,
    });

    return {
      partId: part.partNo,
      createdByMembershipId: creatorMembership?.id || null,
    };
  });
}

async function updateCompanyInventoryPart(
  input: InventoryMutationInput,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const part = await getCompanyInventoryPart(tx, company.id, input.partId);
    if (!part || part.archived_at) {
      const error = new Error('Inventory part not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const partUpdate: Partial<typeof inventoryParts.$inferInsert> = { updatedAt: now };
    if (input.partName !== undefined) partUpdate.name = normalizePartName(input.partName);
    if (input.lowThreshold !== undefined) partUpdate.lowThreshold = String(requireFiniteNonNegative(input.lowThreshold, 'lowThreshold'));
    if (input.active !== undefined) partUpdate.active = !!input.active;
    await tx.update(inventoryParts).set(partUpdate).where(eq(inventoryParts.id, part.id));

    if (input.quantity !== undefined && part.location_id) {
      await tx.update(inventoryBalances).set({
        quantityOnHand: String(requireFiniteNonNegative(input.quantity, 'quantity')),
        updatedAt: now,
      }).where(and(
        eq(inventoryBalances.locationId, part.location_id),
        eq(inventoryBalances.partId, part.id),
      ));
    }

    return { updated: Number(part.part_no) };
  });
}

async function toggleCompanyInventoryPart(
  input: InventoryMutationInput,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const part = await getCompanyInventoryPart(tx, company.id, input.partId);
    if (!part || part.archived_at) {
      const error = new Error('Inventory part not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    await tx.update(inventoryParts).set({
      active: !part.active,
      updatedAt: now,
    }).where(eq(inventoryParts.id, part.id));

    return { toggled: Number(part.part_no) };
  });
}

async function removeCompanyInventoryPart(
  input: InventoryMutationInput,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const part = await getCompanyInventoryPart(tx, company.id, input.partId);
    if (!part || part.archived_at) {
      const error = new Error('Inventory part not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    if (part.location_id) {
      await tx.delete(inventoryBalances).where(and(
        eq(inventoryBalances.locationId, part.location_id),
        eq(inventoryBalances.partId, part.id),
      ));
    }
    await tx.update(inventoryParts).set({
      archivedAt: now,
      updatedAt: now,
      active: false,
    }).where(eq(inventoryParts.id, part.id));

    return { removed: Number(part.part_no) };
  });
}

async function addUserInventoryPart(
  input: InventoryMutationInput & { targetUid: string },
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const memberLocation = await getMemberInventoryLocation(tx, company.id, input.targetUid);
    const partNo = await allocateInventoryPartNo(tx, company.id);
    const quantity = requireFiniteNonNegative(input.quantity ?? 0, 'quantity');
    const lowThreshold = requireFiniteNonNegative(input.lowThreshold ?? 0, 'lowThreshold');

    const [part] = await tx.insert(inventoryParts).values({
      companyId: company.id,
      partNo,
      name: normalizePartName(input.partName),
      active: input.active !== false,
      lowThreshold: String(lowThreshold),
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }).returning({
      id: inventoryParts.id,
      partNo: inventoryParts.partNo,
    });

    if (!part) {
      throw new Error('Inventory part insert did not return a record');
    }

    await upsertLocationBalance(tx, memberLocation.locationId, part.id, quantity, now);

    return {
      partId: part.partNo,
      membershipId: memberLocation.membershipId,
    };
  });
}

async function updateUserInventoryPart(
  input: InventoryMutationInput & { targetUid: string },
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const memberLocation = await getMemberInventoryLocation(tx, company.id, input.targetUid);
    const part = await getInventoryPartAtLocation(tx, company.id, memberLocation.locationId, input.partId);
    if (!part || part.archived_at) {
      const error = new Error('Inventory part not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const partUpdate: Partial<typeof inventoryParts.$inferInsert> = { updatedAt: now };
    if (input.partName !== undefined) partUpdate.name = normalizePartName(input.partName);
    if (input.lowThreshold !== undefined) partUpdate.lowThreshold = String(requireFiniteNonNegative(input.lowThreshold, 'lowThreshold'));
    if (input.active !== undefined) partUpdate.active = !!input.active;
    await tx.update(inventoryParts).set(partUpdate).where(eq(inventoryParts.id, part.id));

    if (input.quantity !== undefined) {
      await upsertLocationBalance(tx, memberLocation.locationId, part.id, requireFiniteNonNegative(input.quantity, 'quantity'), now);
    }

    return { updated: Number(part.part_no) };
  });
}

async function toggleUserInventoryPart(
  input: InventoryMutationInput & { targetUid: string },
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const memberLocation = await getMemberInventoryLocation(tx, company.id, input.targetUid);
    const part = await getInventoryPartAtLocation(tx, company.id, memberLocation.locationId, input.partId);
    if (!part || part.archived_at) {
      const error = new Error('Inventory part not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    await tx.update(inventoryParts).set({
      active: !part.active,
      updatedAt: now,
    }).where(eq(inventoryParts.id, part.id));

    return { toggled: Number(part.part_no) };
  });
}

async function removeUserInventoryPart(
  input: InventoryMutationInput & { targetUid: string },
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const memberLocation = await getMemberInventoryLocation(tx, company.id, input.targetUid);
    const part = await getInventoryPartAtLocation(tx, company.id, memberLocation.locationId, input.partId);
    if (!part || part.archived_at) {
      const error = new Error('Inventory part not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    await tx.delete(inventoryBalances).where(and(
      eq(inventoryBalances.locationId, memberLocation.locationId),
      eq(inventoryBalances.partId, part.id),
    ));

    await tx.update(inventoryParts).set({
      archivedAt: now,
      updatedAt: now,
      active: false,
    }).where(eq(inventoryParts.id, part.id));

    return { removed: Number(part.part_no) };
  });
}

async function replaceUserInventoryParts(
  input: ReplaceInventoryInput,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const memberLocation = await getMemberInventoryLocation(tx, company.id, input.targetUid);
    const desiredParts = Array.isArray(input.parts) ? input.parts : [];
    const currentRows = await tx.execute(sql`
      SELECT
        p.id,
        p.part_no
      FROM inventory_parts p
      INNER JOIN inventory_balances b
        ON b.part_id = p.id
        AND b.location_id = ${memberLocation.locationId}
      WHERE p.company_id = ${company.id}
        AND p.archived_at IS NULL
    `);

    // Pre-pass: validate and collect all known part IDs for a single batch SELECT.
    type NormalizedEntry = { incomingId: number | null; quantity: number; lowThreshold: number; partName: string; active: boolean };
    const normalizedEntries: NormalizedEntry[] = [];
    for (const rawPart of desiredParts) {
      if (!rawPart || typeof rawPart !== 'object' || Array.isArray(rawPart)) {
        const error = new Error('parts must contain objects only');
        setDatabaseErrorCode(error, 'invalid-argument');
        throw error;
      }
      normalizedEntries.push({
        incomingId: rawPart.id !== undefined && rawPart.id !== null && String(rawPart.id).trim() !== ''
          ? requireNumericId(rawPart.id, 'parts[].id')
          : null,
        quantity: requireFiniteNonNegative(rawPart.quantity ?? 0, 'parts[].quantity'),
        lowThreshold: requireFiniteNonNegative(rawPart.lowThreshold ?? 0, 'parts[].lowThreshold'),
        partName: normalizePartName(rawPart.name, 'parts[].name'),
        active: rawPart.active !== false,
      });
    }

    // Batch-fetch all parts that already exist — one query instead of N.
    const knownIds = [...new Set(normalizedEntries.map((e) => e.incomingId).filter((id) => id !== null))] as number[];
    type ExistingPart = Pick<typeof inventoryParts.$inferSelect, 'id' | 'partNo' | 'archivedAt'>;
    const existingByPartNo = new Map<number, ExistingPart>();
    if (knownIds.length > 0) {
      const existingRows = await tx
        .select({
          id: inventoryParts.id,
          partNo: inventoryParts.partNo,
          archivedAt: inventoryParts.archivedAt,
        })
        .from(inventoryParts)
        .where(and(
          eq(inventoryParts.companyId, company.id),
          inArray(inventoryParts.partNo, knownIds),
        ));
      for (const row of existingRows) {
        existingByPartNo.set(Number(row.partNo), row);
      }
    }

    const seenPartIds = new Set<string>();
    for (const { incomingId, quantity, lowThreshold, partName, active } of normalizedEntries) {
      let part: { id: string; partNo: number; archivedAt?: Date | null } | null = incomingId !== null
        ? (existingByPartNo.get(incomingId) ?? null)
        : null;
      if (part && part.archivedAt) {
        part = null;
      }

      if (!part) {
        const partNo = await allocateInventoryPartNo(tx, company.id);
        const inserted = await tx.insert(inventoryParts).values({
          companyId: company.id,
          partNo,
          name: partName,
          active,
          lowThreshold: String(lowThreshold),
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        }).returning({
          id: inventoryParts.id,
          partNo: inventoryParts.partNo,
        });
        const insertedPart = inserted[0];
        if (!insertedPart) {
          throw new Error('Inventory part insert did not return a record');
        }
        part = {
          id: insertedPart.id,
          partNo: insertedPart.partNo,
        };
      } else {
        await tx.update(inventoryParts).set({
          name: partName,
          active,
          lowThreshold: String(lowThreshold),
          updatedAt: now,
          archivedAt: null,
        }).where(eq(inventoryParts.id, part.id));
      }

      seenPartIds.add(String(part.id));
      await upsertLocationBalance(tx, memberLocation.locationId, part.id, quantity, now);
    }

    for (const value of currentRows.rows || []) {
      const row = value as UnknownRecord;
      if (!seenPartIds.has(String(row.id))) {
        await tx.delete(inventoryBalances).where(and(
          eq(inventoryBalances.locationId, memberLocation.locationId),
          eq(inventoryBalances.partId, String(row.id)),
        ));
      }
    }

    return { replaced: normalizedEntries.length };
  });
}

async function pickCompanyParts(input: PickInventoryInput, options: DatabaseOptions = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const companyLocation = await getCompanyInventoryLocation(tx, company.id);
    const memberLocation = await getMemberInventoryLocation(tx, company.id, input.targetUid);
    const actorMembership = await findActiveMembership(tx, input.createdByUserId, company.id);
    if (!companyLocation) {
      const error = new Error('Company inventory location not found');
      setDatabaseErrorCode(error, 'failed-precondition');
      throw error;
    }

    const picks = Array.isArray(input.partsToPick) ? input.partsToPick : [];
    if (picks.length === 0) {
      const error = new Error('partsToPick array is required');
      setDatabaseErrorCode(error, 'invalid-argument');
      throw error;
    }

    const normalizedPicks = picks.map((pick: PickPart) => ({
      id: requireNumericId(pick.id, 'partsToPick[].id'),
      name: typeof pick.name === 'string' ? pick.name.trim() : '',
      quantity: (() => {
        const numeric = Number(pick.quantity);
        if (!Number.isFinite(numeric) || numeric <= 0) {
          const error = new Error('picked quantity must be a positive finite number');
          setDatabaseErrorCode(error, 'invalid-argument');
          throw error;
        }
        return numeric;
      })(),
    }));

    const requestedPartNos = Array.from(new Set(normalizedPicks.map((pick) => pick.id)));
    const availableRows = await tx.execute(sql`
      SELECT
        p.id,
        p.part_no,
        p.name,
        b.quantity_on_hand
      FROM inventory_parts p
      INNER JOIN inventory_balances b
        ON b.part_id = p.id
        AND b.location_id = ${companyLocation.id}
      WHERE p.company_id = ${company.id}
        AND p.part_no = ANY(${requestedPartNos})
        AND p.archived_at IS NULL
    `);
    const availableByPartNo = new Map<number, UnknownRecord>();
    for (const value of availableRows.rows || []) {
      const row = value as UnknownRecord;
      availableByPartNo.set(Number(row.part_no), row);
    }

    const insufficientParts: Array<{ name: string; requested: number; available: number }> = [];
    for (const pick of normalizedPicks) {
      const available = availableByPartNo.get(pick.id);
      const availableQuantity = Number(available?.quantity_on_hand || 0);
      if (!available || availableQuantity < pick.quantity) {
        insufficientParts.push({
          name: String(available?.name || pick.name || pick.id),
          requested: pick.quantity,
          available: availableQuantity,
        });
      }
    }
    if (insufficientParts.length > 0) {
      const error = new Error(`Insufficient stock for parts: ${insufficientParts.map((part) => `${part.name} (need ${part.requested}, have ${part.available})`).join(', ')}`);
      setDatabaseErrorCode(error, 'failed-precondition');
      throw error;
    }

    const pickPayload = normalizedPicks.map((pick) => {
      const available = availableByPartNo.get(pick.id);
      return {
        part_id: String(available?.id || ''),
        part_no: pick.id,
        quantity: pick.quantity,
      };
    });
    await tx.execute(sql`
      SELECT *
      FROM apply_inventory_pick_batch(
        ${company.id},
        ${companyLocation.id},
        ${memberLocation.locationId},
        ${actorMembership?.id || null},
        ${JSON.stringify(pickPayload)}::jsonb,
        ${now}
      )
    `);

    return { picked: normalizedPicks.length };
  });
}

async function deductUserInventoryPartsInTransaction(
  tx: SmartJobTransaction,
  companyInternalId: string,
  input: Omit<DeductInventoryInput, 'companyId'>,
  now: Date,
) {
  const partsUsed: readonly InventoryUsage[] = Array.isArray(input.partsUsed) ? input.partsUsed : [];
  const targetUid = String(input.targetUid || '').trim();
  if (!targetUid || partsUsed.length === 0) {
    return { deducted: 0 };
  }

  const memberLocation = await getMemberInventoryLocation(tx, companyInternalId, targetUid).catch(() => null);
  if (!memberLocation) {
    return { deducted: 0 };
  }

  const normalizedEntries: Array<{ partNo: number; qty: number }> = [];
  for (const partEntry of partsUsed) {
    const partNo = Number(partEntry?.id);
    const qty = Number(partEntry?.quantity);
    if (!Number.isInteger(partNo) || partNo < 0 || !Number.isFinite(qty) || qty <= 0) {
      continue;
    }
    normalizedEntries.push({ partNo, qty });
  }
  if (normalizedEntries.length === 0) {
    return { deducted: 0 };
  }

  const requestedPartNos = Array.from(new Set(normalizedEntries.map((entry) => entry.partNo)));
  const availableRows = await tx.execute(sql`
    SELECT p.id, p.part_no, b.quantity_on_hand
    FROM inventory_parts p
    INNER JOIN inventory_balances b
      ON b.part_id = p.id AND b.location_id = ${memberLocation.locationId}
    WHERE p.company_id = ${companyInternalId}
      AND p.part_no = ANY(${requestedPartNos})
      AND p.archived_at IS NULL
  `);
  const availableByPartNo = new Map<number, UnknownRecord>();
  for (const value of availableRows.rows || []) {
    const row = value as UnknownRecord;
    availableByPartNo.set(Number(row.part_no), row);
  }

  const consumptionPayload = normalizedEntries
    .map(({ partNo, qty }) => {
      const available = availableByPartNo.get(partNo);
      return available
        ? {
          part_id: String(available.id),
          part_no: partNo,
          quantity: qty,
        }
        : null;
    })
    .filter((entry): entry is { part_id: string; part_no: number; quantity: number } => entry !== null);

  if (consumptionPayload.length === 0) {
    return { deducted: 0 };
  }

  const result = await tx.execute(sql`
    SELECT *
    FROM apply_job_inventory_consumption_batch(
      ${companyInternalId},
      ${memberLocation.membershipId},
      ${input.jobId || null},
      ${memberLocation.membershipId},
      ${JSON.stringify(consumptionPayload)}::jsonb,
      ${now}
    )
  `);

  return { deducted: Number(result.rows?.length || 0) };
}

/**
 * Deduct consumed parts from a member's inventory balance (used when a solo/user finishes a job).
 * Silently skips parts not found at the member's location — matches the graceful Firestore behaviour.
 */
async function deductUserInventoryParts(
  input: DeductInventoryInput,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  const partsUsed: readonly InventoryUsage[] = Array.isArray(input.partsUsed) ? input.partsUsed : [];
  if (!String(input.targetUid || '').trim() || partsUsed.length === 0) {
    return { deducted: 0 };
  }

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      return { deducted: 0 };
    }
    return deductUserInventoryPartsInTransaction(tx, company.id, input, now);
  });
}

export { addCompanyInventoryPart, addUserInventoryPart, deductUserInventoryParts, deductUserInventoryPartsInTransaction, pickCompanyParts, removeCompanyInventoryPart, removeUserInventoryPart, replaceUserInventoryParts, toggleCompanyInventoryPart, toggleUserInventoryPart, updateCompanyInventoryPart, updateUserInventoryPart };

