/**
 * withGate - Higher-Order Component for subscription-based feature gating.
 *
 * Wraps a screen component with role + subscription + module checks.
 * If the user doesn't have access, shows NotAvailableScreen.
 * If data is still loading, shows a loading indicator.
 *
 * Usage:
 *   import { withGate } from '../modules/shared/gating/withGate';
 *   import Screen from '../modules/documents/screens/GeneralDocuments';
 *   export default withGate(Screen, { module: 'documents', roles: ['user', 'basic', 'manager'] });
 */
import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useCache } from '../../../contexts/CacheContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { getColors } from '../../../theme';
import { isSubscriptionActive, isModuleEnabled, hasRoleAccess } from './index';
import NotAvailableScreen from './NotAvailableScreen';

/**
 * @param {React.ComponentType} ScreenComponent - The screen to gate
 * @param {object} options
 * @param {string|string[]} options.module - Required module(s) name in enabledModules
 * @param {string[]} options.roles - Allowed roles
 * @param {object} [options.roleModules] - Role-specific additional module requirements
 *   e.g. { worker: ['teaminventory', 'inventory'] } means workers need BOTH modules
 */
export function withGate(ScreenComponent, options = {}) {
  const { module: moduleName, roles, roleModules } = options;

  return function GatedScreenWrapper(props) {
    const { profile, subscription } = useCache();
    const { isDarkMode } = useThemeContext();
    const colors = getColors(isDarkMode);

    // Still loading profile or subscription — show spinner
    if (!profile) {
      return (
        <View style={[styles.loading, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    const role = profile.role;

    // Role check
    if (roles && roles.length > 0 && !hasRoleAccess(role, roles)) {
      return <NotAvailableScreen reason="role" />;
    }

    // Subscription still loading — brief spinner
    if (subscription === undefined || subscription === null) {
      return (
        <View style={[styles.loading, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
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
