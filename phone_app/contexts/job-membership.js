function normalizeMembershipId(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function roleUsesScopedJobAccess(role) {
  return role === 'worker' || role === 'user';
}

function buildJobMembershipQueryValues(value) {
  const normalized = normalizeMembershipId(value);
  if (!normalized) return [];

  const numericValue = Number(normalized);
  if (Number.isInteger(numericValue) && String(numericValue) === normalized) {
    return [normalized, numericValue];
  }

  return [normalized];
}

module.exports = {
  normalizeMembershipId,
  roleUsesScopedJobAccess,
  buildJobMembershipQueryValues,
};
