import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { borderRadius, getColors, shadows, spacing, typography } from '../../theme';
import AppText from '../primitives/AppText';
import { logger } from '../../utils/logger';

const palette = getColors(false);

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected app error.',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('ErrorBoundary caught error:', error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <View style={[styles.container, { backgroundColor: palette.background }]}>
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <AppText variant="title" color={palette.error}>Something went wrong</AppText>
          <AppText variant="body" color={palette.textSecondary} style={styles.message}>{this.state.errorMessage}</AppText>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: palette.secondary,
                borderColor: palette.secondaryDark,
                opacity: pressed ? 0.86 : 1,
              },
            ]}
            onPress={this.resetError}
          >
            <AppText variant="bodyStrong" color="#FFFFFF">Try again</AppText>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    borderWidth: 1.2,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  title: {
    // Handled by AppText variant="title"
  },
  message: {
    marginBottom: spacing.sm,
  },
  button: {
    minHeight: 48,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    ...shadows.primary,
  },
});
