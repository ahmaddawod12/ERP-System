import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Platform,
  Linking,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getColors, spacing, borderRadius, typography, shadows, gradients } from '../theme';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { useAlert } from '../contexts/AlertContext';
import { useCache } from '../contexts/CacheContext';
import { GlobalHeader, DateFilter, ScrollableContainer, ClientSelectorModal } from '../components';
import { auth, db, collection, query, where, orderBy, getDocs, doc, deleteDoc } from '../firebase';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

/**
 * Document Type Codes (numeric)
 * 10 = Price Proposal (הצעת מחיר)
 * 200 = Delivery Note (תעודת משלוח)
 * 210 = Return Certificate (תעודת החזרה)
 * 305 = Tax Invoice (חשבונית מס)
 * 330 = Refund (זיכוי)
 * 400 = Receipt (קבלה)
 */
const DOC_TYPE = {
  PRICE_PROPOSAL: 10,
  DELIVERY_NOTE: 200,
  RETURN_CERTIFICATE: 210,
  TAX_INVOICE: 305,
  REFUND: 330,
  RECEIPT: 400
};

export default function DocumentHistory() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { 
    getCompanyName, 
    getUsername, 
    certifications: cachedCertifications, 
    clients: cachedClients,
    fetchClients,
    refreshCache, 
    getDataForDateRange,
    getDataForMonth,
    isWithinCacheRange 
  } = useCache();
  const colors = getColors(isDarkMode);

  const [documents, setDocuments] = useState([]);
  const [filteredDocuments, setFilteredDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDocType, setSelectedDocType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [downloadingDoc, setDownloadingDoc] = useState(null);
  const [sharingDoc, setSharingDoc] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFilter, setDateFilter] = useState({
    type: 'last7days',
    startDate: new Date(new Date().setDate(new Date().getDate() - 7)),
    endDate: (() => {
      const today = new Date();
      today.setHours(23, 59, 59, 999); // Set to end of today
      return today;
    })(),
    label: 'Last 7 Days'
  });
  const [clientFilter, setClientFilter] = useState('');
  const [showClientSelector, setShowClientSelector] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState('');

  const t = language === 'en' ? {
    title: 'Document History',
    back: 'Back',
    filterByType: 'Filter by Type',
    filterByDate: 'Filter by Date',
    filterByClient: 'Filter by Client Name',
    searchClients: 'Search clients...',
    noClients: 'No clients found',
    noSearchResults: 'No clients match your search',
    clearFilter: 'Clear Filter',
    all: 'All Documents',
    taxInvoice: 'Tax Invoice',
    priceProposal: 'Price Proposal',
    refund: 'Refund',
    returnCertificate: 'Return Certificate',
    receipt: 'Receipt',
    deliveryNote: 'Delivery Note',
    clearDate: 'Clear Filter',
    search: 'Search by client name, description...',
    noDocuments: 'No documents found',
    createdOn: 'Created',
    client: 'Client',
    createdBy: 'Created By',
    amount: 'Amount',
    view: 'View',
    download: 'Download',
    share: 'Share',
    delete: 'Delete',
    deleteConfirm: 'Are you sure you want to delete this document? This action cannot be undone.',
    deleteSuccess: 'Document deleted successfully',
    deleteError: 'Failed to delete document',
    close: 'Close',
    downloading: 'Downloading...',
    downloadComplete: 'Download Complete',
    downloadError: 'Download Failed',
    shareError: 'Share Failed',
    pdfNotAvailable: 'PDF not available for this document',
    documentDetails: 'Document Details',
    type: 'Type',
    date: 'Date',
    description: 'Description',
    total: 'Total',
  } : language === 'he' ? {
    title: 'היסטוריית מסמכים',
    back: 'חזרה',
    filterByType: 'סנן לפי סוג',
    filterByDate: 'סנן לפי חודש',
    filterByClient: 'סינון לפי לקוח',
    searchClients: 'חיפוש לקוחות...',
    noClients: 'לא נמצאו לקוחות',
    noSearchResults: 'לא נמצאו לקוחות התואמים לחיפוש',
    clearFilter: 'נקה סינון',
    all: 'כל המסמכים',
    taxInvoice: 'חשבונית מס',
    priceProposal: 'הצעת מחיר',
    refund: 'זיכוי',
    returnCertificate: 'תעודת החזרה',
    receipt: 'קבלה',
    deliveryNote: 'תעודת משלוח',
    clearDate: 'נקה סינון',
    startDate: 'תאריך התחלה',
    endDate: 'תאריך סיום',
    search: 'חיפוש לפי שם לקוח, תיאור...',
    noDocuments: 'לא נמצאו מסמכים',
    createdOn: 'נוצר',
    createdBy: 'נוצר על ידי',
    client: 'לקוח',
    amount: 'סכום',
    view: 'צפייה',
    download: 'הורדה',
    share: 'שיתוף',
    delete: 'מחיקה',
    deleteConfirm: 'האם אתה בטוח שברצונך למחוק מסמך זה? פעולה זו אינה ניתנת לביטול.',
    deleteSuccess: 'המסמך נמחק בהצלחה',
    deleteError: 'מחיקת המסמך נכשלה',
    close: 'סגור',
    downloading: 'מוריד...',
    downloadComplete: 'ההורדה הושלמה',
    downloadError: 'ההורדה נכשלה',
    shareError: 'השיתוף נכשל',
    pdfNotAvailable: 'PDF אינו זמין למסמך זה',
    documentDetails: 'פרטי מסמך',
    type: 'סוג',
    date: 'תאריך',
    description: 'תיאור',
    total: 'סה"כ',
  } : {
    title: 'سجل المستندات',
    back: 'رجوع',
    filterByType: 'تصفية حسب النوع',
    filterByDate: 'تصفية حسب الشهر',
    filterByClient: 'تصفية حسب العميل',
    searchClients: 'البحث عن العملاء...',
    noClients: 'لم يتم العثور على عملاء',
    noSearchResults: 'لا يوجد عملاء مطابقين للبحث',
    clearFilter: 'مسح التصفية',
    all: 'جميع المستندات',
    taxInvoice: 'فاتورة ضريبية',
    priceProposal: 'عرض السعر',
    refund: 'استرداد',
    returnCertificate: 'شهادة الإرجاع',
    receipt: 'إيصال',
    deliveryNote: 'إشعار تسليم',
    clearDate: 'مسح الفلتر',
    startDate: 'تاريخ البدء',
    endDate: 'تاريخ الانتهاء',
    search: 'البحث عن طريق اسم العميل، الوصف...',
    noDocuments: 'لم يتم العثور على مستندات',
    createdOn: 'تم الإنشاء',
    createdBy: 'أنشئ بواسطة',
    client: 'العميل',
    amount: 'المبلغ',
    view: 'عرض',
    download: 'تحميل',
    share: 'مشاركة',
    delete: 'حذف',
    deleteConfirm: 'هل أنت متأكد من حذف هذا المستند؟ لا يمكن التراجع عن هذا الإجراء.',
    deleteSuccess: 'تم حذف المستند بنجاح',
    deleteError: 'فشل حذف المستند',
    close: 'إغلاق',
    downloading: 'جاري التحميل...',
    downloadComplete: 'اكتمل التحميل',
    downloadError: 'فشل التحميل',
    shareError: 'فشل المشاركة',
    pdfNotAvailable: 'PDF غير متاح لهذا المستند',
    documentDetails: 'تفاصيل المستند',
    type: 'النوع',
    date: 'التاريخ',
    description: 'الوصف',
    total: 'المجموع',
  };

  const documentTypes = [
    { id: 'all', label: t.all, icon: 'file-document-multiple', color: '#6B7280', gradient: ['#6B7280', '#4B5563'] },
    { id: DOC_TYPE.TAX_INVOICE, label: t.taxInvoice, icon: 'receipt', color: '#10B981', gradient: ['#10B981', '#059669'] },
    { id: DOC_TYPE.PRICE_PROPOSAL, label: t.priceProposal, icon: 'file-document-edit', color: '#3B82F6', gradient: ['#3B82F6', '#2563EB'] },
    { id: DOC_TYPE.REFUND, label: t.refund, icon: 'cash-refund', color: '#F59E0B', gradient: ['#F59E0B', '#D97706'] },
    { id: DOC_TYPE.RETURN_CERTIFICATE, label: t.returnCertificate, icon: 'file-certificate', color: '#8B5CF6', gradient: ['#8B5CF6', '#7C3AED'] },
    { id: DOC_TYPE.RECEIPT, label: t.receipt || 'Receipt', icon: 'receipt', color: '#06B6D4', gradient: ['#06B6D4', '#0891B2'] },
    { id: DOC_TYPE.DELIVERY_NOTE, label: t.deliveryNote || 'Delivery Note', icon: 'truck-delivery', color: '#8B5CF6', gradient: ['#8B5CF6', '#7C3AED'] },
  ];

  useEffect(() => {
    loadDocuments();
  }, [cachedCertifications]);

  useEffect(() => {
    applyFilters();
  }, [documents, selectedDocType, dateFilter, clientFilter]);


  // Helper function to calculate total from income items
  const calculateTotal = (income) => {
    if (!income || !Array.isArray(income)) return 0;
    return income.reduce((sum, item) => {
      const price = parseFloat(item.price) || 0;
      const quantity = parseFloat(item.quantity) || 1;
      return sum + (price * quantity);
    }, 0);
  };

  // Helper function to get description from income items
  const getDescriptionFromIncome = (income) => {
    if (!income || !Array.isArray(income) || income.length === 0) return '';
    return income.map(item => item.description).filter(Boolean).join(', ');
  };

  const loadDocuments = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }

      // Get company name from cache
      const companyName = getCompanyName();

      if (!companyName) {
        console.log('No company name found');
        setDocuments([]);
        setLoading(false);
        return;
      }

      // Use cached certifications - CacheContext already has real-time listeners
      // Cache contains last 90 days of certifications
      if (cachedCertifications && cachedCertifications.length > 0) {
        console.log('📦 [CACHE READ] DocumentHistory - certifications from cache:', cachedCertifications.length);
        const docs = cachedCertifications.map(data => {
          // Transform cached data to match expected structure
          return {
            id: data.id,
            ...data,
            type: data.type,
            total: calculateTotal(data.income || data.items),
            description: getDescriptionFromIncome(data.income || data.items) || data.notes,
            pdfUrl: data.downloadURL || data.url?.origin || data.url?.he || data.url?.en || null,
            downloadUrl: data.downloadURL || data.url?.origin || data.url?.he || data.url?.en || null,
            documentNumber: data.documentNumber || data.number || data.id,
          };
        });

        // Sort by creation date (newest first)
        docs.sort((a, b) => {
          const getTime = (dateInput) => {
            if (!dateInput) return 0;
            if (dateInput.toDate && typeof dateInput.toDate === 'function') {
              return dateInput.toDate().getTime();
            }
            return new Date(dateInput).getTime();
          };
          
          const dateA = getTime(a.createdAt);
          const dateB = getTime(b.createdAt);
          return dateB - dateA;
        });

        setDocuments(docs);
        setLoading(false);
        return; // Use cached data only - CacheContext handles real-time updates
      }

      // Fallback when no cached data available - shouldn't normally happen
      // as CacheContext initializes certifications on login
      console.log('No cached certifications available, cache may not be initialized');
      setDocuments([]);
      setLoading(false);
    } catch (error) {
      console.error('Error loading documents:', error);
      setDocuments([]);
      setLoading(false);
    }
  };

  const applyFilters = async () => {
    let filtered = [...documents];

    // Filter by document type
    if (selectedDocType !== 'all') {
      filtered = filtered.filter(doc => doc.type === selectedDocType);
    }

    // Check if date range extends beyond cache (90 days)
    // If both dates are set and startDate is outside cache range, fetch from Firebase
    if (dateFilter.startDate && dateFilter.endDate) {
      const startInCache = isWithinCacheRange(dateFilter.startDate);
      
      if (!startInCache) {
        // Date range extends beyond cache - use smart filtering from CacheContext
        try {
          const smartData = await getDataForDateRange(dateFilter.startDate, dateFilter.endDate, 'certifications');
          
          // Transform the data
          filtered = smartData.map(data => ({
            id: data.id,
            ...data,
            type: data.type,
            total: calculateTotal(data.income || data.items),
            description: getDescriptionFromIncome(data.income || data.items) || data.notes,
            pdfUrl: data.downloadURL || data.url?.origin || data.url?.he || data.url?.en || null,
            downloadUrl: data.downloadURL || data.url?.origin || data.url?.he || data.url?.en || null,
            documentNumber: data.documentNumber || data.number || data.id,
          }));
          
          // Apply type filter
          if (selectedDocType !== 'all') {
            filtered = filtered.filter(doc => doc.type === selectedDocType);
          }
        } catch (error) {
          console.error('Error fetching data for date range:', error);
        }
      } else {
        // Date range is within cache - filter from cached documents
        const start = new Date(dateFilter.startDate.getFullYear(), dateFilter.startDate.getMonth(), dateFilter.startDate.getDate()).getTime();
        const end = new Date(dateFilter.endDate.getFullYear(), dateFilter.endDate.getMonth(), dateFilter.endDate.getDate(), 23, 59, 59).getTime();
        
        filtered = filtered.filter(doc => {
          const getTime = (dateInput) => {
            if (!dateInput) return 0;
            if (dateInput.toDate && typeof dateInput.toDate === 'function') {
              return dateInput.toDate().getTime();
            }
            return new Date(dateInput).getTime();
          };
          const docDate = getTime(doc.createdAt);
          return docDate >= start && docDate <= end;
        });
      }
    } else {
      // Only start or end date is set
      if (dateFilter.startDate) {
        const start = new Date(dateFilter.startDate.getFullYear(), dateFilter.startDate.getMonth(), dateFilter.startDate.getDate()).getTime();
        filtered = filtered.filter(doc => {
          const getTime = (dateInput) => {
            if (!dateInput) return 0;
            if (dateInput.toDate && typeof dateInput.toDate === 'function') {
              return dateInput.toDate().getTime();
            }
            return new Date(dateInput).getTime();
          };
          const docDate = getTime(doc.createdAt);
          return docDate >= start;
        });
      }

      if (dateFilter.endDate) {
        const end = new Date(dateFilter.endDate.getFullYear(), dateFilter.endDate.getMonth(), dateFilter.endDate.getDate(), 23, 59, 59).getTime();
        filtered = filtered.filter(doc => {
          const getTime = (dateInput) => {
            if (!dateInput) return 0;
            if (dateInput.toDate && typeof dateInput.toDate === 'function') {
              return dateInput.toDate().getTime();
            }
            return new Date(dateInput).getTime();
          };
          const docDate = getTime(doc.createdAt);
          return docDate <= end;
        });
      }
    }

    // Filter by search query (client name)
    if (clientFilter.trim()) {
      const query = clientFilter.toLowerCase();
      filtered = filtered.filter(doc =>
        (doc.clientName && doc.clientName.toLowerCase().includes(query))
      );
    }

    setFilteredDocuments(filtered);
  };

  const handlePreview = async (doc) => {
    if (!doc.pdfUrl && !doc.downloadUrl) {
      alert.error('Error', 'Document URL not available');
      return;
    }

    try {
      const url = doc.pdfUrl || doc.downloadUrl;
      
      // Open the PDF URL in the browser for preview
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        alert.error('Error', 'Cannot open document URL');
      }
    } catch (error) {
      console.error('Error previewing document:', error);
      alert.error('Error', error.message);
    }
  };

  /**
   * View - Navigate to ViewCertification screen to show document data
   */
  const handleView = (doc) => {
    router.push({
      pathname: '/ViewCertification',
      params: { 
        document: JSON.stringify(doc)
      }
    });
  };

  /**
   * Download - Actually download the PDF file to device
   */
  const handleDownload = async (doc) => {
    if (!doc.pdfUrl && !doc.downloadUrl) {
      alert.error('Error', t.pdfNotAvailable);
      return;
    }

    try {
      setDownloadingDoc(doc.id);
      const url = doc.pdfUrl || doc.downloadUrl;
      
      // Create a filename from the document
      const filename = `${getDocTypeName(doc.type)}_${doc.documentNumber || doc.id}.pdf`;
      const fileUri = FileSystem.documentDirectory + filename;

      // Download the file
      const downloadResult = await FileSystem.downloadAsync(url, fileUri);
      
      if (downloadResult.status === 200) {
        // On iOS, we need to use share to save to Files app
        // On Android, we can save directly but share also works well
        if (Platform.OS === 'ios') {
          // iOS: Use share sheet with "Save to Files" option
          const isAvailable = await Sharing.isAvailableAsync();
          if (isAvailable) {
            await Sharing.shareAsync(downloadResult.uri, {
              mimeType: 'application/pdf',
              dialogTitle: t.download,
              UTI: 'com.adobe.pdf'
            });
          }
        } else {
          // Android: Try to open with system viewer or show success
          try {
            await Linking.openURL(`file://${downloadResult.uri}`);
          } catch (linkError) {
            // If can't open directly, just show success message
            alert.success(t.downloadComplete, `${t.download}: ${filename}`);
          }
        }
        alert.success(t.downloadComplete, filename);
      } else {
        alert.error('Error', t.downloadError);
      }
    } catch (error) {
      console.error('Error downloading document:', error);
      alert.error(t.downloadError, error.message);
    } finally {
      setDownloadingDoc(null);
    }
  };

  /**
   * Share - Share the PDF via system share sheet (WhatsApp, Email, etc.)
   */
  const handleShare = async (doc) => {
    if (!doc.pdfUrl && !doc.downloadUrl) {
      alert.error('Error', t.pdfNotAvailable);
      return;
    }

    try {
      setSharingDoc(doc.id);
      const url = doc.pdfUrl || doc.downloadUrl;
      
      // Download file first for sharing
      const filename = `${getDocTypeName(doc.type)}_${doc.documentNumber || doc.id}.pdf`;
      const fileUri = FileSystem.cacheDirectory + filename;

      const downloadResult = await FileSystem.downloadAsync(url, fileUri);
      
      if (downloadResult.status === 200) {
        const isAvailable = await Sharing.isAvailableAsync();
        
        if (isAvailable) {
          await Sharing.shareAsync(downloadResult.uri, {
            mimeType: 'application/pdf',
            dialogTitle: t.share,
            UTI: 'com.adobe.pdf'
          });
        } else {
          // Fallback: Open URL directly
          await Linking.openURL(url);
        }
      } else {
        alert.error('Error', t.shareError);
      }
    } catch (error) {
      console.error('Error sharing document:', error);
      alert.error(t.shareError, error.message);
    } finally {
      setSharingDoc(null);
    }
  };

  /**
   * Get document type name for filenames
   */
  const getDocTypeName = (type) => {
    const numericType = typeof type === 'number' ? type : Number(type);
    switch (numericType) {
      case DOC_TYPE.TAX_INVOICE: return 'TaxInvoice';
      case DOC_TYPE.RECEIPT: return 'Receipt';
      case DOC_TYPE.PRICE_PROPOSAL: return 'PriceProposal';
      case DOC_TYPE.DELIVERY_NOTE: return 'DeliveryNote';
      case DOC_TYPE.RETURN_CERTIFICATE: return 'ReturnCertificate';
      case DOC_TYPE.REFUND: return 'Refund';
      default: return 'Document';
    }
  };

  const handleDelete = async (document) => {
    try {
      // Get company name from cache
      const companyName = getCompanyName();

      if (!companyName) {
        alert.error('Error', 'Company name not found');
        return;
      }

      // Show confirmation dialog
      alert.confirm(
        t.delete,
        t.deleteConfirm,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => {}
          },
          {
            text: t.delete,
            style: 'destructive',
            onPress: async () => {
              try {
                // Delete from Firestore
                const docRef = doc(db, 'companies', companyName, 'certifications', document.id);
                await deleteDoc(docRef);
                alert.success(t.deleteSuccess || 'Success', t.deleteSuccess);
              } catch (error) {
                console.error('Error deleting document:', error);
                alert.error(t.deleteError || 'Error', error.message);
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error in handleDelete:', error);
      alert.error('Error', error.message);
    }
  };

  const getDocTypeIcon = (type) => {
    const numericType = typeof type === 'number' ? type : Number(type);
    switch (numericType) {
      case DOC_TYPE.TAX_INVOICE:
        return 'receipt';
      case DOC_TYPE.PRICE_PROPOSAL:
        return 'file-document-edit';
      case DOC_TYPE.REFUND:
        return 'cash-refund';
      case DOC_TYPE.RETURN_CERTIFICATE:
        return 'file-certificate';
      case DOC_TYPE.RECEIPT:
        return 'receipt';
      case DOC_TYPE.DELIVERY_NOTE:
        return 'truck-delivery';
      default:
        return 'file-document';
    }
  };

  const getDocTypeColor = (type) => {
    const numericType = typeof type === 'number' ? type : Number(type);
    switch (numericType) {
      case DOC_TYPE.TAX_INVOICE:
        return '#10B981';
      case DOC_TYPE.PRICE_PROPOSAL:
        return '#3B82F6';
      case DOC_TYPE.REFUND:
        return '#F59E0B';
      case DOC_TYPE.RETURN_CERTIFICATE:
        return '#8B5CF6';
      case DOC_TYPE.RECEIPT:
        return '#06B6D4';
      case DOC_TYPE.DELIVERY_NOTE:
        return '#8B5CF6';
      default:
        return colors.primary;
    }
  };

  const formatDate = (dateInput) => {
    if (!dateInput) return 'N/A';
    
    // Handle Firestore Timestamp
    if (dateInput.toDate && typeof dateInput.toDate === 'function') {
      const date = dateInput.toDate();
      return date.toLocaleDateString(language === 'he' ? 'he-IL' : 'en-US');
    }
    
    // Handle date string
    const dateString = dateInput;
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'N/A';
      return date.toLocaleDateString(language === 'en' ? 'en-US' : language === 'he' ? 'he-IL' : 'ar-SA');
    } catch (error) {
      return 'N/A';
    }
  };

  const formatAmount = (amount) => {
    if (!amount || isNaN(amount)) return 'N/A';
    try {
      return `₪${parseFloat(amount).toFixed(2)}`;
    } catch (error) {
      return 'N/A';
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textPrimary }]}>Loading documents...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      <ScrollableContainer 
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: 120, paddingBottom: insets.bottom + 20 }]}
      >
        {/* Filters Section */}
        <View style={[styles.filtersContainer, { backgroundColor: colors.surface }]}>
          {/* Document Type Filter */}
          <Text style={[styles.filterLabel, { color: colors.textPrimary }]}>{t.filterByType}</Text>
          <TouchableOpacity
            style={[styles.dropdownButton, { 
              backgroundColor: colors.background, 
              borderColor: dropdownOpen ? colors.primary : colors.border 
            }]}
            onPress={() => setDropdownOpen(!dropdownOpen)}
            activeOpacity={0.7}
          >
            <View style={styles.dropdownButtonContent}>
              {(() => {
                const selected = documentTypes.find(t => t.id === selectedDocType);
                if (selected && selected.id !== 'all') {
                  return (
                    <View style={[styles.selectedIconCircle, { backgroundColor: selected.color + '20' }]}>
                      <MaterialCommunityIcons 
                        name={selected.icon} 
                        size={22} 
                        color={selected.color} 
                      />
                    </View>
                  );
                }
                return (
                  <MaterialCommunityIcons 
                    name="file-document" 
                    size={22} 
                    color={colors.textSecondary} 
                  />
                );
              })()}
              <Text style={[styles.dropdownText, { color: colors.textPrimary }]}>
                {documentTypes.find(t => t.id === selectedDocType)?.label || t.all}
              </Text>
            </View>
            <MaterialCommunityIcons 
              name={dropdownOpen ? "chevron-up" : "chevron-down"} 
              size={24} 
              color={colors.textSecondary} 
            />
          </TouchableOpacity>

          {/* Dropdown Options */}
          {dropdownOpen && (
            <View style={[styles.dropdownOptions, { backgroundColor: colors.surface }]}>
              {documentTypes.map((type, index) => (
                <TouchableOpacity
                  key={type.id}
                  style={[
                    styles.dropdownOption,
                    index !== documentTypes.length - 1 && styles.dropdownOptionBorder,
                    { borderBottomColor: colors.border },
                    selectedDocType === type.id && { backgroundColor: type.color + '08' }
                  ]}
                  onPress={() => {
                    setSelectedDocType(type.id);
                    setDropdownOpen(false);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.optionIconCircle, { backgroundColor: type.color + '15' }]}>
                    <MaterialCommunityIcons 
                      name={type.icon} 
                      size={24} 
                      color={type.color} 
                    />
                  </View>
                  <Text style={[styles.optionTitle, { 
                    color: selectedDocType === type.id ? type.color : colors.textPrimary,
                    fontWeight: selectedDocType === type.id ? 'bold' : '500'
                  }]}>
                    {type.label}
                  </Text>
                  {selectedDocType === type.id && (
                    <MaterialCommunityIcons 
                      name="check-circle" 
                      size={22} 
                      color={type.color} 
                    />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Date Filter */}
          <Text style={[styles.filterLabel, { color: colors.textPrimary, marginTop: spacing.md }]}>{t.filterByDate}</Text>
          <View style={styles.filtersRow}>
            {/* Date Filter Button */}
            <TouchableOpacity 
              style={styles.dateFilterButton}
              onPress={() => setShowDateFilter(true)}
            >
              <LinearGradient colors={gradients.blueBox} style={styles.dateFilterGradient}>
                <Ionicons name="calendar-outline" size={20} color="white" />
                <Text style={styles.dateFilterText}>
                  {dateFilter.label || t.filterByDate}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Client Name Filter */}
            <TouchableOpacity 
              style={[styles.clientFilterInput, { backgroundColor: colors.background, borderColor: colors.border }]}
              onPress={() => setShowClientSelector(true)}
            >
              <Ionicons name="person-outline" size={20} color={colors.textSecondary} />
              <Text 
                style={[styles.clientInput, { color: clientFilter ? colors.textPrimary : colors.textSecondary }]}
                numberOfLines={1}
              >
                {clientFilter || t.filterByClient}
              </Text>
              {clientFilter.length > 0 && (
                <TouchableOpacity onPress={(e) => {
                  e.stopPropagation();
                  setClientFilter('');
                }}>
                  <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          {/* Clear Date Filter */}
          {dateFilter.label && (
            <TouchableOpacity 
              style={styles.clearDatesButton}
              onPress={() => setDateFilter({ type: 'pickMonth', startDate: null, endDate: null, label: '' })}
            >
              <LinearGradient colors={gradients.redBox} style={styles.clearDatesGradient}>
                <Ionicons name="close-circle-outline" size={18} color="white" />
                <Text style={styles.clearDatesText}>{t.clearDate}</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>

        {/* Documents List */}
        <View style={styles.documentsContainer}>
          {filteredDocuments.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="file-document-outline" size={64} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t.noDocuments}</Text>
            </View>
          ) : (
            filteredDocuments.map((doc) => (
              <View key={doc.id} style={[styles.documentCard, { backgroundColor: colors.surface }]}>
                <View style={styles.documentHeader}>
                  <View style={styles.documentTitleRow}>
                    <MaterialCommunityIcons
                      name={getDocTypeIcon(doc.type)}
                      size={32}
                      color={getDocTypeColor(doc.type)}
                    />
                    <View style={styles.documentTitleInfo}>
                      <Text style={[styles.documentType, { color: colors.textPrimary }]}>
                        {documentTypes.find(t => t.id === doc.type)?.label || String(doc.type || 'Document')}
                      </Text>
                      <Text style={[styles.documentDate, { color: colors.textSecondary }]}>
                        {t.createdOn}: {formatDate(doc.createdAt)}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.documentDetails}>
                  {doc.clientName && (
                    <View style={styles.detailRow}>
                      <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
                      <Text style={[styles.detailText, { color: colors.textPrimary }]}>
                        {t.client}: {String(doc.clientName || '')}
                      </Text>
                    </View>
                  )}
                  {doc.createdByUsername && (
                    <View style={styles.detailRow}>
                      <Ionicons name="person-circle-outline" size={16} color={colors.textSecondary} />
                      <Text style={[styles.detailText, { color: colors.textPrimary }]}>
                        {t.createdBy}: {String(doc.createdByUsername || '')}
                      </Text>
                    </View>
                  )}
                  {doc.total != null && (
                    <View style={styles.detailRow}>
                      <Ionicons name="cash-outline" size={16} color={colors.textSecondary} />
                      <Text style={[styles.detailText, { color: colors.textPrimary }]}>
                        {t.total}: {formatAmount(doc.total)}
                      </Text>
                    </View>
                  )}
                  {doc.description && (
                    <Text style={[styles.documentDescription, { color: colors.textSecondary }]} numberOfLines={2}>
                      {doc.description}
                    </Text>
                  )}
                </View>

                <View style={styles.documentActions}>
                  {/* View Button - Shows document data */}
                  <TouchableOpacity
                    style={[styles.actionButton, styles.actionButtonThree, { backgroundColor: colors.primary }]}
                    onPress={() => handleView(doc)}
                  >
                    <Ionicons name="eye-outline" size={18} color="white" />
                    <Text style={styles.actionButtonText}>{t.view}</Text>
                  </TouchableOpacity>

                  {/* Download Button - Downloads PDF to device */}
                  <TouchableOpacity
                    style={[styles.actionButton, styles.actionButtonThree, { backgroundColor: colors.secondary }]}
                    onPress={() => handleDownload(doc)}
                    disabled={downloadingDoc === doc.id}
                  >
                    {downloadingDoc === doc.id ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <>
                        <Ionicons name="download-outline" size={18} color="white" />
                        <Text style={styles.actionButtonText}>{t.download}</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  {/* Share Button - Share via WhatsApp, Email, etc. */}
                  <TouchableOpacity
                    style={[styles.actionButton, styles.actionButtonThree, { backgroundColor: '#25D366' }]}
                    onPress={() => handleShare(doc)}
                    disabled={sharingDoc === doc.id}
                  >
                    {sharingDoc === doc.id ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <>
                        <Ionicons name="share-social-outline" size={18} color="white" />
                        <Text style={styles.actionButtonText}>{t.share}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollableContainer>

      {/* Preview Modal */}
      <Modal
        visible={showPreviewModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPreviewModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{t.documentDetails}</Text>
              <TouchableOpacity onPress={() => setShowPreviewModal(false)}>
                <Ionicons name="close" size={28} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScrollView}>
              {selectedDocument && (
                <View>
                  <View style={styles.previewRow}>
                    <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>{t.type}:</Text>
                    <Text style={[styles.previewValue, { color: colors.textPrimary }]}>
                      {documentTypes.find(t => t.id === selectedDocument.type)?.label || selectedDocument.type}
                    </Text>
                  </View>

                  <View style={styles.previewRow}>
                    <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>{t.date}:</Text>
                    <Text style={[styles.previewValue, { color: colors.textPrimary }]}>
                      {formatDate(selectedDocument.createdAt)}
                    </Text>
                  </View>

                  {selectedDocument.clientName && (
                    <View style={styles.previewRow}>
                      <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>{t.client}:</Text>
                      <Text style={[styles.previewValue, { color: colors.textPrimary }]}>
                        {selectedDocument.clientName}
                      </Text>
                    </View>
                  )}

                  {selectedDocument.total && (
                    <View style={styles.previewRow}>
                      <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>{t.total}:</Text>
                      <Text style={[styles.previewValue, { color: colors.textPrimary }]}>
                        {formatAmount(selectedDocument.total)}
                      </Text>
                    </View>
                  )}

                  {selectedDocument.description && (
                    <View style={styles.previewRow}>
                      <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>{t.description}:</Text>
                      <Text style={[styles.previewValue, { color: colors.textPrimary }]}>
                        {selectedDocument.description}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: colors.primary }]}
              onPress={() => setShowPreviewModal(false)}
            >
              <Text style={styles.closeButtonText}>{t.close}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* DateFilter Component */}
      <DateFilter
        visible={showDateFilter}
        onClose={() => setShowDateFilter(false)}
        onFilterChange={(filter) => {
          setDateFilter(filter);
        }}
        currentFilter={dateFilter.type}
        isDarkMode={isDarkMode}
        language={language}
      />

      {/* Client Selector Modal */}
      <ClientSelectorModal
        visible={showClientSelector}
        onClose={() => setShowClientSelector(false)}
        onSelectClient={(clientName) => setClientFilter(clientName)}
        colors={colors}
        translations={{
          filterByClient: t.filterByClient,
          searchClients: t.searchClients,
          noClients: t.noClients,
          noSearchResults: t.noSearchResults,
          clearFilter: t.clearFilter,
        }}
        clients={cachedClients || []}
        searchQuery={clientSearchQuery}
        onSearchChange={setClientSearchQuery}
        currentFilter={clientFilter}
      />

      <GlobalHeader />
    </View>
  );
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
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.body,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  headerTitle: {
    fontSize: typography.h1,
    fontWeight: 'bold',
    marginTop: spacing.sm,
  },
  headerSubtitle: {
    fontSize: typography.body,
    marginTop: spacing.xs,
  },
  filtersContainer: {
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  filtersRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  filterLabel: {
    fontSize: typography.body,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  dropdownButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  selectedIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownText: {
    fontSize: typography.body,
    fontWeight: '500',
  },
  dropdownOptions: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.md,
    ...shadows.md,
    overflow: 'hidden',
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    gap: spacing.sm,
  },
  dropdownOptionBorder: {
    borderBottomWidth: 1,
  },
  optionIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitle: {
    fontSize: typography.body,
  },
  dateFilterButton: {
    flex: 1,
  },
  dateFilterGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  dateFilterText: {
    color: 'white',
    fontSize: typography.body,
    fontWeight: '600',
  },
  clearDatesButton: {
    marginBottom: spacing.md,
  },
  clearDatesGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  clearDatesText: {
    color: 'white',
    fontSize: typography.body,
    fontWeight: '600',
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    fontSize: typography.body,
  },
  documentsContainer: {
    gap: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyText: {
    fontSize: typography.body,
    marginTop: spacing.md,
  },
  documentCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.md,
  },
  documentHeader: {
    marginBottom: spacing.md,
  },
  documentTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  documentTitleInfo: {
    flex: 1,
  },
  documentType: {
    fontSize: typography.h3,
    fontWeight: 'bold',
  },
  documentDate: {
    fontSize: typography.small,
    marginTop: spacing.xs,
  },
  documentDetails: {
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  detailText: {
    fontSize: typography.body,
  },
  documentDescription: {
    fontSize: typography.small,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  documentActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
  },
  actionButtonThree: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  actionButtonText: {
    color: 'white',
    fontSize: typography.small,
    fontWeight: '600',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    maxHeight: '80%',
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  modalTitle: {
    fontSize: typography.h2,
    fontWeight: 'bold',
  },
  modalScrollView: {
    marginBottom: spacing.lg,
  },
  previewRow: {
    marginBottom: spacing.md,
  },
  previewLabel: {
    fontSize: typography.small,
    marginBottom: spacing.xs,
  },
  previewValue: {
    fontSize: typography.body,
    fontWeight: '600',
  },
  closeButton: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  closeButtonText: {
    color: 'white',
    fontSize: typography.body,
    fontWeight: 'bold',
  },
  clientFilterInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  clientInput: {
    flex: 1,
    fontSize: typography.body,
    padding: spacing.xs,
  },
});
