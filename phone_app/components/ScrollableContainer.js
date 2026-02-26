import React, { forwardRef, useCallback } from 'react';
import { ScrollView } from 'react-native';
import { useScrollHandler } from '../contexts/HeaderContext';

const ScrollableContainer = forwardRef(function ScrollableContainer(
  {
    children,
    onScroll,
    scrollEventThrottle = 16,
    keyboardShouldPersistTaps = 'always',
    keyboardDismissMode = 'none',
    ...props
  },
  ref
) {
  const { onScroll: headerOnScroll } = useScrollHandler();

  const handleScroll = useCallback(
    (event) => {
      headerOnScroll(event);
      onScroll?.(event);
    },
    [headerOnScroll, onScroll]
  );

  return (
    <ScrollView
      ref={ref}
      {...props}
      onScroll={handleScroll}
      scrollEventThrottle={scrollEventThrottle}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      keyboardDismissMode={keyboardDismissMode}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
});

export default ScrollableContainer;
