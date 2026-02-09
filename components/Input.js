/**
 * Reusable Input Component for Smart-Job App
 */

import React from 'react';
import { View, Text, TextInput, StyleSheet, Platform, Keyboard } from 'react-native';
import { colors as defaultColors, spacing, borderRadius, typography } from '../theme';

export const Input = ({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  helperText,
  required = false,
  multiline = false,
  numberOfLines = 1,
  style,
  inputStyle,
  returnKeyType,
  onSubmitEditing,
  colors = defaultColors,
  ...props
}) => {
  return (
    <View style={[styles.container, style]}>
      {label && (
        <Text style={[styles.label, { color: colors.textPrimary }]}>
          {label}
          {required && <Text style={[styles.required, { color: colors.danger }]}> *</Text>}
        </Text>
      )}
      
      <TextInput
        style={[
          styles.input,
          { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary },
          multiline && styles.multilineInput,
          error && { borderColor: colors.error },
          inputStyle,
        ]}
        value={value || ''}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textLight}
        multiline={multiline}
        numberOfLines={numberOfLines}
        returnKeyType={returnKeyType || (multiline ? 'default' : 'done')}
        onSubmitEditing={onSubmitEditing || (() => !multiline && Keyboard.dismiss())}
        blurOnSubmit={!multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        {...props}
      />
      
      {error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}
      {helperText && !error && <Text style={[styles.helperText, { color: colors.textSecondary }]}>{helperText}</Text>}
    </View>
  );
};

export const SearchInput = ({
  value,
  onChangeText,
  placeholder = 'Search...',
  style,
  colors = defaultColors,
  ...props
}) => {
  return (
    <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
      <Text style={styles.searchIcon}>🔍</Text>
      <TextInput
        style={[styles.searchInput, { color: colors.textPrimary }]}
        value={value || ''}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textLight}
        returnKeyType="search"
        onSubmitEditing={() => Keyboard.dismiss()}
        {...props}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    marginBottom: spacing.sm,
    letterSpacing: 0.3,
  },
  required: {
  },
  input: {
    borderWidth: 1.5,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    fontSize: typography.base,
    minHeight: 52,
  },
  multilineInput: {
    minHeight: 120,
    textAlignVertical: 'top',
    paddingTop: spacing.md,
  },
  inputError: {
  },
  errorText: {
    fontSize: typography.xs,
    marginTop: spacing.sm,
    fontWeight: typography.medium,
    letterSpacing: 0.2,
  },
  helperText: {
    fontSize: typography.xs,
    marginTop: spacing.sm,
    letterSpacing: 0.2,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md + 2,
    minHeight: 52,
  },
  searchIcon: {
    fontSize: typography.lg,
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.base,
    padding: 0,
  },
});
