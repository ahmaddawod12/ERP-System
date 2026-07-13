import { DOC_TYPE, DOC_COLORS, DOC_GRADIENTS, DOC_ICONS } from '@smart-job/contracts';

export const DOCUMENT_CONFIGS = {
  [DOC_TYPE.TAX_INVOICE]: {
    icon: DOC_ICONS[DOC_TYPE.TAX_INVOICE],
    gradient: DOC_GRADIENTS[DOC_TYPE.TAX_INVOICE],
    requiresVatNumber: true,
    requiresInvoiceSelection: false,
    requiresPaymentMethod: false,
    hasReceiptMode: false,
    itemFields: ['description', 'price', 'quantity'],
  },
  [DOC_TYPE.RECEIPT]: {
    icon: DOC_ICONS[DOC_TYPE.RECEIPT],
    gradient: DOC_GRADIENTS[DOC_TYPE.RECEIPT],
    requiresVatNumber: false,
    requiresInvoiceSelection: false,
    requiresPaymentMethod: true,
    hasReceiptMode: true,
    itemFields: ['description', 'price', 'quantity'],
  },
  [DOC_TYPE.PRICE_PROPOSAL]: {
    icon: DOC_ICONS[DOC_TYPE.PRICE_PROPOSAL],
    gradient: DOC_GRADIENTS[DOC_TYPE.PRICE_PROPOSAL],
    requiresVatNumber: false,
    requiresInvoiceSelection: false,
    requiresPaymentMethod: false,
    hasReceiptMode: false,
    itemFields: ['description', 'price', 'quantity'],
  },
  [DOC_TYPE.DELIVERY_NOTE]: {
    icon: DOC_ICONS[DOC_TYPE.DELIVERY_NOTE],
    gradient: DOC_GRADIENTS[DOC_TYPE.DELIVERY_NOTE],
    requiresVatNumber: false,
    requiresInvoiceSelection: false,
    requiresPaymentMethod: false,
    hasReceiptMode: false,
    itemFields: ['description', 'price', 'quantity'],
  },
  [DOC_TYPE.RETURN_CERTIFICATE]: {
    icon: DOC_ICONS[DOC_TYPE.RETURN_CERTIFICATE],
    gradient: DOC_GRADIENTS[DOC_TYPE.RETURN_CERTIFICATE],
    requiresVatNumber: false,
    requiresInvoiceSelection: false,
    requiresPaymentMethod: false,
    hasReceiptMode: false,
    itemFields: ['description', 'price', 'quantity'],
  },
  [DOC_TYPE.REFUND]: {
    icon: DOC_ICONS[DOC_TYPE.REFUND],
    gradient: DOC_GRADIENTS[DOC_TYPE.REFUND],
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
