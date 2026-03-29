import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { borderRadius, getColors, gradients, shadows, spacing, type ColorPalette } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';
import AppButton from './AppButton';
import AppText from './AppText';
import type { AlertType } from '../types';

interface AlertButton {
  text?: string;
  onPress?: () => void;
  style?: string;
}

interface IconConfig {
  name: string;
  library?: string;
  color?: string;
}

export interface CustomAlertProps {
  visible: boolean;
  type?: AlertType;
  title?: string;
  message?: string;
  buttons?: AlertButton[];
  onDismiss?: () => void;
  icon?: string | IconConfig | null;
}

const resolveVariant = (style: string | undefined): 'primary' | 'destructive' | 'secondary' => {
  if (style === 'destructive') return 'destructive';
  if (style === 'cancel') return 'secondary';
  return 'primary';
};

const resolveTypeGradient = (type: string, palette: ColorPalette): readonly [string, string] => {
  switch (type) {
    case 'success':
      return gradients.success;
    case 'error':
    case 'failed':
    case 'confirm':
      return gradients.danger;
    case 'waiting':
      return [palette.warning, '#B45309'];
    default:
      return gradients.secondary;
  }
};

const resolveIconConfig = (type: string, icon: string | IconConfig | undefined, palette: ColorPalette): { name: string; library: string; color: string } => {
  if (icon) {
    if (typeof icon === 'string') {
      return { name: icon, library: 'Ionicons', color: palette.textWhite };
    }
    return {
      name: icon.name || 'information-circle',
      library: icon.library || 'Ionicons',
      color: icon.color || palette.textWhite,
    };
  }

  switch (type) {
    case 'success':
      return { name: 'checkmark', library: 'Ionicons', color: palette.textWhite };
    case 'error':
    case 'failed':
      return { name: 'close', library: 'Ionicons', color: palette.textWhite };
    case 'waiting':
      return { name: 'warning', library: 'Ionicons', color: palette.textWhite };
    case 'confirm':
      return { name: 'alert-circle', library: 'Ionicons', color: palette.textWhite };
    default:
      return { name: 'information-circle', library: 'Ionicons', color: palette.textWhite };
  }
};

export default function CustomAlert({
  visible,
  type = 'info',
  title,
  message,
  buttons = [],
  onDismiss,
  icon,
}: CustomAlertProps) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.96)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 190,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 80,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.96,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, scaleAnim, visible]);

  const iconConfig = useMemo(
    () => resolveIconConfig(type, icon ?? undefined, palette),
    [icon, palette, type]
  );
  const gradientColors = useMemo(
    () => resolveTypeGradient(type, palette),
    [palette, type]
  );
  const IconSet =
    iconConfig.library === 'MaterialCommunityIcons'
      ? MaterialCommunityIcons
      : Ionicons;

  const resolvedButtons =
    buttons.length > 0
      ? buttons
      : [
          {
            text: 'OK',
            onPress: () => {},
            style: 'primary',
          },
        ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => onDismiss?.()}
    >
      <Animated.View
        style={[
          styles.overlay,
          {
            opacity: fadeAnim,
            backgroundColor: palette.overlaySoft,
          },
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => onDismiss?.()} />

        <Animated.View
          style={[
            styles.alertContainer,
            {
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <View
            style={[
              styles.alertCard,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            <LinearGradient
              colors={gradientColors}
              style={styles.iconHeader}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <View style={styles.iconCircle}>
                <IconSet name={iconConfig.name as any} size={46} color={iconConfig.color} />
              </View>
            </LinearGradient>

            <View style={styles.contentContainer}>
              {title ? (
                <AppText variant="heading" align="center">
                  {title}
                </AppText>
              ) : null}
              {message ? (
                <AppText
                  variant="body"
                  color={palette.textSecondary}
                  align="center"
                  style={title ? styles.messageWithTitle : null}
                >
                  {message}
                </AppText>
              ) : null}
            </View>

            <View
              style={[
                styles.buttonsContainer,
                resolvedButtons.length > 2 ? styles.buttonsColumn : styles.buttonsRow,
              ]}
            >
              {resolvedButtons.map((button, index) => (
                <AppButton
                  key={`${button.text || 'btn'}-${index}`}
                  title={button.text || 'OK'}
                  variant={resolveVariant(button.style)}
                  size="sm"
                  onPress={() => {
                    button.onPress?.();
                    onDismiss?.();
                  }}
                  style={resolvedButtons.length > 2 ? styles.buttonFull : styles.buttonSplit}
                />
              ))}
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  alertContainer: {
    width: '100%',
    maxWidth: 390,
  },
  alertCard: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    ...shadows.floating,
  },
  iconHeader: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentContainer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  messageWithTitle: {
    marginTop: spacing.xs,
  },
  buttonsContainer: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  buttonsRow: {
    flexDirection: 'row',
  },
  buttonsColumn: {
    flexDirection: 'column',
  },
  buttonSplit: {
    flex: 1,
  },
  buttonFull: {
    width: '100%',
  },
});
