/**
 * Inventory Handler Module
 * Phase: 2 | Status: Implemented
 */
import {
  allocateNextCompanyCounter,
  EdgeFunctionContext,
  createSupabaseClient,
  optionalTrimmedString,
  requireNonEmptyString,
  resolveCompanyIdentifiers,
  validateCompanyId,
} from "../shared-edge-helpers.ts";

const MAX_PARTS_UPDATES = 300;
const MAX_MOVEMENTS_UPDATES = 500;

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolvePartRecord(
  supabase: ReturnType<typeof createSupabaseClient>,
  companyId: string,
  rawPartId: unknown,
): Promise<any | null> {
  if (typeof rawPartId === "string" && rawPartId.trim().length > 0) {
    const normalized = rawPartId.trim();
    if (isUuidLike(normalized)) {
      const { data } = await supabase
        .from("inventory_parts")
        .select("id, part_no, name, active, low_threshold, unit")
        .eq("company_id", companyId)
        .eq("id", normalized)
        .maybeSingle();
      if (data) return data;
    }
    if (/^\d+$/.test(normalized)) {
      const { data } = await supabase
        .from("inventory_parts")
        .select("id, part_no, name, active, low_threshold, unit")
        .eq("company_id", companyId)
        .eq("part_no", Number(normalized))
        .maybeSingle();
      if (data) return data;
    }
    return null;
  }

  if (typeof rawPartId === "number" && Number.isFinite(rawPartId)) {
    const { data } = await supabase
      .from("inventory_parts")
      .select("id, part_no, name, active, low_threshold, unit")
      .eq("company_id", companyId)
      .eq("part_no", rawPartId)
      .maybeSingle();
    return data ?? null;
  }

  return null;
}

async function resolveTargetMembershipId(
  supabase: ReturnType<typeof createSupabaseClient>,
  companyId: string,
  targetUid: string,
): Promise<string | null> {
  const { data: membership, error } = await supabase
    .from("company_memberships")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", targetUid)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw { code: "internal", message: "Failed to load target membership", httpStatus: 500 };
  }
  return membership?.id ? String(membership.id) : null;
}

async function ensureMemberLocation(
  supabase: ReturnType<typeof createSupabaseClient>,
  companyId: string,
  membershipId: string,
  fallbackName: string,
): Promise<string> {
  const { data: existingLocation, error: locationError } = await supabase
    .from("inventory_locations")
    .select("id")
    .eq("company_id", companyId)
    .eq("location_type", "member")
    .eq("membership_id", membershipId)
    .maybeSingle();

  if (locationError) {
    throw { code: "internal", message: "Failed to load member inventory location", httpStatus: 500 };
  }
  if (existingLocation?.id) {
    return String(existingLocation.id);
  }

  const { data: insertedLocation, error: insertLocationError } = await supabase
    .from("inventory_locations")
    .insert({
      company_id: companyId,
      location_type: "member",
      membership_id: membershipId,
      name: fallbackName,
    })
    .select("id")
    .single();

  if (insertLocationError || !insertedLocation?.id) {
    throw { code: "internal", message: "Failed to create member inventory location", httpStatus: 500 };
  }
  return String(insertedLocation.id);
}

async function requireCompanyLocationRecord(
  supabase: ReturnType<typeof createSupabaseClient>,
  companyId: string,
  locationId: string,
): Promise<{ id: string; location_type: string; membership_id: string | null }> {
  const { data: location, error } = await supabase
    .from("inventory_locations")
    .select("id, location_type, membership_id")
    .eq("company_id", companyId)
    .eq("id", locationId)
    .maybeSingle();

  if (error) {
    throw { code: "internal", message: "Failed to load inventory location", httpStatus: 500 };
  }
  if (!location?.id) {
    throw { code: "not-found", message: "Inventory location not found", httpStatus: 404 };
  }

  return {
    id: String(location.id),
    location_type: String(location.location_type || ""),
    membership_id: location.membership_id ? String(location.membership_id) : null,
  };
}

