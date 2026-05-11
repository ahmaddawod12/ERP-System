import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { AppDocument, DateLike, DocTypeCode } from '../../../types';
import type { DateFilterRange } from '../../../components/forms/DateFilter';

export type DocumentTypeFilter = 'all' | DocTypeCode;

export type DocumentLineItem = {
  price?: number | string;
  quantity?: number | string;
  description?: string;
};

export type DocumentHistoryRecord = AppDocument & {
  income?: DocumentLineItem[];
  notes?: string;
  number?: string | number;
  documentNumber?: string | number;
  total?: number;
  description?: string;
  createdByName?: string;
  createdByUid?: string;
  storagePath?: string;
  documentId?: string;
};

export type DocumentDateFilter = {
  type: DateFilterRange['type'];
  startDate: Date | null;
  endDate: Date | null;
  label: string;
};

export type DocumentTypeOption = {
  id: DocumentTypeFilter;
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  color: string;
  gradient: [string, string];
};

export function getDateLikeTime(value: DateLike | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return new Date(String(value)).getTime();
}
