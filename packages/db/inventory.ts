import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from './client';

const {
  companyMemberships,
  inventoryBalances,
  inventoryLocations,
  inventoryMovements,
  inventoryParts,
} = require('./schema');
const {
  allocateCompanyCounter,
  findActiveMembership,
  resolveCompanyByPublicId,
} = require('./membership');

function asDate(value, fallback) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function requireNumericId(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    const error = new Error(`${fieldName} is required`);
    (error as any).code = 'invalid-argument';
    throw error;
  }
  return numeric;
}

function requireFiniteNonNegative(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    const error = new Error(`${fieldName} must be a non-negative finite number`);
    (error as any).code = 'invalid-argument';
    throw error;
  }
  return numeric;
}

function normalizePartName(value, fieldName = 'partName') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    const error = new Error(`${fieldName} is required`);
    (error as any).code = 'invalid-argument';
    throw error;
  }
  if (normalized.length > 120) {
    const error = new Error(`${fieldName} exceeds 120 characters`);
    (error as any).code = 'invalid-argument';
    throw error;
  }
  return normalized;
}

async function getCompanyInventoryLocation(tx, companyInternalId) {
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

async function getMemberInventoryLocation(tx, companyInternalId, targetUid) {
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
    (error as any).code = 'not-found';
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
    (error as any).code = 'failed-precondition';
    throw error;
  }

  return {
    membershipId: membership.id,
    memberNo: membership.memberNo,
    locationId: location.id,
  };
}