async function getBalanceQuantity(
  supabase: ReturnType<typeof createSupabaseClient>,
  locationId: string,
  partId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("inventory_balances")
    .select("quantity_on_hand")
    .eq("location_id", locationId)
    .eq("part_id", partId)
    .maybeSingle();

  if (error) {
    throw { code: "internal", message: "Failed to load inventory balance", httpStatus: 500 };
  }
  return Number(data?.quantity_on_hand || 0);
}

async function setBalanceQuantity(
  supabase: ReturnType<typeof createSupabaseClient>,
  locationId: string,
  partId: string,
  quantity: number,
  now: string,
): Promise<void> {
  const normalizedQuantity = Math.max(0, quantity);
  const { error } = await supabase
    .from("inventory_balances")
    .upsert(
      {
        location_id: locationId,
        part_id: partId,
        quantity_on_hand: normalizedQuantity,
        updated_at: now,
      },
      { onConflict: "location_id,part_id" },
    );

  if (error) {
    throw { code: "internal", message: "Failed to update inventory balance", httpStatus: 500 };
  }
}

async function incrementBalanceQuantity(
  supabase: ReturnType<typeof createSupabaseClient>,
  locationId: string,
  partId: string,
  delta: number,
  now: string,
): Promise<number> {
  const nextQuantity = Math.max(0, await getBalanceQuantity(supabase, locationId, partId) + delta);
  await setBalanceQuantity(supabase, locationId, partId, nextQuantity, now);
  return nextQuantity;
}

async function deleteBalanceEntry(
  supabase: ReturnType<typeof createSupabaseClient>,
  locationId: string,
  partId: string,
): Promise<void> {
  const { error } = await supabase
    .from("inventory_balances")
    .delete()
    .eq("location_id", locationId)
    .eq("part_id", partId);

  if (error) {
    throw { code: "internal", message: "Failed to delete inventory balance", httpStatus: 500 };
  }
}

async function hasBalanceEntry(
  supabase: ReturnType<typeof createSupabaseClient>,
  locationId: string,
  partId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("inventory_balances")
    .select("part_id")
    .eq("location_id", locationId)
    .eq("part_id", partId)
    .maybeSingle();

  if (error) {
    throw { code: "internal", message: "Failed to load inventory balance entry", httpStatus: 500 };
  }
  return Boolean(data?.part_id);
}

