import React from 'react';
import { I18nManager, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

type IconLibrary = 'ionicons' | 'material' | 'feather';

export { type IconLibrary };

const ICON_SETS: Record<IconLibrary, typeof Ionicons | typeof MaterialCommunityIcons | typeof Feather> = {
  ionicons: Ionicons,
  material: MaterialCommunityIcons,
  feather: Feather,
};

const rtlAwareTokens = ['arrow', 'chevron', 'caret', 'forward', 'back'];

export interface AppIconProps {
  name: string;
  library?: IconLibrary;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  directionAware?: boolean;
  accessibilityLabel?: string;
}

export default function AppIcon({
  name,
  library = 'ionicons',
  size = 20,
  color = '#0F172A',
  style,
  directionAware = false,
  accessibilityLabel,
}: AppIconProps) {
  const IconSet = ICON_SETS[library] || Ionicons;
  const shouldFlip =
    directionAware &&
    I18nManager.isRTL &&
    typeof name === 'string' &&
    rtlAwareTokens.some((token) => name.toLowerCase().includes(token));

  return (
    <IconSet
      name={name as any}
      size={size}
      color={color}
      style={[shouldFlip && styles.flipped, style]}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

const styles = StyleSheet.create({
  flipped: {
    transform: [{ scaleX: -1 }],
  },
});
