import type { MobileClientSummary } from './client-list-model';

export interface ClientFormData {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  vatNumber: string;
}

export function emptyClientFormData(): ClientFormData {
  return {
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    vatNumber: '',
  };
}

export function clientFormDataFromSummary(client: MobileClientSummary): ClientFormData {
  return {
    name: client.name || '',
    phone: client.phone || '',
    email: client.email || '',
    address: client.address || '',
    city: client.city || '',
    vatNumber: client.vatNumber || '',
  };
}

export function normalizedClientFormData(form: ClientFormData) {
  return {
    name: form.name.trim(),
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    address: form.address.trim() || null,
    city: form.city.trim() || null,
    vatNumber: form.vatNumber.trim() || null,
  };
}
