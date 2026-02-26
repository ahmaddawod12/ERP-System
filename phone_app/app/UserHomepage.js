import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { getColors, spacing, borderRadius, typography, shadows } from '../theme';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { useCache } from '../contexts/CacheContext';
import { isSubscriptionActive, isModuleEnabled } from '../modules/shared';
import { AppText, GlobalHeader, ScrollableContainer } from '../components';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function UserHomepage() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const { subscription } = useCache();
  const [activeTab, setActiveTab] = useState('work');
  const colors = getColors(isDarkMode);
  const insets = useSafeAreaInsets();

  // Module checks
  const hasSoloJob = isModuleEnabled(subscription, 'solojob');
  const hasDocs = isModuleEnabled(subscription, 'documents');
  const subActive = isSubscriptionActive(subscription);

  const availableTabs = [
    ...(hasSoloJob ? ['work'] : []),
    ...(hasDocs ? ['documents'] : []),
  ];

  // Auto-select first available tab if current is no longer available
  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0]);
    }
  }, [hasSoloJob, hasDocs]);

  const t = language === 'en' ? {
    title: 'User Dashboard',
    subtitle: 'Welcome back',
    workTab: 'Work',
    documentsTab: 'Documents',
    createJob: 'Create & Fill Job',
    createJobDesc: 'Create and manage your own jobs',
    inventory: 'My Inventory',
    inventoryDesc: 'Manage your parts',
    clientBook: 'Client Book',
    clientBookDesc: 'Manage your clients',
    generalDocs: 'General Documents',
    generalDocsDesc: 'Create business documents',
    taxInvoice: 'Generate Tax Invoice',
    taxInvoiceDesc: 'Create invoices from completed jobs',
    documentHistory: 'Document History',
    documentHistoryDesc: 'View all created documents',
  } : language === 'he' ? {
    title: 'לוח בקרה משתמש',
    subtitle: 'ברוך הבא',
    workTab: 'עבודה',
    documentsTab: 'מסמכים',
    createJob: 'יצירה ומילוי משימה',
    createJobDesc: 'יצירה וניהול משימות שלך',
    inventory: 'המלאי שלי',
    inventoryDesc: 'ניהול חלקים',
    clientBook: 'ספר לקוחות',
    clientBookDesc: 'ניהול הלקוחות שלך',
    generalDocs: 'מסמכים כלליים',
    generalDocsDesc: 'יצירת מסמכים עסקיים',
    taxInvoice: 'יצירת חשבונית מס',
    taxInvoiceDesc: 'יצירת חשבוניות ממשימות שהושלמו',
    documentHistory: 'היסטוריית מסמכים',
    documentHistoryDesc: 'צפייה בכל המסמכים שנוצרו',
  } : {
    title: 'لوحة تحكم المستخدم',
    subtitle: 'مرحبا بعودتك',
    workTab: 'العمل',
    documentsTab: 'المستندات',
    createJob: 'إنشاء وملء مهمة',
    createJobDesc: 'إنشاء وإدارة مهامك الخاصة',
    inventory: 'مخزوني',
    inventoryDesc: 'إدارة القطع',
    clientBook: 'دفتر العملاء',
    clientBookDesc: 'إدارة عملائك',
    generalDocs: 'المستندات العامة',
    generalDocsDesc: 'إنشاء مستندات الأعمال',
    taxInvoice: 'إنشاء فاتورة ضريبية',
    taxInvoiceDesc: 'إنشاء فواتير من المهام المكتملة',
    documentHistory: 'سجل المستندات',
    documentHistoryDesc: 'عرض جميع المستندات المنشأة',
  };



  // Subscription expired — block the entire homepage
  if (!subActive) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}> 
        <StatusBar style={isDarkMode ? 'light' : 'dark'} />
        <View style={{ alignItems: 'center', paddingHorizontal: spacing.xl }}>
          <Ionicons name="time-outline" size={72} color={colors.error} />
          <AppText style={{ fontSize: 22, fontWeight: '800', color: colors.text, marginTop: spacing.lg, textAlign: 'center' }}>
            {language === 'he' ? 'המנוי פג תוקף' : language === 'ar' ? 'انتهى الاشتراك' : 'Subscription Expired'}
          </AppText>
          <AppText style={{ fontSize: 15, color: colors.textSecondary, marginTop: spacing.md, textAlign: 'center', lineHeight: 22 }}>
            {language === 'he' ? 'אנא חדש את המנוי דרך האתר כדי להמשיך להשתמש באפליקציה.' : language === 'ar' ? 'يرجى تجديد اشتراكك عبر الموقع الإلكتروني لمواصلة استخدام التطبيق.' : 'Please renew your subscription on the website to continue using the app.'}
          </AppText>
        </View>
        <GlobalHeader />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />
      {/* Tab Content */}
      <ScrollableContainer 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.cardsContainer}>
          {/* Work Tab Content */}
          {activeTab === 'work' && hasSoloJob && (
            <>
              {/* Create Job Card */}
              <TouchableOpacity onPress={() => router.push('/Userjob')}>
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.cardIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                      <MaterialCommunityIcons name="briefcase-check" size={32} color={colors.secondary} />
                    </View>
                    <Feather name="chevron-right" size={24} color={colors.secondary} style={styles.cardChevron} />
                  </View>
                  <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.createJob}</AppText>
                  <AppText style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.createJobDesc}</AppText>
                </View>
              </TouchableOpacity>

              {/* Inventory Card */}
              <TouchableOpacity onPress={() => router.push('/inventory')}>
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.cardIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                      <MaterialCommunityIcons name="package-variant" size={32} color={colors.secondary} />
                    </View>
                    <Feather name="chevron-right" size={24} color={colors.secondary} style={styles.cardChevron} />
                  </View>
                  <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.inventory}</AppText>
                  <AppText style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.inventoryDesc}</AppText>
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

          {/* Documents Tab Content */}
          {activeTab === 'documents' && hasDocs && (
            <>
              {/* General Documents Card */}
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

              {/* Generate Tax Invoice Card */}
              <TouchableOpacity onPress={() => router.push('/GenerateTaxInvoice')}>
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.cardIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                      <MaterialCommunityIcons name="file-document-edit" size={32} color={colors.secondary} />
                    </View>
                    <Feather name="chevron-right" size={24} color={colors.secondary} style={styles.cardChevron} />
                  </View>
                  <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.taxInvoice}</AppText>
                  <AppText style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.taxInvoiceDesc}</AppText>
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
            </>
          )}
        </View>
      </ScrollableContainer>
      {/* Tab Navigation */}
      <View style={[styles.tabContainer, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingBottom: insets.bottom }]}>
        {hasSoloJob && (
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'work' && styles.activeTab]} 
          onPress={() => setActiveTab('work')}
        >
          <MaterialCommunityIcons 
            name="briefcase" 
            size={24} 
            color={activeTab === 'work' ? colors.secondary : colors.textSecondary} 
          />
          <AppText style={[
            styles.tabText, 
            { color: activeTab === 'work' ? colors.secondary : colors.textSecondary }
          ]}>
            {t.workTab}
          </AppText>
          {activeTab === 'work' && <View style={[styles.activeTabIndicator, { backgroundColor: colors.secondary }]} />}
        </TouchableOpacity>
        )}

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
  themeButton: {
    position: 'absolute',
    top: 48,
    right: 80,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    ...shadows.md,
  },
  languageButton: {
    position: 'absolute',
    top: 48,
    right: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 10,
    ...shadows.md,
  },
  languageButtonText: {
    color: 'white',
    fontWeight: '600',
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
});

