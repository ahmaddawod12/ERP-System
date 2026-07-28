/**
 * ViewDocument.js - View Document Details
 * 
 * Displays the full details of a saved document
 * Shows different fields based on document type:
 * - Tax Invoice (305): Has confirmation number, VAT details
 * - Receipt (400): Has payment method and info
 * - Price Proposal (10): Standard fields
 * - Delivery Note (200): Standard fields
 * - Return Certificate (210): Standard fields
 * - Refund (330): Standard fields
 */

import { View,
  StyleSheet,
  TouchableOpacity,
  Linking,
 } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { getColors, spacing, borderRadius, typography, shadows } from '../../../theme';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { AppText, GlobalHeader, ScrollableContainer } from '../../../components';
import { DOC_TYPE, DOC_COLORS, DOC_GRADIENTS, DOC_ICONS, getDocumentLabel } from '@smart-job/contracts';
import { containsLikelyPaymentCardNumber } from '@smart-job/api-contracts';
import { safeJsonParse } from '../../../utils/helpers';
import type { AppDocument } from '../../../types';
import { useAlert } from '../../../contexts/AlertContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTenant } from '../../../contexts/TenantContext';
import { getDocumentDownloadUrl } from '../lib/document-download';
import {
  mapDocumentDetail,
  type DocumentHistoryRecord,
} from '../lib/document-history-model';
import { fetchDocumentDetail } from '../lib/documents-api';
import { tenantQueryKey } from '../../../lib/query/client';

// Document type behavior configurations (visual metadata lives in @smart-job/contracts)
const DOCUMENT_BEHAVIOR_CONFIGS = {
  [DOC_TYPE.TAX_INVOICE]: {
    hasConfirmationNumber: true,
    hasVatNumber: true,
    hasPaymentMethod: false,
  },
  [DOC_TYPE.RECEIPT]: {
    hasConfirmationNumber: false,
    hasVatNumber: false,
    hasPaymentMethod: true,
  },
  [DOC_TYPE.PRICE_PROPOSAL]: {
    hasConfirmationNumber: false,
    hasVatNumber: false,
    hasPaymentMethod: false,
  },
  [DOC_TYPE.DELIVERY_NOTE]: {
    hasConfirmationNumber: false,
    hasVatNumber: false,
    hasPaymentMethod: false,
  },
  [DOC_TYPE.RETURN_CERTIFICATE]: {
    hasConfirmationNumber: false,
    hasVatNumber: false,
    hasPaymentMethod: false,
  },
  [DOC_TYPE.REFUND]: {
    hasConfirmationNumber: false,
    hasVatNumber: false,
    hasPaymentMethod: false,
  },
} as const;

