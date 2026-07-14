import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import {
  UserOutboxDatabase,
  type OutboxOperation,
} from '../lib/outbox/database';
import { discardOutboxOperation } from '../lib/outbox/operations';
import {
  outcomeForOutboxStatus,
  synchronizeOutbox,
  waitForActiveOutboxSynchronization,
  type OutboxOperationResult,
  type OutboxSynchronizationResult,
} from '../lib/outbox/processor';
import { queryClient } from '../lib/query/client';
import { logger } from '../utils/logger';
import { useSession } from './SessionContext';

interface OutboxContextValue {
  readonly ready: boolean;
  readonly syncing: boolean;
  readonly operations: readonly OutboxOperation[];
  readonly synchronize: () => Promise<OutboxSynchronizationResult>;
  readonly synchronizeOperation: (operationId: string) => Promise<OutboxOperationResult>;
  readonly retry: (operationId: string) => Promise<OutboxOperationResult>;
  readonly refresh: () => Promise<void>;
  readonly discard: (operationId: string) => Promise<void>;
  readonly database: UserOutboxDatabase | null;
}

const EMPTY_SYNCHRONIZATION_RESULT: OutboxSynchronizationResult = { operations: [] };
const OutboxContext = createContext<OutboxContextValue | null>(null);

function closeAfterActiveSynchronization(database: UserOutboxDatabase): void {
  void waitForActiveOutboxSynchronization(database)
    .catch(() => undefined)
    .then(() => database.close())
    .catch(() => undefined);
}

function invalidateUserJobQueries(userId: string): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => (
      query.queryKey[0] === 'tenant'
      && query.queryKey[1] === userId
      && query.queryKey[3] === 'jobs'
    ),
  });
}

function resultFromOperation(operation: OutboxOperation): OutboxOperationResult {
  return {
    operationId: operation.id,
    outcome: outcomeForOutboxStatus(operation.status),
    ...(operation.lastErrorCode ? { errorCode: operation.lastErrorCode } : {}),
    ...(operation.lastErrorMessage ? { errorMessage: operation.lastErrorMessage } : {}),
  };
}

export function OutboxProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const databaseRef = useRef<UserOutboxDatabase | null>(null);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [operations, setOperations] = useState<readonly OutboxOperation[]>([]);

  const refreshDatabase = useCallback(async (database: UserOutboxDatabase): Promise<void> => {
    const nextOperations = await database.listOperations();
    if (databaseRef.current === database) {
      setOperations(nextOperations);
    }
  }, []);

  const refresh = useCallback(async () => {
    const database = databaseRef.current;
    if (!database) {
      setOperations([]);
      return;
    }
    await refreshDatabase(database);
  }, [refreshDatabase]);

  const runSynchronization = useCallback(async (
    database: UserOutboxDatabase,
  ): Promise<OutboxSynchronizationResult> => {
    setSyncing(true);
    try {
      const result = await synchronizeOutbox(database);
      await refreshDatabase(database).catch((error) => {
        logger.warn('Pending-work state could not be refreshed after synchronization:', error);
      });
      if (userId) {
        void invalidateUserJobQueries(userId).catch(() => undefined);
      }
      return result;
    } catch (error) {
      await refreshDatabase(database).catch(() => undefined);
      throw error;
    } finally {
      if (databaseRef.current === database) {
        setSyncing(false);
      }
    }
  }, [refreshDatabase, userId]);

  const synchronize = useCallback(async (): Promise<OutboxSynchronizationResult> => {
    const database = databaseRef.current;
    return database ? runSynchronization(database) : EMPTY_SYNCHRONIZATION_RESULT;
  }, [runSynchronization]);

  const synchronizeOperation = useCallback(async (
    operationId: string,
  ): Promise<OutboxOperationResult> => {
    const database = databaseRef.current;
    if (!database) {
      throw new Error('The offline outbox is not ready');
    }
    const result = await runSynchronization(database);
    const synchronized = result.operations.find(
      (candidate) => candidate.operationId === operationId,
    );
    if (synchronized) {
      return synchronized;
    }
    const remaining = await database.operation(operationId);
    return remaining
      ? resultFromOperation(remaining)
      : { operationId, outcome: 'reconciled' };
  }, [runSynchronization]);

  const retry = useCallback(async (operationId: string): Promise<OutboxOperationResult> => {
    const database = databaseRef.current;
    if (!database) {
      throw new Error('The offline outbox is not ready');
    }
    await waitForActiveOutboxSynchronization(database);
    const remaining = await database.operation(operationId);
    if (!remaining) {
      await refreshDatabase(database);
      return { operationId, outcome: 'reconciled' };
    }
    await database.retry(operationId);
    await refreshDatabase(database);
    return synchronizeOperation(operationId);
  }, [refreshDatabase, synchronizeOperation]);

  useEffect(() => {
    let active = true;
    const previous = databaseRef.current;
    databaseRef.current = null;
    setReady(false);
    setSyncing(false);
    setOperations([]);
    if (previous) {
      closeAfterActiveSynchronization(previous);
    }
    if (!userId) {
      return () => {
        active = false;
      };
    }

    void UserOutboxDatabase.open(userId)
      .then(async (database) => {
        if (!active) {
          await database.close();
          return;
        }
        databaseRef.current = database;
        setReady(true);
        try {
          await synchronizeOutbox(database);
          if (active && databaseRef.current === database) {
            await refreshDatabase(database);
            void invalidateUserJobQueries(userId).catch(() => undefined);
          }
        } catch (error) {
          logger.warn('Initial outbox synchronization failed:', error);
          if (active && databaseRef.current === database) {
            await refreshDatabase(database).catch(() => undefined);
          }
        }
      })
      .catch((error) => {
        logger.error('Encrypted outbox could not be opened:', error);
        if (active) {
          setReady(false);
        }
      });

    return () => {
      active = false;
      const openDatabase = databaseRef.current;
      databaseRef.current = null;
      setReady(false);
      setSyncing(false);
      setOperations([]);
      if (openDatabase) {
        closeAfterActiveSynchronization(openDatabase);
      }
    };
  }, [refreshDatabase, userId]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void synchronize().catch(() => undefined);
      }
    });
    const networkSubscription = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        void synchronize().catch(() => undefined);
      }
    });
    return () => {
      appStateSubscription.remove();
      networkSubscription();
    };
  }, [ready, synchronize]);

  const discard = useCallback(async (operationId: string) => {
    const database = databaseRef.current;
    if (!database) {
      throw new Error('The offline outbox is not ready');
    }
    await waitForActiveOutboxSynchronization(database);
    if (await database.operation(operationId)) {
      await discardOutboxOperation(database, operationId);
    }
    await refreshDatabase(database);
  }, [refreshDatabase]);

  const value = useMemo<OutboxContextValue>(() => ({
    ready,
    syncing,
    operations,
    synchronize,
    synchronizeOperation,
    retry,
    refresh,
    discard,
    database: databaseRef.current,
  }), [
    discard,
    operations,
    ready,
    refresh,
    retry,
    synchronize,
    synchronizeOperation,
    syncing,
  ]);

  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

export function useOutbox(): OutboxContextValue {
  const context = useContext(OutboxContext);
  if (!context) {
    throw new Error('useOutbox must be used within OutboxProvider');
  }
  return context;
}
