import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { borderRadius, getColors, shadows, spacing } from '../../theme';
import { useThemeContext } from '../../contexts/ThemeContext';
import AppText from './AppText';

export interface AppListItemProps {
  title: string;
  subtitle?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  titleColor?: string;
  subtitleColor?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  selected?: boolean;
}

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
  accessibilityHint,
  selected,
}: AppListItemProps) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const baseStyle = [
    styles.item,
    {
      backgroundColor: palette.surfaceAlt,
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
        accessibilityHint={accessibilityHint || subtitle}
        accessibilityState={{ selected }}
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
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 62,
    ...shadows.xs,
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
