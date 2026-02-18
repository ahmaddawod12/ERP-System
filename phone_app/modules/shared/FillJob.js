import React, { useState, useEffect } from 'react';
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
  SafeAreaView,
  KeyboardAvoidingView,
  Keyboard,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db, storage, FieldValue, doc, getDoc, setDoc, updateDoc } from '../../firebase';
import { getColors, gradients, spacing, borderRadius, typography, shadows } from '../../theme';
import { TimePicker, PhotoPicker, SignaturePad, GlobalHeader, ScrollableContainer, ClientSelector, InventoryItemSearch } from '../../components';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAlert } from '../../contexts/AlertContext';
import { useCache } from '../../contexts/CacheContext';
import { generateFinishedJobId } from '../../utils/helpers';



export default function FillJob() {
  const {
    updateJob,
    moveJobToFinished,
    incrementDocumentVersion,
    getDataForDateRange,
    isWithinCacheRange
  } = useCache();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const insets = useSafeAreaInsets();
  const { getCompanyId, getUid, profile, addJob, inventory: cachedInventory, updateInventory, clients: cachedClients, addClient, updateClient, fetchClients } = useCache();
  const colors = getColors(isDarkMode);

  // Determine if we're in user mode or worker mode
  const mode = params.mode || 'user'; // 'user' or 'worker'
  const editingJob = params.job ? JSON.parse(params.job) : null;
  const existingDraft = params.draft ? JSON.parse(params.draft) : null;

  const [selectedClientObj, setSelectedClientObj] = useState(
    editingJob?.clientId ? { id: editingJob.clientId, name: editingJob.clientName || '', phone: editingJob.clientPhone || '' } : null
  );

  const [jobData, setJobData] = useState({
    title: editingJob?.title || existingDraft?.title || '',
    timeFrom: editingJob?.timeFrom || existingDraft?.timeFrom || '',
    timeTo: editingJob?.timeTo || existingDraft?.timeTo || '',
    location: editingJob?.location || existingDraft?.location || '',
    description: editingJob?.description || existingDraft?.description || '',
    clientName: editingJob?.clientName || editingJob?.customerName || existingDraft?.clientName || '',
    clientPhone: editingJob?.clientPhone || editingJob?.customerPhone || existingDraft?.clientPhone || '',
    photos: editingJob?.photos || existingDraft?.photos || [],
    signingPerson: editingJob?.signingPerson || existingDraft?.signingPerson || '',
    signature: editingJob?.signature || existingDraft?.signature || null,
  });

  const [showSignature, setShowSignature] = useState(false);
  const [showTimeFromPicker, setShowTimeFromPicker] = useState(false);
  const [showTimeToPicker, setShowTimeToPicker] = useState(false);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [inventory, setInventory] = useState([]);
  const [selectedParts, setSelectedParts] = useState(editingJob?.partsUsed || existingDraft?.selectedParts || []);
  const [partsSearchText, setPartsSearchText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshedSignatureURL, setRefreshedSignatureURL] = useState(null);
  const [signatureLoading, setSignatureLoading] = useState(false);

  // Travel distance state - manual input (km)
  const [travelDistance, setTravelDistance] = useState(
    editingJob?.travelDistance?.toString() || existingDraft?.travelDistance?.toString() || ''
  );
  const [travelDistanceError, setTravelDistanceError] = useState('');

  const t = language === 'en' ? {
    fillJob: 'Fill Job Details',
    editJob: 'Edit Job',
    jobTitle: 'Job Title',
    timeWorked: 'Time Worked',
    from: 'From (HH:MM)',
    to: 'To (HH:MM)',
    location: 'Job Location',
    locationPlaceholder: 'Enter address or location',
    getLocation: 'Get Current Location',
    travelDistance: 'Travel Distance (Optional)',
    travelDistancePlaceholder: 'Enter distance in km',
    travelDistanceUnit: 'km',
    travelDistanceInvalid: 'Please enter a valid distance (0-9999 km)',
    clientInfo: 'Client Information',
    clientName: 'Client Name',
    clientNamePlaceholder: 'Enter client name',
    clientPhone: 'Client Phone',
    clientPhonePlaceholder: 'Enter phone number',
    clientEmail: 'Client Email',
    clientEmailPlaceholder: 'Enter email address',
    clientAddress: 'Client Address',
    clientAddressPlaceholder: 'Enter address',
    jobDescription: 'Job Description',
    descriptionPlaceholder: 'Describe what you did...',
    photos: 'Photos',
    addPhoto: 'Add Photo',
    partsUsed: 'Parts Used',
    selectParts: 'Select Parts',
    clientSignature: 'Client Signature',
    signingPerson: 'Signing Person',
    signingPersonPlaceholder: 'Name of person signing',
    addSignature: 'Add Signature',
    changeSignature: 'Change Signature',
    existingSignature: 'Existing Signature:',
    submit: 'Submit Job',
    submitting: 'Submitting...',
    cancel: 'Cancel',
    saveDraft: 'Save Draft',
    fillAllFields: 'Please fill all required fields',
    success: 'Job submitted successfully!',
    draftSaved: 'Draft saved successfully!',
    invalidTime: 'End time must be after start time',
    addAtLeastOnePhoto: 'Please add at least one photo',
    addSignatureRequired: 'Please add client signature',
  } : language === 'he' ? {
    fillJob: 'מילוי פרטי עבודה',
    editJob: 'עריכת עבודה',
    jobTitle: 'כותרת עבודה',
    timeWorked: 'זמן עבודה',
    from: 'מ- (HH:MM)',
    to: 'עד (HH:MM)',
    location: 'מיקום העבודה',
    locationPlaceholder: 'הזן כתובת או מיקום',
    getLocation: 'קבל מיקום נוכחי',
    travelDistance: 'מרחק נסיעה (אופציונלי)',
    travelDistancePlaceholder: 'הזן מרחק בק"מ',
    travelDistanceUnit: 'ק"מ',
    travelDistanceInvalid: 'אנא הזן מרחק תקין (0-9999 ק"מ)',
    clientInfo: 'מידע על הלקוח',
    clientName: 'שם הלקוח',
    clientNamePlaceholder: 'הזן שם לקוח',
    clientPhone: 'טלפון לקוח',
    clientPhonePlaceholder: 'הזן מספר טלפון',
    clientEmail: 'אימייל לקוח',
    clientEmailPlaceholder: 'הזן כתובת אימייל',
    clientAddress: 'כתובת לקוח',
    clientAddressPlaceholder: 'הזן כתובת',
    jobDescription: 'תיאור העבודה',
    descriptionPlaceholder: 'תאר מה עשית...',
    photos: 'תמונות',
    addPhoto: 'הוסף תמונה',
    partsUsed: 'חלקים שנעשה בהם שימוש',
    selectParts: 'בחר חלקים',
    clientSignature: 'חתימת לקוח',
    signingPerson: 'אדם חותם',
    signingPersonPlaceholder: 'שם האדם החותם',
    addSignature: 'הוסף חתימה',
    changeSignature: 'שנה חתימה',
    existingSignature: 'חתימה קיימת:',
    submit: 'שלח עבודה',
    submitting: 'שולח...',
    cancel: 'ביטול',
    saveDraft: 'שמור טיוטה',
    fillAllFields: 'אנא מלא את כל השדות הנדרשים',
    success: 'העבודה נשלחה בהצלחה!',
    draftSaved: 'הטיוטה נשמרה בהצלחה!',
    invalidTime: 'זמן סיום חייב להיות אחרי זמן התחלה',
    addAtLeastOnePhoto: 'אנא הוסף לפחות תמונה אחת',
    addSignatureRequired: 'אנא הוסף חתימת לקוח',
  } : {
    fillJob: 'ملء تفاصيل العمل',
    editJob: 'تعديل العمل',
    jobTitle: 'عنوان العمل',
    timeWorked: 'وقت العمل',
    from: 'من (HH:MM)',
    to: 'إلى (HH:MM)',
    location: 'موقع العمل',
    locationPlaceholder: 'أدخل العنوان أو الموقع',
    getLocation: 'احصل على الموقع الحالي',
    travelDistance: 'مسافة السفر (اختياري)',
    travelDistancePlaceholder: 'أدخل المسافة بالكيلومتر',
    travelDistanceUnit: 'كم',
    travelDistanceInvalid: 'يرجى إدخال مسافة صالحة (0-9999 كم)',
    clientInfo: 'معلومات العميل',
    clientName: 'اسم العميل',
    clientNamePlaceholder: 'أدخل اسم العميل',
    clientPhone: 'هاتف العميل',
    clientPhonePlaceholder: 'أدخل رقم الهاتف',
    clientEmail: 'بريد العميل الإلكتروني',
    clientEmailPlaceholder: 'أدخل البريد الإلكتروني',
    clientAddress: 'عنوان العميل',
    clientAddressPlaceholder: 'أدخل العنوان',
    jobDescription: 'وصف العمل',
    descriptionPlaceholder: 'صف ما قمت به...',
    photos: 'الصور',
    addPhoto: 'إضافة صورة',
    partsUsed: 'القطع المستخدمة',
    selectParts: 'اختر القطع',
    clientSignature: 'توقيع العميل',
    signingPerson: 'الشخص الموقع',
    signingPersonPlaceholder: 'اسم الشخص الموقع',
    addSignature: 'إضافة توقيع',
    changeSignature: 'تغيير التوقيع',
    existingSignature: 'التوقيع الحالي:',
    submit: 'إرسال العمل',
    submitting: 'جاري الإرسال...',
    cancel: 'إلغاء',
    saveDraft: 'حفظ المسودة',
    fillAllFields: 'يرجى ملء جميع الحقول المطلوبة',
    success: 'تم إرسال العمل بنجاح!',
    draftSaved: 'تم حفظ المسودة بنجاح!',
    invalidTime: 'يجب أن يكون وقت الانتهاء بعد وقت البدء',
    addAtLeastOnePhoto: 'الرجاء إضافة صورة واحدة على الأقل',
    addSignatureRequired: 'الرجاء إضافة توقيع العميل',
  };

  // Function to extract storage path and get fresh download URL
  const refreshSignatureURL = async (signatureURL) => {
    if (!signatureURL || typeof signatureURL !== 'string') {
      console.log('No signature URL to refresh');
      return null;
    }

    try {
      setSignatureLoading(true);
      console.log('🔄 Refreshing signature URL from Firebase Storage...');
      
      // Extract storage path from the URL
      // URL format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?alt=media&token={token}
      const urlParts = signatureURL.split('/o/');
      if (urlParts.length < 2) {
        console.warn('Invalid Firebase Storage URL format');
        return signatureURL; // Return original if can't parse
      }
      
      const encodedPath = urlParts[1].split('?')[0];
      const storagePath = decodeURIComponent(encodedPath);
      
      console.log('📁 Storage path:', storagePath);
      
      // Get fresh download URL from Firebase Storage
      const storageRef = storage().ref(storagePath);
      const freshURL = await storageRef.getDownloadURL();
      
      console.log('✅ Fresh signature URL obtained');
      setRefreshedSignatureURL(freshURL);
      setSignatureLoading(false);
      return freshURL;
    } catch (error) {
      console.error('❌ Error refreshing signature URL:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      setSignatureLoading(false);
      
      // If file not found, return null to hide the image
      if (error.code === 'storage/object-not-found') {
        console.warn('⚠️ Signature file not found in storage');
        return null;
      }
      
      // For other errors, try to use the original URL
      return signatureURL;
    }
  };

  useEffect(() => {
    loadInventory();
    
    // Fetch clients if not already cached
    if (cachedClients.length === 0) {
      fetchClients();
    }
    
    // Debug: Log signature data
    console.log('=== FillJob Component Loaded ===');
    console.log('editingJob:', editingJob);
    console.log('editingJob?.signature:', editingJob?.signature);
    console.log('jobData.signature:', jobData.signature);
    console.log('==============================');
    
    // Refresh signature URL if it exists
    if (jobData.signature) {
      refreshSignatureURL(jobData.signature);
    }
    
    // Check if returning from parts selection
    if (global.onPartsSelected && params.returnFromParts) {
      // Parts already updated via global callback
      delete params.returnFromParts;
    }
  }, []);

  // Watch for cached inventory changes and re-sync local state
  useEffect(() => {
    console.log('📦 FillJob: cached inventory updated - re-syncing local inventory');
    loadInventory();
  }, [cachedInventory]);

  const loadInventory = () => {
    try {
      // Use cached inventory from CacheContext (cachedInventory is an array)
      if (cachedInventory && Array.isArray(cachedInventory)) {
        console.log('📦 [CACHE READ] FillJob - Loading inventory from cache:', cachedInventory.length, 'parts');
        setInventory(cachedInventory);
      } else {
        setInventory([]);
      }
    } catch (error) {
      console.error('Error loading inventory:', error);
      setInventory([]);
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

  const handlePhotosSelected = (photos) => {
    setJobData({ ...jobData, photos });
    setShowPhotoPicker(false);
  };

  const handleSignature = (signature) => {
    setJobData({ ...jobData, signature });
    setShowSignature(false);
    
    // Set the refreshed URL to the local signature URI so it displays immediately
    setRefreshedSignatureURL(signature);
    
    setTimeout(() => {
      alert.success('Success', 'Signature saved!');
    }, 300);
  };

  // Travel distance handler - manual input validation
  const handleTravelDistanceChange = (text) => {
    // Allow empty string or numbers with optional decimal point
    const cleanedText = text.replace(/[^0-9.]/g, '');
    
    // Prevent multiple decimal points
    const decimalCount = (cleanedText.match(/\./g) || []).length;
    if (decimalCount > 1) return;
    
    setTravelDistance(cleanedText);
    
    // Validate
    if (cleanedText === '') {
      setTravelDistanceError('');
    } else {
      const numValue = parseFloat(cleanedText);
      if (isNaN(numValue) || numValue < 0 || numValue > 9999) {
        setTravelDistanceError(t.travelDistanceInvalid);
      } else {
        setTravelDistanceError('');
      }
    }
  };

  const uploadFileToStorage = async (uri, uid, jobId, fileName) => {
    try {
      // Skip if already uploaded
      if (uri.startsWith('https://firebasestorage.googleapis.com') || 
          uri.startsWith('https://storage.googleapis.com')) {
        return uri;
      }

      const storageRef = storage().ref(`${uid}/jobs/${jobId}/${fileName}`);
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

  const uploadJobFiles = async (uid, jobId, photos, signature) => {
    const photoURLs = [];
    let signatureURL = null;

    // Upload photos
    for (let i = 0; i < photos.length; i++) {
      const photoURL = await uploadFileToStorage(photos[i], uid, jobId, `photo_${i + 1}.jpg`);
      photoURLs.push(photoURL);
    }

    // Upload signature
    if (signature) {
      signatureURL = await uploadFileToStorage(signature, uid, jobId, 'signature.png');
    }

    return { photoURLs, signatureURL };
  };

  const validateForm = () => {
    // User mode requires title, worker mode doesn't
    if (mode === 'user' && !jobData.title) {
      alert.error('Error', t.fillAllFields);
      return false;
    }

    if (!jobData.timeFrom || !jobData.timeTo || !jobData.location || 
        !jobData.description || !jobData.clientName || !jobData.signingPerson) {
      alert.error('Error', t.fillAllFields);
      return false;
    }

    // Validate time
    const [startHour, startMin] = jobData.timeFrom.split(':').map(Number);
    const [endHour, endMin] = jobData.timeTo.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    if (endMinutes <= startMinutes) {
      alert.error('Error', t.invalidTime);
      return false;
    }

    if (jobData.photos.length === 0) {
      alert.error('Error', t.addAtLeastOnePhoto);
      return false;
    }

    if (!jobData.signature) {
      alert.error('Error', t.addSignatureRequired);
      return false;
    }

    return true;
  };

  const decreaseInventoryParts = async (uid) => {
    try {
      if (!selectedParts || selectedParts.length === 0) {
        console.log('No parts to deduct from inventory');
        return;
      }

      // Use cached inventory instead of fetching from Firebase (cachedInventory is an array)
      console.log('📦 Using cached inventory to deduct parts');
      let partsArray = Array.isArray(cachedInventory) ? [...cachedInventory] : [];

      // If cache is empty, fetch from Firebase as fallback
      if (partsArray.length === 0) {
        console.warn('⚠️ Cached inventory is empty, fetching from Firebase...');
        const inventoryRef = doc(db, uid, 'inventory');
        const inventorySnap = await getDoc(inventoryRef);
        if (inventorySnap.exists()) {
          const inventoryDoc = inventorySnap.data();
          partsArray = Array.isArray(inventoryDoc.parts) ? inventoryDoc.parts : [];
        }
      }

      // Deduct parts from cached inventory array
      selectedParts.forEach(usedPart => {
        const partIndex = partsArray.findIndex(p => p.id === usedPart.id);
        if (partIndex !== -1) {
          const currentQty = parseInt(partsArray[partIndex].quantity) || 0;
          const usedQty = parseInt(usedPart.usedQuantity || usedPart.quantity) || 0;
          const newQty = Math.max(0, currentQty - usedQty);
          
          partsArray[partIndex] = {
            ...partsArray[partIndex],
            quantity: newQty
          };
          console.log(`📦 Deducting ${usedQty} of ${partsArray[partIndex].name} from inventory. New qty: ${newQty}`);
        }
      });

      // Update cache (this also updates Firebase and increments cache version)
      await updateInventory(partsArray);
      
      console.log('✅ Inventory deducted, cache and Firebase updated, cache version incremented');
    } catch (error) {
      console.error('❌ Error decreasing inventory:', error);
      throw error;
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!validateForm()) return;

    setSubmitting(true);
    alert.loading(
      language === 'en' ? 'Saving Job' : language === 'he' ? 'שומר משימה' : 'حفظ المهمة',
      language === 'en' ? 'Please wait while we save your job details...' : 
      language === 'he' ? 'אנא המתן בזמן שאנו שומרים את פרטי המשימה...' : 
      'يرجى الانتظار بينما نحفظ تفاصيل مهمتك...'
    );
    try {
      const user = auth.currentUser;
      const uid = getUid() || user.uid;
      const jobId = editingJob?.id || generateFinishedJobId();
      const currentDate = new Date();

      // Get user profile from cache
      const companyId = getCompanyId();

      if (!companyId) {
        throw new Error('User does not belong to a company');
      }

      // Upload files
      const { photoURLs, signatureURL } = await uploadJobFiles(
        uid,
        jobId,
        jobData.photos,
        jobData.signature
      );

      // Auto-save new client or update existing client with missing fields
      let clientId = selectedClientObj?.id || null;
      if (selectedClientObj && jobData.clientName.trim()) {
        // Update existing client with any newly filled fields
        try {
          const updates = {};
          if (jobData.clientName.trim() && jobData.clientName.trim() !== (selectedClientObj.name || '')) updates.name = jobData.clientName.trim();
          if (jobData.clientPhone?.trim() && jobData.clientPhone.trim() !== (selectedClientObj.phone || '')) updates.phone = jobData.clientPhone.trim();
          if (jobData.clientEmail?.trim() && jobData.clientEmail.trim() !== (selectedClientObj.email || '')) updates.email = jobData.clientEmail.trim();
          if (jobData.clientAddress?.trim() && jobData.clientAddress.trim() !== (selectedClientObj.address || '')) updates.address = jobData.clientAddress.trim();
          if (Object.keys(updates).length > 0) {
            await updateClient(selectedClientObj.id, updates);
            console.log('✅ Updated existing client with new fields:', Object.keys(updates));
          }
        } catch (e) {
          console.log('Update client failed (non-critical):', e);
        }
      } else if (!selectedClientObj && jobData.clientName.trim()) {
        // Save as new client
        try {
          const clientToSave = { name: jobData.clientName.trim() };
          if (jobData.clientPhone?.trim()) clientToSave.phone = jobData.clientPhone.trim();
          if (jobData.clientEmail?.trim()) clientToSave.email = jobData.clientEmail.trim();
          if (jobData.clientAddress?.trim()) clientToSave.address = jobData.clientAddress.trim();
          const savedClient = await addClient(clientToSave);
          if (savedClient) clientId = savedClient.id;
        } catch (e) {
          console.log('Auto-save client failed (non-critical):', e);
        }
      }

      const jobToSave = {
        ...(mode === 'user' && { title: jobData.title }),
        timeFrom: jobData.timeFrom,
        timeTo: jobData.timeTo,
        location: jobData.location,
        travelDistance: travelDistance ? parseFloat(travelDistance) : null,
        description: jobData.description,
        clientName: jobData.clientName,
        clientPhone: jobData.clientPhone || '',
        ...(clientId && { clientId }),
        signingPerson: jobData.signingPerson,
        photos: photoURLs,
        signature: signatureURL,
        status: mode === 'user' ? 'finished' : 'waiting',
        completedBy: uid,
        name: profile?.name || '',
        finishedAt: currentDate.toISOString(),
        updatedAt: currentDate.toISOString(),
        isCert: false, // New field for tax invoice tracking
        partsUsed: selectedParts.map(part => ({
          id: part.id,
          name: part.name,
          quantity: part.usedQuantity || part.quantity
        })),
      };

      // Save to appropriate location
      if (mode === 'user') {
        console.log('💾 FillJob: Saving user finished job...');
        
        // STEP 1: Add to local cache FIRST (prevents unnecessary Firebase read when snapshot fires)
        console.log('📦 FillJob: Adding to local cache first...');
        await addJob({ ...jobToSave, id: jobId }, false);
        
        // STEP 2: Save to Firebase
        console.log('🔥 FillJob: Saving to Firestore...', jobId);
        await setDoc(doc(db, 'companies', companyId, 'finishedJobs', jobId), {
          ...jobToSave,
        });
        
        console.log('✅ FillJob: Job saved successfully');
        
        // Decrease inventory after job is successfully saved
        if (selectedParts && selectedParts.length > 0) {
          console.log('📦 FillJob: Deducting parts from inventory...');
          await decreaseInventoryParts(uid);
        }
      } else {
        console.log('💾 FillJob: Updating worker pending job in Firestore...', jobId);
        
        // Worker mode: update existing job
        // Note: Firestore trigger will automatically send push notification to manager when status changes to 'waiting'
        await updateDoc(doc(db, 'companies', companyId, 'PendingJobs', jobId), jobToSave);
        
        console.log('✅ FillJob: Worker job updated in Firestore');
        
        // Update local cache and increment versions
        console.log('📦 FillJob: Updating job in local cache...');
        await updateJob(jobId, jobToSave, true); // true = is company job (increments both worker and company cache)
        
        console.log('✅ FillJob: Cache updated successfully');
        // Note: Inventory is deducted when manager ACCEPTS the job in ManageJobs.js
      }

      // Clear draft
      const draftKey = mode === 'user' ? 'userjobDraft' : `workerjobDraft_${jobId}`;
      await AsyncStorage.removeItem(draftKey);

      alert.hideLoading();
      alert.success('Success', t.success);
      
      // Navigate back
      setTimeout(() => {
        router.back();
      }, 500);
    } catch (error) {
      console.error('Error saving job:', error);
      alert.hideLoading();
      alert.error('Error', 'Failed to save job');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    try {
      const draftKey = mode === 'user' ? 'userjobDraft' : `workerjobDraft_${editingJob?.id}`;
      const draftData = {
        jobData,
        selectedParts,
        travelDistance,
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(draftKey, JSON.stringify(draftData));
      alert.success('Success', t.draftSaved);
      router.back();
    } catch (error) {
      console.error('Error saving draft:', error);
      alert.error('Error', 'Failed to save draft');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollableContainer 
          style={styles.scrollView}
          contentContainerStyle={{ paddingBottom: Platform.OS === 'android' ? 180 + insets.bottom : 120 + insets.bottom }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <LinearGradient
            colors={gradients.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.header}
          >
            <Text style={styles.headerTitle}>
              {editingJob ? t.editJob : t.fillJob}
            </Text>
          </LinearGradient>

          {/* Job Title Card (User mode only) */}
          {mode === 'user' && (
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <View style={styles.cardHeader}>
                <MaterialCommunityIcons name="briefcase" size={20} color={colors.secondary} />
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                  {t.jobTitle} *
                </Text>
              </View>
              <TextInput
                style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
                placeholder={t.jobTitle}
                placeholderTextColor={colors.textSecondary}
                value={jobData.title}
                onChangeText={(text) => setJobData({ ...jobData, title: text })}
              />
            </View>
          )}

          {/* Client Information Card - with embedded client search */}
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="person" size={20} color={colors.secondary} />
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.clientInfo}
              </Text>
            </View>

            {/* Embedded client selector (search + dropdown) */}
            <ClientSelector
              clients={cachedClients}
              onSelect={(client) => {
                setSelectedClientObj(client);
                setJobData(prev => ({
                  ...prev,
                  clientName: client.name || '',
                  clientPhone: client.phone || '',
                  clientEmail: client.email || '',
                  clientAddress: client.address || '',
                }));
              }}
              selectedClient={selectedClientObj}
              onClear={() => {
                setSelectedClientObj(null);
                setJobData(prev => ({ ...prev, clientName: '', clientPhone: '', clientEmail: '', clientAddress: '' }));
              }}
              colors={colors}
              language={language}
            />

            {/* Client fields - always visible, pre-filled when client selected */}
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder={t.clientName + ' *'}
              placeholderTextColor={colors.textSecondary}
              value={jobData.clientName}
              onChangeText={(text) => setJobData({ ...jobData, clientName: text })}
            />
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder={t.clientPhone}
              placeholderTextColor={colors.textSecondary}
              value={jobData.clientPhone}
              onChangeText={(text) => setJobData({ ...jobData, clientPhone: text })}
              keyboardType="phone-pad"
            />
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder={t.clientEmail}
              placeholderTextColor={colors.textSecondary}
              value={jobData.clientEmail || ''}
              onChangeText={(text) => setJobData({ ...jobData, clientEmail: text })}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder={t.clientAddress}
              placeholderTextColor={colors.textSecondary}
              value={jobData.clientAddress || ''}
              onChangeText={(text) => setJobData({ ...jobData, clientAddress: text })}
            />
          </View>

          {/* Time Worked Card */}
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="time" size={20} color={colors.secondary} />
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.timeWorked} *
              </Text>
            </View>
            <View style={styles.timeRow}>
              <View style={styles.timeColumn}>
                <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>{t.from}</Text>
                <TouchableOpacity
                  style={[styles.timeButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setShowTimeFromPicker(true)}
                >
                  <Text style={[styles.timeText, { color: colors.textPrimary }]}>
                    {jobData.timeFrom || 'HH:MM'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.timeColumn}>
                <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>{t.to}</Text>
                <TouchableOpacity
                  style={[styles.timeButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setShowTimeToPicker(true)}
                >
                  <Text style={[styles.timeText, { color: colors.textPrimary }]}>
                    {jobData.timeTo || 'HH:MM'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Location Card */}
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="location" size={20} color={colors.secondary} />
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.location} *
              </Text>
            </View>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder={t.locationPlaceholder}
              placeholderTextColor={colors.textSecondary}
              value={jobData.location}
              onChangeText={(text) => setJobData({ ...jobData, location: text })}
            />
            <TouchableOpacity
              style={[styles.locationButton, { backgroundColor: colors.secondary }]}
              onPress={handleGetLocation}
            >
              <Ionicons name="navigate" size={18} color="white" />
              <Text style={styles.locationButtonText}>{t.getLocation}</Text>
            </TouchableOpacity>
          </View>

          {/* Travel Distance Card */}
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="map-marker-distance" size={20} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.travelDistance}
              </Text>
            </View>
            
            <View style={styles.travelDistanceContainer}>
              <TextInput
                style={[
                  styles.input, 
                  styles.travelDistanceInput,
                  { 
                    color: colors.textPrimary, 
                    backgroundColor: colors.background, 
                    borderColor: travelDistanceError ? colors.error : colors.border 
                  }
                ]}
                placeholder={t.travelDistancePlaceholder}
                placeholderTextColor={colors.textSecondary}
                value={travelDistance}
                onChangeText={handleTravelDistanceChange}
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
              <View style={[styles.travelDistanceUnit, { backgroundColor: colors.primary }]}>
                <Text style={styles.travelDistanceUnitText}>{t.travelDistanceUnit}</Text>
              </View>
            </View>
            {travelDistanceError ? (
              <Text style={[styles.errorText, { color: colors.error }]}>{travelDistanceError}</Text>
            ) : null}
          </View>

          {/* Description Card */}
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="text" size={20} color={colors.secondary} />
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.jobDescription} *
              </Text>
            </View>
            <TextInput
              style={[styles.input, styles.textArea, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder={t.descriptionPlaceholder}
              placeholderTextColor={colors.textSecondary}
              value={jobData.description}
              onChangeText={(text) => setJobData({ ...jobData, description: text })}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          {/* Photos Card */}
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="images" size={20} color={colors.secondary} />
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.photos} * ({jobData.photos.length}/5)
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.secondary }]}
              onPress={() => setShowPhotoPicker(true)}
            >
              <Ionicons name="camera" size={18} color="white" />
              <Text style={styles.actionButtonText}>{t.addPhoto}</Text>
            </TouchableOpacity>

            {jobData.photos.length > 0 && (
              <ScrollView horizontal style={styles.photosList}>
                {jobData.photos.map((photo, index) => (
                  <Image key={index} source={{ uri: photo }} style={styles.photoPreview} />
                ))}
              </ScrollView>
            )}
          </View>

          {/* Parts Used Card */}
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="cog" size={20} color={colors.secondary} />
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.partsUsed}
              </Text>
            </View>

            {/* Inline part search using InventoryItemSearch */}
            <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.sm }}>
              <InventoryItemSearch
                value={partsSearchText}
                onChangeText={setPartsSearchText}
                inventoryParts={inventory}
                onSelectPart={(part) => {
                  // Check if part already selected
                  const existing = selectedParts.find(p => p.id === part.id || p.name === part.name);
                  if (existing) {
                    alert.info(
                      language === 'en' ? 'Already Added' : language === 'he' ? 'כבר נוסף' : 'تمت الإضافة بالفعل',
                      language === 'en' ? 'This part is already in your list' : language === 'he' ? 'חלק זה כבר ברשימה שלך' : 'هذا الجزء موجود بالفعل في قائمتك'
                    );
                    return;
                  }
                  setSelectedParts(prev => [...prev, {
                    id: part.id || part.name,
                    name: part.name,
                    quantity: part.quantity,
                    usedQuantity: 1,
                  }]);
                  // Clear the search box after adding
                  setPartsSearchText('');
                }}
                placeholder={t.searchParts || (language === 'en' ? 'Search parts to add...' : language === 'he' ? 'חפש חלקים להוספה...' : 'ابحث عن قطع لإضافتها...')}
                colors={colors}
                style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border, marginHorizontal: 0, marginBottom: 0 }]}
              />
            </View>

            {selectedParts.length > 0 && (
              <View style={styles.partsList}>
                {selectedParts.map((part) => (
                  <View key={part.id} style={[styles.partItem, { backgroundColor: colors.background }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.partName, { color: colors.textPrimary }]}>{part.name}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: spacing.sm }}>
                        <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                          {language === 'en' ? 'Qty:' : language === 'he' ? 'כמות:' : 'الكمية:'}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <TouchableOpacity
                            onPress={() => {
                              const current = part.usedQuantity || 1;
                              if (current > 1) {
                                setSelectedParts(prev => prev.map(p => p.id === part.id ? { ...p, usedQuantity: current - 1 } : p));
                              }
                            }}
                            style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' }}
                          >
                            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.textPrimary }}>−</Text>
                          </TouchableOpacity>
                          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary, minWidth: 24, textAlign: 'center' }}>
                            {part.usedQuantity || 1}
                          </Text>
                          <TouchableOpacity
                            onPress={() => {
                              const current = part.usedQuantity || 1;
                              const max = part.quantity || 999;
                              if (current < max) {
                                setSelectedParts(prev => prev.map(p => p.id === part.id ? { ...p, usedQuantity: current + 1 } : p));
                              }
                            }}
                            style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.secondary, justifyContent: 'center', alignItems: 'center' }}
                          >
                            <Text style={{ fontSize: 16, fontWeight: '700', color: 'white' }}>+</Text>
                          </TouchableOpacity>
                        </View>
                        <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                          / {part.quantity || '∞'}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => setSelectedParts(prev => prev.filter(p => p.id !== part.id))}
                      style={{ padding: 4 }}
                    >
                      <MaterialCommunityIcons name="close-circle" size={22} color={colors.error || '#EF4444'} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Signature Card */}
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="draw" size={20} color={colors.secondary} />
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.clientSignature} *
              </Text>
            </View>

            {/* Show existing signature prominently if it exists */}
            {jobData.signature && typeof jobData.signature === 'string' && jobData.signature.trim() !== '' && (
              <View style={[styles.signatureContainer, { backgroundColor: colors.background, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.md }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                  <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
                  <Text style={[styles.signatureLabel, { color: colors.success, marginLeft: spacing.xs, marginBottom: 0 }]}>
                    {t.existingSignature || 'Existing Signature:'}
                  </Text>
                </View>
                
                {signatureLoading ? (
                  <View style={[styles.signaturePreview, { borderColor: colors.border, marginTop: 0, justifyContent: 'center', alignItems: 'center' }]}>
                    <ActivityIndicator size="large" color={colors.secondary} />
                    <Text style={[{ color: colors.textSecondary, marginTop: spacing.sm }]}>Loading signature...</Text>
                  </View>
                ) : refreshedSignatureURL ? (
                  <Image 
                    source={{ uri: refreshedSignatureURL }} 
                    style={[styles.signaturePreview, { borderColor: colors.border, marginTop: 0 }]} 
                    resizeMode="contain"
                    onError={(error) => {
                      console.error('=== Signature Image Load Error (Refreshed URL) ===');
                      console.error('Error details:', error?.nativeEvent || error);
                      console.log('Refreshed Signature URI:', refreshedSignatureURL);
                    }}
                    onLoad={() => {
                      console.log('✅ Signature image loaded successfully from refreshed URL');
                    }}
                  />
                ) : (
                  <View style={[styles.signaturePreview, { borderColor: colors.border, marginTop: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }]}>
                    <MaterialCommunityIcons name="image-off" size={48} color={colors.textSecondary} />
                    <Text style={[{ color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' }]}>
                      Signature not available
                    </Text>
                  </View>
                )}
              </View>
            )}

            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder={t.signingPerson + ' *'}
              placeholderTextColor={colors.textSecondary}
              value={jobData.signingPerson}
              onChangeText={(text) => setJobData({ ...jobData, signingPerson: text })}
            />
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: jobData.signature ? colors.warning : colors.secondary }]}
              onPress={() => setShowSignature(true)}
            >
              <MaterialCommunityIcons name="gesture-tap" size={18} color="white" />
              <Text style={styles.actionButtonText}>
                {jobData.signature ? t.changeSignature || 'Change Signature' : t.addSignature}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton, { backgroundColor: colors.textSecondary }]}
              onPress={() => router.back()}
            >
              <Text style={styles.buttonText}>{t.cancel}</Text>
            </TouchableOpacity>

            {!editingJob && (
              <TouchableOpacity
                style={[styles.button, styles.draftButton, { backgroundColor: colors.warning }]}
                onPress={handleSaveDraft}
              >
                <Text style={styles.buttonText}>{t.saveDraft}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.button, styles.submitButton, { backgroundColor: colors.success }, submitting && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              <Text style={styles.buttonText}>{t.submit}</Text>
            </TouchableOpacity>
          </View>
        </ScrollableContainer>
      </KeyboardAvoidingView>

      {/* Time From Picker */}
      <TimePicker
        visible={showTimeFromPicker}
        onClose={() => setShowTimeFromPicker(false)}
        onConfirm={(time) => {
          setJobData({ ...jobData, timeFrom: time });
          setShowTimeFromPicker(false);
        }}
        title={t.from}
        initialHour={7}
        initialMinute={0}
      />

      {/* Time To Picker */}
      <TimePicker
        visible={showTimeToPicker}
        onClose={() => setShowTimeToPicker(false)}
        onConfirm={(time) => {
          setJobData({ ...jobData, timeTo: time });
          setShowTimeToPicker(false);
        }}
        title={t.to}
        initialHour={7}
        initialMinute={0}
      />

      {/* Photo Picker */}
      <PhotoPicker
        visible={showPhotoPicker}
        onClose={() => setShowPhotoPicker(false)}
        onPhotosSelected={handlePhotosSelected}
        maxPhotos={5}
        existingPhotos={jobData.photos}
      />

      {/* Signature Pad */}
      <Modal
        visible={showSignature}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowSignature(false)}
      >
        <SignaturePad
          onSave={handleSignature}
          onCancel={() => setShowSignature(false)}
        />
      </Modal>

      <GlobalHeader />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    paddingVertical: 40,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '600',
    color: 'white',
    textAlign: 'center',
  },
  card: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
    padding: 0,
    borderRadius: 12,
    overflow: 'hidden',
    borderLeftWidth: 4,
    borderLeftColor: '#00ACC1',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: 'rgba(0, 172, 193, 0.08)',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginLeft: spacing.sm,
    flex: 1,
  },
  input: {
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    marginBottom: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
    paddingTop: 14,
  },
  timeRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  timeColumn: {
    flex: 1,
  },
  timeLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: spacing.xs,
    opacity: 0.7,
  },
  timeButton: {
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
  },
  timeText: {
    fontSize: 15,
    fontWeight: '500',
  },
  locationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: 8,
    gap: spacing.sm,
  },
  locationButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  travelDistanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  travelDistanceInput: {
    flex: 1,
    marginBottom: 0,
    marginHorizontal: 0,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  travelDistanceUnit: {
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  travelDistanceUnitText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 12,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    borderRadius: 8,
    gap: spacing.sm,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  photosList: {
    marginTop: spacing.md,
    paddingLeft: spacing.lg,
  },
  photoPreview: {
    width: 90,
    height: 90,
    borderRadius: 8,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
  },
  partsList: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  partItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 8,
    gap: spacing.sm,
    backgroundColor: 'rgba(0, 172, 193, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0, 172, 193, 0.15)',
  },
  partName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  partBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#00ACC1',
  },
  partBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '700',
  },
  signatureContainer: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  signatureLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: spacing.sm,
    opacity: 0.7,
  },
  signaturePreview: {
    width: '100%',
    height: 160,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#10B981',
    backgroundColor: '#FFFFFF',
  },
  actionButtons: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    flex: 0.8,
  },
  draftButton: {
    flex: 1,
  },
  submitButton: {
    flex: 1.2,
  },
  buttonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
});