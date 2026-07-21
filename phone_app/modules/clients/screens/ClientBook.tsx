import { styles } from './ClientBook.styles';
/**
 * ClientBook.js - Client management screen
 *
 * Allows users to view, search, add, edit, and delete clients.
 * When pressing a client card, shows 3 options:
 *   1. Show Finished Jobs for this client (monthly filter)
 *   2. Show Documents for this client (monthly filter)
 *   3. Edit or Remove this client
 * Uses getDataForMonth from CacheContext for cache-first monthly data retrieval.
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  Keyboard,
  ActivityIndicator,
  FlatList,
  ScrollView,
  TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getColors, gradients, spacing, borderRadius, typography, shadows } from '../../../theme';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTenant } from '../../../contexts/TenantContext';
import { AppInput, AppText, GlobalHeader } from '../../../components';
import { DOC_TYPE, DOC_COLORS, getDocumentLabel } from '@smart-job/contracts';
import {
  ClientCreateRequestSchema,
  ClientDeleteRequestSchema,
  ClientUpdateRequestSchema,
} from '@smart-job/api-contracts';
import { randomUUID } from 'expo-crypto';
import { logger } from '../../../utils/logger';
import AccessibleModal from '../../../components/feedback/AccessibleModal';
import ClientFormModalContent from '../components/ClientFormModalContent';
import {
  clientFormDataFromSummary,
  emptyClientFormData,
  normalizedClientFormData,
  type ClientFormData,
} from '../lib/client-form-model';
import { useClientsInfinite } from '../lib/use-clients-infinite';
import { useClientMutations } from '../lib/use-client-mutations';
import type { MobileClientSummary } from '../lib/client-list-model';
import { StableClientActionKeys } from '../lib/client-action-keys';

type Translations = {
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

const translateMap: Record<string, Translations> = {
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

function mutationErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'The client action could not be completed.';
}

export default function ClientBook() {
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const insets = useSafeAreaInsets();
  const colors = getColors(isDarkMode);
  const { user } = useSession();
  const { workspace, status: tenantStatus } = useTenant();
  const { getDataForMonth } = useCache();
  const { createMutation, updateMutation, removeMutation } = useClientMutations({
    uid: user?.id ?? null,
    companyId: workspace?.companyId ?? null,
  });
  const [actionKeys] = useState(() => new StableClientActionKeys(() => randomUUID()));

  // --- Existing state ---
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState<MobileClientSummary | null>(null);
  const [formData, setFormData] = useState<ClientFormData>(emptyClientFormData);

  // --- New state for client options & data viewer ---
  const [selectedClient, setSelectedClient] = useState<MobileClientSummary | null>(null);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showDataModal, setShowDataModal] = useState(false);
  const [dataViewType, setDataViewType] = useState<'finishedJobs' | 'documents'>('finishedJobs');
  const [dataItems, setDataItems] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date());

  const isRTL = language === 'he' || language === 'ar';

  const t = translateMap[language] || translateMap.en;

  const clientFilters = useMemo(() => ({
    search: debouncedSearchQuery,
    pageSize: 50,
  }), [debouncedSearchQuery]);
  const { query: clientsQuery, clients } = useClientsInfinite({
    uid: user?.id ?? null,
    companyId: workspace?.companyId ?? null,
    filters: clientFilters,
    enabled: tenantStatus === 'ready',
  });
  const loading = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim().slice(0, 80));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    actionKeys.reset();
  }, [actionKeys, user?.id, workspace?.companyId]);

  useEffect(() => {
    if (clientsQuery.error) {
      logger.warn('Client list refresh failed; retaining cached query data', clientsQuery.error);
    }
  }, [clientsQuery.error]);

  // --- Helpers ---

  /** Format a Date to month/year display string */
  const formatMonth = useCallback((date: Date) => {
    const monthNames = language === 'en'
      ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      : language === 'he'
        ? ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
        : ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    return `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
  }, [language]);

  /** Format a date field (handles ISO strings and Firestore Timestamps) */
  const formatDate = useCallback((dateInput: any) => {
    if (!dateInput) return '—';
    let d;
    if (dateInput.toDate && typeof dateInput.toDate === 'function') {
      d = dateInput.toDate();
    } else {
      d = new Date(dateInput);
    }
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(language === 'he' ? 'he-IL' : language === 'ar' ? 'ar-SA' : 'en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }, [language]);

  /** Get document type label */
  const getDocTypeLabel = useCallback((type: string | number | undefined) => {
    const numType = typeof type === 'string' ? parseInt(type, 10) : type;
    if (numType === undefined || Number.isNaN(numType)) return `${type}`;
    return getDocumentLabel(numType, language) || `${type}`;
  }, [language]);

  /** Get document type color */
  const getDocTypeColor = useCallback((type: string | number | undefined) => {
    const numType = typeof type === 'string' ? parseInt(type, 10) : type;
    return DOC_COLORS[numType as keyof typeof DOC_COLORS] ?? colors.textSecondary;
  }, [colors]);

  /** Calculate total from income/items array */
  const calculateTotal = useCallback((income: any) => {
    if (!income || !Array.isArray(income)) return 0;
    return income.reduce((sum, item) => {
      const price = parseFloat(item.price) || 0;
      const quantity = parseFloat(item.quantity) || 1;
      return sum + (price * quantity);
    }, 0);
  }, []);

  // --- Form helpers ---
  const resetForm = () => {
    setFormData(emptyClientFormData());
    setEditingClient(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (client: MobileClientSummary) => {
    setEditingClient(client);
    setFormData(clientFormDataFromSummary(client));
    setShowOptionsModal(false);
    setShowModal(true);
  };

  // --- New: Client options flow ---

  /** Open options modal when pressing a client card */
  const openClientOptions = (client: MobileClientSummary) => {
    setSelectedClient(client);
    setShowOptionsModal(true);
  };

  /** Fetch finished jobs or documents for the selected client & month */
  const fetchClientData = useCallback(async (client: MobileClientSummary | null, type: 'finishedJobs' | 'documents', monthDate: Date) => {
    if (!client) return;
    setDataLoading(true);
    try {
      const allData = await getDataForMonth(monthDate, type);

      // Filter by client — match on clientId (primary) or cname (fallback)
      const clientIds = new Set(
        [client.id, client.cid]
          .filter((value) => value !== undefined && value !== null)
          .map((value) => String(value)),
      );
      const normalizedClientName = client.name?.toLowerCase()?.trim();

      const matched = (allData || []).filter(item => {
        const itemClientId = item.cid ?? item.clientId;
        if (itemClientId !== undefined && clientIds.has(String(itemClientId))) return true;
        if (normalizedClientName && (item.cname || item.customerName)?.toLowerCase()?.trim() === normalizedClientName) return true;
        return false;
      });

      // Sort by date descending
      const dateField = type === 'documents' ? 'createdAt' : 'finishedAt';
      matched.sort((a, b) => {
        const getTime = (d: any) => {
          if (!d) return 0;
          if (d.toDate && typeof d.toDate === 'function') return d.toDate().getTime();
          return new Date(d).getTime();
        };
        return getTime(b[dateField]) - getTime(a[dateField]);
      });

      setDataItems(matched);
    } catch (error) {
      logger.error('Error fetching client data', error);
      setDataItems([]);
    } finally {
      setDataLoading(false);
    }
  }, [getDataForMonth]);

  /** Open data viewer modal (finished jobs or documents) */
  const openDataViewer = useCallback((type: 'finishedJobs' | 'documents') => {
    setDataViewType(type);
    setSelectedMonth(new Date());
    setDataItems([]);
    setShowOptionsModal(false);
    setShowDataModal(true);
    // Fetch data for current month
    fetchClientData(selectedClient, type, new Date());
  }, [selectedClient, fetchClientData]);

  /** Navigate to previous/next month */
  const handleMonthChange = useCallback((direction: number) => {
    setSelectedMonth(prev => {
      const newMonth = new Date(prev.getFullYear(), prev.getMonth() + direction, 1);
      // Don't go into the future
      const now = new Date();
      if (newMonth > new Date(now.getFullYear(), now.getMonth(), 1)) return prev;
      fetchClientData(selectedClient, dataViewType, newMonth);
      return newMonth;
    });
  }, [selectedClient, dataViewType, fetchClientData]);

  // --- Save / Delete handlers ---
  const handleSave = async () => {
    if (!formData.name.trim()) {
      alert.warning(t.required, t.required);
      return;
    }

    Keyboard.dismiss();

    try {
      const clientData = normalizedClientFormData(formData);

      if (editingClient) {
        const request = ClientUpdateRequestSchema.parse({
          ...clientData,
          entityVersion: editingClient.entityVersion,
        });
        const fingerprint = JSON.stringify({ clientId: editingClient.id, request });
        const action = `update:${editingClient.id}`;
        const idempotencyKey = actionKeys.keyFor(action, fingerprint);
        await updateMutation.mutateAsync({
          clientId: editingClient.id,
          body: request,
          idempotencyKey,
        });
        actionKeys.complete(action, idempotencyKey);
        alert.success('✅', t.clientUpdated);
      } else {
        const request = ClientCreateRequestSchema.parse(clientData);
        const fingerprint = JSON.stringify(request);
        const action = 'create';
        const idempotencyKey = actionKeys.keyFor(action, fingerprint);
        await createMutation.mutateAsync({
          body: request,
          idempotencyKey,
        });
        actionKeys.complete(action, idempotencyKey);
        alert.success('✅', t.clientSaved);
      }

      setShowModal(false);
      resetForm();
    } catch (error: unknown) {
      logger.error('Error saving client', error);
      alert.error('Error', mutationErrorMessage(error));
    }
  };

  const handleDelete = (client: MobileClientSummary) => {
    alert.confirm(
      t.deleteConfirm,
      t.deleteMessage,
      [
        { text: t.cancel, style: 'cancel', onPress: () => {} },
        {
          text: t.delete,
          style: 'destructive',
          onPress: async () => {
            try {
              const request = ClientDeleteRequestSchema.parse({
                entityVersion: client.entityVersion,
              });
              const fingerprint = JSON.stringify({ clientId: client.id, request });
              const action = `remove:${client.id}`;
              const idempotencyKey = actionKeys.keyFor(action, fingerprint);
              const removed = await removeMutation.mutateAsync({
                clientId: client.id,
                body: request,
                idempotencyKey,
              });
              actionKeys.complete(action, idempotencyKey);
              alert.success(
                '✅',
                removed.disposition === 'archived'
                  ? `${t.clientDeleted} (${removed.disposition})`
                  : t.clientDeleted,
              );
              if (showModal) {
                setShowModal(false);
                resetForm();
              }
            } catch (error: unknown) {
              logger.error('Error deleting client', error);
              alert.error('Error', mutationErrorMessage(error));
            }
          },
        },
      ]
    );
  };

  // --- Renderers ---

  /** Render a single finished job card in the data viewer */
  const renderJobItem = ({ item }: { item: any }) => (
    <View style={[styles.dataCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.dataCardHeader}>
        <View style={{ flex: 1 }}>
          <AppText style={[styles.dataCardTitle, { color: colors.textPrimary }]} numberOfLines={2}>
            {item.title || item.jobTitle || item.description || '—'}
          </AppText>
        </View>
        {item.status && (
          <View style={[styles.statusBadge, { backgroundColor: '#10B981' + '20' }]}>
            <AppText style={[styles.statusBadgeText, { color: '#10B981' }]}>
              {item.status}
            </AppText>
          </View>
        )}
      </View>

      <View style={styles.dataCardDetails}>
        <View style={styles.dataDetailRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
          <AppText style={[styles.dataDetailText, { color: colors.textSecondary }]}>
            {t.completedOn}: {formatDate(item.finishedAt || item.completedAt)}
          </AppText>
        </View>
        {item.location && (
          <View style={styles.dataDetailRow}>
            <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
            <AppText style={[styles.dataDetailText, { color: colors.textSecondary }]} numberOfLines={1}>
              {item.location}
            </AppText>
          </View>
        )}
        {item.parts && Array.isArray(item.parts) && item.parts.length > 0 && (
          <View style={styles.dataDetailRow}>
            <Ionicons name="construct-outline" size={14} color={colors.textSecondary} />
            <AppText style={[styles.dataDetailText, { color: colors.textSecondary }]} numberOfLines={1}>
              {t.partsUsed}: {item.parts.map((p: any) => p.partName || p.name).filter(Boolean).join(', ')}
            </AppText>
          </View>
        )}
      </View>
    </View>
  );

  /** Render a single document card in the data viewer */
  const renderCertItem = ({ item }: { item: any }) => {
    const total = item.totals?.grandTotal ?? calculateTotal(item.income || item.items);
    const typeColor = getDocTypeColor(item.type);
    return (
      <View style={[styles.dataCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.dataCardHeader}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <View style={[styles.docTypeBadge, { backgroundColor: typeColor + '20' }]}>
                <AppText style={[styles.docTypeBadgeText, { color: typeColor }]}>
                  {getDocTypeLabel(item.type)}
                </AppText>
              </View>
              {item.documentNumber && (
                <AppText style={[styles.docNumberText, { color: colors.textSecondary }]}>
                  #{item.documentNumber}
                </AppText>
              )}
            </View>
          </View>
          {total > 0 && (
            <AppText style={[styles.amountText, { color: colors.primary }]}>
              ₪{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </AppText>
          )}
        </View>

        <View style={styles.dataCardDetails}>
          <View style={styles.dataDetailRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
            <AppText style={[styles.dataDetailText, { color: colors.textSecondary }]}>
              {t.createdOn}: {formatDate(item.createdAt)}
            </AppText>
          </View>
          {item.cname && (
            <View style={styles.dataDetailRow}>
              <Ionicons name="person-outline" size={14} color={colors.textSecondary} />
              <AppText style={[styles.dataDetailText, { color: colors.textSecondary }]} numberOfLines={1}>
                {item.cname}
              </AppText>
            </View>
          )}
        </View>
      </View>
    );
  };

  /** Render client card in main list */
  const renderClientCard = ({ item: client }: { item: MobileClientSummary }) => (
    <TouchableOpacity
      style={[styles.clientCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => openClientOptions(client)}
      activeOpacity={0.7}
    >
      <View style={styles.clientCardRow}>
        <View style={[styles.clientAvatar, { backgroundColor: colors.secondary + '15' }]}>
          <MaterialCommunityIcons name="account" size={28} color={colors.secondary} />
        </View>
        <View style={styles.clientCardInfo}>
          <View style={styles.clientNameRow}>
            <AppText style={[styles.clientName, { color: colors.textPrimary }]} numberOfLines={1}>
              {client.name}
            </AppText>
            <View style={[styles.idBadge, { backgroundColor: colors.secondary + '15' }]}>
              <AppText style={[styles.idBadgeText, { color: colors.secondary }]}>#{client.cid ?? client.id}</AppText>
            </View>
          </View>
          {client.phone ? (
            <View style={styles.detailRow}>
              <Ionicons name="call-outline" size={13} color={colors.textSecondary} />
              <AppText style={[styles.clientDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                {client.phone}
              </AppText>
            </View>
          ) : null}
          {client.email ? (
            <View style={styles.detailRow}>
              <Ionicons name="mail-outline" size={13} color={colors.textSecondary} />
              <AppText style={[styles.clientDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                {client.email}
              </AppText>
            </View>
          ) : null}
          {client.address || client.city ? (
            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
              <AppText style={[styles.clientDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                {[client.address, client.city].filter(Boolean).join(', ')}
              </AppText>
            </View>
          ) : null}
          {client.vatNumber ? (
            <View style={styles.detailRow}>
              <MaterialCommunityIcons name="file-document-outline" size={13} color={colors.textSecondary} />
              <AppText style={[styles.clientDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                {client.vatNumber}
              </AppText>
            </View>
          ) : null}
        </View>
        <Feather name={isRTL ? 'chevron-left' : 'chevron-right'} size={20} color={colors.textLight} />
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      {clientsQuery.isLoading ? (
        <>
          <ActivityIndicator size="large" color={colors.secondary} />
          <AppText style={[styles.emptyDesc, { color: colors.textSecondary }]}>
            {t.loadingClients}
          </AppText>
        </>
      ) : clientsQuery.isError ? (
        <>
          <MaterialCommunityIcons name="cloud-alert-outline" size={72} color={colors.error} />
          <AppText style={[styles.emptyTitle, { color: colors.textPrimary }]}>
            {t.loadFailed}
          </AppText>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.secondary }]}
            onPress={() => { void clientsQuery.refetch(); }}
            disabled={clientsQuery.isFetching}
          >
            {clientsQuery.isFetching ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <AppText style={styles.retryButtonText}>{t.retry}</AppText>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <MaterialCommunityIcons
            name={searchQuery ? 'account-search' : 'book-account-outline'}
            size={72}
            color={colors.textLight}
          />
          <AppText style={[styles.emptyTitle, { color: colors.textPrimary }]}>
            {searchQuery ? t.noResults : t.noClients}
          </AppText>
          <AppText style={[styles.emptyDesc, { color: colors.textSecondary }]}>
            {searchQuery ? t.noResultsDesc : t.noClientsDesc}
          </AppText>
        </>
      )}
    </View>
  );

  const renderRefreshError = () => {
    if (!clientsQuery.isError || clients.length === 0) {
      return null;
    }
    return (
      <View style={[styles.queryErrorBanner, { backgroundColor: colors.surface, borderColor: colors.error }]}>
        <AppText style={[styles.queryErrorText, { color: colors.textPrimary }]}>
          {t.refreshFailed}
        </AppText>
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: colors.secondary }]}
          onPress={() => { void clientsQuery.refetch(); }}
          disabled={clientsQuery.isFetching}
        >
          {clientsQuery.isFetching ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <AppText style={styles.retryButtonText}>{t.retry}</AppText>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const renderListFooter = () => {
    if (!clientsQuery.hasNextPage) {
      return null;
    }
    return (
      <TouchableOpacity
        style={[styles.loadMoreButton, { backgroundColor: colors.secondary }]}
        onPress={() => { void clientsQuery.fetchNextPage(); }}
        disabled={clientsQuery.isFetchingNextPage}
      >
        {clientsQuery.isFetchingNextPage ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <AppText style={styles.loadMoreButtonText}>{t.loadMore}</AppText>
        )}
      </TouchableOpacity>
    );
  };

  // Check if selected month is the current month (to disable forward nav)
  const isCurrentMonth = useMemo(() => {
    const now = new Date();
    return selectedMonth.getMonth() === now.getMonth() && selectedMonth.getFullYear() === now.getFullYear();
  }, [selectedMonth]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.headerContainer, { paddingTop: insets.top + 50 }]}>
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerGradient}
        >
          <View style={styles.headerContent}>
            <View>
              <AppText style={styles.headerTitle}>{t.title}</AppText>
              <AppText style={styles.headerSubtitle}>
                {clients.length}{clientsQuery.hasNextPage ? '+' : ''} {t.totalClients}
              </AppText>
            </View>
            <TouchableOpacity
              style={styles.addButton}
              onPress={openAddModal}
              activeOpacity={0.8}
              disabled={loading || removeMutation.isPending}
            >
              <Ionicons name="add" size={28} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>

      {/* Search Bar */}
      <View style={[styles.searchWrapper, { backgroundColor: colors.background }]}>
        <AppInput
          placeholder={t.searchPlaceholder}
          value={searchQuery}
          onChangeText={(value) => setSearchQuery(value.slice(0, 80))}
          maxLength={80}
          returnKeyType="search"
          colors={colors}
          leftIcon={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialCommunityIcons name="book-account-outline" size={20} color={colors.secondary} />
              <Ionicons name="search" size={18} color={colors.textSecondary} />
            </View>
          }
          rightIcon={searchQuery.length > 0 ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        />
      </View>

      {/* Client List */}
      <FlatList
        data={clients}
        renderItem={renderClientCard}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          clients.length === 0 && styles.listContentEmpty,
        ]}
        ListHeaderComponent={renderRefreshError}
        ListEmptyComponent={renderEmptyState}
        ListFooterComponent={renderListFooter}
        refreshing={clientsQuery.isRefetching && !clientsQuery.isFetchingNextPage}
        onRefresh={() => { void clientsQuery.refetch(); }}
        showsVerticalScrollIndicator={false}
      />

      {/* ==================== MODAL 1: Client Options ==================== */}
      <AccessibleModal
        visible={showOptionsModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowOptionsModal(false)}
        announcement="Client actions"
      >
        <TouchableWithoutFeedback onPress={() => setShowOptionsModal(false)}>
          <View style={styles.optionsOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.optionsContainer, { backgroundColor: colors.surface }]}>
                {/* Options Header */}
                <View style={styles.optionsHeader}>
                  <LinearGradient
                    colors={gradients.secondary}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.optionsHeaderGradient}
                  >
                    <View style={styles.optionsHeaderContent}>
                      <MaterialCommunityIcons name="account-circle" size={32} color="white" />
                      <View style={{ flex: 1 }}>
                        <AppText style={styles.optionsHeaderTitle} numberOfLines={1}>
                          {selectedClient?.name}
                        </AppText>
                        <AppText style={styles.optionsHeaderSubtitle}>
                          {t.clientOptions}
                        </AppText>
                      </View>
                      <TouchableOpacity onPress={() => setShowOptionsModal(false)}>
                        <Ionicons name="close-circle" size={28} color="rgba(255,255,255,0.8)" />
                      </TouchableOpacity>
                    </View>
                  </LinearGradient>
                </View>

                {/* Option Buttons */}
                <View style={styles.optionsButtonList}>
                  {/* Option 1: Finished Jobs */}
                  <TouchableOpacity
                    style={[styles.optionButton, { borderColor: colors.border }]}
                    onPress={() => openDataViewer('finishedJobs')}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.optionIconBox, { backgroundColor: '#10B981' + '15' }]}>
                      <MaterialCommunityIcons name="briefcase-check" size={24} color="#10B981" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText style={[styles.optionButtonTitle, { color: colors.textPrimary }]}>
                        {t.finishedJobs}
                      </AppText>
                    </View>
                    <Feather name={isRTL ? 'chevron-left' : 'chevron-right'} size={20} color={colors.textLight} />
                  </TouchableOpacity>

                  {/* Option 2: Documents */}
                  <TouchableOpacity
                    style={[styles.optionButton, { borderColor: colors.border }]}
                    onPress={() => openDataViewer('documents')}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.optionIconBox, { backgroundColor: '#3B82F6' + '15' }]}>
                      <MaterialCommunityIcons name="file-certificate" size={24} color="#3B82F6" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText style={[styles.optionButtonTitle, { color: colors.textPrimary }]}>
                        {t.documents}
                      </AppText>
                    </View>
                    <Feather name={isRTL ? 'chevron-left' : 'chevron-right'} size={20} color={colors.textLight} />
                  </TouchableOpacity>

                  {/* Option 3: Edit / Remove */}
                  <TouchableOpacity
                    style={[styles.optionButton, { borderColor: colors.border }]}
                    onPress={() => selectedClient && openEditModal(selectedClient)}
                    activeOpacity={0.7}
                    disabled={loading || removeMutation.isPending}
                  >
                    <View style={[styles.optionIconBox, { backgroundColor: '#F59E0B' + '15' }]}>
                      <MaterialCommunityIcons name="account-edit" size={24} color="#F59E0B" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText style={[styles.optionButtonTitle, { color: colors.textPrimary }]}>
                        {t.editOrRemove}
                      </AppText>
                    </View>
                    <Feather name={isRTL ? 'chevron-left' : 'chevron-right'} size={20} color={colors.textLight} />
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </AccessibleModal>

      {/* ==================== MODAL 2: Data Viewer (Jobs / Documents) ==================== */}
      <AccessibleModal
        visible={showDataModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowDataModal(false)}
        announcement="Client history"
      >
        <View style={[styles.dataModalContainer, { backgroundColor: colors.background, paddingTop: insets.top }]}>
          {/* Data Modal Header */}
          <LinearGradient
            colors={dataViewType === 'finishedJobs' ? ['#10B981', '#059669'] : ['#3B82F6', '#2563EB']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.dataModalHeader}
          >
            <TouchableOpacity onPress={() => setShowDataModal(false)} style={styles.dataModalClose}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <AppText style={styles.dataModalTitle} numberOfLines={1}>
                {dataViewType === 'finishedJobs' ? t.jobsFor : t.docsFor}
              </AppText>
              <AppText style={styles.dataModalSubtitle} numberOfLines={1}>
                {selectedClient?.name}
              </AppText>
            </View>
          </LinearGradient>

          {/* Month Navigator */}
          <View style={[styles.monthNav, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => handleMonthChange(-1)}
              style={styles.monthNavButton}
            >
              <Ionicons name={isRTL ? 'chevron-forward' : 'chevron-back'} size={24} color={colors.primary} />
            </TouchableOpacity>
            <View style={styles.monthNavCenter}>
              <Ionicons name="calendar-outline" size={18} color={colors.primary} style={{ marginRight: spacing.xs }} />
              <AppText style={[styles.monthNavText, { color: colors.textPrimary }]}>
                {formatMonth(selectedMonth)}
              </AppText>
            </View>
            <TouchableOpacity
              onPress={() => handleMonthChange(1)}
              style={styles.monthNavButton}
              disabled={isCurrentMonth}
            >
              <Ionicons
                name={isRTL ? 'chevron-back' : 'chevron-forward'}
                size={24}
                color={isCurrentMonth ? colors.textLight : colors.primary}
              />
            </TouchableOpacity>
          </View>

          {/* Data List */}
          {dataLoading ? (
            <View style={styles.dataLoadingContainer}>
              <ActivityIndicator size="large" color={dataViewType === 'finishedJobs' ? '#10B981' : '#3B82F6'} />
            </View>
          ) : (
            <FlatList
              data={dataItems}
              renderItem={dataViewType === 'finishedJobs' ? renderJobItem : renderCertItem}
              keyExtractor={(item, idx) => `data-${item.id || idx}`}
              contentContainerStyle={[
                styles.dataListContent,
                dataItems.length === 0 && styles.dataListEmpty,
              ]}
              ListEmptyComponent={
                <View style={styles.dataEmptyState}>
                  <MaterialCommunityIcons
                    name={dataViewType === 'finishedJobs' ? 'briefcase-off-outline' : 'file-document-remove-outline'}
                    size={64}
                    color={colors.textLight}
                  />
                  <AppText style={[styles.dataEmptyText, { color: colors.textSecondary }]}>
                    {t.noDataFound}
                  </AppText>
                </View>
              }
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </AccessibleModal>

      {/* ==================== MODAL 3: Add/Edit Client ==================== */}
      <AccessibleModal
        visible={showModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowModal(false);
          resetForm();
        }}
        announcement={editingClient ? 'Edit client' : 'Add client'}
      >
        <ClientFormModalContent
          editingClient={editingClient}
          formData={formData}
          colors={colors}
          copy={t}
          loading={loading}
          removing={removeMutation.isPending}
          onChange={(field, value) => {
            setFormData((current) => ({ ...current, [field]: value }));
          }}
          onDelete={handleDelete}
          onCancel={() => {
            setShowModal(false);
            resetForm();
          }}
          onSave={handleSave}
        />
      </AccessibleModal>

      <GlobalHeader />
    </View>
  );
}
