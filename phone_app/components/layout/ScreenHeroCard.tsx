import React from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { borderRadius, getColors, gradients, shadows, spacing } from '../../theme';
import { useThemeContext } from '../../contexts/ThemeContext';
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

export interface ScreenHeroMetric {
  label: string;
  value: string;
}

export interface ScreenHeroCardProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  icon?: string;
  iconLibrary?: IconLibrary;
  accentColor?: string;
  metrics?: ScreenHeroMetric[];
  badges?: string[];
  style?: StyleProp<ViewStyle>;
}

export default function ScreenHeroCard({
  title,
  subtitle,
  eyebrow,
  icon = 'sparkles',
  iconLibrary = 'ionicons',
  accentColor,
  metrics = [],
  badges = [],
  style,
}: ScreenHeroCardProps) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const accent = accentColor || palette.secondary;
  const gradient = isDarkMode
    ? [palette.primaryDark, palette.primary, accent]
    : [gradients.headerLight[0], palette.primary, accent];

  return (
    <LinearGradient
      colors={gradient as [string, string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, style]}
    >
      <View style={styles.topRow}>
        <View style={[styles.iconWrap, { backgroundColor: 'rgba(255,255,255,0.12)' }]}> 
          <AppIcon name={icon} library={iconLibrary} size={22} color="#FFFFFF" />
        </View>
        {eyebrow ? (
          <View style={styles.eyebrowWrap}>
            <AppText variant="badge" color="#FFFFFF">
              {eyebrow}
            </AppText>
          </View>
        ) : null}
      </View>

      <AppText variant="title" color="#FFFFFF" style={styles.title}>
        {title}
      </AppText>
      {subtitle ? (
        <AppText variant="body" color="rgba(255,255,255,0.84)" style={styles.subtitle}>
          {subtitle}
        </AppText>
      ) : null}

      {metrics.length > 0 ? (
        <View style={styles.metricsRow}>
          {metrics.map((metric) => (
            <View
              key={`${metric.label}-${metric.value}`}
              style={[styles.metricCard, { backgroundColor: 'rgba(255,255,255,0.1)' }]}
            >
              <AppText variant="badge" color="rgba(255,255,255,0.7)">
                {metric.label}
              </AppText>
              <AppText variant="bodyStrong" color="#FFFFFF" style={styles.metricValue}>
                {metric.value}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {badges.length > 0 ? (
        <View style={styles.badgesRow}>
          {badges.map((badge) => (
            <AppChip
              key={badge}
              label={badge}
              color={withAlpha('#FFFFFF', 0.95)}
              textColor="#FFFFFF"
              style={styles.badge}
            />
          ))}
        </View>
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius.xxl,
    padding: spacing.xl,
    gap: spacing.sm,
    ...shadows.floating,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  eyebrowWrap: {
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  title: {
    marginTop: spacing.sm,
  },
  subtitle: {
    lineHeight: 22,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  metricCard: {
    minWidth: 86,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
  },
  metricValue: {
    marginTop: spacing.xs,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.12)',
  },
});