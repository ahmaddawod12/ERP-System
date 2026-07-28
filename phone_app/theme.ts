import { Platform, type ViewStyle, type TextStyle } from 'react-native';

// ── Color palette type derived from the light base shape ───────────────────
interface BaseColorPalette {
  primary: string;
  primaryLight: string;
  primaryDark: string;
  secondary: string;
  secondaryLight: string;
  secondaryDark: string;
  accent: string;
  warning: string;
  danger: string;
  success: string;
  error: string;
  info: string;
  background: string;
  backgroundLight: string;
  backgroundElevated: string;
  surface: string;
  surfaceAlt: string;
  surfaceMuted: string;
  textPrimary: string;
  textSecondary: string;
  textLight: string;
  textWhite: string;
  border: string;
  borderLight: string;
  borderDark: string;
  disabled: string;
  overlay: string;
  overlaySoft: string;
  lowStock: string;
  boxPurple: string;
  boxBlue: string;
  boxGreen: string;
  boxOrange: string;
  boxPink: string;
  boxTeal: string;
  boxIndigo: string;
  boxRed: string;
  boxYellow: string;
  boxLime: string;
}

export interface ColorPalette extends BaseColorPalette {
  text: string;
  card: string;
  muted: string;
  inputBackground: string;
  backdrop: string;
}

const withAliases = (palette: BaseColorPalette): ColorPalette => ({
  ...palette,
  text: palette.textPrimary,
  card: palette.surface,
  muted: palette.textLight,
  inputBackground: palette.surfaceAlt,
  backdrop: palette.overlay,
});

const lightBase: BaseColorPalette = {
  primary: '#0C3A66',
  primaryLight: '#2A5C8E',
  primaryDark: '#072746',
  secondary: '#0D8AE8',
  secondaryLight: '#38BDF8',
  secondaryDark: '#0369A1',
  accent: '#0EA892',
  warning: '#D97706',
  danger: '#DC2626',
  success: '#059669',
  error: '#DC2626',
  info: '#0284C7',
  background: '#EEF3FA',
  backgroundLight: '#F7FAFD',
  backgroundElevated: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F7FD',
  surfaceMuted: '#E7EFF9',
  textPrimary: '#0A1C33',
  textSecondary: '#32485F',
  textLight: '#60768E',
  textWhite: '#FFFFFF',
  border: '#D1DDEA',
  borderLight: '#E4ECF6',
  borderDark: '#A7B8CC',
  disabled: '#B6C5D8',
  overlay: 'rgba(7, 20, 39, 0.58)',
  overlaySoft: 'rgba(7, 20, 39, 0.3)',
  lowStock: '#D97706',
  boxPurple: '#5B67F0',
  boxBlue: '#0077D6',
  boxGreen: '#0F9F7D',
  boxOrange: '#F27934',
  boxPink: '#EA5B88',
  boxTeal: '#0B9BAA',
  boxIndigo: '#3857D6',
  boxRed: '#E44B4B',
  boxYellow: '#D49A12',
  boxLime: '#71B631',
};

const darkBase: BaseColorPalette = {
  primary: '#9FCCFF',
  primaryLight: '#C2DEFF',
  primaryDark: '#4D8BC4',
  secondary: '#38BDF8',
  secondaryLight: '#67E8F9',
  secondaryDark: '#0EA5E9',
  accent: '#2AD3B0',
  warning: '#F59E0B',
  danger: '#F87171',
  success: '#34D399',
  error: '#F87171',
  info: '#60A5FA',
  background: '#081426',
  backgroundLight: '#11233D',
  backgroundElevated: '#152B45',
  surface: '#122742',
  surfaceAlt: '#1A3455',
  surfaceMuted: '#203D61',
  textPrimary: '#F3F8FF',
  textSecondary: '#CFDAE8',
  textLight: '#99AEC6',
  textWhite: '#FFFFFF',
  border: '#274668',
  borderLight: '#203B5A',
  borderDark: '#3C5D82',
  disabled: '#4A6280',
  overlay: 'rgba(2, 8, 20, 0.78)',
  overlaySoft: 'rgba(2, 8, 20, 0.52)',
  lowStock: '#FBBF24',
  boxPurple: '#8C97FF',
  boxBlue: '#5AAFFF',
  boxGreen: '#54D9B6',
  boxOrange: '#FFB072',
  boxPink: '#FF99BC',
  boxTeal: '#6ADBE8',
  boxIndigo: '#9AA7FF',
  boxRed: '#FF8A8A',
  boxYellow: '#FFD26E',
  boxLime: '#C0EB74',
};

export const lightColors = withAliases(lightBase);
export const darkColors = withAliases(darkBase);
export const colors = lightColors;

export const getColors = (isDarkMode: boolean = false): ColorPalette => (isDarkMode ? darkColors : lightColors);

