import { ROUTES } from '../../../navigation/routes';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getColors, spacing } from '../../../theme';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTenant } from '../../../contexts/TenantContext';
import {
  AppButton,
  AppCard,
  AppEmptyState,
  AppText,
  DashboardActionCard,
  DashboardShell,
  GlobalHeader,
} from '../../../components';
import type { IconLibrary } from '../../../components/primitives/AppIcon';
import { logger } from '../../../utils/logger';
import NotAvailableScreen from '../../shared/NotAvailableScreen';
import {
  bootstrapCountValues,
  canLoadWorkerBootstrap,
} from '../lib/home-bootstrap-model';
import { useCompanyBootstrap } from '../lib/use-company-bootstrap';

const translations = {
  en: {
    title: 'Worker Dashboard',
    subtitle: 'Field execution workspace',
    description: 'See assigned jobs and inventory in a simpler mobile layout designed for movement, speed, and clear next actions.',
    heroLabel: 'Worker access',
    open: 'Open workspace',
    emptyTitle: 'No modules available',
    emptySubtitle: 'This worker account does not have any active dashboard areas.',
    expiredTitle: 'Subscription Expired',
    expiredSubtitle: 'Renew the subscription on the website to restore worker access.',
    roleMetric: 'Role',
    roleValue: 'Worker',
    scopeMetric: 'Scope',
    scopeValue: 'Assigned',
    moduleMetric: 'Areas',
    myJobs: 'My Jobs',
    myJobsDesc: 'View your assigned jobs and move them forward from the field.',
    inventory: 'My Inventory',
    inventoryDesc: 'Check the parts you carry and open your inventory quickly.',
    workBadge: 'Field',
  },
  he: {
    title: 'לוח בקרה עובד',
    subtitle: 'סביבת ביצוע בשטח',
    description: 'צפייה במשימות שהוקצו ובמלאי מתוך פריסה פשוטה יותר שמותאמת לעבודה מהירה בשטח.',
    heroLabel: 'גישת עובד',
    open: 'פתח סביבת עבודה',
    emptyTitle: 'אין מודולים זמינים',
    emptySubtitle: 'לחשבון העובד הזה אין כרגע אזורי עבודה פעילים.',
    expiredTitle: 'המנוי פג תוקף',
    expiredSubtitle: 'חדש את המנוי דרך האתר כדי להחזיר את הגישה לעובד.',
    roleMetric: 'תפקיד',
    roleValue: 'עובד',
    scopeMetric: 'היקף',
    scopeValue: 'מוקצה',
    moduleMetric: 'אזורים',
    myJobs: 'המשימות שלי',
    myJobsDesc: 'צפייה במשימות שהוקצו והתקדמות מהירה מתוך השטח.',
    inventory: 'המלאי שלי',
    inventoryDesc: 'בדיקת החלקים שברשותך ופתיחה מהירה של המלאי.',
    workBadge: 'שטח',
  },
  ar: {
    title: 'لوحة تحكم العامل',
    subtitle: 'مساحة تنفيذ ميدانية',
    description: 'اعرض المهام المعيّنة والمخزون من تخطيط أبسط مصمم للحركة والسرعة ووضوح الخطوة التالية.',
    heroLabel: 'وصول العامل',
    open: 'افتح مساحة العمل',
    emptyTitle: 'لا توجد وحدات متاحة',
    emptySubtitle: 'هذا الحساب الخاص بالعامل لا يملك مناطق عمل فعالة حالياً.',
    expiredTitle: 'انتهى الاشتراك',
    expiredSubtitle: 'جدّد الاشتراك عبر الموقع لاستعادة وصول العامل.',
    roleMetric: 'الدور',
    roleValue: 'عامل',
    scopeMetric: 'النطاق',
    scopeValue: 'مكلّف',
    moduleMetric: 'المساحات',
    myJobs: 'مهامي',
    myJobsDesc: 'اعرض مهامك المعيّنة وادفعها للأمام من الميدان.',
    inventory: 'مخزوني',
    inventoryDesc: 'تحقق من القطع التي تحملها وافتح المخزون بسرعة.',
    workBadge: 'ميداني',
  },
};

const bootstrapTranslations = {
  en: {
    jobsMetric: 'Assigned jobs',
    inventoryMetric: 'Parts',
    loadingCounts: 'Loading live dashboard totals...',
    loadFailed: 'Dashboard totals could not be loaded.',
    refreshFailed: 'Dashboard totals could not be refreshed. Saved totals remain visible.',
    retry: 'Retry',
  },
  he: {
    jobsMetric: 'משימות מוקצות',
    inventoryMetric: 'חלקים',
    loadingCounts: 'טוען נתוני לוח בקרה עדכניים...',
    loadFailed: 'לא ניתן היה לטעון את נתוני לוח הבקרה.',
    refreshFailed: 'לא ניתן היה לרענן את הנתונים. הנתונים השמורים נשארו מוצגים.',
    retry: 'נסה שוב',
  },
  ar: {
    jobsMetric: 'المهام المعيّنة',
    inventoryMetric: 'القطع',
    loadingCounts: 'جارٍ تحميل إجماليات لوحة التحكم...',
    loadFailed: 'تعذر تحميل إجماليات لوحة التحكم.',
    refreshFailed: 'تعذر تحديث الإجماليات. ستبقى القيم المحفوظة ظاهرة.',
    retry: 'إعادة المحاولة',
  },
};

