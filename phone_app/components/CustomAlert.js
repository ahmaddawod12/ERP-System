import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Animated,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { getColors, gradients, spacing, borderRadius, typography, shadows } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';

const { width } = Dimensions.get('window');

export default function CustomAlert({
  visible,
  type = 'info', // 'info', 'success', 'waiting', 'error', 'failed', 'confirm'
  title,
  message,
  buttons = [],
  onDismiss,
  icon,
}) {
  const { isDarkMode } = useThemeContext();
  const colors = getColors(isDarkMode);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const getIconConfig = () => {
    if (icon) return icon;
    
    switch (type) {
      case 'success':
        return { name: 'checkmark', color: '#FFFFFF', library: 'Ionicons' };
      case 'error':
      case 'failed':
        return { name: 'close', color: '#FFFFFF', library: 'Ionicons' };
      case 'waiting':
        return { name: 'warning', color: '#FFFFFF', library: 'Ionicons' };
      case 'confirm':
        return { name: 'alert-circle', color: '#FFFFFF', library: 'Ionicons' };
      default:
        return { name: 'information-circle', color: '#3b82f6', library: 'Ionicons' };
    }
  };

  const getGradient = () => {
    switch (type) {
      case 'success':
        return ['#4ade80', '#22c55e']; // Clean bright green
      case 'error':
      case 'failed':
        return ['#f87171', '#ef4444']; // Clean bright red
      case 'waiting':
        return ['#fbbf24', '#f59e0b']; // Clean bright amber
      case 'confirm':
        return ['#f87171', '#ef4444']; // Red for confirmations (destructive actions)
      default:
        return ['#60a5fa', '#3b82f6']; // Clean blue
    }
  };

  const iconConfig = getIconConfig();
  const IconComponent = iconConfig.library === 'MaterialCommunityIcons' 
    ? MaterialCommunityIcons 
    : Ionicons;

  const defaultButtons = buttons.length > 0 ? buttons : [
    {
      text: 'OK',
      onPress: () => {
        if (onDismiss) onDismiss();
      },
      style: 'primary'
    }
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => {
        if (onDismiss) onDismiss();
      }}
    >
      <Animated.View 
        style={[
          styles.overlay,
          {
            opacity: fadeAnim,
          }
        ]}
      >
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={() => {
            if (onDismiss) onDismiss();
          }}
        />
        
        <Animated.View
          style={[
            styles.alertContainer,
            {
              transform: [
                { scale: scaleAnim },
                {
                  translateY: scaleAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [50, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={[styles.alertCard, { backgroundColor: colors.surface }]}>
            {/* Icon Header with Gradient */}
            <LinearGradient
              colors={getGradient()}
              style={styles.iconHeader}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <View style={styles.iconCircle}>
                <IconComponent 
                  name={iconConfig.name} 
                  size={52} 
                  color="white"
                  style={{ fontWeight: 'bold' }}
                />
              </View>
            </LinearGradient>

            {/* Content */}
            <View style={styles.contentContainer}>
              {title && (
                <Text style={[styles.title, { color: colors.textPrimary }]}>
                  {title}
                </Text>
              )}
              {message && (
                <Text style={[styles.message, { color: colors.textSecondary }]}>
                  {message}
                </Text>
              )}
            </View>

            {/* Buttons */}
            <View style={[
              styles.buttonsContainer,
              defaultButtons.length === 3 && styles.buttonsContainerColumn
            ]}>
              {defaultButtons.map((button, index) => {
                const isDestructive = button.style === 'destructive';
                const isCancel = button.style === 'cancel';
                const isPrimary = button.style === 'primary' || button.style === 'default';
                
                let buttonGradient = ['#3b82f6', '#2563eb']; // Clean blue
                if (isDestructive) buttonGradient = ['#ef4444', '#dc2626']; // Clean red
                if (isCancel) buttonGradient = ['#6b7280', '#4b5563']; // Clean gray
                
                return (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.button,
                      defaultButtons.length === 1 && styles.buttonSingle,
                      defaultButtons.length === 2 && styles.buttonHalf,
                      defaultButtons.length === 3 && styles.buttonThird,
                      defaultButtons.length === 2 && index === 0 && styles.buttonBorderRight,
                      defaultButtons.length === 3 && index < 2 && styles.buttonBorderBottom,
                    ]}
                    onPress={() => {
                      if (button.onPress) button.onPress();
                      // Always dismiss the alert after button press
                      if (onDismiss) onDismiss();
                    }}
                    activeOpacity={0.8}
                  >
                    <LinearGradient
                      colors={buttonGradient}
                      style={styles.buttonGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                    >
                      <Text style={styles.buttonText}>{button.text}</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                );
              })}
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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTouchable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  alertContainer: {
    width: width - spacing.xl * 2,
    maxWidth: 380,
  },
  alertCard: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 15,
  },
  iconHeader: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  contentContainer: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.sm,
    letterSpacing: -0.3,
  },
  message: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 21,
    opacity: 0.8,
    fontWeight: '400',
  },
  buttonsContainer: {
    flexDirection: 'row',
    borderTopWidth: 0,
  },
  buttonsContainerColumn: {
    flexDirection: 'column',
  },
  button: {
    overflow: 'hidden',
  },
  buttonSingle: {
    flex: 1,
  },
  buttonHalf: {
    flex: 1,
  },
  buttonBorderRight: {
    borderRightWidth: 1,
    borderRightColor: 'rgba(255, 255, 255, 0.15)',
  },
  buttonThird: {
    width: '100%',
  },
  buttonBorderBottom: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
  },
  buttonGradient: {
    paddingVertical: spacing.md + 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