export default function ViewDocument() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { user } = useSession();
  const { workspace } = useTenant();
  const colors = getColors(isDarkMode);
  
  // Parse document from params (passed from DocumentHistory)
  const routeDocument = safeJsonParse(params.document) as DocumentHistoryRecord | null;
  const uid = user?.uid ?? '';
  const companyId = workspace?.companyId ?? 0;
  const documentId = String(routeDocument?.documentId || routeDocument?.id || '').trim();
  const detailQuery = useQuery({
    queryKey: tenantQueryKey(uid, companyId, 'documents', 'detail', documentId),
    queryFn: ({ signal }) => fetchDocumentDetail({ uid, companyId, documentId, signal }),
    enabled: uid.length > 0 && companyId > 0 && documentId.length > 0,
  });
  const document: DocumentHistoryRecord | null = detailQuery.data
    ? { ...routeDocument, ...mapDocumentDetail(detailQuery.data) }
    : routeDocument;

  // Translations
  const t = getTranslations(language);

  const getDocTypeConfig = (type?: number | string) => {
    const numericType = typeof type === 'number' ? type : Number(type);
    const behavior = DOCUMENT_BEHAVIOR_CONFIGS[numericType as keyof typeof DOCUMENT_BEHAVIOR_CONFIGS] || DOCUMENT_BEHAVIOR_CONFIGS[DOC_TYPE.PRICE_PROPOSAL];
    return {
      icon: DOC_ICONS[numericType as keyof typeof DOC_ICONS] || DOC_ICONS[DOC_TYPE.PRICE_PROPOSAL],
      gradient: DOC_GRADIENTS[numericType as keyof typeof DOC_GRADIENTS] || DOC_GRADIENTS[DOC_TYPE.PRICE_PROPOSAL],
      color: DOC_COLORS[numericType as keyof typeof DOC_COLORS] || DOC_COLORS[DOC_TYPE.PRICE_PROPOSAL],
      ...behavior,
    };
  };

  const getDocTypeName = (type?: number | string) => {
    const numericType = typeof type === 'number' ? type : Number(type);
    return getDocumentLabel(numericType, language) || t.document;
  };

  const formatDate = (dateInput?: unknown) => {
    if (!dateInput) return 'N/A';

    // Handle Firestore Timestamp
    if (typeof dateInput === 'object' && dateInput !== null && 'toDate' in dateInput && typeof (dateInput as { toDate?: () => Date }).toDate === 'function') {
      const date = (dateInput as { toDate: () => Date }).toDate();
      return date.toLocaleDateString(language === 'he' ? 'he-IL' : language === 'ar' ? 'ar-SA' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    try {
      const date = new Date(String(dateInput));
      if (Number.isNaN(date.getTime())) return 'N/A';
      return date.toLocaleDateString(language === 'he' ? 'he-IL' : language === 'ar' ? 'ar-SA' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return 'N/A';
    }
  };

  const formatAmount = (amount?: number | string) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (num === undefined || num === null || Number.isNaN(num)) return '₪0.00';
    return `₪${num.toFixed(2)}`;
  };

  const calculateTotal = (items?: Array<{ price?: number | string; quantity?: number | string }>) => {
    if (!items || !Array.isArray(items)) return 0;
    return items.reduce((sum, item) => {
      const price = typeof item.price === 'string' ? parseFloat(item.price) : (item.price || 0);
      const quantity = typeof item.quantity === 'string' ? parseFloat(item.quantity) : (item.quantity || 1);
      return sum + (price * quantity);
    }, 0);
  };

  const getPaymentMethodLabel = (method?: string) => {
    const methods: Record<string, string> = {
      cash: t.paymentCash,
      credit: t.paymentCredit,
      transfer: t.paymentTransfer,
      check: t.paymentCheck,
      bit: t.paymentBit,
      paybox: t.paymentPaybox,
    };
    return method ? methods[method] || method : '';
  };

  const formatPaymentDetails = () => {
    const details = document?.paymentDetails ?? document?.documentData?.paymentDetails;
    if (details && 'last4' in details) {
      return `•••• ${details.last4} · ${details.authorizationReference}`;
    }
    if (details && 'reference' in details) return details.reference;
    const legacy = document?.paymentInfo ?? document?.documentData?.paymentInfo;
    if (!legacy) return '';
    return containsLikelyPaymentCardNumber(legacy) ? t.paymentDetailsRedacted : legacy;
  };

  const openDocumentPdf = async () => {
    if (!document) return;
    try {
      const uid = user?.uid;
      const companyId = workspace?.companyId;
      const documentId = document.documentId || document.id;
      if (!document.hasFile || !uid || !companyId || !documentId) {
        throw new Error('PDF not available');
      }

      const url = await getDocumentDownloadUrl(uid, companyId, documentId);

      if (!url) {
        throw new Error('PDF not available');
      }

      await Linking.openURL(url);
    } catch (_error) {
      alert.error(
        language === 'en' ? 'Error' : language === 'he' ? 'שגיאה' : 'خطأ',
        language === 'en' ? 'Could not open PDF' : language === 'he' ? 'לא ניתן לפתוח את ה-PDF' : 'تعذر فتح ملف PDF'
      );
    }
  };

  if (!document) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: colors.background }]}>
        <MaterialCommunityIcons name="file-document-outline" size={64} color={colors.textSecondary} />
        <AppText style={[styles.emptyText, { color: colors.textSecondary }]}>{t.documentNotFound}</AppText>
        <GlobalHeader />
      </View>
    );
  }

  const config = getDocTypeConfig(document.type);
  const items = document.income || document.items || document.documentData?.items || [];
  
  // Use stored totals from document (don't recalculate)
  const subtotal = document.totalBeforeVat || document.documentData?.totalBeforeVat || calculateTotal(items);
  const vatAmount = document.vatAmount || document.documentData?.vatAmount || (subtotal * 0.18);
  const grandTotal = document.totalWithVat || document.documentData?.totalWithVat || (subtotal + vatAmount);
  
  // Get client data from various possible locations
  const clientData: NonNullable<AppDocument['documentData']>['client'] = document.documentData?.client || {
    name: document.cname,
    phone: document.cphone,
    clientVatNumber: document.clientVatNumber,
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      <ScrollableContainer 
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: 120, paddingBottom: insets.bottom + 20 }]}
      >
        {/* Header Card */}
        <View style={[styles.headerCard, { backgroundColor: colors.surface }]}>
          <LinearGradient
            colors={config.gradient as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.headerGradient}
          >
            <View style={styles.headerIconContainer}>
              <MaterialCommunityIcons name={config.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={48} color="white" />
            </View>
            <AppText style={styles.headerTitle}>{getDocTypeName(document.type)}</AppText>
            {document.documentNumber && (
              <AppText style={styles.headerSubtitle}>#{document.documentNumber}</AppText>
            )}
          </LinearGradient>
          
          <View style={styles.headerDetails}>
            <View style={styles.headerDetailRow}>
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
              <AppText style={[styles.headerDetailText, { color: colors.textPrimary }]}>
                {formatDate(document.createdAt)}
              </AppText>
            </View>
            {(document.createdByName || document.createdByUid) && (
              <View style={styles.headerDetailRow}>
                <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
                <AppText style={[styles.headerDetailText, { color: colors.textPrimary }]}>
                  {t.createdBy}: {document.createdByName || document.createdByUid}
                </AppText>
              </View>
            )}
          </View>
        </View>

        {/* Download PDF Button */}
        {document.hasFile && (
          <TouchableOpacity
            style={styles.downloadButton}
            onPress={() => void openDocumentPdf()}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={config.gradient as [string, string, ...string[]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.downloadButtonGradient}
            >
              <MaterialCommunityIcons name="file-pdf-box" size={22} color="white" />
              <AppText style={styles.downloadButtonText}>
                {language === 'en' ? 'Open PDF' : language === 'he' ? 'פתח PDF' : 'فتح PDF'}
              </AppText>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* Tax Invoice Specific: Confirmation Number */}
        {config.hasConfirmationNumber && document.taxAuthorityConfirmationNumber && (
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <View style={styles.sectionHeader}>
              <Ionicons name="shield-checkmark" size={24} color="#10B981" />
              <AppText style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t.taxAuthority}</AppText>
            </View>
            <View style={styles.confirmationBox}>
              <AppText style={[styles.confirmationLabel, { color: colors.textSecondary }]}>
                {t.confirmationNumber}
              </AppText>
              <AppText style={[styles.confirmationValue, { color: colors.textPrimary }]}>
                {document.taxAuthorityConfirmationNumber}
              </AppText>
            </View>
          </View>
        )}

        {/* Receipt Specific: Payment Info */}
        {config.hasPaymentMethod && (document.paymentMethod || document.documentData?.paymentMethod) && (
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <View style={styles.sectionHeader}>
              <Ionicons name="card" size={24} color="#06B6D4" />
              <AppText style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t.paymentDetails}</AppText>
            </View>
            <View style={styles.infoRow}>
              <AppText style={[styles.infoLabel, { color: colors.textSecondary }]}>{t.paymentMethod}</AppText>
              <AppText style={[styles.infoValue, { color: colors.textPrimary }]}>
                {getPaymentMethodLabel(document.paymentMethod || document.documentData?.paymentMethod)}
              </AppText>
            </View>
            {formatPaymentDetails() && (
              <View style={styles.infoRow}>
                <AppText style={[styles.infoLabel, { color: colors.textSecondary }]}>{t.paymentInfo}</AppText>
                <AppText style={[styles.infoValue, { color: colors.textPrimary }]}>
                  {formatPaymentDetails()}
                </AppText>
              </View>
            )}
            {(document.invoiceReference || document.documentData?.invoiceReference) && (
              <View style={styles.infoRow}>
                <AppText style={[styles.infoLabel, { color: colors.textSecondary }]}>{t.invoiceReference}</AppText>
                <AppText style={[styles.infoValue, { color: colors.textPrimary }]}>
                  {document.invoiceReference || document.documentData?.invoiceReference}
                </AppText>
              </View>
            )}
          </View>
        )}

        {/* Client Details */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="person" size={24} color={config.color} />
            <AppText style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t.clientDetails}</AppText>
          </View>
          
          {clientData.name && (
            <View style={styles.infoRow}>
              <AppText style={[styles.infoLabel, { color: colors.textSecondary }]}>{t.name}</AppText>
              <AppText style={[styles.infoValue, { color: colors.textPrimary }]}>{clientData.name}</AppText>
            </View>
          )}
          
          {clientData.email && (
            <View style={styles.infoRow}>
              <AppText style={[styles.infoLabel, { color: colors.textSecondary }]}>{t.email}</AppText>
              <AppText style={[styles.infoValue, { color: colors.textPrimary }]}>{clientData.email}</AppText>
            </View>
          )}
          
          {clientData.phone && (
            <View style={styles.infoRow}>
              <AppText style={[styles.infoLabel, { color: colors.textSecondary }]}>{t.phone}</AppText>
              <AppText style={[styles.infoValue, { color: colors.textPrimary }]}>{clientData.phone}</AppText>
            </View>
          )}
          
          {clientData.address && (
            <View style={styles.infoRow}>
              <AppText style={[styles.infoLabel, { color: colors.textSecondary }]}>{t.address}</AppText>
              <AppText style={[styles.infoValue, { color: colors.textPrimary }]}>{clientData.address}</AppText>
            </View>
          )}
          
          {/* VAT Number for Tax Invoice */}
          {config.hasVatNumber && clientData.clientVatNumber && (
            <View style={styles.infoRow}>
              <AppText style={[styles.infoLabel, { color: colors.textSecondary }]}>{t.vatNumber}</AppText>
              <AppText style={[styles.infoValue, { color: colors.textPrimary }]}>{clientData.clientVatNumber}</AppText>
            </View>
          )}
        </View>

        {/* Items Section */}
        {items.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <View style={styles.sectionHeader}>
              <Ionicons name="list" size={24} color={config.color} />
              <AppText style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t.items}</AppText>
            </View>
            
            {items.map((item, index) => (
              <View key={index} style={[styles.itemCard, { borderColor: colors.border }]}>
                {item.id && (
                  <View style={styles.itemInfoRow}>
                    <AppText style={[styles.itemLabel, { color: colors.textSecondary }]}>
                      {t.itemId}:{' '}
                      <AppText style={[styles.itemValue, { color: config.color, writingDirection: 'ltr' }]}>
                        {item.id}
                      </AppText>
                    </AppText>
                  </View>
                )}
                <View style={styles.itemInfoRow}>
                  <AppText style={[styles.itemLabel, { color: colors.textSecondary }]}>
                    {t.itemName}:{' '}
                    <AppText style={[styles.itemValue, { color: colors.textPrimary }]}>
                      {item.description}
                    </AppText>
                  </AppText>
                </View>
                <View style={styles.itemDetails}>
                  <View style={styles.itemDetail}>
                    <AppText style={[styles.itemDetailLabel, { color: colors.textSecondary }]}>{t.quantity}</AppText>
                    <AppText style={[styles.itemDetailValue, { color: colors.textPrimary }]}>
                      {item.quantity || 1}
                    </AppText>
                  </View>
                  <View style={styles.itemDetail}>
                    <AppText style={[styles.itemDetailLabel, { color: colors.textSecondary }]}>{t.price}</AppText>
                    <AppText style={[styles.itemDetailValue, { color: colors.textPrimary }]}>
                      {formatAmount(item.price)}
                    </AppText>
                  </View>
                  <View style={styles.itemDetail}>
                    <AppText style={[styles.itemDetailLabel, { color: colors.textSecondary }]}>{t.subtotal}</AppText>
                    <AppText style={[styles.itemDetailValue, { color: config.color, fontWeight: 'bold' }]}>
                      {formatAmount((parseFloat(String(item.price ?? 0)) || 0) * (parseFloat(String(item.quantity ?? 1)) || 1))}
                    </AppText>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Totals Section */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="calculator" size={24} color={config.color} />
            <AppText style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t.summary}</AppText>
          </View>
          
          <View style={styles.totalRow}>
            <AppText style={[styles.totalLabel, { color: colors.textSecondary }]}>{t.subtotal}</AppText>
            <AppText style={[styles.totalValue, { color: colors.textPrimary }]}>{formatAmount(subtotal)}</AppText>
          </View>
          
          <View style={styles.totalRow}>
            <AppText style={[styles.totalLabel, { color: colors.textSecondary }]}>{t.vat} (18%)</AppText>
            <AppText style={[styles.totalValue, { color: colors.textPrimary }]}>{formatAmount(vatAmount)}</AppText>
          </View>
          
          <View style={[styles.totalRow, styles.grandTotalRow, { borderTopColor: colors.border }]}>
            <AppText style={[styles.grandTotalLabel, { color: colors.textPrimary }]}>{t.total}</AppText>
            <AppText style={[styles.grandTotalValue, { color: config.color }]}>{formatAmount(grandTotal)}</AppText>
          </View>
        </View>

        {/* Notes Section */}
        {(document.notes || document.documentData?.notes) && (
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <View style={styles.sectionHeader}>
              <Ionicons name="document-text" size={24} color={config.color} />
              <AppText style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t.notes}</AppText>
            </View>
            <AppText style={[styles.notesText, { color: colors.textPrimary }]}>
              {document.notes || document.documentData?.notes}
            </AppText>
          </View>
        )}

      </ScrollableContainer>

      <GlobalHeader />
    </View>
  );
}

