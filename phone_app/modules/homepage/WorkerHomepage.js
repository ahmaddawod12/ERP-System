import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { getColors, spacing, borderRadius, typography, shadows } from '../../theme';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useCache } from '../../contexts/CacheContext';
import { isSubscriptionActive, isModuleEnabled } from '../shared';
import { AppText, GlobalHeader, ScrollableContainer } from '../../components';

export default function WorkerHomepage() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const { subscription } = useCache();
  const colors = getColors(isDarkMode);

  // Module checks
  const hasTeam = isModuleEnabled(subscription, 'team');
  const hasInventory = isModuleEnabled(subscription, 'teaminventory');
  const subActive = isSubscriptionActive(subscription);

  const t = language === 'en' ? {
    title: 'Worker Dashboard',
    subtitle: 'Welcome back',
    myJobs: 'My Jobs',
    myJobsDesc: 'View and complete assigned jobs',
    inventory: 'My Inventory',
    inventoryDesc: 'Manage your parts',
  } : language === 'he' ? {
    title: 'לוח בקרה עובד',
    subtitle: 'ברוך הבא',
    myJobs: 'המשימות שלי',
    myJobsDesc: 'צפייה והשלמת משימות שהוקצו',
    inventory: 'המלאי שלי',
    inventoryDesc: 'ניהול חלקים',
  } : {
    title: 'لوحة تحكم العامل',
    subtitle: 'مرحبا بعودتك',
    myJobs: 'مهامي',
    myJobsDesc: 'عرض وإكمال المهام المعينة',
    inventory: 'مخزوني',
    inventoryDesc: 'إدارة القطع',
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
      
      {/* White Background Content */}
      <ScrollableContainer 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.cardsContainer}>
          {/* My Jobs Card */}
          {hasTeam && (
          <TouchableOpacity onPress={() => router.push('/Workerjob')}>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <View style={[styles.cardIconCircle, { backgroundColor: colors.secondary + '15' }]}>
                  <MaterialCommunityIcons name="clipboard-text-multiple" size={32} color={colors.secondary} />
                </View>
                <Feather name="chevron-right" size={24} color={colors.secondary} style={styles.cardChevron} />
              </View>
              <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.myJobs}</AppText>
              <AppText style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.myJobsDesc}</AppText>
            </View>
          </TouchableOpacity>
          )}

          {/* Inventory Card */}
          {hasInventory && (
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
          )}
        </View>
      </ScrollableContainer>

      {/* Fixed GlobalHeader */}
      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
