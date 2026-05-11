import React from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { getColors, spacing } from '../../theme';
import { useThemeContext } from '../../contexts/ThemeContext';
import AppText from './AppText';

export interface LoadingSpinnerProps {
  size?: 'small' | 'large' | number;
  color?: string;
  text?: string;
  style?: StyleProp<ViewStyle>;
}

export default function LoadingSpinner({ size = 'large', color, text, style }: LoadingSpinnerProps) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const resolvedSize = typeof size === 'number' ? 'large' : size;
  const indicatorStyle = typeof size === 'number' ? { transform: [{ scale: size / 36 }] } : null;

  return (
    <View style={[styles.container, style]}>
      <ActivityIndicator size={resolvedSize} color={color || palette.secondary} style={indicatorStyle} />
      {text ? (
        <AppText variant="caption" color={palette.textSecondary} style={styles.text}>
          {text}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    marginTop: spacing.sm,
  },
});
