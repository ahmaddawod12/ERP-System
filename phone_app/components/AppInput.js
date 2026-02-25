import React, { forwardRef, useMemo, useState } from 'react';
import { I18nManager, StyleSheet, TextInput, View } from 'react-native';
import { borderRadius, getColors, spacing, typography } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';
import { useLanguageContext } from '../contexts/LanguageContext';
import AppText from './AppText';

const AppInput = forwardRef(function AppInput(
  {
    label,
    helperText,
    error,
    leftIcon,
    rightIcon,
    style,
    inputStyle,
    colors,
    containerStyle,
    minHeight = 48,
    ...props
  },
  ref
) {
  const { isDarkMode } = useThemeContext();
  const { language } = useLanguageContext();
  const palette = colors || getColors(isDarkMode);
  const isRTL = language === 'he' || language === 'ar' || I18nManager.isRTL;
  const [isFocused, setIsFocused] = useState(false);

  const borderColor = useMemo(() => {
    if (error) return palette.error;
    if (isFocused) return palette.secondary;
    return palette.border;
  }, [error, isFocused, palette]);

  return (
    <View style={containerStyle}>
      {label ? (
        <AppText variant="label" color={palette.textSecondary} style={styles.label}>
          {label}
        </AppText>
      ) : null}

      <View
        style={[
          styles.inputWrap,
          {
            backgroundColor: palette.surface,
            borderColor,
            minHeight,
          },
          style,
        ]}
      >
        {leftIcon ? <View style={styles.icon}>{leftIcon}</View> : null}
        <TextInput
          ref={ref}
          {...props}
          onFocus={(event) => {
            setIsFocused(true);
            props.onFocus?.(event);
          }}
          onBlur={(event) => {
            setIsFocused(false);
            props.onBlur?.(event);
          }}
          placeholderTextColor={palette.textLight}
          style={[
            styles.input,
            {
              color: palette.textPrimary,
              textAlign: props.textAlign || (isRTL ? 'right' : 'left'),
              writingDirection: isRTL ? 'rtl' : 'ltr',
            },
            inputStyle,
          ]}
        />
        {rightIcon ? <View style={styles.icon}>{rightIcon}</View> : null}
      </View>

      {error ? (
        <AppText variant="caption" color={palette.error} style={styles.helper}>
          {error}
        </AppText>
      ) : helperText ? (
        <AppText variant="caption" color={palette.textLight} style={styles.helper}>
          {helperText}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  label: {
    marginBottom: spacing.xs,
  },
  inputWrap: {
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: typography.base,
    paddingVertical: spacing.sm,
  },
  icon: {
    marginHorizontal: spacing.xs,
  },
  helper: {
    marginTop: spacing.xs,
  },
});

export const FormField = AppInput;
export default AppInput;
