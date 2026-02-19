import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { db, auth, doc, getDoc, setDoc, signInWithEmailAndPassword } from '../firebase';
import { getColors, gradients, shadows } from '../theme';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { useAlert } from '../contexts/AlertContext';
import { Input, GlobalHeader, LoadingSpinner, ScrollableContainer } from '../components';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [dot1Anim] = useState(new Animated.Value(0.4));
  const [dot2Anim] = useState(new Animated.Value(0.7));
  const [dot3Anim] = useState(new Animated.Value(1));
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const colors = getColors(isDarkMode);

  // Animate loading dots
  useEffect(() => {
    let loadingAnimation;
    if (loading) {
      loadingAnimation = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(dot1Anim, { toValue: 1, duration: 400, useNativeDriver: true }),
            Animated.timing(dot2Anim, { toValue: 0.4, duration: 400, useNativeDriver: true }),
            Animated.timing(dot3Anim, { toValue: 0.7, duration: 400, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(dot1Anim, { toValue: 0.7, duration: 400, useNativeDriver: true }),
            Animated.timing(dot2Anim, { toValue: 1, duration: 400, useNativeDriver: true }),
            Animated.timing(dot3Anim, { toValue: 0.4, duration: 400, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(dot1Anim, { toValue: 0.4, duration: 400, useNativeDriver: true }),
            Animated.timing(dot2Anim, { toValue: 0.7, duration: 400, useNativeDriver: true }),
            Animated.timing(dot3Anim, { toValue: 1, duration: 400, useNativeDriver: true }),
          ]),
        ])
      );
      loadingAnimation.start();
    }
    return () => loadingAnimation?.stop();
  }, [loading, dot1Anim, dot2Anim, dot3Anim]);

  const t = language === 'en' ? {
    title: 'JobMate',
    subtitle: 'Inventory Manager',
    login: 'Login',
    email: 'Email',
    password: 'Password',
    loading: 'Signing In...',
    success: 'Login Successful!',
    welcome: 'Welcome Back',
    noAccount: "Don't have an account? Contact the administrator.",
  } : language === 'he' ? {
    title: 'JobMate',
    subtitle: 'מנהל מלאי',
    login: 'התחברות',
    email: 'אימייל',
    password: 'סיסמה',
    loading: 'מתחבר...',
    success: 'התחברות מוצלחת!',
    welcome: 'ברוך שובך',
    noAccount: 'אין לך חשבון? צור קשר עם המנהל.',
  } : {
    title: 'JobMate',
    subtitle: 'مدير المخزون',
    login: 'تسجيل الدخول',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    loading: 'جاري تسجيل الدخول...',
    success: 'تم تسجيل الدخول بنجاح!',
    welcome: 'مرحبا بعودتك',
    noAccount: 'ليس لديك حساب؟ اتصل بالمسؤول.',
  };

  const handleEmailLogin = async () => {
    if (!email || !password) {
      alert.error('Error', 'Please fill all fields');
      return;
    }

    setLoading(true);
    try {
      // Firebase Web SDK modular auth
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      const uid = user.uid;
      
      // Use Firebase UID for Firestore document path
      const userDocRef = doc(db, 'users', uid, 'data', 'profile');
      const userDoc = await getDoc(userDocRef);
      
      let userData;
      let role;
      
      if (userDoc.exists()) {
        userData = userDoc.data();
        role = userData.role || 'user';
      } else {
        // Create default profile for users without one
        userData = {
          role: 'user',
          email: user.email,
          uid: uid,
          createdAt: new Date().toISOString(),
        };
        await setDoc(doc(db, 'users', uid, 'data', 'profile'), userData);
        role = 'user';
      }
      
      // index.js will handle business registration check, animation, and routing
      // Just keep loading state active until navigation happens
      // This prevents white screen flash during transition
      
    } catch (error) {
      // Silently handle error - don't log to console to avoid showing Firebase errors to user
      let errorMessage = 'Please check your credentials';
      
      // Provide more specific error messages
      if (error.code === 'auth/invalid-credential') {
        errorMessage = 'Invalid email or password. Please check your credentials.';
      } else if (error.code === 'auth/user-not-found') {
        errorMessage = 'No account found with this email.';
      } else if (error.code === 'auth/wrong-password') {
        errorMessage = 'Incorrect password.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address format.';
      } else if (error.code === 'auth/user-disabled') {
        errorMessage = 'This account has been disabled.';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many failed attempts. Please try again later.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      alert.error('Login Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />
      
      {/* Header */}
      <View style={[styles.header, { 
        backgroundColor: colors.background,
        borderBottomColor: colors.border,
      }]}>
        <View style={styles.headerContent}>
          {/* Luxurious App Title with Gradient */}
          <LinearGradient
            colors={['#0F2A4D', '#00ACC1']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.titleGradientContainer}
          >
            <Text style={styles.appTitle}>JobMate</Text>
          </LinearGradient>
          <Text style={[styles.appSubtitle, { color: colors.textSecondary }]}>
            Smart Job Management
          </Text>
          
          {/* Professional Document Icon with Check Badge */}
          <View style={styles.documentIconContainer}>
            <LinearGradient
              colors={['#0F2A4D', '#00ACC1']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.documentCircle}
            >
              <MaterialCommunityIcons name="clipboard-check-multiple" size={64} color="white" />
            </LinearGradient>
            <View style={styles.sparkles}>
              <Ionicons name="sparkles" size={20} color="#00ACC1" style={styles.sparkle1} />
              <Ionicons name="sparkles" size={16} color="#00ACC1" style={styles.sparkle2} />
            </View>
          </View>
        </View>
      </View>

      {/* White Background Content */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollableContainer 
          contentContainerStyle={[styles.scrollView]}
        >
          
          {/* Email Input */}
          <View style={[styles.inputContainer, {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          }]}>
            <View style={[styles.inputIconContainer, { backgroundColor: colors.secondary + '15' }]}>
              <Ionicons name="mail-outline" size={22} color={colors.secondary} />
            </View>
            <View style={styles.inputWrapper}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>{t.email}</Text>
              <Input
                value={email}
                onChangeText={setEmail}
                placeholder="user@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                colors={colors}
              />
            </View>
          </View>

          {/* Password Input */}
          <View style={[styles.inputContainer, {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          }]}>
            <View style={[styles.inputIconContainer, { backgroundColor: colors.secondary + '15' }]}>
              <Ionicons name="lock-closed-outline" size={22} color={colors.secondary} />
            </View>
            <View style={styles.inputWrapper}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>{t.password}</Text>
              <View style={styles.passwordInputContainer}>
                <Input
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  secureTextEntry={!showPassword}
                  style={styles.passwordInput}
                  colors={colors}
                />
                <TouchableOpacity 
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeIcon}
                >
                  <Ionicons 
                    name={showPassword ? "eye-outline" : "eye-off-outline"} 
                    size={22} 
                    color={colors.textSecondary}
                    left={10}
                    bottom={5}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Login Button */}
          <TouchableOpacity
            onPress={handleEmailLogin}
            disabled={loading}
            style={styles.loginButtonWrapper}
          >
            <LinearGradient 
              colors={loading ? ['#9CA3AF', '#9CA3AF'] : [colors.secondary, colors.secondaryDark]}
              style={styles.loginButton}
            >
              <MaterialCommunityIcons name="login" size={24} color="white" />
              <Text style={styles.loginButtonText}>
                {loading ? t.loading : t.login}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          <Text style={[styles.footerText, { color: colors.textSecondary }]}>{t.noAccount}</Text>
        </ScrollableContainer>
      </KeyboardAvoidingView>
      
      {/* Custom Loading Overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <LinearGradient
            colors={['#0F2A4D', '#1e3a8a', '#00ACC1']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.loadingGradient}
          >
            <View style={styles.loadingContent}>
              {/* Animated outer ring */}
              <View style={styles.outerRing}>
                <View style={styles.innerRing}>
                  <View style={styles.logoCircle}>
                    <MaterialCommunityIcons name="clipboard-check-multiple" size={56} color="white" />
                  </View>
                </View>
              </View>
              
              <Text style={styles.appName}>JobMate</Text>
              <Text style={styles.appTagline}>Smart Job Management</Text>
              
              <View style={styles.loadingDotsContainer}>
                <View style={styles.dotRow}>
                  <Animated.View style={[styles.dot, { opacity: dot1Anim }]} />
                  <Animated.View style={[styles.dot, { opacity: dot2Anim }]} />
                  <Animated.View style={[styles.dot, { opacity: dot3Anim }]} />
                </View>
              </View>
              
              <Text style={styles.loadingText}>{t.loading}</Text>
            </View>
          </LinearGradient>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 70 : 50,
    paddingBottom: 40,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  headerContent: {
    alignItems: 'center',
  },
  titleGradientContainer: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 16,
    marginBottom: 8,
    ...shadows.primary,
  },
  appTitle: {
    fontSize: 38,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 3,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  appSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 24,
    opacity: 0.7,
  },
  documentIconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
    borderWidth: 3,
    borderColor: 'rgba(15, 42, 77, 0.1)',
  },
  sparkles: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  sparkle1: {
    position: 'absolute',
    top: 10,
    right: 15,
  },
  sparkle2: {
    position: 'absolute',
    bottom: 15,
    left: 10,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  inputContainer: {
    flexDirection: 'row',
    borderRadius: 20,
    marginBottom: 20,
    padding: 18,
    borderWidth: 1.5,
    ...shadows.card,
  },
  inputIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  inputWrapper: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  passwordInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  passwordInput: {
    flex: 1,
    paddingRight: 44,
  },
  eyeIcon: {
    position: 'absolute',
    right: 8,
    padding: 10,
  },
  loginButtonWrapper: {
    marginTop: 16,
  },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 20,
    borderRadius: 20,
    ...shadows.primary,
  },
  loginButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  footerText: {
    textAlign: 'center',
    fontSize: 13,
    marginTop: 20,
    letterSpacing: 0.2,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10000,
  },
  loadingGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContent: {
    alignItems: 'center',
  },
  outerRing: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 36,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  innerRing: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  logoCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(0, 172, 193, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  appName: {
    fontSize: 48,
    fontWeight: '900',
    color: 'white',
    marginBottom: 8,
    letterSpacing: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 6,
  },
  appTagline: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '600',
    letterSpacing: 1.2,
    marginBottom: 40,
    textTransform: 'uppercase',
  },
  loadingDotsContainer: {
    marginVertical: 24,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'white',
  },
  loadingText: {
    fontSize: 17,
    color: 'rgba(255, 255, 255, 0.95)',
    fontWeight: '700',
    letterSpacing: 1,
  },
});
