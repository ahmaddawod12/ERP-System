import React, { useState, useEffect, memo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
  Linking,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getColors, spacing, borderRadius, typography, shadows, gradients } from '../../../theme';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { useScrollHandler } from '../../../contexts/HeaderContext';
import { AppText, AppButton, GlobalHeader, DateFilter, ClientSelectorModal, ScreenHeroCard } from '../../../components';
import { auth, functions, httpsCallable } from '../../../firebase';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { DocTypeCode, DateLike, AppDocument } from '../../../types';
import type { DateFilterRange } from '../../../components/forms/DateFilter';
import { DOC_TYPE, DOC_COLORS, DOC_GRADIENTS, DOC_ICONS, getDocumentLabel } from '@smart-job/contracts';
import { getDocumentDownloadUrl } from '../lib/document-download';
import { ROUTES } from '../../../navigation/routes';
import { styles } from './DocumentHistory.styles';

import { getDateLikeTime, type DocumentDateFilter, type DocumentHistoryRecord, type DocumentLineItem, type DocumentTypeFilter, type DocumentTypeOption } from '../lib/document-history-model';

interface DocumentRowProps {
  doc: DocumentHistoryRecord;
  docTypeLabel: string;
  docTypeIcon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  docTypeColor: string;
  colors: ReturnType<typeof getColors>;
  t: Record<string, string>;
  onView: (doc: DocumentHistoryRecord) => void;
  onDownload: (doc: DocumentHistoryRecord) => void;
  onShare: (doc: DocumentHistoryRecord) => void;
  isDownloading: boolean;
  isSharing: boolean;
  formatDate: (dateInput: DateLike | null | undefined) => string;
  formatAmount: (amount: number | string | null | undefined) => string;
}

