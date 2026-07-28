import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import {
  InvitationCreateRequestSchema,
  WorkerUpdateRequestSchema,
  type WorkerDirectoryRole,
  type WorkerSummary,
} from '@smart-job/api-contracts';

import {
  borderRadius,
  getColors,
  shadows,
  spacing,
} from '../../../theme';
import { useAlert } from '../../../contexts/AlertContext';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTenant } from '../../../contexts/TenantContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import {
  AppButton,
  AppCard,
  AppChip,
  AppEmptyState,
  AppInput,
  AppText,
  GlobalHeader,
  LoadingSpinner,
} from '../../../components';
import { invalidateTenantQueries } from '../../../lib/query/client';
import { logger } from '../../../utils/logger';
import AccessibleModal from '../../../components/feedback/AccessibleModal';
import {
  createWorkerInvitation,
  disableWorkerMembership,
  updateWorkerMembership,
} from '../lib/workers-api';
import { useWorkersInfinite } from '../lib/use-workers-infinite';

interface Translation {
  readonly title: string;
  readonly subtitle: string;
  readonly inviteWorker: string;
  readonly editWorker: string;
  readonly name: string;
  readonly emailOptional: string;
  readonly phoneNumber: string;
  readonly role: string;
  readonly save: string;
  readonly cancel: string;
  readonly disable: string;
  readonly restore: string;
  readonly edit: string;
  readonly noWorkers: string;
  readonly invalidEmail: string;
  readonly invitationCreated: string;
  readonly workerUpdated: string;
  readonly workerDisabled: string;
  readonly workerRestored: string;
  readonly confirmDisable: string;
  readonly confirmRestore: string;
  readonly loading: string;
  readonly loadFailed: string;
  readonly refreshFailed: string;
  readonly retry: string;
  readonly loadMore: string;
  readonly inviteHelp: string;
  readonly unavailable: string;
}

