import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { auth } from '../firebase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getColors, gradients, spacing, borderRadius, typography, shadows } from '../theme';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { useAlert } from '../contexts/AlertContext';
import { useAuth } from '../hooks';
import { GlobalHeader, ScrollableContainer } from '../components';

export default function ManagerHomepage() {
  const router = useRouter();
  const { tab } = useLocalSearchParams();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { username } = useAuth();
  const [activeTab, setActiveTab] = useState('management');
  const insets = useSafeAreaInsets();
  const colors = getColors(isDarkMode);

  // Set active tab from URL parameter
  useEffect(() => {
    if (tab === 'work' || tab === 'management' || tab === 'jobMonitor' || tab === 'documents') {
      setActiveTab(tab);
    }
  }, [tab]);

  const t = language === 'en' ? {
    title: 'Manager Dashboard',
    subtitle: 'Welcome back',
    managementTab: 'Management',
    workTab: 'Work',
    jobMonitorTab: 'Job Monitor',
    documentsTab: 'Documents',
    workersMonitor: 'Workers Monitor',
    workersMonitorDesc: 'Monitor inventory & jobs',
    workersUsers: 'Manage Workers',
    workersUsersDesc: 'Create/Edit worker accounts',
    companyParts: 'Company Parts',
    companyPartsDesc: 'Manage master parts list',
    jobMonitor: 'Job Monitor',
    jobMonitorDesc: 'Track all company jobs',
    manageJobs: 'Manage Jobs',
    manageJobsDesc: 'Assign new jobs to workers',
    createJob: 'Create Job',
    createJobDesc: 'Assign jobs to workers',
    inventory: 'My Inventory',
    inventoryDesc: 'Manage your parts',
    clientBook: 'Client Book',
    clientBookDesc: 'Manage your clients',
    myJobs: 'My Jobs',
    myJobsDesc: 'Create and view your jobs',
    generateTaxInvoice: 'Generate Tax Invoice',
    generateTaxInvoiceDesc: 'Create tax invoices from finished jobs',
    generalDocuments: 'General Documents',
    generalDocumentsDesc: 'Manage legal documents',
    documentHistory: 'Document History',
    documentHistoryDesc: 'View all created documents',
  } : language === 'he' ? {
    title: 'לוח בקרה מנהל',
    subtitle: 'ברוך הבא',
    managementTab: 'ניהול',
    workTab: 'עבודה',
    jobMonitorTab: 'ניטור משימות',
    documentsTab: 'מסמכים',
    workersMonitor: 'ניטור עובדים',
    workersMonitorDesc: 'ניטור מלאי ומשימות',
    workersUsers: 'ניהול עובדים',
    workersUsersDesc: 'יצירה/עריכת חשבונות עובדים',
    companyParts: 'חלקי חברה',
    companyPartsDesc: 'ניהול רשימת חלקים ראשית',
    jobMonitor: 'ניטור משימות',
    jobMonitorDesc: 'מעקב אחר כל משימות החברה',
    manageJobs: 'ניהול משימות',
    manageJobsDesc: 'הקצאת משימות חדשות לעובדים',
    createJob: 'יצירת משימה',
    createJobDesc: 'הקצאת משימות לעובדים',
    inventory: 'המלאי שלי',
    inventoryDesc: 'ניהול חלקים',
    clientBook: 'ספר לקוחות',
    clientBookDesc: 'ניהול הלקוחות שלך',
    myJobs: 'המשימות שלי',
    myJobsDesc: 'יצירה וצפייה במשימות שלך',
    generateTaxInvoice: 'יצירת חשבונית מס',
    generateTaxInvoiceDesc: 'יצירת חשבוניות מס ממשימות שהסתיימו',
    generalDocuments: 'מסמכים כלליים',
    generalDocumentsDesc: 'ניהול מסמכים משפטיים',
    documentHistory: 'היסטוריית מסמכים',
    documentHistoryDesc: 'צפייה בכל המסמכים שנוצרו',
  } : {
    title: 'لوحة تحكم المدير',
    subtitle: 'مرحبا بعودتك',
    managementTab: 'الإدارة',
    workTab: 'العمل',
    jobMonitorTab: 'مراقبة المهام',
    documentsTab: 'المستندات',
    workersMonitor: 'مراقبة العمال',
    workersMonitorDesc: 'مراقبة المخزون والمهام',
    workersUsers: 'إدارة العمال',
    workersUsersDesc: 'إنشاء/تعديل حسابات العمال',
    companyParts: 'قطع الشركة',
    companyPartsDesc: 'إدارة قائمة القطع الرئيسية',
    jobMonitor: 'مراقبة المهام',
    jobMonitorDesc: 'تتبع جميع مهام الشركة',
    manageJobs: 'إدارة المهام',
    manageJobsDesc: 'تعيين مهام جديدة للعمال',
    createJob: 'إنشاء مهمة',
    createJobDesc: 'تعيين المهام للعمال',
    inventory: 'مخزوني',
    inventoryDesc: 'إدارة القطع',
    clientBook: 'دفتر العملاء',
    clientBookDesc: 'إدارة عملائك',
    myJobs: 'مهامي',
    myJobsDesc: 'إنشاء وعرض مهامك',
    generateTaxInvoice: 'إنشاء فاتورة ضريبية',
    generateTaxInvoiceDesc: 'إنشاء فواتير ضريبية من المهام المنتهية',
    generalDocuments: 'المستندات العامة',
    generalDocumentsDesc: 'إدارة المستندات القانونية',
    documentHistory: 'سجل المستندات',
    documentHistoryDesc: 'عرض جميع المستندات المنشأة',
  };


  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />
      
      {/* White Background Content */}
      <ScrollableContainer 
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 50 + insets.bottom }]}
      >
        <View style={styles.cardsContainer}>
          {activeTab === 'management' ? (
            <>
              {/* Workers Monitor Card */}
              <TouchableOpacity onPress={() => router.push('/WorkersMonitor')} style={[styles.simpleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.simpleCardHeader}>
                  <View style={[styles.simpleIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                    <MaterialCommunityIcons name="monitor-eye" size={32} color={colors.secondary} />
                  </View>
                  <Feather name="chevron-right" size={24} color={colors.secondary} />
                </View>
                <Text style={[styles.simpleCardTitle, { color: colors.textPrimary }]}>{t.workersMonitor}</Text>
                <Text style={[styles.simpleCardDescription, { color: colors.textSecondary }]}>{t.workersMonitorDesc}</Text>
              </TouchableOpacity>

              {/* Workers Users Card */}
              <TouchableOpacity onPress={() => router.push('/WorkersUsers')} style={[styles.simpleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.simpleCardHeader}>
                  <View style={[styles.simpleIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                    <MaterialCommunityIcons name="account-group" size={32} color={colors.secondary} />
                  </View>
                  <Feather name="chevron-right" size={24} color={colors.secondary} />
                </View>
                <Text style={[styles.simpleCardTitle, { color: colors.textPrimary }]}>{t.workersUsers}</Text>
                <Text style={[styles.simpleCardDescription, { color: colors.textSecondary }]}>{t.workersUsersDesc}</Text>
              </TouchableOpacity>

              {/* Company Parts Card */}
              <TouchableOpacity onPress={() => router.push('/CompanyInventory')} style={[styles.simpleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.simpleCardHeader}>
                  <View style={[styles.simpleIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                    <MaterialCommunityIcons name="package-variant-closed" size={32} color={colors.secondary} />
                  </View>
                  <Feather name="chevron-right" size={24} color={colors.secondary} />
                </View>
                <Text style={[styles.simpleCardTitle, { color: colors.textPrimary }]}>{t.companyParts}</Text>
                <Text style={[styles.simpleCardDescription, { color: colors.textSecondary }]}>{t.companyPartsDesc}</Text>
              </TouchableOpacity>
            </>
          ) : activeTab === 'jobMonitor' ? (
            <>
              {/* Job Monitor Card */}
              <TouchableOpacity onPress={() => router.push('/JobMonitor')} style={[styles.simpleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.simpleCardHeader}>
                  <View style={[styles.simpleIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                    <MaterialCommunityIcons name="clipboard-text-clock" size={32} color={colors.secondary} />
                  </View>
                  <Feather name="chevron-right" size={24} color={colors.secondary} />
                </View>
                <Text style={[styles.simpleCardTitle, { color: colors.textPrimary }]}>{t.jobMonitor}</Text>
                <Text style={[styles.simpleCardDescription, { color: colors.textSecondary }]}>{t.jobMonitorDesc}</Text>
              </TouchableOpacity>

              {/* Manage Jobs Card */}
              <TouchableOpacity onPress={() => router.push('/ManageJobs')} style={[styles.simpleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.simpleCardHeader}>
                  <View style={[styles.simpleIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                    <MaterialCommunityIcons name="clipboard-check-multiple" size={32} color={colors.secondary} />
                  </View>
                  <Feather name="chevron-right" size={24} color={colors.secondary} />
                </View>
                <Text style={[styles.simpleCardTitle, { color: colors.textPrimary }]}>{t.manageJobs}</Text>
                <Text style={[styles.simpleCardDescription, { color: colors.textSecondary }]}>{t.manageJobsDesc}</Text>
              </TouchableOpacity>
            </>
          ) : activeTab === 'documents' ? (
            <>
              {/* Generate Tax Invoice Card */}
              <TouchableOpacity onPress={() => router.push('/GenerateTaxInvoice')} style={[styles.simpleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.simpleCardHeader}>
                  <View style={[styles.simpleIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                    <MaterialCommunityIcons name="receipt" size={32} color={colors.secondary} />
                  </View>
                  <Feather name="chevron-right" size={24} color={colors.secondary} />
                </View>
                <Text style={[styles.simpleCardTitle, { color: colors.textPrimary }]}>{t.generateTaxInvoice}</Text>
                <Text style={[styles.simpleCardDescription, { color: colors.textSecondary }]}>{t.generateTaxInvoiceDesc}</Text>
              </TouchableOpacity>

              {/* General Documents Card */}
              <TouchableOpacity onPress={() => router.push('/GeneralDocuments')} style={[styles.simpleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.simpleCardHeader}>
                  <View style={[styles.simpleIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                    <MaterialCommunityIcons name="file-document-multiple" size={32} color={colors.secondary} />
                  </View>
                  <Feather name="chevron-right" size={24} color={colors.secondary} />
                </View>
                <Text style={[styles.simpleCardTitle, { color: colors.textPrimary }]}>{t.generalDocuments}</Text>
                <Text style={[styles.simpleCardDescription, { color: colors.textSecondary }]}>{t.generalDocumentsDesc}</Text>
              </TouchableOpacity>

              {/* Document History Card */}
              <TouchableOpacity onPress={() => router.push('/DocumentHistory')} style={[styles.simpleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.simpleCardHeader}>
                  <View style={[styles.simpleIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                    <MaterialCommunityIcons name="history" size={32} color={colors.secondary} />
                  </View>
                  <Feather name="chevron-right" size={24} color={colors.secondary} />
                </View>
                <Text style={[styles.simpleCardTitle, { color: colors.textPrimary }]}>{t.documentHistory}</Text>
                <Text style={[styles.simpleCardDescription, { color: colors.textSecondary }]}>{t.documentHistoryDesc}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* My Jobs Card */}
              <TouchableOpacity onPress={() => router.push('/Userjob')} style={[styles.simpleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.simpleCardHeader}>
                  <View style={[styles.simpleIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                    <MaterialCommunityIcons name="briefcase-check" size={32} color={colors.secondary} />
                  </View>
                  <Feather name="chevron-right" size={24} color={colors.secondary} />
                </View>
                <Text style={[styles.simpleCardTitle, { color: colors.textPrimary }]}>{t.myJobs}</Text>
                <Text style={[styles.simpleCardDescription, { color: colors.textSecondary }]}>{t.myJobsDesc}</Text>
              </TouchableOpacity>

              {/* Inventory Card */}
              <TouchableOpacity onPress={() => router.push('/inventory')} style={[styles.simpleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.simpleCardHeader}>
                  <View style={[styles.simpleIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                    <MaterialCommunityIcons name="package-variant" size={32} color={colors.secondary} />
                  </View>
                  <Feather name="chevron-right" size={24} color={colors.secondary} />
                </View>
                <Text style={[styles.simpleCardTitle, { color: colors.textPrimary }]}>{t.inventory}</Text>
                <Text style={[styles.simpleCardDescription, { color: colors.textSecondary }]}>{t.inventoryDesc}</Text>
              </TouchableOpacity>

              {/* Client Book Card */}
              <TouchableOpacity onPress={() => router.push('/ClientBook')} style={[styles.simpleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.simpleCardHeader}>
                  <View style={[styles.simpleIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                    <MaterialCommunityIcons name="book-account" size={32} color={colors.secondary} />
                  </View>
                  <Feather name="chevron-right" size={24} color={colors.secondary} />
                </View>
                <Text style={[styles.simpleCardTitle, { color: colors.textPrimary }]}>{t.clientBook}</Text>
                <Text style={[styles.simpleCardDescription, { color: colors.textSecondary }]}>{t.clientBookDesc}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollableContainer>

      {/* Bottom Tab Navigation */}
      <View style={[styles.bottomTabContainer, { 
        paddingBottom: insets.bottom,
        backgroundColor: colors.surface,
        borderTopColor: colors.border,
      }]}>
        <TouchableOpacity
          style={styles.bottomTab}
          onPress={() => setActiveTab('management')}
        >
          <View style={[styles.iconContainer, {
            backgroundColor: activeTab === 'management' ? colors.secondary : colors.backgroundLight,
          }]}>
            <MaterialCommunityIcons 
              name="account-group" 
              size={24} 
              color={activeTab === 'management' ? 'white' : colors.textSecondary} 
            />
          </View>
          <Text style={[styles.bottomTabText, { 
            color: activeTab === 'management' ? colors.primary : colors.textSecondary,
            fontWeight: activeTab === 'management' ? typography.bold : typography.semibold,
          }]}>
            {t.managementTab}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.bottomTab}
          onPress={() => setActiveTab('jobMonitor')}
        >
          <View style={[styles.iconContainer, {
            backgroundColor: activeTab === 'jobMonitor' ? colors.secondary : colors.backgroundLight,
          }]}>
            <MaterialCommunityIcons 
              name="clipboard-text-clock" 
              size={24} 
              color={activeTab === 'jobMonitor' ? 'white' : colors.textSecondary} 
            />
          </View>
          <Text style={[styles.bottomTabText, { 
            color: activeTab === 'jobMonitor' ? colors.primary : colors.textSecondary,
            fontWeight: activeTab === 'jobMonitor' ? typography.bold : typography.semibold,
          }]}>
            {t.jobMonitorTab}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.bottomTab}
          onPress={() => setActiveTab('work')}
        >
          <View style={[styles.iconContainer, {
            backgroundColor: activeTab === 'work' ? colors.secondary : colors.backgroundLight,
          }]}>
            <MaterialCommunityIcons 
              name="briefcase" 
              size={24} 
              color={activeTab === 'work' ? 'white' : colors.textSecondary} 
            />
          </View>
          <Text style={[styles.bottomTabText, { 
            color: activeTab === 'work' ? colors.primary : colors.textSecondary,
            fontWeight: activeTab === 'work' ? typography.bold : typography.semibold,
          }]}>
            {t.workTab}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.bottomTab}
          onPress={() => setActiveTab('documents')}
        >
          <View style={[styles.iconContainer, {
            backgroundColor: activeTab === 'documents' ? colors.secondary : colors.backgroundLight,
          }]}>
            <MaterialCommunityIcons 
              name="file-document" 
              size={24} 
              color={activeTab === 'documents' ? 'white' : colors.textSecondary} 
            />
          </View>
          <Text style={[styles.bottomTabText, { 
            color: activeTab === 'documents' ? colors.primary : colors.textSecondary,
            fontWeight: activeTab === 'documents' ? typography.bold : typography.semibold,
          }]}>
            {t.documentsTab}
          </Text>
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
  themeButton: {
    position: 'absolute',
    top: 52,
    right: spacing.lg + 60,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    ...shadows.card,
  },
  languageButton: {
    position: 'absolute',
    top: 52,
    right: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 10,
    ...shadows.card,
  },
  languageButtonText: {
    color: 'white',
    fontWeight: typography.bold,
    letterSpacing: 0.5,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  cardsContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: 100,
  },
  // Simple White Card Styles (Larger size)
  simpleCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    marginBottom: spacing.md + 4,
    borderWidth: 1.5,
    ...shadows.card,
  },
  simpleCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  simpleIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  simpleCardTitle: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    marginBottom: spacing.xs,
    letterSpacing: -0.3,
  },
  simpleCardDescription: {
    fontSize: typography.base,
    lineHeight: 22,
  },
  // Old gradient card styles (kept for backwards compatibility)
  colorfulCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    marginBottom: spacing.md + 4,
    ...shadows.floating,
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
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  cardChevron: {
    opacity: 0.9,
  },
  cardTitle: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    color: 'white',
    marginBottom: spacing.xs,
    letterSpacing: -0.3,
  },
  cardDescription: {
    fontSize: typography.base,
    color: 'white',
    opacity: 0.9,
    lineHeight: 22,
  },
  bottomTabContainer: {
    flexDirection: 'row',
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    ...shadows.floating,
  },
  bottomTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  bottomTabText: {
    fontSize: typography.xs,
    letterSpacing: 0.2,
  },
});