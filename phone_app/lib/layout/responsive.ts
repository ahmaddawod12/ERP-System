export interface ResponsiveLayout {
  width: number;
  height: number;
  isLandscape: boolean;
  isTablet: boolean;
  isWide: boolean;
  maxContentWidth: number;
  columnCount: 1 | 2;
}

export function resolveResponsiveLayout(width: number, height: number): ResponsiveLayout {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  const isLandscape = safeWidth > safeHeight;
  const isTablet = Math.min(safeWidth, safeHeight) >= 600;
  const isWide = isTablet || (isLandscape && safeWidth >= 640);
  return {
    width: safeWidth,
    height: safeHeight,
    isLandscape,
    isTablet,
    isWide,
    maxContentWidth: isTablet ? 1180 : 900,
    columnCount: safeWidth >= 980 ? 2 : 1,
  };
}
