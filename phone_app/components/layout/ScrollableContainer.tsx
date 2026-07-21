import React, { forwardRef, useCallback } from 'react';
import { ScrollView, type NativeSyntheticEvent, type NativeScrollEvent, type ScrollViewProps } from 'react-native';
import { useScrollHandler } from '../../contexts/HeaderContext';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';

export interface ScrollableContainerProps extends ScrollViewProps {
  children?: React.ReactNode;
}

const ScrollableContainer = forwardRef<ScrollView, ScrollableContainerProps>(function ScrollableContainer(
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
  const responsive = useResponsiveLayout();

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
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
      contentContainerStyle={[
        responsive.isWide && {
          alignSelf: 'center',
          width: '100%',
          maxWidth: responsive.maxContentWidth,
        },
        props.contentContainerStyle,
      ]}
    >
      {children}
    </ScrollView>
  );
});

export default ScrollableContainer;
