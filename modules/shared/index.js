/**
 * Subscription Gating Utilities
 * 
 * Provides helpers to check subscription status, module access, and role permissions.
 * Used by route guard wrappers in app/ to gate access to module screens.
 */

/**
 * Check if subscription is active (status is active/trial AND not expired)
 * @param {object|null} subscription
 * @returns {boolean}
 */
export function isSubscriptionActive(subscription) {
  if (!subscription) return false;
  const { status, expiresAt } = subscription;
  if (status !== 'active' && status !== 'trial') return false;
  if (expiresAt) {
    const expiry = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
    if (expiry < new Date()) return false;
  }
  return true;
}

/**
 * Check if a specific module is enabled in the subscription
 * @param {object|null} subscription
 * @param {string} moduleName - e.g. 'team', 'solojob', 'teaminventory', 'companyinventory', 'documents'
 * @returns {boolean}
 */
export function isModuleEnabled(subscription, moduleName) {
  if (!subscription?.enabledModules) return false;
  return !!subscription.enabledModules[moduleName];
}

/**
 * Check if user role is in the allowed list
 * @param {string} role
 * @param {string[]} allowedRoles
 * @returns {boolean}
 */
export function hasRoleAccess(role, allowedRoles) {
  if (!role || !allowedRoles || allowedRoles.length === 0) return false;
  return allowedRoles.includes(role);
}

/**
 * Combined access check: role + subscription active + module enabled
 * @param {object|null} subscription
 * @param {string} role
 * @param {string|string[]} moduleName
 * @param {string[]} allowedRoles
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export function canAccess(subscription, role, moduleName, allowedRoles) {
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
