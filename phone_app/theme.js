// Professional Corporate Theme for Smart-Job App
// Premium, sophisticated design system with refined aesthetics
// Supports Light and Dark modes

// Light Mode Colors - Premium & Sophisticated
export const lightColors = {
  // Primary Colors - Deep Navy with Refined Cyan
  primary: '#0A192F',           // Deep, sophisticated navy
  primaryLight: '#112240',      // Slightly lighter navy
  primaryDark: '#020C1B',       // Darker navy for emphasis
  
  secondary: '#0EA5E9',         // Modern sky blue (more sophisticated than teal)
  secondaryLight: '#38BDF8',    // Light sky blue
  secondaryDark: '#0284C7',     // Dark sky blue
  
  // Accent Colors - Refined palette
  accent: '#10B981',            // Emerald green
  warning: '#F59E0B',           // Amber
  danger: '#EF4444',            // Red
  
  // Neutral Colors - Clean whites and grays
  background: '#FAFBFC',        // Off-white (softer than pure white)
  backgroundLight: '#F1F5F9',   // Light gray
  surface: '#FFFFFF',           // Pure white for cards
  surfaceAlt: '#F1F5F9',        // Alternative surface
  
  // Text Colors - High contrast, professional
  textPrimary: '#0F172A',       // Almost black (slate-900)
  textSecondary: '#475569',     // Medium gray (slate-600)
  textLight: '#94A3B8',         // Light gray (slate-400)
  textWhite: '#FFFFFF',
  
  // UI States - Refined borders
  border: '#CBD5E1',            // Light border (slate-300)
  borderLight: '#E2E8F0',       // Very light border (slate-200)
  borderDark: '#94A3B8',        // Dark border for focus
  disabled: '#CBD5E1',
  overlay: 'rgba(15, 23, 42, 0.6)',
  
  // Status Colors - Modern, vibrant
  success: '#059669',           // Emerald-600
  error: '#DC2626',             // Red-600
  info: '#0284C7',              // Sky-600
  lowStock: '#D97706',          // Amber-600
  
  // Colorful Box Colors - Premium gradient-ready
  boxPurple: '#7C3AED',         // Violet-600
  boxBlue: '#2563EB',           // Blue-600
  boxGreen: '#059669',          // Emerald-600
  boxOrange: '#EA580C',         // Orange-600
  boxPink: '#DB2777',           // Pink-600
  boxTeal: '#0891B2',           // Cyan-600
  boxIndigo: '#4F46E5',         // Indigo-600
  boxRed: '#DC2626',            // Red-600
  boxYellow: '#CA8A04',         // Yellow-600
  boxLime: '#65A30D',           // Lime-600
};

// Dark Mode Colors - Premium dark theme
export const darkColors = {
  // Primary Colors - Bright accents on dark
  primary: '#38BDF8',           // Sky-400 (bright on dark)
  primaryLight: '#7DD3FC',      // Sky-300
  primaryDark: '#0EA5E9',       // Sky-500
  
  secondary: '#22D3EE',         // Cyan-400
  secondaryLight: '#67E8F9',    // Cyan-300
  secondaryDark: '#06B6D4',     // Cyan-500
  
  // Accent Colors - Vivid for dark mode
  accent: '#34D399',            // Emerald-400
  warning: '#FBBF24',           // Amber-400
  danger: '#F87171',            // Red-400
  
  // Neutral Colors - Premium dark with blue undertone
  background: '#0F172A',        // Slate-900 (rich dark)
  backgroundLight: '#1E293B',   // Slate-800
  surface: '#1E293B',           // Slate-800 for cards
  surfaceAlt: '#334155',        // Slate-700
  
  // Text Colors - Excellent contrast
  textPrimary: '#F1F5F9',       // Slate-100
  textSecondary: '#CBD5E1',     // Slate-300
  textLight: '#94A3B8',         // Slate-400
  textWhite: '#FFFFFF',
  
  // UI States
  border: '#334155',            // Slate-700
  borderLight: '#1E293B',       // Slate-800
  borderDark: '#475569',        // Slate-600
  disabled: '#475569',
  overlay: 'rgba(0, 0, 0, 0.8)',
  
  // Status Colors - Bright for dark mode
  success: '#34D399',           // Emerald-400
  error: '#F87171',             // Red-400
  info: '#60A5FA',              // Blue-400
  lowStock: '#FBBF24',          // Amber-400
  
  // Colorful Box Colors (vivid for dark mode)
  boxPurple: '#A78BFA',         // Violet-400
  boxBlue: '#60A5FA',           // Blue-400
  boxGreen: '#34D399',          // Emerald-400
  boxOrange: '#FB923C',         // Orange-400
  boxPink: '#F472B6',           // Pink-400
  boxTeal: '#22D3EE',           // Cyan-400
  boxIndigo: '#818CF8',         // Indigo-400
  boxRed: '#F87171',            // Red-400
  boxYellow: '#FBBF24',         // Amber-400
  boxLime: '#A3E635',           // Lime-400
};

