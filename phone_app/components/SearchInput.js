import React from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { getColors, spacing, typography } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';
import AppIcon from './AppIcon';

export default function SearchInput({
  value,
  onChangeText,
  placeholder = 'Search',
  style,
  colors,
  onClear,
  editable = true,
}) {
  const { isDarkMode } = useThemeContext();
  const palette = colors || getColors(isDarkMode);
  const canClear = !!value;

  return (
    <View style={[styles.container, { backgroundColor: palette.surface, borderColor: palette.border }, style]}>
      <AppIcon name="search-outline" size={18} color={palette.textLight} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textLight}
        style={[styles.input, { color: palette.textPrimary }]}
        autoCapitalize="none"
        autoCorrect={false}
        editable={editable}
      />
      {canClear ? (
        <TouchableOpacity
          onPress={() => {
            onChangeText?.('');
            onClear?.();
          }}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          style={styles.clearButton}
        >
          <AppIcon name="close-circle" size={18} color={palette.textLight} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1.3,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: typography.base,
    paddingVertical: spacing.sm,
  },
  clearButton: {
    padding: spacing.xs,
  },
});