export const gradients: Record<string, readonly [string, string]> = {
  primary: ['#0C3A66', '#0D8AE8'],
  secondary: ['#0D8AE8', '#2AD3B0'],
  purpleBox: ['#5B67F0', '#8695FF'],
  blueBox: ['#0077D6', '#4AB1FF'],
  greenBox: ['#0F9F7D', '#3AD0A9'],
  orangeBox: ['#F27934', '#FDBA74'],
  pinkBox: ['#EA5B88', '#FDA4AF'],
  tealBox: ['#0B9BAA', '#3DD9C6'],
  indigoBox: ['#3857D6', '#7C8FFF'],
  redBox: ['#E44B4B', '#FC8A8A'],
  yellowBox: ['#D49A12', '#F5C548'],
  limeBox: ['#71B631', '#B4DF67'],
  premium: ['#091A31', '#103357'],
  glass: ['rgba(255,255,255,0.2)', 'rgba(255,255,255,0.05)'],
  success: ['#059669', '#34D399'],
  danger: ['#DC2626', '#F87171'],
  headerLight: ['#0A2F53', '#0C3A66'],
  headerDark: ['#081426', '#11233D'],
  surfaceGlow: ['rgba(255,255,255,0.62)', 'rgba(255,255,255,0)'],
};

export const spacing = {
  xxs: 2,
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
  xxxl: 40,
};

export const borderRadius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 34,
  pill: 999,
  full: 999,
};

const fontFamilies = Platform.select({
  ios: {
    primary: 'Avenir Next',
    primaryMedium: 'Avenir Next',
    primarySemiBold: 'Avenir Next',
    primaryBold: 'Avenir Next',
    primaryExtraBold: 'Avenir Next',
    mono: 'Menlo',
  },
  android: {
    primary: 'sans-serif',
    primaryMedium: 'sans-serif-medium',
    primarySemiBold: 'sans-serif-medium',
    primaryBold: 'sans-serif-black',
    primaryExtraBold: 'sans-serif-black',
    mono: 'monospace',
  },
  default: {
    primary: 'System',
    primaryMedium: 'System',
    primarySemiBold: 'System',
    primaryBold: 'System',
    primaryExtraBold: 'System',
    mono: 'monospace',
  },
});

export const typography = {
  fontFamilies,
  sizes: {
    xxs: 11,
    xs: 12,
    sm: 14,
    base: 16,
    md: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    xxxl: 30,
    display: 36,
    hero: 46,
  },
  weights: {
    light: '300' as const,
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    semiBold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
  },
  lineHeights: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.7,
  },
  tracking: {
    tight: -0.2,
    normal: 0,
    wide: 0.3,
  },
  xxs: 11,
  xs: 12,
  sm: 14,
  base: 16,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  xxxl: 30,
  display: 36,
  hero: 46,
  h1: 36,
  h2: 30,
  h3: 22,
  body: 16,
  small: 13,
  light: '300' as const,
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  semiBold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
  tight: 1.2,
  normal: 1.5,
  relaxed: 1.7,
};

export interface ShadowStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

const sharedShadowColor = '#071A33';

export const shadows = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  xs: {
    shadowColor: sharedShadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sm: {
    shadowColor: sharedShadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: sharedShadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.11,
    shadowRadius: 12,
    elevation: 4,
  },
  lg: {
    shadowColor: sharedShadowColor,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 8,
  },
  xl: {
    shadowColor: sharedShadowColor,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 14,
  },
  card: {
    shadowColor: sharedShadowColor,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 5,
  },
  floating: {
    shadowColor: sharedShadowColor,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  primary: {
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 8,
  },
  success: {
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 8,
  },
  danger: {
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 8,
  },
  small: {
    shadowColor: sharedShadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  medium: {
    shadowColor: sharedShadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.11,
    shadowRadius: 12,
    elevation: 4,
  },
  large: {
    shadowColor: sharedShadowColor,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 8,
  },
};

export const motion = {
  fast: 120,
  normal: 220,
  slow: 360,
};

export const getStatusColors = (isDarkMode: boolean = false) => {
  const palette = getColors(isDarkMode);
  return {
    pending: '#F59E0B',
    waiting: '#3B82F6',
    finished: palette.success,
    denied: palette.error,
    active: palette.success,
    disabled: palette.textLight,
    lowStock: palette.lowStock,
  };
};

export const commonStyles = {
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
    paddingTop: spacing.xxl,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.lg,
    fontWeight: typography.semibold as '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
    letterSpacing: typography.tracking.tight,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: spacing.md,
  },
};

export default {
  colors,
  lightColors,
  darkColors,
  getColors,
  gradients,
  spacing,
  borderRadius,
  typography,
  shadows,
  motion,
  commonStyles,
  getStatusColors,
};
