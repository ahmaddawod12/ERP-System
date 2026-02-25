import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { borderRadius, getColors, spacing } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';
import AppText from './AppText';

export default function AppListItem({
  title,
  subtitle,
  left,
  right,
  onPress,
  style,
  contentStyle,
  titleColor,
  subtitleColor,
  accessibilityLabel,
}) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const baseStyle = [
    styles.item,
    {
      backgroundColor: palette.surface,
      borderColor: palette.border,
    },
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
        style={({ pressed }) => [baseStyle, { opacity: pressed ? 0.9 : 1 }]}
      >
        {left ? <View style={styles.left}>{left}</View> : null}
        <View style={[styles.content, contentStyle]}>
          <AppText variant="bodyStrong" color={titleColor || palette.textPrimary}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" color={subtitleColor || palette.textSecondary}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </Pressable>
    );
  }

  return (
    <View style={baseStyle}>
      {left ? <View style={styles.left}>{left}</View> : null}
      <View style={[styles.content, contentStyle]}>
        <AppText variant="bodyStrong" color={titleColor || palette.textPrimary}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color={subtitleColor || palette.textSecondary}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 56,
  },
  left: {
    marginRight: spacing.md,
  },
  content: {
    flex: 1,
    gap: spacing.xs,
  },
  right: {
    marginLeft: spacing.md,
  },
});
