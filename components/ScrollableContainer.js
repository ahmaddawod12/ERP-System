import React, { useCallback, forwardRef } from 'react';
import { ScrollView, FlatList, SectionList, Animated } from 'react-native';
import { useHeader } from '../contexts/HeaderContext';

/**
 * ScrollableContainer - Wrapper for ScrollView with automatic header hide/show
 * Drop-in replacement for ScrollView that integrates with HeaderContext
 */
export const ScrollableContainer = forwardRef(({ 
  children, 
  onScroll: externalOnScroll,
  scrollEventThrottle = 16,
  ...props 
}, ref) => {
  const { handleScroll } = useHeader();
  
  const handleScrollEvent = useCallback((event) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    handleScroll(offsetY);
    
    // Call external onScroll handler if provided
    if (externalOnScroll) {
      externalOnScroll(event);
    }
  }, [handleScroll, externalOnScroll]);
  
  return (
    <ScrollView
      ref={ref}
      onScroll={handleScrollEvent}
      scrollEventThrottle={scrollEventThrottle}
      {...props}
    >
      {children}
    </ScrollView>
  );
});

ScrollableContainer.displayName = 'ScrollableContainer';

/**
 * ScrollableFlatList - Wrapper for FlatList with automatic header hide/show
 * Drop-in replacement for FlatList that integrates with HeaderContext
 */
export const ScrollableFlatList = forwardRef(({ 
  onScroll: externalOnScroll,
  scrollEventThrottle = 16,
  ...props 
}, ref) => {
  const { handleScroll } = useHeader();
  
  const handleScrollEvent = useCallback((event) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    handleScroll(offsetY);
    
    // Call external onScroll handler if provided
    if (externalOnScroll) {
      externalOnScroll(event);
    }
  }, [handleScroll, externalOnScroll]);
  
  return (
    <FlatList
      ref={ref}
      onScroll={handleScrollEvent}
      scrollEventThrottle={scrollEventThrottle}
      {...props}
    />
  );
});

ScrollableFlatList.displayName = 'ScrollableFlatList';

/**
 * ScrollableSectionList - Wrapper for SectionList with automatic header hide/show
 * Drop-in replacement for SectionList that integrates with HeaderContext
 */
export const ScrollableSectionList = forwardRef(({ 
  onScroll: externalOnScroll,
  scrollEventThrottle = 16,
  ...props 
}, ref) => {
  const { handleScroll } = useHeader();
  
  const handleScrollEvent = useCallback((event) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    handleScroll(offsetY);
    
    // Call external onScroll handler if provided
    if (externalOnScroll) {
      externalOnScroll(event);
    }
  }, [handleScroll, externalOnScroll]);
  
  return (
    <SectionList
      ref={ref}
      onScroll={handleScrollEvent}
      scrollEventThrottle={scrollEventThrottle}
      {...props}
    />
  );
});

ScrollableSectionList.displayName = 'ScrollableSectionList';

/**
 * AnimatedScrollableContainer - Animated.ScrollView with automatic header hide/show
 * Use when you need Animated.event for other animations
 */
export const AnimatedScrollableContainer = forwardRef(({ 
  children, 
  onScroll: externalOnScroll,
  scrollEventThrottle = 16,
  ...props 
}, ref) => {
  const { handleScroll } = useHeader();
  
  const handleScrollEvent = useCallback((event) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    handleScroll(offsetY);
    
    // Call external onScroll handler if provided
    if (externalOnScroll) {
      externalOnScroll(event);
    }
  }, [handleScroll, externalOnScroll]);
  
  return (
    <Animated.ScrollView
      ref={ref}
      onScroll={handleScrollEvent}
      scrollEventThrottle={scrollEventThrottle}
      {...props}
    >
      {children}
    </Animated.ScrollView>
  );
});

AnimatedScrollableContainer.displayName = 'AnimatedScrollableContainer';