export async function updateInventoryV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  const partsInput = Array.isArray(payload?.parts) ? payload.parts : [];
  const movementsInput = Array.isArray(payload?.movements) ? payload.movements : [];
  if (partsInput.length > MAX_PARTS_UPDATES) {
    throw { code: "invalid-argument", message: `parts exceeds max length (${MAX_PARTS_UPDATES})`, httpStatus: 400 };
  }
  if (movementsInput.length > MAX_MOVEMENTS_UPDATES) {
    throw { code: "invalid-argument", message: `movements exceeds max length (${MAX_MOVEMENTS_UPDATES})`, httpStatus: 400 };
  }

  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();

  const { data: membership, error: membershipError } = await supabase
    .from("company_memberships")
    .select("id, role")
    .eq("company_id", companyId)
    .eq("user_id", ctx.auth.uid)
    .eq("status", "active")
    .single();

  if (membershipError || !membership) {
    throw { code: "permission-denied", message: "Not allowed for this company", httpStatus: 403 };
  }

  const requesterRole = String(membership.role || "").toLowerCase();
  const requesterIsManager = requesterRole === "manager";

  const requireManagerInventoryAccess = (message = "Manager role required for company inventory changes") => {
    if (!requesterIsManager) {
      throw { code: "permission-denied", message, httpStatus: 403 };
    }
  };

  const { data: companyLocation, error: locationError } = await supabase
    .from("inventory_locations")
    .select("id")
    .eq("company_id", companyId)
    .eq("location_type", "company")
    .is("membership_id", null)
    .maybeSingle();

  if (locationError) {
    throw { code: "internal", message: "Failed to load inventory location", httpStatus: 500 };
  }

  let companyLocationId = companyLocation?.id;
  if (!companyLocationId) {
    const { data: insertedLocation, error: insertLocationError } = await supabase
      .from("inventory_locations")
      .insert({
        company_id: companyId,
        location_type: "company",
        membership_id: null,
        name: "Company Inventory",
      })
      .select("id")
      .single();

    if (insertLocationError || !insertedLocation) {
      throw { code: "internal", message: "Failed to create inventory location", httpStatus: 500 };
    }
    companyLocationId = insertedLocation.id;
  }

  const action = optionalTrimmedString(payload?.action, 40);
  const scope = optionalTrimmedString(payload?.scope, 16) || "company";
  const targetUid = optionalTrimmedString(payload?.targetUid, 200);

  const bumpInventoryVersion = async () => {
    const { data: syncState, error: syncStateError } = await supabase
      .from("company_sync_state")
      .select("company_inventory_version")
      .eq("company_id", companyId)
      .maybeSingle();

    if (!syncStateError) {
      if (!syncState) {
        await supabase.from("company_sync_state").insert({
          company_id: companyId,
          company_inventory_version: 1,
          updated_at: now,
        });
      } else {
        const nextVersion = Number(syncState.company_inventory_version || 0) + 1;
        await supabase
          .from("company_sync_state")
          .update({ company_inventory_version: nextVersion, updated_at: now })
          .eq("company_id", companyId);
      }
    }
  };

  const parseNonNegativeNumber = (value: unknown, fieldName: string) => {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw { code: "invalid-argument", message: `${fieldName} must be a finite non-negative number`, httpStatus: 400 };
    }
    return numeric;
  };

  if (action) {
    let targetMembershipId: string | null = null;
    let targetLocationId: string | null = null;
    const requiresTargetUser = scope === "user" || action === "pickParts";
    if (requiresTargetUser) {
      if (!targetUid) {
        throw { code: "invalid-argument", message: "targetUid is required for this inventory action", httpStatus: 400 };
      }
      if (targetUid !== ctx.auth.uid) {
        requireManagerInventoryAccess("Manager role required to manage another member inventory");
      }
      targetMembershipId = await resolveTargetMembershipId(supabase, companyId, targetUid);
      if (!targetMembershipId) {
        throw { code: "not-found", message: "Target membership not found", httpStatus: 404 };
      }
      targetLocationId = await ensureMemberLocation(supabase, companyId, targetMembershipId, `Member ${targetMembershipId}`);
    }

    if (scope === "company" || action === "pickParts") {
      requireManagerInventoryAccess();
    }

    const resolveScopedPart = async () => {
      const part = await resolvePartRecord(supabase, companyId, payload?.partId);
      if (!part) {
        throw { code: "not-found", message: "Part not found", httpStatus: 404 };
      }
      if (scope === "user" && !(await hasBalanceEntry(supabase, targetLocationId!, String(part.id)))) {
        throw { code: "not-found", message: "Part not found", httpStatus: 404 };
      }
      return part;
    };

    if (action === "addPart") {
      const partName = requireNonEmptyString(payload?.partName, "partName", 1, 240);
      const quantity = parseNonNegativeNumber(payload?.quantity, "quantity");
      const lowThreshold = parseNonNegativeNumber(payload?.lowThreshold, "lowThreshold");
      const allocatedPartNo = await allocateNextCompanyCounter(companyId, "part_no", ctx);
      const { data: insertedPart, error: insertPartError } = await supabase
        .from("inventory_parts")
        .insert({
          company_id: companyId,
          part_no: allocatedPartNo,
          name: partName,
          active: payload?.active === undefined ? true : Boolean(payload.active),
          low_threshold: lowThreshold,
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .select("id, part_no, name, active, low_threshold, unit")
        .single();

      if (insertPartError || !insertedPart?.id) {
        throw { code: "internal", message: "Failed to insert inventory part", httpStatus: 500 };
      }

      await setBalanceQuantity(
        supabase,
        scope === "user" ? targetLocationId! : companyLocationId,
        String(insertedPart.id),
        quantity,
        now,
      );
      await bumpInventoryVersion();
      return {
        success: true,
        partId: Number(insertedPart.part_no || 0),
        parts: [{
          id: Number(insertedPart.part_no || 0),
          name: insertedPart.name,
          quantity,
          lowThreshold: Number(insertedPart.low_threshold || 0),
          unit: insertedPart.unit ?? undefined,
          active: Boolean(insertedPart.active),
        }],
        movements: [],
        updatedAt: now,
      };
    }

    if (action === "updatePart") {
      const part = await resolveScopedPart();
      const nextName = payload?.partName === undefined ? String(part.name || "") : requireNonEmptyString(payload?.partName, "partName", 1, 240);
      const nextLowThreshold = payload?.lowThreshold === undefined
        ? Number(part.low_threshold || 0)
        : parseNonNegativeNumber(payload?.lowThreshold, "lowThreshold");
      const nextActive = payload?.active === undefined ? Boolean(part.active) : Boolean(payload.active);

      const { data: updatedPart, error: updatePartError } = await supabase
        .from("inventory_parts")
        .update({
          name: nextName,
          active: nextActive,
          low_threshold: nextLowThreshold,
          updated_at: now,
          archived_at: nextActive ? null : now,
        })
        .eq("company_id", companyId)
        .eq("id", part.id)
        .select("id, part_no, name, active, low_threshold, unit")
        .single();

      if (updatePartError || !updatedPart?.id) {
        throw { code: "internal", message: "Failed to update inventory part", httpStatus: 500 };
      }

      const balanceLocationId = scope === "user" ? targetLocationId! : companyLocationId;
      const quantity = payload?.quantity === undefined
        ? await getBalanceQuantity(supabase, balanceLocationId, String(updatedPart.id))
        : parseNonNegativeNumber(payload?.quantity, "quantity");
      if (payload?.quantity !== undefined) {
        await setBalanceQuantity(supabase, balanceLocationId, String(updatedPart.id), quantity, now);
      }

      await bumpInventoryVersion();
      return {
        success: true,
        updated: Number(updatedPart.part_no || 0),
        updatedAt: now,
      };
    }

    if (action === "togglePart") {
      const part = await resolveScopedPart();
      const nextActive = !Boolean(part.active);
      const { error: toggleError } = await supabase
        .from("inventory_parts")
        .update({
          active: nextActive,
          updated_at: now,
          archived_at: nextActive ? null : now,
        })
        .eq("company_id", companyId)
        .eq("id", part.id);

      if (toggleError) {
        throw { code: "internal", message: "Failed to toggle inventory part", httpStatus: 500 };
      }

      await bumpInventoryVersion();
      return {
        success: true,
        toggled: Number(part.part_no || 0),
        updatedAt: now,
      };
    }

    if (action === "removePart") {
      const part = await resolveScopedPart();

      if (scope === "user") {
        await deleteBalanceEntry(supabase, targetLocationId!, String(part.id));
      } else {
        await deleteBalanceEntry(supabase, companyLocationId, String(part.id));
        const { error: archiveError } = await supabase
          .from("inventory_parts")
          .update({
            active: false,
            archived_at: now,
            updated_at: now,
          })
          .eq("company_id", companyId)
          .eq("id", part.id);

        if (archiveError) {
          throw { code: "internal", message: "Failed to remove inventory part", httpStatus: 500 };
        }
      }

      await bumpInventoryVersion();
      return {
        success: true,
        removed: Number(part.part_no || 0),
        updatedAt: now,
      };
    }

    if (action === "replaceParts" && scope === "user") {
      const desiredParts = Array.isArray(payload?.parts) ? payload.parts : [];
      const normalizedEntries: Array<{
        incomingId: number | null;
        quantity: number;
        lowThreshold: number;
        partName: string;
        active: boolean;
      }> = desiredParts.map((rawPart: any) => ({
        incomingId: rawPart?.id !== undefined && rawPart?.id !== null && String(rawPart.id).trim() !== ""
          ? Number(rawPart.id)
          : null,
        quantity: parseNonNegativeNumber(rawPart?.quantity, "parts[].quantity"),
        lowThreshold: parseNonNegativeNumber(rawPart?.lowThreshold, "parts[].lowThreshold"),
        partName: requireNonEmptyString(rawPart?.name, "parts[].name", 1, 240),
        active: rawPart?.active === false ? false : true,
      }));

      const knownIds = [...new Set(
        normalizedEntries
          .map((entry: { incomingId: number | null }) => entry.incomingId)
          .filter((entry: number | null): entry is number => entry !== null),
      )];
      const existingByPartNo = new Map<number, any>();
      if (knownIds.length > 0) {
        const { data: existingRows, error: existingError } = await supabase
          .from("inventory_parts")
          .select("id, part_no, archived_at")
          .eq("company_id", companyId)
          .in("part_no", knownIds);

        if (existingError) {
          throw { code: "internal", message: "Failed to load existing user inventory parts", httpStatus: 500 };
        }

        for (const row of existingRows || []) {
          existingByPartNo.set(Number(row.part_no || 0), row);
        }
      }

      const { data: currentBalances, error: currentBalancesError } = await supabase
        .from("inventory_balances")
        .select("part_id")
        .eq("location_id", targetLocationId!);

      if (currentBalancesError) {
        throw { code: "internal", message: "Failed to load current user inventory balances", httpStatus: 500 };
      }

      const seenPartIds = new Set<string>();
      for (const entry of normalizedEntries) {
        let part = entry.incomingId !== null ? existingByPartNo.get(entry.incomingId) ?? null : null;
        if (part && part.archived_at) {
          part = null;
        }

        if (!part) {
          const partNo = await allocateNextCompanyCounter(companyId, "part_no", ctx);
          const { data: insertedPart, error: insertPartError } = await supabase
            .from("inventory_parts")
            .insert({
              company_id: companyId,
              part_no: partNo,
              name: entry.partName,
              active: entry.active,
              low_threshold: entry.lowThreshold,
              created_at: now,
              updated_at: now,
              archived_at: null,
            })
            .select("id, part_no")
            .single();

          if (insertPartError || !insertedPart?.id) {
            throw { code: "internal", message: "Failed to insert user inventory part", httpStatus: 500 };
          }
          part = insertedPart;
        } else {
          const { error: updatePartError } = await supabase
            .from("inventory_parts")
            .update({
              name: entry.partName,
              active: entry.active,
              low_threshold: entry.lowThreshold,
              updated_at: now,
              archived_at: null,
            })
            .eq("company_id", companyId)
            .eq("id", part.id);

          if (updatePartError) {
            throw { code: "internal", message: "Failed to update user inventory part", httpStatus: 500 };
          }
        }

        seenPartIds.add(String(part.id));
        await setBalanceQuantity(supabase, targetLocationId!, String(part.id), entry.quantity, now);
      }

      for (const row of currentBalances || []) {
        if (!seenPartIds.has(String(row.part_id))) {
          await deleteBalanceEntry(supabase, targetLocationId!, String(row.part_id));
        }
      }

      await bumpInventoryVersion();
      return {
        success: true,
        replaced: normalizedEntries.length,
        updatedAt: now,
      };
    }

    if (action === "pickParts") {
      if (!targetLocationId) {
        throw { code: "invalid-argument", message: "targetUid is required for pickParts", httpStatus: 400 };
      }

      const picks = Array.isArray(payload?.partsToPick) ? payload.partsToPick : [];
      if (picks.length === 0) {
        throw { code: "invalid-argument", message: "partsToPick array is required", httpStatus: 400 };
      }

      const insertedMovements: any[] = [];
      for (const pick of picks) {
        const pickQty = Number(pick?.quantity);
        if (!Number.isFinite(pickQty) || pickQty <= 0) {
          throw { code: "invalid-argument", message: "picked quantity must be a positive finite number", httpStatus: 400 };
        }

        const part = await resolvePartRecord(supabase, companyId, pick?.id);
        if (!part?.id) {
          throw { code: "not-found", message: "Inventory part not found", httpStatus: 404 };
        }

        const companyQuantity = await getBalanceQuantity(supabase, companyLocationId, String(part.id));
        if (companyQuantity < pickQty) {
          throw { code: "failed-precondition", message: "Insufficient stock for movement", httpStatus: 400 };
        }

        await setBalanceQuantity(supabase, companyLocationId, String(part.id), companyQuantity - pickQty, now);
        await incrementBalanceQuantity(supabase, targetLocationId, String(part.id), pickQty, now);

        const { data: insertedMovement, error: movementError } = await supabase
          .from("inventory_movements")
          .insert({
            company_id: companyId,
            part_id: part.id,
            quantity: pickQty,
            from_location_id: companyLocationId,
            to_location_id: targetLocationId,
            movement_type: "pick",
            created_by_membership_id: membership.id,
            note: `Picked part #${Number(part.part_no || 0)}`,
            created_at: now,
          })
          .select("id, quantity, from_location_id, to_location_id, movement_type, created_at")
          .single();

        if (movementError || !insertedMovement?.id) {
          throw { code: "internal", message: "Failed to record movement", httpStatus: 500 };
        }

        insertedMovements.push({
          id: insertedMovement.id,
          fromLocationId: insertedMovement.from_location_id ?? undefined,
          toLocationId: insertedMovement.to_location_id ?? undefined,
          partId: Number(part.part_no || 0),
          quantity: Number(insertedMovement.quantity),
          movementType: insertedMovement.movement_type,
          createdAt: insertedMovement.created_at,
        });
      }

      await bumpInventoryVersion();
      return {
        success: true,
        picked: insertedMovements.length,
        movements: insertedMovements,
        updatedAt: now,
      };
    }

    throw { code: "invalid-argument", message: `Unsupported inventory action: ${action}`, httpStatus: 400 };
  }

  const normalizedPayload = { parts: partsInput, movements: movementsInput };

  requireManagerInventoryAccess();

  const updatedParts: any[] = [];

  for (const part of normalizedPayload.parts) {
    const partName = requireNonEmptyString(part?.name, "parts.name", 1, 240);
    const quantity = Number(part?.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw { code: "invalid-argument", message: "parts.quantity must be a finite non-negative number", httpStatus: 400 };
    }
    const lowThresholdRaw = part?.lowThreshold;
    const lowThreshold = lowThresholdRaw === undefined || lowThresholdRaw === null ? 0 : Number(lowThresholdRaw);
    if (!Number.isFinite(lowThreshold) || lowThreshold < 0) {
      throw { code: "invalid-argument", message: "parts.lowThreshold must be a finite non-negative number", httpStatus: 400 };
    }

    const unit = optionalTrimmedString(part?.unit, 40);
    const active = part?.active === undefined ? true : Boolean(part.active);

    const rawId = part?.id;
    const existingPart = await resolvePartRecord(supabase, companyId, rawId);

    let targetPart: any;
    if (existingPart) {
      const { data: updatedPart, error: updatePartError } = await supabase
        .from("inventory_parts")
        .update({
          name: partName,
          active,
          low_threshold: lowThreshold,
          unit,
          updated_at: now,
          archived_at: active ? null : now,
        })
        .eq("id", existingPart.id)
        .eq("company_id", companyId)
        .select("id, part_no, name, active, low_threshold, unit")
        .single();

      if (updatePartError || !updatedPart) {
        throw { code: "internal", message: "Failed to update inventory part", httpStatus: 500 };
      }
      targetPart = updatedPart;
    } else {
      const allocatedPartNo = await allocateNextCompanyCounter(companyId, "part_no", ctx);
      const { data: insertedPart, error: insertPartError } = await supabase
        .from("inventory_parts")
        .insert({
          company_id: companyId,
          part_no: allocatedPartNo,
          name: partName,
          active,
          low_threshold: lowThreshold,
          unit,
          created_at: now,
          updated_at: now,
          archived_at: active ? null : now,
        })
        .select("id, part_no, name, active, low_threshold, unit")
        .single();

      if (insertPartError || !insertedPart) {
        throw { code: "internal", message: "Failed to insert inventory part", httpStatus: 500 };
      }
      targetPart = insertedPart;
    }

    await setBalanceQuantity(supabase, companyLocationId, String(targetPart.id), quantity, now);

    updatedParts.push({
      id: Number(targetPart.part_no || 0),
      name: targetPart.name,
      quantity,
      lowThreshold: Number(targetPart.low_threshold ?? 0),
      unit: targetPart.unit ?? undefined,
      active: Boolean(targetPart.active),
    });
  }

  const movementTypeAllowed = ["add", "adjust", "pick", "return", "job_consumption"];
  const insertedMovements: any[] = [];

  for (const movement of normalizedPayload.movements) {
    const movementType = requireNonEmptyString(movement?.movementType, "movements.movementType", 1, 50);
    if (!movementTypeAllowed.includes(movementType)) {
      throw { code: "invalid-argument", message: "Invalid movementType", httpStatus: 400 };
    }

    const quantity = Number(movement?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw { code: "invalid-argument", message: "movements.quantity must be a finite positive number", httpStatus: 400 };
    }

    const rawPartId = movement?.partId;
    const partRecord = await resolvePartRecord(supabase, companyId, rawPartId);
    const resolvedPartId = partRecord?.id ? String(partRecord.id) : null;

    if (!resolvedPartId) {
      throw { code: "not-found", message: "Movement partId not found", httpStatus: 404 };
    }

    const fromLocationId = optionalTrimmedString(movement?.fromLocationId, 120);
    const toLocationId = optionalTrimmedString(movement?.toLocationId, 120);
    const jobId = optionalTrimmedString(movement?.jobId, 120);
    const documentId = optionalTrimmedString(movement?.documentId, 120);
    const note = optionalTrimmedString(movement?.note, 2000);

    if (!fromLocationId && !toLocationId) {
      throw { code: "invalid-argument", message: "Movement must include fromLocationId or toLocationId", httpStatus: 400 };
    }

    if (fromLocationId) {
      await requireCompanyLocationRecord(supabase, companyId, fromLocationId);
    }
    if (toLocationId) {
      await requireCompanyLocationRecord(supabase, companyId, toLocationId);
    }

    if (fromLocationId) {
      const currentQuantity = await getBalanceQuantity(supabase, fromLocationId, resolvedPartId);
      if (currentQuantity < quantity) {
        throw { code: "failed-precondition", message: "Insufficient stock for movement", httpStatus: 400 };
      }
      await setBalanceQuantity(supabase, fromLocationId, resolvedPartId, currentQuantity - quantity, now);
    }

    if (toLocationId) {
      await incrementBalanceQuantity(supabase, toLocationId, resolvedPartId, quantity, now);
    }

    const { data: insertedMovement, error: movementError } = await supabase
      .from("inventory_movements")
      .insert({
        company_id: companyId,
        part_id: resolvedPartId,
        quantity,
        from_location_id: fromLocationId ?? null,
        to_location_id: toLocationId ?? null,
        movement_type: movementType,
        job_id: jobId ?? null,
        document_id: documentId ?? null,
        created_by_membership_id: membership.id,
        note: note ?? null,
        created_at: now,
      })
      .select("id, part_id, quantity, from_location_id, to_location_id, movement_type, job_id, document_id, note, created_at")
      .single();

    if (movementError || !insertedMovement) {
      throw { code: "internal", message: "Failed to record movement", httpStatus: 500 };
    }

    insertedMovements.push({
      id: insertedMovement.id,
      fromLocationId: insertedMovement.from_location_id ?? undefined,
      toLocationId: insertedMovement.to_location_id ?? undefined,
      partId: Number(partRecord?.part_no || 0) || insertedMovement.part_id,
      quantity: Number(insertedMovement.quantity),
      movementType: insertedMovement.movement_type,
      jobId: insertedMovement.job_id ?? undefined,
      documentId: insertedMovement.document_id ?? undefined,
      note: insertedMovement.note ?? undefined,
      createdAt: insertedMovement.created_at,
    });
  }

  await bumpInventoryVersion();

  return {
    parts: updatedParts,
    movements: insertedMovements,
    updatedAt: now,
  };
}
