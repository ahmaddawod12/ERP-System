import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { borderRadius, getColors, shadows, spacing, type ColorPalette } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';
import AppIcon, { type IconLibrary } from './AppIcon';
import AppText from './AppText';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface IconConfig {
  name: string;
  library?: string;
  size?: number;
  color?: string;
  directionAware?: boolean;
}

export interface AppButtonProps {
  title?: string;
  children?: React.ReactNode;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  iconLeft?: IconConfig;
  iconRight?: IconConfig;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  size?: ButtonSize;
  minHeight?: number;
  hitSlop?: number;
}

const getVariantStyles = (palette: ColorPalette) => ({
  primary: {
    backgroundColor: palette.secondary,
    borderColor: palette.secondaryDark,
    textColor: palette.textWhite,
    gradient: [palette.secondary, palette.secondaryDark],
    shadow: shadows.primary,
  },
  secondary: {
    backgroundColor: palette.surfaceAlt,
    borderColor: palette.border,
    textColor: palette.textPrimary,
    shadow: shadows.sm,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    textColor: palette.secondary,
    shadow: null,
  },
  destructive: {
    backgroundColor: palette.error,
    borderColor: palette.error,
    textColor: palette.textWhite,
    gradient: [palette.error, '#B91C1C'],
    shadow: shadows.danger,
  },
  success: {
    backgroundColor: palette.success,
    borderColor: palette.success,
    textColor: palette.textWhite,
    gradient: [palette.success, '#0F766E'],
    shadow: shadows.success,
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
  size = 'md',
  minHeight = 48,
  hitSlop = 8,
}: AppButtonProps) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const variantStyles = getVariantStyles(palette)[variant] || getVariantStyles(palette).primary;
  const isDisabled = disabled || loading;
  const sizeStyle = size === 'sm' ? styles.sizeSm : size === 'lg' ? styles.sizeLg : styles.sizeMd;
  const currentMinHeight = typeof minHeight === 'number' ? minHeight : sizeStyle.minHeight;

  const content = loading ? (
    <ActivityIndicator color={variantStyles.textColor} />
  ) : (
    <View style={styles.content}>
      {iconLeft ? (
        <AppIcon
          name={iconLeft.name}
          library={iconLeft.library as IconLibrary | undefined}
          size={iconLeft.size || 18}
          color={iconLeft.color || variantStyles.textColor}
          directionAware={iconLeft.directionAware}
        />
      ) : null}
      {title ? (
        <AppText variant="bodyStrong" color={variantStyles.textColor} style={[styles.text, textStyle]}>
          {title}
        </AppText>
      ) : (
        children
      )}
      {iconRight ? (
        <AppIcon
          name={iconRight.name}
          library={iconRight.library as IconLibrary | undefined}
          size={iconRight.size || 18}
          color={iconRight.color || variantStyles.textColor}
          directionAware={iconRight.directionAware}
        />
      ) : null}
    </View>
  );

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
        sizeStyle,
        {
          minHeight: currentMinHeight,
          backgroundColor: variantStyles.backgroundColor,
          borderColor: variantStyles.borderColor,
          opacity: isDisabled ? 0.58 : 1,
          transform: [{ scale: pressed && !isDisabled ? 0.985 : 1 }],
        },
        variant !== 'ghost' && (variantStyles.shadow || shadows.sm),
        style,
      ]}
    >
      {(variantStyles as any).gradient && variant !== 'ghost' ? (
        <LinearGradient
          colors={(variantStyles as any).gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      ) : null}
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  sizeSm: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  sizeMd: {
    minHeight: 50,
  },
  sizeLg: {
    minHeight: 56,
    paddingHorizontal: spacing.xl,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  text: {
    textAlign: 'center',
    letterSpacing: 0.2,
  },
});
