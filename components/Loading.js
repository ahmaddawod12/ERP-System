import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients } from '../theme';

// Simple animated loading spinner with rotation and pulse
export const LoadingSpinner = ({ size = 50 }) => {
  const spinValue = useRef(new Animated.Value(0)).current;
  const scaleValue = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Rotation animation
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(scaleValue, {
          toValue: 1.2,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scaleValue, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      style={[
        styles.spinnerContainer,
        {
          width: size,
          height: size,
          transform: [{ rotate: spin }, { scale: scaleValue }],
        },
      ]}
    >
      <View
        style={[
          styles.spinner,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: size / 10,
            borderTopColor: colors.secondary,
            borderRightColor: colors.secondary,
            borderBottomColor: 'transparent',
            borderLeftColor: 'transparent',
          },
        ]}
      />
    </Animated.View>
  );
};

// Full-screen loader with multiple rotating rings and animated dots
export const FullScreenLoader = () => {
  const rotateValue = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in animation
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    // Rotation animation
    Animated.loop(
      Animated.timing(rotateValue, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // Dot animations with staggered timing
    const animateDot = (dotValue, delay) => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dotValue, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dotValue, {
            toValue: 0,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    };

    animateDot(dot1, 0);
    animateDot(dot2, 200);
    animateDot(dot3, 400);
  }, []);

  const rotate = rotateValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const rotateReverse = rotateValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['360deg', '0deg'],
  });

  return (
    <Animated.View style={[styles.fullScreenContainer, { opacity: fadeAnim }]}>
      <LinearGradient
        colors={[colors.primary + '20', colors.secondary + '20']}
        style={styles.gradientOverlay}
      >
        <View style={styles.loaderContent}>
          {/* Outer rotating ring */}
          <Animated.View
            style={[
              styles.outerRing,
              {
                transform: [{ rotate }],
              },
            ]}
          />

          {/* Middle rotating ring (reverse direction) */}
          <Animated.View
            style={[
              styles.middleRing,
              {
                transform: [{ rotate: rotateReverse }],
              },
            ]}
          />

          {/* Inner rotating circle */}
          <Animated.View
            style={[
              styles.innerCircle,
              {
                transform: [{ rotate }],
              },
            ]}
          />

          {/* Animated dots */}
          <View style={styles.dotsContainer}>
            <Animated.View
              style={[
                styles.dot,
                {
                  opacity: dot1.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.3, 1],
                  }),
                  transform: [
                    {
                      scale: dot1.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.5, 1],
                      }),
                    },
                  ],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.dot,
                {
                  opacity: dot2.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.3, 1],
                  }),
                  transform: [
                    {
                      scale: dot2.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.5, 1],
                      }),
                    },
                  ],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.dot,
                {
                  opacity: dot3.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.3, 1],
                  }),
                  transform: [
                    {
                      scale: dot3.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.5, 1],
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>
        </View>
      </LinearGradient>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  spinnerContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinner: {
    borderStyle: 'solid',
  },
  fullScreenContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
  },
  gradientOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  loaderContent: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 150,
    height: 150,
  },
  outerRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderTopColor: 'white',
    borderRightColor: 'white',
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
  },
  middleRing: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'white',
    borderLeftColor: 'white',
  },
  innerCircle: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.secondary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 100,
    gap: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'white',
  },
});
