import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  ScrollView, 
  TouchableOpacity, 
  StyleSheet, 
  ActivityIndicator,
  Linking,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useThemeContext } from '../contexts/ThemeContext';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useAlert } from '../contexts/AlertContext';
import { getColors, gradients, spacing, borderRadius, shadows, typography } from '../theme';
import { GlobalHeader } from '../components/GlobalHeader';
import { ScrollableContainer } from '../components';
import { auth, db, functions, middleEastFunctions, doc, getDoc, onSnapshot, httpsCallable } from '../firebase';
import { useRouter } from 'expo-router';

export default function Permission() {
  const { isDarkMode } = useThemeContext();
  const { language } = useLanguageContext();
  const alert = useAlert();
  const router = useRouter();
  const colors = getColors(isDarkMode);

  const [loading, setLoading] = useState(false);
  const [tokenStatus, setTokenStatus] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const t = language === 'en' ? {
    title: 'Tax Authority Permission',
    subtitle: 'Manage authorization for Israeli Tax Authority integration',
    grantButton: 'Grant Permissions',
    refreshButton: 'Refresh Token',
    statusTitle: 'Current Status',
    statusConnected: 'Connected',
    statusNotConnected: 'Not Connected',
    statusExpired: 'Token Expired',
    accessToken: 'Access Token',
    refreshToken: 'Refresh Token',
    expiresAt: 'Expires At',
    refreshTokenExpiresAt: 'Refresh Token Expires At',
    lastUpdated: 'Last Updated',
    companyName: 'Company',
    grantingPermission: 'Opening authorization page...',
    refreshingToken: 'Refreshing access token...',
    permissionGranted: 'Permission Granted',
    permissionGrantedMessage: 'Authorization successful! Tokens have been saved.',
    permissionError: 'Authorization Error',
    tokenRefreshed: 'Token Refreshed',
    tokenRefreshedMessage: 'Access token has been refreshed successfully.',
    tokenRefreshError: 'Token Refresh Failed',
    noTokens: 'No tokens found. Please grant permission first.',
    description: 'Grant permission to connect with the Israeli Tax Authority system for automated document submission and invoice management.',
    instructions: 'Click "Grant Permissions" to authorize the application. You will be redirected to the Tax Authority login page.',
  } : language === 'he' ? {
    title: 'הרשאת רשות המסים',
    subtitle: 'ניהול הרשאות לאינטגרציה עם רשות המסים',
    grantButton: 'מתן הרשאות',
    refreshButton: 'רענון אסימון',
    statusTitle: 'סטטוס נוכחי',
    statusConnected: 'מחובר',
    statusNotConnected: 'לא מחובר',
    statusExpired: 'אסימון פג תוקף',
    accessToken: 'אסימון גישה',
    refreshToken: 'אסימון רענון',
    expiresAt: 'פג תוקף ב',
    refreshTokenExpiresAt: 'אסימון רענון פג תוקף ב',
    lastUpdated: 'עודכן לאחרונה',
    companyName: 'חברה',
    grantingPermission: 'פותח דף הרשאה...',
    refreshingToken: 'מרענן אסימון גישה...',
    permissionGranted: 'הרשאה ניתנה',
    permissionGrantedMessage: 'האישור הצליח! האסימונים נשמרו.',
    permissionError: 'שגיאת הרשאה',
    tokenRefreshed: 'אסימון רוענן',
    tokenRefreshedMessage: 'אסימון הגישה רוענן בהצלחה.',
    tokenRefreshError: 'רענון אסימון נכשל',
    noTokens: 'לא נמצאו אסימונים. אנא תן הרשאה תחילה.',
    description: 'מתן הרשאה להתחבר למערכת רשות המסים לשליחת מסמכים אוטומטית וניהול חשבוניות.',
    instructions: 'לחץ על "מתן הרשאות" כדי לאשר את האפליקציה. תועבר לדף התחברות של רשות המסים.',
  } : {
    title: 'إذن مصلحة الضرائب',
    subtitle: 'إدارة التفويض للتكامل مع مصلحة الضرائب الإسرائيلية',
    grantButton: 'منح الأذونات',
    refreshButton: 'تحديث الرمز',
    statusTitle: 'الحالة الحالية',
    statusConnected: 'متصل',
    statusNotConnected: 'غير متصل',
    statusExpired: 'انتهت صلاحية الرمز',
    accessToken: 'رمز الوصول',
    refreshToken: 'رمز التحديث',
    expiresAt: 'تنتهي في',
    refreshTokenExpiresAt: 'انتهاء صلاحية رمز التحديث في',
    lastUpdated: 'آخر تحديث',
    companyName: 'الشركة',
    grantingPermission: 'فتح صفحة التفويض...',
    refreshingToken: 'تحديث رمز الوصول...',
    permissionGranted: 'تم منح الإذن',
    permissionGrantedMessage: 'التفويض ناجح! تم حفظ الرموز.',
    permissionError: 'خطأ في التفويض',
    tokenRefreshed: 'تم تحديث الرمز',
    tokenRefreshedMessage: 'تم تحديث رمز الوصول بنجاح.',
    tokenRefreshError: 'فشل تحديث الرمز',
    noTokens: 'لم يتم العثور على رموز. يرجى منح الإذن أولاً.',
    description: 'منح إذن للاتصال بنظام مصلحة الضرائب الإسرائيلية لتقديم المستندات التلقائي وإدارة الفواتير.',
    instructions: 'انقر فوق "منح الأذونات" للتفويض بالتطبيق. سيتم إعادة توجيهك إلى صفحة تسجيل الدخول إلى مصلحة الضرائب.',
  };

  useEffect(() => {
    // Listen to token status in Firestore from company-specific location
    const user = auth.currentUser;
    if (!user) return;

    const username = user.email.split('@')[0];
    
    // First get user's company name, then listen to company's token
    const setupListener = async () => {
      try {
        const userProfileRef = doc(db, username, 'profile');
        const userProfileSnap = await getDoc(userProfileRef);
        
        if (!userProfileSnap.exists()) {
          console.error('User profile not found');
          setTokenStatus({ hasTokens: false });
          return;
        }
        
        const userData = userProfileSnap.data();
        const companyName = userData.companyName;
        
        if (!companyName) {
          console.error('No company name found for user');
          setTokenStatus({ hasTokens: false });
          return;
        }
        
        // Listen to company-specific token location
        const tokenDocRef = doc(db, 'companies', companyName, 'business_data', 'token');
        
        const unsubscribe = onSnapshot(tokenDocRef, (docSnap) => {
          
          if (docSnap.exists()) {
            const data = docSnap.data();
            console.log('📦 Token data:', {
              hasAccessToken: !!data.accessToken,
              hasRefreshToken: !!data.refreshToken,
              expiresAt: data.accessTokenExpiresAt,
            });
            
            setTokenStatus({
              hasTokens: !!data.accessToken,
              accessToken: data.accessToken ? `${data.accessToken.substring(0, 20)}...` : null,
              refreshToken: data.refreshToken ? `${data.refreshToken.substring(0, 20)}...` : null,
              expiresAt: data.accessTokenExpiresAt ? new Date(data.accessTokenExpiresAt).toLocaleString(language) : null,
              refreshTokenExpiresAt: data.refreshTokenExpiresAt ? new Date(data.refreshTokenExpiresAt).toLocaleString(language) : null,
              lastUpdated: data.lastUpdated ? new Date(data.lastUpdated?.toMillis?.() || data.lastUpdated).toLocaleString(language) : null,
              companyName: companyName,
              isExpired: data.refreshTokenExpiresAt ? new Date(data.refreshTokenExpiresAt) < new Date() : false,
            });
          } else {
            console.log('⚠️ No token document found for company:', companyName);
            setTokenStatus({
              hasTokens: false,
              companyName: companyName,
            });
          }
        }, (error) => {
          console.error('Error listening to token status:', error);
          setTokenStatus({
            hasTokens: false,
            companyName: companyName,
          });
        });
        
        return unsubscribe;
      } catch (error) {
        console.error('Error setting up token listener:', error);
        setTokenStatus({ hasTokens: false });
      }
    };
    
    let unsubscribe;
    setupListener().then(unsub => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [language]);

  const handleGrantPermissions = async () => {
    try {
      setLoading(true);
      
      // Call cloud function to get authorization URL
      const startAuth = httpsCallable(functions, 'startTaxAuthorityAuth');
      const result = await startAuth();

      if (result.data.success && result.data.authorizationUrl) {
        // Open the authorization URL in the browser
        const url = result.data.authorizationUrl;
        const canOpen = await Linking.canOpenURL(url);
        
        if (canOpen) {
          await Linking.openURL(url);
          alert.info(
            t.grantingPermission,
            'Please complete the authorization in your browser.'
          );
        } else {
          alert.error(
            t.permissionError,
            'Cannot open authorization page. Please try again.'
          );
        }
      } else {
        alert.error(
          t.permissionError,
          result.data.message || 'Failed to start authorization process.'
        );
      }
    } catch (error) {
      console.error('Error granting permissions:', error);
      alert.error(
        t.permissionError,
        error.message || 'An error occurred while starting authorization.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshToken = async () => {
    try {
      setRefreshing(true);
      
      // Call cloud function to refresh token
      const refreshTokenFunc = httpsCallable(middleEastFunctions, 'refreshTaxAuthorityToken');
      const result = await refreshTokenFunc();
      console.log('✅ Cloud function result:', result.data);
      if (result.data.success) {
        alert.success(
          t.tokenRefreshed,
          t.tokenRefreshedMessage
        );
      } else {
        alert.error(
          t.tokenRefreshError,
          result.data.message || 'Failed to refresh token.'
        );
      }
    } catch (error) {
      console.error('Error refreshing token:', error);
      
      // Handle specific error messages
      let errorMessage = error.message || 'An error occurred while refreshing token.';
      
      if (error.code === 'functions/failed-precondition' || error.message?.includes('No Tax Authority authorization')) {
        errorMessage = t.noTokens;
      } else if (error.message?.includes('expired')) {
        errorMessage = 'Refresh token has expired. Please grant permissions again.';
      }
      
      alert.error(
        t.tokenRefreshError,
        errorMessage
      );
    } finally {
      setRefreshing(false);
    }
  };

  const getStatusColor = () => {
    if (!tokenStatus || !tokenStatus.hasTokens) return colors.error;
    if (tokenStatus.isExpired) return colors.warning;
    return colors.success;
  };

  const getStatusText = () => {
    if (!tokenStatus || !tokenStatus.hasTokens) return t.statusNotConnected;
    if (tokenStatus.isExpired) return t.statusExpired;
    return t.statusConnected;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <LinearGradient
        colors={gradients.primary}
        style={styles.header}
      >
        <Text style={styles.headerTitle}>{t.title}</Text>
        <Text style={styles.headerSubtitle}>{t.subtitle}</Text>
      </LinearGradient>

      <ScrollableContainer 
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Description Card */}
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.cardHeader}>
            <MaterialCommunityIcons name="information-outline" size={24} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
              {language === 'en' ? 'About' : language === 'he' ? 'אודות' : 'حول'}
            </Text>
          </View>
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {t.description}
          </Text>
          <Text style={[styles.instructions, { color: colors.textSecondary }]}>
            {t.instructions}
          </Text>
        </View>

        {/* Status Card */}
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.cardHeader}>
            <MaterialCommunityIcons name="shield-check" size={24} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
              {t.statusTitle}
            </Text>
          </View>

          <View style={styles.statusContainer}>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor() }]}>
              <Text style={styles.statusText}>{getStatusText()}</Text>
            </View>
          </View>

          {tokenStatus && tokenStatus.hasTokens && (
            <View style={styles.tokenInfo}>
              <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                  {t.companyName}:
                </Text>
                <Text style={[styles.infoValue, { color: colors.textPrimary }]}>
                  {tokenStatus.companyName}
                </Text>
              </View>

              <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                  {t.accessToken}:
                </Text>
                <Text style={[styles.infoValue, { color: colors.textPrimary }]} numberOfLines={1}>
                  {tokenStatus.accessToken}
                </Text>
              </View>

              <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                  {t.refreshToken}:
                </Text>
                <Text style={[styles.infoValue, { color: colors.textPrimary }]} numberOfLines={1}>
                  {tokenStatus.refreshToken}
                </Text>
              </View>

              <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                  {t.expiresAt}:
                </Text>
                <Text style={[styles.infoValue, { color: tokenStatus.isExpired ? colors.error : colors.textPrimary }]}>
                  {tokenStatus.expiresAt}
                </Text>
              </View>
              <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                  {t.refreshTokenExpiresAt}:
                </Text>
                <Text style={[styles.infoValue, { color: tokenStatus.isExpired ? colors.error : colors.textPrimary }]}>
                  {tokenStatus.refreshTokenExpiresAt}
                </Text>
              </View>
              <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                  {t.lastUpdated}:
                </Text>
                <Text style={[styles.infoValue, { color: colors.textPrimary }]}>
                  {tokenStatus.lastUpdated}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.grantButton}
            onPress={handleGrantPermissions}
            disabled={loading}
          >
            <LinearGradient
              colors={gradients.primary}
              style={styles.gradientButton}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <MaterialCommunityIcons name="shield-check-outline" size={24} color="white" />
                  <Text style={styles.buttonText}>{t.grantButton}</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollableContainer>

      <GlobalHeader />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'ios' ? spacing.xxl + 100 : spacing.xxl + 80,
    marginBottom: spacing.md,
  },
  headerTitle: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    color: 'white',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  headerSubtitle: {
    fontSize: typography.sm,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    ...shadows.medium,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: typography.lg,
    fontWeight: typography.semibold,
  },
  description: {
    fontSize: typography.base,
    lineHeight: 24,
    marginBottom: spacing.md,
  },
  instructions: {
    fontSize: typography.sm,
    lineHeight: 20,
  },
  statusContainer: {
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  statusBadge: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  statusText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.semibold,
  },
  tokenInfo: {
    marginTop: spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  infoLabel: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
    flex: 1,
  },
  infoValue: {
  testButton: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    ...shadows.medium,
  },
    fontSize: typography.sm,
    flex: 2,
    textAlign: 'right',
  },
  buttonContainer: {
    gap: spacing.md,
  },
  grantButton: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    ...shadows.medium,
  },
  refreshButton: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    ...shadows.medium,
  },
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  buttonText: {
    color: 'white',
    fontSize: typography.lg,
    fontWeight: typography.semibold,
  },
});
