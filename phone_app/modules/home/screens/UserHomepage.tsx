import { ROUTES } from '../../../navigation/routes';
import { useEffect, useState } from 'react';
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
  canLoadUserBootstrap,
} from '../lib/home-bootstrap-model';
import { useCompanyBootstrap } from '../lib/use-company-bootstrap';

const translations = {
  en: {
    title: 'User Dashboard',
    subtitle: 'Owner-operator workspace',
    description: 'Move between your field work, inventory, clients, and document tools from a cleaner single-screen mobile layout.',
    heroLabel: 'User access',
    open: 'Open workspace',
    emptyTitle: 'No modules available',
    emptySubtitle: 'This account does not have any active dashboard areas yet.',
    expiredTitle: 'Subscription Expired',
    expiredSubtitle: 'Renew the subscription on the website to restore access to this workspace.',
    roleMetric: 'Role',
    roleValue: 'User',
    scopeMetric: 'Scope',
    scopeValue: 'Personal',
    moduleMetric: 'Areas',
    jobsMetric: 'Jobs',
    clientsMetric: 'Clients',
    inventoryMetric: 'Parts',
    documentsMetric: 'Documents',
    loadingCounts: 'Loading live dashboard totals...',
    loadFailed: 'Dashboard totals could not be loaded.',
    refreshFailed: 'Dashboard totals could not be refreshed. Saved totals remain visible.',
    retry: 'Retry',
    workTab: 'Work',
    documentsTab: 'Documents',
    createJob: 'Create & Fill Job',
    createJobDesc: 'Build your own jobs, update progress, and complete them from one flow.',
    inventory: 'My Inventory',
    inventoryDesc: 'Review your current parts and stock levels without leaving the dashboard.',
    clientBook: 'Client Book',
    clientBookDesc: 'Open your client records and customer contact details.',
    generalDocs: 'General Documents',
    generalDocsDesc: 'Create business documents directly inside the mobile workspace.',
    taxInvoice: 'Generate Tax Invoice',
    taxInvoiceDesc: 'Generate invoices from completed jobs when documents are enabled.',
    documentHistory: 'Document History',
    documentHistoryDesc: 'See the complete list of documents you already created.',
    workBadge: 'Work',
    docsBadge: 'Docs',
  },
  he: {
    title: 'לוח בקרה משתמש',
    subtitle: 'סביבת עבודה אישית',
    description: 'מעבר מהיר בין עבודה בשטח, מלאי, לקוחות וכלי מסמכים מתוך מסך אחד נקי יותר במובייל.',
    heroLabel: 'גישת משתמש',
    open: 'פתח סביבת עבודה',
    emptyTitle: 'אין מודולים זמינים',
    emptySubtitle: 'לחשבון הזה אין כרגע אזורי עבודה פעילים.',
    expiredTitle: 'המנוי פג תוקף',
    expiredSubtitle: 'חדש את המנוי דרך האתר כדי להחזיר את הגישה לסביבת העבודה.',
    roleMetric: 'תפקיד',
    roleValue: 'משתמש',
    scopeMetric: 'היקף',
    scopeValue: 'אישי',
    moduleMetric: 'אזורים',
    jobsMetric: 'משימות',
    clientsMetric: 'לקוחות',
    inventoryMetric: 'חלקים',
    documentsMetric: 'מסמכים',
    loadingCounts: 'טוען נתוני לוח בקרה עדכניים...',
    loadFailed: 'לא ניתן היה לטעון את נתוני לוח הבקרה.',
    refreshFailed: 'לא ניתן היה לרענן את הנתונים. הנתונים השמורים נשארו מוצגים.',
    retry: 'נסה שוב',
    workTab: 'עבודה',
    documentsTab: 'מסמכים',
    createJob: 'יצירה ומילוי משימה',
    createJobDesc: 'יצירת משימות אישיות, עדכון התקדמות והשלמה מתוך זרימה אחת.',
    inventory: 'המלאי שלי',
    inventoryDesc: 'בדיקת חלקים ומלאי אישי בלי לצאת מלוח הבקרה.',
    clientBook: 'ספר לקוחות',
    clientBookDesc: 'גישה לרישומי לקוחות ופרטי קשר.',
    generalDocs: 'מסמכים כלליים',
    generalDocsDesc: 'יצירת מסמכים עסקיים ישירות מתוך סביבת העבודה במובייל.',
    taxInvoice: 'יצירת חשבונית מס',
    taxInvoiceDesc: 'הפקת חשבוניות ממשימות שהושלמו כשהמסמכים פעילים.',
    documentHistory: 'היסטוריית מסמכים',
    documentHistoryDesc: 'צפייה ברשימת כל המסמכים שכבר יצרת.',
    workBadge: 'עבודה',
    docsBadge: 'מסמכים',
  },
  ar: {
    title: 'لوحة تحكم المستخدم',
    subtitle: 'مساحة عمل فردية',
    description: 'تنقّل بسرعة بين العمل الميداني والمخزون والعملاء وأدوات المستندات من شاشة جوال أوضح وأكثر ترتيباً.',
    heroLabel: 'وصول المستخدم',
    open: 'افتح مساحة العمل',
    emptyTitle: 'لا توجد وحدات متاحة',
    emptySubtitle: 'هذا الحساب لا يملك مناطق عمل فعالة حالياً.',
    expiredTitle: 'انتهى الاشتراك',
    expiredSubtitle: 'جدّد الاشتراك عبر الموقع لاستعادة الوصول إلى مساحة العمل هذه.',
    roleMetric: 'الدور',
    roleValue: 'مستخدم',
    scopeMetric: 'النطاق',
    scopeValue: 'شخصي',
    moduleMetric: 'المساحات',
    jobsMetric: 'المهام',
    clientsMetric: 'العملاء',
    inventoryMetric: 'القطع',
    documentsMetric: 'المستندات',
    loadingCounts: 'جارٍ تحميل إجماليات لوحة التحكم...',
    loadFailed: 'تعذر تحميل إجماليات لوحة التحكم.',
    refreshFailed: 'تعذر تحديث الإجماليات. ستبقى القيم المحفوظة ظاهرة.',
    retry: 'إعادة المحاولة',
    workTab: 'العمل',
    documentsTab: 'المستندات',
    createJob: 'إنشاء وتعبئة مهمة',
    createJobDesc: 'أنشئ مهامك الخاصة وحدّث تقدمها وأكملها من مسار واحد.',
    inventory: 'مخزوني',
    inventoryDesc: 'راجع القطع والمخزون الشخصي دون مغادرة اللوحة.',
    clientBook: 'دفتر العملاء',
    clientBookDesc: 'الوصول إلى سجلات العملاء وبيانات الاتصال.',
    generalDocs: 'المستندات العامة',
    generalDocsDesc: 'أنشئ مستندات أعمال مباشرة من مساحة العمل المحمولة.',
    taxInvoice: 'إنشاء فاتورة ضريبية',
    taxInvoiceDesc: 'أنشئ فواتير من المهام المكتملة عندما تكون المستندات مفعلة.',
    documentHistory: 'سجل المستندات',
    documentHistoryDesc: 'اعرض القائمة الكاملة للمستندات التي أنشأتها.',
    workBadge: 'عمل',
    docsBadge: 'مستندات',
  },
};

