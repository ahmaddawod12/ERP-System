import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { borderRadius, getColors, shadows, spacing } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';
import AppIcon from './AppIcon';
import AppText from './AppText';

const getVariantStyles = (palette) => ({
  primary: {
    container: {
      backgroundColor: palette.secondary,
      borderColor: palette.secondaryDark,
    },
    text: {
      color: palette.textWhite,
    },
  },
  secondary: {
    container: {
      backgroundColor: palette.surface,
      borderColor: palette.borderDark,
    },
    text: {
      color: palette.textPrimary,
    },
  },
  ghost: {
    container: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
    },
    text: {
      color: palette.secondary,
    },
  },
  destructive: {
    container: {
      backgroundColor: palette.error,
      borderColor: palette.error,
    },
    text: {
      color: palette.textWhite,
    },
  },
});

export default function AppButton({
  title,
  children,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  iconLeft,
  iconRight,
  style,
  textStyle,
  accessibilityLabel,
  minHeight = 48,
  hitSlop = 8,
}) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const variantStyles = getVariantStyles(palette)[variant] || getVariantStyles(palette).primary;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={accessibilityLabel || title}
      style={({ pressed }) => [
        styles.base,
        variantStyles.container,
        { minHeight, opacity: pressed && !isDisabled ? 0.88 : isDisabled ? 0.6 : 1 },
        variant !== 'ghost' && shadows.sm,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles.text.color} />
      ) : (
        <View style={styles.content}>
          {iconLeft ? (
            <AppIcon
              name={iconLeft.name}
              library={iconLeft.library}
              size={iconLeft.size || 18}
              color={iconLeft.color || variantStyles.text.color}
              directionAware={iconLeft.directionAware}
            />
          ) : null}
          {title ? (
            <AppText variant="bodyStrong" color={variantStyles.text.color} style={[styles.text, textStyle]}>
              {title}
            </AppText>
          ) : (
            children
          )}
          {iconRight ? (
            <AppIcon
              name={iconRight.name}
              library={iconRight.library}
              size={iconRight.size || 18}
              color={iconRight.color || variantStyles.text.color}
              directionAware={iconRight.directionAware}
            />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  text: {
    textAlign: 'center',
  },
});
