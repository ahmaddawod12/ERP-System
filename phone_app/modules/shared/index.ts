// @ts-nocheck
/**
 * Subscription Gating Utilities
 * 
 * Provides helpers to check subscription status, module access, and role permissions.
 * Used by route guard wrappers in app/ to gate access to module screens.
 */

import type { Subscription } from '../../types';

export function isSubscriptionActive(subscription: Subscription | null): boolean {
  if (!subscription) return false;
  const { status, expiresAt } = subscription;
  if (status !== 'active' && status !== 'trial') return false;
  if (expiresAt) {
    const expiry = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
    if (expiry < new Date()) return false;
  }
  return true;
}

export function isModuleEnabled(subscription: Subscription | null, moduleName: string): boolean {
  if (!subscription?.enabledModules) return false;
  return !!subscription.enabledModules[moduleName];
}

export function hasRoleAccess(role: string, allowedRoles: string[]): boolean {
  if (!role || !allowedRoles || allowedRoles.length === 0) return false;
  return allowedRoles.includes(role);
}

export function canAccess(
  subscription: Subscription | null,
  role: string,
  moduleName: string | string[],
  allowedRoles: string[]
): { allowed: boolean; reason: string | null } {
  if (!hasRoleAccess(role, allowedRoles)) {
    return { allowed: false, reason: 'role' };
  }
  if (!isSubscriptionActive(subscription)) {
    return { allowed: false, reason: 'subscription' };
  }
  const modules = Array.isArray(moduleName) ? moduleName : [moduleName];
  for (const m of modules) {
    if (!isModuleEnabled(subscription, m)) {
      return { allowed: false, reason: 'module' };
    }
  }
  return { allowed: true, reason: null };
}

