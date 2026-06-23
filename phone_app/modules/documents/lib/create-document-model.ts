import type { AppDocument, DateLike } from '../../../types';

export type ReceiptMode = 'auto' | 'manual' | null;

export type ModalType = 'invoiceSelect' | 'pdfPreview' | 'pdfViewer' | null;

export type CustomerSnapshot = {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  id?: string;
  clientVatNumber?: string;
  customerVatNumber?: string;
  vatNumber?: string;
  vat_number?: string;
  VAT?: string;
};

export type InvoiceLineItem = {
  description?: string;
  price?: number | string;
  quantity?: number | string;
  partId?: string | number | null;
};

export type DocumentFormItem = {
  id: number;
  description: string;
  price: string;
  quantity: string;
  partId?: string | number | null;
};

export type InvoiceDocumentRecord = Omit<AppDocument, 'items'> & {
  cname?: string;
  cphone?: string;
  documentNumber?: string | number;
  invoiceNumber?: string | number;
  documentData?: {
    client?: CustomerSnapshot;
    items?: InvoiceLineItem[];
  };
  client?: CustomerSnapshot;
  items?: InvoiceLineItem[];
  clientId?: string;
};

export type FormData = {
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  customerCity: string;
  customerPhone: string;
  customerId: string;
  clientVatNumber: string;
  paymentMethod: string;
  paymentInfo: string;
  invoiceReference: string;
  documentDate: string;
  notes: string;
};

export type BuiltClientData = {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  id: string;
  clientId?: string;
  clientVatNumber?: string;
};

export type BuiltDocumentData = {
  client: BuiltClientData;
  items: Array<{ description: string; quantity: number; price: number; partId?: string | number | null }>;
  language: 'he' | 'ar' | 'en';
  date: string;
  notes: string;
  paymentMethod?: string;
  paymentInfo?: string;
  invoiceReference?: string | number;
};

export type ClientUpdates = {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  vatNumber?: string;
};

export function toText(value: string | number | null | undefined): string {
  return value == null ? '' : String(value);
}

export function getErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? ((error as { code: string }).code)
    : null;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function formatDateLike(value: DateLike | Date | null | undefined): string {
  const time = getDateLikeTime(value);
  if (!time) return '';
  return new Date(time).toLocaleDateString();
}

export function getDateLikeTime(value: DateLike | Date | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return new Date(String(value)).getTime();
}
