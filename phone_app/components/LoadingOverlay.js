import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { shadows } from '../theme';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';

/**
 * LoadingOverlay - Global loading overlay for document operations
 * 
 * @param {boolean} visible - Show/hide the overlay
 * @param {string} message - Custom loading message (optional)
 * @param {string} type - Loading type: 'preview', 'generate', 'download' (default: 'preview')
 */
export default function LoadingOverlay({ visible = false, message, type = 'preview' }) {
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();

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
  const getGradientColors = () => {
    switch (type) {
      case 'generate':
        return ['#10B981', '#059669']; // Green
      case 'download':
        return ['#3b82f6', '#2563eb']; // Blue
      case 'preview':
      default:
        return ['#8b5cf6', '#7c3aed']; // Purple
    }
  };

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.loadingCard}>
        <LinearGradient
          colors={getGradientColors()}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradientContainer}
        >
          {/* Icon with pulse animation */}
          <View style={styles.iconContainer}>
            <MaterialCommunityIcons 
              name={getIcon()} 
              size={48} 
              color="white" 
            />
          </View>

          {/* Spinner */}
          <ActivityIndicator size="large" color="white" style={styles.spinner} />

          {/* Loading Text */}
          <Text style={styles.loadingText}>
            {message || t[type]}
          </Text>

          {/* Subtext */}
          <Text style={styles.loadingSubtext}>
            {t.pleaseWait}
            </Text>

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
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  loadingCard: {
    borderRadius: 28,
    overflow: 'hidden',
    ...shadows.xl,
    width: '85%',
    maxWidth: 360,
  },
  gradientContainer: {
    padding: 40,
    paddingVertical: 50,
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
    marginVertical: 20,
  },
  loadingText: {
    color: 'white',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 12,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  loadingSubtext: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 20,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
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
