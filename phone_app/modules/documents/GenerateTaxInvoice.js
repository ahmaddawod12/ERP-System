import React, { useState, useEffect } from 'react';
import { View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Alert as RNAlert,
 } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { WebView } from 'react-native-webview';
import { db, functions, middleEastFunctions, collection, doc, getDoc, getDocs, query, where, orderBy, httpsCallable } from '../../firebase';
import { getColors, spacing, borderRadius, typography, shadows } from '../../theme';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAlert } from '../../contexts/AlertContext';
import { useCache } from '../../contexts/CacheContext';
import { useDocumentTask } from '../../hooks';
import { AppText, GlobalHeader, LoadingOverlay, ScrollableContainer, InventoryItemSearch } from '../../components';

export default function GenerateReceipt() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { 
    getCompanyId: getCachedCompanyId, 
    companyFinishedJobs: cachedCompanyFinishedJobs, 
    getUserRole,
    clients: cachedClients,
    documents: cachedDocuments,
    inventory: cachedInventory,
  } = useCache();
  const colors = getColors(isDarkMode);

  const [finishedJobs, setFinishedJobs] = useState([]);
  const [filteredJobs, setFilteredJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState([]); // Multi-select: array of selected job objects
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewURL, setPreviewURL] = useState(null); // Signed URL from Cloud Function
  const [pdfModalVisible, setPdfModalVisible] = useState(false);
  const [pdfViewerVisible, setPdfViewerVisible] = useState(false);
  const [companyId, setCompanyId] = useState('');
  const [pendingTaxInvoice, setPendingTaxInvoice] = useState(null); // Store pending invoice info while waiting for PDF
  
  // 2-step flow state
  const [currentStep, setCurrentStep] = useState(1); // 1 = Client, 2 = Items
  const [selectedPriceProposal, setSelectedPriceProposal] = useState(null);
  const [matchingProposals, setMatchingProposals] = useState([]);
  const [companyInventoryParts, setCompanyInventoryParts] = useState([]);
  const [selectedClientObj, setSelectedClientObj] = useState(null);
  
  // Helper functions for iOS-safe alerts
  const showValidationError = (title, message) => {
    if (Platform.OS === 'ios') {
      RNAlert.alert(title, message);
    } else {
      alert.error(title, message);
    }
  };

  const showSuccessMessage = (title, message, buttons) => {
    if (Platform.OS === 'ios') {
      RNAlert.alert(title, message, buttons?.map(btn => ({
        text: btn.text,
        style: btn.style === 'destructive' ? 'destructive' : btn.style === 'cancel' ? 'cancel' : 'default',
        onPress: btn.onPress
      })));
    } else {
      alert.success(title, message, buttons);
    }
  };

  const showErrorMessage = (title, message) => {
    if (Platform.OS === 'ios') {
      RNAlert.alert(title, message);
    } else {
      alert.error(title, message);
    }
  };

  const showWarningMessage = (title, message, buttons) => {
    if (Platform.OS === 'ios') {
      RNAlert.alert(title, message, buttons?.map(btn => ({
        text: btn.text,
        style: btn.style === 'destructive' ? 'destructive' : btn.style === 'cancel' ? 'cancel' : 'default',
        onPress: btn.onPress
      })));
    } else {
      alert.warning(title, message, buttons);
    }
  };

  const showInfoMessage = (title, message, buttons) => {
    if (Platform.OS === 'ios') {
      RNAlert.alert(title, message, buttons?.map(btn => ({
        text: btn.text,
        style: btn.style === 'destructive' ? 'destructive' : btn.style === 'cancel' ? 'cancel' : 'default',
        onPress: btn.onPress
      })));
    } else {
      alert.info(title, message, buttons);
    }
  };
  
  // Document task hook for listening to async PDF generation via Pub/Sub
  const {
    listenToTask,
    publishPreview,
    taskStatus: pdfTaskStatus,
    downloadURL: pdfDownloadURL,
    isCompleted: pdfTaskCompleted,
    isFailed: pdfTaskFailed,
    error: pdfTaskError,
    reset: resetPdfTask,
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
        const { documentId, invoiceNumber, confirmationNumber } = pendingTaxInvoice;
        
        const successMessage = `Tax Invoice created successfully!\n\nDocument ID: ${documentId}\nInvoice #: TAX-${invoiceNumber}\n\n✅ Tax Authority Approved\nConfirmation: ${confirmationNumber}\n\n✅ PDF Generated Successfully`;
        
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
        const invRef = doc(db, 'companies', cn, 'data', 'inventory');
        const invDoc = await getDoc(invRef);
        if (invDoc.exists()) {
          const data = invDoc.data();
          const parts = Array.isArray(data.parts) ? data.parts : [];
          setCompanyInventoryParts(parts);
        }
      } catch (error) {
        console.warn('Failed to fetch company inventory:', error);
      }
    };
    fetchCompanyInventory();
  }, [getUserRole, getCachedCompanyId]);

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
              workerName: job.workerName || job.assignedTo || job.completedBy || job.assignedBy || 'Unknown',
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

        // Fallback to Firebase query - use getDocs (single read) not onSnapshot
        // Cache only stores last 90 days, so for older jobs we use normal read
        const finishedJobsRef = collection(db, 'companies', companyId, 'finishedJobs');
        const q = query(finishedJobsRef, 
          where('isCert', '!=', true),
          orderBy('isCert', 'desc'),
          orderBy('finishedAt', 'desc')
        );
        const snapshot = await getDocs(q);
        const jobsData = [];
        
        for (const docSnap of snapshot.docs) {
          const jobData = { id: docSnap.id, ...docSnap.data() };
          
          // Fetch worker/user name
          // Check assignedTo first (for jobs assigned to workers)
          // Then check completedBy (for manager's/user's own jobs)
          // Finally check assignedBy as fallback
          const userToFetch = jobData.assignedTo || jobData.completedBy || jobData.assignedBy || jobData.workerId;
          
          if (userToFetch) {
            try {
              const userProfileRef = doc(db, 'users', userToFetch, 'data', 'profile');
              const userProfileSnap = await getDoc(userProfileRef);
              if (userProfileSnap.exists()) {
                jobData.workerName = userProfileSnap.data().name || userToFetch;
              } else {
                jobData.workerName = userToFetch;
              }
            } catch (error) {
              jobData.workerName = userToFetch;
            }
          }
          
          jobsData.push(jobData);
        }

        // Sort by finishedAt (newest first) - Already ordered by query but sort again for safety
        jobsData.sort((a, b) => {
          const dateA = a.finishedAt?.toDate?.() || new Date(0);
          const dateB = b.finishedAt?.toDate?.() || new Date(0);
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
        job.workerName?.toLowerCase().includes(searchQuery.toLowerCase())
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
    // Fallback: match by clientName
    if (!clientFromBook && primaryJob.clientName && cachedClients && cachedClients.length > 0) {
      clientFromBook = cachedClients.find(c => 
        c.name && c.name.toLowerCase() === primaryJob.clientName.toLowerCase()
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
      customerName: clientFromBook?.name || primaryJob.clientName || '',
      customerVatNumber: clientFromBook?.vatNumber || '',
      customerPhone: clientFromBook?.phone || primaryJob.clientPhone || '',
      customerAddress: clientFromBook?.address || primaryJob.location || '',
      customerCity: clientFromBook?.city || '',
      customerEmail: clientFromBook?.email || '',
      customerId: clientFromBook?.id || primaryJob.clientId || '',
      serviceDescription: descriptions,
      invoiceDate: invoiceDateStr,
    });

    // Find matching price proposals for this client
    findMatchingProposals(primaryJob.clientId, clientFromBook, primaryJob.clientName);

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
        p.clientName && p.clientName.toLowerCase() === nameToMatch
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
      // Build items array
      const items = [];
      
      // Add job parts with prices
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

      // Add custom parts
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

  const handleSubmitInvoice = async () => {
    if (!validateInvoiceForm()) return;

    // Business info is fetched by Cloud Functions directly from Firestore

    setPreviewLoading(true);

    try {
      // Build items array for new Cloud Function
      const items = [];

      // Add job parts with prices
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

      // Add custom parts
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
          worker: job.workerName || 'N/A',
        })) : undefined,
        // Also send legacy single jobData for backward compatibility
        jobData: selectedJobs.length > 0 ? {
          jobId: selectedJobs[0].id,
          jobTitle: selectedJobs[0].title,
          worker: selectedJobs[0].workerName || 'N/A',
        } : undefined,
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
      console.log('📄 Confirmation Number:', approvalResult.data.confirmation_number);
      console.log('📄 PDF Task Published:', approvalResult.data.pdfTaskPublished);
      console.log('📄 PDF Task ID:', approvalResult.data.pdfTaskId);

      // Check if PDF task was published successfully
      if (approvalResult.data.pdfTaskPublished && approvalResult.data.pdfTaskId) {
        // Store pending invoice info for when PDF completes
        setPendingTaxInvoice({
          documentId: approvalResult.data.documentId,
          invoiceNumber: approvalResult.data.invoiceNumber || 'N/A',
          confirmationNumber: approvalResult.data.confirmation_number,
        });
        
        // Start listening to the PDF generation task via Pub/Sub
        console.log('📡 Starting to listen for PDF task:', approvalResult.data.pdfTaskId);
        listenToTask(approvalResult.data.pdfTaskId);
        
        // Keep loading indicator while waiting for PDF
        // The useDocumentTask hook callbacks will handle completion/error
        showInfoMessage(
          'Tax Authority Approved!',
          `Invoice approved with confirmation: ${approvalResult.data.confirmation_number}\n\nGenerating PDF... Please wait.`,
          [{ text: 'OK', style: 'default', onPress: () => {} }]
        );
      } else {
        // PDF task publishing failed but document was saved and approved
        setPreviewLoading(false);
        
        const partialSuccessMessage = `Tax Invoice approved but PDF generation task could not be started.\n\nDocument ID: ${approvalResult.data.documentId}\n\n✅ Tax Authority Approved\nConfirmation: ${approvalResult.data.confirmation_number}\n\n⚠️ PDF not scheduled\n\nYou can regenerate the PDF from Document History.`;
        
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

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate?.() || new Date(timestamp);
    return date.toLocaleDateString();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      {/* Search Bar */}
      <View style={[styles.searchContainer, { backgroundColor: colors.surface }]}>
        <Ionicons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: colors.textPrimary, backgroundColor: colors.surface, borderColor: colors.border }]}
          placeholder={t.searchPlaceholder}
          placeholderTextColor={colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Jobs List */}
      <ScrollableContainer 
        style={[styles.scrollView, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.scrollContent, { paddingTop: 100, paddingBottom: insets.bottom + 80 }]}
      >
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <AppText style={[styles.loadingText, { color: colors.textSecondary }]}>{t.loading}</AppText>
          </View>
        ) : filteredJobs.length === 0 ? (
          <View style={styles.centerContainer}>
            <MaterialCommunityIcons name="file-document-outline" size={64} color={colors.textSecondary} />
            <AppText style={[styles.noJobsText, { color: colors.textSecondary }]}>{t.noJobs}</AppText>
          </View>
        ) : (
          filteredJobs.map((job) => {
            const isSelected = selectedJobs.some(j => j.id === job.id);
            return (
            <TouchableOpacity 
              key={job.id} 
              activeOpacity={0.7}
              onPress={() => toggleJobSelection(job)}
              style={[
                styles.jobCard, 
                { backgroundColor: colors.surface },
                isSelected && { borderWidth: 2, borderColor: colors.primary },
              ]}
            >
              {/* Job Header */}
              <View style={styles.jobHeader}>
                <View style={styles.jobHeaderLeft}>
                  {/* Checkbox */}
                  <Ionicons 
                    name={isSelected ? "checkbox" : "square-outline"} 
                    size={24} 
                    color={isSelected ? colors.primary : colors.textSecondary} 
                  />
                  <MaterialCommunityIcons name="briefcase-check" size={24} color={colors.primary} />
                  <AppText style={[styles.jobTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                    {job.title || 'Untitled Job'}
                  </AppText>
                </View>
              </View>

              {/* Job Details */}
              <View style={styles.jobDetails}>
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="account" size={18} color={colors.textSecondary} />
                  <AppText style={[styles.detailLabel, { color: colors.textSecondary }]}>{t.worker}:</AppText>
                  <AppText style={[styles.detailValue, { color: colors.textPrimary }]}>{job.workerName || 'N/A'}</AppText>
                </View>

                {job.clientName && (
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="account-tie" size={18} color={colors.textSecondary} />
                    <AppText style={[styles.detailLabel, { color: colors.textSecondary }]}>{t.customer}:</AppText>
                    <AppText style={[styles.detailValue, { color: colors.textPrimary }]}>{job.clientName}</AppText>
                  </View>
                )}

                {job.clientPhone && (
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="phone" size={18} color={colors.textSecondary} />
                    <AppText style={[styles.detailLabel, { color: colors.textSecondary }]}>{t.phone || 'Phone'}:</AppText>
                    <AppText style={[styles.detailValue, { color: colors.textPrimary }]}>{job.clientPhone}</AppText>
                  </View>
                )}

                {job.location && (
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="map-marker" size={18} color={colors.textSecondary} />
                    <AppText style={[styles.detailLabel, { color: colors.textSecondary }]}>{t.location}:</AppText>
                    <AppText style={[styles.detailValue, { color: colors.textPrimary }]} numberOfLines={1}>
                      {job.location}
                    </AppText>
                  </View>
                )}

                {job.timeWorked && (
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="clock-outline" size={18} color={colors.textSecondary} />
                    <AppText style={[styles.detailLabel, { color: colors.textSecondary }]}>{t.timeWorked}:</AppText>
                    <AppText style={[styles.detailValue, { color: colors.textPrimary }]}>{job.timeWorked}</AppText>
                  </View>
                )}

                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="calendar-check" size={18} color={colors.textSecondary} />
                  <AppText style={[styles.detailLabel, { color: colors.textSecondary }]}>{t.completedOn}:</AppText>
                  <AppText style={[styles.detailValue, { color: colors.textPrimary }]}>
                    {formatDate(job.finishedAt)}
                  </AppText>
                </View>

                {job.partsUsed && job.partsUsed.length > 0 && (
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="package-variant" size={18} color={colors.textSecondary} />
                    <AppText style={[styles.detailLabel, { color: colors.textSecondary }]}>{t.parts}:</AppText>
                    <AppText style={[styles.detailValue, { color: colors.textPrimary }]}>
                      {job.partsUsed.length} items
                    </AppText>
                  </View>
                )}
              </View>
            </TouchableOpacity>
            );
          })
        )}
      </ScrollableContainer>

      {/* Floating bottom bar: selected count + Generate button */}
      {selectedJobs.length > 0 && (
        <View style={[styles.selectionBar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + 10 }]}>
          <View style={styles.selectionBarContent}>
            <View style={styles.selectionInfo}>
              <AppText style={[styles.selectionCountText, { color: colors.primary }]}>
                {selectedJobs.length} {t.jobsSelected}
              </AppText>
              <TouchableOpacity onPress={() => setSelectedJobs([])}>
                <AppText style={[styles.deselectText, { color: colors.error }]}>{t.deselectAll}</AppText>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={() => openReceiptForm(selectedJobs)}
            >
              <LinearGradient
                colors={['#00ACC1', '#0097A7']}
                style={styles.generateSelectedButton}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <MaterialCommunityIcons name="receipt" size={20} color="white" />
                <AppText style={styles.generateButtonText}>{t.generateFromSelected}</AppText>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Receipt Form Modal - 2 Step Flow */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={closeReceiptForm}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
            <StatusBar style={isDarkMode ? "light" : "dark"} />
            
            <GlobalHeader />

            {/* Modal Header with Step Indicator */}
            <View style={[styles.modalHeader, { paddingTop: insets.top + 60, backgroundColor: colors.surface }]}>
              <TouchableOpacity onPress={closeReceiptForm} style={styles.closeButton}>
                <Ionicons name="close" size={28} color={colors.textPrimary} />
              </TouchableOpacity>
              <View style={styles.stepHeaderCenter}>
                <AppText style={[styles.modalTitle, { color: colors.textPrimary }]}>
                  {currentStep === 1 ? t.step1Title : t.step2Title}
                </AppText>
                {/* Step Indicator Dots */}
                <View style={styles.stepIndicator}>
                  <View style={[styles.stepDot, currentStep === 1 && { backgroundColor: colors.primary }]} />
                  <View style={[styles.stepConnector, { backgroundColor: currentStep === 2 ? colors.primary : colors.border }]} />
                  <View style={[styles.stepDot, currentStep === 2 && { backgroundColor: colors.primary }]} />
                </View>
              </View>
              <View style={{ width: 28 }} />
            </View>

            <ScrollView 
              style={styles.formScrollView}
              contentContainerStyle={[styles.formContent, { paddingBottom: insets.bottom + 20 }]}
            >
              {/* =========== STEP 1: Client Details =========== */}
              {currentStep === 1 && (
                <>
                  {/* Client Source Badge */}
                  {selectedClientObj && (
                    <View style={[styles.clientSourceBadge, { backgroundColor: colors.success + '15', borderColor: colors.success + '40' }]}>
                      <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                      <AppText style={[styles.clientSourceText, { color: colors.success }]}>
                        {t.clientFromBook}
                      </AppText>
                    </View>
                  )}

                  {/* Customer Details Section */}
                  <View style={[styles.formSection, { backgroundColor: colors.surface }]}>
                    <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
                      {t.customerDetails}
                    </AppText>

                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.customerName} <AppText style={styles.requiredStar}>*</AppText>
                      </AppText>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                        value={invoiceData.customerName}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, customerName: text })}
                        placeholder={t.customerName}
                        placeholderTextColor={colors.textSecondary}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.customerVatNumber} <AppText style={styles.requiredStar}>*</AppText>
                      </AppText>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                        value={invoiceData.customerVatNumber}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, customerVatNumber: text })}
                        placeholder={t.customerVatNumber}
                        placeholderTextColor={colors.textSecondary}
                        keyboardType="number-pad"
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.customerEmail} <AppText style={styles.optionalText}>({t.optional})</AppText>
                      </AppText>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                        value={invoiceData.customerEmail}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, customerEmail: text })}
                        placeholder={t.customerEmail}
                        placeholderTextColor={colors.textSecondary}
                        keyboardType="email-address"
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.customerAddress} <AppText style={styles.optionalText}>({t.optional})</AppText>
                      </AppText>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                        value={invoiceData.customerAddress}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, customerAddress: text })}
                        placeholder={t.customerAddress}
                        placeholderTextColor={colors.textSecondary}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.customerCity} <AppText style={styles.optionalText}>({t.optional})</AppText>
                      </AppText>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                        value={invoiceData.customerCity}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, customerCity: text })}
                        placeholder={t.customerCity}
                        placeholderTextColor={colors.textSecondary}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.customerPhone} <AppText style={styles.optionalText}>({t.optional})</AppText>
                      </AppText>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                        value={invoiceData.customerPhone}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, customerPhone: text })}
                        placeholder={t.customerPhone}
                        placeholderTextColor={colors.textSecondary}
                        keyboardType="phone-pad"
                      />
                    </View>
                  </View>

                  {/* Matching Price Proposals */}
                  <View style={[styles.formSection, { backgroundColor: colors.surface }]}>
                    <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
                      {t.priceProposals}
                    </AppText>
                    <AppText style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
                      {t.selectProposal}
                    </AppText>

                    {matchingProposals.length === 0 ? (
                      <View style={[styles.noProposalsContainer, { backgroundColor: colors.backgroundLight }]}>
                        <MaterialCommunityIcons name="file-document-outline" size={32} color={colors.textSecondary} />
                        <AppText style={[styles.noProposalsText, { color: colors.textSecondary }]}>
                          {t.noProposals}
                        </AppText>
                      </View>
                    ) : (
                      matchingProposals.map((proposal) => {
                        const isSelected = selectedPriceProposal?.id === proposal.id;
                        const totalAmount = proposal.totalWithVat || proposal.totalBeforeVat || 0;
                        const itemCount = proposal.items?.length || 0;
                        const dateStr = proposal.createdAt ? new Date(proposal.createdAt).toLocaleDateString() : '';
                        
                        return (
                          <TouchableOpacity
                            key={proposal.id}
                            style={[
                              styles.proposalCard,
                              { backgroundColor: colors.backgroundLight, borderColor: isSelected ? colors.primary : colors.border },
                              isSelected && { borderWidth: 2 },
                            ]}
                            onPress={() => applyPriceProposal(proposal)}
                            activeOpacity={0.7}
                          >
                            <View style={styles.proposalHeader}>
                              <View style={styles.proposalInfo}>
                                <Ionicons 
                                  name={isSelected ? "checkmark-circle" : "document-text-outline"} 
                                  size={20} 
                                  color={isSelected ? colors.primary : colors.textSecondary} 
                                />
                                <AppText style={[styles.proposalTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                                  {proposal.clientName || t.priceProposals}
                                </AppText>
                              </View>
                              {isSelected && (
                                <View style={[styles.selectedBadge, { backgroundColor: colors.primary + '20' }]}>
                                  <AppText style={[styles.selectedBadgeText, { color: colors.primary }]}>{t.selected}</AppText>
                                </View>
                              )}
                            </View>
                            <View style={styles.proposalMeta}>
                              {dateStr ? (
                                <AppText style={[styles.proposalMetaText, { color: colors.textSecondary }]}>
                                  {t.proposalDate}: {dateStr}
                                </AppText>
                              ) : null}
                              <AppText style={[styles.proposalMetaText, { color: colors.textSecondary }]}>
                                {itemCount} {t.proposalItems} • ₪{totalAmount.toFixed(2)}
                              </AppText>
                            </View>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </View>

                  {/* Continue Button */}
                  <View style={styles.buttonContainer}>
                    <TouchableOpacity
                      style={[styles.cancelButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                      onPress={closeReceiptForm}
                    >
                      <AppText style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{t.cancel}</AppText>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.submitButtonContainer}
                      onPress={goToStep2}
                    >
                      <LinearGradient
                        colors={['#3B82F6', '#2563EB']}
                        style={styles.submitButton}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                      >
                        <AppText style={styles.submitButtonText}>{t.continueToItems}</AppText>
                        <Ionicons name="arrow-forward" size={20} color="white" />
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* =========== STEP 2: Items & Pricing =========== */}
              {currentStep === 2 && (
                <>
                  {/* Service Details Section */}
                  <View style={[styles.formSection, { backgroundColor: colors.surface }]}>
                    <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
                      {t.serviceDetails}
                    </AppText>
                    
                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.serviceDescription} <AppText style={styles.requiredStar}>*</AppText>
                      </AppText>
                      <TextInput
                        style={[styles.inputMultiline, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                        value={invoiceData.serviceDescription}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, serviceDescription: text })}
                        placeholder={t.serviceDescription}
                        placeholderTextColor={colors.textSecondary}
                        multiline
                        numberOfLines={3}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.invoiceDate} <AppText style={styles.requiredStar}>*</AppText>
                      </AppText>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
                        value={invoiceData.invoiceDate}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, invoiceDate: text })}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                  </View>

                  {/* Parts & Services Section */}
                  <View style={[styles.formSection, { backgroundColor: colors.surface }]}>
                    <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
                      {t.partsAndServices}
                    </AppText>

                    {/* Price Proposal Applied Badge */}
                    {selectedPriceProposal && (
                      <View style={[styles.proposalAppliedBadge, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
                        <Ionicons name="pricetag" size={16} color={colors.primary} />
                        <AppText style={[styles.proposalAppliedText, { color: colors.primary }]}>
                          {language === 'he' ? 'מחירים מהצעת מחיר' : language === 'ar' ? 'أسعار من عرض السعر' : 'Prices from Price Proposal'}
                        </AppText>
                        <TouchableOpacity onPress={() => applyPriceProposal(selectedPriceProposal)}>
                          <Ionicons name="close-circle" size={18} color={colors.primary} />
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Job Parts */}
                    {jobParts.length > 0 ? (
                      <>
                        <AppText style={[styles.inputLabel, { color: colors.textPrimary, marginBottom: spacing.sm }]}>
                          {selectedJobs.length > 1 ? t.mergedParts : t.jobParts}
                          {selectedJobs.length > 1 && (
                            <AppText style={{ fontSize: typography.xs, color: colors.textSecondary, fontWeight: 'normal' }}>
                              {' '}({selectedJobs.length} {t.jobsSelected})
                            </AppText>
                          )}
                        </AppText>
                        {jobParts.map((part, index) => (
                          <View key={index} style={[styles.partItem, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}>
                            <View style={styles.partRow}>
                              <AppText style={[styles.partName, { color: colors.textPrimary }]}>{part.name}</AppText>
                              <AppText style={[styles.partQuantity, { color: colors.textSecondary }]}>
                                {t.quantity}: {part.quantity}
                              </AppText>
                            </View>
                            <View style={styles.partPriceRow}>
                              <AppText style={[styles.inputLabel, { color: colors.textPrimary, marginBottom: 4 }]}>
                                {t.price} <AppText style={styles.requiredStar}>*</AppText>
                              </AppText>
                              <TextInput
                                style={[styles.input, { backgroundColor: colors.surface, color: colors.textPrimary, borderColor: colors.border, flex: 1 }]}
                                value={part.price}
                                onChangeText={(text) => updateJobPartPrice(index, text)}
                                placeholder={t.price}
                                placeholderTextColor={colors.textSecondary}
                                keyboardType="decimal-pad"
                              />
                            </View>
                            {part.price && !isNaN(parseFloat(part.price)) && (
                              <AppText style={[styles.partTotal, { color: colors.primary }]}>
                                {t.totalPrice}: {(parseFloat(part.quantity) * parseFloat(part.price)).toFixed(2)} ₪
                              </AppText>
                            )}
                          </View>
                        ))}
                      </>
                    ) : (
                      <AppText style={[styles.noPartsText, { color: colors.textSecondary }]}>
                        {t.noPartsFromJob}
                      </AppText>
                    )}

                    {/* Custom Parts with Inventory Search */}
                    <View style={{ marginTop: spacing.lg }}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary, marginBottom: spacing.sm }]}>
                        {t.customParts}
                      </AppText>
                      {customParts.map((part, index) => (
                        <View key={index} style={[styles.partItem, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}>
                          <View style={styles.partHeader}>
                            <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                              {t.partName} <AppText style={styles.requiredStar}>*</AppText>
                            </AppText>
                            <TouchableOpacity onPress={() => removeCustomPart(index)}>
                              <MaterialCommunityIcons name="close-circle" size={24} color={colors.error} />
                            </TouchableOpacity>
                          </View>
                          <InventoryItemSearch
                            style={[styles.input, { backgroundColor: colors.surface, color: colors.textPrimary, borderColor: colors.border, marginBottom: spacing.sm }]}
                            value={part.name}
                            onChangeText={(text) => updateCustomPart(index, 'name', text)}
                            onSelectPart={(selectedPart) => handleCustomPartSelect(index, selectedPart)}
                            inventoryParts={getInventoryParts()}
                            placeholder={t.customPartPlaceholder}
                            colors={colors}
                          />
                          <View style={styles.partPriceRow}>
                            <View style={{ flex: 1, marginRight: spacing.sm }}>
                              <AppText style={[styles.inputLabel, { color: colors.textPrimary, marginBottom: 4 }]}>
                                {t.quantity} <AppText style={styles.requiredStar}>*</AppText>
                              </AppText>
                              <TextInput
                                style={[styles.input, { backgroundColor: colors.surface, color: colors.textPrimary, borderColor: colors.border }]}
                                value={part.quantity}
                                onChangeText={(text) => updateCustomPart(index, 'quantity', text)}
                                placeholder={t.quantity}
                                placeholderTextColor={colors.textSecondary}
                                keyboardType="decimal-pad"
                              />
                            </View>
                            <View style={{ flex: 1 }}>
                              <AppText style={[styles.inputLabel, { color: colors.textPrimary, marginBottom: 4 }]}>
                                {t.price} <AppText style={styles.requiredStar}>*</AppText>
                              </AppText>
                              <TextInput
                                style={[styles.input, { backgroundColor: colors.surface, color: colors.textPrimary, borderColor: colors.border }]}
                                value={part.price}
                                onChangeText={(text) => updateCustomPart(index, 'price', text)}
                                placeholder={t.price}
                                placeholderTextColor={colors.textSecondary}
                                keyboardType="decimal-pad"
                              />
                            </View>
                          </View>
                          {part.quantity && part.price && !isNaN(parseFloat(part.quantity)) && !isNaN(parseFloat(part.price)) && (
                            <AppText style={[styles.partTotal, { color: colors.primary }]}>
                              {t.totalPrice}: {(parseFloat(part.quantity) * parseFloat(part.price)).toFixed(2)} ₪
                            </AppText>
                          )}
                        </View>
                      ))}

                      {/* Add Custom Part Button */}
                      <TouchableOpacity
                        onPress={addCustomPart}
                        style={[styles.addPartButton, { backgroundColor: colors.primary }]}
                      >
                        <MaterialCommunityIcons name="plus-circle" size={20} color="white" />
                        <AppText style={styles.addPartButtonText}>{t.addCustomPart}</AppText>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Step 2 Buttons */}
                  <View style={styles.buttonContainer}>
                    <TouchableOpacity
                      style={[styles.cancelButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                      onPress={goToStep1}
                    >
                      <Ionicons name="arrow-back" size={18} color={colors.textPrimary} style={{ marginRight: 4 }} />
                      <AppText style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{t.backToClient}</AppText>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.submitButtonContainer}
                      onPress={handlePreviewInvoice}
                      disabled={previewLoading}
                    >
                      <LinearGradient
                        colors={previewLoading ? ['#9CA3AF', '#9CA3AF'] : ['#10B981', '#059669']}
                        style={styles.submitButton}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                      >
                        {previewLoading ? (
                          <ActivityIndicator color="white" />
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
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* PDF Preview Modal */}
      <Modal
        visible={pdfModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setPdfModalVisible(false)}
      >
        <View style={[styles.pdfModalContainer, { backgroundColor: colors.background }]}>
          <StatusBar style={isDarkMode ? "light" : "dark"} />
          
          {/* PDF Modal Header */}
          <View style={[styles.pdfModalHeader, { paddingTop: insets.top + 10, backgroundColor: colors.surface }]}>
            <AppText style={[styles.pdfModalTitle, { color: colors.textPrimary }]}>
              {t.previewTitle}
            </AppText>
            <TouchableOpacity onPress={() => setPdfModalVisible(false)} style={styles.closePdfButton}>
              <Ionicons name="close" size={28} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* PDF Actions */}
          {previewURL && (
            <View style={styles.pdfActionsContainer}>
              <MaterialCommunityIcons name="file-pdf-box" size={120} color={colors.primary} />
              <AppText style={[styles.pdfSuccessText, { color: colors.textPrimary }]}>
                Tax Invoice Generated Successfully!
              </AppText>
              <AppText style={[styles.pdfInfoText, { color: colors.textSecondary }]}>
                Your PDF is ready to view or share
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
                    <AppText style={styles.openPdfButtonText}>Open PDF</AppText>
                  </LinearGradient>
                </TouchableOpacity>
              </View>

              <View style={[styles.openPdfButtonContainer, { marginTop: spacing.md }]}>
                <TouchableOpacity onPress={handleSubmitInvoice}>
                  <LinearGradient
                    colors={['#10B981', '#059669']}
                    style={styles.openPdfButton}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  >
                    <MaterialCommunityIcons name="check-circle" size={24} color="white" />
                    <AppText style={styles.openPdfButtonText}>Generate Invoice</AppText>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* PDF Viewer Modal - iOS only, Android uses IntentLauncher */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={pdfViewerVisible}
          animationType="slide"
          onRequestClose={() => {
            setPdfViewerVisible(false);
            setPdfModalVisible(true);
          }}
        >
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <StatusBar style={isDarkMode ? "light" : "dark"} />

          {/* Viewer Header */}
          <View style={[styles.pdfModalHeader, { backgroundColor: colors.surface, paddingTop: insets.top + 10 }]}>
            <AppText style={[styles.pdfModalTitle, { color: colors.primary }]}>Tax Invoice Preview</AppText>
            <TouchableOpacity
              onPress={() => {
                setPdfViewerVisible(false);
                setPdfModalVisible(true);
              }}
              style={styles.closePdfButton}
            >
              <Ionicons name="close" size={28} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={{ flex: 1 }}>
            {previewURL ? (
              <WebView
                source={{ uri: previewURL }}
                style={{ flex: 1, backgroundColor: '#525659' }}
                javaScriptEnabled
                domStorageEnabled
                startInLoadingState
                scalesPageToFit
                allowFileAccess
                originWhitelist={['*']}
                renderLoading={() => (
                  <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <AppText style={[styles.loadingText, { color: colors.text }]}>{t.loading}</AppText>
                  </View>
                )}
                onError={(syntheticEvent) => {
                  const { nativeEvent } = syntheticEvent;
                  console.warn('WebView error:', nativeEvent);
                  showErrorMessage('Error', 'Failed to load PDF preview');
                }}
                onHttpError={(syntheticEvent) => {
                  const { nativeEvent } = syntheticEvent;
                  console.warn('WebView HTTP error:', nativeEvent);
                  showErrorMessage('Error', 'Failed to load PDF preview (HTTP)');
                }}
              />
            ) : (
              <View style={styles.centerContainer}>
                <MaterialCommunityIcons name="file-alert" size={64} color={colors.textSecondary} />
                <AppText style={[styles.noJobsText, { color: colors.textSecondary }]}>No preview available</AppText>
              </View>
            )}
          </View>
        </View>
        </Modal>
      )}

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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: Platform.OS === 'ios' ? 110 : 98,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    ...shadows.sm,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.base,
    paddingVertical: spacing.xs,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.base,
  },
  noJobsText: {
    marginTop: spacing.md,
    fontSize: typography.lg,
    textAlign: 'center',
  },
  jobCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.md,
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  jobHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  jobTitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    flex: 1,
  },
  jobDetails: {
    gap: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  detailLabel: {
    fontSize: typography.sm,
    marginLeft: spacing.xs,
  },
  detailValue: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    flex: 1,
  },
  generateButtonContainer: {
    marginTop: spacing.md,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  generateButtonText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  // Modal Styles
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    ...shadows.sm,
  },
  closeButton: {
    padding: spacing.xs,
  },
  modalTitle: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
  },
  formScrollView: {
    flex: 1,
  },
  formContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  formSection: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  sectionTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    marginBottom: spacing.md,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    marginBottom: spacing.xs,
  },
  requiredStar: {
    color: '#EF4444',
  },
  optionalText: {
    fontSize: typography.xs,
    fontWeight: typography.regular,
    opacity: 0.6,
  },
  customerTypeContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  customerTypeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    gap: spacing.xs,
  },
  customerTypeText: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: typography.base,
  },
  inputMultiline: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: typography.base,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  customerTypeContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  customerTypeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    gap: spacing.xs,
  },
  customerTypeText: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  paymentMethodContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  paymentMethodButton: {
    flex: 1,
    minWidth: '45%',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  paymentMethodText: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacing.md + 2,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  previewButtonContainer: {
    flex: 1,
  },
  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md + 2,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  previewButtonText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  submitButtonContainer: {
    flex: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md + 2,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  submitButtonText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  // Parts Section Styles
  partItem: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  partRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  partName: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    flex: 1,
  },
  partQuantity: {
    fontSize: typography.sm,
    marginLeft: spacing.sm,
  },
  partPriceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  partTotal: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    marginTop: spacing.sm,
    textAlign: 'right',
  },
  partHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  addPartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  addPartButtonText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  noPartsText: {
    fontSize: typography.sm,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  // PDF Modal Styles
  pdfModalContainer: {
    flex: 1,
  },
  pdfModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    ...shadows.sm,
  },
  pdfModalTitle: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    flex: 1,
  },
  closePdfButton: {
    padding: spacing.xs,
  },
  pdfActionsContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  pdfSuccessText: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
  pdfInfoText: {
    fontSize: typography.base,
    marginTop: spacing.sm,
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  openPdfButtonContainer: {
    width: '100%',
    maxWidth: 300,
  },
  openPdfButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
  },
  openPdfButtonText: {
    color: 'white',
    fontSize: typography.lg,
    fontWeight: typography.bold,
  },
  // 2-step flow styles
  stepHeaderCenter: {
    flex: 1,
    alignItems: 'center',
  },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#D1D5DB',
  },
  stepConnector: {
    width: 30,
    height: 2,
    marginHorizontal: 4,
  },
  clientSourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    gap: spacing.xs,
  },
  clientSourceText: {
    fontSize: typography.sm,
    fontWeight: '500',
  },
  sectionSubtitle: {
    fontSize: typography.sm,
    marginBottom: spacing.md,
  },
  noProposalsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  noProposalsText: {
    fontSize: typography.sm,
    textAlign: 'center',
  },
  proposalCard: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  proposalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  proposalInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  proposalTitle: {
    fontSize: typography.base,
    fontWeight: '600',
    flex: 1,
  },
  selectedBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  selectedBadgeText: {
    fontSize: typography.xs,
    fontWeight: '600',
  },
  proposalMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    paddingLeft: 28,
  },
  proposalMetaText: {
    fontSize: typography.xs,
  },
  proposalAppliedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  proposalAppliedText: {
    fontSize: typography.xs,
    fontWeight: '500',
    flex: 1,
  },
  // Multi-select bottom bar styles
  selectionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    ...shadows.lg,
  },
  selectionBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  selectionInfo: {
    flex: 1,
  },
  selectionCountText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  deselectText: {
    fontSize: typography.sm,
    marginTop: 2,
  },
  generateSelectedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
});






