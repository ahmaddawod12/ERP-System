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

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  ActivityIndicator,
  FlatList,
  ScrollView,
  TouchableWithoutFeedback,
  Dimensions,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getColors, gradients, spacing, borderRadius, typography, shadows } from '../theme';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { useAlert } from '../contexts/AlertContext';
import { useCache } from '../contexts/CacheContext';
import { AppText, GlobalHeader, ScrollableContainer } from '../components';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Document type codes (numeric)
const DOC_TYPE = {
  PRICE_PROPOSAL: 10,
  DELIVERY_NOTE: 200,
  RETURN_CERTIFICATE: 210,
  TAX_INVOICE: 305,
  REFUND: 330,
  RECEIPT: 400,
};

export default function ClientBook() {
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const insets = useSafeAreaInsets();
  const colors = getColors(isDarkMode);
  const {
    clients: cachedClients,
    addClient,
    updateClient,
    deleteClient,
    fetchClients,
    getDataForMonth,
    getUserRole,
  } = useCache();

  // --- Existing state ---
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    vatNumber: '',
  });

  // --- New state for client options & data viewer ---
  const [selectedClient, setSelectedClient] = useState(null);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showDataModal, setShowDataModal] = useState(false);
  const [dataViewType, setDataViewType] = useState('finishedJobs'); // 'finishedJobs' | 'documents'
  const [dataItems, setDataItems] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date());

  const isRTL = language === 'he' || language === 'ar';

  const t = language === 'en' ? {
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
    delete: 'Delete',
    deleteConfirm: 'Delete Client',
    deleteMessage: 'Are you sure you want to delete this client? This action cannot be undone.',
    clientSaved: 'Client saved successfully',
    clientUpdated: 'Client updated successfully',
    clientDeleted: 'Client deleted successfully',
    required: 'Client name is required',
    totalClients: 'clients',
    // New translations
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
    taxInvoice: 'Tax Invoice',
    priceProposal: 'Price Proposal',
    refund: 'Refund',
    returnCertificate: 'Return Certificate',
    receipt: 'Receipt',
    deliveryNote: 'Delivery Note',
    close: 'Close',
    partsUsed: 'Parts Used',
  } : language === 'he' ? {
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
    delete: 'מחק',
    deleteConfirm: 'מחיקת לקוח',
    deleteMessage: 'האם אתה בטוח שברצונך למחוק לקוח זה? פעולה זו לא ניתנת לביטול.',
    clientSaved: 'הלקוח נשמר בהצלחה',
    clientUpdated: 'הלקוח עודכן בהצלחה',
    clientDeleted: 'הלקוח נמחק בהצלחה',
    required: 'שם לקוח נדרש',
    totalClients: 'לקוחות',
    // New translations
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
    taxInvoice: 'חשבונית מס',
    priceProposal: 'הצעת מחיר',
    refund: 'זיכוי',
    returnCertificate: 'תעודת החזרה',
    receipt: 'קבלה',
    deliveryNote: 'תעודת משלוח',
    close: 'סגור',
    partsUsed: 'חלקים שנעשה בהם שימוש',
  } : {
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
    delete: 'حذف',
    deleteConfirm: 'حذف عميل',
    deleteMessage: 'هل أنت متأكد أنك تريد حذف هذا العميل؟ لا يمكن التراجع عن هذا الإجراء.',
    clientSaved: 'تم حفظ العميل بنجاح',
    clientUpdated: 'تم تحديث العميل بنجاح',
    clientDeleted: 'تم حذف العميل بنجاح',
    required: 'اسم العميل مطلوب',
    totalClients: 'عملاء',
    // New translations
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
    taxInvoice: 'فاتورة ضريبية',
    priceProposal: 'عرض سعر',
    refund: 'استرداد',
    returnCertificate: 'شهادة إرجاع',
    receipt: 'إيصال',
    deliveryNote: 'إشعار تسليم',
    close: 'إغلاق',
    partsUsed: 'الأجزاء المستخدمة',
  };

  // --- Helpers ---

  /** Format a Date to month/year display string */
  const formatMonth = useCallback((date) => {
    const monthNames = language === 'en'
      ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      : language === 'he'
        ? ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
        : ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    return `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
  }, [language]);

  /** Format a date field (handles ISO strings and Firestore Timestamps) */
  const formatDate = useCallback((dateInput) => {
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
  const getDocTypeLabel = useCallback((type) => {
    const numType = typeof type === 'string' ? parseInt(type, 10) : type;
    switch (numType) {
      case DOC_TYPE.TAX_INVOICE: return t.taxInvoice;
      case DOC_TYPE.PRICE_PROPOSAL: return t.priceProposal;
      case DOC_TYPE.REFUND: return t.refund;
      case DOC_TYPE.RETURN_CERTIFICATE: return t.returnCertificate;
      case DOC_TYPE.RECEIPT: return t.receipt;
      case DOC_TYPE.DELIVERY_NOTE: return t.deliveryNote;
      default: return `${type}`;
    }
  }, [t]);

  /** Get document type color */
  const getDocTypeColor = useCallback((type) => {
    const numType = typeof type === 'string' ? parseInt(type, 10) : type;
    switch (numType) {
      case DOC_TYPE.TAX_INVOICE: return '#10B981';
      case DOC_TYPE.PRICE_PROPOSAL: return '#3B82F6';
      case DOC_TYPE.REFUND: return '#F59E0B';
      case DOC_TYPE.RETURN_CERTIFICATE: return '#8B5CF6';
      case DOC_TYPE.RECEIPT: return '#06B6D4';
      case DOC_TYPE.DELIVERY_NOTE: return '#8B5CF6';
      default: return colors.textSecondary;
    }
  }, [colors]);

  /** Calculate total from income/items array */
  const calculateTotal = useCallback((income) => {
    if (!income || !Array.isArray(income)) return 0;
    return income.reduce((sum, item) => {
      const price = parseFloat(item.price) || 0;
      const quantity = parseFloat(item.quantity) || 1;
      return sum + (price * quantity);
    }, 0);
  }, []);

  // --- Fetch clients on mount ---
  useEffect(() => {
    if (cachedClients.length === 0) {
      fetchClients();
    }
  }, []);

  // --- Filter clients by search ---
  const filteredClients = useMemo(() => {
    if (!searchQuery.trim()) return cachedClients;
    const q = searchQuery.toLowerCase();
    const filtered = cachedClients.filter(client =>
      (client.name && client.name.toLowerCase().includes(q)) ||
      (client.phone && client.phone.toLowerCase().includes(q)) ||
      (client.email && client.email.toLowerCase().includes(q)) ||
      (client.address && client.address.toLowerCase().includes(q)) ||
      (client.city && client.city.toLowerCase().includes(q)) ||
      (client.vatNumber && client.vatNumber.toLowerCase().includes(q)) ||
      (client.id && client.id.toString().includes(q))
    );
    // Deduplicate by ID
    const seen = new Set();
    return filtered.filter(client => {
      if (seen.has(client.id)) return false;
      seen.add(client.id);
      return true;
    });
  }, [cachedClients, searchQuery]);

  // --- Form helpers ---
  const resetForm = () => {
    setFormData({ name: '', phone: '', email: '', address: '', city: '', vatNumber: '' });
    setEditingClient(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (client) => {
    setEditingClient(client);
    setFormData({
      name: client.name || '',
      phone: client.phone || '',
      email: client.email || '',
      address: client.address || '',
      city: client.city || '',
      vatNumber: client.vatNumber || '',
    });
    setShowOptionsModal(false);
    setShowModal(true);
  };

  // --- New: Client options flow ---

  /** Open options modal when pressing a client card */
  const openClientOptions = (client) => {
    setSelectedClient(client);
    setShowOptionsModal(true);
  };

  /** Fetch finished jobs or documents for the selected client & month */
  const fetchClientData = useCallback(async (client, type, monthDate) => {
    if (!client) return;
    setDataLoading(true);
    try {
      const allData = await getDataForMonth(monthDate, type);

      // Filter by client — match on clientId (primary) or clientName (fallback)
      const clientId = client.id?.toString();
      const clientName = client.name?.toLowerCase()?.trim();

      const matched = (allData || []).filter(item => {
        if (clientId && item.clientId?.toString() === clientId) return true;
        if (clientName && item.clientName?.toLowerCase()?.trim() === clientName) return true;
        // Also check customerName for jobs
        if (clientName && item.customerName?.toLowerCase()?.trim() === clientName) return true;
        return false;
      });

      // Sort by date descending
      const dateField = type === 'documents' ? 'createdAt' : 'finishedAt';
      matched.sort((a, b) => {
        const getTime = (d) => {
          if (!d) return 0;
          if (d.toDate && typeof d.toDate === 'function') return d.toDate().getTime();
          return new Date(d).getTime();
        };
        return getTime(b[dateField]) - getTime(a[dateField]);
      });

      setDataItems(matched);
    } catch (error) {
      console.error('Error fetching client data:', error);
      setDataItems([]);
    } finally {
      setDataLoading(false);
    }
  }, [getDataForMonth]);

  /** Open data viewer modal (finished jobs or documents) */
  const openDataViewer = useCallback((type) => {
    setDataViewType(type);
    setSelectedMonth(new Date());
    setDataItems([]);
    setShowOptionsModal(false);
    setShowDataModal(true);
    // Fetch data for current month
    fetchClientData(selectedClient, type, new Date());
  }, [selectedClient, fetchClientData]);

  /** Navigate to previous/next month */
  const handleMonthChange = useCallback((direction) => {
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
    setLoading(true);

    try {
      const clientData = {};
      if (formData.name.trim()) clientData.name = formData.name.trim();
      if (formData.phone.trim()) clientData.phone = formData.phone.trim();
      if (formData.email.trim()) clientData.email = formData.email.trim();
      if (formData.address.trim()) clientData.address = formData.address.trim();
      if (formData.city.trim()) clientData.city = formData.city.trim();
      if (formData.vatNumber.trim()) clientData.vatNumber = formData.vatNumber.trim();

      if (editingClient) {
        await updateClient(editingClient.id, clientData);
        alert.success('✅', t.clientUpdated);
      } else {
        await addClient(clientData);
        alert.success('✅', t.clientSaved);
      }

      setShowModal(false);
      resetForm();
    } catch (error) {
      console.error('Error saving client:', error);
      alert.error('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (client) => {
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
              await deleteClient(client.id);
              alert.success('✅', t.clientDeleted);
              if (showModal) {
                setShowModal(false);
                resetForm();
              }
            } catch (error) {
              console.error('Error deleting client:', error);
              alert.error('Error', error.message);
            }
          },
        },
      ]
    );
  };

  // --- Renderers ---

  /** Render a single finished job card in the data viewer */
  const renderJobItem = ({ item }) => (
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
              {t.partsUsed}: {item.parts.map(p => p.partName || p.name).filter(Boolean).join(', ')}
            </AppText>
          </View>
        )}
      </View>
    </View>
  );

  /** Render a single document card in the data viewer */
  const renderCertItem = ({ item }) => {
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
          {item.clientName && (
            <View style={styles.dataDetailRow}>
              <Ionicons name="person-outline" size={14} color={colors.textSecondary} />
              <AppText style={[styles.dataDetailText, { color: colors.textSecondary }]} numberOfLines={1}>
                {item.clientName}
              </AppText>
            </View>
          )}
        </View>
      </View>
    );
  };

  /** Render client card in main list */
  const renderClientCard = ({ item: client }) => (
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
              <AppText style={[styles.idBadgeText, { color: colors.secondary }]}>#{client.id}</AppText>
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
    </View>
  );

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
                {cachedClients.length} {t.totalClients}
              </AppText>
            </View>
            <TouchableOpacity
              style={styles.addButton}
              onPress={openAddModal}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={28} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>

      {/* Search Bar */}
      <View style={[styles.searchWrapper, { backgroundColor: colors.background }]}>
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialCommunityIcons name="book-account-outline" size={20} color={colors.secondary} />
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.textPrimary }]}
            placeholder={t.searchPlaceholder}
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Client List */}
      <FlatList
        data={filteredClients}
        renderItem={renderClientCard}
        keyExtractor={(item, index) => `client-${item.id}-${index}-${item.name?.substring(0, 3) || 'x'}`}
        contentContainerStyle={[
          styles.listContent,
          filteredClients.length === 0 && styles.listContentEmpty,
        ]}
        ListEmptyComponent={renderEmptyState}
        showsVerticalScrollIndicator={false}
      />

      {/* ==================== MODAL 1: Client Options ==================== */}
      <Modal
        visible={showOptionsModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowOptionsModal(false)}
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
                    onPress={() => openEditModal(selectedClient)}
                    activeOpacity={0.7}
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
      </Modal>

      {/* ==================== MODAL 2: Data Viewer (Jobs / Documents) ==================== */}
      <Modal
        visible={showDataModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowDataModal(false)}
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
      </Modal>

      {/* ==================== MODAL 3: Add/Edit Client ==================== */}
      <Modal
        visible={showModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowModal(false);
          resetForm();
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <LinearGradient
                  colors={editingClient ? gradients.secondary : gradients.primary}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.modalHeaderGradient}
                >
                  <MaterialCommunityIcons
                    name={editingClient ? 'account-edit' : 'account-plus'}
                    size={28}
                    color="white"
                  />
                  <AppText style={styles.modalTitle}>
                    {editingClient ? t.editClient : t.addClient}
                  </AppText>
                </LinearGradient>
              </View>

              {/* Form */}
              <ScrollView
                style={styles.formScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* Name */}
                <View style={styles.formField}>
                  <View style={styles.fieldLabelRow}>
                    <Ionicons name="person" size={16} color={colors.secondary} />
                    <AppText style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                      {t.name} *
                    </AppText>
                  </View>
                  <TextInput
                    style={[styles.formInput, {
                      backgroundColor: colors.backgroundLight,
                      borderColor: formData.name ? colors.secondary : colors.border,
                      color: colors.textPrimary,
                    }]}
                    placeholder={t.name}
                    placeholderTextColor={colors.textLight}
                    value={formData.name}
                    onChangeText={(text) => setFormData({ ...formData, name: text })}
                    autoFocus={!editingClient}
                  />
                </View>

                {/* Phone */}
                <View style={styles.formField}>
                  <View style={styles.fieldLabelRow}>
                    <Ionicons name="call" size={16} color={colors.secondary} />
                    <AppText style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                      {t.phone}
                    </AppText>
                  </View>
                  <TextInput
                    style={[styles.formInput, {
                      backgroundColor: colors.backgroundLight,
                      borderColor: formData.phone ? colors.secondary : colors.border,
                      color: colors.textPrimary,
                    }]}
                    placeholder={t.phone}
                    placeholderTextColor={colors.textLight}
                    value={formData.phone}
                    onChangeText={(text) => setFormData({ ...formData, phone: text })}
                    keyboardType="phone-pad"
                  />
                </View>

                {/* Email */}
                <View style={styles.formField}>
                  <View style={styles.fieldLabelRow}>
                    <Ionicons name="mail" size={16} color={colors.secondary} />
                    <AppText style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                      {t.email}
                    </AppText>
                  </View>
                  <TextInput
                    style={[styles.formInput, {
                      backgroundColor: colors.backgroundLight,
                      borderColor: formData.email ? colors.secondary : colors.border,
                      color: colors.textPrimary,
                    }]}
                    placeholder={t.email}
                    placeholderTextColor={colors.textLight}
                    value={formData.email}
                    onChangeText={(text) => setFormData({ ...formData, email: text })}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>

                {/* Address */}
                <View style={styles.formField}>
                  <View style={styles.fieldLabelRow}>
                    <Ionicons name="location" size={16} color={colors.secondary} />
                    <AppText style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                      {t.address}
                    </AppText>
                  </View>
                  <TextInput
                    style={[styles.formInput, {
                      backgroundColor: colors.backgroundLight,
                      borderColor: formData.address ? colors.secondary : colors.border,
                      color: colors.textPrimary,
                    }]}
                    placeholder={t.address}
                    placeholderTextColor={colors.textLight}
                    value={formData.address}
                    onChangeText={(text) => setFormData({ ...formData, address: text })}
                  />
                </View>

                {/* City */}
                <View style={styles.formField}>
                  <View style={styles.fieldLabelRow}>
                    <MaterialCommunityIcons name="city" size={16} color={colors.secondary} />
                    <AppText style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                      {t.city}
                    </AppText>
                  </View>
                  <TextInput
                    style={[styles.formInput, {
                      backgroundColor: colors.backgroundLight,
                      borderColor: formData.city ? colors.secondary : colors.border,
                      color: colors.textPrimary,
                    }]}
                    placeholder={t.city}
                    placeholderTextColor={colors.textLight}
                    value={formData.city}
                    onChangeText={(text) => setFormData({ ...formData, city: text })}
                  />
                </View>

                {/* VAT Number */}
                <View style={styles.formField}>
                  <View style={styles.fieldLabelRow}>
                    <MaterialCommunityIcons name="file-document-outline" size={16} color={colors.secondary} />
                    <AppText style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                      {t.vatNumber}
                    </AppText>
                  </View>
                  <TextInput
                    style={[styles.formInput, {
                      backgroundColor: colors.backgroundLight,
                      borderColor: formData.vatNumber ? colors.secondary : colors.border,
                      color: colors.textPrimary,
                    }]}
                    placeholder={t.vatNumber}
                    placeholderTextColor={colors.textLight}
                    value={formData.vatNumber}
                    onChangeText={(text) => setFormData({ ...formData, vatNumber: text })}
                    keyboardType="numeric"
                  />
                </View>
              </ScrollView>

              {/* Action Buttons */}
              <View style={styles.modalActions}>
                {editingClient && (
                  <TouchableOpacity
                    style={[styles.deleteButton, { borderColor: colors.error }]}
                    onPress={() => handleDelete(editingClient)}
                  >
                    <Ionicons name="trash-outline" size={20} color={colors.error} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.cancelButton, { borderColor: colors.border, flex: 1 }]}
                  onPress={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                >
                  <AppText style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{t.cancel}</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveButtonWrapper, { flex: 1 }]}
                  onPress={handleSave}
                  disabled={loading}
                >
                  <LinearGradient
                    colors={editingClient ? gradients.secondary : gradients.primary}
                    style={styles.saveButton}
                  >
                    {loading ? (
                      <ActivityIndicator color="white" size="small" />
                    ) : (
                      <>
                        <Ionicons name="checkmark" size={20} color="white" />
                        <AppText style={styles.saveButtonText}>{t.save}</AppText>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Header
  headerContainer: {
    zIndex: 1,
  },
  headerGradient: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomLeftRadius: borderRadius.xl,
    borderBottomRightRadius: borderRadius.xl,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: typography.xxl + 2,
    fontWeight: typography.bold,
    color: 'white',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: typography.sm,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.md,
  },
  // Search
  searchWrapper: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    height: 48,
    gap: spacing.xs,
    ...shadows.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.base,
    paddingVertical: 0,
  },
  // List
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl + 20,
  },
  listContentEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  // Client Card
  clientCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  clientCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clientAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  clientCardInfo: {
    flex: 1,
  },
  clientNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 3,
  },
  clientName: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    flex: 1,
  },
  idBadge: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  idBadgeText: {
    fontSize: typography.xs - 1,
    fontWeight: typography.bold,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  clientDetail: {
    fontSize: typography.xs,
    flex: 1,
  },
  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl * 2,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    marginTop: spacing.sm,
  },
  emptyDesc: {
    fontSize: typography.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
  },

  // ====================== Options Modal ======================
  optionsOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: spacing.lg,
  },
  optionsContainer: {
    width: '100%',
    maxWidth: 400,
    borderRadius: borderRadius.xl + 4,
    overflow: 'hidden',
    ...shadows.lg,
  },
  optionsHeader: {
    overflow: 'hidden',
  },
  optionsHeaderGradient: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  optionsHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  optionsHeaderTitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    color: 'white',
  },
  optionsHeaderSubtitle: {
    fontSize: typography.xs,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  optionsButtonList: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    gap: spacing.md,
  },
  optionIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionButtonTitle: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
  },

  // ====================== Data Modal ======================
  dataModalContainer: {
    flex: 1,
  },
  dataModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  dataModalClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dataModalTitle: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: 'rgba(255,255,255,0.85)',
  },
  dataModalSubtitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    color: 'white',
  },
  // Month Navigator
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    ...shadows.sm,
  },
  monthNavButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  monthNavCenter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  monthNavText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  // Data Cards
  dataListContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.xs,
  },
  dataListEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  dataCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  dataCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  dataCardTitle: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  statusBadgeText: {
    fontSize: typography.xs,
    fontWeight: typography.bold,
  },
  docTypeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  docTypeBadgeText: {
    fontSize: typography.xs,
    fontWeight: typography.bold,
  },
  docNumberText: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
  },
  amountText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  dataCardDetails: {
    marginTop: spacing.sm,
    gap: 4,
  },
  dataDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dataDetailText: {
    fontSize: typography.sm,
    flex: 1,
  },
  dataLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dataEmptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl * 2,
    gap: spacing.md,
  },
  dataEmptyText: {
    fontSize: typography.base,
    textAlign: 'center',
  },

  // ====================== Add/Edit Modal ======================
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContainer: {
    borderTopLeftRadius: borderRadius.xl + 4,
    borderTopRightRadius: borderRadius.xl + 4,
    maxHeight: '85%',
    ...shadows.lg,
  },
  modalHeader: {
    overflow: 'hidden',
    borderTopLeftRadius: borderRadius.xl + 4,
    borderTopRightRadius: borderRadius.xl + 4,
  },
  modalHeaderGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  modalTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: 'white',
  },
  // Form
  formScroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  formField: {
    marginBottom: spacing.md,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  formInput: {
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    fontSize: typography.base,
  },
  // Actions
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  deleteButton: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    height: 48,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  saveButtonWrapper: {
    height: 48,
  },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  saveButtonText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    color: 'white',
  },
});

