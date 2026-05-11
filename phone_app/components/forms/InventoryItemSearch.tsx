import React, { useMemo, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { borderRadius, getColors, spacing, typography, type ColorPalette } from '../../theme';
import { useThemeContext } from '../../contexts/ThemeContext';
import AppIcon from '../primitives/AppIcon';
import AppText from '../primitives/AppText';
import type { InventoryPart } from '../../types';

export interface InventoryItemSearchProps {
  value: string;
  onChangeText: (text: string) => void;
  onSelectPart?: (part: InventoryPart) => void;
  inventoryParts?: InventoryPart[];
  placeholder?: string;
  colors?: ColorPalette;
  editable?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function InventoryItemSearch({
  value,
  onChangeText,
  onSelectPart,
  inventoryParts = [],
  placeholder = 'Search part',
  colors,
  editable = true,
  style,
}: InventoryItemSearchProps) {
  const { isDarkMode } = useThemeContext();
  const palette = colors || getColors(isDarkMode);
  const [focused, setFocused] = useState(false);

  const filteredParts = useMemo(() => {
    const query = String(value || '').trim().toLowerCase();
    if (!query) return [];
    return (inventoryParts || [])
      .filter((part) => {
        const name = String(part?.name || '').toLowerCase();
        return name.includes(query);
      })
      .slice(0, 8);
  }, [inventoryParts, value]);

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.inputWrap, { borderColor: palette.border, backgroundColor: palette.surface }]}>
        <AppIcon name="cube-outline" size={18} color={palette.textLight} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.textLight}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setTimeout(() => setFocused(false), 150);
          }}
          style={[styles.input, { color: palette.textPrimary }]}
        />
      </View>

      {editable && focused && filteredParts.length > 0 ? (
        <View style={[styles.suggestions, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {filteredParts.map((part, index) => (
            <TouchableOpacity
              key={`${part.id || part.name}-${index}`}
              onPress={() => {
                onChangeText?.(part.name || '');
                onSelectPart?.(part);
                setFocused(false);
              }}
              style={[styles.suggestionRow, { borderBottomColor: palette.borderLight }]}
            >
              <AppText variant="bodyStrong">{part.name || '-'}</AppText>
              {typeof part.quantity === 'number' ? (
                <AppText variant="caption" color={palette.textSecondary}>
                  {part.quantity}
                </AppText>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    zIndex: 20,
  },
  inputWrap: {
    borderWidth: 1.2,
    borderRadius: borderRadius.md,
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
  suggestions: {
    marginTop: spacing.xs,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  suggestionRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth + 0.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
