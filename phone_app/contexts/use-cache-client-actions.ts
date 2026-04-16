import { useCallback } from 'react';
import { collection, getDocs, functions, httpsCallable } from '../firebase';
import { CACHE_KEYS } from './mmkv-storage';

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
  const fetchClients = useCallback(async (companyId?: string) => {
    try {
      const resolvedCompanyId = companyId || getCompanyId();
      if (!resolvedCompanyId) {
        return [];
      }

      const clientsRef = collection(db, 'companies', resolvedCompanyId, 'clients');
      const snapshot = await getDocs(clientsRef);
      const clientsList: any[] = [];
      snapshot.forEach((docSnap: any) => {
        clientsList.push({ id: docSnap.id, ...docSnap.data() });
      });
      clientsList.sort((a: any, b: any) => parseInt(a.id) - parseInt(b.id));
      saveToLocalCache(CACHE_KEYS.CLIENTS, clientsList);
      setClients(clientsList);
      return clientsList;
    } catch (error) {
      console.error('Error fetching clients:', error);
      return [];
    }
  }, [db, getCompanyId, saveToLocalCache, setClients]);

  const addClient = useCallback(async (clientData: any) => {
    const companyId = getCompanyId();
    if (!companyId) {
      throw new Error('Company name not found in cache');
    }

    const addClientFn = httpsCallable(functions, 'addClientV1');
    const result = await addClientFn({ companyId, ...clientData });
    const newClient = (result.data as { client?: any } | null | undefined)?.client;
    if (!newClient) {
      throw new Error('addClientV1 returned no client data');
    }

    const updatedClients = [...clients, newClient];
    saveToLocalCache(CACHE_KEYS.CLIENTS, updatedClients);
    setClients(updatedClients);
    preIncrementVersion('clientsVersion', true);
    return newClient;
  }, [clients, getCompanyId, preIncrementVersion, saveToLocalCache, setClients]);

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
