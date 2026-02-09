/**
 * Reusable Button Components for Smart-Job App
 */

import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { colors as defaultColors, spacing, borderRadius, typography, shadows } from '../theme';

export const PrimaryButton = ({ 
  onPress, 
  title, 
  loading = false, 
  disabled = false,
  style,
  textStyle,
  colors = defaultColors
}) => {
  return (
    <TouchableOpacity
      style={[
        styles.primaryButton,
        { backgroundColor: colors.secondary },
        disabled && styles.disabledButton,
        style
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator color={colors.textWhite} />
      ) : (
        <Text style={[styles.primaryButtonText, { color: colors.textWhite }, textStyle]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

export const SecondaryButton = ({ 
  onPress, 
  title, 
  loading = false, 
  disabled = false,
  style,
  textStyle,
  colors = defaultColors
}) => {
  return (
    <TouchableOpacity
      style={[
        styles.secondaryButton,
        { backgroundColor: colors.surface, borderColor: colors.secondary },
        disabled && styles.disabledButton,
        style
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator color={colors.secondary} />
      ) : (
        <Text style={[styles.secondaryButtonText, { color: colors.secondary }, textStyle]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

export const DangerButton = ({ 
  onPress, 
  title, 
  loading = false, 
  disabled = false,
  style,
  textStyle,
  colors = defaultColors
}) => {
  return (
    <TouchableOpacity
      style={[
        styles.dangerButton,
        { backgroundColor: colors.danger },
        disabled && styles.disabledButton,
        style
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator color={colors.textWhite} />
      ) : (
        <Text style={[styles.dangerButtonText, { color: colors.textWhite }, textStyle]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

export const TextButton = ({ 
  onPress, 
  title, 
  disabled = false,
  style,
  textStyle,
  colors = defaultColors
}) => {
  return (
    <TouchableOpacity
      style={[styles.textButton, style]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Text style={[styles.textButtonText, { color: colors.secondary }, disabled && { color: colors.disabled }, textStyle]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  primaryButton: {
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    ...shadows.primary,
  },
  primaryButtonText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    letterSpacing: 0.5,
  },
  secondaryButton: {
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    minHeight: 52,
  },
  secondaryButtonText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    letterSpacing: 0.3,
  },
  dangerButton: {
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    ...shadows.danger,
  },
  dangerButtonText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    letterSpacing: 0.3,
  },
  textButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButtonText: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    letterSpacing: 0.2,
  },
  disabledButton: {
    opacity: 0.5,
  },
  disabledText: {
  },
});
