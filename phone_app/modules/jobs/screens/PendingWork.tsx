import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';

import {
  AppButton,
  AppCard,
  AppText,
  GlobalHeader,
  ScrollableContainer,
} from '../../../components';
import { useAlert } from '../../../contexts/AlertContext';
import { useOutbox } from '../../../contexts/OutboxContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import type { OutboxOperation } from '../../../lib/outbox/database';
import type { OutboxOperationResult } from '../../../lib/outbox/processor';
import { borderRadius, getColors, shadows, spacing } from '../../../theme';
import { logger } from '../../../utils/logger';

function operationTitle(operation: OutboxOperation): string {
  return operation.kind === 'job.create_finished'
    ? 'Finished job waiting to be created'
    : 'Assigned job waiting for completion';
}

function operationStatus(operation: OutboxOperation): {
  readonly label: string;
  readonly tone: 'error' | 'warning' | 'neutral';
} {
  if (operation.status === 'conflict') return { label: 'Conflict needs review', tone: 'error' };
  if (operation.status === 'terminal_error') return { label: 'Server rejected', tone: 'error' };
  if (operation.status === 'retry_wait') return { label: 'Waiting to retry', tone: 'warning' };
  if (operation.status === 'paused_auth') return { label: 'Waiting for authentication', tone: 'warning' };
  if (operation.status === 'syncing') return { label: 'Synchronizing', tone: 'neutral' };
  return { label: 'Queued on this device', tone: 'neutral' };
}

