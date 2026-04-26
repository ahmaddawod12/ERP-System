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
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", ctx.auth.uid)
    .eq("status", "active")
    .single();

  if (membershipError || !membership) {
    throw { code: "permission-denied", message: "Not allowed for this company", httpStatus: 403 };
  }

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

  const updatedParts: any[] = [];

  for (const part of partsInput) {
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
    let existingPart: any = null;
    if (typeof rawId === "string" && rawId.trim().length > 0) {
      const { data } = await supabase
        .from("inventory_parts")
        .select("id, part_no")
        .eq("company_id", companyId)
        .eq("id", rawId.trim())
        .maybeSingle();
      existingPart = data ?? null;
    } else if (typeof rawId === "number" && Number.isFinite(rawId)) {
      const { data } = await supabase
        .from("inventory_parts")
        .select("id, part_no")
        .eq("company_id", companyId)
        .eq("part_no", rawId)
        .maybeSingle();
      existingPart = data ?? null;
    }

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

    const { error: balanceError } = await supabase
      .from("inventory_balances")
      .upsert(
        {
          location_id: companyLocationId,
          part_id: targetPart.id,
          quantity_on_hand: quantity,
          updated_at: now,
        },
        { onConflict: "location_id,part_id" },
      );

    if (balanceError) {
      throw { code: "internal", message: "Failed to update inventory balance", httpStatus: 500 };
    }

    updatedParts.push({
      id: targetPart.id,
      name: targetPart.name,
      quantity,
      lowThreshold: Number(targetPart.low_threshold ?? 0),
      unit: targetPart.unit ?? undefined,
      active: Boolean(targetPart.active),
    });
  }

  const movementTypeAllowed = ["add", "adjust", "pick", "return", "job_consumption"];
  const insertedMovements: any[] = [];

  for (const movement of movementsInput) {
    const movementType = requireNonEmptyString(movement?.movementType, "movements.movementType", 1, 50);
    if (!movementTypeAllowed.includes(movementType)) {
      throw { code: "invalid-argument", message: "Invalid movementType", httpStatus: 400 };
    }

    const quantity = Number(movement?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw { code: "invalid-argument", message: "movements.quantity must be a finite positive number", httpStatus: 400 };
    }

    const rawPartId = movement?.partId;
    let resolvedPartId: string | null = null;
    if (typeof rawPartId === "string" && rawPartId.trim().length > 0) {
      const { data: partById } = await supabase
        .from("inventory_parts")
        .select("id")
        .eq("company_id", companyId)
        .eq("id", rawPartId.trim())
        .maybeSingle();
      resolvedPartId = partById?.id ?? null;
      if (!resolvedPartId && /^\d+$/.test(rawPartId.trim())) {
        const { data: partByNo } = await supabase
          .from("inventory_parts")
          .select("id")
          .eq("company_id", companyId)
          .eq("part_no", Number(rawPartId.trim()))
          .maybeSingle();
        resolvedPartId = partByNo?.id ?? null;
      }
    } else if (typeof rawPartId === "number" && Number.isFinite(rawPartId)) {
      const { data: partByNo } = await supabase
        .from("inventory_parts")
        .select("id")
        .eq("company_id", companyId)
        .eq("part_no", rawPartId)
        .maybeSingle();
      resolvedPartId = partByNo?.id ?? null;
    }

    if (!resolvedPartId) {
      throw { code: "not-found", message: "Movement partId not found", httpStatus: 404 };
    }

    const fromLocationId = optionalTrimmedString(movement?.fromLocationId, 120);
    const toLocationId = optionalTrimmedString(movement?.toLocationId, 120);
    const jobId = optionalTrimmedString(movement?.jobId, 120);
    const documentId = optionalTrimmedString(movement?.documentId, 120);
    const note = optionalTrimmedString(movement?.note, 2000);

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
      partId: insertedMovement.part_id,
      quantity: Number(insertedMovement.quantity),
      movementType: insertedMovement.movement_type,
      jobId: insertedMovement.job_id ?? undefined,
      documentId: insertedMovement.document_id ?? undefined,
      note: insertedMovement.note ?? undefined,
      createdAt: insertedMovement.created_at,
    });
  }

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

  return {
    parts: updatedParts,
    movements: insertedMovements,
    updatedAt: now,
  };
}
