import type { Dispatch, RefObject, SetStateAction } from 'react';
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  Platform,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';

import { AppInput, AppText } from '../../../components';
import AccessibleModal from '../../../components/feedback/AccessibleModal';
import { getColors, spacing } from '../../../theme';
import { formatDateLike, type InvoiceDocumentRecord, type ModalType } from '../lib/create-document-model';
import type { DocumentComposerState } from '../lib/document-composer-machine';
import { DOCUMENT_CONFIGS } from '../lib/document-config';
import { getDocumentTranslations } from '../lib/document-copy';
import { styles } from '../screens/CreateDocument.styles';

type DocumentConfig = (typeof DOCUMENT_CONFIGS)[keyof typeof DOCUMENT_CONFIGS];
type DocumentCopy = ReturnType<typeof getDocumentTranslations>;
type DocumentColors = ReturnType<typeof getColors>;

interface CreateDocumentModalProps {
  closeModal: () => void;
  colors: DocumentColors;
  config: DocumentConfig;
  downloadAndSharePDF: () => void;
  filteredInvoices: InvoiceDocumentRecord[];
  handleSelectInvoice: (invoice: InvoiceDocumentRecord) => void;
  handleSubmit: () => void;
  insets: { top: number };
  invoiceSearchText: string;
  isDarkMode: boolean;
  isMountedRef: RefObject<boolean>;
  modalState: DocumentComposerState['modal'];
  onPdfError: (nativeEvent: unknown) => void;
  openModal: (type: Exclude<ModalType, null>) => void;
  previewURL: string | null;
  setInvoiceSearchText: Dispatch<SetStateAction<string>>;
  t: DocumentCopy;
}

