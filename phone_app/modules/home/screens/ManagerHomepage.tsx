// @ts-nocheck
import { ROUTES } from '../../../navigation/routes';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getColors, spacing } from '../../../theme';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useCache } from '../../../contexts/CacheContext';
import { isSubscriptionActive, isModuleEnabled } from '../../shared';
import {
  AppEmptyState,
  DashboardActionCard,
  DashboardShell,
  GlobalHeader,
} from '../../../components';

const translations = {
  en: {
    title: 'Manager Dashboard',
    subtitle: 'Company control surface',
    description: 'Run team operations, monitor live work, and move between documents and field activity from one structured workspace.',
    heroLabel: 'Manager access',
    open: 'Open workspace',
    emptyTitle: 'No modules available',
    emptySubtitle: 'This account does not have any active dashboard areas yet.',
    expiredTitle: 'Subscription Expired',
    expiredSubtitle: 'Renew the company subscription on the website to restore access to the mobile workspace.',
    roleMetric: 'Role',
    roleValue: 'Manager',
    scopeMetric: 'Scope',
    scopeValue: 'Company',
    moduleMetric: 'Areas',
    managementTab: 'Management',
    jobMonitorTab: 'Jobs',
    workTab: 'Work',
    documentsTab: 'Documents',
    workersMonitor: 'Workers Monitor',
    workersMonitorDesc: 'Review worker inventory and follow operational activity across the team.',
    workersUsers: 'Manage Workers',
    workersUsersDesc: 'Create, edit, and organize worker access for the company.',
    companyParts: 'Company Inventory',
    companyPartsDesc: 'Control the shared company parts list and stock setup.',
    jobMonitor: 'Job Monitor',
    jobMonitorDesc: 'Track company jobs across statuses in one live board.',
    manageJobs: 'Manage Jobs',
    manageJobsDesc: 'Review submissions and approve worker job completions.',
    myJobs: 'My Jobs',
    myJobsDesc: 'Use the solo workflow available on this plan for your own work items.',
    inventory: 'My Inventory',
    inventoryDesc: 'Open your own inventory view without leaving the manager workspace.',
    clientBook: 'Client Book',
    clientBookDesc: 'Access the client list and company customer records.',
    generateTaxInvoice: 'Generate Tax Invoice',
    generateTaxInvoiceDesc: 'Create tax invoices directly from finished operational work.',
    generalDocuments: 'General Documents',
    generalDocumentsDesc: 'Generate standard business documents from the mobile app.',
    documentHistory: 'Document History',
    documentHistoryDesc: 'Review the full history of generated company documents.',
    teamBadge: 'Team',
    opsBadge: 'Ops',
    docsBadge: 'Docs',
    personalBadge: 'Personal',
  },
  he: {
    title: 'לוח בקרה מנהל',
    subtitle: 'מרכז שליטה לחברה',
    description: 'ניהול עובדים, מעקב אחרי עבודה חיה ומעבר מהיר בין מסמכים לפעילות השוטפת מתוך סביבת עבודה אחת.',
    heroLabel: 'גישת מנהל',
    open: 'פתח סביבת עבודה',
    emptyTitle: 'אין מודולים זמינים',
    emptySubtitle: 'לחשבון הזה אין כרגע אזורי עבודה פעילים בלוח הבקרה.',
    expiredTitle: 'המנוי פג תוקף',
    expiredSubtitle: 'חדש את מנוי החברה דרך האתר כדי להחזיר את הגישה לאפליקציה.',
    roleMetric: 'תפקיד',
    roleValue: 'מנהל',
    scopeMetric: 'היקף',
    scopeValue: 'חברה',
    moduleMetric: 'אזורים',
    managementTab: 'ניהול',
    jobMonitorTab: 'משימות',
    workTab: 'עבודה',
    documentsTab: 'מסמכים',
    workersMonitor: 'ניטור עובדים',
    workersMonitorDesc: 'בדיקת מלאי עובדים ומעקב אחרי הפעילות של הצוות.',
    workersUsers: 'ניהול עובדים',
    workersUsersDesc: 'יצירה, עריכה וארגון הרשאות עובדים בחברה.',
    companyParts: 'מלאי חברה',
    companyPartsDesc: 'שליטה ברשימת החלקים המשותפת ובהגדרת המלאי.',
    jobMonitor: 'ניטור משימות',
    jobMonitorDesc: 'מעקב אחרי משימות החברה בכל הסטטוסים מלוח אחד.',
    manageJobs: 'ניהול משימות',
    manageJobsDesc: 'בדיקת הגשות ואישור סיום משימות של עובדים.',
    myJobs: 'המשימות שלי',
    myJobsDesc: 'שימוש בזרימת העבודה האישית הזמינה בתוכנית שלך.',
    inventory: 'המלאי שלי',
    inventoryDesc: 'כניסה מהירה למלאי האישי בלי לצאת מסביבת המנהל.',
    clientBook: 'ספר לקוחות',
    clientBookDesc: 'גישה לרשימת הלקוחות ולרישומי הלקוחות של החברה.',
    generateTaxInvoice: 'יצירת חשבונית מס',
    generateTaxInvoiceDesc: 'הפקת חשבוניות מס ישירות מעבודות שהסתיימו.',
    generalDocuments: 'מסמכים כלליים',
    generalDocumentsDesc: 'יצירת מסמכים עסקיים מהאפליקציה.',
    documentHistory: 'היסטוריית מסמכים',
    documentHistoryDesc: 'סקירת כל היסטוריית המסמכים של החברה.',
    teamBadge: 'צוות',
    opsBadge: 'תפעול',
    docsBadge: 'מסמכים',
    personalBadge: 'אישי',
  },
  ar: {
    title: 'لوحة تحكم المدير',
    subtitle: 'مركز التحكم بالشركة',
    description: 'إدارة الفريق، متابعة العمل الحي، والتنقل بين المستندات والعمليات من مساحة عمل واحدة منظمة.',
    heroLabel: 'وصول المدير',
    open: 'افتح مساحة العمل',
    emptyTitle: 'لا توجد وحدات متاحة',
    emptySubtitle: 'هذا الحساب لا يملك مناطق لوحة تحكم فعالة حالياً.',
    expiredTitle: 'انتهى الاشتراك',
    expiredSubtitle: 'جدّد اشتراك الشركة عبر الموقع لاستعادة الوصول إلى التطبيق.',
    roleMetric: 'الدور',
    roleValue: 'مدير',
    scopeMetric: 'النطاق',
    scopeValue: 'شركة',
    moduleMetric: 'المساحات',
    managementTab: 'الإدارة',
    jobMonitorTab: 'المهام',
    workTab: 'العمل',
    documentsTab: 'المستندات',
    workersMonitor: 'مراقبة العمال',
    workersMonitorDesc: 'راجع مخزون العمال وتابع النشاط التشغيلي عبر الفريق.',
    workersUsers: 'إدارة العمال',
    workersUsersDesc: 'أنشئ وعدّل ونظّم صلاحيات العمال في الشركة.',
    companyParts: 'مخزون الشركة',
    companyPartsDesc: 'تحكم في قائمة القطع المشتركة وإعداد المخزون.',
    jobMonitor: 'مراقبة المهام',
    jobMonitorDesc: 'تابع مهام الشركة عبر الحالات المختلفة من لوحة واحدة.',
    manageJobs: 'إدارة المهام',
    manageJobsDesc: 'راجع الإرسالات ووافق على إنهاء مهام العمال.',
    myJobs: 'مهامي',
    myJobsDesc: 'استخدم مسار العمل الفردي المتاح في هذه الخطة.',
    inventory: 'مخزوني',
    inventoryDesc: 'افتح عرض المخزون الشخصي دون مغادرة مساحة المدير.',
    clientBook: 'دفتر العملاء',
    clientBookDesc: 'الوصول إلى قائمة العملاء وسجلات الشركة.',
    generateTaxInvoice: 'إنشاء فاتورة ضريبية',
    generateTaxInvoiceDesc: 'أنشئ فواتير ضريبية مباشرة من الأعمال المنتهية.',
    generalDocuments: 'المستندات العامة',
    generalDocumentsDesc: 'أنشئ مستندات أعمال قياسية من التطبيق.',
    documentHistory: 'سجل المستندات',
    documentHistoryDesc: 'راجع السجل الكامل لمستندات الشركة.',
    teamBadge: 'فريق',
    opsBadge: 'تشغيل',
    docsBadge: 'مستندات',
    personalBadge: 'شخصي',
  },
};

