import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, useSegments } from 'expo-router';

import { AppButton, AppCard, AppText } from '../index';
import { useSession } from '../../contexts/SessionContext';
import { useTenant } from '../../contexts/TenantContext';
import { ROUTES } from '../../navigation/routes';

function CenteredState({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

export function RouteAccessGate({ children }: { children: ReactNode }) {
  const segments = useSegments();
  const { status: sessionStatus } = useSession();
  const {
    status: tenantStatus,
    workspaces,
    error,
    selectWorkspace,
    refreshWorkspaces,
  } = useTenant();
  const firstSegment = String(segments[0] ?? '');
  const publicRoute = firstSegment === '' || firstSegment === 'index' || firstSegment === 'Login';

  if (sessionStatus === 'restoring') {
    return (
      <CenteredState>
        <ActivityIndicator size="large" accessibilityLabel="Restoring secure session" />
      </CenteredState>
    );
  }

  if (sessionStatus === 'unauthenticated') {
    if (!publicRoute) {
      return <Redirect href={ROUTES.login} />;
    }
    return children;
  }

  if (tenantStatus === 'loading') {
    return (
      <CenteredState>
        <ActivityIndicator size="large" accessibilityLabel="Loading workspaces" />
      </CenteredState>
    );
  }

  if (tenantStatus === 'selection-required') {
    return (
      <CenteredState>
        <AppCard style={styles.card}>
          <AppText variant="heading" align="center">Select a company</AppText>
          <AppText variant="caption" align="center" style={styles.description}>
            Choose the workspace for this session. You can switch again from settings.
          </AppText>
          <View style={styles.actions}>
            {workspaces.map((workspace) => (
              <AppButton
                key={workspace.companyId}
                title={`${workspace.name} · ${workspace.role}`}
                onPress={() => void selectWorkspace(workspace.companyId)}
              />
            ))}
          </View>
        </AppCard>
      </CenteredState>
    );
  }

  if (tenantStatus === 'error' || tenantStatus === 'idle') {
    return (
      <CenteredState>
        <AppCard style={styles.card}>
          <AppText variant="heading" align="center">
            {tenantStatus === 'idle' ? 'No company membership found' : 'Could not load companies'}
          </AppText>
          <AppText variant="caption" align="center" style={styles.description}>
            {error?.message ?? 'Complete onboarding on the website or ask a manager for an invitation.'}
          </AppText>
          <AppButton title="Try again" onPress={() => void refreshWorkspaces()} />
        </AppCard>
      </CenteredState>
    );
  }

  return children;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f8fafc',
  },
  card: {
    width: '100%',
    maxWidth: 520,
  },
  description: {
    marginTop: 8,
    marginBottom: 20,
  },
  actions: {
    gap: 12,
  },
});

