import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { auth, onAuthStateChanged } from '../../lib/auth/transport';
import type { SupabaseAuthUser } from '../../lib/auth/transport';
import Login from '../auth/screens/Login';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useCache } from '../../contexts/CacheContext';
import { useAlert } from '../../contexts/AlertContext';
import { useTenant } from '../../contexts/TenantContext';
import { AppText } from '../../components';
import { ROUTES } from '../../navigation/routes';
import {
  initializeCrashlytics,
  recordCrashlyticsError,
  setCrashlyticsUser,
} from '../../lib/firebase-crashlytics';

export default function App() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<SupabaseAuthUser | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const { language } = useLanguageContext();
  const { initializeCache } = useCache();
  const { workspace } = useTenant();
  const workspaceCompanyId = workspace?.companyId ?? null;
  const workspaceRole = workspace?.role ?? null;
  const alert = useAlert();
  const initializedScopeRef = useRef<string | null>(null);
  const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Animation states for loading dots
  const [dot1Anim] = useState(new Animated.Value(0.4));
  const [dot2Anim] = useState(new Animated.Value(0.7));
  const [dot3Anim] = useState(new Animated.Value(1));
  
  // Animation states for success overlay
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.8));

  // Animate loading dots
  useEffect(() => {
    let loadingAnimation: ReturnType<typeof Animated.loop> | null = null;
    if (isLoading) {
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
  }, [isLoading, dot1Anim, dot2Anim, dot3Anim]);

  const t = language === 'en' ? {
    title: 'Smart-Job ERP',
    subtitle: 'Business Operations Platform',
    loading: 'Loading...',
    success: 'Login Successful!',
    welcome: 'Welcome Back',
  } : language === 'he' ? {
    title: 'Smart-Job ERP',
    subtitle: 'מנהל מלאי',
    loading: 'טוען...',
    success: 'התחברות מוצלחת!',
    welcome: 'ברוך שובך',
  } : {
    title: 'Smart-Job ERP',
    subtitle: 'مدير المخزون',
    loading: 'جاري التحميل...',
    success: 'تم تسجيل الدخول بنجاح!',
    welcome: 'مرحبا بعودتك',
  };

  useEffect(() => {
    return () => {
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
        navigationTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let isActive = true;
    
    /**
     * Show success animation and navigate to homepage
     */
    const showSuccessAndNavigate = (role: string) => {
      if (!isActive) {
        return;
      }

      setIsLoading(false);
      setShowSuccess(true);
      
      // Animate success message
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
      ]).start();
      
      // Navigate after animation
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
      }

      navigationTimeoutRef.current = setTimeout(() => {
        if (!isActive) {
          return;
        }

        if (role === 'manager') {
          router.replace(ROUTES.managerHome);
        } else if (role === 'worker') {
          router.replace(ROUTES.workerHome);
        } else if (role === 'basic') {
          router.replace(ROUTES.basicHome);
        } else if (role === 'dev') {
          router.replace(ROUTES.devInbox);
        } else {
          router.replace(ROUTES.userHome);
        }
        navigationTimeoutRef.current = null;
      }, 1500);
    };

    // Initialize native services and auth listener.
    const initializeAuth = async () => {
      console.log('🔐 Initializing auth and notifications...');
      
      try {
        try {
          await initializeCrashlytics();
        } catch (crashlyticsError) {
          console.warn('Crash reporting is unavailable:', crashlyticsError);
        }
        // Set up the Supabase-backed auth listener independently of Firebase native services.
        unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
          if (!isActive) {
            return;
          }

          setUser(nextUser);
          setAuthInitialized(true);
          void setCrashlyticsUser(nextUser?.uid ?? null).catch(() => undefined);
          
          if (nextUser) {
            if (!workspaceCompanyId || !workspaceRole) {
              return;
            }
            const selectedCompanyId = String(workspaceCompanyId);
            const selectedRole = workspaceRole;
            const selectedScope = `${nextUser.uid}:${selectedCompanyId}`;
            if (initializedScopeRef.current === selectedScope) {
              return;
            }

            initializedScopeRef.current = selectedScope;
            setShowSuccess(false);
            setIsLoading(true);

            try {
              // Initialize cache - it handles profile loading from cache first, then backend if needed
              // Returns { uid, role, companyId } or null on failure
              const cacheResult = await initializeCache(
                nextUser.uid,
                selectedCompanyId,
                selectedRole,
              );

              if (!isActive) {
                return;
              }
              
              if (cacheResult) {
                const { uid, role } = cacheResult;
                console.log(`🔐 User authenticated: ${uid} (${role})`);

                // All checks passed - show success animation then navigate
                showSuccessAndNavigate(role);
              } else {
                initializedScopeRef.current = null;
                // No profile found - show error and return to login
                console.log('❌ Could not initialize cache/profile');
                alert.error(
                  language === 'he' ? 'הגדרה לא הושלמה' : language === 'ar' ? 'الإعداد غير مكتمل' : 'Setup Incomplete',
                  language === 'he'
                    ? 'הפרופיל שלך לא נמצא. אנא השלם את ההרשמה דרך האתר.'
                    : language === 'ar'
                    ? 'لم يتم العثور على ملفك الشخصي. يرجى إكمال التسجيل عبر الموقع أولاً.'
                    : 'Your profile was not found. Please complete registration on the website first.',
                );
                setIsLoading(false);
              }
            } catch (error) {
              initializedScopeRef.current = null;
              recordCrashlyticsError(error);
              console.error('Error during authentication:', error);
              setIsLoading(false);
            }
          } else {
            // No user authenticated
            initializedScopeRef.current = null;
            setShowSuccess(false);
            setIsLoading(false);
          }
        });
      } catch (error) {
        recordCrashlyticsError(error);
        console.error('Native service initialization error:', error);
        setAuthInitialized(true);
        setIsLoading(false);
      }
    };

    // Initialize auth state
    initializeAuth();

    // Cleanup function
    return () => {
      isActive = false;
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
        navigationTimeoutRef.current = null;
      }
      unsubscribe?.();
    };
  }, [
    router,
    initializeCache,
    alert,
    language,
    workspaceCompanyId,
    workspaceRole,
  ]);

  // Show loading screen while native services initialize with branded design
  if (isLoading || !authInitialized) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#081426', '#0C3A66', '#0EA892']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.loadingGradient}
        >
          <View style={styles.loadingContent}>
            {/* App Title */}
            <View style={styles.titleContainer}>
              <LinearGradient
                colors={['#FFFFFF', '#E0F2FE']}
                style={styles.titleGradient}
              >
                <AppText style={styles.appTitle}>{t.title}</AppText>
              </LinearGradient>
              <AppText style={styles.appSubtitle}>{t.subtitle}</AppText>
            </View>

            {/* Document Icon */}
            <View style={styles.iconContainer}>
              <LinearGradient
                colors={['#0C3A66', '#0EA892']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.iconCircle}
              >
                <MaterialCommunityIcons name="clipboard-check-multiple" size={64} color="white" />
              </LinearGradient>
              <View style={styles.sparkles}>
                <Ionicons name="sparkles" size={20} color="#0EA892" style={styles.sparkle1} />
                <Ionicons name="sparkles" size={16} color="#7DD3FC" style={styles.sparkle2} />
              </View>
            </View>

            {/* Loading Indicator with Animated Dots */}
            <View style={styles.loadingIndicator}>
              <View style={styles.dotsContainer}>
                <Animated.View style={[styles.dot, { opacity: dot1Anim }]} />
                <Animated.View style={[styles.dot, { opacity: dot2Anim }]} />
                <Animated.View style={[styles.dot, { opacity: dot3Anim }]} />
              </View>
              <AppText style={styles.loadingText}>{t.loading}</AppText>
            </View>
          </View>
        </LinearGradient>
      </View>
    );
  }

  // Show login screen if no user is authenticated
  if (!user) {
    return <Login />;
  }

  // User is authenticated, navigation will be handled by onAuthStateChanged
  // Show success animation if ready
  if (showSuccess) {
    return (
      <Animated.View 
        style={[
          styles.successOverlay,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          }
        ]}
      >
        <LinearGradient
          colors={['#10B981', '#059669']}
          style={styles.successGradient}
        >
          <View style={styles.successContent}>
            <View style={styles.successCircle}>
              <Ionicons name="checkmark-circle" size={80} color="white" />
            </View>
            <AppText style={styles.successTitle}>{t.success}</AppText>
            <AppText style={styles.successSubtitle}>{t.welcome}</AppText>
          </View>
        </LinearGradient>
      </Animated.View>
    );
  }
  
  // Return null to avoid showing extra loading screen
  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContent: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  titleContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  titleGradient: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 16,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  appTitle: {
    fontSize: 38,
    fontWeight: '800',
    color: '#0C3A66',
    letterSpacing: 1,
  },
  appSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    fontWeight: '500',
    letterSpacing: 2,
  },
  iconContainer: {
    position: 'relative',
    marginBottom: 50,
  },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 12,
  },
  sparkles: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  sparkle1: {
    position: 'absolute',
    top: 10,
    right: -10,
  },
  sparkle2: {
    position: 'absolute',
    bottom: 15,
    left: -5,
  },
  loadingIndicator: {
    alignItems: 'center',
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'white',
    marginHorizontal: 6,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
    letterSpacing: 0.5,
  },
  successOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10001,
  },
  successGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  successContent: {
    alignItems: 'center',
  },
  successCircle: {
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: 'white',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  successSubtitle: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.9)',
    fontWeight: '600',
  },
});

