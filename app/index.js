import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { auth, onAuthStateChanged } from '../firebase';
import Login from '../app/Login';
import { getColors } from '../theme';
import { LoadingSpinner } from '../components';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useThemeContext } from '../contexts/ThemeContext';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useCache } from '../contexts/CacheContext';
import { 
  registerPushTokenForUser, 
  setupNotificationListeners,
  initializeNotifications 
} from '../utils/notifications';

export default function App() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [firebaseInitialized, setFirebaseInitialized] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const { isDarkMode } = useThemeContext();
  const { language } = useLanguageContext();
  const { initializeCache, clearCache } = useCache();
  const colors = getColors(isDarkMode);
  
  // Animation states for loading dots
  const [dot1Anim] = useState(new Animated.Value(0.4));
  const [dot2Anim] = useState(new Animated.Value(0.7));
  const [dot3Anim] = useState(new Animated.Value(1));
  
  // Animation states for success overlay
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.8));

  // Animate loading dots
  useEffect(() => {
    if (isLoading) {
      const animateDots = () => {
        Animated.loop(
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
        ).start();
      };
      animateDots();
    }
  }, [isLoading]);

  const t = language === 'en' ? {
    title: 'JobMate',
    subtitle: 'Inventory Manager',
    loading: 'Loading...',
    success: 'Login Successful!',
    welcome: 'Welcome Back',
  } : language === 'he' ? {
    title: 'JobMate',
    subtitle: 'מנהל מלאי',
    loading: 'טוען...',
    success: 'התחברות מוצלחת!',
    welcome: 'ברוך שובך',
  } : {
    title: 'JobMate',
    subtitle: 'مدير المخزون',
    loading: 'جاري التحميل...',
    success: 'تم تسجيل الدخول بنجاح!',
    welcome: 'مرحبا بعودتك',
  };

  useEffect(() => {
    let unsubscribe;
    let cleanupNotifications;
    let isInitialized = false; // Prevent duplicate initialization
    
    /**
     * Show success animation and navigate to homepage
     */
    const showSuccessAndNavigate = (role) => {
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
      setTimeout(() => {
        if (role === 'manager') {
          router.replace('/ManagerHomepage');
        } else if (role === 'worker') {
          router.replace('/WorkerHomepage');
        } else if (role === 'basic') {
          router.replace('/BasicHomepage');
        } else if (role === 'dev') {
          router.replace('/DevInbox');
        } else {
          router.replace('/UserHomepage');
        }
      }, 1500);
    };

    /**
     * Check if business registration is required
     * All roles except worker and dev need business registration
     * Uses hasBusinessInfo flag from cache initialization
     */
    const checkBusinessRegistration = (role, companyName, hasBusinessInfo) => {
      // Dev role doesn't need business registration
      if (role === 'dev') return false;
      
      // All non-worker roles need business registration: manager, user, basic
      if (role !== 'worker' && companyName) {
        // Check if business_info exists (flag from cache init)
        if (!hasBusinessInfo) {
          console.log('📝 No business info found, redirecting to registration');
          setIsLoading(false);
          router.replace({
            pathname: '/BusinessReg',
            params: { companyName, userRole: role }
          });
          return true; // Business registration required
        }
      }
      return false; // No business registration required
    };
    
    // Initialize Firebase auth listener
    const initializeAuth = async () => {
      if (isInitialized) {
        console.log('⏭️ Auth already initialized, skipping duplicate setup');
        return;
      }
      
      isInitialized = true;
      console.log('🔐 Initializing auth and notifications...');
      
      try {
        // Firebase is already initialized in firebase.js
        // Now set up the auth listener - React Native Firebase Modular API
        unsubscribe = onAuthStateChanged(auth, async (user) => {
          setUser(user);
          setFirebaseInitialized(true);
          
          if (user) {
            try {
              // Initialize cache - it handles profile loading from cache first, then Firebase if needed
              // Returns { username, role, companyName } or null on failure
              const cacheResult = await initializeCache(user.email);
              
              if (cacheResult) {
                // Setup notification listeners ONCE per auth session
                if (!cleanupNotifications) {
                  cleanupNotifications = setupNotificationListeners(
                    (remoteMessage) => {
                      console.log('📬 Foreground notification:', remoteMessage?.notification?.title);
                    },
                    (response) => {
                      const data = response.data || {};
                      if (data?.type === 'job_assigned' && data?.screen === 'Workerjob') {
                        router.push('/Workerjob');
                      } else if (data?.type === 'job_submitted' && data?.screen === 'ManageJobs') {
                        router.push('/ManageJobs');
                      }
                    }
                  );
                }
                
                const { username, role, companyName, hasBusinessInfo } = cacheResult;
                console.log(`🔐 User authenticated: ${username} (${role}) hasBusinessInfo: ${hasBusinessInfo}`);
                
                // Register push token for notifications (always overwrite - handles token rotation)
                registerPushTokenForUser(user.email).then((success) => {
                  if (success) {
                    console.log('🔔 Push token registered successfully');
                  }
                }).catch((err) => {
                  console.warn('Push token registration failed (non-blocking):', err.message);
                });
                
                // Check if business registration is required (using hasBusinessInfo flag)
                const needsBusinessReg = checkBusinessRegistration(role, companyName, hasBusinessInfo);
                if (needsBusinessReg) return;
                
                // All checks passed - show success animation then navigate
                showSuccessAndNavigate(role);
              } else {
                // No profile found - redirect to login
                console.log('❌ Could not initialize cache/profile');
                setIsLoading(false);
              }
            } catch (error) {
              console.error('Error during authentication:', error);
              setIsLoading(false);
            }
          } else {
            // No user authenticated
            setIsLoading(false);
          }
        });
      } catch (error) {
        console.error('Firebase initialization error:', error);
        setFirebaseInitialized(true);
        setIsLoading(false);
      }
    };

    // Initialize notification channels (Android) - must be called before setupNotificationListeners
    initializeNotifications();
    
    // Initialize auth and notifications
    initializeAuth();

    // Cleanup function
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
      if (cleanupNotifications) {
        cleanupNotifications();
      }
    };
  }, [router, initializeCache]);

  // Show loading screen while Firebase initializes with branded design
  if (isLoading || !firebaseInitialized) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#0F2A4D', '#1e3a8a', '#00ACC1']}
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
                <Text style={styles.appTitle}>{t.title}</Text>
              </LinearGradient>
              <Text style={styles.appSubtitle}>{t.subtitle}</Text>
            </View>

            {/* Document Icon */}
            <View style={styles.iconContainer}>
              <LinearGradient
                colors={['#0F2A4D', '#00ACC1']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.iconCircle}
              >
                <MaterialCommunityIcons name="clipboard-check-multiple" size={64} color="white" />
              </LinearGradient>
              <View style={styles.sparkles}>
                <Ionicons name="sparkles" size={20} color="#00ACC1" style={styles.sparkle1} />
                <Ionicons name="sparkles" size={16} color="#00ACC1" style={styles.sparkle2} />
              </View>
            </View>

            {/* Loading Indicator with Animated Dots */}
            <View style={styles.loadingIndicator}>
              <View style={styles.dotsContainer}>
                <Animated.View style={[styles.dot, { opacity: dot1Anim }]} />
                <Animated.View style={[styles.dot, { opacity: dot2Anim }]} />
                <Animated.View style={[styles.dot, { opacity: dot3Anim }]} />
              </View>
              <Text style={styles.loadingText}>{t.loading}</Text>
            </View>
          </View>
        </LinearGradient>
      </View>
    );
  }

  // Show login screen if no user is authenticated
  if (!user) {
    return <Login auth={auth} />;
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
            <Text style={styles.successTitle}>{t.success}</Text>
            <Text style={styles.successSubtitle}>{t.welcome}</Text>
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
    color: '#0F2A4D',
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
