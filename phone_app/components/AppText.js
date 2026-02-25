import React from 'react';
import { I18nManager, StyleSheet, Text } from 'react-native';
import { getColors, typography } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';
import { useLanguageContext } from '../contexts/LanguageContext';

const variants = StyleSheet.create({
  display: {
    fontSize: typography.display,
    fontWeight: typography.extrabold,
    lineHeight: typography.display * typography.tight,
  },
  title: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    lineHeight: typography.xxl * typography.tight,
  },
  heading: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    lineHeight: typography.xl * typography.tight,
  },
  body: {
    fontSize: typography.base,
    fontWeight: typography.regular,
    lineHeight: typography.base * typography.normal,
  },
  bodyStrong: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    lineHeight: typography.base * typography.normal,
  },
  caption: {
    fontSize: typography.sm,
    fontWeight: typography.regular,
    lineHeight: typography.sm * typography.normal,
  },
  label: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    lineHeight: typography.sm * typography.normal,
  },
  badge: {
    fontSize: typography.xs,
    fontWeight: typography.bold,
    lineHeight: typography.xs * typography.normal,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
});

export default function AppText({
  children,
  variant = 'body',
  color,
  style,
  numberOfLines,
  accessibilityLabel,
  align,
  allowFontScaling = true,
}) {
  const { isDarkMode } = useThemeContext();
  const { language } = useLanguageContext();
  const palette = getColors(isDarkMode);
  const isRTL = language === 'he' || language === 'ar' || I18nManager.isRTL;
  const resolvedVariant = variants[variant] || variants.body;

  return (
    <Text
      allowFontScaling={allowFontScaling}
      numberOfLines={numberOfLines}
      accessibilityLabel={accessibilityLabel}
      style={[
        resolvedVariant,
        {
          color: color || palette.textPrimary,
          textAlign: align || (isRTL ? 'right' : 'left'),
          writingDirection: isRTL ? 'rtl' : 'ltr',
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
