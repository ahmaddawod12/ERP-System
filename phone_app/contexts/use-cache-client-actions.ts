import {
  ClientCreateRequestSchema,
  ClientDeleteRequestSchema,
  ClientUpdateRequestSchema,
  type ClientDeleteResult,
} from '@smart-job/api-contracts';
import { useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useCallback, useState } from 'react';

import { tenantQueryKey } from '../lib/query/client';
import {
  createClient as createApiClient,
  deleteOrArchiveClient as deleteOrArchiveApiClient,
  fetchClientsPage,
  updateClient as updateApiClient,
} from '../modules/clients/lib/clients-api';
import {
  mapClientSummary,
  normalizeClientListFilters,
} from '../modules/clients/lib/client-list-model';
import { StableClientActionKeys } from '../modules/clients/lib/client-action-keys';
import type { Client } from '../types';
import { logger } from '../utils/logger';
import { CACHE_KEYS } from './mmkv-storage';

interface ClientActionsParams {
  getUid: () => string | null;
  getCompanyId: () => string | null;
  clients: Client[];
  saveToLocalCache: (key: string, value: unknown) => void;
  preIncrementVersion: (field: string, isCompanyCache?: boolean) => void;
  setClients: (value: Client[]) => void;
}

interface ClientScope {
  readonly uid: string;
  readonly companyId: number;
}

function parseCompanyId(value: string | null | undefined): number {
  const companyId = Number(String(value ?? '').trim());
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error('A selected company is required to manage clients');
  }
  return companyId;
}

export function useCacheClientActions({
  getUid,
  getCompanyId,
  clients,
  saveToLocalCache,
  preIncrementVersion,
  setClients,
}: ClientActionsParams) {
  const queryClient = useQueryClient();
  const [actionKeys] = useState(() => new StableClientActionKeys(() => randomUUID()));

  const resolveScope = useCallback((companyId?: string): ClientScope => {
    const uid = String(getUid() ?? '').trim();
    if (!uid) {
      throw new Error('Authentication is required to manage clients');
    }
    return {
      uid,
      companyId: parseCompanyId(companyId ?? getCompanyId()),
    };
  }, [getCompanyId, getUid]);

  const refreshQueries = useCallback(async (scope: ClientScope): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: tenantQueryKey(scope.uid, scope.companyId, 'clients'),
    });
  }, [queryClient]);

  const fetchClients = useCallback(async (companyId?: string) => {
    try {
      const scope = resolveScope(companyId);
      const page = await fetchClientsPage({
        ...scope,
        filters: normalizeClientListFilters({ status: 'active', pageSize: 200 }),
      });
      const clientsList = page.items.map(mapClientSummary);
      saveToLocalCache(CACHE_KEYS.CLIENTS, clientsList);
      setClients(clientsList);
      return clientsList;
    } catch (error) {
      logger.warn('Client cache refresh failed; retaining the previous active page', error);
      return clients;
    }
  }, [clients, resolveScope, saveToLocalCache, setClients]);

  const addClient = useCallback(async (clientData: unknown) => {
    const scope = resolveScope();
    const request = ClientCreateRequestSchema.parse(clientData);
    const fingerprint = `create:${scope.uid}:${scope.companyId}:${JSON.stringify(request)}`;
    const action = `create:${scope.uid}:${scope.companyId}`;
    const idempotencyKey = actionKeys.keyFor(action, fingerprint);
    const created = await createApiClient({
      ...scope,
      request,
      idempotencyKey,
    });
    actionKeys.complete(action, idempotencyKey);
    const newClient = mapClientSummary(created);
    const updatedClients = [
      newClient,
      ...clients.filter((client) => client.id !== newClient.id),
    ];
    saveToLocalCache(CACHE_KEYS.CLIENTS, updatedClients);
    setClients(updatedClients);
    preIncrementVersion('clientsVersion', true);
    await refreshQueries(scope);
    return newClient;
  }, [actionKeys, clients, preIncrementVersion, refreshQueries, resolveScope, saveToLocalCache, setClients]);

  const updateClient = useCallback(async (clientId: string, updates: unknown) => {
    const scope = resolveScope();
    const existing = clients.find((client) => client.id === clientId);
    if (updates === null || typeof updates !== 'object' || Array.isArray(updates)) {
      throw new Error('Client updates are invalid');
    }
    const candidate = updates as Record<string, unknown>;
    const entityVersion = candidate.entityVersion ?? existing?.entityVersion;
    if (typeof entityVersion !== 'string' || !entityVersion) {
      throw new Error('Reload this client before updating it');
    }
    const request = ClientUpdateRequestSchema.parse({
      ...candidate,
      entityVersion,
    });
    const fingerprint = `update:${scope.uid}:${scope.companyId}:${clientId}:${JSON.stringify(request)}`;
    const action = `update:${scope.uid}:${scope.companyId}:${clientId}`;
    const idempotencyKey = actionKeys.keyFor(action, fingerprint);
    const updated = await updateApiClient({
      ...scope,
      clientId,
      request,
      idempotencyKey,
    });
    actionKeys.complete(action, idempotencyKey);
    const updatedClient = mapClientSummary(updated);
    const updatedClients = existing
      ? clients.map((client) => client.id === clientId ? updatedClient : client)
      : [updatedClient, ...clients];
    saveToLocalCache(CACHE_KEYS.CLIENTS, updatedClients);
    setClients(updatedClients);
    preIncrementVersion('clientsVersion', true);
    await refreshQueries(scope);
    return updatedClient;
  }, [actionKeys, clients, preIncrementVersion, refreshQueries, resolveScope, saveToLocalCache, setClients]);

  const deleteClient = useCallback(async (
    clientId: string,
    suppliedEntityVersion?: string,
  ): Promise<ClientDeleteResult> => {
    const scope = resolveScope();
    const existing = clients.find((client) => client.id === clientId);
    const entityVersion = suppliedEntityVersion ?? existing?.entityVersion;
    if (!entityVersion) {
      throw new Error('Reload this client before removing it');
    }
    const request = ClientDeleteRequestSchema.parse({ entityVersion });
    const fingerprint = `delete:${scope.uid}:${scope.companyId}:${clientId}:${JSON.stringify(request)}`;
    const action = `delete:${scope.uid}:${scope.companyId}:${clientId}`;
    const idempotencyKey = actionKeys.keyFor(action, fingerprint);
    const removed = await deleteOrArchiveApiClient({
      ...scope,
      clientId,
      request,
      idempotencyKey,
    });
    actionKeys.complete(action, idempotencyKey);
    const updatedClients = clients.filter((client) => client.id !== clientId);
    saveToLocalCache(CACHE_KEYS.CLIENTS, updatedClients);
    setClients(updatedClients);
    preIncrementVersion('clientsVersion', true);
    await refreshQueries(scope);
    return removed;
  }, [actionKeys, clients, preIncrementVersion, refreshQueries, resolveScope, saveToLocalCache, setClients]);

  return {
    fetchClients,
    addClient,
    updateClient,
    deleteClient,
  };
}
