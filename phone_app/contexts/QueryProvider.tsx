import { useEffect, type ReactNode } from 'react';
import NetInfo from '@react-native-community/netinfo';
import {
  QueryClientProvider,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import { AppState } from 'react-native';

import { queryClient } from '../lib/query/client';
import {
  releaseEncryptedQueryPersistence,
  startEncryptedQueryPersistence,
} from '../lib/query/persistence';
import { logger } from '../utils/logger';
import { useSession } from './SessionContext';
import { useTenant } from './TenantContext';

function belongsToUser(queryKey: readonly unknown[], uid: string): boolean {
  return queryKey[0] === 'tenant' && queryKey[1] === uid;
}

async function evictUserQueries(uid: string): Promise<void> {
  const predicate = (query: { readonly queryKey: readonly unknown[] }) => (
    belongsToUser(query.queryKey, uid)
  );
  await queryClient.cancelQueries({ predicate });
  queryClient.removeQueries({ predicate });
}

async function evictTenantQueries(uid: string, companyId: number): Promise<void> {
  const predicate = (query: { readonly queryKey: readonly unknown[] }) => (
    belongsToUser(query.queryKey, uid) && query.queryKey[2] === companyId
  );
  await queryClient.cancelQueries({ predicate });
  queryClient.removeQueries({ predicate });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const { workspace } = useTenant();
  const uid = user?.id ?? null;
  const companyId = workspace?.companyId ?? null;
  useEffect(() => {
    onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    }));
    focusManager.setEventListener((setFocused) => {
      const subscription = AppState.addEventListener('change', (state) => {
        setFocused(state === 'active');
      });
      return () => subscription.remove();
    });
  }, []);

  // This identity-level cleanup also covers auth loss before a workspace has
  // been selected, when the preference store may exist without persistence.
  useEffect(() => {
    if (!uid) {
      return;
    }
    return () => {
      void evictUserQueries(uid);
      void releaseEncryptedQueryPersistence(uid);
    };
  }, [uid]);

  useEffect(() => {
    if (!uid || !companyId) {
      return;
    }
    let active = true;
    let cleanup: (() => void) | null = null;
    const persistence = startEncryptedQueryPersistence({
      queryClient,
      uid,
      companyId,
    });
    void persistence.then((stop) => {
      if (!active) {
        return;
      }
      cleanup = stop;
    }).catch((error: unknown) => {
      logger.error('Encrypted query persistence failed', error);
    });
    return () => {
      active = false;
      void evictTenantQueries(uid, companyId);
      if (cleanup) {
        cleanup();
        void releaseEncryptedQueryPersistence(uid);
        return;
      }
      void persistence
        .then((stop) => stop())
        .catch(() => undefined)
        .finally(() => releaseEncryptedQueryPersistence(uid));
    };
  }, [companyId, uid]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
