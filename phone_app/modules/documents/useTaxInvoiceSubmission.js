import { useState } from 'react';
import { Platform, Linking } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { middleEastFunctions, httpsCallable } from '../../firebase';
import { useDocumentTask } from '../../hooks';

/**
 * Custom hook that handles tax invoice submission, preview, and PDF operations.
 * Extracted from GenerateTaxInvoice.js for modularity.
 */
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
}) {
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewURL, setPreviewURL] = useState(null);
  const [pdfModalVisible, setPdfModalVisible] = useState(false);
  const [pdfViewerVisible, setPdfViewerVisible] = useState(false);
  const [pendingTaxInvoice, setPendingTaxInvoice] = useState(null);

  // Alert helpers
  const showValidationError = (title, message) => alert.error(title, message);
  const showSuccessMessage = (title, message, buttons) => alert.success(title, message, buttons);
  const showErrorMessage = (title, message) => alert.error(title, message);
  const showWarningMessage = (title, message, buttons) => alert.warning(title, message, buttons);
  const showInfoMessage = (title, message, buttons) => alert.info(title, message, buttons);

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
    const items = [];
    jobParts.forEach(part => {
      if (part.price && parseFloat(part.price) > 0) {
        items.push({
          description: part.name,
          quantity: parseFloat(part.quantity) || 1,
          price: parseFloat(part.price),
          ...(part.partId && { partId: part.partId }),
          ...(part.id && !part.partId && { partId: part.id }),
        });
      }
    });
    customParts.forEach(part => {
      if (part.name.trim() && part.price && parseFloat(part.price) > 0) {
        items.push({
          description: part.name,
          quantity: parseFloat(part.quantity) || 1,
          price: parseFloat(part.price),
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

      // Firestore listener in useDocumentTask will handle the completion
      console.log('Preview task published, waiting for completion...');
    } catch (error) {
      console.error('Error previewing invoice:', error);
      if (Platform.OS !== 'ios') {
        alert.hideLoading();
      }
      setPreviewLoading(false);
      let errorMessage = 'Failed to preview tax invoice';
      
      if (error.code === 'unauthenticated') {
        errorMessage = 'Please login again to preview documents';
      } else if (error.code === 'failed-precondition') {
        errorMessage = 'Token expired. Please refresh the page.';
      } else if (error.message) {
        errorMessage = error.message;
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
      showErrorMessage('Error', 'Failed to open PDF: ' + (error.message || error));
    }
  };

  /** Submit the invoice to Tax Authority and generate final PDF */
  const handleSubmitInvoice = async () => {
    if (!validateInvoiceForm()) return;

    // Business info is fetched by Cloud Functions directly from Firestore

    setPreviewLoading(true);

    try {
      const items = buildItems();

      if (items.length === 0) {
        showValidationError('Error', 'Please add at least one item with a price');
        setPreviewLoading(false);
        return;
      }

      // Get next invoice number - Cloud Functions will fetch from Firestore directly
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

      // Build document data - Cloud Functions will fetch business_info from Firestore
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
      };

      // STEP 1: Call getInvoiceApproval to save document and submit to Tax Authority
      console.log('📋 Step 1: Submitting to Tax Authority...');
      const getApprovalFunction = httpsCallable(middleEastFunctions, 'getInvoiceApproval');
      
      let approvalResult;
      try {
        approvalResult = await getApprovalFunction(documentData);
        console.log('✅ Tax Authority response:', approvalResult.data);
      } catch (approvalError) {
        // Tax Authority rejected or error during approval
        console.error('❌ Tax Authority rejection:', approvalError);
        setPreviewLoading(false);
        
        if (approvalError.code === 'failed-precondition') {
          // Tax Authority explicitly rejected the invoice
          showWarningMessage(
            'Tax Authority Rejected',
            approvalError.message || 'Tax Authority did not approve the invoice.\n\nPlease check your invoice details and try again.',
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

      // Verify approval (should always be true if we get here)
      if (!approvalResult.data.success || !approvalResult.data.approved) {
        setPreviewLoading(false);
        showErrorMessage('Error', 'Unexpected response from Tax Authority. Please try again.');
        return;
      }

      // Tax Authority approved! PDF generation is now async via Pub/Sub
      console.log('✅ Tax Authority approved! Document ID:', approvalResult.data.documentId);
      console.log('📄 Confirmation Number:', approvalResult.data.confirmationNumber);
      console.log('📄 PDF Task Published:', approvalResult.data.pdfTaskPublished);
      console.log('📄 PDF Task ID:', approvalResult.data.pdfTaskId);

      // Check if PDF task was published successfully
      if (approvalResult.data.pdfTaskPublished && approvalResult.data.pdfTaskId) {
        // Store pending invoice info for when PDF completes
        setPendingTaxInvoice({
          documentId: approvalResult.data.documentId,
          documentNumber: approvalResult.data.documentNumber || 'N/A',
          confirmationNumber: approvalResult.data.confirmationNumber,
        });
        
        // Start listening to the PDF generation task via Pub/Sub
        console.log('📡 Starting to listen for PDF task:', approvalResult.data.pdfTaskId);
        listenToTask(approvalResult.data.pdfTaskId);
        
        // Keep loading indicator while waiting for PDF
        // The useDocumentTask hook callbacks will handle completion/error
        showInfoMessage(
          'Tax Authority Approved!',
          `Invoice approved with confirmation: ${approvalResult.data.confirmationNumber}\n\nGenerating PDF... Please wait.`,
          [{ text: 'OK', style: 'default', onPress: () => {} }]
        );
      } else {
        // PDF task publishing failed but document was saved and approved
        setPreviewLoading(false);
        
        const partialSuccessMessage = `Tax Invoice approved but PDF generation task could not be started.\n\nDocument ID: ${approvalResult.data.documentId}\n\n✅ Tax Authority Approved\nConfirmation: ${approvalResult.data.confirmationNumber}\n\n⚠️ PDF not scheduled\n\nYou can regenerate the PDF from Document History.`;
        
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
      
      if (error.code === 'unauthenticated') {
        errorMessage = 'Please login again to create documents';
      } else if (error.code === 'permission-denied') {
        errorMessage = 'You do not have permission to create documents';
      } else if (error.code === 'failed-precondition') {
        errorTitle = 'Tax Authority Error';
        errorMessage = error.message || 'Tax Authority rejected the submission';
      } else if (error.message) {
        errorMessage = error.message;
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

