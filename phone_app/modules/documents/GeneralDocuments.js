import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getColors, spacing, borderRadius, typography, shadows, gradients } from '../../theme';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAlert } from '../../contexts/AlertContext';
import { GlobalHeader, ScrollableContainer } from '../../components';

/**
 * Document Type Constants (numeric) - must match CreateDocument.js
 * 10 = Price Proposal, 200 = Delivery Note, 210 = Return Certificate
 * 305 = Tax Invoice, 330 = Refund, 400 = Receipt
 */
const DOC_TYPE = {
  PRICE_PROPOSAL: 10,
  DELIVERY_NOTE: 200,
  RETURN_CERTIFICATE: 210,
  TAX_INVOICE: 305,
  REFUND: 330,
  RECEIPT: 400
};

export default function GeneralDocuments() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const colors = getColors(isDarkMode);

  const [selectedDocType, setSelectedDocType] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalVisible, setModalVisible] = useState(false);

  const t = language === 'en' ? {
    title: 'General Documents',
    back: 'Back',
    searchPlaceholder: 'Search...',
    selectDocument: 'Select Document Type',
    priceProposal: 'Price Proposal',
    priceProposalDesc: 'Create a price proposal for clients',
    taxInvoice: 'Tax Invoice',
    taxInvoiceDesc: 'Create a manual tax invoice',
    returnCertificate: 'Return Certificate',
    returnCertificateDesc: 'Issue a return certificate',
    refund: 'Refund',
    refundDesc: 'Process a refund document',
    receipt: 'Receipt',
    receiptDesc: 'Generate a receipt for payment',
    deliveryNote: 'Delivery Note',
    deliveryNoteDesc: 'Create a delivery note for items',
    history: 'Document History',
    historyDesc: 'View all created documents with filters',
    viewButton: 'View & Search',
    close: 'Close',
    noResults: 'No results found',
    generateDocument: 'Generate Document',
    tapToSelect: 'Tap to select a document type',
  } : language === 'he' ? {
    title: 'מסמכים כלליים',
    back: 'חזרה',
    searchPlaceholder: 'חיפוש...',
    selectDocument: 'בחר סוג מסמך',
    priceProposal: 'הצעת מחיר',
    priceProposalDesc: 'יצירת הצעת מחיר ללקוחות',
    taxInvoice: 'חשבונית מס',
    taxInvoiceDesc: 'יצירת חשבונית מס ידנית',
    returnCertificate: 'תעודת החזרה',
    returnCertificateDesc: 'הנפקת תעודת החזרה',
    refund: 'החזר כספי',
    refundDesc: 'עיבוד מסמך החזר כספי',
    receipt: 'קבלה',
    receiptDesc: 'יצירת קבלה עבור תשלום',
    deliveryNote: 'תעודת משלוח',
    deliveryNoteDesc: 'יצירת תעודת משלוח לפריטים',
    history: 'היסטוריית מסמכים',
    historyDesc: 'צפייה בכל המסמכים שנוצרו עם סינונים',
    viewButton: 'צפייה וחיפוש',
    close: 'סגור',
    noResults: 'לא נמצאו תוצאות',
    generateDocument: 'יצירת מסמך',
    tapToSelect: 'לחץ לבחירת סוג מסמך',
  } : {
    title: 'المستندات العامة',
    back: 'رجوع',
    searchPlaceholder: 'بحث...',
    selectDocument: 'اختر نوع المستند',
    priceProposal: 'عرض السعر',
    priceProposalDesc: 'إنشاء عرض سعر للعملاء',
    taxInvoice: 'فاتورة ضريبية',
    taxInvoiceDesc: 'إنشاء فاتورة ضريبية يدوية',
    returnCertificate: 'شهادة الإرجاع',
    returnCertificateDesc: 'إصدار شهادة إرجاع',
    refund: 'استرداد',
    refundDesc: 'معالجة مستند الاسترداد',
    receipt: 'إيصال',
    receiptDesc: 'إنشاء إيصال للدفع',
    deliveryNote: 'إشعار تسليم',
    deliveryNoteDesc: 'إنشاء إشعار تسليم للعناصر',
    history: 'سجل المستندات',
    historyDesc: 'عرض جميع المستندات المنشأة مع الفلاتر',
    viewButton: 'عرض وبحث',
    close: 'إغلاق',
    noResults: 'لم يتم العثور على نتائج',
    generateDocument: 'إنشاء مستند',
    tapToSelect: 'انقر لاختيار نوع المستند',
  };

  const documentTypes = [
    {
      id: DOC_TYPE.TAX_INVOICE, // 305
      title: t.taxInvoice,
      description: t.taxInvoiceDesc,
      icon: 'file-document',
      color: '#10B981',
      gradient: ['#10B981', '#059669'],
    },
    {
      id: DOC_TYPE.RECEIPT, // 400
      title: t.receipt,
      description: t.receiptDesc,
      icon: 'receipt',
      color: '#06B6D4',
      gradient: ['#06B6D4', '#0891B2'],
    },
    {
      id: DOC_TYPE.PRICE_PROPOSAL, // 10
      title: t.priceProposal,
      description: t.priceProposalDesc,
      icon: 'file-document-edit',
      color: '#3B82F6',
      gradient: ['#3B82F6', '#2563EB'],
    },
    {
      id: DOC_TYPE.DELIVERY_NOTE, // 200
      title: t.deliveryNote,
      description: t.deliveryNoteDesc,
      icon: 'truck-delivery',
      color: '#8B5CF6',
      gradient: ['#8B5CF6', '#7C3AED'],
    },
    {
      id: DOC_TYPE.RETURN_CERTIFICATE, // 210
      title: t.returnCertificate,
      description: t.returnCertificateDesc,
      icon: 'file-certificate',
      color: '#EC4899',
      gradient: ['#EC4899', '#DB2777'],
    },
    {
      id: DOC_TYPE.REFUND, // 330
      title: t.refund,
      description: t.refundDesc,
      icon: 'cash-refund',
      color: '#F59E0B',
      gradient: ['#F59E0B', '#D97706'],
    },
  ];

  // TODO: Fetch documents from Firestore when API is integrated
  // mockDocuments now uses numeric keys to match DOC_TYPE
  const mockDocuments = {
    [DOC_TYPE.PRICE_PROPOSAL]: [],
    [DOC_TYPE.RETURN_CERTIFICATE]: [],
    [DOC_TYPE.REFUND]: [],
  };

  const openDocumentModal = (docType) => {
    setSelectedDocType(docType);
    setSearchQuery('');
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setSelectedDocType(null);
    setSearchQuery('');
  };

  const getFilteredItems = () => {
    if (!selectedDocType) return [];
    const items = mockDocuments[selectedDocType.id] || [];
    
    if (searchQuery.trim() === '') {
      return items;
    }
    
    return items.filter(item =>
      item.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.amount && item.amount.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.itemName && item.itemName.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  };

  const handleGenerateDocument = (item) => {
    if (selectedDocType.id === DOC_TYPE.PRICE_PROPOSAL) {
      // Navigate to create price proposal screen
      router.push('/CreatePriceProposal');
    } else {
      // Placeholder for API integration for other document types
      alert.info(
        'Generate Document',
        `This will generate a ${selectedDocType.title} for ${item.clientName}.\n\nGreenInvoice API integration coming soon...`
      );
    }
  };

  const handleCreateNewDocument = (docType) => {
    setDropdownOpen(false);
    // All document types now use the unified CreateDocument component with numeric type
    router.push({
      pathname: '/CreateDocument',
      params: { type: docType.id } // docType.id is now numeric (305, 400, etc.)
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      {/* Main Content */}
      <ScrollableContainer 
        style={[styles.scrollView, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.scrollContent, { paddingTop: 100, paddingBottom: insets.bottom + 20 }]}
      >
        {/* Header Section */}
        <View style={styles.headerSection}>
          <MaterialCommunityIcons name="file-document-multiple" size={64} color={colors.primary} />
          <Text style={[styles.mainTitle, { color: colors.textPrimary }]}>
            {t.title}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {t.tapToSelect}
          </Text>
        </View>

        {/* Dropdown Selector */}
        <View style={styles.dropdownContainer}>
          <TouchableOpacity
            style={[styles.dropdownButton, { 
              backgroundColor: colors.surface, 
              borderColor: dropdownOpen ? colors.primary : colors.border 
            }]}
            onPress={() => setDropdownOpen(!dropdownOpen)}
            activeOpacity={0.7}
          >
            <View style={styles.dropdownButtonContent}>
              {selectedDocType ? (
                <>
                  <View style={[styles.selectedIconCircle, { backgroundColor: selectedDocType.color + '20' }]}>
                    <MaterialCommunityIcons 
                      name={selectedDocType.icon} 
                      size={24} 
                      color={selectedDocType.color} 
                    />
                  </View>
                  <View style={styles.selectedTextContainer}>
                    <Text style={[styles.selectedTitle, { color: colors.textPrimary }]}>
                      {selectedDocType.title}
                    </Text>
                    <Text style={[styles.selectedDescription, { color: colors.textSecondary }]}>
                      {selectedDocType.description}
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <MaterialCommunityIcons name="file-document" size={24} color={colors.textSecondary} />
                  <Text style={[styles.dropdownPlaceholder, { color: colors.textSecondary }]}>
                    {t.selectDocument}
                  </Text>
                </>
              )}
            </View>
            <MaterialCommunityIcons 
              name={dropdownOpen ? "chevron-up" : "chevron-down"} 
              size={28} 
              color={colors.textSecondary} 
            />
          </TouchableOpacity>

          {/* Dropdown Options */}
          {dropdownOpen && (
            <View style={[styles.dropdownOptions, { backgroundColor: colors.surface }]}>
              {documentTypes.map((doc, index) => (
                <TouchableOpacity
                  key={doc.id}
                  style={[
                    styles.dropdownOption,
                    index !== documentTypes.length - 1 && styles.dropdownOptionBorder,
                    { borderBottomColor: colors.border }
                  ]}
                  onPress={() => {
                    setSelectedDocType(doc);
                    setDropdownOpen(false);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.optionIconCircle, { backgroundColor: doc.color + '15' }]}>
                    <MaterialCommunityIcons name={doc.icon} size={28} color={doc.color} />
                  </View>
                  <View style={styles.optionTextContainer}>
                    <Text style={[styles.optionTitle, { color: colors.textPrimary }]}>
                      {doc.title}
                    </Text>
                    <Text style={[styles.optionDescription, { color: colors.textSecondary }]}>
                      {doc.description}
                    </Text>
                  </View>
                  <MaterialCommunityIcons 
                    name="chevron-right" 
                    size={24} 
                    color={colors.textSecondary} 
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Generate Button */}
        {selectedDocType && (
          <TouchableOpacity
            style={styles.generateButtonContainer}
            onPress={() => handleCreateNewDocument(selectedDocType)}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={selectedDocType.gradient}
              style={styles.generateButton}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <MaterialCommunityIcons name="plus-circle" size={24} color="white" />
              <Text style={styles.generateButtonText}>{t.generateDocument}</Text>
              <MaterialCommunityIcons name="arrow-right" size={24} color="white" />
            </LinearGradient>
          </TouchableOpacity>
        )}
      </ScrollableContainer>

      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: 100,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
    marginTop: spacing.lg,
  },
  mainTitle: {
    fontSize: typography.xxxl,
    fontWeight: typography.bold,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: typography.base,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  dropdownContainer: {
    marginBottom: spacing.xl,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    ...shadows.card,
  },
  dropdownButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
  },
  selectedIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedTextContainer: {
    flex: 1,
  },
  selectedTitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    marginBottom: spacing.xs,
    letterSpacing: -0.2,
  },
  selectedDescription: {
    fontSize: typography.sm,
    letterSpacing: 0.1,
  },
  dropdownPlaceholder: {
    fontSize: typography.lg,
    marginLeft: spacing.sm,
  },
  dropdownOptions: {
    marginTop: spacing.md,
    borderRadius: borderRadius.xl,
    ...shadows.floating,
    overflow: 'hidden',
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  dropdownOptionBorder: {
    borderBottomWidth: 1,
  },
  optionIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitle: {
    fontSize: typography.lg,
    fontWeight: typography.semibold,
    marginBottom: spacing.xs,
    letterSpacing: -0.2,
  },
  optionDescription: {
    fontSize: typography.sm,
    letterSpacing: 0.1,
  },
  generateButtonContainer: {
    marginBottom: spacing.xxl,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg + 2,
    borderRadius: borderRadius.xl,
    gap: spacing.md,
    ...shadows.primary,
  },
  generateButtonText: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    color: 'white',
    letterSpacing: 0.3,
  },
});
