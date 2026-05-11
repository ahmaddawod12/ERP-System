// @ts-nocheck
import React from 'react';
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
    title: 'Worker Dashboard',
    subtitle: 'Field execution workspace',
    description: 'See assigned jobs and inventory in a simpler mobile layout designed for movement, speed, and clear next actions.',
    heroLabel: 'Worker access',
    open: 'Open workspace',
    emptyTitle: 'No modules available',
    emptySubtitle: 'This worker account does not have any active dashboard areas.',
    expiredTitle: 'Subscription Expired',
    expiredSubtitle: 'Renew the subscription on the website to restore worker access.',
    roleMetric: 'Role',
    roleValue: 'Worker',
    scopeMetric: 'Scope',
    scopeValue: 'Assigned',
    moduleMetric: 'Areas',
    myJobs: 'My Jobs',
    myJobsDesc: 'View your assigned jobs and move them forward from the field.',
    inventory: 'My Inventory',
    inventoryDesc: 'Check the parts you carry and open your inventory quickly.',
    workBadge: 'Field',
  },
  he: {
    title: 'לוח בקרה עובד',
    subtitle: 'סביבת ביצוע בשטח',
    description: 'צפייה במשימות שהוקצו ובמלאי מתוך פריסה פשוטה יותר שמותאמת לעבודה מהירה בשטח.',
    heroLabel: 'גישת עובד',
    open: 'פתח סביבת עבודה',
    emptyTitle: 'אין מודולים זמינים',
    emptySubtitle: 'לחשבון העובד הזה אין כרגע אזורי עבודה פעילים.',
    expiredTitle: 'המנוי פג תוקף',
    expiredSubtitle: 'חדש את המנוי דרך האתר כדי להחזיר את הגישה לעובד.',
    roleMetric: 'תפקיד',
    roleValue: 'עובד',
    scopeMetric: 'היקף',
    scopeValue: 'מוקצה',
    moduleMetric: 'אזורים',
    myJobs: 'המשימות שלי',
    myJobsDesc: 'צפייה במשימות שהוקצו והתקדמות מהירה מתוך השטח.',
    inventory: 'המלאי שלי',
    inventoryDesc: 'בדיקת החלקים שברשותך ופתיחה מהירה של המלאי.',
    workBadge: 'שטח',
  },
  ar: {
    title: 'لوحة تحكم العامل',
    subtitle: 'مساحة تنفيذ ميدانية',
    description: 'اعرض المهام المعيّنة والمخزون من تخطيط أبسط مصمم للحركة والسرعة ووضوح الخطوة التالية.',
    heroLabel: 'وصول العامل',
    open: 'افتح مساحة العمل',
    emptyTitle: 'لا توجد وحدات متاحة',
    emptySubtitle: 'هذا الحساب الخاص بالعامل لا يملك مناطق عمل فعالة حالياً.',
    expiredTitle: 'انتهى الاشتراك',
    expiredSubtitle: 'جدّد الاشتراك عبر الموقع لاستعادة وصول العامل.',
    roleMetric: 'الدور',
    roleValue: 'عامل',
    scopeMetric: 'النطاق',
    scopeValue: 'مكلّف',
    moduleMetric: 'المساحات',
    myJobs: 'مهامي',
    myJobsDesc: 'اعرض مهامك المعيّنة وادفعها للأمام من الميدان.',
    inventory: 'مخزوني',
    inventoryDesc: 'تحقق من القطع التي تحملها وافتح المخزون بسرعة.',
    workBadge: 'ميداني',
  },
};

export default function WorkerHomepage() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const { subscription } = useCache();
  const colors = getColors(isDarkMode);
  const t = translations[language] || translations.en;

  const hasTeam = isModuleEnabled(subscription, 'team');
  const hasInventory = isModuleEnabled(subscription, 'teaminventory');
  const subActive = isSubscriptionActive(subscription);

  const cards = [
    ...(hasTeam
      ? [{
          key: 'my-jobs',
          title: t.myJobs,
          description: t.myJobsDesc,
          icon: 'clipboard-text-multiple',
          iconLibrary: 'material',
          accentColor: colors.boxBlue,
          badge: t.workBadge,
          onPress: () => router.push('/Workerjob'),
        }]
      : []),
    ...(hasInventory
      ? [{
          key: 'inventory',
          title: t.inventory,
          description: t.inventoryDesc,
          icon: 'package-variant',
          iconLibrary: 'material',
          accentColor: colors.boxOrange,
          badge: t.workBadge,
          onPress: () => router.push('/inventory'),
        }]
      : []),
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
        heroIcon="hammer-wrench"
        heroIconLibrary="material"
        metrics={[
          { label: t.roleMetric, value: t.roleValue },
          { label: t.scopeMetric, value: t.scopeValue },
          { label: t.moduleMetric, value: String(cards.length) },
        ]}
      >
        {cards.length > 0 ? (
          cards.map((card) => (
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