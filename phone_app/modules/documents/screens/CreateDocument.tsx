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
 * Uses Pub/Sub architecture with publishPreviewTask and publishGenerateTask
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ActivityIndicator,
  Linking,
  FlatList,
  InteractionManager,
 } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getColors, spacing, borderRadius, typography, shadows } from '../../../theme';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { AppText, GlobalHeader, ScrollableContainer, ClientSelector, InventoryItemSearch, AppInput } from '../../../components';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { WebView } from 'react-native-webview';
import { useAuth, useDocumentTask } from '../../../hooks';
import { middleEastFunctions, httpsCallable } from '../../../firebase';
import { DOC_TYPE } from '@smart-job/contracts';
import { DOCUMENT_CONFIGS, getPaymentMethods } from '../lib/document-config';
import { getDocumentTranslations } from '../lib/document-copy';
import { fetchCompanyInventoryParts } from '../../../utils/read-model';
import type { AlertButton, AppDocument, Client, DateLike, DocumentItem, InventoryPart } from '../../../types';
import { styles } from './CreateDocument.styles';

import { formatDateLike, getDateLikeTime, getErrorCode, getErrorMessage, toText, type BuiltClientData, type BuiltDocumentData, type ClientUpdates, type DocumentFormItem, type FormData, type InvoiceDocumentRecord, type ModalType, type ReceiptMode } from '../lib/create-document-model';

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
  
  // Helper functions for unified modal
  const openModal = (type: Exclude<ModalType, null>) => setModalState({ visible: true, type });
  const closeModal = () => setModalState({ visible: false, type: null });
  
  // Unified Modal State (replaces multiple separate modals)
  const [modalState, setModalState] = useState({
    visible: false,
    type: null as ModalType,
  });
  
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
        console.error('Error initializing:', error);
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
        console.warn('Failed to fetch company inventory:', error);
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
    // Fallback: match by clientName
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
        language === 'he' ? '×©× ×œ×§×•×— × ×“×¨×©' : language === 'ar' ? 'Ø§Ø³Ù… Ø§Ù„Ø¹Ù…ÙŠÙ„ Ù…Ø·Ù„ÙˆØ¨' : 'Customer name is required'
      );
      return;
    }
    if (config.requiresVatNumber && !formData.clientVatNumber.trim()) {
      alert.error(
        'Error',
        language === 'he' ? '×ž×¡×¤×¨ ×¢×•×¡×§ ×ž×•×¨×©×” × ×“×¨×©' : language === 'ar' ? 'Ø±Ù‚Ù… Ø¶Ø±ÙŠØ¨Ø© Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„Ù…Ø¶Ø§ÙØ© Ù…Ø·Ù„ÙˆØ¨' : 'Customer VAT number is required'
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
    const clientName = (invoice.documentData?.client?.name || '').toLowerCase();
    const docNumber = String(invoice.documentNumber || '');
    return clientName.includes(searchLower) || docNumber.includes(searchLower);
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

  // Initialize document task hook for Pub/Sub
  const {
    publishPreview,
    publishGenerate,
    listenToTask,
    taskStatus,
    previewURL: taskPreviewURL,
    downloadURL: taskDownloadURL,
    isCompleted,
    isFailed,
    error: taskError,
    reset: resetTask,
  } = useDocumentTask({
    onPreviewComplete: (url) => {
      console.log('Preview complete, URL:', url);
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
      console.log('âœ… onGenerateComplete called - Document generated, URL:', url, 'ID:', docId);
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
                console.error('Error opening URL:', err);
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
      console.error('Document task error:', error);
      safeCleanupStates();
      
      // Use delay for iOS
      const delay = Platform.OS === 'ios' ? 300 : 100;
      setTimeout(() => {
        showErrorMessage('Error', error || 'Document generation failed');
      }, delay);
    },
  });

  // Build document data for API
  const buildDocumentData = () => {
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
      ...(selectedClientObj && { clientId: selectedClientObj.id }),
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
  const autoSaveNewClient = async () => {
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
          console.log('âœ… Updated existing client with new fields:', Object.keys(updates));
        }
      } catch (e) {
        console.log('Update client failed (non-critical):', e);
      }
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
        }
      } catch (e) {
        console.log('Auto-save client failed (non-critical):', e);
      }
    }
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
      console.log('Preview task published, waiting for completion...');
    } catch (error) {
      console.error('Error previewing document:', error);
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
    await autoSaveNewClient();

    // Special handling for Tax Invoice (requires Tax Authority approval)
    if (documentType === DOC_TYPE.TAX_INVOICE) {
      await handleSubmitTaxInvoice();
      return;
    }

    setIsSubmitting(true);
    alert.loading();

    try {
      const documentData = buildDocumentData();

      if (!companyId) {
        setIsSubmitting(false);
        alert.hideLoading();
        showErrorMessage('Error', 'Company name not found. Please try logging in again.');
        return;
      }

      await publishGenerate(documentData);
      console.log('Generate task published, waiting for completion...');
    } catch (error) {
      console.error('Error creating document:', error);
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

  // Special submit handler for Tax Invoice (with Tax Authority approval)
  const handleSubmitTaxInvoice = async () => {
    setIsSubmitting(true);
    alert.loading();

    try {
      const incomeItems = items
        .filter(item => item.description.trim() && toText(item.price) && Number(item.price) > 0)
        .map(item => ({
          description: item.description,
          quantity: Number(item.quantity) || 1,
          price: Number(item.price),
        }));

      if (incomeItems.length === 0) {
        setIsSubmitting(false);
        alert.hideLoading();
        showErrorMessage('Error', t.atLeastOneItemWithPrice);
        return;
      }

      if (!companyId) {
        setIsSubmitting(false);
        alert.hideLoading();
        showErrorMessage('Error', 'Company name not found. Please try logging in again.');
        return;
      }

      // Business info is fetched by Cloud Functions directly from Firestore for security

      // Build client data - VAT required for all tax invoice customers
      const clientData = {
        name: formData.customerName,
        email: formData.customerEmail || '',
        phone: formData.customerPhone || '',
        address: `${formData.customerAddress || ''} ${formData.customerCity || ''}`.trim(),
        id: formData.customerId || '',
        clientVatNumber: formData.clientVatNumber,
      };

      // Build document data - Cloud Functions fetch business_info from Firestore
      const documentData = {
        type: DOC_TYPE.TAX_INVOICE,
        client: clientData,
        items: incomeItems,
        companyId: companyId,
        language: language === 'he' ? 'he' : language === 'ar' ? 'ar' : 'en',
        date: formData.documentDate,
        notes: formData.notes || '',
      idempotencyKey: `tax_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
      };

      // Call getInvoiceApproval to submit to Tax Authority
      console.log('ðŸ“‹ Submitting to Tax Authority...');
      const getApprovalFunction = httpsCallable(middleEastFunctions, 'getInvoiceApproval');
      
      const approvalResult = await getApprovalFunction(documentData) as {
        data: {
          success?: boolean;
          status?: string;
          error?: string;
          documentId?: string;
          documentNumber?: string | number;
          pdfTaskId?: string;
          confirmationNumber?: string;
        };
      };
      console.log('âœ… Tax Authority response:', approvalResult.data);

      if (!approvalResult.data.success) {
        throw new Error(approvalResult.data.error || 'Tax Authority did not approve the invoice');
      }

      const { documentId, documentNumber, pdfTaskId, confirmationNumber } = approvalResult.data;

      // Listen to PDF generation task
      if (pdfTaskId) {
        console.log('ðŸ“„ Listening to PDF generation task:', pdfTaskId);
        listenToTask(pdfTaskId, 'generate');
        // Keep loading state active - will be cleared by onGenerateComplete or onError
      } else {
        // No PDF task - approval completed but no PDF generation
        console.warn('âš ï¸ No PDF generation task returned from Tax Authority approval');
        setIsSubmitting(false);
        alert.hideLoading();
        
        // Show success without PDF
        setTimeout(() => {
          showSuccessMessage(
            t.successTitle,
            `Tax invoice approved!\nDocument ID: ${documentId}\nInvoice #: ${documentNumber || 'N/A'}\nConfirmation: ${confirmationNumber || 'Pending callback'}`,
            [
              {
                text: t.done,
                style: 'default',
                onPress: () => {
                  router.back();
                }
              }
            ]
          );
        }, Platform.OS === 'ios' ? 500 : 300);
      }

    } catch (error) {
      console.error('Error creating tax invoice:', error);
      setIsSubmitting(false);
      alert.hideLoading();
      
      let errorMessage = 'Failed to create tax invoice';
      if (getErrorCode(error) === 'failed-precondition') {
        errorMessage = getErrorMessage(error, 'Tax Authority did not approve the invoice. Please check your details.');
      } else {
        errorMessage = getErrorMessage(error, errorMessage);
      }
      
      showErrorMessage('Error', errorMessage);
    }
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
      console.error('Error opening PDF:', error);
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
          {/* Receipt Mode Selection (Auto from Invoice or Manual) */}
          {config.hasReceiptMode && receiptMode === null && (
            <View style={[styles.section, { backgroundColor: colors.surface }]}>
              <View style={styles.receiptModeTitleContainer}>
                <MaterialCommunityIcons name="receipt" size={28} color={colors.primary} />
                <AppText style={[styles.receiptModeMainTitle, { color: colors.primary }]}>
                  {t.selectReceiptMode}
                </AppText>
              </View>
              <AppText style={[styles.sectionDescription, { color: colors.textSecondary }]}>
                {t.selectReceiptModeDescription}
              </AppText>
              
              <View style={styles.receiptModeContainer}>
                {/* Auto from Invoice Option */}
                <TouchableOpacity
                  style={[styles.receiptModeCard, styles.receiptModeCardRecommended, { backgroundColor: colors.backgroundLight }]}
                  onPress={() => setReceiptMode('auto')}
                  activeOpacity={0.7}
                >
                  <View style={styles.recommendedBadge}>
                    <AppText style={styles.recommendedBadgeText}>
                      {language === 'en' ? 'Recommended' : language === 'he' ? '×ž×•×ž×œ×¥' : 'Ù…ÙˆØµÙ‰ Ø¨Ù‡'}
                    </AppText>
                  </View>
                  <LinearGradient
                    colors={['#10B981', '#059669']}
                    style={styles.receiptModeIconContainer}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <MaterialCommunityIcons name="file-document-multiple" size={32} color="white" />
                  </LinearGradient>
                  <AppText style={[styles.receiptModeTitle, { color: colors.textPrimary }]}>
                    {t.autoFromInvoice}
                  </AppText>
                  <AppText style={[styles.receiptModeDescription, { color: colors.textSecondary }]}>
                    {t.autoFromInvoiceDescription}
                  </AppText>
                  <View style={[styles.receiptModeFeatures, { borderTopColor: colors.border }]}>
                    <View style={styles.featureItem}>
                      <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                      <AppText style={[styles.featureText, { color: colors.textSecondary }]}>
                        {language === 'en' ? 'Pre-filled data' : language === 'he' ? '× ×ª×•× ×™× ×ž×•×›× ×™×' : 'Ø¨ÙŠØ§Ù†Ø§Øª Ø¬Ø§Ù‡Ø²Ø©'}
                      </AppText>
                    </View>
                    <View style={styles.featureItem}>
                      <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                      <AppText style={[styles.featureText, { color: colors.textSecondary }]}>
                        {language === 'en' ? 'Invoice linked' : language === 'he' ? '×ž×§×•×©×¨ ×œ×—×©×‘×•× ×™×ª' : 'Ù…Ø±ØªØ¨Ø· Ø¨Ø§Ù„ÙØ§ØªÙˆØ±Ø©'}
                      </AppText>
                    </View>
                  </View>
                </TouchableOpacity>
                
                {/* Manual Entry Option */}
                <TouchableOpacity
                  style={[styles.receiptModeCard, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}
                  onPress={() => setReceiptMode('manual')}
                  activeOpacity={0.7}
                >
                  <LinearGradient
                    colors={['#6B7280', '#4B5563']}
                    style={styles.receiptModeIconContainer}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <MaterialCommunityIcons name="pencil-outline" size={32} color="white" />
                  </LinearGradient>
                  <AppText style={[styles.receiptModeTitle, { color: colors.textPrimary }]}>
                    {t.manualEntry}
                  </AppText>
                  <AppText style={[styles.receiptModeDescription, { color: colors.textSecondary }]}>
                    {t.manualEntryDescription}
                  </AppText>
                  <View style={[styles.receiptModeFeatures, { borderTopColor: colors.border }]}>
                    <View style={styles.featureItem}>
                      <Ionicons name="create-outline" size={16} color="#6B7280" />
                      <AppText style={[styles.featureText, { color: colors.textSecondary }]}>
                        {language === 'en' ? 'Full control' : language === 'he' ? '×©×œ×™×˜×” ×ž×œ××”' : 'ØªØ­ÙƒÙ… ÙƒØ§Ù…Ù„'}
                      </AppText>
                    </View>
                    <View style={styles.featureItem}>
                      <Ionicons name="document-outline" size={16} color="#6B7280" />
                      <AppText style={[styles.featureText, { color: colors.textSecondary }]}>
                        {language === 'en' ? 'No invoice needed' : language === 'he' ? '×œ×œ× ×—×©×‘×•× ×™×ª' : 'Ø¨Ø¯ÙˆÙ† ÙØ§ØªÙˆØ±Ø©'}
                      </AppText>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Receipt Mode Change Button (when already selected) */}
          {config.hasReceiptMode && receiptMode !== null && (
            <View style={[styles.section, { backgroundColor: colors.surface }]}>
              <View style={styles.receiptModeHeader}>
                <AppText style={[styles.sectionTitle, { color: colors.primary, marginBottom: 0 }]}>
                  {receiptMode === 'auto' ? t.autoFromInvoice : t.manualEntry}
                </AppText>
                <TouchableOpacity
                  style={[styles.changeModeButton, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    setReceiptMode(null);
                    setSelectedInvoice(null);
                    setSelectedClientObj(null);
                    setFormData({
                      ...formData,
                      customerName: '',
                      customerEmail: '',
                      customerPhone: '',
                      customerAddress: '',
                      customerId: '',
                      invoiceReference: '',
                    });
                    setItems([{ id: Date.now(), description: '', price: '', quantity: '1' }]);
                  }}
                >
                  <AppText style={styles.changeModeText}>{t.changeMode}</AppText>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Invoice Selection (for Receipt auto mode) */}
          {config.hasReceiptMode && receiptMode === 'auto' && (
            <View style={[styles.section, { backgroundColor: colors.surface }]}>
              <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
                {t.selectInvoice}
              </AppText>
              
              {selectedInvoice ? (
                <View style={styles.selectedInvoiceContainer}>
                  <View style={styles.selectedInvoiceInfo}>
                    <AppText style={[styles.selectedInvoiceLabel, { color: colors.textPrimary }]}>
                      {t.invoiceNumber}: {selectedInvoice.documentNumber}
                    </AppText>
                    <AppText style={[styles.selectedInvoiceDetail, { color: colors.textSecondary }]}>
                      {selectedInvoice.documentData?.client?.name}
                    </AppText>
                  </View>
                  <TouchableOpacity
                    style={[styles.changeInvoiceButton, { backgroundColor: colors.primary }]}
                    onPress={() => openModal('invoiceSelect')}
                  >
                    <AppText style={styles.changeInvoiceText}>{t.changeInvoice}</AppText>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.selectInvoiceButton, { borderColor: colors.border }]}
                  onPress={() => openModal('invoiceSelect')}
                >
                  <MaterialCommunityIcons name="file-document-outline" size={24} color={colors.textSecondary} />
                  <AppText style={[styles.selectInvoiceText, { color: colors.textSecondary }]}>
                    {t.tapToSelectInvoice}
                  </AppText>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Only show form if not receipt OR receipt mode is selected */}
          {(!config.hasReceiptMode || receiptMode !== null) && (
            <>
          {/* Step Indicator - for all document types with 2-step flow */}
          {(isTwoStepFlow || (config.hasReceiptMode && receiptMode !== null)) && (
            <View style={styles.stepIndicator}>
              <View style={[styles.stepDot, currentStep >= 1 && { backgroundColor: colors.primary }]}>
                <AppText style={[styles.stepDotText, currentStep >= 1 && { color: '#fff' }]}>1</AppText>
              </View>
              <View style={[styles.stepConnector, currentStep >= 2 && { backgroundColor: colors.primary }]} />
              <View style={[styles.stepDot, currentStep >= 2 && { backgroundColor: colors.primary }]}>
                <AppText style={[styles.stepDotText, currentStep >= 2 && { color: '#fff' }]}>2</AppText>
              </View>
            </View>
          )}

          {/* Step 1: Customer Details */}
          {(currentStep === 1) && (
          <>
          {/* Customer Details Section - with embedded client search */}
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
              {t.customerDetails}
            </AppText>

            {/* Embedded client selector (search + dropdown) */}
            <ClientSelector
              clients={cachedClients}
              onSelect={(client) => {
                setSelectedClientObj(client);
                setFormData(prev => ({
                  ...prev,
                  customerName: client.name || '',
                  customerPhone: client.phone || '',
                  customerEmail: client.email || '',
                  customerAddress: client.address || '',
                  customerCity: client.city || '',
                  customerId: client.id || '',
                  clientVatNumber: client.vatNumber || '',
                }));
                // Find matching price proposals for this client (Tax Invoice only)
                if (documentType === DOC_TYPE.TAX_INVOICE) {
                  findMatchingProposals(client);
                }
              }}
              selectedClient={selectedClientObj}
              onClear={() => {
                setSelectedClientObj(null);
                setFormData(prev => ({
                  ...prev,
                  customerName: '',
                  customerPhone: '',
                  customerEmail: '',
                  customerAddress: '',
                  customerCity: '',
                  customerId: '',
                  clientVatNumber: '',
                }));
                setMatchingProposals([]);
                setSelectedPriceProposal(null);
              }}
              colors={colors}
              language={language}
            />

            {/* Customer fields - always visible, pre-filled when client selected */}
            {/* Customer Name */}
            <View style={styles.inputGroup}>
              <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                {t.customerName} <AppText style={styles.requiredStar}>*</AppText>
              </AppText>
              <AppInput
                inputStyle={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                value={formData.customerName}
                onChangeText={(text) => setFormData({ ...formData, customerName: text })}
                placeholder={t.customerName}
              />
            </View>

            {/* VAT Number - Required for Tax Invoice, Optional for others */}
            <View style={styles.inputGroup}>
              <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                {t.clientVatNumber} {config.requiresVatNumber 
                  ? <AppText style={styles.requiredStar}>*</AppText>
                  : <AppText style={styles.optionalText}>({t.optional})</AppText>
                }
              </AppText>
              <AppInput
                inputStyle={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                value={formData.clientVatNumber}
                onChangeText={(text) => setFormData({ ...formData, clientVatNumber: text })}
                placeholder={t.clientVatNumber}
                keyboardType="numeric"
              />
            </View>

            {/* Customer Email */}
            <View style={styles.inputGroup}>
              <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                {t.customerEmail} <AppText style={styles.optionalText}>({t.optional})</AppText>
              </AppText>
              <AppInput
                inputStyle={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                value={formData.customerEmail}
                onChangeText={(text) => setFormData({ ...formData, customerEmail: text })}
                placeholder={t.customerEmail}
                keyboardType="email-address"
              />
            </View>

            {/* Customer Address */}
            <View style={styles.inputGroup}>
              <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                {t.customerAddress} <AppText style={styles.optionalText}>({t.optional})</AppText>
              </AppText>
              <AppInput
                inputStyle={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                value={formData.customerAddress}
                onChangeText={(text) => setFormData({ ...formData, customerAddress: text })}
                placeholder={t.customerAddress}
              />
            </View>

            {/* Customer City */}
            <View style={styles.inputGroup}>
              <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                {t.customerCity} <AppText style={styles.optionalText}>({t.optional})</AppText>
              </AppText>
              <AppInput
                inputStyle={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                value={formData.customerCity}
                onChangeText={(text) => setFormData({ ...formData, customerCity: text })}
                placeholder={t.customerCity}
              />
            </View>

            {/* Customer Phone */}
            <View style={styles.inputGroup}>
              <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                {t.customerPhone} <AppText style={styles.optionalText}>({t.optional})</AppText>
              </AppText>
              <AppInput
                inputStyle={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                value={formData.customerPhone}
                onChangeText={(text) => setFormData({ ...formData, customerPhone: text })}
                placeholder={t.customerPhone}
                keyboardType="phone-pad"
              />
            </View>


          </View>

          {/* Matching Price Proposals - Step 1 (Tax Invoice only) */}
          {documentType === DOC_TYPE.TAX_INVOICE && matchingProposals.length > 0 && (
            <View style={[styles.section, { backgroundColor: colors.surface }]}>
              <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
                {t.priceProposals}
              </AppText>
              <AppText style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
                {t.selectProposal}
              </AppText>
              {matchingProposals.map((proposal) => {
                const isSelected = selectedPriceProposal?.id === proposal.id;
                const proposalDate = formatDateLike(proposal.createdAt);
                const proposalTotal = proposal.items
                  ? proposal.items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0)
                  : 0;
                return (
                  <TouchableOpacity
                    key={proposal.id}
                    style={[
                      styles.proposalCard,
                      { backgroundColor: colors.backgroundLight, borderColor: isSelected ? colors.primary : colors.border },
                      isSelected && { borderWidth: 2 },
                    ]}
                    onPress={() => applyPriceProposal(proposal)}
                  >
                    <View style={styles.proposalHeader}>
                      <View style={styles.proposalInfo}>
                        <AppText style={[styles.proposalTitle, { color: colors.textPrimary }]}>
                          {t.priceProposal} #{proposal.documentNumber || ''}
                        </AppText>
                        {proposalDate ? (
                          <AppText style={[styles.proposalMeta, { color: colors.textSecondary }]}>
                            {proposalDate}
                          </AppText>
                        ) : null}
                      </View>
                      {isSelected && (
                        <View style={[styles.selectedBadge, { backgroundColor: colors.primary }]}>
                          <Ionicons name="checkmark" size={14} color="#fff" />
                          <AppText style={styles.selectedBadgeText}>{t.selected}</AppText>
                        </View>
                      )}
                    </View>
                    <AppText style={[styles.proposalMeta, { color: colors.textSecondary }]}>
                      {proposal.items?.length || 0} {t.proposalItems} Â· â‚ª{proposalTotal.toFixed(2)}
                    </AppText>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {documentType === DOC_TYPE.TAX_INVOICE && matchingProposals.length === 0 && selectedClientObj && (
            <View style={[styles.noProposalsContainer, { backgroundColor: colors.surface }]}>
              <Ionicons name="document-text-outline" size={24} color={colors.textSecondary} />
              <AppText style={[styles.noProposalsText, { color: colors.textSecondary }]}>
                {t.noProposals}
              </AppText>
            </View>
          )}

          {/* Step 1 Continue Button */}
          {(
            <TouchableOpacity
              style={styles.continueButtonContainer}
              onPress={goToStep2}
            >
              <LinearGradient
                colors={config.gradient}
                style={styles.continueButton}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <AppText style={styles.continueButtonText}>{t.continueToItems}</AppText>
                <Ionicons name="arrow-forward" size={20} color="white" />
              </LinearGradient>
            </TouchableOpacity>
          )}
          </>
          )}

          {/* Step 2: Items & Submission */}
          {(currentStep === 2) && (
          <>
          {/* Payment Method (Receipt only) */}
          {config.requiresPaymentMethod && (
            <View style={[styles.section, { backgroundColor: colors.surface }]}>
              <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
                {t.paymentDetails}
              </AppText>
              
              <View style={styles.inputGroup}>
                <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                  {t.paymentMethod} <AppText style={styles.requiredStar}>*</AppText>
                </AppText>
                <View style={styles.paymentMethodsContainer}>
                  {paymentMethods.map((method) => (
                    <TouchableOpacity
                      key={method.id}
                      style={[
                        styles.paymentMethodButton,
                        formData.paymentMethod === method.id && styles.paymentMethodButtonActive,
                        { borderColor: formData.paymentMethod === method.id ? colors.primary : colors.border }
                      ]}
                      onPress={() => setFormData({ ...formData, paymentMethod: method.id })}
                    >
                      <AppText style={[
                        styles.paymentMethodText,
                        { color: formData.paymentMethod === method.id ? colors.primary : colors.textSecondary }
                      ]}>
                        {method.label}
                      </AppText>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Payment Info/Reference - shows relevant placeholder based on payment method */}
              <View style={styles.inputGroup}>
                <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                  {t.paymentInfo} <AppText style={styles.optionalText}>({t.optional})</AppText>
                </AppText>
                <AppInput
                  inputStyle={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                  value={formData.paymentInfo}
                  onChangeText={(text) => setFormData({ ...formData, paymentInfo: text })}
                  placeholder={
                    formData.paymentMethod === 'check' ? t.paymentInfoCheckPlaceholder :
                    formData.paymentMethod === 'transfer' ? t.paymentInfoTransferPlaceholder :
                    formData.paymentMethod === 'credit' ? t.paymentInfoCreditPlaceholder :
                    t.paymentInfoPlaceholder
                  }
                />
              </View>
            </View>
          )}

          {/* Items Section */}
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <View style={styles.itemsSectionHeader}>
              <AppText style={[styles.sectionTitle, { color: colors.primary, marginBottom: 0 }]}>
                {t.itemsTitle}
              </AppText>
              {/* Show locked indicator for auto mode */}
              {config.hasReceiptMode && receiptMode === 'auto' && selectedInvoice && (
                <View style={[styles.lockedBadge, { backgroundColor: colors.backgroundLight }]}>
                  <Ionicons name="lock-closed" size={14} color={colors.textSecondary} />
                  <AppText style={[styles.lockedBadgeText, { color: colors.textSecondary }]}>
                    {language === 'en' ? 'From Invoice' : language === 'he' ? '×ž×”×—×©×‘×•× ×™×ª' : 'Ù…Ù† Ø§Ù„ÙØ§ØªÙˆØ±Ø©'}
                  </AppText>
                </View>
              )}
            </View>

            {items.map((item, index) => {
              // Items are read-only in auto mode when invoice is selected
              const isReadOnly = config.hasReceiptMode && receiptMode === 'auto' && selectedInvoice;
              
              return (
                <View key={item.id} style={[
                  styles.itemCard, 
                  { backgroundColor: colors.backgroundLight, borderColor: colors.border },
                  isReadOnly && styles.itemCardReadOnly
                ]}>
                  <View style={styles.itemHeader}>
                    <AppText style={[styles.itemNumber, { color: colors.primary }]}>
                      {t.item} {index + 1}
                    </AppText>
                    {/* Only show delete button if not read-only and more than 1 item */}
                    {!isReadOnly && items.length > 1 && (
                      <TouchableOpacity onPress={() => removeItem(item.id)}>
                        <MaterialCommunityIcons name="delete" size={24} color="#EF4444" />
                      </TouchableOpacity>
                    )}
                  </View>

                  <View style={styles.inputGroup}>
                    <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                      {t.itemDescription} {!isReadOnly && <AppText style={styles.requiredStar}>*</AppText>}
                    </AppText>
                    {/* Use InventoryItemSearch for items when inventory is available */}
                    {!isReadOnly && getInventoryParts().length > 0 ? (
                      <InventoryItemSearch
                        value={item.description}
                        onChangeText={(text) => updateItem(item.id, 'description', text)}
                        onSelectPart={(part) => handleItemPartSelect(item.id, part)}
                        inventoryParts={getInventoryParts()}
                        placeholder={t.itemDescription}
                        colors={colors}
                        editable={!isReadOnly}
                        style={[
                          styles.inputMultiline,
                          { backgroundColor: colors.background, borderColor: colors.border },
                        ]}
                      />
                    ) : (
                    <AppInput
                      inputStyle={[
                        styles.inputMultiline, 
                        { backgroundColor: isReadOnly ? colors.backgroundLight : colors.background, color: colors.textPrimary, borderColor: colors.border },
                        isReadOnly && styles.inputReadOnly
                      ]}
                      value={item.description}
                      onChangeText={(text) => !isReadOnly && updateItem(item.id, 'description', text)}
                      placeholder={t.itemDescription}
                      multiline
                      numberOfLines={2}
                      editable={!isReadOnly}
                    />
                    )}
                  </View>

                  <View style={styles.inputGroup}>
                    <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                      {t.itemPrice} {!isReadOnly && <AppText style={styles.requiredStar}>*</AppText>}
                    </AppText>
                    <AppInput
                      inputStyle={[
                        styles.input, 
                        { backgroundColor: isReadOnly ? colors.backgroundLight : colors.background, color: colors.textPrimary, borderColor: colors.border },
                        isReadOnly && styles.inputReadOnly
                      ]}
                      value={item.price}
                      onChangeText={(text) => !isReadOnly && updateItem(item.id, 'price', text)}
                      placeholder={t.itemPrice}
                      keyboardType="decimal-pad"
                      editable={!isReadOnly}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                      {t.itemQuantity} {!isReadOnly && <AppText style={styles.optionalText}>({t.optional})</AppText>}
                    </AppText>
                    <AppInput
                      inputStyle={[
                        styles.input, 
                        { backgroundColor: isReadOnly ? colors.backgroundLight : colors.background, color: colors.textPrimary, borderColor: colors.border },
                        isReadOnly && styles.inputReadOnly
                      ]}
                      value={item.quantity}
                      onChangeText={(text) => !isReadOnly && updateItem(item.id, 'quantity', text)}
                      placeholder={t.itemQuantity}
                      keyboardType="numeric"
                      editable={!isReadOnly}
                    />
                  </View>
                </View>
              );
            })}

            {/* Only show add item button if manual mode or not receipt */}
            {(!config.hasReceiptMode || receiptMode === 'manual') && (
              <TouchableOpacity
                style={[styles.addItemButton, { backgroundColor: colors.primary }]}
                onPress={addItem}
              >
                <MaterialCommunityIcons name="plus" size={20} color="white" />
                <AppText style={styles.addItemText}>{t.addItem}</AppText>
              </TouchableOpacity>
            )}

            {/* Total Display */}
            <View style={[styles.totalContainer, { borderTopColor: colors.border }]}>
              <AppText style={[styles.totalLabel, { color: colors.textPrimary }]}>{t.total}</AppText>
              <AppText style={[styles.totalValue, { color: colors.primary }]}>
                â‚ª{calculateTotal().toFixed(2)}
              </AppText>
            </View>
          </View>

          {/* Submit Buttons */}
          <View style={styles.buttonContainer}>
            {/* Back button: goes to Step 1 */}
            <TouchableOpacity
              style={[styles.cancelButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={goToStep1}
            >
              <AppText style={[styles.cancelButtonText, { color: colors.textPrimary }]}>
                {t.backToClient}
              </AppText>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.submitButtonContainer}
              onPress={handlePreview}
              disabled={isSubmitting}
            >
              <LinearGradient
                colors={config.gradient}
                style={styles.submitButton}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="eye" size={20} color="white" />
                    <AppText style={styles.submitButtonText}>{t.preview}</AppText>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
          </>
          )}
            </>
          )}
        </ScrollableContainer>

        {/* Unified Modal - Single modal with different content based on type */}
        <Modal
          visible={modalState.visible}
          animationType="slide"
          onRequestClose={closeModal}
          presentationStyle={Platform.OS === 'ios' ? 'fullScreen' : undefined}
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
                                â‚ª{totalAmount.toFixed(2)}
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
                      onError={(syntheticEvent) => {
                        const { nativeEvent } = syntheticEvent;
                        console.warn('WebView error: ', nativeEvent);
                        alert.error('Error', 'Failed to load PDF preview');
                      }}
                    />
                  )}
                </View>
              </>
            )}
          </View>
        </Modal>

        <GlobalHeader />
      </View>
    </KeyboardAvoidingView>
  );
}

// Translation helper function