export default function ManagerHomepage() {
  const router = useRouter();
  const { tab } = useLocalSearchParams();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const { subscription } = useCache();
  const [activeTab, setActiveTab] = useState('management');
  const colors = getColors(isDarkMode);
  const t = translations[language] || translations.en;

  const hasTeam = isModuleEnabled(subscription, 'team');
  const hasSoloJob = isModuleEnabled(subscription, 'solojob');
  const hasDocs = isModuleEnabled(subscription, 'documents');
  const subActive = isSubscriptionActive(subscription);

  const availableTabs = [
    ...(hasTeam ? ['management', 'jobMonitor'] : []),
    ...(hasSoloJob ? ['work'] : []),
    ...(hasDocs ? ['documents'] : []),
  ];

  useEffect(() => {
    if (tab && availableTabs.includes(tab)) {
      setActiveTab(tab);
    }
  }, [tab, availableTabs.join('|')]);

  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0]);
    }
  }, [activeTab, availableTabs.join('|')]);

  const tabItems = [
    ...(hasTeam ? [{ key: 'management', label: t.managementTab, icon: 'account-group', iconLibrary: 'material' }] : []),
    ...(hasTeam ? [{ key: 'jobMonitor', label: t.jobMonitorTab, icon: 'clipboard-text-clock', iconLibrary: 'material' }] : []),
    ...(hasSoloJob ? [{ key: 'work', label: t.workTab, icon: 'briefcase', iconLibrary: 'material' }] : []),
    ...(hasDocs ? [{ key: 'documents', label: t.documentsTab, icon: 'file-document-multiple', iconLibrary: 'material' }] : []),
  ];

  const cardsByTab = {
    management: [
      {
        key: 'workers-monitor',
        title: t.workersMonitor,
        description: t.workersMonitorDesc,
        icon: 'monitor-eye',
        iconLibrary: 'material',
        accentColor: colors.boxTeal,
        badge: t.teamBadge,
        onPress: () => router.push(ROUTES.workersMonitor),
      },
      {
        key: 'workers-users',
        title: t.workersUsers,
        description: t.workersUsersDesc,
        icon: 'account-group',
        iconLibrary: 'material',
        accentColor: colors.boxBlue,
        badge: t.teamBadge,
        onPress: () => router.push(ROUTES.workersUsers),
      },
      {
        key: 'company-parts',
        title: t.companyParts,
        description: t.companyPartsDesc,
        icon: 'package-variant-closed',
        iconLibrary: 'material',
        accentColor: colors.boxOrange,
        badge: t.opsBadge,
        onPress: () => router.push(ROUTES.companyInventory),
      },
    ],
    jobMonitor: [
      {
        key: 'job-monitor',
        title: t.jobMonitor,
        description: t.jobMonitorDesc,
        icon: 'clipboard-text-clock',
        iconLibrary: 'material',
        accentColor: colors.boxIndigo,
        badge: t.opsBadge,
        onPress: () => router.push(ROUTES.jobMonitor),
      },
      {
        key: 'manage-jobs',
        title: t.manageJobs,
        description: t.manageJobsDesc,
        icon: 'clipboard-check-multiple',
        iconLibrary: 'material',
        accentColor: colors.boxGreen,
        badge: t.opsBadge,
        onPress: () => router.push(ROUTES.manageJobs),
      },
    ],
    work: [
      {
        key: 'my-jobs',
        title: t.myJobs,
        description: t.myJobsDesc,
        icon: 'briefcase-check',
        iconLibrary: 'material',
        accentColor: colors.boxPurple,
        badge: t.personalBadge,
        onPress: () => router.push(ROUTES.userJobs),
      },
      {
        key: 'inventory',
        title: t.inventory,
        description: t.inventoryDesc,
        icon: 'package-variant',
        iconLibrary: 'material',
        accentColor: colors.boxOrange,
        badge: t.personalBadge,
        onPress: () => router.push(ROUTES.inventory),
      },
      {
        key: 'client-book',
        title: t.clientBook,
        description: t.clientBookDesc,
        icon: 'book-account',
        iconLibrary: 'material',
        accentColor: colors.boxPink,
        badge: t.personalBadge,
        onPress: () => router.push(ROUTES.clientBook),
      },
    ],
    documents: [
      {
        key: 'tax-invoice',
        title: t.generateTaxInvoice,
        description: t.generateTaxInvoiceDesc,
        icon: 'receipt',
        iconLibrary: 'material',
        accentColor: colors.boxYellow,
        badge: t.docsBadge,
        onPress: () => router.push(ROUTES.generateTaxInvoice),
      },
      {
        key: 'general-docs',
        title: t.generalDocuments,
        description: t.generalDocumentsDesc,
        icon: 'file-document-multiple',
        iconLibrary: 'material',
        accentColor: colors.boxBlue,
        badge: t.docsBadge,
        onPress: () => router.push(ROUTES.generalDocuments),
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

  const activeCards = cardsByTab[activeTab] || [];

  if (!subActive) {
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
        heroIcon="briefcase-variant-outline"
        heroIconLibrary="material"
        metrics={[
          { label: t.roleMetric, value: t.roleValue },
          { label: t.scopeMetric, value: t.scopeValue },
          { label: t.moduleMetric, value: String(availableTabs.length) },
        ]}
        tabs={tabItems}
        activeTab={activeTab}
        onTabPress={setActiveTab}
      >
        {activeCards.length > 0 ? (
          activeCards.map((card) => (
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
});