export default function PendingWork() {
  const { isDarkMode } = useThemeContext();
  const colors = getColors(isDarkMode);
  const alert = useAlert();
  const {
    ready,
    syncing,
    operations,
    retry,
    refresh,
    discard,
  } = useOutbox();
  const [activeOperationId, setActiveOperationId] = useState<string | null>(null);

  useEffect(() => {
    void refresh().catch((error) => {
      logger.warn('Pending work could not be refreshed:', error);
    });
  }, [refresh]);

  const showRetryResult = (result: OutboxOperationResult) => {
    if (result.outcome === 'reconciled') {
      alert.success('Synchronized', 'The server confirmed this job operation.');
      return;
    }
    if (result.outcome === 'conflict') {
      alert.error(
        'Conflict still needs review',
        'The server has a newer job version. Refresh the job before replacing this pending completion.',
      );
      return;
    }
    if (result.outcome === 'terminal') {
      alert.error(
        'Server rejected this work',
        result.errorMessage ?? 'Review your access and the job state before retrying or discarding it.',
      );
      return;
    }
    if (result.outcome === 'retry') {
      alert.warning('Still waiting', 'The network request failed. The encrypted work remains on this device.');
      return;
    }
    alert.info('Still queued', 'The server has not confirmed this operation yet.');
  };

  const handleRetry = async (operationId: string) => {
    setActiveOperationId(operationId);
    try {
      showRetryResult(await retry(operationId));
    } catch (error) {
      logger.warn('Manual pending-work retry failed:', error);
      alert.warning('Retry unavailable', 'The encrypted work remains on this device. Try again later.');
    } finally {
      setActiveOperationId(null);
    }
  };

  const handleRefresh = async () => {
    try {
      await refresh();
    } catch (error) {
      logger.warn('Pending work could not be refreshed:', error);
      alert.warning('Refresh unavailable', 'Your pending work remains safely stored on this device.');
    }
  };

  const requestDiscard = (operation: OutboxOperation) => {
    alert.confirm(
      'Discard pending work?',
      'This permanently removes the queued operation and its encrypted attachments from this device.',
      [
        { text: 'Keep work', style: 'cancel', onPress: () => undefined },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            setActiveOperationId(operation.id);
            try {
              await discard(operation.id);
              alert.success('Discarded', 'The pending work and staged attachments were removed.');
            } catch (error) {
              logger.error('Pending work could not be discarded:', error);
              alert.error('Could not discard', 'The work remains safely stored on this device.');
            } finally {
              setActiveOperationId(null);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <ScrollableContainer contentContainerStyle={styles.content}>
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <AppText variant="title">Pending Work</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              Encrypted jobs stored on this device until the server confirms them.
            </AppText>
          </View>
          <AppButton
            title="Refresh"
            size="sm"
            variant="secondary"
            iconLeft={{ name: 'refresh', library: 'material' }}
            disabled={!ready || syncing}
            onPress={() => void handleRefresh()}
          />
        </View>

        {!ready ? (
          <View style={styles.centeredState}>
            <ActivityIndicator size="large" color={colors.secondary} />
            <AppText variant="caption" color={colors.textSecondary}>
              Opening your encrypted pending-work database…
            </AppText>
          </View>
        ) : operations.length === 0 ? (
          <AppCard style={[styles.emptyCard, { borderColor: colors.border }]}>
            <MaterialCommunityIcons name="cloud-check-outline" size={44} color={colors.success} />
            <AppText variant="heading" align="center">Everything is synchronized</AppText>
            <AppText variant="caption" align="center" color={colors.textSecondary}>
              New offline job work will appear here until it is confirmed.
            </AppText>
          </AppCard>
        ) : (
          <View style={styles.list}>
            {operations.map((operation) => {
              const status = operationStatus(operation);
              const statusColor = status.tone === 'error'
                ? colors.error
                : status.tone === 'warning'
                  ? colors.warning
                  : colors.secondary;
              const busy = activeOperationId === operation.id;
              return (
                <AppCard
                  key={operation.id}
                  style={[
                    styles.operationCard,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <View style={styles.operationHeader}>
                    <View style={[styles.iconBox, { backgroundColor: `${statusColor}18` }]}>
                      <MaterialCommunityIcons
                        name={operation.kind === 'job.create_finished' ? 'clipboard-plus-outline' : 'clipboard-check-outline'}
                        size={24}
                        color={statusColor}
                      />
                    </View>
                    <View style={styles.operationHeadingCopy}>
                      <AppText variant="bodyStrong">{operationTitle(operation)}</AppText>
                      <AppText variant="caption" color={colors.textSecondary}>
                        Company {operation.companyId} · {new Date(operation.createdAt).toLocaleString()}
                      </AppText>
                    </View>
                  </View>

                  <View style={[styles.statusBadge, { borderColor: statusColor }]}>
                    <AppText variant="badge" color={statusColor}>{status.label}</AppText>
                  </View>

                  {operation.lastErrorMessage ? (
                    <AppText variant="caption" color={colors.textSecondary} style={styles.errorCopy}>
                      {operation.lastErrorMessage}
                    </AppText>
                  ) : null}

                  <View style={styles.actions}>
                    <AppButton
                      title="Retry"
                      size="sm"
                      loading={busy}
                      disabled={syncing || Boolean(activeOperationId)}
                      iconLeft={{ name: 'refresh', library: 'material' }}
                      style={styles.actionButton}
                      onPress={() => void handleRetry(operation.id)}
                    />
                    <AppButton
                      title="Discard"
                      size="sm"
                      variant="destructive"
                      disabled={syncing || Boolean(activeOperationId)}
                      iconLeft={{ name: 'delete-outline', library: 'material' }}
                      style={styles.actionButton}
                      onPress={() => requestDiscard(operation)}
                    />
                  </View>
                </AppCard>
              );
            })}
          </View>
        )}
      </ScrollableContainer>
      <GlobalHeader />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 120,
    gap: spacing.lg,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headingCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  centeredState: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  emptyCard: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  list: {
    gap: spacing.md,
  },
  operationCard: {
    padding: spacing.lg,
    borderRadius: borderRadius.xl,
    ...shadows.sm,
  },
  operationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  operationHeadingCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginTop: spacing.md,
  },
  errorCopy: {
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  actionButton: {
    flex: 1,
  },
});
