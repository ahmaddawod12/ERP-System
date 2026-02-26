import React from 'react';
import { StyleSheet, View } from 'react-native';
import { borderRadius, getColors, getStatusColors, spacing } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';
import AppText from './AppText';

const normalizeStatus = (status) => String(status || '').toLowerCase().trim();

export default function AppChip({
  label,
  status,
  color,
  textColor,
  style,
  textStyle,
  size = 'md',
  emphasis = 'soft',
}) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const statusPalette = getStatusColors(isDarkMode);
  const statusKey = normalizeStatus(status);
  const resolvedColor = color || statusPalette[statusKey] || palette.textLight;
  const softBackground =
    typeof resolvedColor === 'string' && resolvedColor.startsWith('#') && resolvedColor.length === 7
      ? `${resolvedColor}26`
      : resolvedColor;
  const softBorderColor =
    typeof resolvedColor === 'string' && resolvedColor.startsWith('#') && resolvedColor.length === 7
      ? `${resolvedColor}55`
      : resolvedColor;
  const isSoft = emphasis === 'soft';
  const resolvedTextColor = textColor || (isSoft ? resolvedColor : palette.textWhite);
  const compact = size === 'sm';

  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: isSoft ? softBackground : resolvedColor,
          borderWidth: isSoft ? 1 : 0,
          borderColor: isSoft ? softBorderColor : 'transparent',
          paddingVertical: compact ? spacing.xs : spacing.xs + 1,
          paddingHorizontal: compact ? spacing.sm : spacing.md,
        },
        style,
      ]}
    >
      <AppText
        variant="badge"
        color={resolvedTextColor}
        style={[styles.text, textStyle, compact && styles.compactText]}
      >
        {label || status || ''}
      </AppText>
    </View>
  );
}

export const Badge = AppChip;

const styles = StyleSheet.create({
  chip: {
    borderRadius: borderRadius.pill,
    alignSelf: 'flex-start',
  },
  text: {
    letterSpacing: 0.3,
  },
  compactText: {
    fontSize: 10,
  },
});
