import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { borderRadius, getColors, shadows, spacing } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';

export default function AppCard({
  children,
  style,
  contentStyle,
  onPress,
  bordered = true,
  elevated = true,
  tone = 'default',
  padding = spacing.lg,
  accessibilityLabel,
}) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const toneColors =
    tone === 'muted'
      ? { backgroundColor: palette.surfaceAlt, borderColor: palette.borderLight }
      : tone === 'highlight'
      ? { backgroundColor: palette.surface, borderColor: palette.secondary }
      : { backgroundColor: palette.surface, borderColor: palette.border };

  const baseStyle = [
    styles.base,
    {
      backgroundColor: toneColors.backgroundColor,
      borderColor: bordered ? toneColors.borderColor : 'transparent',
      borderWidth: bordered ? 1 : 0,
      padding,
    },
    elevated ? shadows.card : null,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [baseStyle, { opacity: pressed ? 0.94 : 1 }]}
      >
        <View style={contentStyle}>{children}</View>
      </Pressable>
    );
  }

  return (
    <View style={baseStyle}>
      <View style={contentStyle}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.xl,
  },
});
