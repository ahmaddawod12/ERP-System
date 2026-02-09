/**
 * Error Boundary Component for Smart-Job App
 * Catches JavaScript errors and displays fallback UI
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../theme';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  handleReset = () => {
    this.setState({ 
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <Text style={styles.title}>😕 Oops!</Text>
            <Text style={styles.message}>
              Something went wrong. We've been notified and are working on it.
            </Text>
            
            {__DEV__ && this.state.error && (
              <View style={styles.errorDetails}>
                <Text style={styles.errorTitle}>Error Details:</Text>
                <Text style={styles.errorText}>
                  {this.state.error.toString()}
                </Text>
                {this.state.errorInfo && (
                  <Text style={styles.stackTrace}>
                    {this.state.errorInfo.componentStack}
                  </Text>
                )}
              </View>
            )}

            <TouchableOpacity
              style={styles.button}
              onPress={this.handleReset}
            >
              <Text style={styles.buttonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    maxWidth: 400,
    width: '100%',
  },
  title: {
    fontSize: typography.xxxl,
    fontWeight: typography.bold,
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  message: {
    fontSize: typography.base,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: typography.xl,
  },
  errorDetails: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorTitle: {
    fontSize: typography.sm,
    fontWeight: typography.bold,
    color: colors.danger,
    marginBottom: spacing.xs,
  },
  errorText: {
    fontSize: typography.xs,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    fontFamily: 'monospace',
  },
  stackTrace: {
    fontSize: typography.xs,
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: colors.secondary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  buttonText: {
    color: colors.textWhite,
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
});
