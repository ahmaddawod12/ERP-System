import { isSqlPersistenceEnabled } from './sql-access';
import { bumpCompanySyncStateInSql } from './sql-company-sync';

/**
 * Inventory domain module.
 */

const {
  onCall,
  HttpsError,
  admin,
  logger,
  validateCompanyId,
  assertHttpCompanyAccess,
  assertTargetWorkerScopedUserInCompany,
  HTTP_COMPANY_MANAGER_ROLES,
  getAuthenticatedUserProfile,
  userProfileDocPath,
  requireNonEmptyString,
} = require('./shared');
const {
  addCompanyInventoryPartInSql,
  addUserInventoryPartInSql,
  pickCompanyPartsInSql,
  removeCompanyInventoryPartInSql,
  removeUserInventoryPartInSql,
  replaceUserInventoryPartsInSql,
  toggleCompanyInventoryPartInSql,
  toggleUserInventoryPartInSql,
  updateCompanyInventoryPartInSql,
  updateUserInventoryPartInSql,
} = require('./sql-inventory');

const MAX_INVENTORY_PART_NAME_LENGTH = 120;
const MAX_INVENTORY_PARTS = 5000;
const MAX_INVENTORY_DOC_BYTES = 900 * 1024;

function assertInventoryFitsFirestoreBudget(parts, nextId) {
  const estimatedBytes = Buffer.byteLength(JSON.stringify({
    parts,
    nextId,
    lastUpdated: new Date().toISOString(),
  }), 'utf8');
  if (parts.length > MAX_INVENTORY_PARTS || estimatedBytes > MAX_INVENTORY_DOC_BYTES) {
    throw new HttpsError(
      'resource-exhausted',
      'Inventory document limit reached. Split inventory before adding more parts.',
    );
  }
}

function requireFiniteNonNegativeNumber(value, fieldName) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new HttpsError('invalid-argument', `${fieldName} must be a non-negative finite number`);
  }
  return numberValue;
}

function requireFinitePositiveNumber(value, fieldName) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new HttpsError('invalid-argument', `${fieldName} must be a positive finite number`);
  }
  return numberValue;
}

function normalizePartName(value, fieldName = 'partName') {
  const partName = typeof value === 'string' ? value.trim() : '';
  if (!partName) {
    throw new HttpsError('invalid-argument', `${fieldName} is required`);
  }
  if (partName.length > MAX_INVENTORY_PART_NAME_LENGTH) {
    throw new HttpsError('invalid-argument', `${fieldName} exceeds ${MAX_INVENTORY_PART_NAME_LENGTH} characters`);
  }
  return partName;
}

/**
 * Callable Function: updateInventoryV1
 */
