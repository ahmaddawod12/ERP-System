import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import {
  resolveResponsiveLayout,
  type ResponsiveLayout,
} from '../lib/layout/responsive';

export { resolveResponsiveLayout, type ResponsiveLayout } from '../lib/layout/responsive';

export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();
  return useMemo(() => resolveResponsiveLayout(width, height), [height, width]);
}
