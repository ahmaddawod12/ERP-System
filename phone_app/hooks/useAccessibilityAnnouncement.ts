import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useAccessibilityAnnouncement(
  message: string | null | undefined,
  enabled = true,
): void {
  const previousMessage = useRef<string | null>(null);

  useEffect(() => {
    const normalized = String(message || '').trim();
    if (!enabled || !normalized || normalized === previousMessage.current) return;
    previousMessage.current = normalized;
    const timer = setTimeout(() => {
      AccessibilityInfo.announceForAccessibility(normalized);
    }, 100);
    return () => clearTimeout(timer);
  }, [enabled, message]);
}