// Default to light colors
export const colors = lightColors;

// Function to get colors based on theme
export const getColors = (isDarkMode) => isDarkMode ? darkColors : lightColors;

export const gradients = {
  // Premium gradients with sophisticated color combinations
  primary: ['#0A192F', '#1E3A5F'],           // Deep navy gradient
  secondary: ['#0EA5E9', '#38BDF8'],          // Sky blue gradient
  
  // Colorful box gradients - premium pairs
  purpleBox: ['#7C3AED', '#A78BFA'],          // Violet gradient
  blueBox: ['#2563EB', '#60A5FA'],            // Blue gradient
  greenBox: ['#059669', '#34D399'],           // Emerald gradient
  orangeBox: ['#EA580C', '#FB923C'],          // Orange gradient
  pinkBox: ['#DB2777', '#F472B6'],            // Pink gradient
  tealBox: ['#0891B2', '#22D3EE'],            // Cyan gradient
  indigoBox: ['#4F46E5', '#818CF8'],          // Indigo gradient
  redBox: ['#DC2626', '#F87171'],             // Red gradient
  yellowBox: ['#D97706', '#FBBF24'],          // Amber gradient
  limeBox: ['#65A30D', '#A3E635'],            // Lime gradient
  
  // Special gradients
  premium: ['#0F172A', '#1E293B'],            // Dark premium
  glass: ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.05)'], // Glass effect
  success: ['#059669', '#10B981'],            // Success gradient
  danger: ['#DC2626', '#EF4444'],             // Danger gradient
  
  // Header gradients
  headerLight: ['#0A192F', '#1E3A5F'],        // Light mode header
  headerDark: ['#0F172A', '#1E293B'],         // Dark mode header
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
};

export const borderRadius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  pill: 999,
};

export const typography = {
  // Font Sizes - refined scale (nested for component compatibility)
  sizes: {
    xxs: 10,
    xs: 12,
    sm: 14,
    base: 16,
    md: 16, // alias for base
    lg: 18,
    xl: 20,
    xxl: 24,
    xxxl: 30,
    display: 36,
    hero: 48,
  },
  
  // Font Weights (nested for component compatibility)
  weights: {
    light: '300',
    regular: '400',
    medium: '500',
    semiBold: '600', // camelCase for component compatibility
    semibold: '600', // lowercase for backward compatibility
    bold: '700',
    extrabold: '800',
  },
  
  // Line Heights
  lineHeights: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
  
  // Flat properties for backward compatibility
  xxs: 10,
  xs: 12,
  sm: 14,
  base: 16,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  xxxl: 30,
  display: 36,
  hero: 48,
  light: '300',
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  tight: 1.2,
  normal: 1.5,
  relaxed: 1.75,
};

