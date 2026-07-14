import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { auth, signInWithEmailAndPassword } from '../../../firebase';
import { borderRadius, getColors, gradients, shadows, spacing, typography } from '../../../theme';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import {
  AppButton,
  AppCard,
  AppChip,
  AppInput,
  AppText,
  GlobalHeader,
  ScrollableContainer,
} from '../../../components';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const colors = getColors(isDarkMode);

  const t =
    language === 'en'
      ? {
          title: 'Smart-Job ERP',
          subtitle: 'Business Operations Platform',
          login: 'Sign In',
          email: 'Email',
          password: 'Password',
          loading: 'Signing In...',
          noAccount: "Don't have an account? Contact the administrator.",
          hero: 'Welcome Back',
          jobs: 'Jobs',
          inventory: 'Inventory',
          docs: 'Documents',
        }
      : language === 'he'
      ? {
          title: 'Smart-Job ERP',
          subtitle: 'פלטפורמת ניהול עסק',
          login: 'התחברות',
          email: 'אימייל',
          password: 'סיסמה',
          loading: 'מתחבר...',
          noAccount: 'אין לך חשבון? צור קשר עם המנהל.',
          hero: 'ברוך שובך',
          jobs: 'משימות',
          inventory: 'מלאי',
          docs: 'מסמכים',
        }
      : {
          title: 'Smart-Job ERP',
          subtitle: 'منصة إدارة الأعمال',
          login: 'تسجيل الدخول',
          email: 'البريد الإلكتروني',
          password: 'كلمة المرور',
          loading: 'جاري تسجيل الدخول...',
          noAccount: 'ليس لديك حساب؟ اتصل بالمسؤول.',
          hero: 'مرحبًا بعودتك',
          jobs: 'مهام',
          inventory: 'مخزون',
          docs: 'مستندات',
        };

  const handleEmailLogin = async () => {
    if (!email || !password) {
      alert.error('Error', 'Please fill all fields');
      return;
    }

    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error: unknown) {
      let errorMessage = 'Please check your credentials';
      const authError = error as { code?: unknown; message?: unknown };
      const errorCode = typeof authError.code === 'string' ? authError.code : '';
      const rawMessage = typeof authError.message === 'string' ? authError.message : '';

      if (errorCode === 'auth/invalid-credential') {
        errorMessage = 'Invalid email or password. Please check your credentials.';
      } else if (errorCode === 'auth/user-not-found') {
        errorMessage = 'No account found with this email.';
      } else if (errorCode === 'auth/wrong-password') {
        errorMessage = 'Incorrect password.';
      } else if (errorCode === 'auth/invalid-email') {
        errorMessage = 'Invalid email address format.';
      } else if (errorCode === 'auth/user-disabled') {
        errorMessage = 'This account has been disabled.';
      } else if (errorCode === 'auth/too-many-requests') {
        errorMessage = 'Too many failed attempts. Please try again later.';
      } else if (rawMessage) {
        errorMessage = rawMessage;
      }

      alert.error('Login Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />

      <View style={[styles.backdropOrb, styles.backdropOrbPrimary, { backgroundColor: `${colors.secondary}16` }]} />
      <View style={[styles.backdropOrb, styles.backdropOrbAccent, { backgroundColor: `${colors.accent}14` }]} />

      <LinearGradient
        colors={isDarkMode ? gradients.headerDark : gradients.headerLight}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroSection}
      >
        <View style={[styles.heroBadge, { borderColor: 'rgba(255,255,255,0.28)' }]}>
          <MaterialCommunityIcons name="briefcase-check-outline" size={24} color="#FFFFFF" />
        </View>
        <AppText variant="title" color="#FFFFFF" align="center">
          {t.title}
        </AppText>
        <AppText variant="caption" color="rgba(255,255,255,0.9)" align="center" style={styles.subtitle}>
          {t.subtitle}
        </AppText>

        <View style={styles.heroChips}>
          <AppChip label={t.jobs} color="#FFFFFF" textColor="#FFFFFF" />
          <AppChip label={t.inventory} color="#FFFFFF" textColor="#FFFFFF" />
          <AppChip label={t.docs} color="#FFFFFF" textColor="#FFFFFF" />
        </View>
      </LinearGradient>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollableContainer contentContainerStyle={styles.scrollContent}>
          <AppCard style={[styles.loginCard, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
            <AppText variant="heading" align="center" style={styles.welcomeText}>
              {t.hero}
            </AppText>

            <AppInput
              value={email}
              onChangeText={setEmail}
              label={t.email}
              placeholder="user@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              leftIcon={<Ionicons name="mail-outline" size={20} color={colors.textLight} />}
              colors={colors}
              containerStyle={styles.inputSpacing}
            />

            <AppInput
              value={password}
              onChangeText={setPassword}
              label={t.password}
              placeholder="********"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              leftIcon={<Ionicons name="lock-closed-outline" size={20} color={colors.textLight} />}
              rightIcon={
                <TouchableOpacity onPress={() => setShowPassword((current) => !current)} accessibilityRole="button">
                  <Ionicons
                    name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                    size={20}
                    color={colors.textLight}
                  />
                </TouchableOpacity>
              }
              colors={colors}
              containerStyle={styles.inputSpacing}
            />

            <AppButton
              title={loading ? t.loading : t.login}
              iconLeft={!loading ? { library: 'material', name: 'login' } : undefined}
              onPress={handleEmailLogin}
              disabled={loading}
              loading={loading}
              style={styles.cta}
              size="lg"
            />

            <View style={[styles.footerNote, { backgroundColor: colors.surfaceAlt, borderColor: colors.borderLight }]}>
              <AppText variant="caption" align="center" color={colors.textSecondary} style={styles.footerText}>
                {t.noAccount}
              </AppText>
            </View>
          </AppCard>
        </ScrollableContainer>
      </KeyboardAvoidingView>

      {loading ? (
        <View style={[styles.loadingOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.loadingCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <ActivityIndicator size="large" color={colors.secondary} />
            <AppText variant="bodyStrong" color={colors.textPrimary} align="center" style={styles.loadingText}>
              {t.loading}
            </AppText>
          </View>
        </View>
      ) : null}

      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backdropOrb: {
    position: 'absolute',
    borderRadius: borderRadius.full,
  },
  backdropOrbPrimary: {
    width: 220,
    height: 220,
    top: -72,
    right: -68,
  },
  backdropOrbAccent: {
    width: 180,
    height: 180,
    top: 210,
    left: -92,
  },
  flex: {
    flex: 1,
  },
  heroSection: {
    paddingTop: Platform.OS === 'ios' ? 84 : 66,
    paddingBottom: spacing.xl + 4,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomLeftRadius: borderRadius.xxl,
    borderBottomRightRadius: borderRadius.xxl,
    ...shadows.large,
  },
  heroBadge: {
    width: 54,
    height: 54,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom: spacing.md,
  },
  subtitle: {
    marginTop: spacing.xs,
    letterSpacing: 0.35,
  },
  heroChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    flexGrow: 1,
    justifyContent: 'center',
  },
  loginCard: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    ...shadows.floating,
  },
  welcomeText: {
    marginBottom: spacing.md,
  },
  inputSpacing: {
    marginBottom: spacing.sm,
  },
  cta: {
    marginTop: spacing.sm,
  },
  footerText: {
    lineHeight: 20,
  },
  footerNote: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10000,
  },
  loadingCard: {
    minWidth: 180,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    ...shadows.floating,
  },
  loadingText: {
    marginTop: spacing.sm,
    fontSize: typography.base,
  },
});

