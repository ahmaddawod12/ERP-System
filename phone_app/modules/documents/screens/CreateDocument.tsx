/**
 * CreateDocument.js - Unified Document Creation Screen
 * 
 * This component handles creation of all document types:
 * - 305: Tax Invoice (requires VAT number for business customers)
 * - 400: Receipt (requires invoice selection + payment method)
 * - 10: Price Proposal
 * - 200: Delivery Note
 * - 210: Return Certificate
 * - 330: Refund Document
 * 
 * Uses Cloud API tasks for non-tax preview/generation and the dedicated tax
 * workflow for type 305.
 */

import React, { useState, useEffect, useRef, useMemo, useReducer } from 'react';
import {
  View,
  KeyboardAvoidingView,
  Platform,
  Linking,
  InteractionManager,
 } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getColors } from '../../../theme';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { GlobalHeader, ScrollableContainer } from '../../../components';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { useAuth, useDocumentTask } from '../../../hooks';
import { DOC_TYPE } from '@smart-job/contracts';
import { DOCUMENT_CONFIGS, getPaymentMethods } from '../lib/document-config';
import { getDocumentTranslations } from '../lib/document-copy';
import {
  TAX_SUBMISSION_UNAVAILABLE_MESSAGE,
  TAX_SUBMISSION_UNAVAILABLE_TITLE,
} from '../lib/tax-submission-status';
import { fetchCompanyInventoryParts } from '../../../utils/read-model';
import type { AlertButton, Client, InventoryPart } from '../../../types';
import { styles } from './CreateDocument.styles';
import { logger } from '../../../utils/logger';
import { getDateLikeTime, getErrorCode, getErrorMessage, toText, type BuiltClientData, type BuiltDocumentData, type ClientUpdates, type DocumentFormItem, type FormData, type InvoiceDocumentRecord, type ModalType, type ReceiptMode } from '../lib/create-document-model';
import { documentComposerReducer, initialDocumentComposerState } from '../lib/document-composer-machine';
import CreateDocumentForm from '../components/CreateDocumentForm';
import CreateDocumentModal from '../components/CreateDocumentModal';

