import { ROUTES } from '../../../navigation/routes';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { borderRadius, getColors, spacing } from '../../../theme';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useCache } from '../../../contexts/CacheContext';
import { callHttpFunction } from '../../../utils/httpFunctions';
import { isSubscriptionActive, isModuleEnabled } from '../../shared';
import {
  AppCard,
  AppEmptyState,
  AppText,
  DashboardActionCard,
  DashboardShell,
  GlobalHeader,
} from '../../../components';
import type { IconLibrary } from '../../../components/primitives/AppIcon';

const translations = {
  en: {
    title: 'Basic Dashboard',
    subtitle: 'Business overview',
    description: 'Keep business details and essential document tools available in a simpler layout focused on reference and document access.',
    heroLabel: 'Basic access',
    open: 'Open workspace',
    emptyTitle: 'No modules available',
    emptySubtitle: 'This account does not have any active dashboard areas yet.',
    expiredTitle: 'Subscription Expired',
    expiredSubtitle: 'Renew the subscription on the website to restore access to the business dashboard.',
    roleMetric: 'Role',
    roleValue: 'Basic',
    scopeMetric: 'Scope',
    scopeValue: 'Reference',
    moduleMetric: 'Areas',
    businessTab: 'Business',
    documentsTab: 'Documents',
    businessInfoTitle: 'Business Information',
    businessInfoDesc: 'Registered business details for quick mobile reference.',
    noBusinessInfo: 'No business information is registered yet.',
    companySection: 'Company profile',
    contactSection: 'Contact details',
    accountantSection: 'Accountant details',
    businessNameHe: 'Business name (Hebrew)',
    businessNameEn: 'Business name (English)',
    vatNumber: 'VAT number',
    businessType: 'Business type',
    address: 'Address',
    city: 'City',
    email: 'Email',
    phone: 'Phone',
    fax: 'Fax',
    accountantName: 'Accountant name',
    accountantEmail: 'Accountant email',
    accountantPhone: 'Accountant phone',
    generalDocs: 'General Documents',
    generalDocsDesc: 'Create standard business documents from the app.',
    documentHistory: 'Document History',
    documentHistoryDesc: 'Review previously generated documents.',
    clientBook: 'Client Book',
    clientBookDesc: 'Open the client directory and customer details.',
    businessBadge: 'Profile',
    docsBadge: 'Docs',
  },
  he: {
    title: 'לוח בקרה בסיסי',
    subtitle: 'סקירת עסק',
    description: 'שמירה על פרטי העסק וכלי המסמכים החיוניים בפריסה פשוטה יותר שממוקדת במידע ובגישה למסמכים.',
    heroLabel: 'גישת בסיס',
    open: 'פתח סביבת עבודה',
    emptyTitle: 'אין מודולים זמינים',
    emptySubtitle: 'לחשבון הזה אין כרגע אזורי עבודה פעילים.',
    expiredTitle: 'המנוי פג תוקף',
    expiredSubtitle: 'חדש את המנוי דרך האתר כדי להחזיר את הגישה ללוח הבקרה העסקי.',
    roleMetric: 'תפקיד',
    roleValue: 'בסיסי',
    scopeMetric: 'היקף',
    scopeValue: 'מידע',
    moduleMetric: 'אזורים',
    businessTab: 'עסק',
    documentsTab: 'מסמכים',
    businessInfoTitle: 'מידע עסקי',
    businessInfoDesc: 'פרטי העסק הרשומים לצפייה מהירה במובייל.',
    noBusinessInfo: 'עדיין לא נרשם מידע עסקי.',
    companySection: 'פרופיל חברה',
    contactSection: 'פרטי קשר',
    accountantSection: 'פרטי רואה חשבון',
    businessNameHe: 'שם העסק (עברית)',
    businessNameEn: 'שם העסק (אנגלית)',
    vatNumber: 'מספר עוסק מורשה',
    businessType: 'סוג העסק',
    address: 'כתובת',
    city: 'עיר',
    email: 'דוא"ל',
    phone: 'טלפון',
    fax: 'פקס',
    accountantName: 'שם רואה חשבון',
    accountantEmail: 'דוא"ל רואה חשבון',
    accountantPhone: 'טלפון רואה חשבון',
    generalDocs: 'מסמכים כלליים',
    generalDocsDesc: 'יצירת מסמכים עסקיים סטנדרטיים מתוך האפליקציה.',
    documentHistory: 'היסטוריית מסמכים',
    documentHistoryDesc: 'סקירת מסמכים שנוצרו בעבר.',
    clientBook: 'ספר לקוחות',
    clientBookDesc: 'כניסה לספר הלקוחות ולפרטי לקוחות.',
    businessBadge: 'פרופיל',
    docsBadge: 'מסמכים',
  },
  ar: {
    title: 'لوحة تحكم أساسية',
    subtitle: 'نظرة عامة على العمل',
    description: 'أبقِ تفاصيل العمل وأدوات المستندات الأساسية متاحة ضمن تخطيط أبسط يركز على المرجع والوصول إلى المستندات.',
    heroLabel: 'وصول أساسي',
    open: 'افتح مساحة العمل',
    emptyTitle: 'لا توجد وحدات متاحة',
    emptySubtitle: 'هذا الحساب لا يملك مناطق عمل فعالة حالياً.',
    expiredTitle: 'انتهى الاشتراك',
    expiredSubtitle: 'جدّد الاشتراك عبر الموقع لاستعادة الوصول إلى لوحة العمل.',
    roleMetric: 'الدور',
    roleValue: 'أساسي',
    scopeMetric: 'النطاق',
    scopeValue: 'مرجعي',
    moduleMetric: 'المساحات',
    businessTab: 'العمل',
    documentsTab: 'المستندات',
    businessInfoTitle: 'معلومات العمل',
    businessInfoDesc: 'تفاصيل العمل المسجلة للرجوع السريع من الجوال.',
    noBusinessInfo: 'لا توجد معلومات عمل مسجلة بعد.',
    companySection: 'ملف الشركة',
    contactSection: 'بيانات التواصل',
    accountantSection: 'بيانات المحاسب',
    businessNameHe: 'اسم العمل (عبري)',
    businessNameEn: 'اسم العمل (إنجليزي)',
    vatNumber: 'رقم ضريبة القيمة المضافة',
    businessType: 'نوع العمل',
    address: 'العنوان',
    city: 'المدينة',
    email: 'البريد الإلكتروني',
    phone: 'الهاتف',
    fax: 'الفاكس',
    accountantName: 'اسم المحاسب',
    accountantEmail: 'بريد المحاسب',
    accountantPhone: 'هاتف المحاسب',
    generalDocs: 'المستندات العامة',
    generalDocsDesc: 'أنشئ مستندات أعمال قياسية من التطبيق.',
    documentHistory: 'سجل المستندات',
    documentHistoryDesc: 'راجع المستندات التي تم إنشاؤها سابقاً.',
    clientBook: 'دفتر العملاء',
    clientBookDesc: 'افتح دليل العملاء وتفاصيلهم.',
    businessBadge: 'الملف',
    docsBadge: 'مستندات',
  },
};

