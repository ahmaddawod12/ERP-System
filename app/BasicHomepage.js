import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { getColors, gradients, spacing, borderRadius, typography, shadows } from '../theme';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { useAlert } from '../contexts/AlertContext';
import { useCache } from '../contexts/CacheContext';
import { GlobalHeader, LoadingSpinner, ScrollableContainer } from '../components';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function BasicHomepage() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { businessInfo } = useCache();
  const [activeTab, setActiveTab] = useState('business');
  const colors = getColors(isDarkMode);
  const insets = useSafeAreaInsets();

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
        <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: colors.textPrimary }]}>{value}</Text>
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
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.businessInfoTitle}</Text>
                <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.businessInfoDesc}</Text>
                
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
                        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t.accountantSection}</Text>
                        {renderInfoRow(t.accountantName, businessInfo.accountantName)}
                        {renderInfoRow(t.accountantEmail, businessInfo.accountantEmail)}
                        {renderInfoRow(t.accountantPhone, businessInfo.accountantPhone)}
                      </>
                    )}
                  </View>
                ) : (
                  <View style={styles.noBusinessInfo}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={48} color={colors.textSecondary} />
                    <Text style={[styles.noBusinessInfoText, { color: colors.textSecondary }]}>
                      {t.noBusinessInfo}
                    </Text>
                  </View>
                )}
              </View>
            </>
          )}

          {/* Documents Tab Content */}
          {activeTab === 'documents' && (
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
                  <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.generalDocs}</Text>
                  <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.generalDocsDesc}</Text>
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
                  <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.documentHistory}</Text>
                  <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.documentHistoryDesc}</Text>
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
                  <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.clientBook}</Text>
                  <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.clientBookDesc}</Text>
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
          <Text style={[
            styles.tabText, 
            { color: activeTab === 'business' ? colors.primary : colors.textSecondary }
          ]}>
            {t.businessTab}
          </Text>
          {activeTab === 'business' && <View style={[styles.activeTabIndicator, { backgroundColor: colors.primary }]} />}
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'documents' && styles.activeTab]} 
          onPress={() => setActiveTab('documents')}
        >
          <MaterialCommunityIcons 
            name="file-document-multiple" 
            size={24} 
            color={activeTab === 'documents' ? colors.secondary : colors.textSecondary} 
          />
          <Text style={[
            styles.tabText, 
            { color: activeTab === 'documents' ? colors.secondary : colors.textSecondary }
          ]}>
            {t.documentsTab}
          </Text>
          {activeTab === 'documents' && <View style={[styles.activeTabIndicator, { backgroundColor: colors.secondary }]} />}
        </TouchableOpacity>
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
    paddingTop: 20,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    ...shadows.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    position: 'relative',
  },
  activeTab: {
    // Active tab styling handled by indicator
  },
  tabText: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    marginTop: spacing.xs,
  },
  activeTabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: spacing.md,
  },
  cardsContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: 100,
    paddingBottom: spacing.xxl,
  },
  card: {
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    marginBottom: spacing.md + 4,
    borderWidth: 1.5,
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  cardIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardChevron: {
    opacity: 0.7,
  },
  cardTitle: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    marginBottom: spacing.xs,
    letterSpacing: -0.3,
  },
  cardDescription: {
    fontSize: typography.base,
    lineHeight: 22,
    letterSpacing: 0.1,
  },
  // Business Info specific styles
  businessInfoContent: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
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
