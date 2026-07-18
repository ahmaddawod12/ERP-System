import type {
  CompanyBootstrap,
  ViewerProfile,
} from '@smart-job/api-contracts';

import type { Subscription, UserProfile } from '../types';

export function mapViewerProfileToCache(
  profile: ViewerProfile,
  bootstrap: CompanyBootstrap,
): UserProfile {
  const memberNo = bootstrap.workspace.memberNo;
  return {
    uid: profile.uid,
    email: profile.email,
    role: bootstrap.workspace.role,
    companyId: String(bootstrap.workspace.companyId),
    ...(profile.displayName === null ? {} : {
      displayName: profile.displayName,
      name: profile.displayName,
    }),
    ...(profile.phoneNumber === null ? {} : { phone: profile.phoneNumber }),
    ...(bootstrap.workspace.role === 'worker' && memberNo !== null ? { wid: memberNo } : {}),
    ...(bootstrap.workspace.role === 'manager' && memberNo !== null ? { mid: memberNo } : {}),
    updatedAt: profile.updatedAt,
  };
}

export function mapSubscriptionToCache(
  bootstrap: CompanyBootstrap,
): Subscription | null {
  if (bootstrap.subscription === null) return null;
  return {
    status: bootstrap.subscription.status,
    tier: bootstrap.subscription.tier,
    expiresAt: bootstrap.subscription.expiresAt ?? undefined,
    enabledModules: Object.fromEntries(
      bootstrap.subscription.enabledModules.map((moduleName) => [moduleName, true]),
    ),
    updatedAt: bootstrap.subscription.updatedAt,
  };
}