export default function WorkerHomepage() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const { user } = useSession();
  const { workspace, status: tenantStatus } = useTenant();
  const colors = getColors(isDarkMode);
  const t = translations[language] || translations.en;
  const bt = bootstrapTranslations[language] || bootstrapTranslations.en;

  const enabledModules = new Set(workspace?.enabledModules ?? []);
  const hasJobs = enabledModules.has('solojob');
  const hasInventory = enabledModules.has('inventory');
  const workspaceActive = canLoadWorkerBootstrap(workspace);
  const bootstrapQuery = useCompanyBootstrap({
    uid: user?.id ?? null,
    companyId: workspace?.companyId ?? null,
    enabled: tenantStatus === 'ready' && workspaceActive,
  });
  const countValues = bootstrapCountValues(bootstrapQuery.data?.counts);

  useEffect(() => {
    if (bootstrapQuery.error) {
      logger.warn('Worker dashboard bootstrap refresh failed; retaining cached totals', bootstrapQuery.error);
    }
  }, [bootstrapQuery.error]);

  const cards: Array<{
    key: string;
    title: string;
    description: string;
    icon: string;
    iconLibrary: IconLibrary;
    accentColor: string;
    badge: string;
    onPress: () => void;
  }> = [
    ...(hasJobs
      ? [{
          key: 'my-jobs',
          title: t.myJobs,
          description: t.myJobsDesc,
          icon: 'clipboard-text-multiple',
          iconLibrary: 'material' as IconLibrary,
          accentColor: colors.boxBlue,
          badge: t.workBadge,
          onPress: () => router.push(ROUTES.workerJobs),
        }]
      : []),
    ...(hasInventory
      ? [{
          key: 'inventory',
          title: t.inventory,
          description: t.inventoryDesc,
          icon: 'package-variant',
          iconLibrary: 'material' as IconLibrary,
          accentColor: colors.boxOrange,
          badge: t.workBadge,
          onPress: () => router.push(ROUTES.inventory),
        }]
      : []),
  ];

  if (workspace && workspace.role !== 'worker') {
    return <NotAvailableScreen reason="role" />;
  }

  if (!workspaceActive) {
    return (
      <View style={[styles.lockedContainer, { backgroundColor: colors.background }]}> 
        <StatusBar style={isDarkMode ? 'light' : 'dark'} />
        <AppEmptyState
          icon="clock-alert-outline"
          title={t.expiredTitle}
          subtitle={t.expiredSubtitle}
          style={styles.lockedState}
        />
        <GlobalHeader />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}> 
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <DashboardShell
        title={t.title}
        subtitle={t.subtitle}
        description={t.description}
        heroLabel={t.heroLabel}
        heroIcon="hammer-wrench"
        heroIconLibrary="material"
        metrics={[
          { label: t.roleMetric, value: t.roleValue },
          { label: bt.jobsMetric, value: countValues.jobs },
          { label: bt.inventoryMetric, value: countValues.inventoryParts },
        ]}
      >
        {bootstrapQuery.isLoading ? (
          <AppCard style={styles.bootstrapStateCard}>
            <ActivityIndicator size="small" color={colors.secondary} />
            <AppText color={colors.textSecondary}>{bt.loadingCounts}</AppText>
          </AppCard>
        ) : null}
        {bootstrapQuery.isError ? (
          <AppCard style={[styles.bootstrapStateCard, { borderColor: colors.error }]}>
            <AppText color={colors.textPrimary}>
              {bootstrapQuery.data ? bt.refreshFailed : bt.loadFailed}
            </AppText>
            <AppButton
              title={bt.retry}
              size="sm"
              loading={bootstrapQuery.isFetching}
              onPress={() => { void bootstrapQuery.refetch(); }}
              style={styles.retryButton}
            />
          </AppCard>
        ) : null}
        {cards.length > 0 ? (
          cards.map((card) => (
            <DashboardActionCard
              key={card.key}
              testID={`dashboard-action-${card.key}`}
              title={card.title}
              description={card.description}
              icon={card.icon}
              iconLibrary={card.iconLibrary}
              accentColor={card.accentColor}
              badge={card.badge}
              ctaLabel={t.open}
              onPress={card.onPress}
            />
          ))
        ) : (
          <AppEmptyState title={t.emptyTitle} subtitle={t.emptySubtitle} />
        )}
      </DashboardShell>
      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  lockedContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  lockedState: {
    marginBottom: spacing.xxl,
  },
  bootstrapStateCard: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  retryButton: {
    marginLeft: 'auto',
  },
});
