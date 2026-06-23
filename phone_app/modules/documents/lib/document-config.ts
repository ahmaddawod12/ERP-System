import { DOC_TYPE } from '@smart-job/contracts';

export const DOCUMENT_CONFIGS = {
  [DOC_TYPE.TAX_INVOICE]: {
    icon: 'file-document',
    gradient: ['#10B981', '#059669'],
    requiresVatNumber: true,
    requiresInvoiceSelection: false,
    requiresPaymentMethod: false,
    hasReceiptMode: false,
    itemFields: ['description', 'price', 'quantity'],
  },
  [DOC_TYPE.RECEIPT]: {
    icon: 'receipt',
    gradient: ['#06B6D4', '#0891B2'],
    requiresVatNumber: false,
    requiresInvoiceSelection: false,
    requiresPaymentMethod: true,
    hasReceiptMode: true,
    itemFields: ['description', 'price', 'quantity'],
  },
  [DOC_TYPE.PRICE_PROPOSAL]: {
    icon: 'file-document-edit',
    gradient: ['#3B82F6', '#2563EB'],
    requiresVatNumber: false,
    requiresInvoiceSelection: false,
    requiresPaymentMethod: false,
    hasReceiptMode: false,
    itemFields: ['description', 'price', 'quantity'],
  },
  [DOC_TYPE.DELIVERY_NOTE]: {
    icon: 'truck-delivery',
    gradient: ['#8B5CF6', '#7C3AED'],
    requiresVatNumber: false,
    requiresInvoiceSelection: false,
    requiresPaymentMethod: false,
    hasReceiptMode: false,
    itemFields: ['description', 'price', 'quantity'],
  },
  [DOC_TYPE.RETURN_CERTIFICATE]: {
    icon: 'file-certificate',
    gradient: ['#EC4899', '#DB2777'],
    requiresVatNumber: false,
    requiresInvoiceSelection: false,
    requiresPaymentMethod: false,
    hasReceiptMode: false,
    itemFields: ['description', 'price', 'quantity'],
  },
  [DOC_TYPE.REFUND]: {
    icon: 'cash-refund',
    gradient: ['#F59E0B', '#D97706'],
    requiresVatNumber: false,
    requiresInvoiceSelection: false,
    requiresPaymentMethod: false,
    hasReceiptMode: false,
    itemFields: ['description', 'price', 'quantity'],
  },
} as const;

export function getPaymentMethods(language: string) {
  return [
    { id: 'cash', label: language === 'en' ? 'Cash' : language === 'he' ? 'מזומן' : 'نقدي' },
    { id: 'credit', label: language === 'en' ? 'Credit Card' : language === 'he' ? 'כרטיס אשראי' : 'بطاقة ائتمان' },
    { id: 'transfer', label: language === 'en' ? 'Bank Transfer' : language === 'he' ? 'העברה בנקאית' : 'تحويل بنكي' },
    { id: 'check', label: language === 'en' ? 'Check' : language === 'he' ? 'צ\'ק' : 'شيك' },
    { id: 'bit', label: language === 'en' ? 'Bit' : language === 'he' ? 'ביט' : 'بت' },
    { id: 'paybox', label: language === 'en' ? 'PayBox' : language === 'he' ? 'פייבוקס' : 'بايبوكس' },
  ];
}
