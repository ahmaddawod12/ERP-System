import { useState } from 'react';
import { Platform, Linking } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { middleEastFunctions, httpsCallable } from '../../../firebase';
import { useDocumentTask } from '../../../hooks';
import type { AlertButton, AlertContextValue } from '../../../types';

interface InvoiceData {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerCity?: string;
  customerVatNumber?: string;
  customerId?: string;
  invoiceDate?: string;
  serviceDescription?: string;
}

interface InvoicePart {
  name: string;
  price: string;
  quantity: string;
  partId?: string;
  id?: string;
}

interface SelectedJob {
  id: string;
  title?: string;
  wname?: string;
}

interface UseTaxInvoiceSubmissionParams {
  companyId: string;
  invoiceData: InvoiceData;
  jobParts: InvoicePart[];
  customParts: InvoicePart[];
  selectedJobs: SelectedJob[];
  selectedPriceProposal: { id: string } | null;
  language: string;
  setModalVisible: (v: boolean) => void;
  validateInvoiceForm: () => boolean;
  alert: AlertContextValue;
  router: { back: () => void };
}

interface PendingTaxInvoice {
  documentId: string;
  documentNumber: string;
  confirmationNumber: string;
}

interface BuiltInvoiceItem {
  description: string;
  quantity: number;
  price: number;
  partId?: string;
}

interface TaxApprovalResponseData {
  success?: boolean;
  status?: string;
  error?: string;
  documentId?: string;
  documentNumber?: string;
  confirmationNumber?: string;
  pdfTaskId?: string;
}

function getErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useTaxInvoiceSubmission({
  companyId,
  invoiceData,
  jobParts,
  customParts,
  selectedJobs,
  selectedPriceProposal,
  language,
  setModalVisible,
  validateInvoiceForm,
  alert,
  router,
}: UseTaxInvoiceSubmissionParams) {
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewURL, setPreviewURL] = useState<string | null>(null);
  const [pdfModalVisible, setPdfModalVisible] = useState(false);
  const [pdfViewerVisible, setPdfViewerVisible] = useState(false);
  const [pendingTaxInvoice, setPendingTaxInvoice] = useState<PendingTaxInvoice | null>(null);

  // Alert helpers
  const showValidationError = (title: string, message: string) => alert.error(title, message);
  const showSuccessMessage = (title: string, message: string, buttons?: AlertButton[]) => alert.success(title, message, buttons);
  const showErrorMessage = (title: string, message: string) => alert.error(title, message);
  const showWarningMessage = (title: string, message: string, buttons?: AlertButton[]) => alert.warning(title, message, buttons);
  const showInfoMessage = (title: string, message: string, buttons?: AlertButton[]) => alert.info(title, message, buttons);

  // Document task hook for listening to async PDF generation via Pub/Sub
  const {
    listenToTask,
    publishPreview,
  } = useDocumentTask({
    onPreviewComplete: (url) => {
      console.log('📄 Preview completed via Pub/Sub:', url);
      if (Platform.OS !== 'ios') {
        alert.hideLoading();
      }
      setPreviewLoading(false);
      setPreviewURL(url);
      setModalVisible(false);
      setTimeout(() => {
        setPdfModalVisible(true);
      }, Platform.OS === 'ios' ? 300 : 150);
    },
    onGenerateComplete: (url, docId) => {
      console.log('📄 PDF generation completed via Pub/Sub:', url, docId);
      setPreviewLoading(false);
      
      if (pendingTaxInvoice) {
        const { documentId, documentNumber, confirmationNumber } = pendingTaxInvoice;
        
        const successMessage = `Tax Invoice created successfully!\n\nDocument ID: ${documentId}\nInvoice #: TAX-${documentNumber}\n\n✅ Tax Authority Approved\nConfirmation: ${confirmationNumber}\n\n✅ PDF Generated Successfully`;
        
        showSuccessMessage(
          'Success!',
          successMessage,
          [
            {
              text: 'Open PDF',
              style: 'default',
              onPress: () => {
                if (!url) {
                  showErrorMessage('Error', 'Could not open PDF link');
                  return;
                }
                Linking.openURL(url).catch(err => {
                  console.error('Error opening URL:', err);
                  showErrorMessage('Error', 'Could not open PDF link');
                });
              }
            },
            {
              text: 'Done',
              style: 'default',
              onPress: () => {
                router.back();
              }
            }
          ]
        );
        
        setPendingTaxInvoice(null);
      }
    },
    onError: (error) => {
      console.error('📄 PDF generation failed via Pub/Sub:', error);
      setPreviewLoading(false);
      
      if (pendingTaxInvoice) {
        const { documentId, confirmationNumber } = pendingTaxInvoice;
        
        const partialSuccessMessage = `Tax Invoice approved but PDF generation failed.\n\nDocument ID: ${documentId}\n\n✅ Tax Authority Approved\nConfirmation: ${confirmationNumber}\n\n⚠️ PDF Error: ${error || 'Unknown error'}\n\nYou can regenerate the PDF from Document History.`;
        
        showWarningMessage(
          'Partial Success',
          partialSuccessMessage,
          [
            {
              text: 'OK',
              style: 'default',
              onPress: () => {
                router.back();
              }
            }
          ]
        );
        
        setPendingTaxInvoice(null);
      }
    },
  });

  /** Build the items array from job parts and custom parts */
  const buildItems = () => {
    const items: BuiltInvoiceItem[] = [];
    jobParts.forEach(part => {
      if (part.price && Number(part.price) > 0) {
        items.push({
          description: part.name,
          quantity: Number(part.quantity) || 1,
          price: Number(part.price),
          ...(part.partId && { partId: part.partId }),
          ...(part.id && !part.partId && { partId: part.id }),
        });
      }
    });
    customParts.forEach(part => {
      if (part.name.trim() && part.price && Number(part.price) > 0) {
        items.push({
          description: part.name,
          quantity: Number(part.quantity) || 1,
          price: Number(part.price),
          ...(part.partId && { partId: part.partId }),
        });
      }
    });
    return items;
  };

  /** Preview the invoice (generates PDF preview via Pub/Sub) */
  const handlePreviewInvoice = async () => {
    console.log('handlePreviewInvoice called');
    if (!validateInvoiceForm()) {
      console.log('Validation failed');
      return;
    }
    console.log('Validation passed, starting preview...');

    if (Platform.OS !== 'ios') {
      alert.loading();
    }
    setPreviewLoading(true);

    try {
      const items = buildItems();

      if (items.length === 0) {
        if (Platform.OS !== 'ios') {
          alert.hideLoading();
        }
        showValidationError('Error', 'Please add at least one item with a price');
        setPreviewLoading(false);
        return;
      }

      // Publish preview task to Pub/Sub
      await publishPreview({
        documentType: 'taxInvoice',
        companyId: companyId,
        documentData: {
          client: {
            name: invoiceData.customerName,
            email: invoiceData.customerEmail || '',
            phone: invoiceData.customerPhone || '',
            address: invoiceData.customerAddress || '',
            vatNumber: invoiceData.customerVatNumber || '',
          },
          items,
          language: language === 'he' ? 'he' : language === 'ar' ? 'ar' : 'en',
          date: invoiceData.invoiceDate,
          notes: invoiceData.serviceDescription || '',
        },
      });

      // useDocumentTask polls the backend read model until the task completes.
      console.log('Preview task published, waiting for completion...');
    } catch (error) {
      console.error('Error previewing invoice:', error);
      if (Platform.OS !== 'ios') {
        alert.hideLoading();
      }
      setPreviewLoading(false);
      let errorMessage = 'Failed to preview tax invoice';
      
      if (getErrorCode(error) === 'unauthenticated') {
        errorMessage = 'Please login again to preview documents';
      } else if (getErrorCode(error) === 'failed-precondition') {
        errorMessage = 'Token expired. Please refresh the page.';
      } else {
        errorMessage = getErrorMessage(error, errorMessage);
      }
      
      showErrorMessage('Error', errorMessage);
    }
  };

  /** Download and share/open the PDF */
  const downloadAndSharePDF = async () => {
    if (!previewURL) {
      showErrorMessage('Error', 'No PDF available');
      return;
    }

    try {
      if (Platform.OS === 'android') {
        // Android: Download PDF and open with native viewer using IntentLauncher
        const fileName = `tax_invoice_${Date.now()}.pdf`;
        const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
        
        // Download PDF from URL
        const downloadResult = await FileSystem.downloadAsync(previewURL, fileUri);
        
        if (downloadResult.status !== 200) {
          throw new Error('Failed to download PDF');
        }
        
        // Get content URI for Android
        const contentUri = await FileSystem.getContentUriAsync(downloadResult.uri);
        
        // Open with system PDF viewer
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1,
          type: 'application/pdf',
        });
      } else {
        // iOS: Open WebView modal with delay
        setPdfModalVisible(false);
        setTimeout(() => {
          setPdfViewerVisible(true);
        }, Platform.OS === 'ios' ? 300 : 0);
      }
    } catch (error) {
      console.error('Error opening PDF:', error);
      showErrorMessage('Error', `Failed to open PDF: ${getErrorMessage(error, String(error))}`);
    }
  };

  /** Submit the invoice to Tax Authority and generate final PDF */
  const handleSubmitInvoice = async () => {
    if (!validateInvoiceForm()) return;

    // Business info is fetched by the backend from SQL.

    setPreviewLoading(true);

    try {
      const items = buildItems();

      if (items.length === 0) {
        showValidationError('Error', 'Please add at least one item with a price');
        setPreviewLoading(false);
        return;
      }

      // Get next invoice number - backend allocates it through SQL counters.
      // We no longer use cached business info for security
      console.log('📄 Submitting tax invoice (business info fetched by Cloud Functions)...');

      // Build client data - VAT number is always required for Tax Invoice
      const clientData = {
        name: invoiceData.customerName,
        email: invoiceData.customerEmail || '',
        phone: invoiceData.customerPhone || '',
        address: `${invoiceData.customerAddress || ''} ${invoiceData.customerCity || ''}`.trim(),
        id: invoiceData.customerId || '',
        customerVatNumber: invoiceData.customerVatNumber, // Always included for Tax Invoice
      };

      // Build document data - backend fetches business_info from SQL.
      const documentData = {
        type: 305,
        client: clientData,
        items,
        companyId: companyId,
        language: language === 'he' ? 'he' : language === 'ar' ? 'ar' : 'en',
        date: invoiceData.invoiceDate,
        notes: invoiceData.serviceDescription || '',
        // Multi-job support: send all selected job references
        jobsData: selectedJobs.length > 0 ? selectedJobs.map(job => ({
          jobId: job.id,
          jobTitle: job.title,
          worker: job.wname || 'N/A',
        })) : undefined,
        // Price proposal reference (to mark as used)
        priceProposalId: selectedPriceProposal?.id || null,
        idempotencyKey: `tax_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
      };

      // STEP 1: Call getInvoiceApproval to save document and submit to Tax Authority
      console.log('📋 Step 1: Submitting to Tax Authority...');
      const getApprovalFunction = httpsCallable(middleEastFunctions, 'getInvoiceApproval');
      
      let approvalResult: { data: TaxApprovalResponseData };
      try {
        approvalResult = await getApprovalFunction(documentData) as { data: TaxApprovalResponseData };
        console.log('✅ Tax Authority response:', approvalResult.data);
      } catch (approvalError) {
        // Tax Authority rejected or error during approval
        console.error('❌ Tax Authority rejection:', approvalError);
        setPreviewLoading(false);
        
        if (getErrorCode(approvalError) === 'failed-precondition') {
          // Tax Authority explicitly rejected the invoice
          showWarningMessage(
            'Tax Authority Rejected',
            getErrorMessage(approvalError, 'Tax Authority did not approve the invoice.\n\nPlease check your invoice details and try again.'),
            [
              {
                text: 'OK',
                style: 'default',
                onPress: () => {}
              }
            ]
          );
        } else {
          // Other error during submission
          throw approvalError; // Re-throw to be caught by outer catch
        }
        return;
      }

      if (!approvalResult.data.success) {
        setPreviewLoading(false);
        showErrorMessage('Error', approvalResult.data.error || 'Unexpected response from Tax Authority. Please try again.');
        return;
      }

      const approvalData = approvalResult.data;

      // Tax Authority approved! PDF generation is now async via Pub/Sub
      console.log('✅ Tax Authority approved! Document ID:', approvalData.documentId);
      console.log('📄 Confirmation Number:', approvalData.confirmationNumber);
      console.log('📄 PDF Task ID:', approvalData.pdfTaskId);

      // Check if PDF task was published successfully
      if (approvalData.pdfTaskId) {
        // Store pending invoice info for when PDF completes
        setPendingTaxInvoice({
          documentId: approvalData.documentId || 'Unknown',
          documentNumber: approvalData.documentNumber || 'N/A',
          confirmationNumber: approvalData.confirmationNumber || 'Pending callback',
        });
        
        // Start listening to the PDF generation task via Pub/Sub
        console.log('📡 Starting to listen for PDF task:', approvalData.pdfTaskId);
        listenToTask(approvalData.pdfTaskId);
        
        // Keep loading indicator while waiting for PDF
        // The useDocumentTask hook callbacks will handle completion/error
        showInfoMessage(
          'Tax Authority Approved!',
          `Invoice approved with confirmation: ${approvalData.confirmationNumber || 'Pending callback'}\n\nGenerating PDF... Please wait.`,
          [{ text: 'OK', style: 'default', onPress: () => {} }]
        );
      } else {
        // PDF task publishing failed but document was saved and approved
        setPreviewLoading(false);
        
        const partialSuccessMessage = `Tax Invoice approved but PDF generation task could not be started.\n\nDocument ID: ${approvalData.documentId || 'Unknown'}\n\n✅ Tax Authority Approved\nConfirmation: ${approvalData.confirmationNumber || 'Pending callback'}\n\n⚠️ PDF not scheduled\n\nYou can regenerate the PDF from Document History.`;
        
        showWarningMessage(
          'Partial Success',
          partialSuccessMessage,
          [
            {
              text: 'OK',
              style: 'default',
              onPress: () => {
                router.back();
              }
            }
          ]
        );
      }
      
    } catch (error) {
      console.error('Error creating tax invoice:', error);
      setPreviewLoading(false);
      
      let errorMessage = 'Failed to create tax invoice';
      let errorTitle = 'Error';
      
      if (getErrorCode(error) === 'unauthenticated') {
        errorMessage = 'Please login again to create documents';
      } else if (getErrorCode(error) === 'permission-denied') {
        errorMessage = 'You do not have permission to create documents';
      } else if (getErrorCode(error) === 'failed-precondition') {
        errorTitle = 'Tax Authority Error';
        errorMessage = getErrorMessage(error, 'Tax Authority rejected the submission');
      } else {
        errorMessage = getErrorMessage(error, errorMessage);
      }
      
      showErrorMessage(errorTitle, errorMessage);
    }
  };

  return {
    previewLoading,
    previewURL,
    pdfModalVisible,
    setPdfModalVisible,
    pdfViewerVisible,
    setPdfViewerVisible,
    pendingTaxInvoice,
    handlePreviewInvoice,
    handleSubmitInvoice,
    downloadAndSharePDF,
  };
}