export default function CreateDocumentModal({
  closeModal,
  colors,
  config,
  downloadAndSharePDF,
  filteredInvoices,
  handleSelectInvoice,
  handleSubmit,
  insets,
  invoiceSearchText,
  isDarkMode,
  isMountedRef,
  modalState,
  onPdfError,
  openModal,
  previewURL,
  setInvoiceSearchText,
  t,
}: CreateDocumentModalProps) {
  return (
    <>
    {/* Unified Modal - Single modal with different content based on type */}
    <AccessibleModal
    visible={modalState.visible}
    animationType="slide"
    onRequestClose={closeModal}
    presentationStyle={Platform.OS === 'ios' ? 'fullScreen' : undefined}
    announcement="Document options"
    >
    <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
    <StatusBar style={isDarkMode ? "light" : "dark"} />
    
    {/* Invoice Selection Content */}
    {modalState.type === 'invoiceSelect' && (
    <>
    <View style={[styles.modalHeader, { backgroundColor: colors.surface, paddingTop: insets.top + 10 }]}>
    <AppText style={[styles.modalTitle, { color: colors.primary }]}>{t.selectInvoice}</AppText>
    <TouchableOpacity onPress={closeModal}>
    <Ionicons name="close" size={28} color={colors.textPrimary} />
    </TouchableOpacity>
    </View>
    
    <View style={[styles.searchContainer, { backgroundColor: colors.surface }]}>
    <Ionicons name="search" size={20} color={colors.textSecondary} />
    <AppInput
    inputStyle={[styles.searchInput, { color: colors.textPrimary }]}
    placeholder={t.searchInvoices}
    value={invoiceSearchText}
    onChangeText={setInvoiceSearchText}
    />
    {invoiceSearchText.length > 0 && (
    <TouchableOpacity onPress={() => setInvoiceSearchText('')}>
    <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
    )}
    </View>
    
    {filteredInvoices.length === 0 ? (
    <View style={styles.emptyContainer}>
    <MaterialCommunityIcons name="file-document-outline" size={64} color={colors.textSecondary} />
    <AppText style={[styles.emptyText, { color: colors.textSecondary }]}>{t.noInvoicesFound}</AppText>
    </View>
    ) : (
    <FlatList
    data={filteredInvoices}
    keyExtractor={(item) => item.id}
    contentContainerStyle={styles.invoiceList}
    renderItem={({ item: invoice }) => {
    const clientData = invoice.documentData?.client || {};
    const totalAmount = (invoice.documentData?.items || [])
    .reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.quantity) || 1)), 0);
    
    return (
    <TouchableOpacity
    style={[styles.invoiceItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
    onPress={() => handleSelectInvoice(invoice)}
    >
    <View style={styles.invoiceItemLeft}>
    <LinearGradient
    colors={['#10B981', '#059669']}
    style={styles.invoiceIconContainer}
    >
    <MaterialCommunityIcons name="file-document" size={24} color="white" />
    </LinearGradient>
    </View>
    <View style={styles.invoiceItemContent}>
    <AppText style={[styles.invoiceItemNumber, { color: colors.textPrimary }]}>
    {t.invoiceNumber}: {invoice.documentNumber}
    </AppText>
    <AppText style={[styles.invoiceItemCustomer, { color: colors.textSecondary }]}>
    {clientData.name || 'Unknown'}
    </AppText>
    <View style={styles.invoiceItemRow}>
    <AppText style={[styles.invoiceItemDate, { color: colors.textSecondary }]}>
    {formatDateLike(invoice.createdAt)}
    </AppText>
    <AppText style={[styles.invoiceItemAmount, { color: colors.primary }]}>
    ₪{totalAmount.toFixed(2)}
    </AppText>
    </View>
    </View>
    <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textSecondary} />
    </TouchableOpacity>
    );
    }}
    />
    )}
    </>
    )}
    
    {/* PDF Preview Content */}
    {modalState.type === 'pdfPreview' && (
    <>
    <View style={[styles.pdfModalHeader, { backgroundColor: colors.surface, paddingTop: insets.top + 10 }]}>
    <AppText style={[styles.pdfModalTitle, { color: colors.primary }]}>
    {t.previewTitle}
    </AppText>
    <TouchableOpacity 
    onPress={closeModal}
    style={styles.closePdfButton}
    >
    <Ionicons name="close" size={28} color={colors.textPrimary} />
    </TouchableOpacity>
    </View>
    
    <View style={styles.pdfActionsContainer}>
    <MaterialCommunityIcons name="file-document-outline" size={100} color={colors.primary} />
    <AppText style={[styles.pdfSuccessText, { color: colors.primary }]}>
    {t.previewTitle}
    </AppText>
    <AppText style={[styles.pdfInfoText, { color: colors.textSecondary }]}>
    {t.pdfReady}
    </AppText>
    
    <View style={styles.openPdfButtonContainer}>
    <TouchableOpacity onPress={downloadAndSharePDF}>
    <LinearGradient
    colors={['#3B82F6', '#2563EB']}
    style={styles.openPdfButton}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 0 }}
    >
    <MaterialCommunityIcons name="file-pdf-box" size={24} color="white" />
    <AppText style={styles.openPdfButtonText}>{t.openPdf}</AppText>
    </LinearGradient>
    </TouchableOpacity>
    </View>
    
    <View style={[styles.openPdfButtonContainer, { marginTop: spacing.md }]}>
    <TouchableOpacity onPress={() => {
    // For iOS, close modal first with delay before submitting
    if (Platform.OS === 'ios') {
    closeModal();
    setTimeout(() => {
    handleSubmit();
    }, 400);
    } else {
    InteractionManager.runAfterInteractions(() => {
    handleSubmit();
    });
    }
    }}>
    <LinearGradient
    colors={config.gradient}
    style={styles.openPdfButton}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 0 }}
    >
    <MaterialCommunityIcons name="check-circle" size={24} color="white" />
    <AppText style={styles.openPdfButtonText}>{t.submit}</AppText>
    </LinearGradient>
    </TouchableOpacity>
    </View>
    </View>
    </>
    )}
    
    {/* PDF Viewer Content (iOS WebView) */}
    {modalState.type === 'pdfViewer' && Platform.OS === 'ios' && (
    <>
    <View style={[styles.pdfModalHeader, { backgroundColor: colors.surface, paddingTop: insets.top + 10 }]}>
    <AppText style={[styles.pdfModalTitle, { color: colors.primary }]}>
    {t.previewTitle}
    </AppText>
    <TouchableOpacity 
    onPress={() => {
    closeModal();
    // Use delay before showing PDF preview modal again
    setTimeout(() => {
    if (isMountedRef.current) {
    openModal('pdfPreview');
    }
    }, 300);
    }}
    style={styles.closePdfButton}
    >
    <Ionicons name="close" size={28} color={colors.textPrimary} />
    </TouchableOpacity>
    </View>
    
    <View style={{ flex: 1 }}>
    {previewURL && (
    <WebView
    source={{ uri: previewURL }}
    style={{ flex: 1, backgroundColor: '#525659' }}
    javaScriptEnabled={true}
    domStorageEnabled={true}
    startInLoadingState={true}
    scalesPageToFit={true}
    allowFileAccess={true}
    originWhitelist={['*']}
    renderLoading={() => (
    <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
    <ActivityIndicator size="large" color={colors.primary} />
    <AppText style={[styles.loadingText, { color: colors.textSecondary }]}>
    Loading PDF...
    </AppText>
    </View>
    )}
    onError={({ nativeEvent }) => onPdfError(nativeEvent)}
    />
    )}
    </View>
    </>
    )}
    </View>
    </AccessibleModal>
    </>
  );
}
