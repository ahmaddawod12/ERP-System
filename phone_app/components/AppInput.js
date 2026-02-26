import React, { forwardRef, useMemo, useRef, useState } from 'react';
import { I18nManager, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { borderRadius, getColors, shadows, spacing, typography } from '../theme';
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
  const inputRef = useRef(null);
  const { isDarkMode } = useThemeContext();
  const { language } = useLanguageContext();
  const palette = colors || getColors(isDarkMode);
  const isRTL = language === 'he' || language === 'ar' || I18nManager.isRTL;
  const isSecureField = Boolean(props.secureTextEntry);
  const [isFocused, setIsFocused] = useState(false);

  const borderColor = useMemo(() => {
    if (error) return palette.error;
    if (isFocused) return palette.secondary;
    return palette.border;
  }, [error, isFocused, palette]);

  const setInputRef = (node) => {
    inputRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref && typeof ref === 'object') {
      ref.current = node;
    }
  };

  const focusStyle = isFocused
    ? {
        shadowColor: palette.secondary,
        shadowOpacity: 0.2,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 10,
        elevation: 3,
      }
    : shadows.none;

  return (
    <View style={containerStyle}>
      {label ? (
        <AppText variant="label" color={palette.textSecondary} style={styles.label}>
          {label}
        </AppText>
      ) : null}

      <Pressable
        onPress={() => inputRef.current?.focus?.()}
        onPressIn={() => inputRef.current?.focus?.()}
        style={[
          styles.inputWrap,
          {
            backgroundColor: palette.surfaceAlt,
            borderColor,
            minHeight,
          },
          focusStyle,
          style,
        ]}
      >
        {leftIcon ? <View style={styles.icon}>{leftIcon}</View> : null}
        <TextInput
          ref={setInputRef}
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
              textAlign: props.textAlign || (isSecureField ? 'left' : (isRTL ? 'right' : 'left')),
              writingDirection: isSecureField ? 'ltr' : (isRTL ? 'rtl' : 'ltr'),
              textAlignVertical: props.multiline ? 'top' : 'center',
            },
            inputStyle,
          ]}
        />
        {rightIcon ? <View style={styles.icon}>{rightIcon}</View> : null}
      </Pressable>

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
    marginBottom: spacing.xs + 2,
    letterSpacing: 0.2,
  },
  inputWrap: {
    borderRadius: borderRadius.lg,
    borderWidth: 1.25,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: typography.base,
    fontWeight: typography.regular,
    paddingVertical: spacing.sm + 2,
  },
  icon: {
    marginHorizontal: spacing.xs,
  },
  helper: {
    marginTop: spacing.xs + 2,
  },
});

export const FormField = AppInput;
export default AppInput;
