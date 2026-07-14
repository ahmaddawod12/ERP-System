import React, { useState, memo, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Linking,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { randomUUID } from 'expo-crypto';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getColors, spacing, borderRadius, typography, shadows, gradients } from '../../../theme';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTenant } from '../../../contexts/TenantContext';
import { useScrollHandler } from '../../../contexts/HeaderContext';
import { AppText, AppButton, GlobalHeader, DateFilter, ClientSelectorModal, ScreenHeroCard } from '../../../components';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { DocTypeCode, DateLike, AppDocument } from '../../../types';
import type { DateFilterRange } from '../../../components/forms/DateFilter';
import { DOC_TYPE, DOC_COLORS, DOC_GRADIENTS, DOC_ICONS, getDocumentLabel } from '@smart-job/contracts';
import { DocumentDeleteRequestSchema } from '@smart-job/api-contracts';
import { getDocumentDownloadUrl } from '../lib/document-download';
import { StableDocumentActionKeys } from '../lib/document-action-keys';
import { useDocumentsInfinite } from '../lib/use-documents-infinite';
import { useDocumentMutations } from '../lib/use-document-mutations';
import { useClientsInfinite } from '../../clients/lib/use-clients-infinite';
import { ROUTES } from '../../../navigation/routes';
import { logger } from '../../../utils/logger';
import { styles } from './DocumentHistory.styles';

