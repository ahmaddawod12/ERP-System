import type { Language } from '../../../types';

export type ClientBookCopy = {
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  addClient: string;
  editClient: string;
  noClients: string;
  noClientsDesc: string;
  noResults: string;
  noResultsDesc: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  vatNumber: string;
  save: string;
  cancel: string;
  delete: string;
  deleteConfirm: string;
  deleteMessage: string;
  clientSaved: string;
  clientUpdated: string;
  clientDeleted: string;
  required: string;
  totalClients: string;
  clientOptions: string;
  finishedJobs: string;
  documents: string;
  editOrRemove: string;
  noDataFound: string;
  jobsFor: string;
  docsFor: string;
  jobTitle: string;
  completedOn: string;
  status: string;
  docType: string;
  docNumber: string;
  amount: string;
  createdOn: string;
  close: string;
  partsUsed: string;
  loadingClients: string;
  loadFailed: string;
  refreshFailed: string;
  retry: string;
  loadMore: string;
};

const translateMap: Record<Language, ClientBookCopy> = {
  en: {
    title: 'Client Book',
    subtitle: 'Manage your clients',
    searchPlaceholder: 'Search clients...',
    addClient: 'New Client',
    editClient: 'Edit Client',
    noClients: 'No clients yet',
    noClientsDesc: 'Tap the + button to add your first client',
    noResults: 'No clients found',
    noResultsDesc: 'Try a different search term',
    name: 'Client Name',
    phone: 'Phone Number',
    email: 'Email Address',
    address: 'Address',
    city: 'City',
    vatNumber: 'VAT Number',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Remove',
    deleteConfirm: 'Remove Client',
    deleteMessage: 'An unreferenced client is deleted. A client linked to jobs or documents is safely archived.',
    clientSaved: 'Client saved successfully',
    clientUpdated: 'Client updated successfully',
    clientDeleted: 'Client removed successfully',
    required: 'Client name is required',
    totalClients: 'clients',
    clientOptions: 'Client Options',
    finishedJobs: 'Finished Jobs',
    documents: 'Documents',
    editOrRemove: 'Edit / Remove',
    noDataFound: 'No data found for this month',
    jobsFor: 'Finished Jobs for',
    docsFor: 'Documents for',
    jobTitle: 'Job Title',
    completedOn: 'Completed',
    status: 'Status',
    docType: 'Type',
    docNumber: 'Doc #',
    amount: 'Amount',
    createdOn: 'Created',
    close: 'Close',
    partsUsed: 'Parts Used',
    loadingClients: 'Loading clients...',
    loadFailed: 'Clients could not be loaded. Check your connection and try again.',
    refreshFailed: 'Clients could not be refreshed. Saved results remain available.',
    retry: 'Retry',
    loadMore: 'Load more',
  },
  he: {
    title: 'ספר לקוחות',
    subtitle: 'ניהול הלקוחות שלך',
    searchPlaceholder: 'חיפוש לקוחות...',
    addClient: 'לקוח חדש',
    editClient: 'עריכת לקוח',
    noClients: 'אין לקוחות עדיין',
    noClientsDesc: 'לחץ על כפתור + להוספת לקוח ראשון',
    noResults: 'לא נמצאו לקוחות',
    noResultsDesc: 'נסה מילת חיפוש אחרת',
    name: 'שם לקוח',
    phone: 'מספר טלפון',
    email: 'כתובת אימייל',
    address: 'כתובת',
    city: 'עיר',
    vatNumber: 'מספר עוסק מורשה',
    save: 'שמור',
    cancel: 'ביטול',
    delete: 'הסר',
    deleteConfirm: 'הסרת לקוח',
    deleteMessage: 'לקוח ללא היסטוריה יימחק. לקוח המקושר לעבודות או למסמכים יועבר לארכיון.',
    clientSaved: 'הלקוח נשמר בהצלחה',
    clientUpdated: 'הלקוח עודכן בהצלחה',
    clientDeleted: 'הלקוח הוסר בהצלחה',
    required: 'שם לקוח נדרש',
    totalClients: 'לקוחות',
    clientOptions: 'אפשרויות לקוח',
    finishedJobs: 'עבודות שהושלמו',
    documents: 'מסמכים',
    editOrRemove: 'עריכה / מחיקה',
    noDataFound: 'לא נמצאו נתונים לחודש זה',
    jobsFor: 'עבודות שהושלמו עבור',
    docsFor: 'מסמכים עבור',
    jobTitle: 'כותרת עבודה',
    completedOn: 'הושלם',
    status: 'סטטוס',
    docType: 'סוג',
    docNumber: 'מס\' מסמך',
    amount: 'סכום',
    createdOn: 'נוצר',
    close: 'סגור',
    partsUsed: 'חלקים שנעשה בהם שימוש',
    loadingClients: 'טוען לקוחות...',
    loadFailed: 'לא ניתן היה לטעון את הלקוחות. בדוק את החיבור ונסה שוב.',
    refreshFailed: 'לא ניתן היה לרענן את הלקוחות. התוצאות השמורות נשארו זמינות.',
    retry: 'נסה שוב',
    loadMore: 'טען עוד',
  },
  ar: {
    title: 'دفتر العملاء',
    subtitle: 'إدارة عملائك',
    searchPlaceholder: 'البحث عن عملاء...',
    addClient: 'عميل جديد',
    editClient: 'تعديل عميل',
    noClients: 'لا يوجد عملاء بعد',
    noClientsDesc: 'اضغط على زر + لإضافة أول عميل',
    noResults: 'لم يتم العثور على عملاء',
    noResultsDesc: 'جرب كلمة بحث مختلفة',
    name: 'اسم العميل',
    phone: 'رقم الهاتف',
    email: 'البريد الإلكتروني',
    address: 'العنوان',
    city: 'المدينة',
    vatNumber: 'رقم ضريبي',
    save: 'حفظ',
    cancel: 'إلغاء',
    delete: 'إزالة',
    deleteConfirm: 'إزالة العميل',
    deleteMessage: 'سيتم حذف العميل غير المرتبط بسجل، وسيتم أرشفة العميل المرتبط بأعمال أو مستندات.',
    clientSaved: 'تم حفظ العميل بنجاح',
    clientUpdated: 'تم تحديث العميل بنجاح',
    clientDeleted: 'تمت إزالة العميل بنجاح',
    required: 'اسم العميل مطلوب',
    totalClients: 'عملاء',
    clientOptions: 'خيارات العميل',
    finishedJobs: 'الأعمال المكتملة',
    documents: 'المستندات',
    editOrRemove: 'تعديل / حذف',
    noDataFound: 'لا توجد بيانات لهذا الشهر',
    jobsFor: 'الأعمال المكتملة لـ',
    docsFor: 'المستندات لـ',
    jobTitle: 'عنوان العمل',
    completedOn: 'اكتمل',
    status: 'الحالة',
    docType: 'النوع',
    docNumber: 'رقم المستند',
    amount: 'المبلغ',
    createdOn: 'تم الإنشاء',
    close: 'إغلاق',
    partsUsed: 'الأجزاء المستخدمة',
    loadingClients: 'جارٍ تحميل العملاء...',
    loadFailed: 'تعذر تحميل العملاء. تحقق من الاتصال وحاول مرة أخرى.',
    refreshFailed: 'تعذر تحديث العملاء. ستبقى النتائج المحفوظة متاحة.',
    retry: 'إعادة المحاولة',
    loadMore: 'تحميل المزيد',
  },
};

export function getClientBookCopy(language: Language): ClientBookCopy {
  return translateMap[language] ?? translateMap.en;
}

