// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getColors, spacing } from '../../theme';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useCache } from '../../contexts/CacheContext';
import { isSubscriptionActive, isModuleEnabled } from '../shared';
import {
  AppEmptyState,
  DashboardActionCard,
  DashboardShell,
  GlobalHeader,
} from '../../components';

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
  const { subscription } = useCache();
  const [activeTab, setActiveTab] = useState('work');
  const colors = getColors(isDarkMode);
  const t = translations[language] || translations.en;

  const hasSoloJob = isModuleEnabled(subscription, 'solojob');
  const hasDocs = isModuleEnabled(subscription, 'documents');
  const subActive = isSubscriptionActive(subscription);

  const availableTabs = [
    ...(hasSoloJob ? ['work'] : []),
    ...(hasDocs ? ['documents'] : []),
  ];

  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0]);
    }
  }, [activeTab, availableTabs.join('|')]);

  const tabItems = [
    ...(hasSoloJob ? [{ key: 'work', label: t.workTab, icon: 'briefcase', iconLibrary: 'material' }] : []),
    ...(hasDocs ? [{ key: 'documents', label: t.documentsTab, icon: 'file-document-multiple', iconLibrary: 'material' }] : []),
  ];

  const cardsByTab = {
    work: [
      {
        key: 'create-job',
        title: t.createJob,
        description: t.createJobDesc,
        icon: 'briefcase-check',
        iconLibrary: 'material',
        accentColor: colors.boxPurple,
        badge: t.workBadge,
        onPress: () => router.push('/Userjob'),
      },
      {
        key: 'inventory',
        title: t.inventory,
        description: t.inventoryDesc,
        icon: 'package-variant',
        iconLibrary: 'material',
        accentColor: colors.boxOrange,
        badge: t.workBadge,
        onPress: () => router.push('/inventory'),
      },
      {
        key: 'client-book',
        title: t.clientBook,
        description: t.clientBookDesc,
        icon: 'book-account',
        iconLibrary: 'material',
        accentColor: colors.boxPink,
        badge: t.workBadge,
        onPress: () => router.push('/ClientBook'),
      },
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
        onPress: () => router.push('/GeneralDocuments'),
      },
      {
        key: 'tax-invoice',
        title: t.taxInvoice,
        description: t.taxInvoiceDesc,
        icon: 'file-document-edit',
        iconLibrary: 'material',
        accentColor: colors.boxYellow,
        badge: t.docsBadge,
        onPress: () => router.push('/GenerateTaxInvoice'),
      },
      {
        key: 'document-history',
        title: t.documentHistory,
        description: t.documentHistoryDesc,
        icon: 'history',
        iconLibrary: 'material',
        accentColor: colors.boxLime,
        badge: t.docsBadge,
        onPress: () => router.push('/DocumentHistory'),
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
        heroIcon="briefcase-check-outline"
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