export const updateInventoryV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  validateCompanyId(companyId);
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  const scope = typeof data.scope === 'string' ? data.scope.trim() : '';
  const targetUid = typeof data.targetUid === 'string' ? data.targetUid.trim() : uid;

  if (!action || !scope) {
    throw new HttpsError('invalid-argument', 'action and scope are required');
  }

  if (!['addPart', 'removePart', 'togglePart', 'updatePart', 'pickParts', 'replaceParts'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Invalid action');
  }

  if (!['company', 'user'].includes(scope)) {
    throw new HttpsError('invalid-argument', 'scope must be company or user');
  }

  // Access control
  if (scope === 'company') {
    await assertHttpCompanyAccess({
      uid,
      companyId,
      allowedRoles: HTTP_COMPANY_MANAGER_ROLES,
      allowSoloScope: true,
    });
  } else {
    // user scope: user can modify own inventory, manager can modify worker inventory
    await assertHttpCompanyAccess({
      uid,
      companyId,
      allowedRoles: ['manager', 'worker', 'user', 'dev'],
      allowSoloScope: true,
    });
    if (targetUid !== uid) {
      // Only manager/dev can modify another user's inventory
      await assertHttpCompanyAccess({
        uid,
        companyId,
        allowedRoles: HTTP_COMPANY_MANAGER_ROLES,
        allowSoloScope: false,
      });
      await assertTargetWorkerScopedUserInCompany(targetUid, companyId);
    }
  }

  const dbRef = admin.firestore();

  if (isSqlPersistenceEnabled() && (
    (scope === 'company' && ['addPart', 'removePart', 'togglePart', 'updatePart', 'pickParts'].includes(action)) ||
    (scope === 'user' && ['addPart', 'removePart', 'togglePart', 'updatePart', 'replaceParts'].includes(action))
  )) {
    let result;

    if (scope === 'company' && action === 'addPart') {
      result = await addCompanyInventoryPartInSql({
        companyId,
        createdByUserId: uid,
        partName: data.partName,
        quantity: data.quantity,
        lowThreshold: data.lowThreshold,
        active: data.active,
      });
    } else if (scope === 'company' && action === 'removePart') {
      result = await removeCompanyInventoryPartInSql({
        companyId,
        partId: data.partId,
      });
    } else if (scope === 'company' && action === 'togglePart') {
      result = await toggleCompanyInventoryPartInSql({
        companyId,
        partId: data.partId,
      });
    } else if (scope === 'company' && action === 'pickParts') {
      result = await pickCompanyPartsInSql({
        companyId,
        createdByUserId: uid,
        targetUid,
        partsToPick: Array.isArray(data.partsToPick) ? data.partsToPick : [],
      });
    } else if (scope === 'user' && action === 'addPart') {
      result = await addUserInventoryPartInSql({
        companyId,
        createdByUserId: uid,
        targetUid,
        partName: data.partName,
        quantity: data.quantity,
        lowThreshold: data.lowThreshold,
        active: data.active,
      });
    } else if (scope === 'user' && action === 'removePart') {
      result = await removeUserInventoryPartInSql({
        companyId,
        targetUid,
        partId: data.partId,
      });
    } else if (scope === 'user' && action === 'togglePart') {
      result = await toggleUserInventoryPartInSql({
        companyId,
        targetUid,
        partId: data.partId,
      });
    } else if (scope === 'user' && action === 'replaceParts') {
      result = await replaceUserInventoryPartsInSql({
        companyId,
        targetUid,
        parts: Array.isArray(data.parts) ? data.parts : [],
      });
    } else if (scope === 'company' && action === 'updatePart') {
      result = await updateCompanyInventoryPartInSql({
        companyId,
        partId: data.partId,
        partName: data.partName,
        quantity: data.quantity,
        lowThreshold: data.lowThreshold,
        active: data.active,
      });
    } else {
      result = await updateUserInventoryPartInSql({
        companyId,
        targetUid,
        partId: data.partId,
        partName: data.partName,
        quantity: data.quantity,
        lowThreshold: data.lowThreshold,
        active: data.active,
      });
    }

    const userCacheRef = dbRef.doc(`users/${targetUid}/data/cache`);
    const userCacheUpdate = userCacheRef.set({
      inventory: admin.firestore.FieldValue.increment(1),
      lastUpdated: new Date().toISOString(),
    }, { merge: true });

    if (scope === 'company') {
      await Promise.all([
        bumpCompanySyncStateInSql(companyId, ['companyInventoryVersion']),
        userCacheUpdate,
      ]);
    } else {
      await userCacheUpdate;
    }

    logger.info('updateInventoryV1: inventory updated in SQL', { companyId, action, scope, uid, targetUid });
    return { success: true, ...result };
  }

  const invRef = scope === 'company'
    ? dbRef.doc(`companies/${companyId}/data/inventory`)
    : dbRef.doc(`users/${targetUid}/data/inventory`);

  const result = await dbRef.runTransaction(async (tx) => {
    const snap = await tx.get(invRef);
    const invData = snap.exists ? (snap.data() || {}) : { parts: [], nextId: 1, lastUpdated: '' };
    const parts = Array.isArray(invData.parts) ? invData.parts : [];
    let nextId = invData.nextId || 1;
    const now = new Date().toISOString();

    if (action === 'addPart') {
      if (parts.length >= MAX_INVENTORY_PARTS) {
        throw new HttpsError('resource-exhausted', `Inventory limit reached (max ${MAX_INVENTORY_PARTS} parts)`);
      }
      const partName = normalizePartName(data.partName);
      const newPart = {
        id: nextId,
        name: partName,
        active: data.active !== false,
        quantity: data.quantity === undefined ? 0 : requireFiniteNonNegativeNumber(data.quantity, 'quantity'),
        lowThreshold: data.lowThreshold === undefined ? 0 : requireFiniteNonNegativeNumber(data.lowThreshold, 'lowThreshold'),
        dateAdded: now,
      };
      const updatedParts = [...parts, newPart];
      assertInventoryFitsFirestoreBudget(updatedParts, nextId + 1);
      tx.set(invRef, { parts: updatedParts, nextId: nextId + 1, lastUpdated: now }, { merge: true });
      return { partId: nextId };
    }

    if (action === 'removePart') {
      const partId = requireFiniteNonNegativeNumber(data.partId, 'partId');
      const updatedParts = parts.filter((p) => p.id !== partId);
      assertInventoryFitsFirestoreBudget(updatedParts, nextId);
      tx.update(invRef, { parts: updatedParts, lastUpdated: now });
      return { removed: partId };
    }

    if (action === 'togglePart') {
      const partId = requireFiniteNonNegativeNumber(data.partId, 'partId');
      const updatedParts = parts.map((p) => p.id === partId ? { ...p, active: !p.active } : p);
      assertInventoryFitsFirestoreBudget(updatedParts, nextId);
      tx.update(invRef, { parts: updatedParts, lastUpdated: now });
      return { toggled: partId };
    }

    if (action === 'updatePart') {
      const partId = requireFiniteNonNegativeNumber(data.partId, 'partId');
      const updatedParts = parts.map((p) => {
        if (p.id !== partId) return p;
        const updated = { ...p };
        if (data.partName !== undefined) updated.name = normalizePartName(data.partName);
        if (data.quantity !== undefined) updated.quantity = requireFiniteNonNegativeNumber(data.quantity, 'quantity');
        if (data.lowThreshold !== undefined) updated.lowThreshold = requireFiniteNonNegativeNumber(data.lowThreshold, 'lowThreshold');
        if (data.active !== undefined) updated.active = !!data.active;
        return updated;
      });
      assertInventoryFitsFirestoreBudget(updatedParts, nextId);
      tx.update(invRef, { parts: updatedParts, lastUpdated: now });
      return { updated: partId };
    }

    if (action === 'pickParts') {
      if (scope !== 'company') {
        throw new HttpsError('invalid-argument', 'pickParts action is only allowed with scope=company');
      }

      const partsToPick = data.partsToPick;
      if (!Array.isArray(partsToPick) || partsToPick.length === 0) {
        throw new HttpsError('invalid-argument', 'partsToPick array is required');
      }
      for (const pick of partsToPick) {
        if (typeof pick?.id !== 'number' || !Number.isFinite(pick.id) || pick.id < 0) {
          throw new HttpsError('invalid-argument', 'Each picked part must include a numeric id');
        }
        pick.quantity = requireFinitePositiveNumber(pick.quantity, 'picked quantity');
      }

      // Validate company inventory stock and deduct picked quantities
      // invRef is already the company inventory ref; parts is the current company parts
      const insufficientParts = [];
      for (const pick of partsToPick) {
        const companyPart = parts.find((p) => p.id === pick.id);
        if (!companyPart) {
          insufficientParts.push({ id: pick.id, name: pick.name, requested: pick.quantity, available: 0 });
        } else if ((companyPart.quantity || 0) < (pick.quantity || 0)) {
          insufficientParts.push({ id: pick.id, name: companyPart.name, requested: pick.quantity, available: companyPart.quantity || 0 });
        }
      }
      if (insufficientParts.length > 0) {
        throw new HttpsError('failed-precondition', `Insufficient stock for parts: ${insufficientParts.map(p => `${p.name} (need ${p.requested}, have ${p.available})`).join(', ')}`);
      }

      // Read user inventory before any writes; Firestore transactions reject read-after-write.
      const userInvRef = dbRef.doc(`users/${targetUid}/data/inventory`);
      const userSnap = await tx.get(userInvRef);

      // Deduct picked quantities from company inventory
      const updatedCompanyParts = parts.map((p) => {
        const pick = partsToPick.find((pk) => pk.id === p.id);
        if (pick && typeof pick.quantity === 'number') {
          return { ...p, quantity: Math.max(0, (p.quantity || 0) - pick.quantity) };
        }
        return p;
      });
      assertInventoryFitsFirestoreBudget(updatedCompanyParts, nextId);
      tx.update(invRef, { parts: updatedCompanyParts, lastUpdated: now });

      // For pick: read user inventory, add/merge picked parts (deep copy to prevent mutation of snapshot data)
      const userData = userSnap.exists ? (userSnap.data() || {}) : { parts: [], nextId: 1, lastUpdated: '' };
      let userNextId = userData.nextId || 1;
      const userParts = Array.isArray(userData.parts) ? userData.parts.map(p => ({ ...p })) : [];

      for (const pick of partsToPick) {
        const pickId = typeof pick.id === 'number' ? pick.id : null;
        const existing = userParts.find((p) => {
          if (pickId === null) return false;
          return p.id === pickId || p.sourcePartId === pickId;
        });
        if (existing) {
          existing.quantity = (existing.quantity || 0) + (pick.quantity || 0);
        } else {
          const partId = pickId !== null ? pickId : userNextId;
          if (partId >= userNextId) {
            userNextId = partId + 1;
          }
          const sourceCompanyPart = parts.find((p) => p.id === pickId);
          userParts.push({
            id: partId,
            sourcePartId: pickId,
            name: String(sourceCompanyPart?.name || '').trim(),
            quantity: pick.quantity || 0,
            lowThreshold: 0,
            dateAdded: now,
          });
        }
      }
      assertInventoryFitsFirestoreBudget(userParts, userNextId);
      tx.set(userInvRef, { parts: userParts, nextId: userNextId, lastUpdated: now }, { merge: true });
      return { picked: partsToPick.length };
    }

    if (action === 'replaceParts') {
      // Manager replaces the full parts array on a worker's inventory (e.g. EditJob adjustments)
      const newParts = data.parts;
      if (!Array.isArray(newParts)) throw new HttpsError('invalid-argument', 'parts array is required');
      if (newParts.length > MAX_INVENTORY_PARTS) throw new HttpsError('resource-exhausted', `Inventory limit exceeded (max ${MAX_INVENTORY_PARTS} parts)`);
      // Sanitize each part
      const seenIds = new Set();
      const sanitized = newParts.map((p, index) => {
        const id = typeof p.id === 'number' && Number.isFinite(p.id) && p.id >= 0 ? p.id : nextId++;
        if (seenIds.has(id)) {
          throw new HttpsError('invalid-argument', `Duplicate inventory part id at index ${index}`);
        }
        seenIds.add(id);
        return {
        id,
        name: normalizePartName(p.name, `parts[${index}].name`),
        active: p.active !== false,
        quantity: p.quantity === undefined ? 0 : requireFiniteNonNegativeNumber(p.quantity, `parts[${index}].quantity`),
        lowThreshold: p.lowThreshold === undefined ? 0 : requireFiniteNonNegativeNumber(p.lowThreshold, `parts[${index}].lowThreshold`),
        dateAdded: typeof p.dateAdded === 'string' ? p.dateAdded : now,
      };
      });
      const maxId = sanitized.reduce((m, p) => Math.max(m, p.id), 0);
      assertInventoryFitsFirestoreBudget(sanitized, maxId + 1);
      tx.set(invRef, { parts: sanitized, nextId: maxId + 1, lastUpdated: now }, { merge: true });
      return { replaced: sanitized.length };
    }

    throw new HttpsError('invalid-argument', 'Unknown action');
  }, /* end transaction callback */);

  // Cache bump is outside transaction intentionally — uses FieldValue.increment
  // which is idempotent and safe for eventual consistency. Moving inside transaction
  // would require reading the cache doc first, adding contention.
  if (scope === 'company') {
    const companyCacheRef = dbRef.doc(`companies/${companyId}/data/cache`);
      await companyCacheRef.set({
      inventory: admin.firestore.FieldValue.increment(1),
      companyInventoryVersion: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  // User-scope inventory changes bump user cache
  const userCacheRef = dbRef.doc(`users/${targetUid}/data/cache`);
  await userCacheRef.set({
    inventory: admin.firestore.FieldValue.increment(1),
    lastUpdated: new Date().toISOString(),
  }, { merge: true });

  // For pickParts with company scope, also bump user cache since they received parts
  if (result.picked && scope === 'company') {
    // userCacheRef already bumped above
  }

  logger.info('updateInventoryV1: inventory updated', { companyId, action, scope, uid });
  return { success: true, ...result };
});
