import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { borderRadius, getColors, shadows, spacing } from '../../theme';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import AppText from '../primitives/AppText';

/**
 * LoadingOverlay - Global loading overlay for document operations
 * 
 * @param {boolean} visible - Show/hide the overlay
 * @param {string} message - Custom loading message (optional)
 * @param {string} type - Loading type: 'preview', 'generate', 'download' (default: 'preview')
 */
export interface LoadingOverlayProps {
  visible?: boolean;
  message?: string;
  type?: 'preview' | 'generate' | 'download';
}

export default function LoadingOverlay({ visible = false, message, type = 'preview' }: LoadingOverlayProps) {
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const colors = getColors(isDarkMode);

  // Translations
  const t = language === 'en' ? {
    preview: 'Generating Preview...',
    generate: 'Generating Document...',
    download: 'Downloading Document...',
    pleaseWait: 'Please wait, this may take a moment',
  } : language === 'he' ? {
    preview: 'יוצר תצוגה מקדימה...',
    generate: 'יוצר מסמך...',
    download: 'מוריד מסמך...',
    pleaseWait: 'אנא המתן, זה עשוי לקחת רגע',
  } : {
    preview: 'إنشاء معاينة...',
    generate: 'إنشاء مستند...',
    download: 'تنزيل المستند...',
    pleaseWait: 'يرجى الانتظار، قد يستغرق هذا لحظة',
  };

  // Get icon based on type
  const getIcon = () => {
    switch (type) {
      case 'generate':
        return 'file-document-edit';
      case 'download':
        return 'download';
      case 'preview':
      default:
        return 'eye';
    }
  };

  // Get gradient colors based on type
  const getGradientColors = (): [string, string] => {
    switch (type) {
      case 'generate':
        return ['#0EA892', '#0D8AE8'];
      case 'download':
        return ['#0D8AE8', '#2563EB'];
      case 'preview':
      default:
        return ['#0C3A66', '#0D8AE8'];
    }
  };

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={[styles.loadingCard, { borderColor: colors.border }]}>
        <LinearGradient
          colors={getGradientColors()}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradientContainer}
        >
          {/* Icon with pulse animation */}
          <View style={styles.iconContainer}>
            <MaterialCommunityIcons 
              name={getIcon() as any} 
              size={48} 
              color="white" 
            />
          </View>

          {/* Spinner */}
          <ActivityIndicator size="large" color="white" style={styles.spinner} />

          {/* Loading Text */}
          <AppText variant="heading" color="#FFFFFF" align="center" style={styles.loadingText}>
            {message || t[type]}
          </AppText>

          {/* Subtext */}
          <AppText variant="caption" color="rgba(255,255,255,0.88)" align="center" style={styles.loadingSubtext}>
            {t.pleaseWait}
          </AppText>

          {/* Animated dots */}
          <View style={styles.dotsContainer}>
            <View style={[styles.dot, styles.dot1]} />
            <View style={[styles.dot, styles.dot2]} />
            <View style={[styles.dot, styles.dot3]} />
          </View>
        </LinearGradient>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 8, 20, 0.74)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  loadingCard: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    overflow: 'hidden',
    ...shadows.xl,
    width: '85%',
    maxWidth: 340,
  },
  gradientContainer: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  spinner: {
    marginVertical: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.sm,
  },
  loadingSubtext: {
    marginTop: spacing.sm,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  dot1: {
    opacity: 0.4,
  },
  dot2: {
    opacity: 0.7,
  },
  dot3: {
    opacity: 1,
  },
});
