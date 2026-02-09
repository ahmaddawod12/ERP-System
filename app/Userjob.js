import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  Platform,
  Modal,
  KeyboardAvoidingView,
  SafeAreaView,
  Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db, storage, doc, getDoc, setDoc, deleteDoc } from '../firebase';
import { colors as themeColors, getColors, gradients, spacing, borderRadius, typography, shadows } from '../theme';
import { TimePicker, PhotoPicker, SignaturePad, GlobalHeader, ViewJobDetails, DateFilter, ScrollableContainer, ClientSelectorModal } from '../components';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { useAlert } from '../contexts/AlertContext';
import { useCache } from '../contexts/CacheContext';
import { generateFinishedJobId, getUsernameFromEmail } from '../utils/helpers';
import { FlatList } from 'react-native';

export default function Userjob() {
  const router = useRouter();
  const { language, toggleLanguage } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const insets = useSafeAreaInsets();
  const { 
    profile, 
    inventory: cachedInventory, 
    finishedJobs: cachedFinishedJobs,
    companyFinishedJobs: cachedCompanyFinishedJobs,
    clients: cachedClients,
    getUsername,
    getCompanyName,
    getUserRole,
    updateInventory,
    addJob,
    removeJob,
    getDataForDateRange,
    isWithinCacheRange,
    fetchClients
  } = useCache();
  const colors = getColors(isDarkMode);
  const [jobs, setJobs] = useState([]);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Job form fields
  const [jobData, setJobData] = useState({
    title: '',
    timeFrom: '',
    timeTo: '',
    location: '',
    description: '',
    clientName: '',
    clientPhone: '',
    photos: [],
    signingPerson: '',
    signature: null,
  });
  const [showSignature, setShowSignature] = useState(false);
  const [showTimeFromPicker, setShowTimeFromPicker] = useState(false);
  const [showTimeToPicker, setShowTimeToPicker] = useState(false);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [inventory, setInventory] = useState([]);
  const [selectedParts, setSelectedParts] = useState([]);
  const [partsSearchQuery, setPartsSearchQuery] = useState('');
  const [hasDraft, setHasDraft] = useState(false);
  const hasInitialLoadedRef = useRef(false);
  const [draftChecked, setDraftChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingJobs, setPendingJobs] = useState(0);
  const [selectedJobDetails, setSelectedJobDetails] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [clientFilter, setClientFilter] = useState('');
  const [showClientSelector, setShowClientSelector] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
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
  
  useEffect(() => {
    console.log('showSignature state changed to:', showSignature);
  }, [showSignature]);

  useEffect(() => {
    console.log('showPhotoPicker state changed to:', showPhotoPicker);
  }, [showPhotoPicker]);

  // Network status listener
  useEffect(() => {
    let previousOnlineState = true;
    
    const unsubscribe = NetInfo.addEventListener(state => {
      const currentOnlineState = state.isConnected;
      
      // Only sync when transitioning from offline to online
      if (!previousOnlineState && currentOnlineState) {
        syncPendingJobs();
      }
      
      previousOnlineState = currentOnlineState;
      setIsOnline(currentOnlineState);
    });

    // Check for pending jobs on mount
    checkPendingJobs();

    return () => unsubscribe();
  }, []);

  const checkPendingJobs = async () => {
    try {
      const pending = await AsyncStorage.getItem('pendingJobs');
      if (pending) {
        const jobs = JSON.parse(pending);
        setPendingJobs(jobs.length);
      }
    } catch (error) {
      console.log('Error checking pending jobs:', error);
    }
  };

  const syncPendingJobs = async () => {
    try {
      const pending = await AsyncStorage.getItem('pendingJobs');
      if (!pending) return;

      const jobs = JSON.parse(pending);
      if (jobs.length === 0) return;

      setIsSyncing(true);
      console.log(`Syncing ${jobs.length} pending jobs...`);
      
      let successCount = 0;
      let failedJobs = [];

      for (let i = 0; i < jobs.length; i++) {
        const pendingJob = jobs[i];
        try {
          await submitJobToFirebase(
            pendingJob.jobData, 
            pendingJob.jobData.selectedParts || [], 
            pendingJob.editingJob
          );
          console.log(`Synced job: ${pendingJob.jobData.title}`);
          successCount++;
        } catch (error) {
          console.log(`Failed to sync job ${pendingJob.jobData.title}:`, error);
          failedJobs.push(pendingJob);
        }
      }

      // Update pending jobs with only failed ones
      if (failedJobs.length > 0) {
        await AsyncStorage.setItem('pendingJobs', JSON.stringify(failedJobs));
        setPendingJobs(failedJobs.length);
        alert.error(t.syncError, `${successCount} ${language === 'en' ? 'jobs synced,' : language === 'he' ? 'משימות סונכרנו,' : 'مهام متزامنة،'} ${failedJobs.length} ${language === 'en' ? 'failed' : language === 'he' ? 'נכשלו' : 'فشل'}`);
      } else {
        await AsyncStorage.removeItem('pendingJobs');
        setPendingJobs(0);
        alert.success(language === 'en' ? 'Sync Complete' : language === 'he' ? 'סנכרון הושלם' : 'اكتمل التزامن', t.syncSuccess);
      }
      
      // Reload jobs
      loadJobs();
      loadInventory();
    } catch (error) {
      console.log('Error syncing pending jobs:', error);
    } finally {
      setIsSyncing(false);
    }
  };


  const t = language === 'en' ? {
    title: 'My Jobs',
    subtitle: 'Create and manage your jobs',
    back: 'Back',
    createJob: 'Create New Job',
    editJob: 'Edit Job',
    noJobs: 'No jobs yet',
    jobTitle: 'Job Title',
    timeWorked: 'Time Worked',
    from: 'From (HH:MM)',
    to: 'To (HH:MM)',
    location: 'Job Location',
    locationPlaceholder: 'Enter address or location',
    getLocation: 'Get Current Location',
    clientName: 'Client Name',
    clientNamePlaceholder: 'Enter client name',
    clientPhone: 'Client Phone',
    clientPhonePlaceholder: 'Enter client phone number',
    jobDescription: 'Job Description',
    descriptionPlaceholder: 'Describe what you did...',
    photos: 'Photos',
    addPhoto: 'Add Photo',
    takePhoto: 'Take Photo',
    chooseFromGallery: 'Choose from Gallery',
    signingPerson: 'Signing Person',
    signingPersonPlaceholder: 'Enter name of person signing',
    clientSignature: 'Client Signature',
    addSignature: 'Add Signature',
    clearSignature: 'Clear Signature',
    submit: 'Submit Job',
    submitting: 'Submitting...',
    cancel: 'Cancel',
    continueLater: 'Later',
    delete: 'Delete',
    edit: 'Edit',
    success: 'Job saved successfully!',
    fillAllFields: 'Please fill all required fields',
    confirmDelete: 'Are you sure you want to delete this job?',
    draftFound: 'Draft Found',
    draftFoundMessage: 'You have an unsaved draft. Would you like to continue working on it?',
    continueWithDraft: 'Continue',
    discardDraft: 'Discard',
    unsavedChanges: 'Unsaved Changes',
    unsavedChangesMessage: 'You have unsaved changes. Do you want to save as draft before closing?',
    saveDraft: 'Save Draft',
    discardChanges: 'Discard',
    draftSaved: 'Draft saved successfully!',
    offlineMode: 'Offline Mode',
    offlineMessage: 'No internet connection. Jobs will be saved and submitted when connection is restored.',
    pendingJobs: 'Pending Jobs',
    syncNow: 'Sync Now',
    syncSuccess: 'Successfully synced pending jobs!',
    syncError: 'Some jobs failed to sync. They will be retried later.',
    partsUsed: 'Parts Used',
    selectParts: 'Select Parts',
    addParts: 'Add Parts',
    noParts: 'No parts available in inventory',
    travelDistance: 'Travel Distance',
    km: 'km',
    quantity: 'Quantity',
    partName: 'Part Name',
    available: 'Available',
    remove: 'Remove',
    done: 'Done',
    insufficientStock: 'Insufficient Stock',
    notEnoughParts: 'Not enough parts in inventory',
    filterByDate: 'Filter by Date',
    filterByClient: 'Filter by Client',
    clearFilter: 'Clear Filter',
    searchClients: 'Search clients...',
    noClients: 'No clients found',
    noSearchResults: 'No clients match your search',
    showingJobsFrom: 'Showing jobs from',
    close: 'Close',
    jobDetails: 'Job Details',
    createdAt: 'Created At',
    finishedAt: 'Finished At',
    status: 'Status',
    noPhotos: 'No photos',
    noSignature: 'No signature',
    worker: 'Worker',
  } : language === 'he' ? {
    title: 'המשימות שלי',
    subtitle: 'יצירה וניהול משימות',
    back: 'חזרה',
    createJob: 'יצירת משימה חדשה',
    editJob: 'עריכת משימה',
    noJobs: 'אין משימות עדיין',
    jobTitle: 'כותרת משימה',
    timeWorked: 'שעות עבודה',
    from: 'מ (HH:MM)',
    to: 'עד (HH:MM)',
    location: 'מיקום העבודה',
    locationPlaceholder: 'הזן כתובת או מיקום',
    getLocation: 'קבל מיקום נוכחי',
    clientName: 'שם הלקוח',
    clientNamePlaceholder: 'הזן שם לקוח',
    clientPhone: 'טלפון לקוח',
    clientPhonePlaceholder: 'הזן מספר טלפון לקוח',
    jobDescription: 'תיאור העבודה',
    descriptionPlaceholder: 'תאר מה עשית...',
    photos: 'תמונות',
    addPhoto: 'הוסף תמונה',
    takePhoto: 'צלם תמונה',
    chooseFromGallery: 'בחר מהגלריה',
    signingPerson: 'שם החותם',
    signingPersonPlaceholder: 'הזן שם של האדם החותם',
    clientSignature: 'חתימת הלקוח',
    addSignature: 'הוסף חתימה',
    clearSignature: 'נקה חתימה',
    submit: 'שלח משימה',
    submitting: 'שולח...',
    cancel: 'ביטול',
    continueLater: 'המשך מאוחר יותר',
    delete: 'מחק',
    edit: 'ערוך',
    success: 'המשימה נשמרה בהצלחה!',
    fillAllFields: 'אנא מלא את כל השדות הנדרשים',
    confirmDelete: 'האם אתה בטוח שברצונך למחוק משימה זו?',
    draftFound: 'נמצא טיוטה',
    draftFoundMessage: 'יש לך טיוטה שלא נשמרה. האם תרצה להמשיך לעבוד עליה?',
    continueWithDraft: 'המשך',
    discardDraft: 'מחק',
    unsavedChanges: 'שינויים שלא נשמרו',
    unsavedChangesMessage: 'יש לך שינויים שלא נשמרו. האם תרצה לשמור כטיוטה לפני הסגירה?',
    saveDraft: 'שמור טיוטה',
    discardChanges: 'מחק שינויים',
    draftSaved: 'הטיוטה נשמרה בהצלחה!',
    offlineMode: 'מצב לא מקוון',
    offlineMessage: 'אין חיבור לאינטרנט. המשימות ישמרו וישלחו כאשר החיבור יחזור.',
    pendingJobs: 'משימות ממתינות',
    syncNow: 'סנכרן עכשיו',
    syncSuccess: 'המשימות הממתינות סונכרנו בהצלחה!',
    syncError: 'חלק מהמשימות נכשלו בסנכרון. הן ינסו שוב מאוחר יותר.',
    partsUsed: 'חלקים בשימוש',
    selectParts: 'בחר חלקים',
    addParts: 'הוסף חלקים',
    noParts: 'אין חלקים זמינים במלאי',
    travelDistance: 'מרחק נסיעה',
    km: 'ק"מ',
    quantity: 'כמות',
    partName: 'שם החלק',
    available: 'זמין',
    remove: 'הסר',
    done: 'סיום',
    insufficientStock: 'אין מספיק מלאי',
    notEnoughParts: 'אין מספיק חלקים במלאי',
    filterByDate: 'סינון לפי תאריך',
    filterByClient: 'סינון לפי לקוח',
    clearFilter: 'נקה סינון',
    searchClients: 'חפש לקוחות...',
    noClients: 'לא נמצאו לקוחות',
    noSearchResults: 'לא נמצאו לקוחות התואמים לחיפוש',
    showingJobsFrom: 'מציג משימות מ',
    close: 'סגור',
    jobDetails: 'פרטי משימה',
    createdAt: 'נוצר ב',
    finishedAt: 'הושלם ב',
    status: 'סטטוס',
    noPhotos: 'אין תמונות',
    noSignature: 'אין חתימה',
    worker: 'עובד',
  } : {
    title: 'مهامي',
    subtitle: 'إنشاء وإدارة مهامك',
    back: 'رجوع',
    createJob: 'إنشاء مهمة جديدة',
    editJob: 'تعديل المهمة',
    noJobs: 'لا توجد مهام بعد',
    jobTitle: 'عنوان المهمة',
    timeWorked: 'وقت العمل',
    from: 'من (HH:MM)',
    to: 'إلى (HH:MM)',
    location: 'موقع العمل',
    locationPlaceholder: 'أدخل العنوان أو الموقع',
    getLocation: 'احصل على الموقع الحالي',
    clientName: 'اسم العميل',
    clientNamePlaceholder: 'أدخل اسم العميل',
    clientPhone: 'هاتف العميل',
    clientPhonePlaceholder: 'أدخل رقم هاتف العميل',
    jobDescription: 'وصف العمل',
    descriptionPlaceholder: 'صف ما قمت به...',
    photos: 'الصور',
    addPhoto: 'إضافة صورة',
    takePhoto: 'التقاط صورة',
    chooseFromGallery: 'اختر من المعرض',
    signingPerson: 'اسم الموقع',
    signingPersonPlaceholder: 'أدخل اسم الشخص الموقع',
    clientSignature: 'توقيع العميل',
    addSignature: 'إضافة توقيع',
    clearSignature: 'مسح التوقيع',
    submit: 'تقديم المهمة',
    submitting: 'جاري التقديم...',
    cancel: 'إلغاء',
    continueLater: 'لاحقاً',
    delete: 'حذف',
    edit: 'تعديل',
    success: 'تم حفظ المهمة بنجاح!',
    fillAllFields: 'يرجى ملء جميع الحقول المطلوبة',
    confirmDelete: 'هل أنت متأكد من حذف هذه المهمة؟',
    draftFound: 'تم العثور على مسودة',
    draftFoundMessage: 'لديك مسودة غير محفوظة. هل تريد متابعة العمل عليها؟',
    continueWithDraft: 'متابعة',
    discardDraft: 'تجاهل',
    unsavedChanges: 'تغييرات غير محفوظة',
    unsavedChangesMessage: 'لديك تغييرات غير محفوظة. هل تريد حفظها كمسودة قبل الإغلاق؟',
    saveDraft: 'حفظ المسودة',
    discardChanges: 'تجاهل',
    draftSaved: 'تم حفظ المسودة بنجاح!',
    offlineMode: 'وضع عدم الاتصال',
    offlineMessage: 'لا يوجد اتصال بالإنترنت. سيتم حفظ المهام وإرسالها عند استعادة الاتصال.',
    pendingJobs: 'المهام المعلقة',
    syncNow: 'مزامنة الآن',
    syncSuccess: 'تم مزامنة المهام المعلقة بنجاح!',
    syncError: 'فشلت بعض المهام في المزامنة. سيتم المحاولة مرة أخرى لاحقاً.',
    partsUsed: 'القطع المستخدمة',
    selectParts: 'اختر القطع',
    addParts: 'إضافة قطع',
    noParts: 'لا توجد قطع متاحة في المخزون',
    travelDistance: 'مسافة السفر',
    km: 'كم',
    quantity: 'الكمية',
    partName: 'اسم القطعة',
    available: 'متاح',
    remove: 'إزالة',
    done: 'تم',
    insufficientStock: 'مخزون غير كافٍ',
    notEnoughParts: 'لا توجد قطع كافية في المخزون',
    filterByDate: 'تصفية حسب التاريخ',
    filterByClient: 'تصفية حسب العميل',
    clearFilter: 'مسح التصفية',
    searchClients: 'البحث عن العملاء...',
    noClients: 'لم يتم العثور على عملاء',
    noSearchResults: 'لا يوجد عملاء مطابقين للبحث',
    showingJobsFrom: 'عرض المهام من',
    close: 'إغلاق',
    jobDetails: 'تفاصيل المهمة',
    createdAt: 'أنشئت في',
    finishedAt: 'انتهت في',
    status: 'الحالة',
    noPhotos: 'لا توجد صور',
    noSignature: 'لا يوجد توقيع',
    worker: 'عامل',
  };

  const isJobNew = (job) => {
    if (!job.finishedAt && !job.createdAt) return false;
    const jobDate = new Date(job.finishedAt || job.createdAt);
    const now = new Date();
    const hoursDiff = (now - jobDate) / (1000 * 60 * 60);
    return hoursDiff <= 24;
  };

  // Check if job can be edited (NOT if 7 days passed OR has certification)
  const canEditJob = (job) => {
    // If job has certification, it cannot be edited
    if (job.isCert === true) {
      return false;
    }

    // Check if 7 days have passed since finishedAt
    if (job.finishedAt) {
      const finishedDate = job.finishedAt.toDate ? job.finishedAt.toDate() : new Date(job.finishedAt);
      const now = new Date();
      const daysDiff = (now - finishedDate) / (1000 * 60 * 60 * 24);
      
      if (daysDiff > 7) {
        return false;
      }
    }

    return true;
  };

  // Check if job can be deleted (NOT if has certification)
  const canDeleteJob = (job) => {
    return job.isCert !== true;
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'pending': return '#f59e0b';
      case 'received': return '#3b82f6';
      case 'waiting': return '#8b5cf6';
      case 'finished': return '#10b981';
      default: return '#6b7280';
    }
  };

  // Upload a single file (photo or signature) to Firebase Storage
  const uploadFileToStorage = async (uri, username, jobId, fileName) => {
    try {
      // Skip upload if it's already a Firebase Storage URL
      if (uri.startsWith('https://firebasestorage.googleapis.com') || 
          uri.startsWith('https://storage.googleapis.com')) {
        return uri;
      }
      
      // Upload file to Storage (works for both photos and signature files)
      const storageRef = storage().ref(`${username}/jobs/${jobId}/${fileName}`);
      const response = await fetch(uri);
      const blob = await response.blob();
      
      try {
        await storageRef.put(blob);
        const downloadURL = await storageRef.getDownloadURL();
        console.log('Upload complete:', downloadURL);
        return downloadURL;
      } catch (error) {
        console.error('Upload error:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  };

  // Upload all photos and signature to Storage and return URLs
  const uploadJobFiles = async (username, jobId, photos, signature) => {
    const photoURLs = [];
    let signatureURL = null;

    // Upload photos
    for (let i = 0; i < photos.length; i++) {
      const photoURL = await uploadFileToStorage(photos[i], username, jobId, `photo_${i + 1}.jpg`);
      photoURLs.push(photoURL);
    }

    // Upload signature
    if (signature) {
      signatureURL = await uploadFileToStorage(signature, username, jobId, 'signature.png');
    }

    return { photoURLs, signatureURL };
  };

  // Fetch clients from Firestore on mount
  useEffect(() => {
    const companyName = getCompanyName();
    if (companyName && fetchClients) {
      fetchClients(companyName);
    }
  }, [getCompanyName, fetchClients]);

  useEffect(() => {
    const initializeData = async () => {
      await loadInventory();
      await checkForDraft();
      await loadJobs();
      
      hasInitialLoadedRef.current = true;
    };
    
    initializeData();
  }, [dateFilter, clientFilter]); // Re-run when date or client filter changes

  // Watch for cached jobs changes and update UI
  useEffect(() => {
    // Skip initial load (wait for initializeData to complete)
    if (!hasInitialLoadedRef.current) return;
    
    const role = getUserRole();
    const jobsToWatch = role === 'manager' ? cachedCompanyFinishedJobs : cachedFinishedJobs;
    const currentCacheCount = jobsToWatch?.length || 0;
    
    console.log('📦 Userjob: Cache updated - cache count:', currentCacheCount);
    
    // Always reload when cache changes (let React handle if it's the same)
    loadJobs();
  }, [cachedFinishedJobs, cachedCompanyFinishedJobs, loadJobs, getUserRole]); // Re-load when cache updates

  // Watch for cached inventory changes and re-sync local state
  useEffect(() => {
    if (!hasInitialLoadedRef.current) return;
    
    console.log('📦 Userjob: cached inventory updated - re-syncing local inventory');
    loadInventory();
  }, [cachedInventory]); // Re-load when inventory cache updates

  const checkForDraft = async () => {
    try {
      const draft = await AsyncStorage.getItem('userjobDraft');
      if (draft) {
        const parsed = JSON.parse(draft);
        // Check if draft has meaningful content
        if (parsed.jobData && (parsed.jobData.title || parsed.jobData.description || 
            parsed.jobData.photos?.length > 0 || parsed.selectedParts?.length > 0)) {
          setHasDraft(true);
          // Show alert to user
          alert.confirm(
            t.draftFound,
            t.draftFoundMessage,
            [
              {
                text: t.discardDraft,
                style: 'destructive',
                onPress: async () => {
                  await AsyncStorage.removeItem('userjobDraft');
                  setHasDraft(false);
                  setDraftChecked(true);
                }
              },
              {
                text: t.cancel || 'Cancel',
                style: 'cancel',
                onPress: () => {
                  setDraftChecked(true);
                }
              },
              {
                text: t.continueWithDraft,
                style: 'default',
                onPress: async () => {
                  setHasDraft(false);
                  // Don't remove from AsyncStorage yet - let auto-save handle it
                  // or wait until submit/discard
                  loadDraftData(parsed);
                  setShowCreateJob(true);
                  setDraftChecked(true);
                }
              }
            ]
          );
          return;
        }
      }
      setDraftChecked(true);
    } catch (error) {
      console.error('Error checking for draft:', error);
      setDraftChecked(true);
    }
  };

  const loadDraftData = (parsed) => {
    setJobData(parsed.jobData || {
      title: '',
      timeFrom: '',
      timeTo: '',
      location: '',
      description: '',
      clientName: '',
      clientPhone: '',
      photos: [],
      signature: null,
    });
    setSelectedParts(parsed.selectedParts || []);
    console.log('Draft loaded successfully');
  };

  // Auto-save draft whenever data changes (only when modal is open and creating NEW job)
  useEffect(() => {
    if (showCreateJob && draftChecked && !editingJob) {
      // Only save if there's actual data and NOT editing an existing job
      if (jobData.title || jobData.description || jobData.photos.length > 0 || selectedParts.length > 0) {
        const timeoutId = setTimeout(() => {
          saveDraft();
        }, 1000); // Debounce for 1 second
        return () => clearTimeout(timeoutId);
      }
    }
  }, [jobData, selectedParts, showCreateJob, draftChecked, editingJob]);

  const saveDraft = async (showAlert = false) => {
    try {
      const draft = {
        jobData,
        selectedParts,
        savedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem('userjobDraft', JSON.stringify(draft));
      console.log('Draft auto-saved');
      if (showAlert) {
        alert.success('Success', t.draftSaved);
      }
    } catch (error) {
      console.error('Error saving draft:', error);
      if (showAlert) {
        alert.error('Error', 'Failed to save draft');
      }
    }
  };

  const handleContinueLater = async () => {
    await saveDraft(true);
    setShowCreateJob(false);
    setEditingJob(null);
  };

  const hasUnsavedChanges = () => {
    return jobData.title || jobData.description || jobData.photos.length > 0 || 
           jobData.timeFrom || jobData.timeTo || jobData.location || selectedParts.length > 0;
  };

  const handleModalClose = () => {
    if (hasUnsavedChanges() && !editingJob) {
      // Close modal first to prevent iOS freeze
      setShowCreateJob(false);
      
      // Show alert after modal closes
      setTimeout(() => {
        alert.confirm(
          t.unsavedChanges,
          t.unsavedChangesMessage,
          [
            {
              text: t.discardChanges,
              style: 'destructive',
              onPress: async () => {
                await AsyncStorage.removeItem('userjobDraft');
                setHasDraft(false);
                setEditingJob(null);
                resetForm();
              }
            },
            {
              text: t.saveDraft,
              onPress: async () => {
                await saveDraft(true);
                setHasDraft(true);
                setEditingJob(null);
              }
            },
            {
              text: t.cancel,
              style: 'cancel',
              onPress: () => {
                // Reopen modal if user cancels
                setShowCreateJob(true);
              }
            }
          ]
        );
      }, 300);
    } else {
      setShowCreateJob(false);
      setEditingJob(null);
      resetForm();
    }
  };

  const resetForm = () => {
    setJobData({
      title: '',
      timeFrom: '',
      timeTo: '',
      location: '',
      description: '',
      clientName: '',
      clientPhone: '',
      photos: [],
      signature: null,
    });
    setSelectedParts([]);
  };

  const loadJobs = useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user || !user.email) {
        console.log('No authenticated user, skipping jobs load');
        setLoading(false);
        return;
      }

      const username = getUsername();
      const companyName = getCompanyName();
      const role = getUserRole();
      
      console.log('🔍 Userjob loadJobs - username:', username, 'role:', role, 'companyName:', companyName);
      
      const jobsCacheToUse = role === 'manager' ? cachedCompanyFinishedJobs : cachedFinishedJobs;
      console.log(`🔍 Userjob loadJobs - using ${role === 'manager' ? 'companyFinishedJobs' : 'finishedJobs'}:`, jobsCacheToUse?.length || 0, 'jobs');
      
      if (!companyName) {
        console.log('User does not belong to a company');
        setJobs([]);
        setLoading(false);
        return;
      }
      
      // Check if date filter exceeds 90 days (need to fetch from Firebase directly)
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
      
      if (dateFilter.startDate < ninetyDaysAgo) {
        // Fetch older jobs using smart date range filtering from CacheContext
        console.log('� [FIREBASE READ] Fetching older jobs from Firebase (beyond 90 days)');
        const olderJobs = await getDataForDateRange(dateFilter.startDate, dateFilter.endDate, 'finishedJobs');
        
        // Filter by completedBy for role user
        const filteredJobs = olderJobs.filter(job => 
          job.completedBy === username
        );
        
        // Sort by finishedAt descending
        filteredJobs.sort((a, b) => {
          const dateA = new Date(a.finishedAt);
          const dateB = new Date(b.finishedAt);
          return dateB - dateA;
        });
        
        setJobs(filteredJobs);
        setLoading(false);
        return;
      }
      
      // Use cached finished jobs for recent data
      let jobsList = [];
      
      if (role === 'manager') {
        // For manager role, filter companyFinishedJobs by completedBy (manager's own jobs only)
        jobsList = (cachedCompanyFinishedJobs || []).filter(job => 
          job.completedBy === username
        );
        console.log('📦 [CACHE READ] Manager role: filtered cachedCompanyFinishedJobs by completedBy:', username, ', count:', jobsList.length);
      } else if (role === 'user') {
        // For user role, use cached finishedJobs (own jobs only)
        jobsList = cachedFinishedJobs || [];
        console.log('📦 [CACHE READ] User role: using cachedFinishedJobs, count:', jobsList.length);
      } else {
        // For worker role, filter finishedJobs by completedBy
        jobsList = (cachedFinishedJobs || []).filter(job => 
          job.completedBy === username
        );
        console.log('📦 [CACHE READ] Worker role: filtered finishedJobs by completedBy, count:', jobsList.length);
      }
      
      // Apply date filter
      const beforeFilter = jobsList.length;
      jobsList = jobsList.filter(job => {
        const jobDate = new Date(job.finishedAt);
        return jobDate >= dateFilter.startDate && jobDate <= dateFilter.endDate;
      });
      console.log('📅 After date filter: before=', beforeFilter, 'after=', jobsList.length);
      
      // Apply client filter
      if (clientFilter.trim()) {
        const query = clientFilter.toLowerCase();
        const beforeClientFilter = jobsList.length;
        
        // Debug: Log first job's client-related fields
        if (jobsList.length > 0) {
          console.log('🔍 First job fields:', {
            clientName: jobsList[0].clientName,
            signingPerson: jobsList[0].signingPerson,
            customer: jobsList[0].customer,
            allKeys: Object.keys(jobsList[0])
          });
        }
        
        jobsList = jobsList.filter(job => {
          const matchesClientName = job.clientName && job.clientName.toLowerCase().includes(query);
          const matchesSigningPerson = job.signingPerson && job.signingPerson.toLowerCase().includes(query);
          const matchesCustomer = job.customer && job.customer.toLowerCase().includes(query);
          
          return matchesClientName || matchesSigningPerson || matchesCustomer;
        });
        
        console.log('👤 Client filter applied: query="' + query + '", before=' + beforeClientFilter + ', after=' + jobsList.length);
      }
      
      // Sort by finishedAt descending
      jobsList.sort((a, b) => {
        const dateA = new Date(a.finishedAt);
        const dateB = new Date(b.finishedAt);
        return dateB - dateA;
      });
      
      console.log('✅ Setting jobs state with', jobsList.length, 'jobs');
      setJobs(jobsList);
      setLoading(false);
    } catch (error) {
      if (auth.currentUser) {
        console.error('Error loading jobs:', error);
      }
      setLoading(false);
    }
  }, [cachedFinishedJobs, cachedCompanyFinishedJobs, dateFilter, clientFilter, getUsername, getCompanyName, getUserRole, getDataForDateRange, isWithinCacheRange]);

  const loadInventory = useCallback(async () => {
    try {
      // Use cached inventory from CacheContext (cachedInventory is an array)
      if (cachedInventory && Array.isArray(cachedInventory)) {
        console.log('📦 [CACHE READ] Loading inventory from cache:', cachedInventory.length, 'parts');
        setInventory(cachedInventory);
      } else {
        setInventory([]);
      }
    } catch (error) {
      console.error('Error loading inventory:', error);
      setInventory([]);
    }
  }, [cachedInventory]);

  const handleAddPartToJob = (part) => {
    console.log('=== handleAddPartToJob called ===');
    console.log('Part to add:', JSON.stringify(part));
    console.log('Current inventory length:', inventory.length);
    console.log('Current selectedParts length:', selectedParts.length);
    
    const existing = selectedParts.find(p => p.id === part.id);
    if (existing) {
      console.log('Part already exists in selectedParts');
      alert.warning('Already Added', 'This part is already in the list');
      return;
    }
    
    // Use functional update to avoid closure issues
    setSelectedParts(prevParts => {
      const newParts = [...prevParts, { ...part, usedQuantity: 1 }];
      console.log('Setting new selectedParts length:', newParts.length);
      return newParts;
    });
  };

  const handleRemovePartFromJob = (partId) => {
    console.log('Removing part:', partId);
    setSelectedParts(prevParts => prevParts.filter(p => p.id !== partId));
  };

  const handlePartQuantityChange = (partId, quantity) => {
    const numQuantity = parseInt(quantity) || 0;
    console.log('Changing quantity for part:', partId, 'to:', numQuantity);
    setSelectedParts(prevParts =>
      prevParts.map(p => 
        p.id === partId ? { ...p, usedQuantity: numQuantity } : p
      )
    );
  };

  const validatePartsStock = () => {
    const insufficientParts = [];
    for (const part of selectedParts) {
      const inventoryPart = inventory.find(p => p.id === part.id);
      if (!inventoryPart || inventoryPart.quantity < part.usedQuantity) {
        insufficientParts.push(part.name);
      }
    }
    return insufficientParts;
  };

  const decreaseInventoryParts = async (username) => {
    try {
      if (!selectedParts || selectedParts.length === 0) {
        console.log('No parts to deduct from inventory');
        return;
      }

      console.log('📦 [INVENTORY] Userjob - Deducting parts from inventory...');
      
      // Use cached inventory if available (cachedInventory is an array)
      let partsArray = cachedInventory ? [...cachedInventory] : [];
      
      // If cache is empty, fetch from Firebase as fallback
      if (partsArray.length === 0) {
        console.warn('⚠️ Cached inventory is empty, fetching from Firebase...');
        const inventoryRef = doc(db, username, 'inventory');
        const inventorySnap = await getDoc(inventoryRef);
        if (inventorySnap.exists()) {
          const inventoryDoc = inventorySnap.data();
          partsArray = inventoryDoc.parts || [];
        }
      }
      
      // Update each part quantity in the array
      selectedParts.forEach(usedPart => {
        const partIndex = partsArray.findIndex(p => p.id === usedPart.id);
        if (partIndex !== -1) {
          const currentQty = parseInt(partsArray[partIndex].quantity) || 0;
          const usedQty = parseInt(usedPart.usedQuantity) || 0;
          const newQty = Math.max(0, currentQty - usedQty);
          
          partsArray[partIndex] = {
            ...partsArray[partIndex],
            quantity: newQty
          };
          console.log(`📦 Deducting ${usedQty} of ${partsArray[partIndex].name} from inventory. New qty: ${newQty}`);
        }
      });
      
      // 1. Update local cache FIRST (this also increments cache version)
      await updateInventory(partsArray);
      console.log('✅ [INVENTORY] Userjob - Local cache updated');
      
      // 2. Then save to Firestore - inventory is a document with 'parts' field (array)
      const inventoryDocRef = doc(db, username, 'inventory');
      await setDoc(inventoryDocRef, {
        parts: partsArray,
        lastUpdated: new Date().toISOString()
      }, { merge: true });
      
      console.log('✅ [INVENTORY] Userjob - Inventory deducted to Firebase');
    } catch (error) {
      console.error('❌ Error decreasing inventory:', error);
      throw error;
    }
  };

  const handleGetLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        alert.error('Permission denied', 'Location permission is required');
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      const address = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      if (address[0]) {
        const formattedAddress = `${address[0].street || ''}, ${address[0].city || ''}, ${address[0].region || ''}`;
        setJobData({ ...jobData, location: formattedAddress });
      }
    } catch (error) {
      console.error('Error getting location:', error);
      alert.error('Error', 'Failed to get location');
    }
  };

  const handleAddPhoto = () => {
    console.log('handleAddPhoto called - opening photo picker');
    setShowPhotoPicker(true);
  };

  const handlePhotosSelected = (photos) => {
    setJobData({
      ...jobData,
      photos: photos,
    });
  };

  const handleSignature = (signature) => {
    setJobData({ ...jobData, signature });
    setShowSignature(false);
  };

  const handleSubmit = async () => {
    if (submitting) {
      return; // Prevent multiple submissions
    }

    if (!jobData.title || !jobData.timeFrom || !jobData.timeTo || !jobData.location || !jobData.description || !jobData.clientName || !jobData.signingPerson) {
      alert.error('Error', t.fillAllFields);
      return;
    }

    // Validate time: end time must be after start time
    const [startHour, startMin] = jobData.timeFrom.split(':').map(Number);
    const [endHour, endMin] = jobData.timeTo.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    
    if (endMinutes <= startMinutes) {
      alert.error(
        'Error',
        language === 'en' 
          ? 'End time must be after start time' 
          : language === 'he'
          ? 'זמן סיום חייב להיות אחרי זמן התחלה'
          : 'يجب أن يكون وقت الانتهاء بعد وقت البدء'
      );
      return;
    }

    if (jobData.photos.length === 0) {
      alert.error('Error', language === 'en' ? 'Please add at least one photo' : 'אנא הוסף לפחות תמונה אחת');
      return;
    }

    if (!jobData.signature) {
      alert.error('Error', language === 'en' ? 'Please add client signature' : 'אנא הוסף חתימת לקוח');
      return;
    }

    // Validate parts stock
    const insufficientParts = validatePartsStock();
    if (insufficientParts.length > 0) {
      alert.error(
        t.insufficientStock,
        `${t.notEnoughParts}:\n${insufficientParts.join('\n')}`
      );
      return;
    }

    // Check if offline
    if (!isOnline) {
      try {
        // Save job to pending queue
        const existingPending = await AsyncStorage.getItem('pendingJobs');
        const pendingJobs = existingPending ? JSON.parse(existingPending) : [];
        
        const user = auth.currentUser;
        const username = getUsernameFromEmail(user.email);
        const jobId = editingJob?.id || generateFinishedJobId();
        
        pendingJobs.push({
          id: jobId,
          username,
          jobData: {
            ...jobData,
            selectedParts: selectedParts.map(part => ({
              id: part.id,
              name: part.name,
              usedQuantity: part.usedQuantity
            })),
          },
          editingJob,
          timestamp: Date.now(),
        });
        
        await AsyncStorage.setItem('pendingJobs', JSON.stringify(pendingJobs));
        setPendingJobs(pendingJobs.length);
        
        alert.info(t.offlineMode, t.offlineMessage);
        
        // Clear form and draft
        await AsyncStorage.removeItem('userjobDraft');
        setHasDraft(false);
        setShowCreateJob(false);
        setEditingJob(null);
        resetForm();
      } catch (error) {
        console.error('Error saving pending job:', error);
        alert.error('Error', 'Failed to save job for later submission');
      }
      return;
    }

    // Online - submit normally
    setSubmitting(true);
    alert.loading(
      language === 'en' ? 'Submitting Job' : language === 'he' ? 'שולח משימה' : 'إرسال المهمة',
      language === 'en' ? 'Please wait while we save your job...' : 
      language === 'he' ? 'אנא המתן בזמן שאנו שומרים את המשימה שלך...' : 
      'يرجى الانتظار بينما نحفظ مهمتك...'
    );
    try {
      await submitJobToFirebase(jobData, selectedParts, editingJob);
      
      alert.hideLoading();
      
      // Close modal first to prevent iOS freeze
      setShowCreateJob(false);
      setEditingJob(null);
      resetForm();
      loadJobs();
      loadInventory();
      
      // Show success alert after modal closes
      setTimeout(() => {
        alert.success('Success', t.success);
      }, 300);
    } catch (error) {
      console.error('Error saving job:', error);
      alert.hideLoading();
      alert.error('Error', 'Failed to save job');
    } finally {
      setSubmitting(false);
    }
  };

  // Extract Firebase submission logic
  const submitJobToFirebase = async (jobData, selectedParts, editingJob = null) => {
      const user = auth.currentUser;
      const username = getUsername() || getUsernameFromEmail(user.email);
      const jobId = editingJob?.id || generateFinishedJobId();
      
      // Get current date
      const currentDate = new Date();

      // Get company name from cache
      const companyName = getCompanyName();
      
      if (!companyName) {
        throw new Error('User does not belong to a company');
      }

      // Upload photos and signature to Firebase Storage
      const { photoURLs, signatureURL } = await uploadJobFiles(
        username,
        jobId,
        jobData.photos,
        jobData.signature
      );

      const jobToSave = {
        id: jobId,
        title: jobData.title,
        timeFrom: jobData.timeFrom,
        timeTo: jobData.timeTo,
        location: jobData.location,
        description: jobData.description,
        clientName: jobData.clientName || '',
        clientPhone: jobData.clientPhone || '',
        signingPerson: jobData.signingPerson || '',
        photos: photoURLs, // Store URLs instead of base64
        signature: signatureURL, // Store URL instead of base64
        status: 'finished',
        completedBy: username, // Add completedBy field for querying
        name: profile?.name || '',
        finishedAt: currentDate.toISOString(),
        updatedAt: currentDate.toISOString(),
        partsUsed: selectedParts.map(part => ({
          id: part.id,
          name: part.name,
          quantity: part.usedQuantity
        })),
      };

      // STEP 1: Update local cache FIRST (prevents unnecessary Firebase read when snapshot fires)
      await addJob(jobToSave, false); // false = not pending, it's finished

      // STEP 2: Save to company's finishedJobs (Firestore)
      await setDoc(doc(db, 'companies', companyName, 'finishedJobs', jobId), jobToSave);

      // Decrease inventory parts
      if (selectedParts.length > 0) {
        await decreaseInventoryParts(username);
      }

      // Clear the draft after successful submission
      await AsyncStorage.removeItem('userjobDraft');
      setHasDraft(false);
  };

  const handleEditJob = (job) => {
    // Check if job can be edited
    if (!canEditJob(job)) {
      let message = '';
      if (job.isCert === true) {
        message = language === 'en' 
          ? 'This job has a tax certificate and cannot be edited.'
          : language === 'he'
          ? 'למשימה זו יש אישור מס ולא ניתן לערוך אותה.'
          : 'هذه المهمة لها شهادة ضريبية ولا يمكن تعديلها.';
      } else {
        message = language === 'en'
          ? 'This job is older than 7 days and cannot be edited.'
          : language === 'he'
          ? 'משימה זו ישנה מ-7 ימים ולא ניתן לערוך אותה.'
          : 'هذه المهمة أقدم من 7 أيام ولا يمكن تعديلها.';
      }
      
      alert.warning(
        language === 'en' ? 'Cannot Edit Job' : language === 'he' ? 'לא ניתן לערוך משימה' : 'لا يمكن تعديل المهمة',
        message
      );
      return;
    }

    // Clear any existing draft when editing a submitted job
    AsyncStorage.removeItem('userjobDraft').catch(err => console.log('Error clearing draft:', err));
    
    // Navigate to FillJob page with job data
    router.push({
      pathname: '/FillJob',
      params: { 
        mode: 'user',
        job: JSON.stringify({
          id: job.id,
          title: job.title || '',
          timeFrom: job.timeFrom || '',
          timeTo: job.timeTo || '',
          location: job.location || '',
          description: job.description || '',
          clientName: job.clientName || job.customerName || '',
          clientPhone: job.clientPhone || job.customerPhone || '',
          signingPerson: job.signingPerson || '',
          photos: job.photos || [],
          signature: job.signature || null,
          partsUsed: job.partsUsed || [],
        })
      }
    });
  };
  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate?.() || new Date(timestamp);
    return date.toLocaleDateString();
  };
  const handleDeleteJob = async (jobId) => {
    // Find the job to check if it can be deleted
    const job = jobs.find(j => j.id === jobId);
    if (job && !canDeleteJob(job)) {
      const message = language === 'en'
        ? 'This job has a tax certificate and cannot be deleted.'
        : language === 'he'
        ? 'למשימה זו יש אישור מס ולא ניתן למחוק אותה.'
        : 'هذه المهمة لها شهادة ضريبية ولا يمكن حذفها.';
      
      alert.warning(
        language === 'en' ? 'Cannot Delete Job' : language === 'he' ? 'לא ניתן למחוק משימה' : 'لا يمكن حذف المهمة',
        message
      );
      return;
    }

    alert.confirm(
      'Confirm Delete',
      t.confirmDelete,
      [
        { text: t.cancel, style: 'cancel', onPress: () => {} },
        {
          text: t.delete,
          style: 'destructive',
          onPress: async () => {
            try {
              const user = auth.currentUser;
              const username = getUsernameFromEmail(user.email);
              
              // Delete ALL files in the job folder (photos AND signature)
              try {
                const jobFolderRef = storage().ref(`${username}/jobs/${jobId}`);
                const fileList = await jobFolderRef.listAll();
                
                // Delete all files in the folder
                for (const fileRef of fileList.items) {
                  try {
                    await fileRef.delete();
                    console.log('Deleted file:', fileRef.fullPath);
                  } catch (deleteError) {
                    console.log('Error deleting file:', fileRef.fullPath, deleteError);
                  }
                }
              } catch (storageError) {
                console.log('Error deleting storage files:', storageError);
              }
              
              // Get company name from cache
              const companyName = getCompanyName();
              
              if (!companyName) {
                alert.error('Error', 'Cannot delete job: User does not belong to a company');
                return;
              }
              
              // Delete from company finishedJobs only (single source of truth)
              await deleteDoc(doc(db, 'companies', companyName, 'finishedJobs', jobId));
              
              await removeJob(jobId, false);
              
              alert.success('Success', 'Job deleted successfully');
              loadJobs();
            } catch (error) {
              console.error('Error deleting job:', error);
              alert.error('Error', 'Failed to delete job');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      {/* Offline Banner */}
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <MaterialCommunityIcons name="wifi-off" size={20} color="#fff" />
          <Text style={styles.offlineBannerText}>{t.offlineMode}</Text>
        </View>
      )}

      {/* Pending Jobs Indicator */}
      {isOnline && pendingJobs > 0 && (
        <View style={styles.pendingJobsBanner}>
          <MaterialCommunityIcons name="cloud-upload" size={20} color="#fff" />
          <Text style={styles.pendingJobsText}>
            {t.pendingJobs}: {pendingJobs}
          </Text>
        </View>
      )}

      {/* White Background Content */}
      <ScrollableContainer 
        style={styles.content}
        contentContainerStyle={{ paddingTop: 30, paddingBottom: Platform.OS === 'android' ? 220 + insets.bottom : 100 + insets.bottom }}
      >
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => {
              router.push({
                pathname: '/FillJob',
                params: { 
                  mode: 'user'
                }
              });
            }}
          >
            <Text style={styles.createButtonText}>{t.createJob}</Text>
          </TouchableOpacity>

          {/* Filters Row */}
          <View style={styles.filtersRow}>
            {/* Date Filter Button */}
            <TouchableOpacity
              onPress={() => setShowDateFilter(true)}
              style={styles.dateFilterButtonWrapper}
            >
              <LinearGradient
                colors={isDarkMode ? ['#0f172a', '#1e3a8a'] : ['#3b82f6', '#1e40af']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.dateFilterButton}
              >
                <Ionicons name="calendar-outline" size={22} color="#fff" />
                <Text style={styles.dateFilterButtonText}>
                  {dateFilter.label}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Client Filter Input */}
            <TouchableOpacity
              style={[styles.clientFilterContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => setShowClientSelector(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="person-outline" size={20} color={colors.textSecondary} />
              <Text style={[styles.clientFilterInput, { color: clientFilter ? colors.textPrimary : colors.textSecondary }]}>
                {clientFilter || t.filterByClient}
              </Text>
              {clientFilter.length > 0 ? (
                <TouchableOpacity onPress={(e) => { e.stopPropagation(); setClientFilter(''); }}>
                  <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : (
                <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
              )}
            </TouchableOpacity>
          </View>

          {jobs.length === 0 ? (
            <Text style={styles.emptyText}>{t.noJobs}</Text>
          ) : (
            jobs.map((job) => (
              <TouchableOpacity 
                key={job.id} 
                style={[styles.jobCard, { backgroundColor: colors.surface }]}
                onPress={() => setSelectedJobDetails(job)}
                activeOpacity={0.7}
              >
                <View style={styles.jobTitleRow}>
                  <View style={styles.titleContainer}>
                    <Text style={[styles.jobTitle, { color: colors.primary }]}>{job.title}</Text>
                    {isJobNew(job) && (
                      <View style={styles.newBadge}>
                        <Text style={styles.newBadgeText}>
                          {language === 'en' ? 'NEW' : language === 'he' ? 'חדש' : 'جديد'}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.actionIcons}>
                    <TouchableOpacity
                      style={[
                        styles.iconButton, 
                        styles.editIconButton,
                        !canEditJob(job) && styles.disabledIconButton
                      ]}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleEditJob(job);
                      }}
                      disabled={!canEditJob(job)}
                    >
                      <MaterialCommunityIcons name="pencil" size={20} color="white" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.iconButton, 
                        styles.deleteIconButton,
                        !canDeleteJob(job) && styles.disabledIconButton
                      ]}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleDeleteJob(job.id);
                      }}
                      disabled={!canDeleteJob(job)}
                    >
                      <MaterialCommunityIcons name="delete" size={20} color="white" />
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={[styles.jobDescription, { color: colors.textSecondary }]}>{job.description}</Text>
                <Text style={[styles.jobDetails, { color: colors.textSecondary }]}>
                  {formatDate(job.finishedAt) || 'No date'} | {job.timeFrom} - {job.timeTo}
                </Text>
                <Text style={[styles.jobLocation, { color: colors.textSecondary }]}>
                  <Text style={styles.locationLabel}>{t.location}: </Text>{job.location}
                </Text>
                {job.clientName && (
                  <Text style={[styles.jobCustomer, { color: colors.textSecondary }]}>
                    {t.clientName}: {job.clientName}{job.clientPhone && `   ${t.clientPhone}: ${job.clientPhone}`}
                  </Text>
                )}
              </TouchableOpacity>
            ))
          )}
        </ScrollableContainer>

        {/* Create/Edit Job Modal */}
        <Modal 
          visible={showCreateJob && !showSignature && !showPhotoPicker && !showTimeFromPicker && !showTimeToPicker}
          transparent 
          animationType="slide"
          onRequestClose={() => {
            setShowCreateJob(false);
            setEditingJob(null);
          }}
        >
          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            <View style={styles.modalContainer}>
              <TouchableOpacity
                style={StyleSheet.absoluteFillObject}
                activeOpacity={1}
                onPress={() => {
                  setShowCreateJob(false);
                  setEditingJob(null);
                }}
              />
              <ScrollView 
                style={styles.modalScrollView} 
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled"
              >
                <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                    {editingJob ? t.editJob : t.createJob}
                  </Text>

                {/* Job Title Card */}
                <View style={[styles.infoCard, { backgroundColor: colors.surface }]}>
                  <View style={styles.cardHeader}>
                    <MaterialCommunityIcons name="briefcase" size={20} color="#00ACC1" />
                    <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.jobTitle} *</Text>
                  </View>
                  <TextInput
                    style={[styles.cardInput, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
                    placeholder={t.jobTitle || 'Enter job title'}
                    placeholderTextColor={colors.textSecondary}
                    value={jobData.title || ''}
                    onChangeText={(text) => setJobData({ ...jobData, title: text })}
                    returnKeyType="next"
                    onSubmitEditing={() => Keyboard.dismiss()}
                    blurOnSubmit={false}
                  />
                </View>

                {/* Time Worked Card */}
                <View style={[styles.infoCard, { backgroundColor: colors.surface }]}>
                  <View style={styles.cardHeader}>
                    <Ionicons name="time" size={20} color="#00ACC1" />
                    <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.timeWorked} *</Text>
                  </View>
                  <View style={styles.timeRow}>
                    <View style={styles.timePickerContainer}>
                      <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>{t.from}</Text>
                      <TouchableOpacity
                        style={[styles.timePickerButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                        onPress={() => setShowTimeFromPicker(true)}
                      >
                        <Text style={[styles.timePickerText, { color: colors.textPrimary }]}>
                          {jobData.timeFrom || 'Select Time'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    
                    <View style={styles.timePickerContainer}>
                      <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>{t.to}</Text>
                      <TouchableOpacity
                        style={[styles.timePickerButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                        onPress={() => setShowTimeToPicker(true)}
                      >
                        <Text style={[styles.timePickerText, { color: colors.textPrimary }]}>
                          {jobData.timeTo || 'Select Time'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                {/* Location Card */}
                <View style={[styles.infoCard, { backgroundColor: colors.surface }]}>
                  <View style={styles.cardHeader}>
                    <Ionicons name="location" size={20} color="#00ACC1" />
                    <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.location} *</Text>
                  </View>
                  <TextInput
                    style={[styles.cardInput, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
                    placeholder={t.locationPlaceholder || 'Enter location'}
                    placeholderTextColor={colors.textSecondary}
                    value={jobData.location || ''}
                    onChangeText={(text) => setJobData({ ...jobData, location: text })}
                    returnKeyType="done"
                    onSubmitEditing={() => Keyboard.dismiss()}
                    blurOnSubmit={true}
                  />
                  <TouchableOpacity
                    style={styles.locationButton}
                    onPress={handleGetLocation}
                  >
                    <Ionicons name="navigate" size={18} color="white" style={{ marginRight: 8 }} />
                    <Text style={styles.locationButtonText}>{t.getLocation}</Text>
                  </TouchableOpacity>
                </View>

                {/* Client Information Card */}
                <View style={[styles.infoCard, { backgroundColor: colors.surface }]}>
                  <View style={styles.cardHeader}>
                    <Ionicons name="person" size={20} color="#00ACC1" />
                    <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.clientInfo || 'Client Information'}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
                    <View style={styles.infoContent}>
                      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{t.clientName}</Text>
                      <TextInput
                        style={[styles.cardInput, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
                        placeholder={t.clientNamePlaceholder || 'Enter client name'}
                        placeholderTextColor={colors.textSecondary}
                        value={jobData.clientName || ''}
                        onChangeText={(text) => setJobData({ ...jobData, clientName: text })}
                        returnKeyType="done"
                        onSubmitEditing={() => Keyboard.dismiss()}
                        blurOnSubmit={true}
                      />
                    </View>
                  </View>
                  <View style={styles.infoRow}>
                    <Ionicons name="call-outline" size={18} color={colors.textSecondary} />
                    <View style={styles.infoContent}>
                      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{t.clientPhone}</Text>
                      <TextInput
                        style={[styles.cardInput, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
                        placeholder={t.clientPhonePlaceholder || 'Enter client phone number'}
                        placeholderTextColor={colors.textSecondary}
                        value={jobData.clientPhone || ''}
                        onChangeText={(text) => setJobData({ ...jobData, clientPhone: text })}
                        keyboardType="phone-pad"
                        returnKeyType="done"
                        onSubmitEditing={() => Keyboard.dismiss()}
                        blurOnSubmit={true}
                      />
                    </View>
                  </View>
                </View>

                {/* Description Card */}
                <View style={[styles.infoCard, { backgroundColor: colors.surface }]}>
                  <View style={styles.cardHeader}>
                    <MaterialCommunityIcons name="text" size={20} color="#00ACC1" />
                    <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.jobDescription} *</Text>
                  </View>
                  <TextInput
                    style={[styles.cardInput, styles.textArea, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
                    placeholder={t.descriptionPlaceholder || 'Enter job description'}
                    placeholderTextColor={colors.textSecondary}
                    value={jobData.description || ''}
                    onChangeText={(text) => setJobData({ ...jobData, description: text })}
                    multiline
                    numberOfLines={4}
                    returnKeyType="default"
                    blurOnSubmit={false}
                    textAlignVertical="top"
                  />
                </View>

                {/* Photos Card */}
                <View style={[styles.infoCard, { backgroundColor: colors.surface }]}>
                  <View style={styles.cardHeader}>
                    <Ionicons name="images" size={20} color="#00ACC1" />
                    <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.photos} * (at least 1)</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.photoButton}
                    onPress={handleAddPhoto}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="camera" size={18} color="white" style={{ marginRight: 8 }} />
                    <Text style={styles.photoButtonText}>{t.addPhoto}</Text>
                  </TouchableOpacity>

                  {jobData.photos.length > 0 && (
                    <ScrollView horizontal style={styles.photosContainer}>
                      {jobData.photos.map((photo, index) => (
                        <Image key={index} source={{ uri: photo }} style={styles.photo} />
                      ))}
                    </ScrollView>
                  )}
                </View>

                {/* Parts Used Card */}
                <View style={[styles.infoCard, { backgroundColor: colors.surface }]}>
                  <View style={styles.cardHeader}>
                    <MaterialCommunityIcons name="cog" size={20} color="#00ACC1" />
                    <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.partsUsed}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.partsButton}
                    onPress={() => {
                      global.onPartsSelected = (parts) => setSelectedParts(parts);
                      router.push({
                        pathname: '/PartsSelection',
                        params: { selectedParts: JSON.stringify(selectedParts) }
                      });
                    }}
                  >
                    <MaterialCommunityIcons name="wrench" size={18} color="white" style={{ marginRight: 8 }} />
                    <Text style={styles.partsButtonText}>
                      {selectedParts.length > 0 
                        ? `${selectedParts.length} ${language === 'en' ? 'parts selected' : 'חלקים נבחרו'}`
                        : t.selectParts
                      }
                    </Text>
                  </TouchableOpacity>

                  {selectedParts.length > 0 && (
                    <View style={styles.selectedPartsContainer}>
                      {selectedParts.map((part) => (
                        <View key={part.id} style={[styles.partItem, { backgroundColor: colors.background }]}>
                          <View style={styles.partIcon}>
                            <MaterialCommunityIcons name="wrench" size={26} color="#00ACC1" />
                          </View>
                          <Text style={[styles.partName, { color: colors.textPrimary }]}>{part.name}</Text>
                          <View style={styles.partQuantityBadge}>
                            <Text style={styles.partQuantity}>{part.usedQuantity}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Signature Card */}
                <View style={[styles.infoCard, { backgroundColor: colors.surface }]}>
                  <View style={styles.cardHeader}>
                    <MaterialCommunityIcons name="draw" size={20} color="#00ACC1" />
                    <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t.clientSignature} *</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
                    <View style={styles.infoContent}>
                      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{t.signingPerson} *</Text>
                      <TextInput
                        style={[styles.cardInput, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
                        placeholder={t.signingPersonPlaceholder || 'Enter name of person signing'}
                        placeholderTextColor={colors.textSecondary}
                        value={jobData.signingPerson || ''}
                        onChangeText={(text) => setJobData({ ...jobData, signingPerson: text })}
                        returnKeyType="done"
                        onSubmitEditing={() => Keyboard.dismiss()}
                        blurOnSubmit={true}
                      />
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.signatureButton}
                    onPress={() => {
                      console.log('Signature button pressed - current state:', showSignature);
                      console.log('Setting showSignature to true');
                      setShowSignature(true);
                      console.log('After setState call');
                    }}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="gesture-tap" size={18} color="white" style={{ marginRight: 8 }} />
                    <Text style={styles.signatureButtonText}>
                      {jobData.signature ? '✓ Signature Added - Tap to Change' : '+ Add Client Signature'}
                    </Text>
                  </TouchableOpacity>

                  {jobData.signature && (
                    <Image source={{ uri: jobData.signature }} style={styles.signatureImage} />
                  )}
                </View>


                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={handleModalClose}
                  >
                    <Text style={styles.modalButtonText}>{t.cancel}</Text>
                  </TouchableOpacity>
                  {!editingJob && (
                    <TouchableOpacity
                      style={[styles.modalButton, styles.continueLaterButton]}
                      onPress={handleContinueLater}
                    >
                      <Text style={styles.modalButtonText}>{t.continueLater}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.modalButton, styles.submitButton, submitting && { opacity: 0.6 }]}
                    onPress={handleSubmit}
                    disabled={submitting}
                  >
                    <Text style={styles.modalButtonText}>
                      {t.submit}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

      {/* Signature Modal */}
      <Modal
        visible={showSignature}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowSignature(false)}
      >
        <SignaturePad
          onSave={(signatureUri) => {
            setJobData({ ...jobData, signature: signatureUri });
            // Close modal first
            setShowSignature(false);
            // Show success alert after modal closes to prevent iOS freeze
            setTimeout(() => {
              alert.success('Success', 'Signature saved!');
            }, 300);
          }}
          onCancel={() => setShowSignature(false)}
        />
      </Modal>

      {/* Custom Time Pickers */}
      <TimePicker
        visible={showTimeFromPicker}
        onClose={() => setShowTimeFromPicker(false)}
        onConfirm={(timeString) => {
          setJobData({ ...jobData, timeFrom: timeString });
          setShowTimeFromPicker(false);
        }}
        title="Select Start Time"
        initialHour={7}
        initialMinute={0}
      />

      <TimePicker
        visible={showTimeToPicker}
        onClose={() => setShowTimeToPicker(false)}
        onConfirm={(timeString) => {
          setJobData({ ...jobData, timeTo: timeString });
          setShowTimeToPicker(false);
        }}
        title="Select End Time"
        initialHour={7}
        initialMinute={0}
      />

      {/* Custom Photo Picker */}
      <PhotoPicker
        visible={showPhotoPicker}
        onClose={() => setShowPhotoPicker(false)}
        onPhotosSelected={handlePhotosSelected}
        maxPhotos={10}
        existingPhotos={jobData.photos}
      />

      {/* Syncing Overlay */}
      {isSyncing && (
        <View style={styles.syncingOverlay}>
          <View style={styles.syncingContainer}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.syncingText}>
              {language === 'en' ? 'Syncing pending jobs...' : 
               language === 'he' ? 'מסנכרן משימות ממתינות...' : 
               'مزامنة المهام المعلقة...'}
            </Text>
            <Text style={styles.syncingSubtext}>
              {language === 'en' ? 'Please wait, do not close the app' : 
               language === 'he' ? 'אנא המתן, אל תסגור את האפליקציה' : 
               'يرجى الانتظار، لا تغلق التطبيق'}
            </Text>
          </View>
        </View>
      )}

      {/* Job Details Modal */}
      <ViewJobDetails
        visible={!!selectedJobDetails}
        job={selectedJobDetails}
        onClose={() => setSelectedJobDetails(null)}
        translations={{
          jobDetails: t.jobDetails,
          title: t.title,
          description: t.description,
          location: t.location,
          clientName: t.clientName,
          clientPhone: t.clientPhone,
          clientInfo: t.clientName,
          createdAt: t.createdAt,
          finishedAt: t.finishedAt || t.createdAt,
          status: t.status,
          timeStatus: t.timeWorked,
          photos: t.photos,
          noPhotos: t.noPhotos,
          signature: t.signature,
          noSignature: t.noSignature,
          signingPerson: t.signingPerson,
          partsUsed: t.partsUsed,
          noParts: t.noParts,
          close: t.close,
          timeWorked: t.timeWorked,
          assignedBy: t.assignedBy || t.createdAt,
        }}
        getStatusColor={getStatusColor}
        onImagePress={(photo) => {/* Can add image modal if needed */}}
        isDarkMode={isDarkMode}
      />

      {/* Date Filter Modal */}
      <DateFilter
        visible={showDateFilter}
        onClose={() => setShowDateFilter(false)}
        onFilterChange={(filter) => {
          setDateFilter(filter);
          setShowDateFilter(false);
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  offlineBanner: {
    backgroundColor: '#ef4444',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: Platform.OS === 'ios' ? 100 : 88,
    marginHorizontal: 20,
    borderRadius: 8,
    gap: 8,
  },
  offlineBannerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  pendingJobsBanner: {
    backgroundColor: '#f59e0b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: Platform.OS === 'ios' ? 100 : 88,
    marginHorizontal: 20,
    borderRadius: 8,
    gap: 8,
  },
  pendingJobsText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  syncNowText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    textDecorationLine: 'underline',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 110 : 98,
  },
  createButton: {
    backgroundColor: '#10b981',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    marginBottom: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  createButtonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  filtersRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: 20,
    marginBottom: 16,
  },
  dateFilterButtonWrapper: {
    flex: 1,
    borderRadius: 12,
    ...shadows.small,
  },
  dateFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 10,
  },
  dateFilterButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  jobCard: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.05)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  jobTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: themeColors.primary,
    letterSpacing: 0.3,
  },
  jobTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  actionIcons: {
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  editIconButton: {
    backgroundColor: '#3b82f6',
  },
  deleteIconButton: {
    backgroundColor: '#ef4444',
  },
  disabledIconButton: {
    backgroundColor: '#9ca3af',
    opacity: 0.5,
  },
  newBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#EF4444',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  newBadgeText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  jobDescription: {
    fontSize: 15,
    marginBottom: 10,
    lineHeight: 22,
  },
  jobDetails: {
    fontSize: 12,
    marginBottom: 4,
  },
  jobLocation: {
    fontSize: 12,
    marginBottom: 12,
  },
  locationLabel: {
    fontWeight: '700',
    color: themeColors.secondary,
  },
  jobCustomer: {
    fontSize: 12,
    marginBottom: 12,
    fontWeight: '500',
  },
  emptyText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 40,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalScrollView: {
    width: '100%',
    maxHeight: '85%',
  },
  modalScrollContent: {
    flexGrow: 1,
  },
  modalContent: {
    width: '100%',
    backgroundColor: themeColors.background,
    borderRadius: 24,
    padding: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  modalTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: themeColors.primary,
    marginBottom: 24,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  draftIndicator: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignSelf: 'center',
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  draftText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  label: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: 8,
  },
  requiredLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: themeColors.danger,
    marginBottom: 8,
  },
  input: {
    borderWidth: 2,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    color: '#1f2937',
    backgroundColor: '#ffffff',
  },
  timeRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  timePickerContainer: {
    flex: 1,
  },
  timeLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  timePickerButton: {
    borderWidth: 2,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#ffffff',
    alignItems: 'center',
  },
  timePickerText: {
    fontSize: 16,
    color: '#1f2937',
  },
  timeInput: {
    flex: 1,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  locationButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  locationButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  photoButton: {
    backgroundColor: '#8b5cf6',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  photoButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  photosContainer: {
    marginBottom: 12,
  },
  photo: {
    width: 100,
    height: 100,
    borderRadius: 8,
    marginRight: 8,
  },
  signatureButton: {
    backgroundColor: '#ec4899',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  signatureButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  signatureImage: {
    width: '100%',
    height: 150,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  modalButton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#6b7280',
  },
  continueLaterButton: {
    backgroundColor: '#f59e0b',
  },
  submitButton: {
    backgroundColor: themeColors.secondary,
  },
  modalButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  signatureModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signatureModalContainer: {
    backgroundColor: 'white',
    width: '90%',
    height: '80%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  signatureHeaderBar: {
    backgroundColor: themeColors.primary,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  signatureTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  signatureBox: {
    flex: 1,
    margin: 16,
    borderWidth: 2,
    borderColor: '#d1d5db',
    borderRadius: 8,
    overflow: 'hidden',
  },
  cancelSignatureButton: {
    backgroundColor: '#ef4444',
    padding: 16,
    alignItems: 'center',
  },
  cancelSignatureText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  partsButton: {
    backgroundColor: '#8b5cf6',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  partsButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  selectedPartsContainer: {
    marginBottom: 20,
    marginTop: 12,
  },
  selectedPartItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f0f9ff',
    padding: 20,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#00ACC1',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  selectedPartName: {
    fontSize: 18,
    color: '#1f2937',
    fontWeight: '700',
  },
  selectedPartQty: {
    fontSize: 18,
    color: '#6b7280',
    fontWeight: 'bold',
  },
  // Card-based styles
  infoCard: {
    borderRadius: 20,
    padding: 22,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.04)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.1,
        shadowRadius: 16,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginLeft: 14,
    letterSpacing: 0.4,
  },
  cardInput: {
    borderWidth: 2,
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
    marginBottom: 10,
    fontWeight: '600',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    gap: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  partItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderRadius: 18,
    marginBottom: 12,
    borderLeftWidth: 5,
    borderLeftColor: '#00ACC1',
    ...Platform.select({
      ios: {
        shadowColor: '#00ACC1',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  partIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 172, 193, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#00ACC1',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  partName: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  partQuantityBadge: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 20,
    minWidth: 56,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#00ACC1',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  partQuantity: {
    color: 'white',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  locationButton: {
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#00ACC1',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  locationButtonText: {
    color: 'white',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  photoButton: {
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#8b5cf6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  photoButtonText: {
    color: 'white',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  signatureButton: {
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#ec4899',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  signatureButtonText: {
    color: 'white',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  partsButton: {
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#8b5cf6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  partsButtonText: {
    color: 'white',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  partsModalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    height: 600,
    width: '95%',
  },
  searchInput: {
    borderWidth: 2,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    color: '#1f2937',
    backgroundColor: '#ffffff',
  },
  partsListScroll: {
    maxHeight: 400,
  },
  partItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  partInfo: {
    flex: 1,
  },
  partItemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 4,
  },
  partItemAvailable: {
    fontSize: 12,
    color: '#6b7280',
  },
  partQuantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quantityInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    padding: 8,
    width: 60,
    textAlign: 'center',
    fontSize: 14,
  },
  addPartButton: {
    backgroundColor: '#10b981',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPartText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  removePartButton: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  removePartText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  doneButton: {
    backgroundColor: themeColors.secondary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  doneButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  syncingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  syncingContainer: {
    backgroundColor: '#1f2937',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    minWidth: 280,
  },
  syncingText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
    textAlign: 'center',
  },
  syncingSubtext: {
    color: '#9ca3af',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  clientFilterContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  clientFilterInput: {
    flex: 1,
    fontSize: typography.body,
    padding: spacing.xs,
  },
});