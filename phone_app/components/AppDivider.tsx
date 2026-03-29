import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { getColors, spacing } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';

export interface AppDividerProps {
  style?: StyleProp<ViewStyle>;
  inset?: number;
}

export default function AppDivider({ style, inset = 0 }: AppDividerProps) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  return (
    <View
      style={[
        styles.divider,
        {
          backgroundColor: palette.borderLight,
          marginLeft: inset,
          marginRight: inset,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth + 0.4,
    marginVertical: spacing.md,
  },
});
