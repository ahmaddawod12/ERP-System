/**
 * useNetworkStatus Hook
 *
 * Monitors network connectivity using @react-native-community/netinfo.
 * Provides `isConnected` boolean and an `isInternetReachable` flag.
 *
 * Usage:
 *   const { isConnected, isInternetReachable } = useNetworkStatus();
 */

import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: true,
  });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setStatus({
        isConnected: state.isConnected ?? true,
        isInternetReachable: state.isInternetReachable ?? true,
      });
    });

    return () => unsubscribe();
  }, []);

  return status;
}