export default function UserHomepage() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const { user } = useSession();
  const { workspace, status: tenantStatus } = useTenant();
  const [activeTab, setActiveTab] = useState('work');
  const colors = getColors(isDarkMode);
  const t = translations[language] || translations.en;

  const enabledModules = new Set(workspace?.enabledModules ?? []);
  const hasSoloJob = enabledModules.has('solojob');
  const hasDocs = enabledModules.has('documents');
  const hasInventory = enabledModules.has('inventory');
  const hasClients = enabledModules.has('clients');
  const hasWork = hasSoloJob || hasInventory || hasClients;
  const workspaceActive = canLoadUserBootstrap(workspace);
  const bootstrapQuery = useCompanyBootstrap({
    uid: user?.id ?? null,
    companyId: workspace?.companyId ?? null,
    enabled: tenantStatus === 'ready' && workspaceActive,
  });
  const countValues = bootstrapCountValues(bootstrapQuery.data?.counts);

  useEffect(() => {
    if (bootstrapQuery.error) {
      logger.warn('User dashboard bootstrap refresh failed; retaining cached totals', bootstrapQuery.error);
    }
  }, [bootstrapQuery.error]);

  const availableTabs: string[] = [
    ...(hasWork ? ['work'] : []),
    ...(hasDocs ? ['documents'] : []),
  ];

  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0]);
    }
  }, [activeTab, availableTabs]);

  const tabItems: Array<{ key: string; label: string; icon: string; iconLibrary: IconLibrary }> = [
    ...(hasWork ? [{ key: 'work', label: t.workTab, icon: 'briefcase', iconLibrary: 'material' as IconLibrary }] : []),
    ...(hasDocs ? [{ key: 'documents', label: t.documentsTab, icon: 'file-document-multiple', iconLibrary: 'material' as IconLibrary }] : []),
  ];

  const cardsByTab: Record<string, Array<{
    key: string;
    title: string;
    description: string;
    icon: string;
    iconLibrary: IconLibrary;
    accentColor: string;
    badge: string;
    onPress: () => void;
  }>> = {
    work: [
      ...(hasSoloJob ? [{
        key: 'create-job',
        title: t.createJob,
        description: t.createJobDesc,
        icon: 'briefcase-check',
        iconLibrary: 'material' as IconLibrary,
        accentColor: colors.boxPurple,
        badge: t.workBadge,
        onPress: () => router.push(ROUTES.userJobs),
      }] : []),
      ...(hasInventory ? [{
        key: 'inventory',
        title: t.inventory,
        description: t.inventoryDesc,
        icon: 'package-variant',
        iconLibrary: 'material' as IconLibrary,
        accentColor: colors.boxOrange,
        badge: t.workBadge,
        onPress: () => router.push(ROUTES.inventory),
      }] : []),
      ...(hasClients ? [{
        key: 'client-book',
        title: t.clientBook,
        description: t.clientBookDesc,
        icon: 'book-account',
        iconLibrary: 'material' as IconLibrary,
        accentColor: colors.boxPink,
        badge: t.workBadge,
        onPress: () => router.push(ROUTES.clientBook),
      }] : []),
    ],
    documents: [
      {
        key: 'general-documents',
        title: t.generalDocs,
        description: t.generalDocsDesc,
        icon: 'file-document-multiple',
        iconLibrary: 'material',
        accentColor: colors.boxBlue,
        badge: t.docsBadge,
        onPress: () => router.push(ROUTES.generalDocuments),
      },
      {
        key: 'tax-invoice',
        title: t.taxInvoice,
        description: t.taxInvoiceDesc,
        icon: 'file-document-edit',
        iconLibrary: 'material',
        accentColor: colors.boxYellow,
        badge: t.docsBadge,
        onPress: () => router.push(ROUTES.generateTaxInvoice),
      },
      {
        key: 'document-history',
        title: t.documentHistory,
        description: t.documentHistoryDesc,
        icon: 'history',
        iconLibrary: 'material',
        accentColor: colors.boxLime,
        badge: t.docsBadge,
        onPress: () => router.push(ROUTES.documentHistory),
      },
    ],
  };

  const activeCards = (cardsByTab as Record<string, typeof cardsByTab.work>)[activeTab] || [];

  if (workspace && workspace.role !== 'user') {
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
        heroIcon="briefcase-check-outline"
        heroIconLibrary="material"
        metrics={[
          { label: t.roleMetric, value: t.roleValue },
          { label: t.jobsMetric, value: countValues.jobs },
          { label: t.clientsMetric, value: countValues.clients },
          { label: t.inventoryMetric, value: countValues.inventoryParts },
          { label: t.documentsMetric, value: countValues.documents },
        ]}
        tabs={tabItems}
        activeTab={activeTab}
        onTabPress={setActiveTab}
      >
        {bootstrapQuery.isLoading ? (
          <AppCard style={styles.bootstrapStateCard}>
            <ActivityIndicator size="small" color={colors.secondary} />
            <AppText color={colors.textSecondary}>{t.loadingCounts}</AppText>
          </AppCard>
        ) : null}
        {bootstrapQuery.isError ? (
          <AppCard style={[styles.bootstrapStateCard, { borderColor: colors.error }]}>
            <AppText color={colors.textPrimary}>
              {bootstrapQuery.data ? t.refreshFailed : t.loadFailed}
            </AppText>
            <AppButton
              title={t.retry}
              size="sm"
              loading={bootstrapQuery.isFetching}
              onPress={() => { void bootstrapQuery.refetch(); }}
              style={styles.retryButton}
            />
          </AppCard>
        ) : null}
        {activeCards.length > 0 ? activeCards.map((card) => (
          <DashboardActionCard
            key={card.key}
            title={card.title}
            description={card.description}
            icon={card.icon}
            iconLibrary={card.iconLibrary}
            accentColor={card.accentColor}
            badge={card.badge}
            ctaLabel={t.open}
            onPress={card.onPress}
          />
        )) : <AppEmptyState title={t.emptyTitle} subtitle={t.emptySubtitle} />}
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
