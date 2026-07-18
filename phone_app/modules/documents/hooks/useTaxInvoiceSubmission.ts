import { useState } from 'react';
import { Platform, Linking } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { useDocumentTask } from '../../../hooks';
import type { AlertContextValue } from '../../../types';
import {
  TAX_SUBMISSION_UNAVAILABLE_MESSAGE,
  TAX_SUBMISSION_UNAVAILABLE_TITLE,
} from '../lib/tax-submission-status';

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
}

interface BuiltInvoiceItem {
  description: string;
  quantity: number;
  price: number;
  partId?: string;
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
}: UseTaxInvoiceSubmissionParams) {
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewURL, setPreviewURL] = useState<string | null>(null);
  const [pdfModalVisible, setPdfModalVisible] = useState(false);
  const [pdfViewerVisible, setPdfViewerVisible] = useState(false);

  // Alert helpers
  const showValidationError = (title: string, message: string) => alert.error(title, message);
  const showErrorMessage = (title: string, message: string) => alert.error(title, message);

  // Preview remains available; final tax submission is gated separately.
  const { publishPreview } = useDocumentTask({
    onPreviewComplete: (url) => {
      console.log('Preview completed via Pub/Sub:', url);
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

  /** Final submission is unavailable until the authoritative workflow is certified. */
  const handleSubmitInvoice = async () => {
    if (!validateInvoiceForm()) return;
    setPreviewLoading(false);
    alert.hideLoading();
    alert.info(TAX_SUBMISSION_UNAVAILABLE_TITLE, TAX_SUBMISSION_UNAVAILABLE_MESSAGE);
  };

  return {
    previewLoading,
    previewURL,
    pdfModalVisible,
    setPdfModalVisible,
    pdfViewerVisible,
    setPdfViewerVisible,
    handlePreviewInvoice,
    handleSubmitInvoice,
    downloadAndSharePDF,
  };
}

