/**
 * InventoryItemSearch - Inline search component for inventory parts
 * 
 * Shows a text input that, as the user types, displays matching inventory
 * parts in a dropdown below the input. When a part is selected, it fills
 * the description and returns the part data.
 * 
 * Role-based behavior:
 * - Manager: receives company inventory parts
 * - User: receives personal cached inventory parts
 * - Basic: receives no parts (acts as plain TextInput)
 * 
 * @param {Object} props
 * @param {string} props.value - Current text value
 * @param {Function} props.onChangeText - Text change callback
 * @param {Function} props.onSelectPart - Called with selected part { id, name, quantity }
 * @param {Array} props.inventoryParts - Array of { id?, name, quantity } parts
 * @param {string} props.placeholder - Placeholder text
 * @param {Object} props.colors - Theme colors
 * @param {boolean} props.editable - Whether input is editable
 * @param {Object} props.style - Additional input style
 * @param {boolean} props.multiline - Whether input is multiline
 * @param {number} props.numberOfLines - Number of lines for multiline
 * @param {number} props.minChars - Minimum chars before showing suggestions (default: 1)
 */
import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors as themeColors, spacing, borderRadius, typography } from '../theme';

const InventoryItemSearch = ({
  value = '',
  onChangeText,
  onSelectPart,
  inventoryParts = [],
  placeholder = '',
  colors,
  editable = true,
  style,
  multiline = false,
  numberOfLines = 1,
  minChars = 1,
}) => {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedPartName, setSelectedPartName] = useState(null);
  const inputRef = useRef(null);

  // Filter parts based on current input value
  const filteredParts = useMemo(() => {
    if (!value || value.length < minChars || !inventoryParts || inventoryParts.length === 0) {
      return [];
    }
    // Don't show suggestions if the user already selected this exact part
    if (selectedPartName && value === selectedPartName) {
      return [];
    }
    const searchLower = value.toLowerCase().trim();
    return inventoryParts
      .filter(part => {
        const partName = (part.name || '').toLowerCase();
        return partName.includes(searchLower);
      })
      .slice(0, 5); // Max 5 suggestions
  }, [value, inventoryParts, minChars, selectedPartName]);

  const handleTextChange = useCallback((text) => {
    // If user modifies text after selecting, clear the selected state
    if (selectedPartName && text !== selectedPartName) {
      setSelectedPartName(null);
    }
    setShowSuggestions(true);
    onChangeText?.(text);
  }, [onChangeText, selectedPartName]);

  const handleSelectPart = useCallback((part) => {
    setSelectedPartName(part.name);
    setShowSuggestions(false);
    onChangeText?.(part.name);
    onSelectPart?.({
      id: part.id || part.name,
      name: part.name,
      quantity: part.quantity,
    });
  }, [onChangeText, onSelectPart]);

  const handleFocus = useCallback(() => {
    if (value && value.length >= minChars && !selectedPartName) {
      setShowSuggestions(true);
    }
  }, [value, minChars, selectedPartName]);

  const handleBlur = useCallback(() => {
    // Delay hiding to allow tap on suggestion
    setTimeout(() => {
      setShowSuggestions(false);
    }, 200);
  }, []);

  const hasSuggestions = showSuggestions && filteredParts.length > 0;

  // If no inventory parts provided, render plain TextInput
  if (!inventoryParts || inventoryParts.length === 0) {
    return (
      <TextInput
        ref={inputRef}
        style={style}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors?.textSecondary}
        multiline={multiline}
        numberOfLines={numberOfLines}
        editable={editable}
      />
    );
  }

  return (
    <View>
      <View style={styles.inputWrapper}>
        <TextInput
          ref={inputRef}
          style={[style, hasSuggestions && styles.inputWithSuggestions]}
          value={value}
          onChangeText={handleTextChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor={colors?.textSecondary}
          multiline={multiline}
          numberOfLines={numberOfLines}
          editable={editable}
        />
        {selectedPartName && value === selectedPartName && (
          <View style={[styles.selectedBadge, { backgroundColor: colors?.success + '20' }]}>
            <Ionicons name="checkmark-circle" size={14} color={colors?.success} />
          </View>
        )}
      </View>

      {hasSuggestions && (
        <View style={[styles.suggestionsContainer, { 
          backgroundColor: colors?.surface, 
          borderColor: colors?.border,
          shadowColor: colors?.textPrimary,
        }]}>
          {filteredParts.map((part, index) => (
            <TouchableOpacity
              key={part.id || part.name || index}
              style={[
                styles.suggestionItem,
                { borderBottomColor: colors?.border },
                index === filteredParts.length - 1 && styles.lastSuggestionItem,
              ]}
              onPress={() => handleSelectPart(part)}
              activeOpacity={0.6}
            >
              <View style={styles.suggestionContent}>
                <Ionicons name="cube-outline" size={16} color={colors?.primary} style={styles.suggestionIcon} />
                <Text 
                  style={[styles.suggestionName, { color: colors?.textPrimary }]}
                  numberOfLines={1}
                >
                  {part.name}
                </Text>
              </View>
              <Text style={[styles.suggestionQty, { color: colors?.textSecondary }]}>
                qty: {part.quantity}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  inputWrapper: {
    position: 'relative',
  },
  inputWithSuggestions: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  selectedBadge: {
    position: 'absolute',
    right: 8,
    top: 8,
    borderRadius: 10,
    padding: 2,
  },
  suggestionsContainer: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: borderRadius.md,
    borderBottomRightRadius: borderRadius.md,
    overflow: 'hidden',
    elevation: 3,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastSuggestionItem: {
    borderBottomWidth: 0,
  },
  suggestionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing.sm,
  },
  suggestionIcon: {
    marginRight: spacing.xs,
  },
  suggestionName: {
    fontSize: typography.sm,
    fontWeight: '500',
    flex: 1,
  },
  suggestionQty: {
    fontSize: typography.xs,
    fontWeight: '400',
  },
});

export default InventoryItemSearch;
