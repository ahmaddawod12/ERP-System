import React from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { borderRadius, getColors, shadows, spacing } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';
import AppText from './AppText';

export default function AppEmptyState({
  icon = 'inbox-outline',
  title,
  subtitle,
  action,
  style,
}) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  return (
    <View style={[styles.container, style]}>
      <View style={[styles.iconWrap, { backgroundColor: palette.surfaceAlt, borderColor: palette.borderLight }]}>
        <MaterialCommunityIcons name={icon} size={42} color={palette.textLight} />
      </View>
      {title ? (
        <AppText variant="heading" color={palette.textSecondary} style={styles.title}>
          {title}
        </AppText>
      ) : null}
      {subtitle ? (
        <AppText variant="body" color={palette.textLight} style={styles.subtitle}>
          {subtitle}
        </AppText>
      ) : null}
      {action || null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.lg,
  },
  iconWrap: {
    width: 82,
    height: 82,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.xs,
  },
  title: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
