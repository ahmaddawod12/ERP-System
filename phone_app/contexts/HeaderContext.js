import React, { createContext, useContext, useRef, useCallback } from 'react';
import { Animated } from 'react-native';

const HeaderContext = createContext(null);

/**
 * HeaderProvider - Global header visibility management
 * Provides animated value for smooth header hide/show on scroll
 */
export function HeaderProvider({ children }) {
  // Animated value for header translation (0 = visible, 1 = hidden)
  const headerAnimatedValue = useRef(new Animated.Value(0)).current;
  
  // Track last scroll position for direction detection
  const lastScrollY = useRef(0);
  
  // Track if header is currently visible
  const isHeaderVisible = useRef(true);
  
  // Threshold values
  const SCROLL_THRESHOLD = 10; // Minimum scroll distance to trigger hide/show
  const TOP_THRESHOLD = 50; // Consider "at top" if scroll is less than this
  
  /**
   * Handle scroll event from any scrollable container
   * @param {number} currentScrollY - Current scroll position
   */
  const handleScroll = useCallback((currentScrollY) => {
    const scrollDiff = currentScrollY - lastScrollY.current;
    
    // At or near the top - always show header
    if (currentScrollY <= TOP_THRESHOLD) {
      if (!isHeaderVisible.current) {
        isHeaderVisible.current = true;
        Animated.spring(headerAnimatedValue, {
          toValue: 0,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }).start();
      }
      lastScrollY.current = currentScrollY;
      return;
    }
    
    // Scrolling down - hide header
    if (scrollDiff > SCROLL_THRESHOLD && isHeaderVisible.current) {
      isHeaderVisible.current = false;
      Animated.spring(headerAnimatedValue, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 10,
      }).start();
    }
    // Scrolling up - show header
    else if (scrollDiff < -SCROLL_THRESHOLD && !isHeaderVisible.current) {
      isHeaderVisible.current = true;
      Animated.spring(headerAnimatedValue, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 10,
      }).start();
    }
    
    lastScrollY.current = currentScrollY;
  }, [headerAnimatedValue]);
  
  /**
   * Reset header to visible state (useful for screen transitions)
   */
  const resetHeader = useCallback(() => {
    isHeaderVisible.current = true;
    lastScrollY.current = 0;
    Animated.spring(headerAnimatedValue, {
      toValue: 0,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();
  }, [headerAnimatedValue]);
  
  /**
   * Force show header immediately
   */
  const showHeader = useCallback(() => {
    if (!isHeaderVisible.current) {
      isHeaderVisible.current = true;
      Animated.spring(headerAnimatedValue, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 10,
      }).start();
    }
  }, [headerAnimatedValue]);
  
  /**
   * Force hide header immediately
   */
  const hideHeader = useCallback(() => {
    if (isHeaderVisible.current) {
      isHeaderVisible.current = false;
      Animated.spring(headerAnimatedValue, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 10,
      }).start();
    }
  }, [headerAnimatedValue]);

  const value = {
    headerAnimatedValue,
    handleScroll,
    resetHeader,
    showHeader,
    hideHeader,
  };

  return (
    <HeaderContext.Provider value={value}>
      {children}
    </HeaderContext.Provider>
  );
}

/**
 * Hook to access header context
 * @returns {Object} Header context value
 */
export function useHeader() {
  const context = useContext(HeaderContext);
  if (!context) {
    throw new Error('useHeader must be used within a HeaderProvider');
  }
  return context;
}

/**
 * Get scroll event handler props for ScrollView/FlatList
 * Use this to easily integrate scroll-based header behavior
 * 
 * @example
 * const { scrollProps } = useScrollHandler();
 * <ScrollView {...scrollProps}>
 */
export function useScrollHandler() {
  const { handleScroll } = useHeader();
  
  const onScroll = useCallback((event) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    handleScroll(offsetY);
  }, [handleScroll]);
  
  return {
    scrollProps: {
      onScroll,
      scrollEventThrottle: 16,
    },
    onScroll,
  };
}