export default function CreateDocument() {
  const router = useRouter();
  const params = useLocalSearchParams();
  // Parse documentType as number from URL params
  const documentType = (params.type ? Number(params.type) : DOC_TYPE.PRICE_PROPOSAL) as keyof typeof DOCUMENT_CONFIGS;
  const config = DOCUMENT_CONFIGS[documentType] || DOCUMENT_CONFIGS[DOC_TYPE.PRICE_PROPOSAL];
  
  const insets = useSafeAreaInsets();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { uid } = useAuth();
  const { 
    getCompanyId: getCachedCompanyId, 
    documents: cachedDocuments,
    profile,
    clients: cachedClients,
    inventory: cachedInventory,
    companyInventory: cachedCompanyInventory,
    getUserRole,
    addClient,
    updateClient,
    fetchClients,
  } = useCache();
  const colors = getColors(isDarkMode);
  
  // Refs for iOS freeze fix
  const isMountedRef = useRef(true);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const [companyId, setCompanyId] = useState('');
  const [previewURL, setPreviewURL] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Receipt mode: 'auto' (from invoice) or 'manual'
  const [receiptMode, setReceiptMode] = useState<ReceiptMode>(null); // null = not selected yet
  
  // Invoice selection state (for receipt auto mode)
  const [invoices, setInvoices] = useState<InvoiceDocumentRecord[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDocumentRecord | null>(null);
  const [invoiceSearchText, setInvoiceSearchText] = useState('');
  const [selectedClientObj, setSelectedClientObj] = useState<Client | null>(null);
  
  // 2-step flow state: All document types use 2-step flow (Step 1: Client, Step 2: Items)
  // Exception: Receipt has its own mode selection flow before the 2-step flow
  const isTwoStepFlow = !config.hasReceiptMode; // true for all except Receipt (which has auto/manual selection first)
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedPriceProposal, setSelectedPriceProposal] = useState<InvoiceDocumentRecord | null>(null);
  const [matchingProposals, setMatchingProposals] = useState<InvoiceDocumentRecord[]>([]);

  const [companyInventoryParts, setCompanyInventoryParts] = useState<InventoryPart[]>([]);
  
  // One reducer owns modal transitions so incompatible modal states cannot overlap.
  const [composerState, dispatchComposer] = useReducer(
    documentComposerReducer,
    initialDocumentComposerState,
  );
  const modalState = composerState.modal;
  const openModal = (type: Exclude<ModalType, null>) => dispatchComposer({ type: 'OPEN_MODAL', modalType: type });
  const closeModal = () => dispatchComposer({ type: 'CLOSE_MODAL' });
  
  // Form data
  const [formData, setFormData] = useState<FormData>({
    // Customer Details
    customerName: '',
    customerEmail: '',
    customerAddress: '',
    customerCity: '',
    customerPhone: '',
    customerId: '',
    // VAT Number - required for taxInvoice, optional for others
    clientVatNumber: '',
    // Receipt specific
    paymentMethod: '',
    paymentInfo: '', // Payment reference/details (check number, transfer ref, etc.)
    invoiceReference: '',
    // Common
    documentDate: new Date().toISOString().split('T')[0],
    notes: '',
  });

  // Items array
  const [items, setItems] = useState<DocumentFormItem[]>([
    {
      id: Date.now(),
      description: '',
      price: '',
      quantity: '1',
    }
  ]);

  // Payment methods for receipt
  const paymentMethods = getPaymentMethods(language);

  // Translations
  const t = getDocumentTranslations(language, documentType);

  // Filter cached documents to get tax invoices (for receipt auto mode)
  const taxInvoiceDocuments = useMemo(() => {
    if (!cachedDocuments || cachedDocuments.length === 0) return [];
    
    return cachedDocuments
      .filter((cert) => cert.type === DOC_TYPE.TAX_INVOICE || Number(cert.type) === DOC_TYPE.TAX_INVOICE)
      .map((cert) => {
        const record = cert as InvoiceDocumentRecord;
        return {
        ...record,
        createdAt:
          record.createdAt && typeof record.createdAt === 'object' && 'toDate' in record.createdAt
            ? record.createdAt.toDate()
            : record.createdAt
              ? new Date(String(record.createdAt))
              : new Date(),
        documentData: record.documentData || {
          client: {
            name: record.cname || record.client?.name || 'Unknown',
            email: record.client?.email || '',
            phone: record.cphone || record.client?.phone || '',
            address: record.client?.address || '',
          },
          items: record.items || [],
        },
        documentNumber: record.documentNumber || record.invoiceNumber || record.id,
      };
      })
      .sort((a, b) => {
        return getDateLikeTime(b.createdAt) - getDateLikeTime(a.createdAt);
      });
  }, [cachedDocuments]);

  // Initialize company name and business info from cache
  useEffect(() => {
    isMountedRef.current = true;
    
    const initialize = () => {
      if (!uid) return;
      
      try {
        const cachedCompanyId = getCachedCompanyId();
        if (cachedCompanyId) {
          setCompanyId(cachedCompanyId);
        }
        
        // Fetch clients if not already cached
        if (cachedClients.length === 0) {
          fetchClients();
        }
        
        // Set invoices from cached documents for receipt
        if (config.hasReceiptMode) {
          setInvoices(taxInvoiceDocuments);
        }
      } catch (error) {
        logger.error('Error initializing document composer:', error);
      }
    };

    initialize();
    
    return () => {
      isMountedRef.current = false;
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, [uid, documentType, taxInvoiceDocuments]);

  // Fetch company inventory for managers (for inline inventory search)
  useEffect(() => {
    const role = getUserRole();
    if (role !== 'manager') return;
    const cn = getCachedCompanyId();
    if (!cn) return;

    const fetchCompanyInventory = async () => {
      try {
        if (Array.isArray(cachedCompanyInventory) && cachedCompanyInventory.length > 0) {
          setCompanyInventoryParts(cachedCompanyInventory);
          return;
        }

        const parts = await fetchCompanyInventoryParts(cn);
        setCompanyInventoryParts(parts);
      } catch (error) {
        logger.warn('Failed to fetch company inventory:', error);
      }
    };
    fetchCompanyInventory();
  }, [cachedCompanyInventory, getUserRole, getCachedCompanyId]);

  // Get the inventory parts based on role (for item description search)
  const getInventoryParts = (): InventoryPart[] => {
    const role = getUserRole();
    if (role === 'manager') return companyInventoryParts;
    if (role === 'user' || role === 'worker') return cachedInventory || [];
    return []; // basic/dev: no inventory, type manually
  };

  // Find matching price proposals for the selected client
  const findMatchingProposals = (clientObj: Client | null) => {
    if (!cachedDocuments || cachedDocuments.length === 0) {
      setMatchingProposals([]);
      return;
    }

    const proposals = cachedDocuments
      .filter((cert) => cert.type === DOC_TYPE.PRICE_PROPOSAL)
      .map((cert) => cert as InvoiceDocumentRecord);
    if (proposals.length === 0) {
      setMatchingProposals([]);
      return;
    }

    let matched: InvoiceDocumentRecord[] = [];
    // Match by clientId first
    if (clientObj?.id) {
      matched = proposals.filter(p => p.clientId === clientObj.id);
    }
    // Fallback: match by customer name
    if (matched.length === 0 && clientObj?.name) {
      const nameToMatch = clientObj.name.toLowerCase();
      matched = proposals.filter(p => p.cname && p.cname.toLowerCase() === nameToMatch);
    }

    // Sort by creation date (newest first)
    matched.sort((a, b) => {
      return getDateLikeTime(b.createdAt) - getDateLikeTime(a.createdAt);
    });

    setMatchingProposals(matched);
  };

  // Apply prices from selected price proposal to items
  const applyPriceProposal = (proposal: InvoiceDocumentRecord) => {
    if (selectedPriceProposal?.id === proposal.id) {
      // Deselect
      setSelectedPriceProposal(null);
      return;
    }

    setSelectedPriceProposal(proposal);

    if (!proposal.items || proposal.items.length === 0) return;

    // Load proposal items into the items list
    const newItems: DocumentFormItem[] = proposal.items.map((item) => ({
      id: Date.now() + Math.random(),
      description: item.description || '',
      quantity: String(item.quantity || 1),
      price: String(item.price || ''),
      partId: item.partId || null,
    }));
    setItems(newItems);
  };

  // Step navigation for 2-step flow
  const goToStep2 = () => {
    if (!formData.customerName.trim()) {
      alert.error(
        'Error',
        t.customerNameRequired
      );
      return;
    }
    if (config.requiresVatNumber && !formData.clientVatNumber.trim()) {
      alert.error(
        'Error',
        t.vatNumberRequired
      );
      return;
    }
    setCurrentStep(2);
  };

  const goToStep1 = () => {
    setCurrentStep(1);
  };

  // Handle invoice selection (for receipt)
  const handleSelectInvoice = (invoice: InvoiceDocumentRecord) => {
    setSelectedInvoice(invoice);
    setSelectedClientObj(null); // Clear client selector since invoice fills customer data
    closeModal();
    
    const clientData = invoice.documentData?.client || {};
    const invoiceItems = invoice.documentData?.items || [];
    
    // Extract address parts - might be combined or separate
    let address = clientData.address || '';
    let city = clientData.city || '';
    
    // If address contains city info (common format: "123 Street, City")
    if (address && !city && address.includes(',')) {
      const parts = address.split(',');
      address = parts[0].trim();
      city = parts.slice(1).join(',').trim();
    }
    
    setFormData({
      ...formData,
      customerName: clientData.name || '',
      customerEmail: clientData.email || '',
      customerPhone: clientData.phone || '',
      customerAddress: address,
      customerCity: city,
      customerId: clientData.id || '',
      // Load VAT number from invoice - check all possible field names (clientVatNumber is the standard field in tax invoices)
      clientVatNumber: clientData.clientVatNumber || clientData.customerVatNumber || clientData.vatNumber || clientData.vat_number || clientData.VAT || '',
      invoiceReference: String(invoice.documentNumber || invoice.id),
    });

    setItems(invoiceItems.map((item, index) => ({
      id: Date.now() + index,
      description: item.description || '',
      price: String(item.price || 0),
      quantity: String(item.quantity || 1),
    })));
  };

  // Filter invoices by search text
  const filteredInvoices = invoices.filter(invoice => {
    const searchLower = invoiceSearchText.toLowerCase();
    const customerName = (invoice.documentData?.client?.name || '').toLowerCase();
    const docNumber = String(invoice.documentNumber || '');
    return customerName.includes(searchLower) || docNumber.includes(searchLower);
  });

  // Item management
  const addItem = () => {
    setItems([...items, {
      id: Date.now(),
      description: '',
      price: '',
      quantity: '1',
    }]);
  };

  const removeItem = (id: number) => {
    if (items.length === 1) {
      alert.error('Error', t.atLeastOneItem);
      return;
    }
    setItems(items.filter(item => item.id !== id));
  };

  const updateItem = (id: number, field: keyof DocumentFormItem, value: string | number | null) => {
    setItems(prev => {
      const updated = prev.map(item =>
        item.id === id ? { ...item, [field]: value } : item
      );
      // Auto-add row: if editing description of the last item AND it has inventory
      if (field === 'description' && typeof value === 'string' && value.trim() && getInventoryParts().length > 0) {
        const lastItem = updated[updated.length - 1];
        if (lastItem && lastItem.id === id) {
          updated.push({
            id: Date.now() + Math.random(),
            description: '',
            quantity: '1',
            price: '',
            partId: null,
          });
        }
      }
      return updated;
    });
  };

  // Handle inventory part selection for item description
  const handleItemPartSelect = (itemId: number, part: InventoryPart) => {
    setItems(prev => {
      const updated = prev.map(item =>
        item.id === itemId ? { ...item, description: part.name, partId: part.id || part.name } : item
      );
      // Auto-add row if this was the last item
      const lastItem = updated[updated.length - 1];
      if (lastItem && lastItem.id === itemId) {
        updated.push({
          id: Date.now() + Math.random(),
          description: '',
          quantity: '1',
          price: '',
          partId: null,
        });
      }
      return updated;
    });
  };

  // Calculate total
  const calculateTotal = () => {
    return items.reduce((sum, item) => {
      const price = Number(item.price) || 0;
      const qty = Number(item.quantity) || 1;
      return sum + (price * qty);
    }, 0);
  };

  // Form validation
  const validateForm = () => {
    // For receipt with auto mode, invoice must be selected
    if (config.hasReceiptMode && receiptMode === 'auto' && !selectedInvoice) {
      showValidationError(t.invoiceRequired);
      return false;
    }

    // Payment method required for receipt
    if (config.requiresPaymentMethod && !formData.paymentMethod) {
      showValidationError(t.paymentMethodRequired);
      return false;
    }

    // Customer name required
    if (!formData.customerName.trim()) {
      showValidationError(t.customerNameRequired);
      return false;
    }

    // VAT number required for all tax invoices
    if (config.requiresVatNumber && !formData.clientVatNumber.trim()) {
      showValidationError(t.vatNumberRequired);
      return false;
    }

    // At least one valid item required
    const validItems = items.filter(item => 
      item.description.trim() && toText(item.price).trim() && !Number.isNaN(Number(item.price))
    );

    if (validItems.length === 0) {
      showValidationError(t.atLeastOneItemWithPrice);
      return false;
    }

    return true;
  };
  
  // iOS-safe validation error display
  const showValidationError = (message: string) => {
    // Use custom alert with timing delay for iOS to avoid modal issues
    const delay = Platform.OS === 'ios' ? 150 : 0;
    setTimeout(() => {
      requestAnimationFrame(() => {
        InteractionManager.runAfterInteractions(() => {
          alert.error('Error', message);
        });
      });
    }, delay);
  };
  
  // iOS-safe success display
  const showSuccessMessage = (title: string, message: string, buttons: Array<{ text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }>) => {
    // Use custom alert with timing delay for iOS to avoid modal freeze
    const delay = Platform.OS === 'ios' ? 150 : 0;
    setTimeout(() => {
      requestAnimationFrame(() => {
        InteractionManager.runAfterInteractions(() => {
          alert.success(title, message, buttons);
        });
      });
    }, delay);
  };
  
  // iOS-safe error display
  const showErrorMessage = (title: string, message: string) => {
    // Use custom alert with timing delay for iOS
    const delay = Platform.OS === 'ios' ? 150 : 0;
    setTimeout(() => {
      requestAnimationFrame(() => {
        InteractionManager.runAfterInteractions(() => {
          alert.error(title, message);
        });
      });
    }, delay);
  };

  // Safe cleanup helper for iOS
  const safeCleanupStates = () => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
    if (isMountedRef.current) {
      setIsSubmitting(false);
      // For iOS, close modals with delay to prevent freeze
      if (Platform.OS === 'ios') {
        setTimeout(() => {
          if (isMountedRef.current) {
            closeModal();
          }
        }, 100);
      } else {
        closeModal();
      }
      alert.hideLoading();
    }
  };

  // Initialize the non-tax Cloud API publisher and shared task poller.
  const {
    publishPreview,
    publishGenerate,
    taskStatus,
    previewURL: taskPreviewURL,
    downloadURL: taskDownloadURL,
    isCompleted,
    isFailed,
    error: taskError,
    reset: resetTask,
  } = useDocumentTask({
    onPreviewComplete: (url) => {
      logger.debug('Document preview completed');
      setIsSubmitting(false);
      setPreviewURL(url);
      alert.hideLoading();
      
      // For iOS, use longer delay to prevent modal freeze
      const delay = Platform.OS === 'ios' ? 300 : 100;
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          if (isMountedRef.current) {
            openModal('pdfPreview');
          }
        }, delay);
      });
    },
    onGenerateComplete: (url, docId) => {
      logger.debug('Document generation completed');
      safeCleanupStates();
      
      const pdfUrl = url;
      
      // Use longer delay for iOS
      const delay = Platform.OS === 'ios' ? 500 : 300;
      setTimeout(() => {
        const buttons: AlertButton[] = [
          {
            text: t.done,
            style: 'default',
            onPress: () => {
              router.back();
            }
          }
        ];
        
        // Only add Open PDF button if URL exists
        if (pdfUrl) {
          buttons.unshift({
            text: t.openPdf,
            style: 'default',
            onPress: () => {
              Linking.openURL(pdfUrl).catch(err => {
                logger.error('Error opening generated document:', err);
                showErrorMessage('Error', 'Could not open PDF link');
              });
            }
          });
        }
        
        showSuccessMessage(
          t.successTitle,
          `${t.documentCreated}\nDocument ID: ${docId || 'Unknown'}`,
          buttons
        );
      }, delay);
    },
    onError: (error) => {
      logger.error('Document task error:', error);
      safeCleanupStates();
      
      // Use delay for iOS
      const delay = Platform.OS === 'ios' ? 300 : 100;
      setTimeout(() => {
        showErrorMessage('Error', error || 'Document generation failed');
      }, delay);
    },
  });

  // Build document data for API
  const buildDocumentData = (clientOverride?: Client | null) => {
    const resolvedClient = clientOverride ?? selectedClientObj;
    const incomeItems = items
      .filter(item => item.description.trim() && toText(item.price) && Number(item.price) > 0)
      .map(item => ({
        description: item.description,
        quantity: Number(item.quantity) || 1,
        price: Number(item.price),
        ...(item.partId && { partId: item.partId }),
      }));

    const clientData: BuiltClientData = {
      name: formData.customerName,
      email: formData.customerEmail || '',
      phone: formData.customerPhone || '',
      address: `${formData.customerAddress || ''} ${formData.customerCity || ''}`.trim(),
      city: formData.customerCity || '',
      id: formData.customerId || '',
      ...(resolvedClient && { clientId: resolvedClient.id }),
    };

    // Add VAT number - required for taxInvoice, optional for all others
    if (formData.clientVatNumber.trim()) {
      clientData.clientVatNumber = formData.clientVatNumber;
    }

    const docData: BuiltDocumentData = {
      client: clientData,
      items: incomeItems,
      language: language === 'he' ? 'he' : language === 'ar' ? 'ar' : 'en',
      date: formData.documentDate,
      notes: formData.notes || '',
    };

    // Add payment method, payment info, and invoice reference for receipt
    if (config.requiresPaymentMethod) {
      docData.paymentMethod = formData.paymentMethod;
      if (formData.paymentInfo.trim()) {
        docData.paymentInfo = formData.paymentInfo;
      }
      if (receiptMode === 'auto' && selectedInvoice) {
        docData.invoiceReference = formData.invoiceReference || String(selectedInvoice.documentNumber || '');
      }
    }

    return {
      documentType: documentType,
      companyId: companyId,
      documentData: docData,
    };
  };

  // Auto-save new client or update existing client with missing fields
  const autoSaveNewClient = async (): Promise<Client | null> => {
    if (selectedClientObj && formData.customerName.trim()) {
      // Update existing client with any newly filled fields
      try {
        const updates: ClientUpdates = {};
        if (formData.customerName.trim() && formData.customerName.trim() !== (selectedClientObj.name || '')) updates.name = formData.customerName.trim();
        if (formData.customerPhone?.trim() && formData.customerPhone.trim() !== (selectedClientObj.phone || '')) updates.phone = formData.customerPhone.trim();
        if (formData.customerEmail?.trim() && formData.customerEmail.trim() !== (selectedClientObj.email || '')) updates.email = formData.customerEmail.trim();
        if (formData.customerAddress?.trim() && formData.customerAddress.trim() !== (selectedClientObj.address || '')) updates.address = formData.customerAddress.trim();
        if (formData.customerCity?.trim() && formData.customerCity.trim() !== (selectedClientObj.city || '')) updates.city = formData.customerCity.trim();
        if (formData.clientVatNumber?.trim() && formData.clientVatNumber.trim() !== (selectedClientObj.vatNumber || '')) updates.vatNumber = formData.clientVatNumber.trim();
        if (Object.keys(updates).length > 0) {
          await updateClient(selectedClientObj.id, updates);
          logger.debug('Updated existing client fields', { fields: Object.keys(updates) });
        }
      } catch (e) {
        logger.debug('Update client failed (non-critical):', e);
      }
      return selectedClientObj;
    } else if (!selectedClientObj && formData.customerName.trim()) {
      // Save as new client
      try {
        const clientToSave: ClientUpdates & { name: string } = { name: formData.customerName.trim() };
        if (formData.customerPhone?.trim()) clientToSave.phone = formData.customerPhone.trim();
        if (formData.customerEmail?.trim()) clientToSave.email = formData.customerEmail.trim();
        if (formData.customerAddress?.trim()) clientToSave.address = formData.customerAddress.trim();
        if (formData.customerCity?.trim()) clientToSave.city = formData.customerCity.trim();
        if (formData.clientVatNumber?.trim()) clientToSave.vatNumber = formData.clientVatNumber.trim();
        const savedClient = await addClient(clientToSave);
        if (savedClient) {
          setSelectedClientObj(savedClient);
          setFormData(prev => ({ ...prev, customerId: savedClient.id }));
          return savedClient;
        }
      } catch (e) {
        logger.debug('Auto-save client failed (non-critical):', e);
      }
    }
    return null;
  };

  // Handle preview
  const handlePreview = async () => {
    if (!validateForm()) return;
    if (isSubmitting) return;

    setIsSubmitting(true);
    alert.loading();

    try {
      const documentData = buildDocumentData();
      await publishPreview(documentData);
      logger.debug('Preview task published; waiting for completion');
    } catch (error) {
      logger.error('Error previewing document:', error);
      setIsSubmitting(false);
      alert.hideLoading();
      
      let errorMessage = `Failed to preview ${t.documentTypeName}`;
      if (getErrorCode(error) === 'unauthenticated') {
        errorMessage = 'Please login again to preview documents';
      } else {
        errorMessage = getErrorMessage(error, errorMessage);
      }
      
      showErrorMessage('Error', errorMessage);
    }
  };

  // Handle submit (generate)
  const handleSubmit = async () => {
    if (!validateForm()) return;
    if (isSubmitting) return;

    // Auto-save new client before generating
    const resolvedClient = await autoSaveNewClient();

    // Special handling for Tax Invoice (requires Tax Authority approval)
    if (documentType === DOC_TYPE.TAX_INVOICE) {
      await handleSubmitTaxInvoice();
      return;
    }

    setIsSubmitting(true);
    alert.loading();

    try {
      const documentData = buildDocumentData(resolvedClient);

      if (!companyId) {
        setIsSubmitting(false);
        alert.hideLoading();
        showErrorMessage('Error', 'Company name not found. Please try logging in again.');
        return;
      }

      await publishGenerate(documentData);
      logger.debug('Generate task published; waiting for completion');
    } catch (error) {
      logger.error('Error creating document:', error);
      setIsSubmitting(false);
      alert.hideLoading();
      
      let errorMessage = `Failed to create ${t.documentTypeName}`;
      if (getErrorCode(error) === 'unauthenticated') {
        errorMessage = 'Please login again to create documents';
      } else if (getErrorCode(error) === 'permission-denied') {
        errorMessage = 'You do not have permission to create documents';
      } else {
        errorMessage = getErrorMessage(error, errorMessage);
      }
      
      showErrorMessage('Error', errorMessage);
    }
  };

  // Tax submission remains disabled until the authoritative Cloud API flow is
  // certified. Do not call the legacy reservation handler from this screen.
  const handleSubmitTaxInvoice = async () => {
    setIsSubmitting(false);
    alert.hideLoading();
    alert.info(TAX_SUBMISSION_UNAVAILABLE_TITLE, TAX_SUBMISSION_UNAVAILABLE_MESSAGE);
  };

  // Download and share PDF
  const downloadAndSharePDF = async () => {
    if (!previewURL) {
      showErrorMessage('Error', 'No PDF available');
      return;
    }

    try {
      if (Platform.OS === 'android') {
        const fileName = `${documentType}_${Date.now()}.pdf`;
        const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
        
        const downloadResult = await FileSystem.downloadAsync(previewURL, fileUri);
        
        if (downloadResult.status !== 200) {
          throw new Error('Failed to download PDF');
        }
        
        const contentUri = await FileSystem.getContentUriAsync(downloadResult.uri);
        
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1,
          type: 'application/pdf',
        });
      } else {
        // iOS: Close modal first, then reopen with viewer type
        closeModal();
        setTimeout(() => {
          if (isMountedRef.current) {
            openModal('pdfViewer');
          }
        }, 300);
      }
    } catch (error) {
      logger.error('Error opening PDF:', error);
      showErrorMessage('Error', `Failed to open PDF: ${getErrorMessage(error, String(error))}`);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar style={isDarkMode ? "light" : "dark"} />

        <ScrollableContainer 
          style={[styles.scrollView, { backgroundColor: colors.background }]}
          contentContainerStyle={[styles.scrollContent, { paddingTop: 100, paddingBottom: insets.bottom + 20 }]}
        >
          <CreateDocumentForm
            addItem={addItem}
            applyPriceProposal={applyPriceProposal}
            cachedClients={cachedClients}
            calculateTotal={calculateTotal}
            colors={colors}
            config={config}
            currentStep={currentStep}
            documentType={documentType}
            findMatchingProposals={findMatchingProposals}
            formData={formData}
            getInventoryParts={getInventoryParts}
            goToStep1={goToStep1}
            goToStep2={goToStep2}
            handleItemPartSelect={handleItemPartSelect}
            handlePreview={handlePreview}
            isSubmitting={isSubmitting}
            isTwoStepFlow={isTwoStepFlow}
            items={items}
            language={language}
            matchingProposals={matchingProposals}
            openModal={openModal}
            paymentMethods={paymentMethods}
            receiptMode={receiptMode}
            removeItem={removeItem}
            selectedClientObj={selectedClientObj}
            selectedInvoice={selectedInvoice}
            selectedPriceProposal={selectedPriceProposal}
            setFormData={setFormData}
            setItems={setItems}
            setMatchingProposals={setMatchingProposals}
            setReceiptMode={setReceiptMode}
            setSelectedClientObj={setSelectedClientObj}
            setSelectedInvoice={setSelectedInvoice}
            setSelectedPriceProposal={setSelectedPriceProposal}
            t={t}
            updateItem={updateItem}
          />
        </ScrollableContainer>

        <CreateDocumentModal
          closeModal={closeModal}
          colors={colors}
          config={config}
          downloadAndSharePDF={downloadAndSharePDF}
          filteredInvoices={filteredInvoices}
          handleSelectInvoice={handleSelectInvoice}
          handleSubmit={handleSubmit}
          insets={{ top: insets.top }}
          invoiceSearchText={invoiceSearchText}
          isDarkMode={isDarkMode}
          isMountedRef={isMountedRef}
          modalState={modalState}
          onPdfError={(nativeEvent) => {
            logger.warn('Document WebView error:', nativeEvent);
            alert.error('Error', 'Failed to load PDF preview');
          }}
          openModal={openModal}
          previewURL={previewURL}
          setInvoiceSearchText={setInvoiceSearchText}
          t={t}
        />
        <GlobalHeader />
      </View>
    </KeyboardAvoidingView>
  );
}

// Translation helper function