const translations: Record<string, Translation> = {
  en: {
    title: 'Team workers',
    subtitle: 'Invite and manage workspace members',
    inviteWorker: 'Invite worker',
    editWorker: 'Edit worker',
    name: 'Display name',
    emailOptional: 'Worker email (optional)',
    phoneNumber: 'Phone number',
    role: 'Role',
    save: 'Save',
    cancel: 'Cancel',
    disable: 'Disable',
    restore: 'Restore',
    edit: 'Edit',
    noWorkers: 'No team members yet',
    invalidEmail: 'Enter a valid worker email.',
    invitationCreated: 'Invitation created',
    workerUpdated: 'Team member updated.',
    workerDisabled: 'Team access disabled.',
    workerRestored: 'Team access restored.',
    confirmDisable: 'Disable this member? Active jobs or assigned inventory may block this action.',
    confirmRestore: 'Restore this member’s workspace access?',
    loading: 'Loading workers...',
    loadFailed: 'Workers could not be loaded.',
    refreshFailed: 'The latest team changes could not be loaded. Showing saved data.',
    retry: 'Retry',
    loadMore: 'Load more',
    inviteHelp: 'Share the invitation code securely. The worker signs in with their own verified account and redeems it.',
    unavailable: 'Team management is available to managers on a Team-enabled workspace.',
  },
  he: {
    title: 'עובדי הצוות',
    subtitle: 'הזמנה וניהול של חברי סביבת העבודה',
    inviteWorker: 'הזמנת עובד',
    editWorker: 'עריכת עובד',
    name: 'שם תצוגה',
    emailOptional: 'אימייל העובד (אופציונלי)',
    phoneNumber: 'מספר טלפון',
    role: 'תפקיד',
    save: 'שמירה',
    cancel: 'ביטול',
    disable: 'השבתה',
    restore: 'שחזור',
    edit: 'עריכה',
    noWorkers: 'עדיין אין חברי צוות',
    invalidEmail: 'יש להזין כתובת אימייל תקינה.',
    invitationCreated: 'ההזמנה נוצרה',
    workerUpdated: 'חבר הצוות עודכן.',
    workerDisabled: 'הגישה לצוות הושבתה.',
    workerRestored: 'הגישה לצוות שוחזרה.',
    confirmDisable: 'להשבית את החבר? עבודות פעילות או מלאי מוקצה עשויים לחסום את הפעולה.',
    confirmRestore: 'לשחזר את הגישה של החבר לסביבת העבודה?',
    loading: 'טוען עובדים...',
    loadFailed: 'לא ניתן לטעון את העובדים.',
    refreshFailed: 'לא ניתן לטעון את השינויים האחרונים. מוצגים הנתונים השמורים.',
    retry: 'ניסיון חוזר',
    loadMore: 'טעינת נוספים',
    inviteHelp: 'שתפו את קוד ההזמנה באופן מאובטח. העובד מתחבר לחשבון מאומת משלו ומממש אותו.',
    unavailable: 'ניהול צוות זמין למנהלים בסביבת עבודה שבה מודול הצוות פעיל.',
  },
  ar: {
    title: 'عمال الفريق',
    subtitle: 'دعوة أعضاء مساحة العمل وإدارتهم',
    inviteWorker: 'دعوة عامل',
    editWorker: 'تعديل العامل',
    name: 'اسم العرض',
    emailOptional: 'بريد العامل (اختياري)',
    phoneNumber: 'رقم الهاتف',
    role: 'الدور',
    save: 'حفظ',
    cancel: 'إلغاء',
    disable: 'تعطيل',
    restore: 'استعادة',
    edit: 'تعديل',
    noWorkers: 'لا يوجد أعضاء في الفريق بعد',
    invalidEmail: 'أدخل بريدًا إلكترونيًا صالحًا.',
    invitationCreated: 'تم إنشاء الدعوة',
    workerUpdated: 'تم تحديث عضو الفريق.',
    workerDisabled: 'تم تعطيل الوصول إلى الفريق.',
    workerRestored: 'تمت استعادة الوصول إلى الفريق.',
    confirmDisable: 'هل تريد تعطيل هذا العضو؟ قد تمنع المهام النشطة أو المخزون المخصص هذه العملية.',
    confirmRestore: 'هل تريد استعادة وصول هذا العضو إلى مساحة العمل؟',
    loading: 'جارٍ تحميل العمال...',
    loadFailed: 'تعذر تحميل العمال.',
    refreshFailed: 'تعذر تحميل آخر تغييرات الفريق. يتم عرض البيانات المحفوظة.',
    retry: 'إعادة المحاولة',
    loadMore: 'تحميل المزيد',
    inviteHelp: 'شارك رمز الدعوة بأمان. يسجل العامل الدخول بحسابه الموثق ثم يستخدم الرمز.',
    unavailable: 'إدارة الفريق متاحة للمديرين في مساحة عمل مفعّل فيها الفريق.',
  },
};

const ROLE_OPTIONS: readonly WorkerDirectoryRole[] = ['worker', 'user', 'basic'];

interface EditDraft {
  readonly worker: WorkerSummary;
  readonly displayName: string;
  readonly phoneNumber: string;
  readonly role: WorkerDirectoryRole;
}

interface PendingActionKey {
  readonly fingerprint: string;
  readonly key: string;
}