interface BusinessInfo {
  heName: string;
  enName: string;
  vatNumber: string;
  businessType: string;
  address: string;
  city: string;
  businessEmail: string;
  businessPhone: string;
  businessFax: string;
  accountantName: string;
  accountantEmail: string;
  accountantPhone: string;
}

const compactSections = (t: typeof translations.en, businessInfo: BusinessInfo | null) => [
  {
    title: t.companySection,
    items: [
      { label: t.businessNameHe, value: businessInfo?.heName },
      { label: t.businessNameEn, value: businessInfo?.enName },
      { label: t.vatNumber, value: businessInfo?.vatNumber },
      { label: t.businessType, value: businessInfo?.businessType },
    ].filter((item) => item.value),
  },
  {
    title: t.contactSection,
    items: [
      { label: t.address, value: businessInfo?.address },
      { label: t.city, value: businessInfo?.city },
      { label: t.email, value: businessInfo?.businessEmail },
      { label: t.phone, value: businessInfo?.businessPhone },
      { label: t.fax, value: businessInfo?.businessFax },
    ].filter((item) => item.value),
  },
  {
    title: t.accountantSection,
    items: [
      { label: t.accountantName, value: businessInfo?.accountantName },
      { label: t.accountantEmail, value: businessInfo?.accountantEmail },
      { label: t.accountantPhone, value: businessInfo?.accountantPhone },
    ].filter((item) => item.value),
  },
].filter((section) => section.items.length > 0);

function normalizeBusinessInfo(data: unknown): BusinessInfo | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const d = data as Record<string, unknown>;
  return {
    heName: String(d.he_name || ''),
    enName: String(d.en_name || ''),
    vatNumber: String(d.vat_number || ''),
    businessType: String(d.business_type || ''),
    address: String(d.address || ''),
    city: String(d.city || ''),
    businessEmail: String(d.business_email || ''),
    businessPhone: String(d.business_phone || ''),
    businessFax: String(d.business_fax || ''),
    accountantName: String(d.accountant_name || ''),
    accountantEmail: String(d.accountant_email || ''),
    accountantPhone: String(d.accountant_phone || ''),
  };
}