async function lockCompanyInventoryPartAllocation(tx, companyInternalId) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`inventory_part_no:${companyInternalId}`}))`);
}

async function allocateInventoryPartNo(tx, companyInternalId) {
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

async function getInventoryPartByNo(tx, companyInternalId, partNo) {
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

async function getCompanyInventoryPart(tx, companyInternalId, partNo) {
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
  return rows.rows?.[0] || null;
}

async function getInventoryPartAtLocation(tx, companyInternalId, locationId, partNo) {
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
  return rows.rows?.[0] || null;
}

async function upsertLocationBalance(tx, locationId, partId, quantity, now) {
  await tx.execute(sql`
    INSERT INTO inventory_balances (location_id, part_id, quantity_on_hand, updated_at)
    VALUES (${locationId}, ${partId}, ${String(quantity)}, ${now})
    ON CONFLICT (location_id, part_id)
    DO UPDATE SET
      quantity_on_hand = EXCLUDED.quantity_on_hand,
      updated_at = EXCLUDED.updated_at
  `);
}

async function incrementLocationBalance(tx, locationId, partId, quantity, now) {
  await tx.execute(sql`
    INSERT INTO inventory_balances (location_id, part_id, quantity_on_hand, updated_at)
    VALUES (${locationId}, ${partId}, ${String(quantity)}, ${now})
    ON CONFLICT (location_id, part_id)
    DO UPDATE SET
      quantity_on_hand = inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
      updated_at = EXCLUDED.updated_at
  `);
}

async function createInventoryMovement(tx, input) {
  await tx.insert(inventoryMovements).values({
    companyId: input.companyId,
    partId: input.partId,
    quantity: String(input.quantity),
    fromLocationId: input.fromLocationId || null,
    toLocationId: input.toLocationId || null,
    movementType: input.movementType,
    jobId: input.jobId || null,
    documentId: input.documentId || null,
    createdByMembershipId: input.createdByMembershipId || null,
    idempotencyKey: input.idempotencyKey || null,
    note: input.note || null,
    createdAt: input.createdAt,
  });
}

async function addCompanyInventoryPart(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }
    const location = await getCompanyInventoryLocation(tx, company.id);
    if (!location) {
      const error = new Error('Company inventory location not found');
      (error as any).code = 'failed-precondition';
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

async function updateCompanyInventoryPart(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const part = await getCompanyInventoryPart(tx, company.id, input.partId);
    if (!part || part.archived_at) {
      const error = new Error('Inventory part not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const partUpdate: Record<string, any> = { updatedAt: now };
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

async function toggleCompanyInventoryPart(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const part = await getCompanyInventoryPart(tx, company.id, input.partId);
    if (!part || part.archived_at) {
      const error = new Error('Inventory part not found');
      (error as any).code = 'not-found';
      throw error;
    }

    await tx.update(inventoryParts).set({
      active: !part.active,
      updatedAt: now,
    }).where(eq(inventoryParts.id, part.id));

    return { toggled: Number(part.part_no) };
  });
}

async function removeCompanyInventoryPart(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const part = await getCompanyInventoryPart(tx, company.id, input.partId);
    if (!part || part.archived_at) {
      const error = new Error('Inventory part not found');
      (error as any).code = 'not-found';
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

async function addUserInventoryPart(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
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

    await upsertLocationBalance(tx, memberLocation.locationId, part.id, quantity, now);

    return {
      partId: part.partNo,
      membershipId: memberLocation.membershipId,
    };
  });
}

async function updateUserInventoryPart(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const memberLocation = await getMemberInventoryLocation(tx, company.id, input.targetUid);
    const part = await getInventoryPartAtLocation(tx, company.id, memberLocation.locationId, input.partId);
    if (!part || part.archived_at) {
      const error = new Error('Inventory part not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const partUpdate: Record<string, any> = { updatedAt: now };
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

async function toggleUserInventoryPart(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const memberLocation = await getMemberInventoryLocation(tx, company.id, input.targetUid);
    const part = await getInventoryPartAtLocation(tx, company.id, memberLocation.locationId, input.partId);
    if (!part || part.archived_at) {
      const error = new Error('Inventory part not found');
      (error as any).code = 'not-found';
      throw error;
    }

    await tx.update(inventoryParts).set({
      active: !part.active,
      updatedAt: now,
    }).where(eq(inventoryParts.id, part.id));

    return { toggled: Number(part.part_no) };
  });
}

async function removeUserInventoryPart(input, options: any = {}) {
  const db = options.db || getDb(options.env);

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const memberLocation = await getMemberInventoryLocation(tx, company.id, input.targetUid);
    const part = await getInventoryPartAtLocation(tx, company.id, memberLocation.locationId, input.partId);
    if (!part) {
      const error = new Error('Inventory part not found');
      (error as any).code = 'not-found';
      throw error;
    }

    await tx.delete(inventoryBalances).where(and(
      eq(inventoryBalances.locationId, memberLocation.locationId),
      eq(inventoryBalances.partId, part.id),
    ));

    return { removed: Number(part.part_no) };
  });
}

async function replaceUserInventoryParts(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
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
        (error as any).code = 'invalid-argument';
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
    const existingByPartNo = new Map<number, any>();
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

    const seenPartIds = new Set();
    for (const { incomingId, quantity, lowThreshold, partName, active } of normalizedEntries) {
      let part: any = incomingId !== null ? (existingByPartNo.get(incomingId) ?? null) : null;
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
        part = {
          id: inserted[0].id,
          partNo: inserted[0].partNo,
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

    for (const row of currentRows.rows || []) {
      if (!seenPartIds.has(String(row.id))) {
        await tx.delete(inventoryBalances).where(and(
          eq(inventoryBalances.locationId, memberLocation.locationId),
          eq(inventoryBalances.partId, row.id),
        ));
      }
    }

    return { replaced: normalizedEntries.length };
  });
}

async function pickCompanyParts(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const companyLocation = await getCompanyInventoryLocation(tx, company.id);
    const memberLocation = await getMemberInventoryLocation(tx, company.id, input.targetUid);
    const actorMembership = await findActiveMembership(tx, input.createdByUserId, company.id);
    if (!companyLocation) {
      const error = new Error('Company inventory location not found');
      (error as any).code = 'failed-precondition';
      throw error;
    }

    const picks = Array.isArray(input.partsToPick) ? input.partsToPick : [];
    if (picks.length === 0) {
      const error = new Error('partsToPick array is required');
      (error as any).code = 'invalid-argument';
      throw error;
    }

    const normalizedPicks = picks.map((pick) => ({
      id: requireNumericId(pick?.id, 'partsToPick[].id'),
      name: typeof pick?.name === 'string' ? pick.name.trim() : '',
      quantity: (() => {
        const numeric = Number(pick?.quantity);
        if (!Number.isFinite(numeric) || numeric <= 0) {
          const error = new Error('picked quantity must be a positive finite number');
          (error as any).code = 'invalid-argument';
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
    const availableByPartNo = new Map();
    for (const row of availableRows.rows || []) {
      availableByPartNo.set(Number(row.part_no), row);
    }

    const insufficientParts = [];
    for (const pick of normalizedPicks) {
      const available = availableByPartNo.get(pick.id);
      const availableQuantity = Number(available?.quantity_on_hand || 0);
      if (!available || availableQuantity < pick.quantity) {
        insufficientParts.push({
          name: available?.name || pick.name || String(pick.id),
          requested: pick.quantity,
          available: availableQuantity,
        });
      }
    }
    if (insufficientParts.length > 0) {
      const error = new Error(`Insufficient stock for parts: ${insufficientParts.map((part) => `${part.name} (need ${part.requested}, have ${part.available})`).join(', ')}`);
      (error as any).code = 'failed-precondition';
      throw error;
    }

    for (const pick of normalizedPicks) {
      const available = availableByPartNo.get(pick.id);
      const remaining = Number(available.quantity_on_hand || 0) - pick.quantity;
      await tx.update(inventoryBalances).set({
        quantityOnHand: String(remaining),
        updatedAt: now,
      }).where(and(
        eq(inventoryBalances.locationId, companyLocation.id),
        eq(inventoryBalances.partId, available.id),
      ));

      await incrementLocationBalance(tx, memberLocation.locationId, available.id, pick.quantity, now);
      await createInventoryMovement(tx, {
        companyId: company.id,
        partId: available.id,
        quantity: pick.quantity,
        fromLocationId: companyLocation.id,
        toLocationId: memberLocation.locationId,
        movementType: 'pick',
        createdByMembershipId: actorMembership?.id || null,
        createdAt: now,
        note: `Picked part #${pick.id}`,
      });
    }

    return { picked: normalizedPicks.length };
  });
}