export default function WorkersUsers() {
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { user } = useSession();
  const { workspace, status: tenantStatus } = useTenant();
  const palette = getColors(isDarkMode);
  const t = translations[language] ?? translations.en;
  const uid = user?.uid ?? null;
  const companyId = workspace?.companyId ?? null;
  const canManageTeam = workspace !== null
    && (workspace.role === 'manager' || workspace.role === 'dev')
    && (workspace.role === 'dev' || workspace.enabledModules.includes('team'));
  const { query: workersQuery, workers } = useWorkersInfinite({
    uid,
    companyId,
    enabled: tenantStatus === 'ready' && canManageTeam,
  });

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const actionKeysRef = useRef(new Map<string, PendingActionKey>());

  useEffect(() => {
    actionKeysRef.current.clear();
    setShowInviteModal(false);
    setInviteEmail('');
    setEditDraft(null);
    setBusyAction(null);
  }, [companyId, uid]);

  const requireScope = (): { uid: string; companyId: number } => {
    if (!uid || !companyId || !canManageTeam) {
      throw new Error('An authorized Team workspace is required.');
    }
    return { uid, companyId };
  };

  const keyFor = (action: string, fingerprint: string): string => {
    const current = actionKeysRef.current.get(action);
    if (current?.fingerprint === fingerprint) return current.key;
    const key = randomUUID();
    actionKeysRef.current.set(action, { fingerprint, key });
    return key;
  };

  const completeKey = (action: string, key: string) => {
    if (actionKeysRef.current.get(action)?.key === key) {
      actionKeysRef.current.delete(action);
    }
  };

  const refreshWorkers = async () => {
    if (!uid || !companyId) return;
    await invalidateTenantQueries(uid, companyId, 'workers');
  };

  const handleInvite = async () => {
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    const parsed = InvitationCreateRequestSchema.safeParse({
      targetRole: 'worker',
      targetEmail: normalizedEmail || undefined,
      expiresInDays: 30,
    });
    if (!parsed.success) {
      alert.error('Error', t.invalidEmail);
      return;
    }

    const action = 'invite';
    const key = keyFor(action, JSON.stringify(parsed.data));
    try {
      setBusyAction(action);
      const result = await createWorkerInvitation({
        ...requireScope(),
        request: parsed.data,
        idempotencyKey: key,
      });
      completeKey(action, key);
      setShowInviteModal(false);
      setInviteEmail('');
      alert.success(
        t.invitationCreated,
        `${t.inviteHelp}\n\n${result.inviteCode}`,
      );
    } catch (error: unknown) {
      logger.error('Worker invitation failed', error);
      alert.error('Error', error instanceof Error ? error.message : 'Failed to create invitation.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleEdit = async () => {
    if (!editDraft) return;
    const body = WorkerUpdateRequestSchema.parse({
      entityVersion: editDraft.worker.entityVersion,
      displayName: editDraft.displayName.trim() || null,
      phoneNumber: editDraft.phoneNumber.trim() || null,
      role: editDraft.role,
    });
    const action = `edit:${editDraft.worker.memberNo}`;
    const key = keyFor(action, JSON.stringify(body));
    try {
      setBusyAction(action);
      await updateWorkerMembership({
        ...requireScope(),
        memberNo: editDraft.worker.memberNo,
        request: body,
        idempotencyKey: key,
      });
      completeKey(action, key);
      setEditDraft(null);
      await refreshWorkers();
      alert.success('Success', t.workerUpdated);
    } catch (error: unknown) {
      logger.error('Worker update failed', error);
      alert.error('Error', error instanceof Error ? error.message : 'Failed to update worker.');
    } finally {
      setBusyAction(null);
    }
  };

  const changeMembershipStatus = async (worker: WorkerSummary, restore: boolean) => {
    const action = `${restore ? 'restore' : 'disable'}:${worker.memberNo}`;
    const body = restore
      ? WorkerUpdateRequestSchema.parse({ entityVersion: worker.entityVersion, status: 'active' })
      : { entityVersion: worker.entityVersion };
    const key = keyFor(action, JSON.stringify(body));
    try {
      setBusyAction(action);
      if (restore) {
        await updateWorkerMembership({
          ...requireScope(),
          memberNo: worker.memberNo,
          request: body,
          idempotencyKey: key,
        });
      } else {
        await disableWorkerMembership({
          ...requireScope(),
          worker,
          idempotencyKey: key,
        });
      }
      completeKey(action, key);
      await refreshWorkers();
      alert.success('Success', restore ? t.workerRestored : t.workerDisabled);
    } catch (error: unknown) {
      logger.error(`Worker ${restore ? 'restore' : 'disable'} failed`, error);
      alert.error('Error', error instanceof Error ? error.message : 'Failed to change worker access.');
    } finally {
      setBusyAction(null);
    }
  };

  const confirmMembershipStatus = (worker: WorkerSummary, restore: boolean) => {
    alert.confirm(
      restore ? t.restore : t.disable,
      restore ? t.confirmRestore : t.confirmDisable,
      [
        { text: t.cancel, style: 'cancel', onPress: () => {} },
        {
          text: restore ? t.restore : t.disable,
          style: restore ? 'default' : 'destructive',
          onPress: () => { void changeMembershipStatus(worker, restore); },
        },
      ],
    );
  };

  const renderWorker = ({ item }: { item: WorkerSummary }) => {
    const isDisabled = item.status === 'disabled';
    return (
      <AppCard style={styles.workerCard}>
        <View style={styles.workerTopRow}>
          <View style={[styles.avatar, { backgroundColor: `${palette.secondary}20` }]}>
            <MaterialCommunityIcons name="account-outline" size={24} color={palette.secondary} />
          </View>
          <View style={styles.workerInfo}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {item.displayName || item.email || `#${item.memberNo}`}
            </AppText>
            {item.email ? (
              <AppText variant="caption" color={palette.textSecondary} numberOfLines={1}>
                {item.email}
              </AppText>
            ) : null}
            {item.phoneNumber ? (
              <AppText variant="caption" color={palette.textLight}>
                {item.phoneNumber}
              </AppText>
            ) : null}
          </View>
          <View style={styles.chipColumn}>
            <AppChip label={item.role} status={item.role} size="sm" />
            <AppChip label={item.status} status={item.status} size="sm" />
          </View>
        </View>

        <View style={styles.workerActions}>
          <AppButton
            title={t.edit}
            variant="secondary"
            iconLeft={{ name: 'create-outline' }}
            onPress={() => {
              setEditDraft({
                worker: item,
                displayName: item.displayName ?? '',
                phoneNumber: item.phoneNumber ?? '',
                role: item.role,
              });
            }}
            disabled={busyAction !== null}
            style={styles.workerActionBtn}
          />
          <AppButton
            title={isDisabled ? t.restore : t.disable}
            variant={isDisabled ? 'success' : 'destructive'}
            iconLeft={{ name: isDisabled ? 'refresh-outline' : 'remove-circle-outline' }}
            onPress={() => confirmMembershipStatus(item, isDisabled)}
            loading={busyAction === `${isDisabled ? 'restore' : 'disable'}:${item.memberNo}`}
            disabled={busyAction !== null}
            style={styles.workerActionBtn}
          />
        </View>
      </AppCard>
    );
  };

  const renderInviteForm = () => (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.modalOverlay, { backgroundColor: palette.overlay }]}
    >
      <AppCard style={styles.modalCard}>
        <AppText variant="heading">{t.inviteWorker}</AppText>
        <AppInput
          label={t.emailOptional}
          value={inviteEmail}
          onChangeText={setInviteEmail}
          placeholder="worker@company.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoFocus
        />
        <AppText variant="caption" color={palette.textSecondary}>
          {t.inviteHelp}
        </AppText>
        <View style={styles.modalActions}>
          <AppButton
            title={t.cancel}
            variant="secondary"
            onPress={() => {
              setShowInviteModal(false);
              setInviteEmail('');
            }}
            disabled={busyAction !== null}
            style={styles.modalButton}
          />
          <AppButton
            title={t.inviteWorker}
            onPress={() => { void handleInvite(); }}
            loading={busyAction === 'invite'}
            disabled={busyAction !== null}
            style={styles.modalButton}
          />
        </View>
      </AppCard>
    </KeyboardAvoidingView>
  );

  const renderEditForm = () => {
    if (!editDraft) return null;
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.modalOverlay, { backgroundColor: palette.overlay }]}
      >
        <AppCard style={styles.modalCard}>
          <AppText variant="heading">{t.editWorker}</AppText>
          {editDraft.worker.email ? (
            <AppText variant="caption" color={palette.textSecondary}>
              {editDraft.worker.email}
            </AppText>
          ) : null}
          <AppInput
            label={t.name}
            value={editDraft.displayName}
            onChangeText={(displayName) => setEditDraft((current) => (
              current ? { ...current, displayName } : current
            ))}
            placeholder={t.name}
            autoFocus
          />
          <AppInput
            label={t.phoneNumber}
            value={editDraft.phoneNumber}
            onChangeText={(phoneNumber) => setEditDraft((current) => (
              current ? { ...current, phoneNumber } : current
            ))}
            placeholder="+972..."
            keyboardType="phone-pad"
          />
          <AppText variant="caption" color={palette.textSecondary}>{t.role}</AppText>
          <View style={styles.roleChoices}>
            {ROLE_OPTIONS.map((role) => (
              <AppButton
                key={role}
                title={role}
                variant={editDraft.role === role ? 'primary' : 'secondary'}
                size="sm"
                onPress={() => setEditDraft((current) => (
                  current ? { ...current, role } : current
                ))}
                disabled={busyAction !== null}
                style={styles.roleButton}
              />
            ))}
          </View>
          <View style={styles.modalActions}>
            <AppButton
              title={t.cancel}
              variant="secondary"
              onPress={() => setEditDraft(null)}
              disabled={busyAction !== null}
              style={styles.modalButton}
            />
            <AppButton
              title={t.save}
              onPress={() => { void handleEdit(); }}
              loading={busyAction === `edit:${editDraft.worker.memberNo}`}
              disabled={busyAction !== null}
              style={styles.modalButton}
            />
          </View>
        </AppCard>
      </KeyboardAvoidingView>
    );
  };

  if (tenantStatus === 'ready' && !canManageTeam) {
    return (
      <View style={[styles.container, { backgroundColor: palette.background }]}>
        <StatusBar style={isDarkMode ? 'light' : 'dark'} />
        <View style={styles.unavailableWrap}>
          <AppEmptyState icon="account-lock-outline" title={t.unavailable} />
        </View>
        <GlobalHeader />
      </View>
    );
  }

  if ((tenantStatus === 'loading' || workersQuery.isLoading) && workers.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: palette.background }]}>
        <StatusBar style={isDarkMode ? 'light' : 'dark'} />
        <View style={styles.loadingWrap}>
          <LoadingSpinner text={t.loading} />
        </View>
        <GlobalHeader />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />

      <FlatList
        data={workers}
        keyExtractor={(item) => String(item.memberNo)}
        renderItem={renderWorker}
        onRefresh={() => { void workersQuery.refetch(); }}
        refreshing={workersQuery.isRefetching && !workersQuery.isFetchingNextPage}
        onEndReached={() => {
          if (workersQuery.hasNextPage && !workersQuery.isFetchingNextPage) {
            void workersQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.4}
        contentContainerStyle={[
          styles.listContent,
          workers.length === 0 && styles.emptyListContent,
        ]}
        ListHeaderComponent={
          <View style={styles.headerSection}>
            <AppText variant="title">{t.title}</AppText>
            <AppText variant="caption" color={palette.textSecondary}>
              {t.subtitle}
            </AppText>
            <AppButton
              title={t.inviteWorker}
              iconLeft={{ name: 'add-circle-outline' }}
              onPress={() => setShowInviteModal(true)}
              disabled={busyAction !== null}
              style={styles.addButton}
            />
            {workersQuery.isError && workers.length > 0 ? (
              <AppCard style={[styles.errorBanner, { borderColor: palette.error }]}>
                <AppText variant="caption" color={palette.textPrimary}>
                  {t.refreshFailed}
                </AppText>
                <AppButton
                  title={t.retry}
                  variant="secondary"
                  size="sm"
                  onPress={() => { void workersQuery.refetch(); }}
                  loading={workersQuery.isFetching}
                />
              </AppCard>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <AppEmptyState
            icon={workersQuery.isError ? 'cloud-alert-outline' : 'account-group-outline'}
            title={workersQuery.isError ? t.loadFailed : t.noWorkers}
            action={
              workersQuery.isError
                ? <AppButton title={t.retry} onPress={() => { void workersQuery.refetch(); }} />
                : <AppButton title={t.inviteWorker} onPress={() => setShowInviteModal(true)} />
            }
          />
        }
        ListFooterComponent={
          workersQuery.hasNextPage ? (
            <AppButton
              title={t.loadMore}
              variant="secondary"
              onPress={() => { void workersQuery.fetchNextPage(); }}
              loading={workersQuery.isFetchingNextPage}
              style={styles.loadMoreButton}
            />
          ) : null
        }
      />

      <AccessibleModal
        visible={showInviteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInviteModal(false)}
        announcement={t.inviteWorker}
      >
        {renderInviteForm()}
      </AccessibleModal>

      <AccessibleModal
        visible={editDraft !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditDraft(null)}
        announcement="Edit team member"
      >
        {renderEditForm()}
      </AccessibleModal>

      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unavailableWrap: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'ios' ? 108 : 96,
  },
  listContent: {
    paddingTop: Platform.OS === 'ios' ? 108 : 96,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl + 80,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  headerSection: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  addButton: {
    marginTop: spacing.xs,
  },
  errorBanner: {
    gap: spacing.sm,
    borderWidth: 1,
  },
  workerCard: {
    marginBottom: spacing.md,
    ...shadows.card,
  },
  workerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workerInfo: {
    flex: 1,
    gap: 2,
  },
  chipColumn: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  workerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  workerActionBtn: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 460,
    gap: spacing.sm,
  },
  roleChoices: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  roleButton: {
    flex: 1,
    borderRadius: borderRadius.md,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  modalButton: {
    flex: 1,
  },
  loadMoreButton: {
    marginTop: spacing.sm,
  },
});
