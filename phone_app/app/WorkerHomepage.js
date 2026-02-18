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
import { useCache } from '../contexts/CacheContext';
import { isSubscriptionActive, isModuleEnabled } from '../modules/shared';
import { useAuth } from '../hooks';
import { GlobalHeader, ScrollableContainer } from '../components';

export default function WorkerHomepage() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { uid } = useAuth();
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
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, marginTop: spacing.lg, textAlign: 'center' }}>
            {language === 'he' ? 'המנוי פג תוקף' : language === 'ar' ? 'انتهى الاشتراك' : 'Subscription Expired'}
          </Text>
          <Text style={{ fontSize: 15, color: colors.textSecondary, marginTop: spacing.md, textAlign: 'center', lineHeight: 22 }}>
            {language === 'he' ? 'אנא חדש את המנוי דרך האתר כדי להמשיך להשתמש באפליקציה.' : language === 'ar' ? 'يرجى تجديد اشتراكك عبر الموقع الإلكتروني لمواصلة استخدام التطبيق.' : 'Please renew your subscription on the website to continue using the app.'}
          </Text>
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
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.myJobs}</Text>
              <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.myJobsDesc}</Text>
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
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.inventory}</Text>
              <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t.inventoryDesc}</Text>
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
    paddingTop: 100,
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