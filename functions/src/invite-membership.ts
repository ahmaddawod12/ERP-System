function normalizeMembershipId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

function getExistingMembership(profileData: any = {}) {
  const companyId = typeof profileData.companyId === 'string'
    ? profileData.companyId.trim()
    : '';
  if (!companyId) {
    return null;
  }

  return {
    companyId,
    role: typeof profileData.role === 'string' && profileData.role.trim()
      ? String(profileData.role).trim().toLowerCase()
      : null,
    wid: normalizeMembershipId(profileData.wid),
    mid: normalizeMembershipId(profileData.mid),
  };
}

function resolveJoinCompanyMembership({ profileData, requestedCompanyId, authUid, inviteUsedBy }) {
  const existingMembership = getExistingMembership(profileData);
  if (!existingMembership) {
    return { mode: 'create' };
  }

  if (existingMembership.companyId !== requestedCompanyId) {
    return {
      mode: 'reject',
      code: 'already-exists',
      message: 'User already belongs to another company',
    };
  }

  if (inviteUsedBy && inviteUsedBy === authUid && existingMembership.wid != null) {
    return {
      mode: 'reuse_existing',
      membership: {
        companyId: existingMembership.companyId,
        role: existingMembership.role || 'worker',
        wid: existingMembership.wid,
      },
    };
  }

  return {
    mode: 'reject',
    code: 'already-exists',
    message: 'User already belongs to this company',
  };
}

export { normalizeMembershipId, getExistingMembership, resolveJoinCompanyMembership };
