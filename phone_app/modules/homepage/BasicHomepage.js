import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { getColors, spacing, borderRadius, typography, shadows } from '../../theme';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useCache } from '../../contexts/CacheContext';
import { isSubscriptionActive, isModuleEnabled } from '../shared';
import { AppText, GlobalHeader, ScrollableContainer } from '../../components';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, getDoc } from '@react-native-firebase/firestore';
import { db } from '../../firebase';

export default function BasicHomepage() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const { subscription, getCompanyId } = useCache();
  const [businessInfo, setBusinessInfo] = useState(null);
  const [activeTab, setActiveTab] = useState('business');
  const colors = getColors(isDarkMode);
  const insets = useSafeAreaInsets();

  // Fetch business info from Firestore (not cached in CacheContext by design)
  useEffect(() => {
    const companyId = getCompanyId();
    if (!companyId) return;
    (async () => {
      try {
        const bizRef = doc(db, 'companies', companyId, 'data', 'business_info');
        const bizSnap = await getDoc(bizRef);
        if (bizSnap.exists) {
          const d = bizSnap.data();
          setBusinessInfo({
            heName: d.he_name || '',
            enName: d.en_name || '',
            vatNumber: d.vat_number || '',
            businessType: d.business_type || '',
            address: d.address || '',
            city: d.city || '',
            businessEmail: d.business_email || '',
            businessPhone: d.business_phone || '',
            businessFax: d.business_fax || '',
            accountantName: d.accountant_name || '',
            accountantEmail: d.accountant_email || '',
            accountantPhone: d.accountant_phone || '',
          });
        }
      } catch (e) {
        console.warn('BasicHomepage: failed to load business info', e.message);
      }
    })();
  }, [getCompanyId]);

  // Module checks
  const hasDocs = isModuleEnabled(subscription, 'documents');
  const subActive = isSubscriptionActive(subscription);

  const availableTabs = [
    'business',  // Always visible
    ...(hasDocs ? ['documents'] : []),
  ];

  // Auto-select first available tab if current is no longer available
  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0]);
    }
  }, [hasDocs]);

  const t = language === 'en' ? {
    title: 'Basic Dashboard',
    subtitle: 'Welcome back',
    businessTab: 'Business Info',
    documentsTab: 'Documents',
    // Business Info section
    businessInfoTitle: 'Business Information',
    businessInfoDesc: 'Your registered business details',
    businessName: 'Business Name',
    businessNameHe: 'Business Name (Hebrew)',
    businessNameEn: 'Business Name (English)',
    vatNumber: 'VAT Number',
    businessType: 'Business Type',
    address: 'Address',
    city: 'City',
    email: 'Email',
    phone: 'Phone',
    fax: 'Fax',
    noBusinessInfo: 'No business information registered yet',
    // Documents section
    generalDocs: 'General Documents',
    generalDocsDesc: 'Create business documents',
    documentHistory: 'Document History',
    documentHistoryDesc: 'View all created documents',
    // Accountant section
    accountantSection: 'Accountant Information',
    accountantName: 'Accountant Name',
    accountantEmail: 'Accountant Email',
    accountantPhone: 'Accountant Phone',
    clientBook: 'Client Book',
    clientBookDesc: 'Manage your clients',
  } : language === 'he' ? {
    title: 'לוח בקרה בסיסי',
    subtitle: 'ברוך הבא',
    businessTab: 'מידע עסקי',
    documentsTab: 'מסמכים',
    // Business Info section
    businessInfoTitle: 'מידע עסקי',
    businessInfoDesc: 'פרטי העסק הרשום שלך',
    businessName: 'שם העסק',
    businessNameHe: 'שם העסק (עברית)',
    businessNameEn: 'שם העסק (אנגלית)',
    vatNumber: 'מספר עוסק מורשה',
    businessType: 'סוג העסק',
    address: 'כתובת',
    city: 'עיר',
    email: 'דוא"ל',
    phone: 'טלפון',
    fax: 'פקס',
    noBusinessInfo: 'אין מידע עסקי רשום עדיין',
    // Documents section
    generalDocs: 'מסמכים כלליים',
    generalDocsDesc: 'יצירת מסמכים עסקיים',
    documentHistory: 'היסטוריית מסמכים',
    documentHistoryDesc: 'צפייה בכל המסמכים שנוצרו',
    // Accountant section
    accountantSection: 'פרטי רואה חשבון',
    accountantName: 'שם רואה חשבון',
    accountantEmail: 'דוא"ל רואה חשבון',
    accountantPhone: 'טלפון רואה חשבון',
    clientBook: 'ספר לקוחות',
    clientBookDesc: 'ניהול הלקוחות שלך',
  } : {
    title: 'لوحة تحكم أساسية',
    subtitle: 'مرحبا بعودتك',
    businessTab: 'معلومات العمل',
    documentsTab: 'المستندات',
    // Business Info section
    businessInfoTitle: 'معلومات العمل',
    businessInfoDesc: 'تفاصيل عملك المسجل',
    businessName: 'اسم العمل',
    businessNameHe: 'اسم العمل (عبري)',
    businessNameEn: 'اسم العمل (إنجليزي)',
    vatNumber: 'رقم ضريبة القيمة المضافة',
    businessType: 'نوع العمل',
    address: 'العنوان',
    city: 'المدينة',
    email: 'البريد الإلكتروني',
    phone: 'الهاتف',
    fax: 'الفاكس',
    noBusinessInfo: 'لا توجد معلومات عمل مسجلة بعد',
    // Documents section
    generalDocs: 'المستندات العامة',
    generalDocsDesc: 'إنشاء مستندات الأعمال',
    documentHistory: 'سجل المستندات',
    documentHistoryDesc: 'عرض جميع المستندات المنشأة',
    // Accountant section
    accountantSection: 'معلومات المحاسب',
    accountantName: 'اسم المحاسب',
    accountantEmail: 'بريد المحاسب',
    accountantPhone: 'هاتف المحاسب',
    clientBook: 'دفتر العملاء',
    clientBookDesc: 'إدارة عملائك',
  };

  // Render a single info row in business info card
  const renderInfoRow = (label, value) => {
    if (!value) return null;
    return (
      <View style={styles.infoRow}>
        <AppText style={[styles.infoLabel, { color: colors.textSecondary }]}>{label}</AppText>
        <AppText style={[styles.infoValue, { color: colors.textPrimary }]}>{value}</AppText>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />
      
      {/* Tab Content */}
      <ScrollableContainer 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.cardsContainer}>
          {/* Business Info Tab Content */}
          {activeTab === 'business' && (
            <>
              {/* Business Info Card */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <View style={[styles.cardIconCircle, { backgroundColor: colors.primary + '15' }]}>
                    <MaterialCommunityIcons name="domain" size={32} color={colors.primary} />
                  </View>
                </View>
                <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.businessInfoTitle}</AppText>
                <AppText style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.businessInfoDesc}</AppText>
                
                {businessInfo ? (
                  <View style={styles.businessInfoContent}>
                    {/* Primary Info */}
                    {renderInfoRow(t.businessNameHe, businessInfo.heName)}
                    {renderInfoRow(t.businessNameEn, businessInfo.enName)}
                    {renderInfoRow(t.vatNumber, businessInfo.vatNumber)}
                    {renderInfoRow(t.businessType, businessInfo.businessType)}
                    
                    {/* Address */}
                    {(businessInfo.address || businessInfo.city) && (
                      <View style={[styles.separator, { borderTopColor: colors.border }]} />
                    )}
                    {renderInfoRow(t.address, businessInfo.address)}
                    {renderInfoRow(t.city, businessInfo.city)}
                    
                    {/* Contact */}
                    {(businessInfo.businessEmail || businessInfo.businessPhone || businessInfo.businessFax) && (
                      <View style={[styles.separator, { borderTopColor: colors.border }]} />
                    )}
                    {renderInfoRow(t.email, businessInfo.businessEmail)}
                    {renderInfoRow(t.phone, businessInfo.businessPhone)}
                    {renderInfoRow(t.fax, businessInfo.businessFax)}
                    
                    {/* Accountant Info */}
                    {(businessInfo.accountantName || businessInfo.accountantEmail || businessInfo.accountantPhone) && (
                      <>
                        <View style={[styles.separator, { borderTopColor: colors.border }]} />
                        <AppText style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t.accountantSection}</AppText>
                        {renderInfoRow(t.accountantName, businessInfo.accountantName)}
                        {renderInfoRow(t.accountantEmail, businessInfo.accountantEmail)}
                        {renderInfoRow(t.accountantPhone, businessInfo.accountantPhone)}
                      </>
                    )}
                  </View>
                ) : (
                  <View style={styles.noBusinessInfo}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={48} color={colors.textSecondary} />
                    <AppText style={[styles.noBusinessInfoText, { color: colors.textSecondary }]}>
                      {t.noBusinessInfo}
                    </AppText>
                  </View>
                )}
              </View>
            </>
          )}

          {/* Documents Tab Content */}
          {activeTab === 'documents' && hasDocs && (
            <>
              {/* General Documents Card - Navigate to GeneralDocuments (without tax invoice for basic role) */}
              <TouchableOpacity onPress={() => router.push('/GeneralDocuments')}>
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.cardIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                      <MaterialCommunityIcons name="file-document-multiple" size={32} color={colors.secondary} />
                    </View>
                    <Feather name="chevron-right" size={24} color={colors.secondary} style={styles.cardChevron} />
                  </View>
                  <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.generalDocs}</AppText>
                  <AppText style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.generalDocsDesc}</AppText>
                </View>
              </TouchableOpacity>

              {/* Document History Card */}
              <TouchableOpacity onPress={() => router.push('/DocumentHistory')}>
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.cardIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                      <MaterialCommunityIcons name="history" size={32} color={colors.secondary} />
                    </View>
                    <Feather name="chevron-right" size={24} color={colors.secondary} style={styles.cardChevron} />
                  </View>
                  <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.documentHistory}</AppText>
                  <AppText style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.documentHistoryDesc}</AppText>
                </View>
              </TouchableOpacity>

              {/* Client Book Card */}
              <TouchableOpacity onPress={() => router.push('/ClientBook')}>
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.cardIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                      <MaterialCommunityIcons name="book-account" size={32} color={colors.secondary} />
                    </View>
                    <Feather name="chevron-right" size={24} color={colors.secondary} style={styles.cardChevron} />
                  </View>
                  <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.clientBook}</AppText>
                  <AppText style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.clientBookDesc}</AppText>
                </View>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollableContainer>

      {/* Tab Navigation */}
      <View style={[styles.tabContainer, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingBottom: insets.bottom }]}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'business' && styles.activeTab]} 
          onPress={() => setActiveTab('business')}
        >
          <MaterialCommunityIcons 
            name="domain" 
            size={24} 
            color={activeTab === 'business' ? colors.primary : colors.textSecondary} 
          />
          <AppText style={[
            styles.tabText, 
            { color: activeTab === 'business' ? colors.primary : colors.textSecondary }
          ]}>
            {t.businessTab}
          </AppText>
          {activeTab === 'business' && <View style={[styles.activeTabIndicator, { backgroundColor: colors.primary }]} />}
        </TouchableOpacity>

        {hasDocs && (
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'documents' && styles.activeTab]} 
          onPress={() => setActiveTab('documents')}
        >
          <MaterialCommunityIcons 
            name="file-document-multiple" 
            size={24} 
            color={activeTab === 'documents' ? colors.secondary : colors.textSecondary} 
          />
          <AppText style={[
            styles.tabText, 
            { color: activeTab === 'documents' ? colors.secondary : colors.textSecondary }
          ]}>
            {t.documentsTab}
          </AppText>
          {activeTab === 'documents' && <View style={[styles.activeTabIndicator, { backgroundColor: colors.secondary }]} />}
        </TouchableOpacity>
        )}
      </View>

      {/* Fixed GlobalHeader */}
      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabContainer: {
    flexDirection: 'row',
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    ...shadows.floating,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    position: 'relative',
  },
  activeTab: {
    // Active tab styling handled by indicator
  },
  tabText: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    marginTop: spacing.xs,
    letterSpacing: 0.2,
  },
  activeTabIndicator: {
    position: 'absolute',
    bottom: -spacing.sm,
    left: spacing.md,
    right: spacing.md,
    height: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  cardsContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: 100,
    paddingBottom: spacing.xxl,
  },
  card: {
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    marginBottom: spacing.md + 6,
    borderWidth: 1,
    ...shadows.floating,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  cardIconCircle: {
    width: 62,
    height: 62,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(13, 138, 232, 0.25)',
  },
  cardChevron: {
    opacity: 0.75,
  },
  cardTitle: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    marginBottom: spacing.xs,
    letterSpacing: -0.2,
  },
  cardDescription: {
    fontSize: typography.base,
    lineHeight: 22,
    letterSpacing: 0.15,
  },
  // Business Info specific styles
  businessInfoContent: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(87, 111, 138, 0.22)',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  infoLabel: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
    flex: 1,
  },
  infoValue: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    flex: 1.5,
    textAlign: 'right',
  },
  separator: {
    borderTopWidth: 1,
    marginVertical: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  noBusinessInfo: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  noBusinessInfoText: {
    fontSize: typography.base,
    textAlign: 'center',
  },
});
