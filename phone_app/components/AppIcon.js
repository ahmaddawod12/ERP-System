import React from 'react';
import { I18nManager, StyleSheet } from 'react-native';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

const ICON_SETS = {
  ionicons: Ionicons,
  material: MaterialCommunityIcons,
  feather: Feather,
};

const rtlAwareTokens = ['arrow', 'chevron', 'caret', 'triangle', 'forward', 'back'];

export default function AppIcon({
  name,
  library = 'ionicons',
  size = 20,
  color = '#0F172A',
  style,
  directionAware = false,
  accessibilityLabel,
}) {
  const IconSet = ICON_SETS[library] || Ionicons;
  const shouldFlip =
    directionAware &&
    I18nManager.isRTL &&
    typeof name === 'string' &&
    rtlAwareTokens.some((token) => name.toLowerCase().includes(token));

  return (
    <IconSet
      name={name}
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
