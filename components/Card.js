/**
 * Reusable Card Component for Smart-Job App
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors as defaultColors, spacing, borderRadius, typography, shadows } from '../theme';

export const Card = ({ 
  children, 
  style, 
  onPress,
  elevated = true,
  colors = defaultColors
}) => {
  const Component = onPress ? TouchableOpacity : View;
  
  return (
    <Component
      style={[
        { 
          backgroundColor: colors.surface, 
          borderRadius: borderRadius.xl, 
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
        },
        elevated && shadows.card,
        style
      ]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      {children}
    </Component>
  );
};

export const CardHeader = ({ title, subtitle, action, style, colors = defaultColors }) => {
  return (
    <View style={[styles.cardHeader, { borderBottomColor: colors.borderLight }, style]}>
      <View style={styles.cardHeaderText}>
        {title && <Text style={[styles.cardTitle, { color: colors.primary }]}>{title}</Text>}
        {subtitle && <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>}
      </View>
      {action && <View>{action}</View>}
    </View>
  );
};

export const CardContent = ({ children, style }) => {
  return <View style={[styles.cardContent, style]}>{children}</View>;
};

export const CardFooter = ({ children, style, colors = defaultColors }) => {
  return <View style={[styles.cardFooter, { borderTopColor: colors.borderLight }, style]}>{children}</View>;
};

const styles = StyleSheet.create({
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
  },
  cardHeaderText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    marginBottom: spacing.xs,
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontSize: typography.sm,
    letterSpacing: 0.2,
  },
  cardContent: {
    padding: spacing.lg,
  },
  cardFooter: {
    padding: spacing.lg,
    borderTopWidth: 1,
  },
});