export default function BasicHomepage() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const { subscription, getCompanyId } = useCache();
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo | null>(null);
  const [activeTab, setActiveTab] = useState('business');
  const colors = getColors(isDarkMode);
  const t = translations[language] || translations.en;
  const companyId = getCompanyId();

  const hasDocs = isModuleEnabled(subscription ?? null, 'documents');
  const subActive = isSubscriptionActive(subscription ?? null);

  const availableTabs: string[] = [
    'business',
    ...(hasDocs ? ['documents'] : []),
  ];

  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0]);
    }
  }, [activeTab, availableTabs]);

  useEffect(() => {
    if (!companyId) return;

    let cancelled = false;

    (async () => {
      try {
        const bootstrap = await callHttpFunction<{ businessInfo?: Record<string, unknown> | null }>('readModelV1', {
          kind: 'bootstrap',
          companyId,
          includeCollections: false,
        });
        if (cancelled) return;
        setBusinessInfo(normalizeBusinessInfo(bootstrap?.businessInfo));
      } catch (error) {
        console.warn('BasicHomepage: failed to load business info', error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const tabItems: Array<{ key: string; label: string; icon: string; iconLibrary: IconLibrary }> = [
    { key: 'business', label: t.businessTab, icon: 'domain', iconLibrary: 'material' as IconLibrary },
    ...(hasDocs ? [{ key: 'documents', label: t.documentsTab, icon: 'file-document-multiple', iconLibrary: 'material' as IconLibrary }] : []),
  ];

  const infoSections = useMemo(() => compactSections(t, businessInfo), [t, businessInfo]);

  const documentCards: Array<{
    key: string;
    title: string;
    description: string;
    icon: string;
    iconLibrary: IconLibrary;
    accentColor: string;
    badge: string;
    onPress: () => void;
  }> = [
    {
      key: 'general-documents',
      title: t.generalDocs,
      description: t.generalDocsDesc,
      icon: 'file-document-multiple',
      iconLibrary: 'material' as IconLibrary,
      accentColor: colors.boxBlue,
      badge: t.docsBadge,
      onPress: () => router.push(ROUTES.generalDocuments),
    },
    {
      key: 'document-history',
      title: t.documentHistory,
      description: t.documentHistoryDesc,
      icon: 'history',
      iconLibrary: 'material' as IconLibrary,
      accentColor: colors.boxLime,
      badge: t.docsBadge,
      onPress: () => router.push(ROUTES.documentHistory),
    },
    {
      key: 'client-book',
      title: t.clientBook,
      description: t.clientBookDesc,
      icon: 'book-account',
      iconLibrary: 'material' as IconLibrary,
      accentColor: colors.boxPink,
      badge: t.docsBadge,
      onPress: () => router.push(ROUTES.clientBook),
    },
  ];

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
        heroIcon="domain"
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
        {activeTab === 'business' ? (
          <AppCard style={styles.infoCard} tone="muted">
            <View style={styles.infoHeader}>
              <View style={[styles.infoIconWrap, { backgroundColor: `${colors.primary}14`, borderColor: `${colors.primary}24` }]}>
                <AppText variant="title" color={colors.primary}>
                  SJ
                </AppText>
              </View>
              <View style={styles.infoHeaderText}>
                <AppText variant="heading">{t.businessInfoTitle}</AppText>
                <AppText variant="body" color={colors.textSecondary} style={styles.infoHeaderDescription}>
                  {t.businessInfoDesc}
                </AppText>
              </View>
            </View>

            {infoSections.length > 0 ? (
              infoSections.map((section) => (
                <View key={section.title} style={styles.sectionBlock}>
                  <AppText variant="label" color={colors.textLight} style={styles.sectionLabel}>
                    {section.title}
                  </AppText>
                  <View style={styles.infoGrid}>
                    {section.items.map((item) => (
                      <View
                        key={`${section.title}-${item.label}`}
                        style={[
                          styles.infoItem,
                          {
                            backgroundColor: colors.backgroundElevated,
                            borderColor: colors.borderLight,
                          },
                        ]}
                      >
                        <AppText variant="caption" color={colors.textLight}>
                          {item.label}
                        </AppText>
                        <AppText variant="bodyStrong" color={colors.textPrimary} style={styles.infoValue}>
                          {item.value}
                        </AppText>
                      </View>
                    ))}
                  </View>
                </View>
              ))
            ) : (
              <AppEmptyState
                icon="domain-off"
                title={t.businessInfoTitle}
                subtitle={t.noBusinessInfo}
              />
            )}
          </AppCard>
        ) : documentCards.length > 0 ? (
          documentCards.map((card) => (
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
  infoCard: {
    borderRadius: borderRadius.xxl,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  infoIconWrap: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoHeaderText: {
    flex: 1,
  },
  infoHeaderDescription: {
    marginTop: spacing.xs,
    lineHeight: 22,
  },
  sectionBlock: {
    marginTop: spacing.xl,
  },
  sectionLabel: {
    marginBottom: spacing.sm,
  },
  infoGrid: {
    gap: spacing.sm,
  },
  infoItem: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  infoValue: {
    marginTop: spacing.xs,
    lineHeight: 22,
  },
});
