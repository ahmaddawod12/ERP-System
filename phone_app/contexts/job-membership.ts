import type { RoleTitle } from '../types';

export function normalizeMembershipId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function roleUsesScopedJobAccess(role: RoleTitle | string): boolean {
  return role === 'worker' || role === 'user';
}

export function buildJobMembershipQueryValues(value: unknown): (string | number)[] {
  const normalized = normalizeMembershipId(value);
  if (!normalized) return [];

  const numericValue = Number(normalized);
  if (Number.isInteger(numericValue) && String(numericValue) === normalized) {
    return [normalized, numericValue];
  }

  return [normalized];
}
