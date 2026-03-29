import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { borderRadius, getColors, shadows, spacing, typography, type ColorPalette } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';
import AppIcon from './AppIcon';

export interface SearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  colors?: ColorPalette;
  onClear?: () => void;
  editable?: boolean;
}

export default function SearchInput({
  value,
  onChangeText,
  placeholder = 'Search',
  style,
  colors,
  onClear,
  editable = true,
}: SearchInputProps) {
  const { isDarkMode } = useThemeContext();
  const palette = colors || getColors(isDarkMode);
  const canClear = !!value;
  const [isFocused, setIsFocused] = useState(false);
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
    <View
      style={[
        styles.container,
        {
          backgroundColor: palette.surfaceAlt,
          borderColor: isFocused ? palette.secondary : palette.border,
        },
        focusStyle,
        style,
      ]}
    >
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
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
      />
      {canClear ? (
        <Pressable
          onPress={() => {
            onChangeText?.('');
            onClear?.();
          }}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          style={({ pressed }) => [styles.clearButton, { opacity: pressed ? 0.72 : 1 }]}
        >
          <AppIcon name="close-circle" size={18} color={palette.textLight} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1.2,
    borderRadius: borderRadius.lg,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.xs,
  },
  input: {
    flex: 1,
    fontSize: typography.base,
    paddingVertical: spacing.sm + 2,
  },
  clearButton: {
    padding: spacing.xs,
  },
});
