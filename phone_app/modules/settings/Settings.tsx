// @ts-nocheck
import React, { useState, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { getColors, shadows, spacing, borderRadius, typography, gradients } from '../../theme';
import { auth, signOut, functions, httpsCallable } from '../../firebase';
import { useAlert } from '../../contexts/AlertContext';
import { useCache } from '../../contexts/CacheContext';
import { AppButton, AppText, GlobalHeader, ScrollableContainer } from '../../components';


export default function Settings() {
  const router = useRouter();
  const { language, setLanguage } = useLanguageContext();
  const { isDarkMode, toggleTheme } = useThemeContext();
  const { clearCache, profile, getUserRole } = useCache();
  const colors = getColors(isDarkMode);
  const alert = useAlert();
  const [userRole, setUserRole] = useState(null);

  // Get user role from cache instead of Firebase
  useEffect(() => {
    const role = getUserRole() || String(profile?.role || '').toLowerCase();
    if (role) {
      setUserRole(role);
    }
  }, [profile, getUserRole]);

  const t = language === 'en' ? {
    title: 'Settings',
    theme: 'Theme',
    lightMode: 'Light Mode',
    darkMode: 'Dark Mode',
    language: 'Language',
    logout: 'Logout',
    logoutConfirm: 'Are you sure you want to logout?',
    cancel: 'Cancel',
    yes: 'Yes',
    supportFeedback: 'Support & Feedback',
    devInbox: 'Dev Inbox',
  } : language === 'he' ? {
    title: 'הגדרות',
    theme: 'ערכת נושא',
    lightMode: 'מצב בהיר',
    darkMode: 'מצב כהה',
    language: 'שפה',
    logout: 'התנתקות',
    logoutConfirm: 'האם אתה בטוח שברצונך להתנתק?',
    cancel: 'ביטול',
    yes: 'כן',
    supportFeedback: 'תמיכה ומשוב',
    devInbox: 'תיבת דואר מפתח',
  } : {
    title: 'الإعدادات',
    theme: 'السمة',
    lightMode: 'الوضع الفاتح',
    darkMode: 'الوضع الداكن',
    language: 'اللغة',
    logout: 'تسجيل الخروج',
    logoutConfirm: 'هل أنت متأكد من تسجيل الخروج؟',
    cancel: 'إلغاء',
    yes: 'نعم',
    supportFeedback: 'الدعم والملاحظات',
    devInbox: 'صندوق بريد المطور',
  };

  const handleLogout = async () => {
    alert.confirm(
      t.logout,
      t.logoutConfirm,
      [
        { text: t.cancel, style: 'cancel', onPress: () => {} },
        {
          text: t.yes,
          style: 'destructive',
          onPress: async () => {
            try {
              // P1-8: Clear push token on server before sign-out
              try {
                const clearPushTokenFn = httpsCallable(functions, 'clearPushTokenV1');
                await clearPushTokenFn({});
              } catch (tokenErr) {
                console.warn('Failed to clear push token on logout:', tokenErr);
              }
              // Clear cache on logout
              clearCache();
              // Firebase Web SDK modular auth signOut
              await signOut(auth);
              
              // Navigate to login
              router.replace('/');
            } catch (error) {
              console.error('Logout error:', error);
              alert.error('Error', 'Failed to logout. Please try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      
      <ScrollableContainer 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <AppText style={styles.headerTitle}>{t.title}</AppText>
        </LinearGradient>

        {/* Theme Section */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="color-palette-outline" size={24} color={colors.primary} />
            <AppText style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              {t.theme}
            </AppText>
          </View>
          <View style={styles.optionsContainer}>
            <TouchableOpacity
              style={[
                styles.optionButton,
                { 
                  backgroundColor: !isDarkMode ? colors.primary : colors.backgroundLight,
                  borderColor: colors.border,
                }
              ]}
              onPress={() => !isDarkMode ? null : toggleTheme()}
            >
              <Ionicons 
                name="sunny" 
                size={24} 
                color={!isDarkMode ? 'white' : colors.textSecondary} 
              />
              <AppText style={[
                styles.optionText,
                { color: !isDarkMode ? 'white' : colors.textSecondary }
              ]}>
                {t.lightMode}
              </AppText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.optionButton,
                { 
                  backgroundColor: isDarkMode ? colors.primary : colors.backgroundLight,
                  borderColor: colors.border,
                }
              ]}
              onPress={() => isDarkMode ? null : toggleTheme()}
            >
              <Ionicons 
                name="moon" 
                size={24} 
                color={isDarkMode ? 'white' : colors.textSecondary} 
              />
              <AppText style={[
                styles.optionText,
                { color: isDarkMode ? 'white' : colors.textSecondary }
              ]}>
                {t.darkMode}
              </AppText>
            </TouchableOpacity>
          </View>
        </View>

        {/* Language Section */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons name="translate" size={24} color={colors.primary} />
            <AppText style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              {t.language}
            </AppText>
          </View>
          <View style={styles.optionsContainer}>
            <TouchableOpacity
              style={[
                styles.optionButton,
                { 
                  backgroundColor: language === 'en' ? colors.primary : colors.backgroundLight,
                  borderColor: colors.border,
                }
              ]}
              onPress={() => setLanguage('en')}
            >
              <MaterialCommunityIcons 
                name="web" 
                size={24} 
                color={language === 'en' ? 'white' : colors.textSecondary} 
              />
              <AppText style={[
                styles.optionText,
                { color: language === 'en' ? 'white' : colors.textSecondary }
              ]}>
                English
              </AppText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.optionButton,
                { 
                  backgroundColor: language === 'he' ? colors.primary : colors.backgroundLight,
                  borderColor: colors.border,
                }
              ]}
              onPress={() => setLanguage('he')}
            >
              <MaterialCommunityIcons 
                name="web" 
                size={24} 
                color={language === 'he' ? 'white' : colors.textSecondary} 
              />
              <AppText style={[
                styles.optionText,
                { color: language === 'he' ? 'white' : colors.textSecondary }
              ]}>
                עברית
              </AppText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.optionButton,
                { 
                  backgroundColor: language === 'ar' ? colors.primary : colors.backgroundLight,
                  borderColor: colors.border,
                }
              ]}
              onPress={() => setLanguage('ar')}
            >
              <MaterialCommunityIcons 
                name="web" 
                size={24} 
                color={language === 'ar' ? 'white' : colors.textSecondary} 
              />
              <AppText style={[
                styles.optionText,
                { color: language === 'ar' ? 'white' : colors.textSecondary }
              ]}>
                العربية
              </AppText>
            </TouchableOpacity>
          </View>
        </View>

        {/* Dev Inbox Section (only for dev role) */}
        {userRole === 'dev' && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.menuItem, { borderColor: colors.border }]}
              onPress={() => router.push('/DevInbox')}
            >
              <View style={styles.menuItemLeft}>
                <MaterialCommunityIcons name="inbox" size={24} color={colors.secondary} />
                <AppText style={[styles.menuItemText, { color: colors.textPrimary }]}>
                  {t.devInbox}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}

        {/* Logout Button */}
        <AppButton
          title={t.logout}
          variant="destructive"
          iconLeft={{ name: 'log-out-outline' }}
          size="lg"
          onPress={handleLogout}
          style={styles.logoutButton}
        />
      </ScrollableContainer>

      <GlobalHeader />
    </SafeAreaView>
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
  header: {
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.md,
    borderRadius: borderRadius.xl,
    marginBottom: spacing.lg,
    ...shadows.floating,
  },
  headerTitle: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    color: 'white',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  section: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    ...shadows.card,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.lg,
    fontWeight: typography.semibold,
    marginLeft: spacing.sm,
  },
  optionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    minHeight: 50,
    ...shadows.xs,
  },
  optionText: {
    fontSize: 16,
    fontWeight: typography.medium,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  menuItemText: {
    fontSize: typography.base,
    fontWeight: typography.medium,
  },
  logoutButton: {
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
});

