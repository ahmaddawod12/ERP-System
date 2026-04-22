// @ts-nocheck
import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getColors } from '../../theme';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAlert } from '../../contexts/AlertContext';
import { useCache } from '../../contexts/CacheContext';
import { GlobalHeader, LoadingOverlay } from '../../components';
import TaxInvoiceJobList from './TaxInvoiceJobList';
import TaxInvoiceFormModal from './TaxInvoiceFormModal';
import { useTaxInvoiceSubmission } from './useTaxInvoiceSubmission';
import { fetchCompanyInventoryParts, fetchCompanyJobs } from '../../utils/read-model';

export default function GenerateTaxInvoice() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { 
    getCompanyId: getCachedCompanyId, 
    companyJobs,
    getUserRole,
    clients: cachedClients,
    documents: cachedDocuments,
    inventory: cachedInventory,
    companyInventory: cachedCompanyInventory,
  } = useCache();
  const colors = getColors(isDarkMode);
  const cachedCompanyFinishedJobs = useMemo(
    () => (companyJobs || []).filter(job => job.status === 'finished'),
    [companyJobs]
  );

  const [finishedJobs, setFinishedJobs] = useState([]);
  const [filteredJobs, setFilteredJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState([]); // Multi-select: array of selected job objects
  const [companyId, setCompanyId] = useState('');
  
  // 2-step flow state
  const [currentStep, setCurrentStep] = useState(1); // 1 = Client, 2 = Items
  const [selectedPriceProposal, setSelectedPriceProposal] = useState(null);
  const [matchingProposals, setMatchingProposals] = useState([]);
  const [companyInventoryParts, setCompanyInventoryParts] = useState([]);
  const [selectedClientObj, setSelectedClientObj] = useState(null);
  
  // Helper functions for alerts — using useAlert() for consistent cross-platform behavior.
  // Note: useAlert() already handles iOS/Android differences internally.
  const showValidationError = (title, message) => {
    alert.error(title, message);
  };

  const showErrorMessage = (title, message) => {
    alert.error(title, message);
  };
  
  // Tax Invoice form data
  const [invoiceData, setInvoiceData] = useState({
    // Customer Details - Necessary
    customerName: '',
    customerVatNumber: '', // Required for ALL customers (Tax Invoice)
    // Customer Details - Optional
    customerEmail: '',
    customerId: '',
    customerAddress: '',
    customerCity: '',
    customerPhone: '',
    // Service Details
    serviceDescription: '',
    // Invoice Date
    invoiceDate: new Date().toISOString().split('T')[0],
  });

  // Parts from the job
  const [jobParts, setJobParts] = useState([]); // [{ name, quantity, price }]
  
  // Custom parts (not in inventory)
  const [customParts, setCustomParts] = useState([]); // [{ name, quantity, price }]

  const t = language === 'en' ? {
    title: 'Generate Tax Invoice',
    back: 'Back',
    searchPlaceholder: 'Search by worker name...',
    noJobs: 'No finished jobs found',
    jobTitle: 'Job Title',
    worker: 'worker',
    customer: 'Customer',
    completedOn: 'Completed On',
    generateButton: 'Generate Tax Invoice',
    loading: 'Loading finished jobs...',
    location: 'Location',
    timeWorked: 'Time Worked',
    parts: 'Parts Used',
    // Tax Invoice Form
    invoiceFormTitle: 'Tax Invoice Details',
    customerDetails: 'Customer Details',
    customerName: 'Full Name / Business Name',
    customerEmail: 'Email Address',
    customerId: 'ID / Company Number',
    customerVatNumber: 'Customer VAT Number',
    customerAddress: 'Address',
    customerCity: 'City',
    customerPhone: 'Phone',
    serviceDetails: 'Service Details',
    serviceDescription: 'Service Description',
    invoiceDate: 'Invoice Date',
    partsAndServices: 'Parts & Services',
    jobParts: 'Parts from Job',
    customParts: 'Custom Items',
    addCustomPart: 'Add Custom Item',
    partName: 'Item Name',
    quantity: 'Quantity',
    price: 'Price per Unit',
    totalPrice: 'Total',
    remove: 'Remove',
    noPartsFromJob: 'No parts used in this job',
    required: 'Required',
    optional: 'Optional',
    cancel: 'Cancel',
    preview: 'Preview Tax Invoice',
    submit: 'Create Tax Invoice',
    previewTitle: 'Tax Invoice Ready',
    closePreview: 'Close Preview',
    customPartPlaceholder: 'e.g., Working Hours, Consultation',
    openPdf: 'Open PDF',
    // 2-step flow
    step1Title: 'Step 1: Client Details',
    step2Title: 'Step 2: Items & Pricing',
    continueToItems: 'Continue to Items',
    backToClient: 'Back to Client',
    step: 'Step',
    of: 'of',
    priceProposals: 'Matching Price Proposals',
    selectProposal: 'Select a price proposal to auto-fill prices',
    noProposals: 'No matching price proposals found',
    proposalDate: 'Date',
    proposalTotal: 'Total',
    proposalItems: 'items',
    selected: 'Selected',
    clearProposal: 'Clear Selection',
    clientFromJob: 'Client from Job',
    clientFromBook: 'Client from Book',
    selectedJobs: 'Selected Jobs',
    selectJobs: 'Select finished jobs for the invoice',
    generateFromSelected: 'Generate from Selected',
    jobsSelected: 'jobs selected',
    deselectAll: 'Deselect All',
    mergedParts: 'Merged Parts from Jobs',
  } : language === 'he' ? {
    title: 'יצירת חשבונית מס',
    back: 'חזרה',
    searchPlaceholder: 'חיפוש לפי שם עובד...',
    noJobs: 'לא נמצאו משימות שהסתיימו',
    jobTitle: 'כותרת המשימה',
    worker: 'עובד',
    customer: 'לקוח',
    completedOn: 'הושלם ב',
    generateButton: 'יצירת חשבונית מס',
    loading: 'טוען משימות שהסתיימו...',
    location: 'מיקום',
    timeWorked: 'זמן עבודה',
    parts: 'חלקים בשימוש',
    // Tax Invoice Form
    invoiceFormTitle: 'פרטי חשבונית מס',
    customerDetails: 'פרטי לקוח',
    customerName: 'שם מלא / שם עסק',
    customerEmail: 'כתובת אימייל',
    customerId: 'ת.ז / ח.פ',
    customerVatNumber: 'מספר עוסק מורשה של הלקוח',
    customerAddress: 'כתובת',
    customerCity: 'עיר',
    customerPhone: 'טלפון',
    serviceDetails: 'פרטי שירות',
    serviceDescription: 'תיאור השירות',
    invoiceDate: 'תאריך חשבונית',
    partsAndServices: 'חלקים ושירותים',
    jobParts: 'חלקים מהמשימה',
    customParts: 'פריטים נוספים',
    addCustomPart: 'הוסף פריט נוסף',
    partName: 'שם הפריט',
    quantity: 'כמות',
    price: 'מחיר ליחידה',
    totalPrice: 'סה"כ',
    remove: 'הסר',
    noPartsFromJob: 'לא נעשה שימוש בחלקים במשימה זו',
    required: 'חובה',
    optional: 'אופציונלי',
    cancel: 'ביטול',
    preview: 'תצוגה מקדימה',
    submit: 'צור חשבונית מס',
    previewTitle: 'תצוגה מקדימה של חשבונית מס',
    closePreview: 'סגור תצוגה',
    customPartPlaceholder: 'לדוגמה: שעות עבודה, ייעוץ',
    // 2-step flow
    step1Title: 'שלב 1: פרטי לקוח',
    step2Title: 'שלב 2: פריטים ותמחור',
    continueToItems: 'המשך לפריטים',
    backToClient: 'חזרה ללקוח',
    step: 'שלב',
    of: 'מתוך',
    priceProposals: 'הצעות מחיר תואמות',
    selectProposal: 'בחר הצעת מחיר למילוי אוטומטי של מחירים',
    noProposals: 'לא נמצאו הצעות מחיר תואמות',
    proposalDate: 'תאריך',
    proposalTotal: 'סה"כ',
    proposalItems: 'פריטים',
    selected: 'נבחר',
    clearProposal: 'נקה בחירה',
    clientFromJob: 'לקוח מהמשימה',
    clientFromBook: 'לקוח מספר הלקוחות',
    selectedJobs: 'משימות נבחרות',
    selectJobs: 'בחר משימות שהסתיימו לחשבונית',
    generateFromSelected: 'צור מהנבחרות',
    jobsSelected: 'משימות נבחרו',
    deselectAll: 'בטל הכל',
    mergedParts: 'חלקים ממוזגים מהמשימות',
  } : {
    title: 'إنشاء فاتورة ضريبية',
    back: 'رجوع',
    searchPlaceholder: 'البحث بواسطة اسم العامل...',
    noJobs: 'لم يتم العثور على مهام منتهية',
    jobTitle: 'عنوان المهمة',
    worker: 'عامل',
    customer: 'عميل',
    completedOn: 'اكتمل في',
    generateButton: 'إنشاء فاتورة ضريبية',
    loading: 'تحميل المهام المنتهية...',
    location: 'موقع',
    timeWorked: 'وقت العمل',
    parts: 'القطع المستخدمة',
    // Tax Invoice Form
    invoiceFormTitle: 'تفاصيل الفاتورة الضريبية',
    customerDetails: 'تفاصيل العميل',
    customerName: 'الاسم الكامل / اسم الشركة',
    customerEmail: 'عنوان البريد الإلكتروني',
    customerId: 'رقم الهوية / رقم الشركة',
    customerVatNumber: 'رقم ضريبة القيمة المضافة للعميل',
    customerAddress: 'العنوان',
    customerCity: 'المدينة',
    customerPhone: 'الهاتف',
    serviceDetails: 'تفاصيل الخدمة',
    serviceDescription: 'وصف الخدمة',
    invoiceDate: 'تاريخ الفاتورة',
    partsAndServices: 'القطع والخدمات',
    jobParts: 'القطع من المهمة',
    customParts: 'عناصر إضافية',
    addCustomPart: 'إضافة عنصر مخصص',
    partName: 'اسم العنصر',
    quantity: 'الكمية',
    price: 'السعر لكل وحدة',
    totalPrice: 'المجموع',
    remove: 'إزالة',
    noPartsFromJob: 'لم يتم استخدام قطع في هذه المهمة',
    required: 'مطلوب',
    optional: 'اختياري',
    cancel: 'إلغاء',
    preview: 'معاينة الفاتورة الضريبية',
    submit: 'إنشاء فاتورة ضريبية',
    previewTitle: 'معاينة الفاتورة الضريبية',
    closePreview: 'إغلاق المعاينة',
    customPartPlaceholder: 'مثال: ساعات العمل، الاستشارة',
    // 2-step flow
    step1Title: 'الخطوة 1: تفاصيل العميل',
    step2Title: 'الخطوة 2: العناصر والتسعير',
    continueToItems: 'المتابعة إلى العناصر',
    backToClient: 'العودة إلى العميل',
    step: 'خطوة',
    of: 'من',
    priceProposals: 'عروض الأسعار المتطابقة',
    selectProposal: 'اختر عرض سعر لملء الأسعار تلقائيًا',
    noProposals: 'لم يتم العثور على عروض أسعار متطابقة',
    proposalDate: 'التاريخ',
    proposalTotal: 'المجموع',
    proposalItems: 'عناصر',
    selected: 'محدد',
    clearProposal: 'مسح الاختيار',
    clientFromJob: 'عميل من المهمة',
    clientFromBook: 'عميل من دفتر العملاء',
    selectedJobs: 'المهام المختارة',
    selectJobs: 'اختر المهام المنتهية للفاتورة',
    generateFromSelected: 'إنشاء من المختارة',
    jobsSelected: 'مهام مختارة',
    deselectAll: 'إلغاء الكل',
    mergedParts: 'القطع المدمجة من المهام',
  };

  // Load company name from cache
  useEffect(() => {
    const cachedName = getCachedCompanyId();
    if (cachedName) {
      setCompanyId(cachedName);
    }
  }, [getCachedCompanyId]);

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

  // Get the inventory parts based on role
  const getInventoryParts = () => {
    const role = getUserRole();
    if (role === 'manager') return companyInventoryParts;
    if (role === 'user' || role === 'worker') return cachedInventory || [];
    return []; // basic/dev: no inventory
  };

  // Fetch finished jobs from Firestore
  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const companyId = getCachedCompanyId();
        if (!companyId) {
          console.log('No cached company name found');
          setLoading(false);
          return;
        }

        setLoading(true);
        
        // Use cached company finished jobs first
        if (cachedCompanyFinishedJobs && cachedCompanyFinishedJobs.length > 0) {
          // Filter out jobs that are already converted to documents (isCert = true)
          const jobsData = cachedCompanyFinishedJobs
            .filter(job => !job.isCert)
            .map(job => ({
              ...job,
              wname: job.wname || 'Unknown',
            }));

          // Sort by finishedAt (newest first)
          jobsData.sort((a, b) => {
            const getTime = (dateInput) => {
              if (!dateInput) return 0;
              if (dateInput.toDate && typeof dateInput.toDate === 'function') {
                return dateInput.toDate().getTime();
              }
              return new Date(dateInput).getTime();
            };
            return getTime(b.finishedAt) - getTime(a.finishedAt);
          });

          setFinishedJobs(jobsData);
          setFilteredJobs(jobsData);
          setLoading(false);
          return;
        }

        const jobsData = await fetchCompanyJobs(companyId)
          .then((rows) => (rows || [])
            .filter((job) => job.status === 'finished' && !job.isCert)
            .map((job) => ({
              ...job,
              wname: job.wname || 'Unknown',
            })));

        // Sort by finishedAt (newest first) - Already ordered by query but sort again for safety
        jobsData.sort((a, b) => {
          const dateA = a.finishedAt ? new Date(a.finishedAt).getTime() : 0;
          const dateB = b.finishedAt ? new Date(b.finishedAt).getTime() : 0;
          return dateB - dateA;
        });

        setFinishedJobs(jobsData);
        setFilteredJobs(jobsData);
        setLoading(false);
      } catch (error) {
        console.error('Error in fetchJobs:', error);
        setLoading(false);
        showErrorMessage('Error', 'Failed to load finished jobs');
      }
    };

    fetchJobs();
  }, [cachedCompanyFinishedJobs]);

  // Filter jobs by worker name
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredJobs(finishedJobs);
    } else {
      const filtered = finishedJobs.filter(job =>
        job.wname?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredJobs(filtered);
    }
  }, [searchQuery, finishedJobs]);

  // Toggle job selection (multi-select)
  const toggleJobSelection = (job) => {
    setSelectedJobs(prev => {
      const isAlreadySelected = prev.some(j => j.id === job.id);
      if (isAlreadySelected) {
        return prev.filter(j => j.id !== job.id);
      } else {
        return [...prev, job];
      }
    });
  };

  // Merge parts from multiple jobs: same id => add quantities, different id => separate entries
  const mergePartsFromJobs = (jobs) => {
    const partsMap = new Map(); // key: partId or name, value: { id, name, quantity }
    
    jobs.forEach(job => {
      if (job.partsUsed && Array.isArray(job.partsUsed) && job.partsUsed.length > 0) {
        job.partsUsed.forEach(part => {
          const partId = part.id ? String(part.id) : null;
          const partName = part.name || part;
          const partQuantity = part.quantity || 1;
          
          // Use partId as key if available, otherwise use name
          const key = partId || partName;
          
          if (partsMap.has(key)) {
            const existing = partsMap.get(key);
            existing.quantity += partQuantity;
          } else {
            partsMap.set(key, {
              id: partId,
              name: partName,
              quantity: partQuantity,
              price: '', // Will be filled from price proposal or manually
            });
          }
        });
      }
    });
    
    return Array.from(partsMap.values());
  };

  // Open receipt form with multiple selected jobs
  const openReceiptForm = (jobs) => {
    if (!jobs || jobs.length === 0) return;
    
    // Use the first job as primary for client info
    const primaryJob = jobs[0];
    
    setSelectedJobs(jobs);
    setCurrentStep(1);
    setSelectedPriceProposal(null);
    
    // Safely parse the date from primaryJob.finishedAt
    let invoiceDateStr = new Date().toISOString().split('T')[0];
    try {
      if (primaryJob.finishedAt) {
        let dateValue;
        if (primaryJob.finishedAt.seconds && typeof primaryJob.finishedAt.seconds === 'number') {
          dateValue = new Date(primaryJob.finishedAt.seconds * 1000);
        } else if (primaryJob.finishedAt instanceof Date) {
          dateValue = primaryJob.finishedAt;
        } else if (typeof primaryJob.finishedAt === 'string') {
          dateValue = new Date(primaryJob.finishedAt);
        } else if (typeof primaryJob.finishedAt === 'number') {
          dateValue = new Date(primaryJob.finishedAt);
        }
        if (dateValue && !isNaN(dateValue.getTime())) {
          invoiceDateStr = dateValue.toISOString().split('T')[0];
        }
      }
    } catch (error) {
      console.warn('Error parsing finishedAt date:', error);
    }
    
    // Look up client from client book using primary job's clientId
    let clientFromBook = null;
    if (primaryJob.clientId && cachedClients && cachedClients.length > 0) {
      clientFromBook = cachedClients.find(c => c.id === primaryJob.clientId);
    }
    // Fallback: match by cname
    if (!clientFromBook && primaryJob.cname && cachedClients && cachedClients.length > 0) {
      clientFromBook = cachedClients.find(c => 
        c.name && c.name.toLowerCase() === primaryJob.cname.toLowerCase()
      );
    }

    setSelectedClientObj(clientFromBook || null);
    
    // Build description from all jobs
    const descriptions = jobs
      .map(j => j.description || j.title || '')
      .filter(d => d.trim())
      .join('; ');
    
    // Pre-fill customer data: prefer client book data, fallback to primary job data
    setInvoiceData({
      customerName: clientFromBook?.name || primaryJob.cname || '',
      customerVatNumber: clientFromBook?.vatNumber || '',
      customerPhone: clientFromBook?.phone || primaryJob.cphone || '',
      customerAddress: clientFromBook?.address || primaryJob.location || '',
      customerCity: clientFromBook?.city || '',
      customerEmail: clientFromBook?.email || '',
      customerId: clientFromBook?.id || primaryJob.clientId || '',
      serviceDescription: descriptions,
      invoiceDate: invoiceDateStr,
    });

    // Find matching price proposals for this client
    findMatchingProposals(primaryJob.clientId, clientFromBook, primaryJob.cname);

    // Merge parts from ALL selected jobs
    const mergedParts = mergePartsFromJobs(jobs);
    setJobParts(mergedParts);

    // Reset custom parts
    setCustomParts([]);
    
    setModalVisible(true);
  };

  // Find price proposals matching the client
  const findMatchingProposals = (clientId, clientObj, clientName) => {
    if (!cachedDocuments || cachedDocuments.length === 0) {
      setMatchingProposals([]);
      return;
    }

    // Filter documents to only price proposals (type 10) that are NOT already used
    const proposals = cachedDocuments.filter(cert => cert.type === 10 && !cert.isUsed);
    
    if (proposals.length === 0) {
      setMatchingProposals([]);
      return;
    }

    // Match by clientId first, then fallback to clientName
    let matched = [];
    if (clientId) {
      matched = proposals.filter(p => p.clientId === clientId);
    }
    // Fallback: match by clientName
    if (matched.length === 0 && (clientObj?.name || clientName)) {
      const nameToMatch = (clientObj?.name || clientName || '').toLowerCase();
      matched = proposals.filter(p => 
        p.cname && p.cname.toLowerCase() === nameToMatch
      );
    }

    // Sort by creation date (newest first)
    matched.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    setMatchingProposals(matched);
  };

  // Apply prices from selected price proposal to job parts
  const applyPriceProposal = (proposal) => {
    if (selectedPriceProposal?.id === proposal.id) {
      // Deselect: clear prices
      setSelectedPriceProposal(null);
      setJobParts(prev => prev.map(part => ({ ...part, price: '' })));
      return;
    }

    setSelectedPriceProposal(proposal);

    if (!proposal.items || proposal.items.length === 0) return;

    // Match proposal items to job parts by partId or name
    setJobParts(prev => prev.map(part => {
      // Try match by partId first (convert to strings to handle type mismatches)
      let match = null;
      if (part.id) {
        const partIdStr = String(part.id);
        match = proposal.items.find(item => 
          item.partId && String(item.partId) === partIdStr
        );
      }
      
      // Fallback: match by EXACT description/name only (case-insensitive)
      if (!match) {
        const partNameLower = (part.name || '').toLowerCase().trim();
        match = proposal.items.find(item => {
          const itemDescLower = (item.description || '').toLowerCase().trim();
          return itemDescLower === partNameLower;
        });
      }

      return {
        ...part,
        price: match ? String(match.price) : part.price,
      };
    }));

    // Also add any proposal items that don't match job parts as custom parts
    const unmatchedItems = proposal.items.filter(item => {
      const descLower = (item.description || '').toLowerCase().trim();
      const itemIdStr = item.partId ? String(item.partId) : null;
      
      return !jobParts.some(part => {
        const partNameLower = (part.name || '').toLowerCase().trim();
        const partIdStr = part.id ? String(part.id) : null;
        
        // Match by ID (strict) OR exact name (strict)
        const idMatch = itemIdStr && partIdStr && itemIdStr === partIdStr;
        const nameMatch = partNameLower === descLower;
        
        return idMatch || nameMatch;
      });
    });

    if (unmatchedItems.length > 0) {
      const newCustomParts = unmatchedItems.map(item => ({
        name: item.description,
        quantity: String(item.quantity || 1),
        price: String(item.price || ''),
      }));
      setCustomParts(newCustomParts);
    }
  };

  // Navigate between steps
  const goToStep2 = () => {
    // Validate step 1 (client details)
    if (!invoiceData.customerName.trim()) {
      showValidationError('Error', language === 'he' ? 'שם לקוח נדרש' : language === 'ar' ? 'اسم العميل مطلوب' : 'Customer name is required');
      return;
    }
    if (!invoiceData.customerVatNumber || !invoiceData.customerVatNumber.trim()) {
      showValidationError('Error', language === 'he' ? 'מספר עוסק מורשה נדרש' : language === 'ar' ? 'رقم ضريبة القيمة المضافة مطلوب' : 'Customer VAT number is required');
      return;
    }
    setCurrentStep(2);
  };

  const goToStep1 = () => {
    setCurrentStep(1);
  };

  const closeReceiptForm = () => {
    setModalVisible(false);
    setSelectedJobs([]);
    setCurrentStep(1);
    setSelectedPriceProposal(null);
    setMatchingProposals([]);
    setSelectedClientObj(null);
    // Reset form
    setInvoiceData({
      customerName: '',
      customerVatNumber: '',
      customerEmail: '',
      customerId: '',
      customerAddress: '',
      customerCity: '',
      customerPhone: '',
      serviceDescription: '',
      invoiceDate: new Date().toISOString().split('T')[0],
    });
    setJobParts([]);
    setCustomParts([]);
  };

  const validateInvoiceForm = () => {
    // Check required fields
    if (!invoiceData.customerName.trim()) {
      showValidationError('Error', 'Customer name is required');
      return false;
    }
    // VAT Number is required for ALL customers in Tax Invoice
    if (!invoiceData.customerVatNumber.trim()) {
      showValidationError('Error', 'Customer VAT number is required for tax invoice');
      return false;
    }
    if (!invoiceData.serviceDescription.trim()) {
      showValidationError('Error', 'Service description is required');
      return false;
    }
    if (!invoiceData.invoiceDate.trim()) {
      showValidationError('Error', 'Invoice date is required');
      return false;
    }

    // Check that at least one part/service has a price
    const hasValidJobParts = jobParts.some(part => part.price && !isNaN(parseFloat(part.price)) && parseFloat(part.price) > 0);
    const hasValidCustomParts = customParts.some(part => part.name.trim() && part.price && !isNaN(parseFloat(part.price)) && parseFloat(part.price) > 0);
    
    if (!hasValidJobParts && !hasValidCustomParts) {
      showValidationError('Error', 'At least one item must have a valid price');
      return false;
    }

    // Validate all job parts with prices
    for (const part of jobParts) {
      if (part.price && (isNaN(parseFloat(part.price)) || parseFloat(part.price) < 0)) {
        showValidationError('Error', `Invalid price for ${part.name}`);
        return false;
      }
    }

    // Validate all custom parts
    for (const part of customParts) {
      if (!part.name.trim()) {
        showValidationError('Error', 'Custom part name cannot be empty');
        return false;
      }
      if (!part.quantity || isNaN(parseInt(part.quantity)) || parseInt(part.quantity) <= 0) {
        showValidationError('Error', `Invalid quantity for ${part.name}`);
        return false;
      }
      if (!part.price || isNaN(parseFloat(part.price)) || parseFloat(part.price) <= 0) {
        showValidationError('Error', `Invalid price for ${part.name}`);
        return false;
      }
    }

    return true;
  };

  const addCustomPart = () => {
    setCustomParts([...customParts, { name: '', quantity: '1', price: '' }]);
  };

  const removeCustomPart = (index) => {
    const updated = customParts.filter((_, i) => i !== index);
    setCustomParts(updated);
  };

  const updateJobPartPrice = (index, price) => {
    const updated = [...jobParts];
    updated[index] = { ...updated[index], price };
    setJobParts(updated);
  };

  const updateCustomPart = (index, field, value) => {
    const updated = [...customParts];
    updated[index] = { ...updated[index], [field]: value };
    setCustomParts(updated);

    // Auto-add new empty row when the last item gets a name filled in
    if (field === 'name' && value.trim() && index === updated.length - 1) {
      setCustomParts(prev => [...prev, { name: '', quantity: '1', price: '' }]);
    }
  };

  // Handle selecting a part from inventory search for custom parts
  const handleCustomPartSelect = (index, part) => {
    const updated = [...customParts];
    updated[index] = { ...updated[index], name: part.name, partId: part.id };
    setCustomParts(updated);

    // Auto-add new empty row if this is the last item
    if (index === updated.length - 1) {
      setCustomParts(prev => [...prev, { name: '', quantity: '1', price: '' }]);
    }
  };

  // Submission / PDF hook
  const {
    previewLoading,
    previewURL,
    pdfModalVisible,
    setPdfModalVisible,
    pdfViewerVisible,
    setPdfViewerVisible,
    handlePreviewInvoice,
    handleSubmitInvoice,
    downloadAndSharePDF,
  } = useTaxInvoiceSubmission({
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
  });

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate?.() || new Date(timestamp);
    return date.toLocaleDateString();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      <TaxInvoiceJobList
        filteredJobs={filteredJobs}
        selectedJobs={selectedJobs}
        setSelectedJobs={setSelectedJobs}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        toggleJobSelection={toggleJobSelection}
        formatDate={formatDate}
        handleOpenModal={openReceiptForm}
        colors={colors}
        t={t}
        insets={insets}
        loading={loading}
      />

      <TaxInvoiceFormModal
        modalVisible={modalVisible}
        closeReceiptForm={closeReceiptForm}
        currentStep={currentStep}
        goToStep1={goToStep1}
        goToStep2={goToStep2}
        invoiceData={invoiceData}
        setInvoiceData={setInvoiceData}
        selectedClientObj={selectedClientObj}
        matchingProposals={matchingProposals}
        selectedPriceProposal={selectedPriceProposal}
        applyPriceProposal={applyPriceProposal}
        jobParts={jobParts}
        updateJobPartPrice={updateJobPartPrice}
        customParts={customParts}
        updateCustomPart={updateCustomPart}
        handleCustomPartSelect={handleCustomPartSelect}
        addCustomPart={addCustomPart}
        removeCustomPart={removeCustomPart}
        selectedJobs={selectedJobs}
        handlePreviewInvoice={handlePreviewInvoice}
        handleSubmitInvoice={handleSubmitInvoice}
        downloadAndSharePDF={downloadAndSharePDF}
        previewLoading={previewLoading}
        previewURL={previewURL}
        pdfModalVisible={pdfModalVisible}
        setPdfModalVisible={setPdfModalVisible}
        pdfViewerVisible={pdfViewerVisible}
        setPdfViewerVisible={setPdfViewerVisible}
        colors={colors}
        isDarkMode={isDarkMode}
        t={t}
        insets={insets}
        language={language}
        getInventoryParts={getInventoryParts}
        alert={alert}
      />

      <GlobalHeader />
      
      <LoadingOverlay 
        visible={previewLoading && !pdfModalVisible} 
        type="generate" 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

