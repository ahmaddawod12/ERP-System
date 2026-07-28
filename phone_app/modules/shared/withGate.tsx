/**
 * withGate - Higher-Order Component for subscription-based feature gating.
 *
 * Wraps a screen component with role + subscription + module checks.
 * If the user doesn't have access, shows NotAvailableScreen.
 * If data is still loading, shows a loading indicator.
 *
 * Usage:
 *   import { withGate } from '../modules/shared/withGate';
 *   import Screen from '../modules/documents/screens/GeneralDocuments';
 *   export default withGate(Screen, { module: 'documents', roles: ['user', 'basic', 'manager'] });
 */
import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useCacheLifecycle } from '../../contexts/CacheContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { getColors } from '../../theme';
import { isSubscriptionActive, isModuleEnabled, hasRoleAccess } from './index';
import NotAvailableScreen from './NotAvailableScreen';

export interface GateOptions {
  module?: string | string[];
  roles?: string[];
  roleModules?: Record<string, string[]>;
}

export function withGate<P extends Record<string, any>>(
  ScreenComponent: React.ComponentType<P>,
  options: GateOptions = {}
): React.FC<P> {
  const { module: moduleName, roles, roleModules } = options;

  return function GatedScreenWrapper(props: P) {
    const { profile, subscription, isLoading } = useCacheLifecycle();
    const { isDarkMode } = useThemeContext();
    const colors = getColors(isDarkMode);

    // Still loading profile — show spinner
    if (!profile || isLoading) {
      return (
        <View style={[styles.loading, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    const role = String(profile.role || '').toLowerCase();

    // Dev role bypasses all gating
    if (role === 'dev') {
      return <ScreenComponent {...props} />;
    }

    // Role check
    if (roles && roles.length > 0 && !hasRoleAccess(role, roles)) {
      return <NotAvailableScreen reason="role" />;
    }

    // If no subscription doc exists, treat as expired (don't spin forever)
    if (!subscription) {
      return <NotAvailableScreen reason="subscription" />;
    }

    // Subscription active check
    if (!isSubscriptionActive(subscription)) {
      return <NotAvailableScreen reason="subscription" />;
    }

    // Role-specific module requirements (e.g. workers need teaminventory + inventory)
    if (roleModules && roleModules[role]) {
      const requiredModules = roleModules[role];
      for (const m of requiredModules) {
        if (!isModuleEnabled(subscription, m)) {
          return <NotAvailableScreen reason="module" />;
        }
      }
      // Role-specific modules satisfied, render screen
      return <ScreenComponent {...props} />;
    }

    // Standard module check
    if (moduleName) {
      const modules = Array.isArray(moduleName) ? moduleName : [moduleName];
      for (const m of modules) {
        if (!isModuleEnabled(subscription, m)) {
          return <NotAvailableScreen reason="module" />;
        }
      }
    }

    return <ScreenComponent {...props} />;
  };
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

