// @ts-nocheck
/**
 * NotAvailableScreen - Shown when a user tries to access a gated feature
 * they don't have permission for (wrong role, expired subscription, or disabled module).
 * 
 * Always includes <GlobalHeader /> per project rules.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getColors, spacing, borderRadius, typography } from '../../theme';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { AppButton, AppText, GlobalHeader } from '../../components';

const translations = {
  en: {
    role: { title: 'Access Restricted', message: 'Your account role does not have access to this feature.' },
    subscription: { title: 'Subscription Expired', message: 'Your subscription has expired. Please renew to continue using this feature.' },
    module: { title: 'Not Available on Your Plan', message: 'This feature is not included in your current plan. Upgrade to unlock it.' },
    default: { title: 'Not Available', message: 'This feature is not available.' },
    goBack: 'Go Back',
  },
  he: {
    role: { title: 'גישה מוגבלת', message: 'תפקיד החשבון שלך אינו מאפשר גישה לתכונה זו.' },
    subscription: { title: 'מנוי פג תוקף', message: 'המנוי שלך פג תוקף. אנא חדש כדי להמשיך להשתמש בתכונה זו.' },
    module: { title: 'לא זמין בתוכנית שלך', message: 'תכונה זו אינה כלולה בתוכנית הנוכחית שלך. שדרג כדי לפתוח אותה.' },
    default: { title: 'לא זמין', message: 'תכונה זו אינה זמינה.' },
    goBack: 'חזרה',
  },
  ar: {
    role: { title: 'الوصول محدود', message: 'دور حسابك لا يسمح بالوصول إلى هذه الميزة.' },
    subscription: { title: 'انتهى الاشتراك', message: 'انتهى اشتراكك. يرجى التجديد لمواصلة استخدام هذه الميزة.' },
    module: { title: 'غير متوفر في خطتك', message: 'هذه الميزة غير مضمنة في خطتك الحالية. قم بالترقية لفتحها.' },
    default: { title: 'غير متوفر', message: 'هذه الميزة غير متوفرة.' },
    goBack: 'رجوع',
  },
};

type GateReason = 'role' | 'subscription' | 'module' | 'default';

export interface NotAvailableScreenProps {
  reason?: GateReason;
}

export default function NotAvailableScreen({ reason = 'default' }: NotAvailableScreenProps) {
  const router = useRouter();
  const { isDarkMode } = useThemeContext();
  const { language } = useLanguageContext();
  const colors = getColors(isDarkMode);
  const t = translations[language] || translations.en;
  const content = t[reason] || t.default;

  const iconMap = {
    role: 'lock-closed',
    subscription: 'time-outline',
    module: 'diamond-outline',
    default: 'alert-circle-outline',
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={[styles.iconContainer, { backgroundColor: colors.surface }]}>
          <Ionicons name={iconMap[reason] || iconMap.default} size={64} color={colors.textSecondary} />
        </View>
        <AppText variant="title" style={[styles.title, { color: colors.text }]}>
          {content.title}
        </AppText>
        <AppText variant="body" style={[styles.message, { color: colors.textSecondary }]}>
          {content.message}
        </AppText>
        <AppButton
          title={t.goBack}
          iconLeft={{ name: 'arrow-back' }}
          onPress={() => router.back()}
          style={styles.backButton}
        />
      </View>
      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  message: {
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  backButton: {
    minWidth: 150,
  },
});

