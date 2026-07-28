/**
 * useAppStateListener Hook
 * 
 * Monitors app state (active, background, inactive) and provides callbacks
 * to pause/resume backend sync work to prevent background reads.
 * 
 * CRITICAL for Android: When app is backgrounded or swiped away, listeners
 * should be paused to prevent excessive backend reads.
 * 
 * @example
 * ```javascript
 * useAppStateListener({
 *   onBackground: () => {
 *     logger.debug('App backgrounded - pause listeners');
 *     if (unsubscribeRef.current) {
 *       unsubscribeRef.current();
 *       unsubscribeRef.current = null;
 *     }
 *   },
 *   onActive: () => {
 *     logger.debug('App active - resume listeners');
 *     setupListeners();
 *   }
 * });
 * ```
 */

import { useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { logger } from '../utils/logger';

export interface AppStateListenerCallbacks {
  onActive?: () => void;
  onBackground?: () => void;
  onInactive?: () => void;
}

export function useAppStateListener({ onActive, onBackground, onInactive }: AppStateListenerCallbacks): AppStateStatus {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const callbacksRef = useRef<AppStateListenerCallbacks>({ onActive, onBackground, onInactive });

  // Update callbacks ref when they change (avoid stale closures)
  useEffect(() => {
    callbacksRef.current = { onActive, onBackground, onInactive };
  }, [onActive, onBackground, onInactive]);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const previousState = appStateRef.current;
      
      logger.debug(`📱 AppState changed: ${previousState} → ${nextAppState}`);

      // App went from background/inactive to active (user returned to app)
      if (
        (previousState === 'background' || previousState === 'inactive') &&
        nextAppState === 'active'
      ) {
        logger.debug('✅ App became active - resume listeners');
        if (callbacksRef.current.onActive) {
          callbacksRef.current.onActive();
        }
      }

      // App went from active to background (user pressed home, swiped away, etc.)
      if (
        previousState === 'active' &&
        (nextAppState === 'background' || nextAppState === 'inactive')
      ) {
        logger.debug('⏸️ App went to background - pause listeners');
        if (callbacksRef.current.onBackground) {
          callbacksRef.current.onBackground();
        }
      }

      // iOS-specific: Inactive state (during phone call, control center, etc.)
      if (Platform.OS === 'ios' && nextAppState === 'inactive') {
        logger.debug('⏸️ App became inactive (iOS) - pause listeners');
        if (callbacksRef.current.onInactive) {
          callbacksRef.current.onInactive();
        }
      }

      appStateRef.current = nextAppState;
    };

    // Subscribe to app state changes
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Log initial state
    logger.debug('📱 Initial AppState:', AppState.currentState);

    // Cleanup
    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, []); // Empty deps - setup once on mount

  return appStateRef.current;
}

export default useAppStateListener;
