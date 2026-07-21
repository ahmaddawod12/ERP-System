import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { WorkspaceSummary } from '@smart-job/api-contracts';

import {
  cancelTenantRequests,
  cancelUserRequests,
  fetchWorkspaces,
} from '../lib/api/client';
import { cancelTenantQueries } from '../lib/query/client';
import {
  readLastCompanyPreference,
  writeLastCompanyPreference,
} from '../lib/query/persistence';
import { useSession } from './SessionContext';

type TenantStatus = 'idle' | 'loading' | 'selection-required' | 'ready' | 'error';

interface TenantContextValue {
  readonly status: TenantStatus;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly workspace: WorkspaceSummary | null;
  readonly error: Error | null;
  readonly selectWorkspace: (companyId: number) => Promise<void>;
  readonly refreshWorkspaces: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const { status: sessionStatus, user } = useSession();
  const userId = user?.id ?? null;
  const [status, setStatus] = useState<TenantStatus>('idle');
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const workspaceRef = useRef<WorkspaceSummary | null>(null);
  const workspacesRef = useRef<readonly WorkspaceSummary[]>([]);
  const activeUserIdRef = useRef<string | null>(null);
  const identityGenerationRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const selectionQueueRef = useRef<Promise<void>>(Promise.resolve());

  useLayoutEffect(() => {
    identityGenerationRef.current += 1;
    loadGenerationRef.current += 1;
    activeUserIdRef.current = userId;
    selectionQueueRef.current = Promise.resolve();
    workspaceRef.current = null;
    workspacesRef.current = [];
    setWorkspaces([]);
    setWorkspace(null);
    setError(null);
    setStatus(userId ? 'loading' : 'idle');

    return () => {
      identityGenerationRef.current += 1;
      loadGenerationRef.current += 1;
      if (activeUserIdRef.current === userId) {
        activeUserIdRef.current = null;
      }
      if (userId) {
        cancelUserRequests(userId);
      }
    };
  }, [userId]);

  const loadWorkspaces = useCallback(async () => {
    if (!userId) {
      workspacesRef.current = [];
      setWorkspaces([]);
      setWorkspace(null);
      workspaceRef.current = null;
      setStatus('idle');
      return;
    }

    const identityGeneration = identityGenerationRef.current;
    const loadGeneration = loadGenerationRef.current + 1;
    loadGenerationRef.current = loadGeneration;
    const isCurrent = () => (
      activeUserIdRef.current === userId
      && identityGenerationRef.current === identityGeneration
      && loadGenerationRef.current === loadGeneration
    );

    setStatus('loading');
    setError(null);
    try {
      const loaded = await fetchWorkspaces(userId);
      if (!isCurrent()) {
        return;
      }
      workspacesRef.current = loaded;
      setWorkspaces(loaded);
      if (loaded.length === 0) {
        workspaceRef.current = null;
        setWorkspace(null);
        setStatus('idle');
        return;
      }
      if (loaded.length === 1) {
        const onlyWorkspace = loaded[0] ?? null;
        if (onlyWorkspace) {
          await writeLastCompanyPreference(userId, onlyWorkspace.companyId);
        }
        if (!isCurrent()) {
          return;
        }
        setWorkspace(onlyWorkspace);
        workspaceRef.current = onlyWorkspace;
        setStatus('ready');
        return;
      }
      const preferredCompanyId = await readLastCompanyPreference(userId);
      if (!isCurrent()) {
        return;
      }
      const currentOrPreferred = loaded.find((candidate) => (
        candidate.companyId === workspaceRef.current?.companyId
        || candidate.companyId === preferredCompanyId
      )) ?? null;
      setWorkspace(currentOrPreferred);
      workspaceRef.current = currentOrPreferred;
      setStatus(currentOrPreferred ? 'ready' : loaded.length > 1 ? 'selection-required' : 'idle');
    } catch (cause: unknown) {
      if (!isCurrent()) {
        return;
      }
      setError(cause instanceof Error ? cause : new Error('Workspace loading failed'));
      setStatus('error');
    }
  }, [userId]);

  useEffect(() => {
    if (sessionStatus === 'restoring') {
      setStatus('loading');
      return;
    }
    void loadWorkspaces();
  }, [loadWorkspaces, sessionStatus]);

  const selectWorkspace = useCallback((companyId: number): Promise<void> => {
    const requestedUserId = userId;
    const requestedIdentityGeneration = identityGenerationRef.current;
    const executeSelection = async () => {
      if (
        !requestedUserId
        || activeUserIdRef.current !== requestedUserId
        || identityGenerationRef.current !== requestedIdentityGeneration
      ) {
        return;
      }

      const selected = workspacesRef.current.find(
        (candidate) => candidate.companyId === companyId,
      );
      if (!selected) {
        throw new Error('The selected workspace is not available to this user');
      }

      loadGenerationRef.current += 1;
      setStatus('loading');
      setError(null);
      const previous = workspaceRef.current;
      try {
        if (previous && previous.companyId !== selected.companyId) {
          cancelTenantRequests(requestedUserId, previous.companyId);
          await cancelTenantQueries(requestedUserId, previous.companyId);
        }
        if (
          activeUserIdRef.current !== requestedUserId
          || identityGenerationRef.current !== requestedIdentityGeneration
        ) {
          return;
        }

        await writeLastCompanyPreference(requestedUserId, selected.companyId);
        if (
          activeUserIdRef.current !== requestedUserId
          || identityGenerationRef.current !== requestedIdentityGeneration
        ) {
          return;
        }
        setWorkspace(selected);
        workspaceRef.current = selected;
        setStatus('ready');
      } catch (cause: unknown) {
        if (
          activeUserIdRef.current === requestedUserId
          && identityGenerationRef.current === requestedIdentityGeneration
        ) {
          setError(cause instanceof Error ? cause : new Error('Workspace selection failed'));
          setStatus('error');
        }
        throw cause;
      }
    };

    const queued = selectionQueueRef.current
      .catch(() => undefined)
      .then(executeSelection);
    selectionQueueRef.current = queued.catch(() => undefined);
    return queued;
  }, [userId]);

  const value = useMemo<TenantContextValue>(() => ({
    status,
    workspaces,
    workspace,
    error,
    selectWorkspace,
    refreshWorkspaces: loadWorkspaces,
  }), [error, loadWorkspaces, selectWorkspace, status, workspace, workspaces]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return context;
}
