import React from 'react';
import { StyleSheet, View } from 'react-native';
import { borderRadius, getColors, shadows, spacing } from '../../theme';
import { useThemeContext } from '../../contexts/ThemeContext';
import AppCard from '../primitives/AppCard';
import AppChip from '../primitives/AppChip';
import AppIcon, { type IconLibrary } from '../primitives/AppIcon';
import AppText from '../primitives/AppText';

const withAlpha = (hex: string, alpha: number) => {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) {
    return hex;
  }
  const value = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  return `${hex}${value.toString(16).padStart(2, '0')}`;
};

export interface DashboardActionCardProps {
  title: string;
  description: string;
  icon: string;
  iconLibrary?: IconLibrary;
  accentColor?: string;
  badge?: string;
  eyebrow?: string;
  ctaLabel?: string;
  onPress?: () => void;
}

export default function DashboardActionCard({
  title,
  description,
  icon,
  iconLibrary = 'material',
  accentColor,
  badge,
  eyebrow,
  ctaLabel = 'Open',
  onPress,
}: DashboardActionCardProps) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const resolvedAccent = accentColor || palette.secondary;

  return (
    <AppCard
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: palette.backgroundElevated,
          borderColor: withAlpha(resolvedAccent, isDarkMode ? 0.3 : 0.16),
        },
      ]}
    >
      <View style={[styles.accentBar, { backgroundColor: resolvedAccent }]} />
      <View style={styles.header}>
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor: withAlpha(resolvedAccent, isDarkMode ? 0.22 : 0.12),
              borderColor: withAlpha(resolvedAccent, isDarkMode ? 0.34 : 0.2),
            },
          ]}
        >
          <AppIcon
            name={icon}
            library={iconLibrary}
            size={24}
            color={resolvedAccent}
          />
        </View>
        {badge ? <AppChip label={badge} color={resolvedAccent} size="sm" /> : null}
      </View>

      {eyebrow ? (
        <AppText variant="badge" color={palette.textLight} style={styles.eyebrow}>
          {eyebrow}
        </AppText>
      ) : null}

      <AppText variant="heading" color={palette.textPrimary} style={styles.title}>
        {title}
      </AppText>

      <AppText variant="body" color={palette.textSecondary} style={styles.description}>
        {description}
      </AppText>

      <View style={styles.footer}>
        <AppText variant="caption" color={palette.textLight}>
          {ctaLabel}
        </AppText>
        <View
          style={[
            styles.arrowWrap,
            { backgroundColor: withAlpha(resolvedAccent, isDarkMode ? 0.22 : 0.1) },
          ]}
        >
          <AppIcon
            name="arrow-forward"
            library="ionicons"
            size={18}
            color={resolvedAccent}
            directionAware
          />
        </View>
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    paddingTop: spacing.xl + 4,
  },
  accentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.xs,
  },
  eyebrow: {
    marginTop: spacing.md,
  },
  title: {
    marginTop: spacing.sm,
  },
  description: {
    marginTop: spacing.xs + 2,
    lineHeight: 22,
  },
  footer: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  arrowWrap: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});