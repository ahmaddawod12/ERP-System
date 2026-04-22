import { useCallback } from 'react';
import { functions, httpsCallable } from '../firebase';
import { CACHE_KEYS } from './mmkv-storage';
import { callHttpFunction } from '../utils/httpFunctions';

interface ClientActionsParams {
  db: any;
  getCompanyId: () => string | null;
  clients: any[];
  saveToLocalCache: (key: string, value: unknown) => void;
  preIncrementVersion: (field: string, isCompanyCache?: boolean) => void;
  setClients: (value: any[]) => void;
}

export function useCacheClientActions({
  db,
  getCompanyId,
  clients,
  saveToLocalCache,
  preIncrementVersion,
  setClients,
}: ClientActionsParams) {
  const normalizeClient = useCallback((client: any) => {
    const numericId = Number(client?.numericId ?? client?.cid ?? client?.id);
    const resolvedId = String(client?.id ?? client?.cid ?? '').trim();
    const name = String(client?.name ?? client?.cname ?? '').trim();
    const phone = String(client?.phone ?? client?.cphone ?? '').trim();

    return {
      ...client,
      id: resolvedId || (Number.isFinite(numericId) ? String(numericId) : ''),
      cid: Number.isFinite(numericId) ? numericId : undefined,
      cname: name,
      cphone: phone || undefined,
      name,
      phone: phone || undefined,
    };
  }, []);

  const fetchClients = useCallback(async (companyId?: string) => {
    try {
      const resolvedCompanyId = companyId || getCompanyId();
      if (!resolvedCompanyId) {
        return [];
      }

      const clientsList = (await callHttpFunction<any[]>('readModelV1', {
        kind: 'clients',
        companyId: resolvedCompanyId,
      }))
        .map(normalizeClient)
        .sort((a: any, b: any) => {
          const left = Number(a.cid ?? a.id ?? 0);
          const right = Number(b.cid ?? b.id ?? 0);
          return left - right;
        });
      saveToLocalCache(CACHE_KEYS.CLIENTS, clientsList);
      setClients(clientsList);
      return clientsList;
    } catch (error) {
      console.error('Error fetching clients:', error);
      return [];
    }
  }, [db, getCompanyId, normalizeClient, saveToLocalCache, setClients]);

  const addClient = useCallback(async (clientData: any) => {
    const companyId = getCompanyId();
    if (!companyId) {
      throw new Error('Company name not found in cache');
    }

    const addClientFn = httpsCallable(functions, 'addClientV1');
    const result = await addClientFn({ companyId, ...clientData });
    const rawClient = (result.data as { client?: any } | null | undefined)?.client;
    if (!rawClient) {
      throw new Error('addClientV1 returned no client data');
    }
    const newClient = normalizeClient(rawClient);

    const updatedClients = [...clients, newClient];
    saveToLocalCache(CACHE_KEYS.CLIENTS, updatedClients);
    setClients(updatedClients);
    preIncrementVersion('clientsVersion', true);
    return newClient;
  }, [clients, getCompanyId, normalizeClient, preIncrementVersion, saveToLocalCache, setClients]);

  const updateClient = useCallback(async (clientId: string, updates: any) => {
    const companyId = getCompanyId();
    if (!companyId) throw new Error('Company name not found');

    const updateClientFn = httpsCallable(functions, 'updateClientV1');
    await updateClientFn({ companyId, clientId, ...updates });

    const updatedClients = clients.map((client) =>
      client.id === clientId ? { ...client, ...updates, updatedAt: new Date().toISOString() } : client,
    );
    saveToLocalCache(CACHE_KEYS.CLIENTS, updatedClients);
    setClients(updatedClients);
    preIncrementVersion('clientsVersion', true);
  }, [clients, getCompanyId, preIncrementVersion, saveToLocalCache, setClients]);

  const deleteClient = useCallback(async (clientId: string) => {
    const companyId = getCompanyId();
    if (!companyId) throw new Error('Company name not found');

    const deleteClientFn = httpsCallable(functions, 'deleteClientV1');
    await deleteClientFn({ companyId, clientId });

    const updatedClients = clients.filter((client) => client.id !== clientId);
    saveToLocalCache(CACHE_KEYS.CLIENTS, updatedClients);
    setClients(updatedClients);
    preIncrementVersion('clientsVersion', true);
  }, [clients, getCompanyId, preIncrementVersion, saveToLocalCache, setClients]);

  return {
    fetchClients,
    addClient,
    updateClient,
    deleteClient,
  };
}
