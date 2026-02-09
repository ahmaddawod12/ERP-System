import React, { useState } from 'react';
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
import { auth } from '../firebase';
import { getColors, gradients, spacing, borderRadius, typography, shadows } from '../theme';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { useAlert } from '../contexts/AlertContext';
import { useAuth } from '../hooks';
import { GlobalHeader, ScrollableContainer } from '../components';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function UserHomepage() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { username } = useAuth();
  const [activeTab, setActiveTab] = useState('work');
  const colors = getColors(isDarkMode);
  const insets = useSafeAreaInsets();

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
          {activeTab === 'work' && (
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
                  <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.createJob}</Text>
                  <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.createJobDesc}</Text>
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
                  <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.inventory}</Text>
                  <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.inventoryDesc}</Text>
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

          {/* Documents Tab Content */}
          {activeTab === 'documents' && (
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
                  <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.generalDocs}</Text>
                  <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.generalDocsDesc}</Text>
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
                  <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.taxInvoice}</Text>
                  <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.taxInvoiceDesc}</Text>
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
            </>
          )}
        </View>
      </ScrollableContainer>
      {/* Tab Navigation */}
      <View style={[styles.tabContainer, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingBottom: insets.bottom }]}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'work' && styles.activeTab]} 
          onPress={() => setActiveTab('work')}
        >
          <MaterialCommunityIcons 
            name="briefcase" 
            size={24} 
            color={activeTab === 'work' ? colors.secondary : colors.textSecondary} 
          />
          <Text style={[
            styles.tabText, 
            { color: activeTab === 'work' ? colors.secondary : colors.textSecondary }
          ]}>
            {t.workTab}
          </Text>
          {activeTab === 'work' && <View style={[styles.activeTabIndicator, { backgroundColor: colors.secondary }]} />}
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
});