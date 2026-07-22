import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { borderRadius, getColors, shadows, spacing } from '../../theme';
import { useThemeContext } from '../../contexts/ThemeContext';

export type CardTone = 'default' | 'muted' | 'highlight';

export interface AppCardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  onPress?: () => void;
  bordered?: boolean;
  elevated?: boolean;
  tone?: CardTone;
  padding?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

export default function AppCard({
  children,
  style,
  contentStyle,
  onPress,
  bordered = true,
  elevated = true,
  tone = 'default',
  padding = spacing.lg,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: AppCardProps) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const toneColors =
    tone === 'muted'
      ? { backgroundColor: palette.surfaceAlt, borderColor: palette.borderLight }
      : tone === 'highlight'
      ? { backgroundColor: palette.backgroundElevated, borderColor: palette.secondary }
      : { backgroundColor: palette.backgroundElevated, borderColor: palette.border };

  const baseStyle = [
    styles.base,
    {
      backgroundColor: toneColors.backgroundColor,
      borderColor: bordered ? toneColors.borderColor : 'transparent',
      borderWidth: bordered ? 1 : 0,
      padding,
    },
    elevated ? shadows.floating : null,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        testID={testID}
        style={({ pressed }) => [baseStyle, { opacity: pressed ? 0.94 : 1 }]}
      >
        <View style={contentStyle}>{children}</View>
      </Pressable>
    );
  }

  return (
    <View style={baseStyle} testID={testID}>
      <View style={contentStyle}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.xxl,
    overflow: 'hidden',
  },
});
