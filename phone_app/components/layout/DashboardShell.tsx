import React from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { borderRadius, getColors, gradients, shadows, spacing } from '../../theme';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useLanguageContext } from '../../contexts/LanguageContext';
import AppIcon, { type IconLibrary } from '../primitives/AppIcon';
import AppText from '../primitives/AppText';
import ScrollableContainer from './ScrollableContainer';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';

const withAlpha = (hex: string, alpha: number) => {
  if (!hex || !hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) {
    return hex;
  }

  if (hex.length === 4) {
    const expanded = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    return withAlpha(expanded, alpha);
  }

  const value = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  return `${hex}${value.toString(16).padStart(2, '0')}`;
};

export interface DashboardMetric {
  label: string;
  value: string;
}

export interface DashboardTab {
  key: string;
  label: string;
  icon: string;
  iconLibrary?: IconLibrary;
}

export interface DashboardShellProps {
  title: string;
  subtitle: string;
  description?: string;
  heroLabel?: string;
  heroIcon?: string;
  heroIconLibrary?: IconLibrary;
  metrics?: DashboardMetric[];
  tabs?: DashboardTab[];
  activeTab?: string;
  onTabPress?: (key: string) => void;
  children?: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  bodyStyle?: StyleProp<ViewStyle>;
}

export default function DashboardShell({
  title,
  subtitle,
  description,
  heroLabel,
  heroIcon = 'sparkles',
  heroIconLibrary = 'ionicons',
  metrics = [],
  tabs = [],
  activeTab,
  onTabPress,
  children,
  contentContainerStyle,
  bodyStyle,
}: DashboardShellProps) {
  const { isDarkMode } = useThemeContext();
  const { language } = useLanguageContext();
  const palette = getColors(isDarkMode);
  const isRTL = language === 'he' || language === 'ar';
  const responsive = useResponsiveLayout();
  const heroGradient = isDarkMode
    ? [palette.primaryDark, palette.primary, palette.secondaryDark]
    : [gradients.premium[0], palette.primary, palette.secondaryDark];

  return (
    <View testID="dashboard-screen" style={[styles.container, { backgroundColor: palette.background }]}>
      <View
        pointerEvents="none"
        style={[
          styles.backdropOrb,
          styles.backdropOrbPrimary,
          { backgroundColor: withAlpha(palette.secondary, isDarkMode ? 0.2 : 0.12) },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.backdropOrb,
          styles.backdropOrbAccent,
          { backgroundColor: withAlpha(palette.accent, isDarkMode ? 0.18 : 0.1) },
        ]}
      />

      <ScrollableContainer
        contentContainerStyle={[
          styles.content,
          responsive.isWide && styles.contentWide,
          contentContainerStyle,
        ]}
      >
        <LinearGradient
          colors={heroGradient as [string, string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroCard, responsive.isWide && styles.heroCardWide]}
        >
          <View style={styles.heroTopRow}>
            <View style={styles.heroIdentityRow}>
              <View style={styles.heroIconWrap}>
                <AppIcon
                  name={heroIcon}
                  library={heroIconLibrary}
                  size={20}
                  color="#FFFFFF"
                />
              </View>
              <View style={styles.heroTextWrap}>
                {heroLabel ? (
                  <View style={styles.heroBadge}>
                    <AppText variant="badge" color="#FFFFFF">
                      {heroLabel}
                    </AppText>
                  </View>
                ) : null}
                <AppText variant="caption" color="rgba(255,255,255,0.82)" style={styles.heroSubtitle}>
                  {subtitle}
                </AppText>
              </View>
            </View>
          </View>

          <AppText variant="display" color="#FFFFFF" style={styles.heroTitle}>
            {title}
          </AppText>

          {description ? (
            <AppText variant="body" color="rgba(255,255,255,0.84)" style={styles.heroDescription}>
              {description}
            </AppText>
          ) : null}

          {metrics.length > 0 ? (
            <View style={[styles.metricsRow, isRTL && styles.metricsRowRtl]}>
              {metrics.map((metric) => (
                <View key={`${metric.label}-${metric.value}`} style={styles.metricPill}>
                  <AppText variant="badge" color="rgba(255,255,255,0.74)">
                    {metric.label}
                  </AppText>
                  <AppText variant="bodyStrong" color="#FFFFFF" style={styles.metricValue}>
                    {metric.value}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}
        </LinearGradient>

        {tabs.length > 0 ? (
          <View
            style={[
              styles.tabRail,
              {
                backgroundColor: withAlpha(palette.surface, isDarkMode ? 0.92 : 0.96),
                borderColor: palette.border,
              },
            ]}
          >
            {tabs.map((tab) => {
              const active = tab.key === activeTab;
              return (
                <Pressable
                  key={tab.key}
                  testID={`dashboard-tab-${tab.key}`}
                  onPress={() => onTabPress?.(tab.key)}
                  accessibilityRole="tab"
                  accessibilityLabel={tab.label}
                  style={[
                    styles.tabButton,
                    {
                      backgroundColor: active ? palette.primary : 'transparent',
                      borderColor: active ? withAlpha('#FFFFFF', 0.12) : 'transparent',
                    },
                  ]}
                >
                  <AppIcon
                    name={tab.icon}
                    library={tab.iconLibrary}
                    size={18}
                    color={active ? palette.textWhite : palette.textSecondary}
                  />
                  <AppText
                    variant="label"
                    color={active ? palette.textWhite : palette.textSecondary}
                    style={styles.tabLabel}
                  >
                    {tab.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={[styles.body, bodyStyle]}>{children}</View>
      </ScrollableContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backdropOrb: {
    position: 'absolute',
    borderRadius: borderRadius.full,
  },
  backdropOrbPrimary: {
    width: 220,
    height: 220,
    top: -70,
    right: -60,
  },
  backdropOrbAccent: {
    width: 180,
    height: 180,
    top: 180,
    left: -90,
  },
  content: {
    paddingTop: 96,
    paddingBottom: spacing.xxxl + spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  contentWide: {
    paddingHorizontal: spacing.xxl,
  },
  heroCard: {
    borderRadius: borderRadius.xxl,
    padding: spacing.xl,
    minHeight: 220,
    justifyContent: 'space-between',
    ...shadows.floating,
  },
  heroCardWide: {
    minHeight: 200,
    padding: spacing.xxl,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroIdentityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    flex: 1,
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTextWrap: {
    flex: 1,
    paddingTop: 1,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    borderRadius: borderRadius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
  },
  heroSubtitle: {
    marginTop: spacing.sm,
  },
  heroTitle: {
    marginTop: spacing.xl,
  },
  heroDescription: {
    marginTop: spacing.sm,
    maxWidth: '92%',
    lineHeight: 23,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  metricsRowRtl: {
    justifyContent: 'flex-end',
  },
  metricPill: {
    minWidth: 92,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  metricValue: {
    marginTop: spacing.xs,
  },
  tabRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing.sm,
    ...shadows.sm,
  },
  tabButton: {
    minHeight: 44,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  tabLabel: {
    letterSpacing: 0.12,
  },
  body: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
});