async function deductUserInventoryPartsInTransaction(tx, companyInternalId, input, now) {
  const partsUsed: Array<{ id: any; quantity: any }> = Array.isArray(input.partsUsed) ? input.partsUsed : [];
  if (!String(input.targetUid || '').trim() || partsUsed.length === 0) {
    return { deducted: 0 };
  }

  const memberLocation = await getMemberInventoryLocation(tx, companyInternalId, input.targetUid).catch(() => null);
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
  const availableByPartNo = new Map<number, any>();
  for (const row of availableRows.rows || []) {
    availableByPartNo.set(Number(row.part_no), row);
  }

  let deducted = 0;
  for (const { partNo, qty } of normalizedEntries) {
    const available = availableByPartNo.get(partNo);
    if (!available) continue;

    const availableQty = Number(available.quantity_on_hand || 0);
    if (availableQty < qty) {
      const error = new Error(`Insufficient stock for part #${partNo}`);
      (error as any).code = 'failed-precondition';
      throw error;
    }
    const newQty = availableQty - qty;
    await tx
      .update(inventoryBalances)
      .set({ quantityOnHand: String(newQty), updatedAt: now })
      .where(and(
        eq(inventoryBalances.locationId, memberLocation.locationId),
        eq(inventoryBalances.partId, available.id),
      ));
    deducted++;
  }

  return { deducted };
}

/**
 * Deduct consumed parts from a member's inventory balance (used when a solo/user finishes a job).
 * Silently skips parts not found at the member's location — matches the graceful Firestore behaviour.
 */
async function deductUserInventoryParts(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  const partsUsed: Array<{ id: any; quantity: any }> = Array.isArray(input.partsUsed) ? input.partsUsed : [];
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

