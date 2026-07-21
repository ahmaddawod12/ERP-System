import React, { useMemo } from 'react';
import {
  I18nManager,
  Text,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { getColors, typography } from '../../theme';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useLanguageContext } from '../../contexts/LanguageContext';

type TextVariant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'caption' | 'label' | 'badge';
type WeightKey = 'extrabold' | 'bold' | 'semibold' | 'medium' | 'regular' | 'light';

interface VariantToken {
  size: number;
  weight: WeightKey;
  ratio: number;
  spacing: number;
  textTransform?: string;
}

export interface AppTextProps extends Omit<TextProps, 'children' | 'style'> {
  children?: React.ReactNode;
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  accessibilityLabel?: string;
  align?: 'left' | 'right' | 'center' | 'auto';
  allowFontScaling?: boolean;
  weight?: WeightKey;
}

const variantTokens: Record<TextVariant, VariantToken> = {
  display: { size: typography.display, weight: 'extrabold', ratio: typography.tight, spacing: -0.35 },
  title: { size: typography.xxl, weight: 'bold', ratio: typography.tight, spacing: -0.2 },
  heading: { size: typography.xl, weight: 'bold', ratio: typography.tight, spacing: -0.15 },
  body: { size: typography.base, weight: 'regular', ratio: typography.normal, spacing: 0 },
  bodyStrong: { size: typography.base, weight: 'semibold', ratio: typography.normal, spacing: 0.1 },
  caption: { size: typography.sm, weight: 'regular', ratio: typography.normal, spacing: 0.15 },
  label: { size: typography.sm, weight: 'semibold', ratio: typography.normal, spacing: 0.18 },
  badge: {
    size: typography.xs,
    weight: 'bold',
    ratio: typography.normal,
    spacing: 0.4,
    textTransform: 'uppercase',
  },
};

const getFontFamily = (weightKey: string): string | undefined => {
  if (weightKey === 'extrabold') return typography.fontFamilies.primaryExtraBold;
  if (weightKey === 'bold') return typography.fontFamilies.primaryBold;
  if (weightKey === 'semibold') return typography.fontFamilies.primarySemiBold;
  if (weightKey === 'medium') return typography.fontFamilies.primaryMedium;
  return typography.fontFamilies.primary;
};

const buildVariantStyle = (variant: TextVariant, weightOverride?: WeightKey) => {
  const token = variantTokens[variant] || variantTokens.body;
  const weightKey = weightOverride || token.weight;
  return {
    fontSize: token.size,
    lineHeight: Math.round(token.size * token.ratio),
    letterSpacing: token.spacing,
    fontWeight: typography.weights[weightKey] || typography.weights.regular,
    fontFamily: getFontFamily(weightKey),
    textTransform: token.textTransform || 'none',
  };
};

export default function AppText({
  children,
  variant = 'body',
  color,
  style,
  numberOfLines,
  accessibilityLabel,
  align,
  allowFontScaling = true,
  weight,
  ...textProps
}: AppTextProps) {
  const { isDarkMode } = useThemeContext();
  const { language } = useLanguageContext();
  const palette = getColors(isDarkMode);
  const isRTL = language === 'he' || language === 'ar' || I18nManager.isRTL;
  const resolvedVariant = useMemo(() => buildVariantStyle(variant, weight), [variant, weight]);

  return (
    <Text
      {...textProps}
      allowFontScaling={allowFontScaling}
      numberOfLines={numberOfLines}
      accessibilityLabel={accessibilityLabel}
      maxFontSizeMultiplier={1.25}
      style={[
        resolvedVariant as TextStyle,
        {
          color: color || palette.textPrimary,
          textAlign: align || (isRTL ? 'right' : 'left'),
          writingDirection: isRTL ? 'rtl' : 'ltr',
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
