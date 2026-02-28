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
  assertTargetUserInCompany,
  HTTP_COMPANY_MANAGER_ROLES,
  getAuthenticatedUserProfile,
  userProfileDocPath,
  requireNonEmptyString,
} = require('./shared');

/**
 * Callable Function: updateInventoryV1
 */
exports.updateInventoryV1 = onCall(async (request) => {
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
      await assertTargetUserInCompany(targetUid, companyId);
    }
  }

  const dbRef = admin.firestore();
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
      if (parts.length >= 5000) {
        throw new HttpsError('resource-exhausted', 'Inventory limit reached (max 5000 parts)');
      }
      const partName = typeof data.partName === 'string' ? data.partName.trim() : '';
      if (!partName) throw new HttpsError('invalid-argument', 'partName is required');
      const newPart = {
        id: nextId,
        name: partName,
        active: data.active !== false,
        quantity: typeof data.quantity === 'number' ? data.quantity : 0,
        lowThreshold: typeof data.lowThreshold === 'number' ? data.lowThreshold : 0,
        dateAdded: now,
      };
      tx.set(invRef, { parts: [...parts, newPart], nextId: nextId + 1, lastUpdated: now }, { merge: true });
      return { partId: nextId };
    }

    if (action === 'removePart') {
      const partId = data.partId;
      if (typeof partId !== 'number') throw new HttpsError('invalid-argument', 'partId is required');
      tx.update(invRef, { parts: parts.filter((p) => p.id !== partId), lastUpdated: now });
      return { removed: partId };
    }

    if (action === 'togglePart') {
      const partId = data.partId;
      if (typeof partId !== 'number') throw new HttpsError('invalid-argument', 'partId is required');
      const updatedParts = parts.map((p) => p.id === partId ? { ...p, active: !p.active } : p);
      tx.update(invRef, { parts: updatedParts, lastUpdated: now });
      return { toggled: partId };
    }

    if (action === 'updatePart') {
      const partId = data.partId;
      if (typeof partId !== 'number') throw new HttpsError('invalid-argument', 'partId is required');
      const updatedParts = parts.map((p) => {
        if (p.id !== partId) return p;
        const updated = { ...p };
        if (data.partName !== undefined) updated.name = String(data.partName).trim();
        if (data.quantity !== undefined) updated.quantity = Number(data.quantity);
        if (data.lowThreshold !== undefined) updated.lowThreshold = Number(data.lowThreshold);
        if (data.active !== undefined) updated.active = !!data.active;
        return updated;
      });
      tx.update(invRef, { parts: updatedParts, lastUpdated: now });
      return { updated: partId };
    }

    if (action === 'pickParts') {
      const partsToPick = data.partsToPick;
      if (!Array.isArray(partsToPick) || partsToPick.length === 0) {
        throw new HttpsError('invalid-argument', 'partsToPick array is required');
      }

      // Validate company inventory stock and deduct picked quantities
      if (scope === 'company') {
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

        // Deduct picked quantities from company inventory
        const updatedCompanyParts = parts.map((p) => {
          const pick = partsToPick.find((pk) => pk.id === p.id);
          if (pick && typeof pick.quantity === 'number') {
            return { ...p, quantity: Math.max(0, (p.quantity || 0) - pick.quantity) };
          }
          return p;
        });
        tx.update(invRef, { parts: updatedCompanyParts, lastUpdated: now });
      }

      // For pick: read user inventory, add/merge picked parts
      const userInvRef = dbRef.doc(`users/${targetUid}/data/inventory`);
      const userSnap = await tx.get(userInvRef);
      const userData = userSnap.exists ? (userSnap.data() || {}) : { parts: [], nextId: 1, lastUpdated: '' };
      let userNextId = userData.nextId || 1;
      const userParts = Array.isArray(userData.parts) ? [...userData.parts] : [];

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
          userParts.push({
            id: partId,
            sourcePartId: pickId,
            name: pick.name || '',
            quantity: pick.quantity || 0,
            lowThreshold: 0,
            dateAdded: now,
          });
        }
      }
      tx.set(userInvRef, { parts: userParts, nextId: userNextId, lastUpdated: now }, { merge: true });
      return { picked: partsToPick.length };
    }

    if (action === 'replaceParts') {
      // Manager replaces the full parts array on a worker's inventory (e.g. EditJob adjustments)
      const newParts = data.parts;
      if (!Array.isArray(newParts)) throw new HttpsError('invalid-argument', 'parts array is required');
      if (newParts.length > 5000) throw new HttpsError('resource-exhausted', 'Inventory limit exceeded (max 5000 parts)');
      // Sanitize each part
      const sanitized = newParts.map((p) => ({
        id: typeof p.id === 'number' ? p.id : nextId++,
        name: typeof p.name === 'string' ? p.name.trim() : '',
        active: p.active !== false,
        quantity: typeof p.quantity === 'number' ? Math.max(0, p.quantity) : 0,
        lowThreshold: typeof p.lowThreshold === 'number' ? p.lowThreshold : 0,
        dateAdded: typeof p.dateAdded === 'string' ? p.dateAdded : now,
      }));
      const maxId = sanitized.reduce((m, p) => Math.max(m, p.id), 0);
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
