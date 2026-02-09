import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  Modal,
  Platform,
  SafeAreaView,
  KeyboardAvoidingView,
  Keyboard,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { auth, db, storage, functions, doc, getDoc, setDoc, updateDoc, httpsCallable } from '../firebase';
import { colors as themeColors, getColors, gradients, spacing, borderRadius, typography, shadows } from '../theme';
import { TimePicker, PhotoPicker, SignaturePad, GlobalHeader, ViewJobDetails, DateFilter, ScrollableContainer } from '../components';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { useAlert } from '../contexts/AlertContext';
import { useCache } from '../contexts/CacheContext';
import { generateJobId, getUsernameFromEmail } from '../utils/helpers';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';

export default function Workerjob() {
  const router = useRouter();
  const { language, toggleLanguage } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const insets = useSafeAreaInsets();
  const {
    profile,
    inventory: cachedInventory,
    pendingJobs: cachedPendingJobs,
    finishedJobs: cachedFinishedJobs,
    getUsername,
    getCompanyName,
    getUserRole,
    updateInventory,
    updateJob,
    addJob,
    moveJobToFinished,
    incrementDocumentVersion,
    getDataForDateRange,
    isWithinCacheRange
  } = useCache();
  const colors = getColors(isDarkMode);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingJob, setEditingJob] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  
  // Job form fields
  const [jobData, setJobData] = useState({
    timeFrom: '',
    timeTo: '',
    location: '',
    description: '',
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
  const [submitting, setSubmitting] = useState(false);
  const hasInitialLoadedRef = useRef(false);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingJobs, setPendingJobs] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedJobDetails, setSelectedJobDetails] = useState(null);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFilter, setDateFilter] = useState({
    type: 'last7days',
    startDate: new Date(new Date().setDate(new Date().getDate() - 7)),
    endDate: new Date(),
    label: 'Last 7 Days'
  });

  const t = language === 'en' ? {
    title: 'My Assigned Jobs',
    subtitle: 'Complete jobs assigned by manager',
    back: 'Back',
    noJobs: 'No jobs assigned yet',
    pending: 'Pending',
    received: 'Received',
    waiting: 'Waiting for Approval',
    accepted: 'Accepted',
    denied: 'Denied',
    fillDetails: 'Fill Details',
    editJob: 'Edit Job',
    jobTitle: 'Job Title',
    assignedBy: 'Assigned by',
    clientName: 'Client Name',
    clientPhone: 'Client Phone',
    timeWorked: 'Time Worked',
    from: 'From (HH:MM)',
    to: 'To (HH:MM)',
    location: 'Job Location',
    locationPlaceholder: 'Enter address or location',
    getLocation: 'Get Current Location',
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
    submit: 'Submit for Approval',
    submitting: 'Submitting...',
    cancel: 'Cancel',
    continueLater: 'Later',
    success: 'Job submitted successfully!',
    fillAllFields: 'Please fill all required fields',
    markReceived: 'Mark as Received',
    draftFound: 'Draft Found',
    draftFoundMessage: 'You have unsaved work for this job. Would you like to continue working on it?',
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
    showingJobsFrom: 'Showing jobs from',
    close: 'Close',
    invalidIsraeliPhone: 'Invalid Israeli phone number',
    invalidPhoneMessage: 'Please provide a valid Israeli phone number (starting with 05X or +9725X)',
  } : language === 'he' ? {
    title: 'המשימות שלי',
    subtitle: 'השלמת משימות שהוקצו על ידי מנהל',
    back: 'חזרה',
    noJobs: 'אין משימות מוקצות עדיין',
    pending: 'ממתין',
    received: 'התקבל',
    waiting: 'ממתין לאישור',
    accepted: 'אושר',
    denied: 'נדחה',
    fillDetails: 'מילוי פרטים',
    editJob: 'עריכת משימה',
    jobTitle: 'כותרת משימה',
    assignedBy: 'הוקצה על ידי',
    clientName: 'שם הלקוח',
    clientPhone: 'טלפון הלקוח',
    timeWorked: 'שעות עבודה',
    from: 'מ (HH:MM)',
    to: 'עד (HH:MM)',
    location: 'מיקום העבודה',
    locationPlaceholder: 'הזן כתובת או מיקום',
    getLocation: 'קבל מיקום נוכחי',
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
    submit: 'שלח לאישור',
    submitting: 'שולח...',
    cancel: 'ביטול',
    continueLater: 'המשך מאוחר יותר',
    success: 'המשימה הוגשה בהצלחה!',
    fillAllFields: 'אנא מלא את כל השדות הנדרשים',
    markReceived: 'סמן כהתקבל',
    draftFound: 'נמצא טיוטה',
    draftFoundMessage: 'יש לך עבודה שלא נשמרה עבור משימה זו. האם תרצה להמשיך לעבוד עליה?',
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
    showingJobsFrom: 'מציג משימות מ',
    close: 'סגור',
    invalidIsraeliPhone: 'מספר טלפון ישראלי לא חוקי',
    invalidPhoneMessage: 'אנא ספק מספר טלפון ישראלי תקין (מתחיל ב-05X או +9725X)',
  } : {
    title: 'المهام المعينة لي',
    subtitle: 'إنجاز المهام المعينة من قبل المدير',
    back: 'رجوع',
    noJobs: 'لا توجد مهام معينة بعد',
    pending: 'قيد الانتظار',
    received: 'مستلم',
    waiting: 'في انتظار الموافقة',
    accepted: 'مقبول',
    denied: 'مرفوض',
    fillDetails: 'ملء التفاصيل',
    editJob: 'تعديل المهمة',
    jobTitle: 'عنوان المهمة',
    assignedBy: 'تم التعيين بواسطة',
    clientName: 'اسم العميل',
    clientPhone: 'هاتف العميل',
    timeWorked: 'وقت العمل',
    from: 'من (HH:MM)',
    to: 'إلى (HH:MM)',
    location: 'موقع العمل',
    locationPlaceholder: 'أدخل العنوان أو الموقع',
    getLocation: 'احصل على الموقع الحالي',
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
    submit: 'تقديم للموافقة',
    submitting: 'جاري التقديم...',
    cancel: 'إلغاء',
    continueLater: 'لاحقاً',
    success: 'تم تقديم المهمة بنجاح!',
    fillAllFields: 'يرجى ملء جميع الحقول المطلوبة',
    markReceived: 'وضع علامة كمستلم',
    draftFound: 'تم العثور على مسودة',
    draftFoundMessage: 'لديك عمل غير محفوظ لهذه المهمة. هل تريد متابعة العمل عليها؟',
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
    showingJobsFrom: 'عرض المهام من',
    close: 'إغلاق',
    invalidIsraeliPhone: 'رقم هاتف إسرائيلي غير صالح',
    invalidPhoneMessage: 'يرجى تقديم رقم هاتف إسرائيلي صالح (يبدأ بـ 05X أو +9725X)',
  };

  const isJobNew = (job) => {
    if (!job.timestamp && !job.createdAt) return false;
    const jobDate = new Date(job.timestamp || job.createdAt);
    const now = new Date();
    const hoursDiff = (now - jobDate) / (1000 * 60 * 60);
    return hoursDiff <= 24;
  };

  // Check if worker can edit job (workers cannot edit finished jobs)
  const canEditJob = (job) => {
    // Workers cannot edit finished jobs at all
    return job.status !== 'finished';
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
      
      return new Promise(async (resolve, reject) => {
        try {
          await storageRef.put(blob);
          const downloadURL = await storageRef.getDownloadURL();
          console.log('Upload complete:', downloadURL);
          resolve(downloadURL);
        } catch (error) {
          console.error('Upload error:', error);
          reject(error);
        }
      });
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

  useEffect(() => {
    let unsubscribeJobs;
    
    const initializeData = async () => {
      await loadInventory();
      unsubscribeJobs = await loadJobs();
      hasInitialLoadedRef.current = true;
    };
    
    initializeData();
    
    // Cleanup function to unsubscribe from real-time listener
    return () => {
      if (unsubscribeJobs && typeof unsubscribeJobs === 'function') {
        unsubscribeJobs();
      }
    };
  }, [dateFilter]); // Re-run when date filter changes

  // Watch for cached jobs changes and update UI (pending or finished job data changed)
  useEffect(() => {
    // Skip initial load (wait for initializeData to complete)
    if (!hasInitialLoadedRef.current) return;
    
    console.log('📦 Workerjob: cached jobs updated - triggering loadJobs');
    loadJobs();
  }, [cachedPendingJobs, cachedFinishedJobs]); // Re-load when cache updates (any content change)

  // Watch for cached inventory changes
  useEffect(() => {
    // Skip initial load (wait for initializeData to complete)
    if (!hasInitialLoadedRef.current) return;
    
    console.log('📦 Workerjob: cached inventory updated - triggering loadInventory');
    loadInventory();
  }, [cachedInventory]); // Re-load when inventory cache updates (any content change)

  // Network state listener
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

    checkPendingJobs();
    return () => unsubscribe();
  }, []);

  const checkPendingJobs = async () => {
    try {
      const pending = await AsyncStorage.getItem('pendingWorkerJobs');
      if (pending) {
        const pendingArray = JSON.parse(pending);
        setPendingJobs(pendingArray.length);
      }
    } catch (error) {
      console.error('Error checking pending jobs:', error);
    }
  };

  const syncPendingJobs = async () => {
    try {
      const pending = await AsyncStorage.getItem('pendingWorkerJobs');
      if (!pending) return;

      const pendingArray = JSON.parse(pending);
      if (pendingArray.length === 0) return;

      setIsSyncing(true);
      let successCount = 0;
      let failedJobs = [];

      for (const pendingJob of pendingArray) {
        try {
          await submitJobToFirebase(
            pendingJob.jobData,
            pendingJob.selectedParts,
            pendingJob.jobId,
            pendingJob.companyName
          );
          successCount++;
        } catch (error) {
          console.error('Error syncing job:', error);
          failedJobs.push(pendingJob);
        }
      }

      if (failedJobs.length > 0) {
        await AsyncStorage.setItem('pendingWorkerJobs', JSON.stringify(failedJobs));
        setPendingJobs(failedJobs.length);
        alert.error(t.syncError || 'Some jobs failed to sync');
      } else {
        await AsyncStorage.removeItem('pendingWorkerJobs');
        setPendingJobs(0);
        alert.success(t.syncSuccess || 'All jobs synced successfully!');
        loadJobs();
      }
    } catch (error) {
      console.error('Error syncing pending jobs:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  // Load draft when opening edit modal (only for jobs not yet submitted)
  useEffect(() => {
    if (showEditModal && editingJob) {
      // Only check for drafts if job is 'received' or 'denied' (not yet submitted)
      if (editingJob.status === 'received' || editingJob.status === 'denied') {
        checkForDraft(editingJob.id);
      } else {
        // For 'waiting' or 'accepted' jobs, just load the job data without draft
        loadJobData();
      }
    }
  }, [showEditModal, editingJob]);

  const checkForDraft = async (jobId) => {
    try {
      const draftKey = `workerjobDraft_${jobId}`;
      const draft = await AsyncStorage.getItem(draftKey);
      if (draft) {
        const parsed = JSON.parse(draft);
        // Check if draft has meaningful content
        if (parsed.jobData && (parsed.jobData.description || parsed.jobData.photos?.length > 0 || 
            parsed.selectedParts?.length > 0)) {
          // Show alert to user
          alert.confirm(
            t.draftFound,
            t.draftFoundMessage,
            [
              {
                text: t.discardDraft,
                style: 'destructive',
                onPress: async () => {
                  await AsyncStorage.removeItem(draftKey);
                  // Load fresh data from editingJob
                  loadJobData();
                }
              },
              {
                text: t.cancel || 'Cancel',
                style: 'cancel',
                onPress: () => {
                  // Do nothing, just close the alert
                }
              },
              {
                text: t.continueWithDraft,
                style: 'default',
                onPress: () => {
                  loadDraftData(parsed);
                }
              }
            ]
          );
          return;
        }
      }
      // No draft found, load fresh data
      loadJobData();
    } catch (error) {
      console.error('Error checking for draft:', error);
      loadJobData();
    }
  };

  const loadJobData = () => {
    if (editingJob) {
      setJobData({
        timeFrom: editingJob.timeFrom || '',
        timeTo: editingJob.timeTo || '',
        location: editingJob.location || '',
        description: editingJob.workDescription || editingJob.description || '',
        photos: editingJob.photos || [],
        signingPerson: editingJob.signingPerson || '',
        signature: editingJob.signature || null,
      });
      setSelectedParts(editingJob.partsUsed || []);
    }
  };

  const loadDraftData = (parsed) => {
    setJobData(parsed.jobData || {
      timeFrom: '',
      timeTo: '',
      location: '',
      description: '',
      photos: [],
      signingPerson: '',
      signature: null,
    });
    setSelectedParts(parsed.selectedParts || []);
    console.log('Draft loaded for job:', editingJob?.id);
  };

  // Auto-save draft whenever data changes (only for jobs not yet submitted)
  useEffect(() => {
    if (showEditModal && editingJob) {
      // Only auto-save drafts for 'received' or 'denied' jobs (not yet submitted)
      if (editingJob.status === 'received' || editingJob.status === 'denied') {
        if (jobData.description || jobData.photos.length > 0 || selectedParts.length > 0) {
          const timeoutId = setTimeout(() => {
            saveDraft(editingJob.id);
          }, 1000); // Debounce for 1 second
          return () => clearTimeout(timeoutId);
        }
      }
    }
  }, [jobData, selectedParts, showEditModal, editingJob]);

  const saveDraft = async (jobId, showAlert = false) => {
    try {
      const draftKey = `workerjobDraft_${jobId}`;
      const draft = {
        jobData,
        selectedParts,
        savedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(draftKey, JSON.stringify(draft));
      console.log('Draft auto-saved for job:', jobId);
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
      
      if (!companyName) {
        console.error('No company name found in profile');
        setLoading(false);
        return;
      }

      // Check if date filter exceeds 90 days (need to fetch from Firebase directly)
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
      
      if (dateFilter.startDate < ninetyDaysAgo) {
        // Fetch older jobs using smart date range filtering from CacheContext
        console.log('📅 Fetching older jobs from Firebase (beyond 90 days)');
        const olderJobs = await getDataForDateRange(dateFilter.startDate, dateFilter.endDate, 'finishedJobs');
        
        // Filter by completedBy for worker
        const filteredJobs = olderJobs.filter(job => 
          job.completedBy === username || job.assignedTo === username
        );
        
        // Sort by date descending
        filteredJobs.sort((a, b) => {
          const dateA = new Date(a.finishedAt || a.createdAt);
          const dateB = new Date(b.finishedAt || b.createdAt);
          return dateB - dateA;
        });
        
        setJobs(filteredJobs);
        setLoading(false);
        return;
      }
      
      // Use cached jobs for recent data
      let jobsList = [];
      
      // Combine pending and finished jobs from cache
      const pending = (cachedPendingJobs || []).filter(job => {
        const jobDate = new Date(job.createdAt);
        return jobDate >= dateFilter.startDate && jobDate <= dateFilter.endDate;
      });
      console.log('📦 [CACHE READ] Worker pending jobs from cache:', pending.length);
      
      const finished = (cachedFinishedJobs || []).filter(job => {
        const jobDate = new Date(job.finishedAt);
        return jobDate >= dateFilter.startDate && jobDate <= dateFilter.endDate;
      });
      console.log('📦 [CACHE READ] Worker finished jobs from cache:', finished.length);
      
      jobsList = [...pending, ...finished];
      
      // Sort by date descending
      jobsList.sort((a, b) => {
        const dateA = new Date(a.finishedAt || a.createdAt);
        const dateB = new Date(b.finishedAt || b.createdAt);
        return dateB - dateA;
      });
      
      setJobs(jobsList);
      setLoading(false);
    } catch (error) {
      if (auth.currentUser) {
        console.error('Error loading jobs:', error);
      }
      setLoading(false);
    }
  }, [cachedPendingJobs, cachedFinishedJobs, dateFilter, getUsername, getCompanyName, getDataForDateRange]);

  const loadInventory = useCallback(async () => {
    try {
      // Use cached inventory if available (cachedInventory is an array)
      if (cachedInventory && Array.isArray(cachedInventory)) {
        console.log('📦 [CACHE READ] Worker inventory from cache:', cachedInventory.length, 'parts');
        setInventory(cachedInventory);
      } else {
        setInventory([]);
      }
    } catch (error) {
      console.error('Error loading inventory:', error);
      setInventory([]);
    }
  }, [cachedInventory, getUsername]);

  const handleAddPartToJob = (part) => {
    console.log('Adding part to job:', part);
    const existing = selectedParts.find(p => p.id === part.id);
    if (existing) {
      alert.warning('Already Added', 'This part is already in the list');
      return;
    }
    console.log('Part added successfully, selectedParts before:', selectedParts.length);
    const newSelectedParts = [...selectedParts, { ...part, usedQuantity: 1 }];
    setSelectedParts(newSelectedParts);
    console.log('Part added successfully, selectedParts after:', newSelectedParts.length);
  };

  const handleRemovePartFromJob = (partId) => {
    setSelectedParts(selectedParts.filter(p => p.id !== partId));
  };

  const handlePartQuantityChange = (partId, quantity) => {
    const numQuantity = parseInt(quantity) || 0;
    setSelectedParts(selectedParts.map(p => 
      p.id === partId ? { ...p, usedQuantity: numQuantity } : p
    ));
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

  const handleMarkReceived = async (job) => {
    try {
      const user = auth.currentUser;
      const username = getUsername() || getUsernameFromEmail(user.email);
      
      // Get company name from cache
      const companyName = getCompanyName();
      
      if (!companyName) {
        alert.error('Error', 'Company name not found');
        return;
      }
      
      const updates = {
        status: 'received',
        name: profile.name || '',
        receivedAt: new Date().toISOString(),
      };
      
      // 1. Update Firestore
      await updateDoc(doc(db, 'companies', companyName, 'PendingJobs', job.id), updates);
      
      // 2. Update job in cache (both worker and company cache)
      await updateJob(job.id, updates, true);

      alert.success('Success', 'Job marked as received');
      loadJobs();
    } catch (error) {
      console.error('Error updating job:', error);
      alert.error('Error', 'Failed to update job');
    }
  };

  const handleFillDetails = async (job) => {
    // Clear any existing draft for this job to prevent loading old data
    try {
      await AsyncStorage.removeItem(`workerjobDraft_${job.id}`);
    } catch (error) {
      console.error('Error clearing draft:', error);
    }
    
    // Navigate to FillJob page with job data
    console.log('=== Navigating to FillJob ===');
    console.log('Job ID:', job.id);
    console.log('Job has signature?', !!job.signature);
    console.log('Job signature value:', job.signature);
    console.log('Job signature type:', typeof job.signature);
    
    router.push({
      pathname: '/FillJob',
      params: { 
        mode: 'worker',
        job: JSON.stringify({
          id: job.id,
          title: job.title || '',
          timeFrom: job.timeFrom || '',
          timeTo: job.timeTo || '',
          location: job.location || '',
          description: job.workDescription || job.description || '',
          clientName: job.clientName || '',
          clientPhone: job.clientPhone || '',
          photos: job.photos || [],
          signingPerson: job.signingPerson || '',
          signature: job.signature || null,
          partsUsed: job.partsUsed || [],
          assignedBy: job.assignedBy || '',
        })
      }
    });
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
        const addressStr = `${address[0].street || ''} ${address[0].city || ''} ${address[0].region || ''}`.trim();
        setJobData({ ...jobData, location: addressStr });
      }
    } catch (error) {
      console.error('Error getting location:', error);
      alert.error('Error', 'Failed to get location');
    }
  };

  const handleAddPhoto = () => {
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

  const handleContinueLater = async () => {
    if (editingJob) {
      await saveDraft(editingJob.id, true);
      setShowEditModal(false);
      setEditingJob(null);
    }
  };

  const hasUnsavedChanges = () => {
    return jobData.description || jobData.photos.length > 0 || 
           jobData.timeFrom || jobData.timeTo || jobData.location || selectedParts.length > 0;
  };

  const handleModalClose = () => {
    // Only prompt for draft save if job is not yet submitted (received or denied)
    const canSaveDraft = editingJob && (editingJob.status === 'received' || editingJob.status === 'denied');
    
    if (hasUnsavedChanges() && canSaveDraft) {
      alert.confirm(
        t.unsavedChanges,
        t.unsavedChangesMessage,
        [
          {
            text: t.discardChanges,
            style: 'destructive',
            onPress: async () => {
              if (editingJob) {
                const draftKey = `workerjobDraft_${editingJob.id}`;
                await AsyncStorage.removeItem(draftKey);
              }
              setShowEditModal(false);
              setEditingJob(null);
              resetForm();
            }
          },
          {
            text: t.saveDraft,
            onPress: async () => {
              if (editingJob) {
                await saveDraft(editingJob.id, true);
              }
              setShowEditModal(false);
              setEditingJob(null);
            }
          },
          {
            text: t.cancel,
            style: 'cancel'
          }
        ]
      );
    } else {
      // For submitted jobs or no changes, just close
      setShowEditModal(false);
      setEditingJob(null);
      resetForm();
    }
  };

  const resetForm = () => {
    setJobData({
      timeFrom: '',
      timeTo: '',
      location: '',
      description: '',
      photos: [],
      signingPerson: '',
      signature: null,
    });
    setSelectedParts([]);
  };

  const handleSubmit = async () => {
    if (submitting) {
      return; // Prevent multiple submissions
    }

    if (!jobData.timeFrom || !jobData.timeTo || !jobData.location || !jobData.description || !jobData.signingPerson) {
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
        const existingPending = await AsyncStorage.getItem('pendingWorkerJobs');
        const pendingJobsArray = existingPending ? JSON.parse(existingPending) : [];
        
        const user = auth.currentUser;
        const username = getUsername() || getUsernameFromEmail(user.email);
        
        // Get company name from cache
        const companyName = getCompanyName();
        
        pendingJobsArray.push({
          jobId: editingJob.id,
          username,
          companyName,
          jobData: {
            ...jobData,
            selectedParts: selectedParts.map(part => ({
              id: part.id,
              name: part.name,
              usedQuantity: part.usedQuantity
            })),
            originalJob: editingJob,
          },
          timestamp: Date.now(),
        });
        
        await AsyncStorage.setItem('pendingWorkerJobs', JSON.stringify(pendingJobsArray));
        setPendingJobs(pendingJobsArray.length);
        
        alert.info(t.offlineMode, t.offlineMessage);
        
        // Clear draft
        const draftKey = `workerjobDraft_${editingJob.id}`;
        await AsyncStorage.removeItem(draftKey);
        setShowEditModal(false);
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
      language === 'en' ? 'Please wait while we submit your work...' : 
      language === 'he' ? 'אנא המתן בזמן שאנו שולחים את העבודה שלך...' : 
      'يرجى الانتظار بينما نرسل عملك...'
    );
    try {
      const user = auth.currentUser;
      const username = getUsername() || getUsernameFromEmail(user.email);
      
      // Get company name from cache
      const companyName = getCompanyName();
      
      await submitJobToFirebase(jobData, selectedParts, editingJob.id, companyName);
      
      // Clear draft after successful submission
      const draftKey = `workerjobDraft_${editingJob.id}`;
      await AsyncStorage.removeItem(draftKey);
      
      alert.hideLoading();
      alert.success('Success', t.success);
      
      setShowEditModal(false);
      setEditingJob(null);
      resetForm();
      loadJobs();
      loadInventory();
    } catch (error) {
      console.error('Error submitting job:', error);
      alert.hideLoading();
      alert.error('Error', 'Failed to submit job');
    } finally {
      setSubmitting(false);
    }
  };

  // Extract Firebase submission logic
  const submitJobToFirebase = async (jobData, selectedParts, jobId, companyName) => {
    const user = auth.currentUser;
    const username = getUsernameFromEmail(user.email);
    
    const currentDate = new Date();

    // Upload photos and signature to Firebase Storage
    const { photoURLs, signatureURL } = await uploadJobFiles(
      username,
      jobId,
      jobData.photos || [],
      jobData.signature
    );

    // Get the existing job document to preserve all original fields
    const jobRef = doc(db, 'companies', companyName, 'PendingJobs', jobId);
    const jobSnapshot = await getDoc(jobRef);
    
    if (!jobSnapshot.exists()) {
      throw new Error('Job not found');
    }
    
    const existingJobData = jobSnapshot.data();

    // Build updatedJob object - start with ALL existing fields, then override worker-filled fields
    const updatedJob = {
      ...existingJobData, // Preserve ALL original fields including clientName, clientPhone, etc.
      status: 'waiting',
      submittedAt: currentDate.toISOString(),
      updatedAt: currentDate.toISOString(),
      completedBy: username, // Required by Firestore security rules
    };

    // Override with worker-filled fields
    if (jobData.timeFrom) {
      updatedJob.timeFrom = jobData.timeFrom;
    }
    
    if (jobData.timeTo) {
      updatedJob.timeTo = jobData.timeTo;
    }
    
    if (jobData.location) {
      updatedJob.location = jobData.location;
    }
    
    if (jobData.description) {
      updatedJob.workDescription = jobData.description;
    }
    
    if (photoURLs && photoURLs.length > 0) {
      updatedJob.photos = photoURLs;
    }
    
    if (selectedParts && selectedParts.length > 0) {
      updatedJob.partsUsed = selectedParts.map(part => ({
        id: part.id || '',
        name: part.name || '',
        quantity: part.usedQuantity || 0
      }));
    }

    // Add optional fields only if they have values
    if (jobData.signingPerson) {
      updatedJob.signingPerson = jobData.signingPerson;
    }
    
    if (signatureURL) {
      updatedJob.signature = signatureURL;
    }

    console.log('Submitting job with data:', JSON.stringify(updatedJob, null, 2));

    // STEP 1: Update local cache FIRST (prevents unnecessary Firebase read when snapshot fires)
    console.log('📦 Workerjob: Updating local cache first...');
    await updateJob(jobId, updatedJob, true); // true = still pending (waiting status)
    
    // STEP 2: Use setDoc with merge to update Firebase
    console.log('🔥 Workerjob: Updating Firebase...');
    await setDoc(jobRef, updatedJob, { merge: true });
    
    console.log('✅ Workerjob: Job submitted successfully');
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return '#f59e0b';
      case 'received': return '#3b82f6';
      case 'waiting': return '#8b5cf6';
      case 'accepted': return '#10b981';
      case 'denied': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const handleOpenWaze = (location) => {
    if (!location) {
      alert.warning(
        language === 'en' ? 'No Location' : language === 'he' ? 'אין מיקום' : 'لا يوجد موقع',
        language === 'en' ? 'This job does not have a location set.' : language === 'he' ? 'למשימה זו אין מיקום מוגדר.' : 'هذه المهمة لا تحتوي على موقع محدد.'
      );
      return;
    }
    
    // Encode the location for URL
    const encodedLocation = encodeURIComponent(location);
    const wazeUrl = `https://waze.com/ul?q=${encodedLocation}`;
    
    // Open Waze with the location
    Linking.canOpenURL(wazeUrl)
      .then((supported) => {
        if (supported) {
          Linking.openURL(wazeUrl);
        } else {
          alert.error(
            language === 'en' ? 'Cannot Open Waze' : language === 'he' ? 'לא ניתן לפתוח Waze' : 'لا يمكن فتح Waze',
            language === 'en' ? 'Please make sure Waze is installed on your device.' : language === 'he' ? 'אנא וודא ש-Waze מותקן במכשיר שלך.' : 'يرجى التأكد من تثبيت Waze على جهازك.'
          );
        }
      })
      .catch((err) => {
        console.error('Error opening Waze:', err);
        alert.error(
          language === 'en' ? 'Error' : language === 'he' ? 'שגיאה' : 'خطأ',
          language === 'en' ? 'Failed to open Waze.' : language === 'he' ? 'נכשל לפתוח Waze.' : 'فشل في فتح Waze.'
        );
      });
  };

  const handleCallClient = (phoneNumber) => {
    if (!phoneNumber) {
      alert.warning(
        language === 'en' ? 'No Phone Number' : language === 'he' ? 'אין מספר טלפון' : 'لا يوجد رقم هاتف',
        language === 'en' ? 'This job does not have a client phone number.' : language === 'he' ? 'למשימה זו אין מספר טלפון של לקוח.' : 'هذه المهمة لا تحتوي على رقم هاتف العميل.'
      );
      return;
    }
    
    // Clean phone number (remove spaces, dashes, etc.)
    const cleanedPhone = phoneNumber.replace(/[^0-9+]/g, '');
    const phoneUrl = `tel:${cleanedPhone}`;
    
    // Open phone dialer
    Linking.canOpenURL(phoneUrl)
      .then((supported) => {
        if (supported) {
          Linking.openURL(phoneUrl);
        } else {
          alert.error(
            language === 'en' ? 'Cannot Make Call' : language === 'he' ? 'לא ניתן לבצע שיחה' : 'لا يمكن إجراء المكالمة',
            language === 'en' ? 'Unable to open phone dialer.' : language === 'he' ? 'לא ניתן לפתוח את חייגן הטלפון.' : 'غير قادر على فتح برنامج الاتصال.'
          );
        }
      })
      .catch((err) => {
        console.error('Error opening phone dialer:', err);
        alert.error(
          language === 'en' ? 'Error' : language === 'he' ? 'שגיאה' : 'خطأ',
          language === 'en' ? 'Failed to open phone dialer.' : language === 'he' ? 'נכשל לפתוח את חייגן הטלפון.' : 'فشل في فتح برنامج الاتصال.'
        );
      });
  };

  // Validate Israeli phone number and open WhatsApp
  const handleOpenWhatsApp = (phoneNumber) => {
    if (!phoneNumber) {
      alert.warning(
        language === 'en' ? 'No Phone Number' : language === 'he' ? 'אין מספר טלפון' : 'لا يوجد رقم هاتف',
        language === 'en' ? 'This job does not have a client phone number.' : language === 'he' ? 'למשימה זו אין מספר טלפון של לקוח.' : 'هذه المهمة لا تحتوي على رقم هاتف العميل.'
      );
      return;
    }
    
    // Clean the phone number - remove spaces, dashes, parentheses
    let cleanedPhone = phoneNumber.replace(/[^0-9+]/g, '');
    
    // Validate Israeli phone number format
    // Valid formats: 05XXXXXXXX, +97205XXXXXXXX, 97205XXXXXXXX
    // Israeli mobile numbers start with 05X (050, 052, 053, 054, 055, 058)
    const israeliMobileRegex = /^(?:\+?972|0)(5[0-9])([0-9]{7})$/;
    
    const match = cleanedPhone.match(israeliMobileRegex);
    
    if (!match) {
      alert.warning(
        t.invalidIsraeliPhone,
        t.invalidPhoneMessage
      );
      return;
    }
    
    // Convert to international format for WhatsApp (972XXXXXXXXX)
    const prefix = match[1]; // 50, 52, 53, 54, 55, 58
    const number = match[2]; // 7 digits
    const internationalNumber = `972${prefix}${number}`;
    
    // Open WhatsApp with the number
    const whatsappUrl = `https://wa.me/${internationalNumber}`;
    Linking.canOpenURL(whatsappUrl)
      .then((supported) => {
        if (supported) {
          Linking.openURL(whatsappUrl);
        } else {
          alert.error(
            language === 'en' ? 'WhatsApp Not Installed' : language === 'he' ? 'וואטסאפ לא מותקן' : 'واتساب غير مثبت',
            language === 'en' ? 'WhatsApp is not installed on this device.' : language === 'he' ? 'וואטסאפ לא מותקן במכשיר זה.' : 'واتساب غير مثبت على هذا الجهاز.'
          );
        }
      })
      .catch((err) => {
        console.error('Error opening WhatsApp:', err);
        alert.error(
          language === 'en' ? 'Error' : language === 'he' ? 'שגיאה' : 'خطأ',
          language === 'en' ? 'Failed to open WhatsApp.' : language === 'he' ? 'נכשל לפתוח וואטסאפ.' : 'فشل في فتح واتساب.'
        );
      });
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
        contentContainerStyle={{ paddingTop: 100, paddingBottom: Platform.OS === 'android' ? 220 + insets.bottom : 100 + insets.bottom }}
      >
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
              <Ionicons name="chevron-down" size={20} color="rgba(255,255,255,0.8)" />
            </LinearGradient>
          </TouchableOpacity>

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
                    {job.status === 'pending' && (
                      <TouchableOpacity
                        style={[styles.iconButton, styles.receiveIconButton]}
                        onPress={(e) => {
                          e.stopPropagation();
                          handleMarkReceived(job);
                        }}
                        activeOpacity={0.7}
                      >
                        <MaterialCommunityIcons name="check-circle" size={24} color="white" />
                      </TouchableOpacity>
                    )}
                    {(job.status === 'received' || job.status === 'denied') && (
                      <TouchableOpacity
                        style={[
                          styles.iconButton, 
                          styles.fillIconButton,
                          !canEditJob(job) && styles.disabledIconButton
                        ]}
                        onPress={(e) => {
                          e.stopPropagation();
                          if (canEditJob(job)) {
                            handleFillDetails(job);
                          } else {
                            alert.warning(
                              language === 'en' ? 'Cannot Edit' : language === 'he' ? 'לא ניתן לערוך' : 'لا يمكن التعديل',
                              language === 'en' ? 'Finished jobs cannot be edited by workers.' : language === 'he' ? 'משימות שהסתיימו לא ניתן לערוך על ידי עובדים.' : 'لا يمكن للعمال تعديل المهام المنتهية.'
                            );
                          }
                        }}
                        activeOpacity={0.7}
                        disabled={!canEditJob(job)}
                      >
                        <MaterialCommunityIcons name="pencil-box" size={24} color="white" />
                      </TouchableOpacity>
                    )}
                    {job.status === 'waiting' && (
                      <TouchableOpacity
                        style={[
                          styles.iconButton, 
                          styles.editIconButton,
                          !canEditJob(job) && styles.disabledIconButton
                        ]}
                        onPress={(e) => {
                          e.stopPropagation();
                          if (canEditJob(job)) {
                            handleFillDetails(job);
                          } else {
                            alert.warning(
                              language === 'en' ? 'Cannot Edit' : language === 'he' ? 'לא ניתן לערוך' : 'لا يمكن التعديل',
                              language === 'en' ? 'Finished jobs cannot be edited by workers.' : language === 'he' ? 'משימות שהסתיימו לא ניתן לערוך על ידי עובדים.' : 'لا يمكن للعمال تعديل المهام المنتهية.'
                            );
                          }
                        }}
                        activeOpacity={0.7}
                        disabled={!canEditJob(job)}
                      >
                        <MaterialCommunityIcons name="pencil" size={24} color="white" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                <Text style={[styles.jobDescription, { color: colors.textSecondary }]}>{job.description}</Text>
                {job.assignedBy && (
                  <Text style={[styles.jobDetails, { color: colors.textSecondary }]}>
                    {t.assignedBy}: {job.assignedBy}
                  </Text>
                )}
                {(job.clientName || job.clientPhone) && (
                  <Text style={[styles.jobCustomer, { color: colors.textSecondary }]}>
                    {job.clientName && `${t.clientName}: ${job.clientName}`}{job.clientName && job.clientPhone ? ' • ' : ''}{job.clientPhone && `${t.clientPhone}: ${job.clientPhone}`}
                  </Text>
                )}
                {job.dueDate && (
                  <Text style={[styles.jobDetails, { color: colors.textSecondary }]}>
                    {t.dueDate}: {job.dueDate}
                  </Text>
                )}
                {job.location && (
                  <Text style={[styles.jobLocation, { color: colors.textSecondary }]}>
                    <Text style={styles.locationLabel}>Location:</Text> {job.location}
                  </Text>
                )}
                <View style={styles.statusAndWazeRow}>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(job.status) }]}>
                    <Text style={styles.statusText}>{job.status || t.pending}</Text>
                  </View>
                  
                  {job.location && (
                    <TouchableOpacity
                      style={styles.wazeButton}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleOpenWaze(job.location);
                      }}
                      activeOpacity={0.7}
                    >
                      <Image 
                        source={require('../assets/icons8-waze-48.png')} 
                        style={styles.wazeIcon}
                      />
                    </TouchableOpacity>
                  )}
                  
                  {job.clientPhone && (
                    <TouchableOpacity
                      style={styles.phoneButton}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleCallClient(job.clientPhone);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.phoneIcon}>📞</Text>
                    </TouchableOpacity>
                  )}
                  
                  {job.clientPhone && (
                    <TouchableOpacity
                      style={styles.whatsappButton}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleOpenWhatsApp(job.clientPhone);
                      }}
                      activeOpacity={0.7}
                    >
                    <Ionicons
                      name="logo-whatsapp"
                      size={22}
                      color="#000000" // WhatsApp green
                    />
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollableContainer>

        {/* Edit Job Modal */}
        <Modal 
          visible={showEditModal && !showSignature && !showPhotoPicker && !showTimeFromPicker && !showTimeToPicker}
          transparent 
          animationType="slide"
          onRequestClose={() => {
            setShowEditModal(false);
            setEditingJob(null);
          }}
        >
          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            <TouchableOpacity
              style={{ flex: 1 }}
              activeOpacity={1}
              onPress={() => {
                setShowEditModal(false);
                setEditingJob(null);
              }}
            >
              <SafeAreaView style={{ flex: 1 }}>
                <View style={styles.modalContainer}>
                  <TouchableOpacity
                    activeOpacity={1}
                    onPress={(e) => e.stopPropagation()}
                    style={{ flex: 1 }}
                  >
                    <ScrollView 
                      style={styles.modalScrollView} 
                      contentContainerStyle={styles.modalScrollContent}
                      keyboardShouldPersistTaps="handled"
                    >
              <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                  {editingJob?.title || t.editJob}
                </Text>

                {/* Display Job Title (Read-only) */}
                <Text style={styles.readOnlyLabel}>{t.jobTitle}</Text>
                <View style={styles.readOnlyField}>
                  <Text style={styles.readOnlyText}>{editingJob?.title}</Text>
                </View>

                {/* Display Location (Read-only from manager) */}
                {editingJob?.location && (
                  <>
                    <Text style={styles.readOnlyLabel}>{t.location}</Text>
                    <View style={styles.readOnlyField}>
                      <Text style={styles.readOnlyText}>{editingJob?.location}</Text>
                    </View>
                  </>
                )}

                {/* Display Due Date (Read-only) */}
                {editingJob?.dueDate && (
                  <>
                    <Text style={styles.readOnlyLabel}>{t.dueDate}</Text>
                    <View style={styles.readOnlyField}>
                      <Text style={styles.readOnlyText}>{editingJob?.dueDate}</Text>
                    </View>
                  </>
                )}

                {/* Display Client Name (Read-only from manager) */}
                {editingJob?.clientName && (
                  <>
                    <Text style={styles.readOnlyLabel}>{t.clientName}</Text>
                    <View style={styles.readOnlyField}>
                      <Text style={styles.readOnlyText}>{editingJob?.clientName}</Text>
                    </View>
                  </>
                )}

                {/* Display Client Phone (Read-only from manager) */}
                {editingJob?.clientPhone && (
                  <>
                    <Text style={styles.readOnlyLabel}>{t.clientPhone}</Text>
                    <View style={styles.readOnlyField}>
                      <Text style={styles.readOnlyText}>{editingJob?.clientPhone}</Text>
                    </View>
                  </>
                )}

                <Text style={styles.requiredLabel}>{t.timeWorked} *</Text>
                <View style={styles.timeRow}>
                  <View style={styles.timePickerContainer}>
                    <Text style={styles.timeLabel}>{t.from}</Text>
                    <TouchableOpacity
                      style={styles.timePickerButton}
                      onPress={() => setShowTimeFromPicker(true)}
                    >
                      <Text style={styles.timePickerText}>
                        {jobData.timeFrom || 'Select Time'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  
                  <View style={styles.timePickerContainer}>
                    <Text style={styles.timeLabel}>{t.to}</Text>
                    <TouchableOpacity
                      style={styles.timePickerButton}
                      onPress={() => setShowTimeToPicker(true)}
                    >
                      <Text style={styles.timePickerText}>
                        {jobData.timeTo || 'Select Time'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <Text style={styles.requiredLabel}>{t.location} *</Text>
                <TextInput
                  style={styles.input}
                  placeholder={t.locationPlaceholder || 'Enter location'}
                  placeholderTextColor="#9ca3af"
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
                  <Text style={styles.locationButtonText}>{t.getLocation}</Text>
                </TouchableOpacity>

                <Text style={styles.requiredLabel}>{t.jobDescription} *</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder={t.descriptionPlaceholder || 'Enter job description'}
                  placeholderTextColor="#9ca3af"
                  value={jobData.description || ''}
                  onChangeText={(text) => setJobData({ ...jobData, description: text })}
                  multiline
                  numberOfLines={4}
                  returnKeyType="default"
                  blurOnSubmit={false}
                  textAlignVertical="top"
                />

                <Text style={styles.requiredLabel}>{t.photos} * (at least 1)</Text>
                <TouchableOpacity
                  style={styles.photoButton}
                  onPress={handleAddPhoto}
                  activeOpacity={0.7}
                >
                  <Text style={styles.photoButtonText}>{t.addPhoto}</Text>
                </TouchableOpacity>

                {jobData.photos.length > 0 && (
                  <ScrollView horizontal style={styles.photosContainer}>
                    {jobData.photos.map((photo, index) => (
                      <Image key={index} source={{ uri: photo }} style={styles.photo} />
                    ))}
                  </ScrollView>
                )}

                {/* Parts Selection */}
                <Text style={styles.label}>{t.partsUsed}</Text>
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
                      <View key={part.id} style={styles.selectedPartItem}>
                        <View style={styles.partIcon}>
                          <MaterialCommunityIcons name="wrench" size={26} color="#00ACC1" />
                        </View>
                        <Text style={styles.selectedPartName}>{part.name}</Text>
                        <View style={styles.partQuantityBadge}>
                          <Text style={styles.partQuantity}>{part.usedQuantity}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                <Text style={styles.requiredLabel}>{t.signingPerson} *</Text>
                <TextInput
                  style={styles.input}
                  placeholder={t.signingPersonPlaceholder || 'Enter name of person signing'}
                  placeholderTextColor="#9ca3af"
                  value={jobData.signingPerson || ''}
                  onChangeText={(text) => setJobData({ ...jobData, signingPerson: text })}
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  blurOnSubmit={true}
                />

                <Text style={styles.requiredLabel}>{t.clientSignature} *</Text>
                <TouchableOpacity
                  style={styles.signatureButton}
                  onPress={() => {
                    console.log('Setting showSignature to true');
                    setShowSignature(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.signatureButtonText}>
                    {jobData.signature ? '✓ Signature Added - Tap to Change' : '+ Add Client Signature'}
                  </Text>
                </TouchableOpacity>

                {jobData.signature && (
                  <Image source={{ uri: jobData.signature }} style={styles.signatureImage} />
                )}

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={handleModalClose}
                  >
                    <Text style={styles.modalButtonText}>{t.cancel}</Text>
                  </TouchableOpacity>
                  {/* Only show Continue Later for jobs not yet submitted */}
                  {(editingJob?.status === 'received' || editingJob?.status === 'denied') && (
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
                      {submitting ? t.submitting : t.submit}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
                </ScrollView>
                  </TouchableOpacity>
              </View>
            </SafeAreaView>
              </TouchableOpacity>
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
            setShowSignature(false);
            alert.success('Success', 'Signature saved!');
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
          assignedBy: t.assignedBy,
          worker: t.worker,
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
    paddingTop: 30,
    borderColor: '#271e1aff',
    borderRadius: 16,
    marginBottom: 20,
  },
  dateFilterButtonWrapper: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 12,
    ...shadows.small,
  },
  dateFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 10,
  },
  dateFilterButtonText: {
    flex: 1,
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
    fontSize: 18,
    fontWeight: 'bold',
    color: themeColors.primary,
  },
  jobTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  receiveIconButton: {
    backgroundColor: '#3b82f6',
  },
  fillIconButton: {
    backgroundColor: '#10b981',
  },
  editIconButton: {
    backgroundColor: '#f59e0b',
  },
  disabledIconButton: {
    backgroundColor: '#9ca3af',
    opacity: 0.5,
  },
  newBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  newBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  jobDescription: {
    fontSize: 14,
    marginBottom: 8,
  },
  jobDetails: {
    fontSize: 12,
    marginBottom: 4,
  },
  jobCustomer: {
    fontSize: 14,
    marginBottom: 4,
    fontWeight: '600',
  },
  jobLocation: {
    fontSize: 12,
    marginBottom: 12,
  },
  locationLabel: {
    fontWeight: '700',
    color: themeColors.secondary,
  },
  statusAndWazeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  statusBadge: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 6,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  wazeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#33CCFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  wazeIcon: {
    width: 28,
    height: 28,
    resizeMode: 'contain',
  },
  phoneButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#10b981',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  phoneIcon: {
    fontSize: 20,
  },
  whatsappButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#25D366',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  whatsappIcon: {
    fontSize: 20,
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  emptyText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 40,
  },
  modalContainer: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalScrollView: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 20,
    paddingBottom: Platform.OS === 'android' ? 100 : 40,
  },
  modalContent: {
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
    fontSize: 24,
    fontWeight: 'bold',
    color: themeColors.primary,
    marginBottom: 20,
    textAlign: 'center',
  },
  draftIndicator: {
    backgroundColor: '#10b981',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignSelf: 'center',
    marginBottom: 12,
  },
  draftText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
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
  readOnlyLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: themeColors.primary,
    marginBottom: 8,
  },
  readOnlyField: {
    borderWidth: 2,
    borderColor: themeColors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    backgroundColor: themeColors.surfaceAlt,
  },
  readOnlyText: {
    fontSize: 16,
    color: themeColors.textPrimary,
    fontWeight: '500',
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
    flex: 1,
    fontSize: 18,
    color: '#1f2937',
    fontWeight: '700',
  },
  selectedPartQty: {
    fontSize: 18,
    color: '#6b7280',
    fontWeight: 'bold',
  },
  partIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0, 172, 193, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  partQuantityBadge: {
    backgroundColor: '#00ACC1',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 16,
    minWidth: 50,
    alignItems: 'center',
  },
  partQuantity: {
    color: 'white',
    fontSize: 17,
    fontWeight: '700',
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
});