// Translation helper function
function getTranslations(language: string) {
  if (language === 'en') {
    return {
      documentNotFound: 'Document not found',
      document: 'Document',
      createdBy: 'Created by',
      taxAuthority: 'Tax Authority Approval',
      confirmationNumber: 'Confirmation Number (מספר הקצאה)',
      paymentDetails: 'Payment Details',
      paymentMethod: 'Payment Method',
      paymentInfo: 'Payment Reference',
      paymentDetailsRedacted: 'Legacy payment details hidden for security',
      invoiceReference: 'Invoice Reference',
      paymentCash: 'Cash',
      paymentCredit: 'Credit Card',
      paymentTransfer: 'Bank Transfer',
      paymentCheck: 'Check',
      paymentBit: 'Bit',
      paymentPaybox: 'PayBox',
      clientDetails: 'Client Details',
      name: 'Name',
      email: 'Email',
      phone: 'Phone',
      address: 'Address',
      vatNumber: 'VAT Number',
      items: 'Items',
      itemId: 'Item ID',
      itemName: 'Item Name',
      quantity: 'Qty',
      price: 'Price',
      subtotal: 'Subtotal',
      summary: 'Summary',
      vat: 'VAT',
      total: 'Total',
      notes: 'Notes',
    };
  } else if (language === 'he') {
    return {
      documentNotFound: 'המסמך לא נמצא',
      document: 'מסמך',
      createdBy: 'נוצר על ידי',
      taxAuthority: 'אישור רשות המיסים',
      confirmationNumber: 'מספר הקצאה',
      paymentDetails: 'פרטי תשלום',
      paymentMethod: 'אמצעי תשלום',
      paymentInfo: 'פרטי תשלום',
      paymentDetailsRedacted: 'פרטי תשלום ישנים הוסתרו מטעמי אבטחה',
      invoiceReference: 'מספר חשבונית',
      paymentCash: 'מזומן',
      paymentCredit: 'כרטיס אשראי',
      paymentTransfer: 'העברה בנקאית',
      paymentCheck: 'צ\'ק',
      paymentBit: 'ביט',
      paymentPaybox: 'פייבוקס',
      clientDetails: 'פרטי לקוח',
      name: 'שם',
      email: 'אימייל',
      phone: 'טלפון',
      address: 'כתובת',
      vatNumber: 'מספר עוסק מורשה',
      items: 'פריטים',
      itemId: 'מזהה פריט',
      itemName: 'שם פריט',
      quantity: 'כמות',
      price: 'מחיר',
      subtotal: 'סה"כ חלקי',
      summary: 'סיכום',
      vat: 'מע"מ',
      total: 'סה"כ',
      notes: 'הערות',
    };
  } else {
    return {
      documentNotFound: 'المستند غير موجود',
      document: 'مستند',
      createdBy: 'أنشئ بواسطة',
      taxAuthority: 'موافقة مصلحة الضرائب',
      confirmationNumber: 'رقم التأكيد',
      paymentDetails: 'تفاصيل الدفع',
      paymentMethod: 'طريقة الدفع',
      paymentInfo: 'مرجع الدفع',
      paymentDetailsRedacted: 'تم إخفاء تفاصيل الدفع القديمة لأسباب أمنية',
      invoiceReference: 'مرجع الفاتورة',
      paymentCash: 'نقدي',
      paymentCredit: 'بطاقة ائتمان',
      paymentTransfer: 'تحويل بنكي',
      paymentCheck: 'شيك',
      paymentBit: 'بت',
      paymentPaybox: 'بايبوكس',
      clientDetails: 'تفاصيل العميل',
      name: 'الاسم',
      email: 'البريد الإلكتروني',
      phone: 'الهاتف',
      address: 'العنوان',
      vatNumber: 'رقم ضريبة القيمة المضافة',
      items: 'العناصر',
      itemId: 'معرف العنصر',
      itemName: 'اسم العنصر',
      quantity: 'الكمية',
      price: 'السعر',
      subtotal: 'المجموع الفرعي',
      summary: 'الملخص',
      vat: 'ضريبة القيمة المضافة',
      total: 'المجموع',
      notes: 'ملاحظات',
    };
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  emptyText: {
    fontSize: typography.body,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  // Header Card
  headerCard: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  headerGradient: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  headerIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerTitle: {
    fontSize: typography.h1,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: typography.h3,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: spacing.xs,
  },
  headerDetails: {
    padding: spacing.md,
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
  },
  headerDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  headerDetailText: {
    fontSize: typography.body,
  },
  // Download Button
  downloadButton: {
    marginBottom: spacing.lg,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...shadows.md,
  },
  downloadButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  downloadButtonText: {
    color: 'white',
    fontSize: typography.body,
    fontWeight: 'bold',
  },
  // Sections
  section: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  sectionTitle: {
    fontSize: typography.h3,
    fontWeight: 'bold',
  },
  // Confirmation Box (Tax Invoice)
  confirmationBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  confirmationLabel: {
    fontSize: typography.small,
    marginBottom: spacing.xs,
  },
  confirmationValue: {
    fontSize: typography.h2,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  // Info Rows
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  infoLabel: {
    fontSize: typography.body,
    flex: 1,
  },
  infoValue: {
    fontSize: typography.body,
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  // Item Cards
  itemCard: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  itemInfoRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
    alignItems: 'center',
  },
  itemLabel: {
    fontSize: typography.body,
    fontWeight: '600',
    marginRight: spacing.xs,
  },
  itemValue: {
    fontSize: typography.body,
    fontWeight: '500',
    flex: 1,
  },
  partIdBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  partIdText: {
    fontSize: typography.small || 12,
    fontWeight: '600',
  },
  itemDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  itemDetail: {
    alignItems: 'center',
  },
  itemDetailLabel: {
    fontSize: typography.small,
    marginBottom: spacing.xxs,
  },
  itemDetailValue: {
    fontSize: typography.body,
    fontWeight: '500',
  },
  // Totals
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  totalLabel: {
    fontSize: typography.body,
  },
  totalValue: {
    fontSize: typography.body,
    fontWeight: '500',
  },
  grandTotalRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 2,
  },
  grandTotalLabel: {
    fontSize: typography.h3,
    fontWeight: 'bold',
  },
  grandTotalValue: {
    fontSize: typography.h2,
    fontWeight: 'bold',
  },
  // Notes
  notesText: {
    fontSize: typography.body,
    lineHeight: 22,
  },
});