import { type DocumentDateFilter, type DocumentHistoryRecord, type DocumentTypeFilter, type DocumentTypeOption } from '../lib/document-history-model';

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
  onDelete: (doc: DocumentHistoryRecord) => void;
  isDownloading: boolean;
  isSharing: boolean;
  isDeleting: boolean;
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
  onDelete,
  isDownloading,
  isSharing,
  isDeleting,
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

        {doc.hasFile ? (
          <>
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
          </>
        ) : doc.entityVersion ? (
          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonThree, { backgroundColor: colors.error }]}
            onPress={() => onDelete(doc)}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <>
                <Ionicons name="trash-outline" size={18} color="white" />
                <AppText style={styles.actionButtonText}>{t.delete}</AppText>
              </>
            )}
          </TouchableOpacity>
        ) : null}
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
  const { user } = useSession();
  const { workspace, status: tenantStatus, refreshWorkspaces } = useTenant();
  const colors = getColors(isDarkMode);

  const PAGE_SIZE = 50;
  const [selectedDocType, setSelectedDocType] = useState<DocumentTypeFilter>('all');
  const [downloadingDoc, setDownloadingDoc] = useState<string | null>(null);
  const [sharingDoc, setSharingDoc] = useState<string | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<string | null>(null);
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
  const { deleteMutation } = useDocumentMutations({
    uid: user?.id ?? null,
    companyId: workspace?.companyId ?? null,
  });
  const [actionKeys] = useState(() => new StableDocumentActionKeys(() => randomUUID()));

  useEffect(() => {
    actionKeys.reset();
  }, [actionKeys, user?.id, workspace?.companyId]);

  const t = useMemo(() => (language === 'en' ? {
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
  }) as Record<string, string>, [language]);

  const documentTypes = useMemo<DocumentTypeOption[]>(() => [
    { id: 'all', label: t.all, icon: 'file-document-multiple', color: '#6B7280', gradient: ['#6B7280', '#4B5563'] },
    ...(Object.values(DOC_TYPE) as DocTypeCode[]).map((code) => ({
      id: code,
      label: getDocumentLabel(code, language),
      icon: DOC_ICONS[code],
      color: DOC_COLORS[code],
      gradient: DOC_GRADIENTS[code],
    })),
  ], [language, t.all]);

  const documentFilters = useMemo(() => {
    const dateFrom = dateFilter.startDate ? new Date(dateFilter.startDate) : undefined;
    const dateTo = dateFilter.endDate ? new Date(dateFilter.endDate) : undefined;
    dateFrom?.setHours(0, 0, 0, 0);
    dateTo?.setHours(23, 59, 59, 999);
    return {
      search: clientFilter || undefined,
      documentType: selectedDocType === 'all' ? undefined : selectedDocType,
      dateFrom,
      dateTo,
      pageSize: PAGE_SIZE,
    };
  }, [clientFilter, dateFilter.endDate, dateFilter.startDate, selectedDocType]);
  const { query: documentsQuery, documents } = useDocumentsInfinite({
    uid: user?.id ?? null,
    companyId: workspace?.companyId ?? null,
    filters: documentFilters,
    enabled: tenantStatus === 'ready',
  });
  const clientFilters = useMemo(() => ({
    search: clientSearchQuery,
    status: 'active' as const,
    pageSize: 50,
  }), [clientSearchQuery]);
  const { clients } = useClientsInfinite({
    uid: user?.id ?? null,
    companyId: workspace?.companyId ?? null,
    filters: clientFilters,
    enabled: tenantStatus === 'ready' && showClientSelector,
  });

  const resolveDocumentUrl = useCallback(async (doc: DocumentHistoryRecord) => {
    const uid = user?.id;
    const companyId = workspace?.companyId;
    const documentId = doc.documentId || doc.id;
    if (!doc.hasFile || !uid || !companyId || !documentId) {
      throw new Error(t.pdfNotAvailable);
    }

    return getDocumentDownloadUrl(uid, companyId, documentId);
  }, [t.pdfNotAvailable, user?.id, workspace?.companyId]);

  const getDocTypeName = useCallback((type: DocumentTypeFilter) => {
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
  }, []);

  const getDocTypeIcon = useCallback((type: DocumentTypeFilter): React.ComponentProps<typeof MaterialCommunityIcons>['name'] => {
    const numericType = typeof type === 'number' ? type : Number(type);
    return DOC_ICONS[numericType as DocTypeCode] || 'file-document';
  }, []);

  const getDocTypeColor = useCallback((type: DocumentTypeFilter) => {
    const numericType = typeof type === 'number' ? type : Number(type);
    return DOC_COLORS[numericType as DocTypeCode] || colors.primary;
  }, [colors.primary]);

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
  }, [alert, getDocTypeName, resolveDocumentUrl, t.download, t.downloadComplete, t.downloadError]);

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
  }, [alert, getDocTypeName, resolveDocumentUrl, t.share, t.shareError]);

  const handleDelete = useCallback((doc: DocumentHistoryRecord) => {
    const documentId = doc.documentId || doc.id;
    if (!documentId || !doc.entityVersion || doc.hasFile) return;

    alert.confirm(t.delete, t.deleteConfirm, [
      { text: t.close, style: 'cancel', onPress: () => {} },
      {
        text: t.delete,
        style: 'destructive',
        onPress: async () => {
          setDeletingDoc(doc.id);
          try {
            const request = DocumentDeleteRequestSchema.parse({
              entityVersion: doc.entityVersion,
            });
            const fingerprint = JSON.stringify({ documentId, request });
            const action = `delete:${documentId}`;
            const idempotencyKey = actionKeys.keyFor(action, fingerprint);
            await deleteMutation.mutateAsync({
              documentId,
              body: request,
              idempotencyKey,
            });
            actionKeys.complete(action, idempotencyKey);
            alert.success('✓', t.deleteSuccess);
          } catch (error: unknown) {
            logger.error('Error deleting document', error);
            alert.error(t.deleteError, error instanceof Error ? error.message : t.deleteError);
          } finally {
            setDeletingDoc(null);
          }
        },
      },
    ]);
  }, [actionKeys, alert, deleteMutation, t.close, t.delete, t.deleteConfirm, t.deleteError, t.deleteSuccess]);

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
        onDelete={handleDelete}
        isDownloading={downloadingDoc === item.id}
        isSharing={sharingDoc === item.id}
        isDeleting={deletingDoc === item.id}
        formatDate={formatDate}
        formatAmount={formatAmount}
      />
    );
  }, [colors, deletingDoc, documentTypes, downloadingDoc, formatAmount, formatDate, getDocTypeColor, getDocTypeIcon, handleDelete, handleDownload, handleShare, handleView, sharingDoc, t]);

  if (
    (tenantStatus === 'loading' || (tenantStatus === 'ready' && documentsQuery.isPending))
    && documents.length === 0
  ) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <AppText style={[styles.loadingText, { color: colors.textPrimary }]}>Loading documents...</AppText>
      </View>
    );
  }

  if ((tenantStatus === 'error' || documentsQuery.isError) && documents.length === 0) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: colors.background }]}>
        <MaterialCommunityIcons name="alert-circle-outline" size={42} color={colors.error} />
        <AppText style={[styles.loadingText, { color: colors.textPrimary }]}>Failed to load documents</AppText>
        <AppText style={[styles.errorText, { color: colors.textSecondary }]}>
          {documentsQuery.error instanceof Error
            ? documentsQuery.error.message
            : tenantStatus === 'error'
              ? 'The active workspace could not be restored.'
              : 'Please try again.'}
        </AppText>
        <View style={styles.retryButtonWrap}>
          <AppButton
            title={language === 'he' ? 'נסה שוב' : language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            onPress={() => {
              if (tenantStatus === 'error') {
                void refreshWorkspaces();
              } else {
                void documentsQuery.refetch();
              }
            }}
            disabled={documentsQuery.isFetching}
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
        data={documents}
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
                { label: t.all, value: `${documents.length}${documentsQuery.hasNextPage ? '+' : ''}` },
                { label: language === 'he' ? 'מוצג' : language === 'ar' ? 'المعروض' : 'Shown', value: String(documents.length) },
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
          documentsQuery.isError ? (
            <TouchableOpacity
              style={[styles.showMoreButton, { borderColor: colors.error }]}
              onPress={() => { void documentsQuery.refetch(); }}
              disabled={documentsQuery.isFetching}
              activeOpacity={0.7}
            >
              {documentsQuery.isFetching ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <AppText style={{ color: colors.error, fontWeight: '600' }}>
                  {language === 'he' ? 'הטעינה נכשלה — נסה שוב' : language === 'ar' ? 'فشل التحميل — حاول مرة أخرى' : 'Refresh failed — try again'}
                </AppText>
              )}
            </TouchableOpacity>
          ) : documentsQuery.hasNextPage ? (
            <TouchableOpacity
              style={[styles.showMoreButton, { borderColor: colors.primary }]}
              onPress={() => { void documentsQuery.fetchNextPage(); }}
              disabled={documentsQuery.isFetchingNextPage}
              activeOpacity={0.7}
            >
              {documentsQuery.isFetchingNextPage ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <AppText style={{ color: colors.primary, fontWeight: '600' }}>
                  {language === 'he' ? 'הצג עוד' : language === 'ar' ? 'عرض المزيد' : 'Show more'}
                </AppText>
              )}
            </TouchableOpacity>
          ) : null
        }
        onEndReached={() => {
          if (documentsQuery.hasNextPage && !documentsQuery.isFetchingNextPage) {
            void documentsQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.4}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        {...scrollProps}
      />

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
        clients={clients}
        searchQuery={clientSearchQuery}
        onSearchChange={setClientSearchQuery}
        currentFilter={clientFilter}
      />

      <GlobalHeader />
    </View>
  );
}