export const shadows = {
  // Subtle shadow
  xs: {
    shadowColor: '#0A192F',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  // Small shadow
  sm: {
    shadowColor: '#0A192F',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  // Medium shadow
  md: {
    shadowColor: '#0A192F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  // Large shadow
  lg: {
    shadowColor: '#0A192F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  // Extra large shadow
  xl: {
    shadowColor: '#0A192F',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 12,
  },
  // Card shadow - subtle lift
  card: {
    shadowColor: '#0A192F',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  // Floating element shadow
  floating: {
    shadowColor: '#0A192F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  // Colored shadow (primary)
  primary: {
    shadowColor: '#0EA5E9',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  // Success glow
  success: {
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  // Danger glow
  danger: {
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  // Inner shadow effect (for pressed states)
  inner: {
    shadowColor: '#0A192F',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 0,
  },
  // No shadow
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
};

// Common component styles - Premium design system
export const commonStyles = {
  // Container with clean background
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  
  // Safe area padding
  safeArea: {
    flex: 1,
    paddingTop: spacing.xxl + 10,
  },
  
  // Content wrapper with padding
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  
  // Header - premium styling
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 24,
    paddingBottom: spacing.xl,
    alignItems: 'center',
  },
  
  headerTitle: {
    fontSize: typography.display,
    fontWeight: typography.bold,
    color: colors.textWhite,
    marginBottom: spacing.xs,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  
  headerSubtitle: {
    fontSize: typography.lg,
    fontWeight: typography.medium,
    color: colors.textWhite,
    opacity: 0.9,
    textAlign: 'center',
  },
  
  // Cards - Premium card styling
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  
  // Elevated card
  cardElevated: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.floating,
  },
  
  // Colorful gradient card
  cardGradient: {
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...shadows.lg,
  },
  
  cardTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: colors.textWhite,
    marginBottom: spacing.xs,
    letterSpacing: -0.3,
  },
  
  cardDescription: {
    fontSize: typography.base,
    color: colors.textWhite,
    opacity: 0.9,
    lineHeight: 24,
  },
  
  // Section styling
  section: {
    marginBottom: spacing.xl,
  },
  
  sectionTitle: {
    fontSize: typography.lg,
    fontWeight: typography.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.md,
    letterSpacing: -0.3,
  },
  
  // Buttons - Premium styling
  primaryButton: {
    backgroundColor: colors.secondary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.primary,
  },
  
  primaryButtonText: {
    color: colors.textWhite,
    fontSize: typography.base,
    fontWeight: typography.bold,
    letterSpacing: 0.3,
  },
  
  secondaryButton: {
    backgroundColor: 'transparent',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.secondary,
  },
  
  secondaryButtonText: {
    color: colors.secondary,
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  
  dangerButton: {
    backgroundColor: colors.danger,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.danger,
  },
  
  dangerButtonText: {
    color: colors.textWhite,
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  
  // Ghost button
  ghostButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  ghostButtonText: {
    color: colors.secondary,
    fontSize: typography.base,
    fontWeight: typography.semibold,
  },
  
  // Input Fields - Premium styling
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.base,
    color: colors.textPrimary,
  },
  
  inputFocused: {
    borderColor: colors.secondary,
    borderWidth: 2,
  },
  
  inputLabel: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    letterSpacing: 0.2,
  },
  
  inputError: {
    borderColor: colors.error,
    borderWidth: 2,
  },
  
  // Badges
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: borderRadius.pill,
    alignSelf: 'flex-start',
  },
  
  badgeText: {
    fontSize: typography.xs,
    fontWeight: typography.bold,
    color: colors.textWhite,
  },
  
  // Divider
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  
  // Row layout
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  
  // Empty state
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
  },
  
  emptyStateText: {
    fontSize: typography.lg,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  
  // Language Button
  languageButton: {
    position: 'absolute',
    top: spacing.xxl,
    right: spacing.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  
  languageButtonText: {
    color: colors.textWhite,
    fontSize: typography.sm,
    fontWeight: typography.bold,
  },
  
  // Modal styling
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xxl,
    padding: spacing.xl,
    width: '90%',
    maxWidth: 400,
    ...shadows.floating,
  },
  
  modalTitle: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    color: colors.textPrimary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
};

export default {
  colors,
  gradients,
  spacing,
  borderRadius,
  typography,
  shadows,
  commonStyles,
};