const DocumentRow = memo(function DocumentRow({
  doc,
  docTypeLabel,
  docTypeIcon,
  docTypeColor,
  colors,
  t,
  onView,
  onDownload,
  onShare,
  isDownloading,
  isSharing,
  formatDate,
  formatAmount,
}: DocumentRowProps) {
  return (
    <View style={[styles.documentCard, { backgroundColor: colors.surface }]}>
      <View style={styles.documentHeader}>
        <View style={styles.documentTitleRow}>
          <MaterialCommunityIcons
            name={docTypeIcon}
            size={32}
            color={docTypeColor}
          />
          <View style={styles.documentTitleInfo}>
            <AppText style={[styles.documentType, { color: colors.textPrimary }]}>
              {docTypeLabel}
            </AppText>
            <AppText style={[styles.documentDate, { color: colors.textSecondary }]}>
              {t.createdOn}: {formatDate(doc.createdAt)}
            </AppText>
          </View>
        </View>
      </View>

      <View style={styles.documentDetails}>
        {doc.cname && (
          <View style={styles.detailRow}>
            <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
            <AppText style={[styles.detailText, { color: colors.textPrimary }]}>
              {t.client}: {String(doc.cname || '')}
            </AppText>
          </View>
        )}
        {(doc.createdByName || doc.createdByUid) && (
          <View style={styles.detailRow}>
            <Ionicons name="person-circle-outline" size={16} color={colors.textSecondary} />
            <AppText style={[styles.detailText, { color: colors.textPrimary }]}>
              {t.createdBy}: {String(doc.createdByName || doc.createdByUid || '')}
            </AppText>
          </View>
        )}
        {doc.total != null && (
          <View style={styles.detailRow}>
            <Ionicons name="cash-outline" size={16} color={colors.textSecondary} />
            <AppText style={[styles.detailText, { color: colors.textPrimary }]}>
              {t.total}: {formatAmount(doc.total)}
            </AppText>
          </View>
        )}
        {doc.description && (
          <AppText style={[styles.documentDescription, { color: colors.textSecondary }]} numberOfLines={2}>
            {doc.description}
          </AppText>
        )}
      </View>

      <View style={styles.documentActions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonThree, { backgroundColor: colors.primary }]}
          onPress={() => onView(doc)}
        >
          <Ionicons name="eye-outline" size={18} color="white" />
          <AppText style={styles.actionButtonText}>{t.view}</AppText>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonThree, { backgroundColor: colors.secondary }]}
          onPress={() => onDownload(doc)}
          disabled={isDownloading}
        >
          {isDownloading ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <>
              <Ionicons name="download-outline" size={18} color="white" />
              <AppText style={styles.actionButtonText}>{t.download}</AppText>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonThree, { backgroundColor: '#25D366' }]}
          onPress={() => onShare(doc)}
          disabled={isSharing}
        >
          {isSharing ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <>
              <Ionicons name="share-social-outline" size={18} color="white" />
              <AppText style={styles.actionButtonText}>{t.share}</AppText>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default function DocumentHistory() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { scrollProps } = useScrollHandler();
  const {
    getCompanyId,
    documents: cachedDocuments,
    clients: cachedClients,
    fetchClients,
    refreshCache,
    getDataForDateRange,
    getDataForMonth,
    isWithinCacheRange,
  } = useCache();
  const colors = getColors(isDarkMode);

  const PAGE_SIZE = 50;
  const [documents, setDocuments] = useState<DocumentHistoryRecord[]>([]);
  const [filteredDocuments, setFilteredDocuments] = useState<DocumentHistoryRecord[]>([]);
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDocType, setSelectedDocType] = useState<DocumentTypeFilter>('all');
  const [selectedDocument] = useState<DocumentHistoryRecord | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [downloadingDoc, setDownloadingDoc] = useState<string | null>(null);
  const [sharingDoc, setSharingDoc] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFilter, setDateFilter] = useState<DocumentDateFilter>({
    type: 'last7days',
    startDate: new Date(new Date().setDate(new Date().getDate() - 7)),
    endDate: (() => {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      return today;
    })(),
    label: 'Last 7 Days',
  });
  const [clientFilter, setClientFilter] = useState('');
  const [showClientSelector, setShowClientSelector] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState('');

  const t = (language === 'en' ? {
    title: 'Document History',
    back: 'Back',
    filterByType: 'Filter by Type',
    filterByDate: 'Filter by Date',
    filterByClient: 'Filter by Client Name',
    searchClients: 'Search clients...',
    noClients: 'No clients found',
    noSearchResults: 'No clients match your search',
    clearFilter: 'Clear Filter',
    all: 'All Documents',
    clearDate: 'Clear Filter',
    search: 'Search by client name, description...',
    noDocuments: 'No documents found',
    createdOn: 'Created',
    client: 'Client',
    createdBy: 'Created By',
    amount: 'Amount',
    view: 'View',
    download: 'Download',
    share: 'Share',
    delete: 'Delete',
    deleteConfirm: 'Are you sure you want to delete this document? This action cannot be undone.',
    deleteSuccess: 'Document deleted successfully',
    deleteError: 'Failed to delete document',
    close: 'Close',
    downloading: 'Downloading...',
    downloadComplete: 'Download Complete',
    downloadError: 'Download Failed',
    shareError: 'Share Failed',
    pdfNotAvailable: 'PDF not available for this document',
    documentDetails: 'Document Details',
    type: 'Type',
    date: 'Date',
    description: 'Description',
    total: 'Total',
  } : language === 'he' ? {
    title: 'היסטוריית מסמכים',
    back: 'חזרה',
    filterByType: 'סנן לפי סוג',
    filterByDate: 'סנן לפי חודש',
    filterByClient: 'סינון לפי לקוח',
    searchClients: 'חיפוש לקוחות...',
    noClients: 'לא נמצאו לקוחות',
    noSearchResults: 'לא נמצאו לקוחות התואמים לחיפוש',
    clearFilter: 'נקה סינון',
    all: 'כל המסמכים',
    clearDate: 'נקה סינון',
    startDate: 'תאריך התחלה',
    endDate: 'תאריך סיום',
    search: 'חיפוש לפי שם לקוח, תיאור...',
    noDocuments: 'לא נמצאו מסמכים',
    createdOn: 'נוצר',
    createdBy: 'נוצר על ידי',
    client: 'לקוח',
    amount: 'סכום',
    view: 'צפייה',
    download: 'הורדה',
    share: 'שיתוף',
    delete: 'מחיקה',
    deleteConfirm: 'האם אתה בטוח שברצונך למחוק מסמך זה? פעולה זו אינה ניתנת לביטול.',
    deleteSuccess: 'המסמך נמחק בהצלחה',
    deleteError: 'מחיקת המסמך נכשלה',
    close: 'סגור',
    downloading: 'מוריד...',
    downloadComplete: 'ההורדה הושלמה',
    downloadError: 'ההורדה נכשלה',
    shareError: 'השיתוף נכשל',
    pdfNotAvailable: 'PDF אינו זמין למסמך זה',
    documentDetails: 'פרטי מסמך',
    type: 'סוג',
    date: 'תאריך',
    description: 'תיאור',
    total: 'סה"כ',
  } : {
    title: 'سجل المستندات',
    back: 'رجوع',
    filterByType: 'تصفية حسب النوع',
    filterByDate: 'تصفية حسب الشهر',
    filterByClient: 'تصفية حسب العميل',
    searchClients: 'البحث عن العملاء...',
    noClients: 'لم يتم العثور على عملاء',
    noSearchResults: 'لا يوجد عملاء مطابقين للبحث',
    clearFilter: 'مسح التصفية',
    all: 'جميع المستندات',
    clearDate: 'مسح الفلتر',
    startDate: 'تاريخ البدء',
    endDate: 'تاريخ الانتهاء',
    search: 'البحث عن طريق اسم العميل، الوصف...',
    noDocuments: 'لم يتم العثور على مستندات',
    createdOn: 'تم الإنشاء',
    createdBy: 'أنشئ بواسطة',
    client: 'العميل',
    amount: 'المبلغ',
    view: 'عرض',
    download: 'تحميل',
    share: 'مشاركة',
    delete: 'حذف',
    deleteConfirm: 'هل أنت متأكد من حذف هذا المستند؟ لا يمكن التراجع عن هذا الإجراء.',
    deleteSuccess: 'تم حذف المستند بنجاح',
    deleteError: 'فشل حذف المستند',
    close: 'إغلاق',
    downloading: 'جاري التحميل...',
    downloadComplete: 'اكتمل التحميل',
    downloadError: 'فشل التحميل',
    shareError: 'فشل المشاركة',
    pdfNotAvailable: 'PDF غير متاح لهذا المستند',
    documentDetails: 'تفاصيل المستند',
    type: 'النوع',
    date: 'التاريخ',
    description: 'الوصف',
    total: 'المجموع',
  }) as Record<string, string>;

  const documentTypes: DocumentTypeOption[] = [
    { id: 'all', label: t.all, icon: 'file-document-multiple', color: '#6B7280', gradient: ['#6B7280', '#4B5563'] },
    ...(Object.values(DOC_TYPE) as DocTypeCode[]).map((code) => ({
      id: code,
      label: getDocumentLabel(code, language),
      icon: DOC_ICONS[code],
      color: DOC_COLORS[code],
      gradient: DOC_GRADIENTS[code],
    })),
  ];

  useEffect(() => {
    loadDocuments();
  }, [cachedDocuments]);

  useEffect(() => {
    applyFilters();
    setDisplayLimit(PAGE_SIZE);
  }, [documents, selectedDocType, dateFilter, clientFilter]);

  const calculateTotal = (income?: DocumentLineItem[]) => {
    if (!income || !Array.isArray(income)) return 0;
    return income.reduce((sum, item) => {
      const price = Number.parseFloat(String(item.price ?? 0)) || 0;
      const quantity = Number.parseFloat(String(item.quantity ?? 1)) || 1;
      return sum + (price * quantity);
    }, 0);
  };

  const getDescriptionFromIncome = (income?: DocumentLineItem[]) => {
    if (!income || !Array.isArray(income) || income.length === 0) return '';
    return income.map(item => item.description).filter(Boolean).join(', ');
  };

  const loadDocuments = async () => {
    try {
      setLoadError(null);
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }

      const companyId = getCompanyId();

      if (!companyId) {
        console.log('No company name found');
        setDocuments([]);
        setLoading(false);
        return;
      }

      if (cachedDocuments && cachedDocuments.length > 0) {
        console.log('📦 [CACHE READ] DocumentHistory - documents from cache:', cachedDocuments.length);
        const docs: DocumentHistoryRecord[] = cachedDocuments.map((data) => {
          return {
            ...data,
            id: data.id,
            type: data.type,
            total: calculateTotal((data as DocumentHistoryRecord).income || data.items),
            description: getDescriptionFromIncome((data as DocumentHistoryRecord).income || data.items) || (data as DocumentHistoryRecord).notes,
            documentNumber: (data as DocumentHistoryRecord).documentNumber || (data as DocumentHistoryRecord).number || data.id,
          };
        });

        docs.sort((a, b) => {
          const dateA = getDateLikeTime(a.createdAt);
          const dateB = getDateLikeTime(b.createdAt);
          return dateB - dateA;
        });

        setDocuments(docs);
        setLoading(false);
        return;
      }

      console.log('No cached documents available, cache may not be initialized');
      setDocuments([]);
      setLoading(false);
    } catch (error) {
      console.error('Error loading documents:', error);
      setDocuments([]);
      setLoadError(error instanceof Error ? error.message : String(error));
      setLoading(false);
    }
  };

  const applyFilters = async () => {
    let filtered = [...documents];

    if (selectedDocType !== 'all') {
      filtered = filtered.filter(doc => doc.type === selectedDocType);
    }

    if (dateFilter.startDate && dateFilter.endDate) {
      const startInCache = isWithinCacheRange(dateFilter.startDate);

      if (!startInCache) {
        try {
          const smartData = await getDataForDateRange(dateFilter.startDate, dateFilter.endDate, 'documents');

          filtered = smartData.map((data): DocumentHistoryRecord => ({
            id: data.id,
            ...data,
            type: data.type,
            total: calculateTotal((data as DocumentHistoryRecord).income || data.items),
            description: getDescriptionFromIncome((data as DocumentHistoryRecord).income || data.items) || (data as DocumentHistoryRecord).notes,
            documentNumber: (data as DocumentHistoryRecord).documentNumber || (data as DocumentHistoryRecord).number || data.id,
          }));

          if (selectedDocType !== 'all') {
            filtered = filtered.filter(doc => doc.type === selectedDocType);
          }
        } catch (error) {
          console.error('Error fetching data for date range:', error);
        }
      } else {
        const start = new Date(dateFilter.startDate.getFullYear(), dateFilter.startDate.getMonth(), dateFilter.startDate.getDate()).getTime();
        const end = new Date(dateFilter.endDate.getFullYear(), dateFilter.endDate.getMonth(), dateFilter.endDate.getDate(), 23, 59, 59).getTime();

        filtered = filtered.filter(doc => {
          const docDate = getDateLikeTime(doc.createdAt);
          return docDate >= start && docDate <= end;
        });
      }
    } else {
      if (dateFilter.startDate) {
        const start = new Date(dateFilter.startDate.getFullYear(), dateFilter.startDate.getMonth(), dateFilter.startDate.getDate()).getTime();
        filtered = filtered.filter(doc => {
          const docDate = getDateLikeTime(doc.createdAt);
          return docDate >= start;
        });
      }

      if (dateFilter.endDate) {
        const end = new Date(dateFilter.endDate.getFullYear(), dateFilter.endDate.getMonth(), dateFilter.endDate.getDate(), 23, 59, 59).getTime();
        filtered = filtered.filter(doc => {
          const docDate = getDateLikeTime(doc.createdAt);
          return docDate <= end;
        });
      }
    }

    if (clientFilter.trim()) {
      const query = clientFilter.toLowerCase();
      filtered = filtered.filter(doc =>
        (doc.cname && doc.cname.toLowerCase().includes(query))
      );
    }

    setFilteredDocuments(filtered);
  };

  const resolveDocumentUrl = async (doc: DocumentHistoryRecord) => {
    const companyId = getCompanyId();
    const documentId = doc.documentId || doc.id;
    if (!doc.storagePath || !companyId || !documentId) {
      throw new Error(t.pdfNotAvailable);
    }

    return getDocumentDownloadUrl(companyId, documentId);
  };

  const getDocTypeName = (type: DocumentTypeFilter) => {
    const numericType = typeof type === 'number' ? type : Number(type);
    switch (numericType) {
      case DOC_TYPE.TAX_INVOICE: return 'TaxInvoice';
      case DOC_TYPE.RECEIPT: return 'Receipt';
      case DOC_TYPE.PRICE_PROPOSAL: return 'PriceProposal';
      case DOC_TYPE.DELIVERY_NOTE: return 'DeliveryNote';
      case DOC_TYPE.RETURN_CERTIFICATE: return 'ReturnCertificate';
      case DOC_TYPE.REFUND: return 'Refund';
      default: return 'Document';
    }
  };

  const getDocTypeIcon = (type: DocumentTypeFilter): React.ComponentProps<typeof MaterialCommunityIcons>['name'] => {
    const numericType = typeof type === 'number' ? type : Number(type);
    return DOC_ICONS[numericType as DocTypeCode] || 'file-document';
  };

  const getDocTypeColor = (type: DocumentTypeFilter) => {
    const numericType = typeof type === 'number' ? type : Number(type);
    return DOC_COLORS[numericType as DocTypeCode] || colors.primary;
  };

  const formatDate = useCallback((dateInput: DateLike | null | undefined) => {
    if (!dateInput) return 'N/A';

    if (typeof (dateInput as { toDate?: () => Date }).toDate === 'function') {
      const date = (dateInput as { toDate: () => Date }).toDate();
      return date.toLocaleDateString(language === 'he' ? 'he-IL' : 'en-US');
    }

    const dateString = String(dateInput);
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'N/A';
      return date.toLocaleDateString(language === 'en' ? 'en-US' : language === 'he' ? 'he-IL' : 'ar-SA');
    } catch (_error) {
      return 'N/A';
    }
  }, [language]);

  const formatAmount = useCallback((amount: number | string | null | undefined) => {
    if (amount == null || amount === '' || Number.isNaN(Number(amount))) return 'N/A';
    try {
      return `₪${Number.parseFloat(String(amount)).toFixed(2)}`;
    } catch (_error) {
      return 'N/A';
    }
  }, []);

  const handleView = useCallback((doc: DocumentHistoryRecord) => {
    router.push({
      pathname: ROUTES.viewDocument,
      params: {
        document: JSON.stringify(doc),
      },
    });
  }, [router]);

  const handleDownload = useCallback(async (doc: DocumentHistoryRecord) => {
    try {
      setDownloadingDoc(doc.id);
      const url = await resolveDocumentUrl(doc);

      const filename = `${getDocTypeName(doc.type)}_${doc.documentNumber || doc.id}.pdf`;
      const fileUri = FileSystem.documentDirectory + filename;

      const downloadResult = await FileSystem.downloadAsync(url, fileUri);

      if (downloadResult.status === 200) {
        if (Platform.OS === 'ios') {
          const isAvailable = await Sharing.isAvailableAsync();
          if (isAvailable) {
            await Sharing.shareAsync(downloadResult.uri, {
              mimeType: 'application/pdf',
              dialogTitle: t.download,
              UTI: 'com.adobe.pdf',
            });
          }
        } else {
          try {
            await Linking.openURL(`file://${downloadResult.uri}`);
          } catch (_linkError) {
            alert.success(t.downloadComplete, `${t.download}: ${filename}`);
          }
        }
        alert.success(t.downloadComplete, filename);
      } else {
        alert.error('Error', t.downloadError);
      }
    } catch (error) {
      console.error('Error downloading document:', error);
      alert.error(t.downloadError, error instanceof Error ? error.message : String(error));
    } finally {
      setDownloadingDoc(null);
    }
  }, [alert, t]);

  const handleShare = useCallback(async (doc: DocumentHistoryRecord) => {
    try {
      setSharingDoc(doc.id);
      const url = await resolveDocumentUrl(doc);

      const filename = `${getDocTypeName(doc.type)}_${doc.documentNumber || doc.id}.pdf`;
      const fileUri = FileSystem.cacheDirectory + filename;

      const downloadResult = await FileSystem.downloadAsync(url, fileUri);

      if (downloadResult.status === 200) {
        const isAvailable = await Sharing.isAvailableAsync();

        if (isAvailable) {
          await Sharing.shareAsync(downloadResult.uri, {
            mimeType: 'application/pdf',
            dialogTitle: t.share,
            UTI: 'com.adobe.pdf',
          });
        } else {
          await Linking.openURL(url);
        }
      } else {
        alert.error('Error', t.shareError);
      }
    } catch (error) {
      console.error('Error sharing document:', error);
      alert.error(t.shareError, error instanceof Error ? error.message : String(error));
    } finally {
      setSharingDoc(null);
    }
  }, [alert, t]);

  const handleDelete = async (document: DocumentHistoryRecord) => {
    try {
      const companyId = getCompanyId();

      if (!companyId) {
        alert.error('Error', 'Company name not found');
        return;
      }

      alert.confirm(
        t.delete,
        t.deleteConfirm,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => {},
          },
          {
            text: t.delete,
            style: 'destructive',
            onPress: async () => {
              try {
                const deleteDocumentFn = httpsCallable(functions, 'deleteDocumentV1');
                await deleteDocumentFn({ companyId, documentId: document.id });
                alert.success(t.deleteSuccess || 'Success', t.deleteSuccess);
              } catch (error) {
                console.error('Error deleting document:', error);
                alert.error(t.deleteError || 'Error', error instanceof Error ? error.message : String(error));
              }
            },
          },
        ]
      );
    } catch (error) {
      console.error('Error in handleDelete:', error);
      alert.error('Error', error instanceof Error ? error.message : String(error));
    }
  };

  const displayedDocuments = filteredDocuments.slice(0, displayLimit);

  const renderItem = useCallback(({ item }: { item: DocumentHistoryRecord }) => {
    const typeOption = documentTypes.find(t => t.id === item.type);
    return (
      <DocumentRow
        doc={item}
        docTypeLabel={typeOption?.label || String(item.type || 'Document')}
        docTypeIcon={getDocTypeIcon(item.type)}
        docTypeColor={getDocTypeColor(item.type)}
        colors={colors}
        t={t}
        onView={handleView}
        onDownload={handleDownload}
        onShare={handleShare}
        isDownloading={downloadingDoc === item.id}
        isSharing={sharingDoc === item.id}
        formatDate={formatDate}
        formatAmount={formatAmount}
      />
    );
  }, [colors, t, documentTypes, downloadingDoc, sharingDoc, handleView, handleDownload, handleShare]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <AppText style={[styles.loadingText, { color: colors.textPrimary }]}>Loading documents...</AppText>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: colors.background }]}>
        <MaterialCommunityIcons name="alert-circle-outline" size={42} color={colors.error} />
        <AppText style={[styles.loadingText, { color: colors.textPrimary }]}>Failed to load documents</AppText>
        <AppText style={[styles.errorText, { color: colors.textSecondary }]}>{loadError}</AppText>
        <View style={styles.retryButtonWrap}>
          <AppButton
            title={language === 'he' ? 'נסה שוב' : language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            onPress={() => {
              setLoading(true);
              void loadDocuments();
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      <FlatList
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: 120, paddingBottom: insets.bottom + 20 }]}
        data={displayedDocuments}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        ListHeaderComponent={
          <View>
            <ScreenHeroCard
              title={t.title}
              subtitle={language === 'he' ? 'סקירה, סינון והורדה של מסמכים קיימים' : language === 'ar' ? 'مراجعة المستندات الحالية وتصفيتها وتنزيلها' : 'Review, filter, and download existing documents'}
              eyebrow="History"
              icon="history"
              iconLibrary="material"
              accentColor={colors.boxBlue}
              metrics={[
                { label: t.all, value: String(documents.length) },
                { label: language === 'he' ? 'מוצג' : language === 'ar' ? 'المعروض' : 'Shown', value: String(filteredDocuments.length) },
              ]}
              badges={[t.filterByType, t.filterByDate]}
              style={styles.heroCard}
            />

            {/* Filters Section */}
            <View style={[styles.filtersContainer, { backgroundColor: colors.surface }]}>
              {/* Document Type Filter */}
              <AppText style={[styles.filterLabel, { color: colors.textPrimary }]}>{t.filterByType}</AppText>
              <TouchableOpacity
                style={[styles.dropdownButton, {
                  backgroundColor: colors.background,
                  borderColor: dropdownOpen ? colors.primary : colors.border,
                }]}
                onPress={() => setDropdownOpen(!dropdownOpen)}
                activeOpacity={0.7}
              >
                <View style={styles.dropdownButtonContent}>
                  {(() => {
                    const selected = documentTypes.find(t => t.id === selectedDocType);
                    if (selected && selected.id !== 'all') {
                      return (
                        <View style={[styles.selectedIconCircle, { backgroundColor: selected.color + '20' }]}>
                          <MaterialCommunityIcons
                            name={selected.icon}
                            size={22}
                            color={selected.color}
                          />
                        </View>
                      );
                    }
                    return (
                      <MaterialCommunityIcons
                        name="file-document"
                        size={22}
                        color={colors.textSecondary}
                      />
                    );
                  })()}
                  <AppText style={[styles.dropdownText, { color: colors.textPrimary }]}>
                    {documentTypes.find(t => t.id === selectedDocType)?.label || t.all}
                  </AppText>
                </View>
                <MaterialCommunityIcons
                  name={dropdownOpen ? "chevron-up" : "chevron-down"}
                  size={24}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>

              {/* Dropdown Options */}
              {dropdownOpen && (
                <View style={[styles.dropdownOptions, { backgroundColor: colors.surface }]}>
                  {documentTypes.map((type, index) => (
                    <TouchableOpacity
                      key={type.id}
                      style={[
                        styles.dropdownOption,
                        index !== documentTypes.length - 1 && styles.dropdownOptionBorder,
                        { borderBottomColor: colors.border },
                        selectedDocType === type.id && { backgroundColor: type.color + '08' },
                      ]}
                      onPress={() => {
                        setSelectedDocType(type.id);
                        setDropdownOpen(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.optionIconCircle, { backgroundColor: type.color + '15' }]}>
                        <MaterialCommunityIcons
                          name={type.icon}
                          size={24}
                          color={type.color}
                        />
                      </View>
                      <AppText style={[styles.optionTitle, {
                        color: selectedDocType === type.id ? type.color : colors.textPrimary,
                        fontWeight: selectedDocType === type.id ? 'bold' : '500',
                      }]}>
                        {type.label}
                      </AppText>
                      {selectedDocType === type.id && (
                        <MaterialCommunityIcons
                          name="check-circle"
                          size={22}
                          color={type.color}
                        />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Date Filter */}
              <AppText style={[styles.filterLabel, { color: colors.textPrimary, marginTop: spacing.md }]}>{t.filterByDate}</AppText>
              <View style={styles.filtersRow}>
                {/* Date Filter Button */}
                <TouchableOpacity
                  style={styles.dateFilterButton}
                  onPress={() => setShowDateFilter(true)}
                >
                  <LinearGradient colors={gradients.blueBox} style={styles.dateFilterGradient}>
                    <Ionicons name="calendar-outline" size={20} color="white" />
                    <AppText style={styles.dateFilterText}>
                      {dateFilter.label || t.filterByDate}
                    </AppText>
                  </LinearGradient>
                </TouchableOpacity>

                {/* Client Name Filter */}
                <TouchableOpacity
                  style={[styles.clientFilterInput, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setShowClientSelector(true)}
                >
                  <Ionicons name="person-outline" size={20} color={colors.textSecondary} />
                  <AppText
                    style={[styles.clientInput, { color: clientFilter ? colors.textPrimary : colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {clientFilter || t.filterByClient}
                  </AppText>
                  {clientFilter.length > 0 && (
                    <TouchableOpacity onPress={() => {
                      setClientFilter('');
                    }}>
                      <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              </View>

              {/* Clear Date Filter */}
              {dateFilter.label && (
                <TouchableOpacity
                  style={styles.clearDatesButton}
                  onPress={() => setDateFilter({ type: 'last7days', startDate: null, endDate: null, label: '' })}
                >
                  <LinearGradient colors={gradients.redBox} style={styles.clearDatesGradient}>
                    <Ionicons name="close-circle-outline" size={18} color="white" />
                    <AppText style={styles.clearDatesText}>{t.clearDate}</AppText>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="file-document-outline" size={64} color={colors.textSecondary} />
            <AppText style={[styles.emptyText, { color: colors.textSecondary }]}>{t.noDocuments}</AppText>
          </View>
        }
        ListFooterComponent={
          filteredDocuments.length > displayLimit ? (
            <TouchableOpacity
              style={[styles.showMoreButton, { borderColor: colors.primary }]}
              onPress={() => setDisplayLimit(prev => prev + PAGE_SIZE)}
              activeOpacity={0.7}
            >
              <AppText style={{ color: colors.primary, fontWeight: '600' }}>
                {language === 'he' ? `הצג עוד (${filteredDocuments.length - displayLimit} נותרו)` : `Show more (${filteredDocuments.length - displayLimit} remaining)`}
              </AppText>
            </TouchableOpacity>
          ) : null
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        {...scrollProps}
      />

      {/* Preview Modal */}
      <Modal
        visible={showPreviewModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPreviewModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <AppText style={[styles.modalTitle, { color: colors.textPrimary }]}>{t.documentDetails}</AppText>
              <TouchableOpacity onPress={() => setShowPreviewModal(false)}>
                <Ionicons name="close" size={28} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Modal body intentionally left unchanged */}

            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: colors.primary }]}
              onPress={() => setShowPreviewModal(false)}
            >
              <AppText style={styles.closeButtonText}>{t.close}</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* DateFilter Component */}
      <DateFilter
        visible={showDateFilter}
        onClose={() => setShowDateFilter(false)}
        onFilterChange={(filter: DateFilterRange) => {
          setDateFilter(filter);
        }}
        currentFilter={dateFilter.type}
        isDarkMode={isDarkMode}
        language={language}
      />

      {/* Client Selector Modal */}
      <ClientSelectorModal
        visible={showClientSelector}
        onClose={() => setShowClientSelector(false)}
        onSelectClient={(name) => setClientFilter(name)}
        colors={colors}
        translations={{
          filterByClient: t.filterByClient,
          searchClients: t.searchClients,
          noClients: t.noClients,
          noSearchResults: t.noSearchResults,
          clearFilter: t.clearFilter,
        }}
        clients={cachedClients || []}
        searchQuery={clientSearchQuery}
        onSearchChange={setClientSearchQuery}
        currentFilter={clientFilter}
      />

      <GlobalHeader />
    </View>
  );
}
