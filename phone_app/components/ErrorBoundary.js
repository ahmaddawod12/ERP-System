import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderRadius, getColors, shadows, spacing, typography } from '../theme';

const palette = getColors(false);

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected app error.',
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
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
          <Text style={[styles.title, { color: palette.error }]}>Something went wrong</Text>
          <Text style={[styles.message, { color: palette.textSecondary }]}>{this.state.errorMessage}</Text>
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
            <Text style={styles.buttonText}>Try again</Text>
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
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    letterSpacing: -0.2,
  },
  message: {
    marginBottom: spacing.sm,
    fontSize: typography.base,
    lineHeight: 22,
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
  buttonText: {
    color: '#FFFFFF',
    fontWeight: typography.semibold,
    fontSize: typography.base,
  },
});
