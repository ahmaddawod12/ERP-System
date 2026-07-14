import React, { useState, useEffect } from 'react';
import { View,
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
import NetInfo from '@react-native-community/netinfo';
import { getColors, gradients, spacing, borderRadius, typography, shadows } from '../../../theme';
import { AppButton, AppCard, AppText, TimePicker, PhotoPicker, SignaturePad, GlobalHeader, ScrollableContainer, ClientSelector, InventoryItemSearch, AppInput, ScreenHeroCard } from '../../../components';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { useOutbox } from '../../../contexts/OutboxContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTenant } from '../../../contexts/TenantContext';
import { storage } from '../../../contexts/mmkv-storage';
import { safeJsonParse } from '../../../utils/helpers';
import { logger } from '../../../utils/logger';
import { enqueueOutboxOperation } from '../../../lib/outbox/operations';
import type { OutboxOperationResult } from '../../../lib/outbox/processor';
import { queryClient, tenantQueryKey } from '../../../lib/query/client';
import type { Client, InventoryPart, JobFileRef, JobItem } from '../../../types';
import {
  getImmediateJobFileUri,
  resolveJobFileUri,
} from '../lib/job-file-utils';
import { stageFinishedJobAttachments } from '../lib/finished-job-outbox-attachments';
import {
  buildAssignedJobCompletionOutboxPayload,
  buildFinishedJobOutboxPayload,
} from '../lib/finished-job-outbox-model';
import { styles } from './FillJob.styles';
import { generateTempId, getFillJobDraftStorageKey, type EditableJob, type FillJobDraft, type FillJobFormData, type FillJobMode, type FillJobPart } from '../lib/fill-job-model';

export default function FillJob() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { user: sessionUser } = useSession();
  const { workspace } = useTenant();
  const {
    database: outboxDatabase,
    ready: outboxReady,
    synchronizeOperation,
    refresh: refreshOutbox,
  } = useOutbox();
  const insets = useSafeAreaInsets();
  const { getCompanyId, profile, addJob, inventory: cachedInventory, clients: cachedClients, addClient, updateClient, fetchClients } = useCache();
  const colors = getColors(isDarkMode);

  // Determine if we're in user mode or worker mode
  const mode: FillJobMode = params.mode === 'worker' ? 'worker' : 'user';
  const editingJob = safeJsonParse<EditableJob | null>(params.job, null);
  const existingDraft = safeJsonParse<FillJobDraft | null>(params.draft, null);
  const draftJobData = existingDraft?.jobData;

  const [selectedClientObj, setSelectedClientObj] = useState<Client | null>(
    editingJob?.cid ? { id: String(editingJob.cid), cname: editingJob.cname || '', cphone: editingJob.cphone || '' } : null
  );

  const [jobData, setJobData] = useState<FillJobFormData>({
    title: editingJob?.title || draftJobData?.title || '',
    timeFrom: editingJob?.timeFrom || draftJobData?.timeFrom || '',
    timeTo: editingJob?.timeTo || draftJobData?.timeTo || '',
    location: editingJob?.location || draftJobData?.location || '',
    description: editingJob?.description || draftJobData?.description || '',
    cname: editingJob?.cname || draftJobData?.cname || '',
    cphone: editingJob?.cphone || draftJobData?.cphone || '',
    photos: editingJob?.photos || draftJobData?.photos || [],
    signingPerson: editingJob?.signingPerson || draftJobData?.signingPerson || '',
    signature: editingJob?.signature || draftJobData?.signature || null,
  });

  const [showSignature, setShowSignature] = useState(false);
  const [showTimeFromPicker, setShowTimeFromPicker] = useState(false);
  const [showTimeToPicker, setShowTimeToPicker] = useState(false);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [inventory, setInventory] = useState<InventoryPart[]>([]);
  const [selectedParts, setSelectedParts] = useState<FillJobPart[]>(editingJob?.partsUsed || existingDraft?.selectedParts || []);
  const [partsSearchText, setPartsSearchText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshedSignatureURL, setRefreshedSignatureURL] = useState<string | null>(null);
  const [signatureLoading, setSignatureLoading] = useState(false);
  const [resolvedPhotoPreviewUrls, setResolvedPhotoPreviewUrls] = useState<string[]>([]);

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
    photosMetric: 'Photos',
    partsMetric: 'Parts',
    modeMetric: 'Mode',
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
    photosMetric: 'תמונות',
    partsMetric: 'חלקים',
    modeMetric: 'מצב',
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
    photosMetric: 'الصور',
    partsMetric: 'القطع',
    modeMetric: 'الوضع',
  };

  const refreshSignatureURL = async (signatureRef: string | JobFileRef | null) => {
    if (!signatureRef) {
      logger.debug('No signature URL to refresh');
      setRefreshedSignatureURL(null);
      return null;
    }

    try {
      setSignatureLoading(true);
      const companyId = getCompanyId();
      const currentJobId = editingJob?.id || null;
      const freshURL = await resolveJobFileUri(signatureRef, companyId, currentJobId);
      
      logger.debug('Fresh signature URL obtained');
      setRefreshedSignatureURL(freshURL);
      return freshURL;
    } catch (error) {
      logger.error('Error refreshing signature URL:', error);
      setRefreshedSignatureURL(null);
      return null;
    } finally {
      setSignatureLoading(false);
    }
  };

  const refreshPhotoPreviewUrls = async (photos: Array<string | JobFileRef>) => {
    try {
      const companyId = getCompanyId();
      const currentJobId = editingJob?.id || null;
      const nextUrls = await Promise.all(
        (Array.isArray(photos) ? photos : []).map((photo) => resolveJobFileUri(photo, companyId, currentJobId)),
      );
      setResolvedPhotoPreviewUrls(nextUrls.filter((value): value is string => Boolean(value)));
    } catch (error) {
      logger.error('Error resolving photo preview URLs:', error);
      setResolvedPhotoPreviewUrls([]);
    }
  };

  useEffect(() => {
    loadInventory();
    const partsSelectionCallback = (globalThis as typeof globalThis & { onPartsSelected?: unknown }).onPartsSelected;
    
    // Fetch clients if not already cached
    const companyId = getCompanyId();
    if (mode === 'user' && cachedClients.length === 0 && companyId) {
      void fetchClients(companyId);
    }
    
    // Debug: Log signature data
    logger.debug('FillJob component loaded', {
      editingJob,
      editingSignature: editingJob?.signature,
      jobSignature: jobData.signature,
    });
    
    // Check if returning from parts selection
    if (partsSelectionCallback && params.returnFromParts) {
      // Parts already updated via global callback
    }
  }, []);

  useEffect(() => {
    void refreshPhotoPreviewUrls(jobData.photos);
  }, [editingJob?.id, jobData.photos]);

  useEffect(() => {
    if (!jobData.signature) {
      setRefreshedSignatureURL(null);
      return;
    }
    void refreshSignatureURL(jobData.signature);
  }, [editingJob?.id, jobData.signature]);

  // Watch for cached inventory changes and re-sync local state
  useEffect(() => {
    logger.debug('FillJob: cached inventory updated; re-syncing local inventory');
    loadInventory();
  }, [cachedInventory]);

  const loadInventory = () => {
    try {
      // Use cached inventory from CacheContext (cachedInventory is an array)
      if (cachedInventory && Array.isArray(cachedInventory)) {
        logger.debug('FillJob: loading inventory from cache', cachedInventory.length, 'parts');
        setInventory(cachedInventory);
      } else {
        setInventory([]);
      }
    } catch (error) {
      logger.error('Error loading inventory:', error);
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
      logger.error('Error getting location:', error);
      alert.error('Error', 'Failed to get location');
    }
  };

  const handlePhotosSelected = (photos: Array<string | JobFileRef>) => {
    setJobData({ ...jobData, photos });
    setResolvedPhotoPreviewUrls(
      (Array.isArray(photos) ? photos : [])
        .map((photo) => getImmediateJobFileUri(photo))
        .filter((value): value is string => Boolean(value)),
    );
    setShowPhotoPicker(false);
  };

  const handleSignature = (signature: string | JobFileRef) => {
    setJobData({ ...jobData, signature });
    setShowSignature(false);
    
    setRefreshedSignatureURL(getImmediateJobFileUri(signature));
    
    setTimeout(() => {
      alert.success('Success', 'Signature saved!');
    }, 300);
  };

  // Travel distance handler - manual input validation
  const handleTravelDistanceChange = (text: string) => {
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

  const validateForm = () => {
    // User mode requires title, worker mode doesn't
    if (mode === 'user' && !jobData.title) {
      alert.error('Error', t.fillAllFields);
      return false;
    }

    if (
      !jobData.timeFrom
      || !jobData.timeTo
      || !jobData.signingPerson
      || (mode === 'user' && (!jobData.location || !jobData.description || !jobData.cname))
    ) {
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

  const showSavedOffline = () => {
    alert.success(
      language === 'en'
        ? 'Saved Offline'
        : language === 'he'
        ? '\u05e0\u05e9\u05de\u05e8 \u05d1\u05de\u05e6\u05d1 \u05dc\u05d0 \u05de\u05e7\u05d5\u05d5\u05df'
        : '\u062a\u0645 \u0627\u0644\u062d\u0641\u0638 \u062f\u0648\u0646 \u0627\u062a\u0635\u0627\u0644',
      language === 'en'
        ? 'Job saved locally and will sync when you are back online.'
        : language === 'he'
        ? '\u05d4\u05de\u05e9\u05d9\u05de\u05d4 \u05e0\u05e9\u05de\u05e8\u05d4 \u05de\u05e7\u05d5\u05de\u05d9\u05ea \u05d5\u05ea\u05e1\u05ea\u05e0\u05db\u05e8\u05df \u05db\u05e9\u05ea\u05d7\u05d6\u05d5\u05e8 \u05dc\u05d7\u05d9\u05d1\u05d5\u05e8.'
        : '\u062a\u0645 \u062d\u0641\u0638 \u0627\u0644\u0645\u0647\u0645\u0629 \u0645\u062d\u0644\u064a\u064b\u0627 \u0648\u0633\u062a\u062a\u0645 \u0645\u0632\u0627\u0645\u0646\u062a\u0647\u0627 \u0639\u0646\u062f \u0639\u0648\u062f\u0629 \u0627\u0644\u0627\u062a\u0635\u0627\u0644.',
    );
  };

  const showSynchronizationOutcome = (result: OutboxOperationResult) => {
    if (result.outcome === 'reconciled') {
      alert.success('Success', t.success);
      return;
    }
    if (result.outcome === 'conflict') {
      alert.error(
        'Job changed on the server',
        'Your work is preserved in Pending Work. Review the latest job before retrying or discarding it.',
      );
      return;
    }
    if (result.outcome === 'terminal') {
      alert.error(
        'Job was not submitted',
        'The server rejected this operation. Your work is preserved in Pending Work for review or discard.',
      );
      return;
    }
    if (result.outcome === 'retry') {
      alert.warning(
        'Saved for retry',
        'Your work is safely stored on this device and will retry when connectivity is restored.',
      );
      return;
    }
    alert.info(
      'Saved to Pending Work',
      'Your work is safely queued on this device and has not been confirmed by the server yet.',
    );
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
      if (!sessionUser || !workspace || !outboxReady || !outboxDatabase) {
        throw new Error('The encrypted offline outbox is not ready');
      }
      const jobId = editingJob?.id || generateTempId();
      const currentDate = new Date();
      const networkState = await NetInfo.fetch();
      const isOnline = Boolean(networkState.isConnected && networkState.isInternetReachable !== false);

      // Auto-save new client or update existing client with missing fields
      let clientId = selectedClientObj?.id || null;
      if (mode === 'user' && isOnline && selectedClientObj && jobData.cname.trim()) {
        // Update existing client with any newly filled fields
        try {
          const updates: { name?: string; phone?: string } = {};
          if (jobData.cname.trim() && jobData.cname.trim() !== (selectedClientObj.name || '')) updates.name = jobData.cname.trim();
          if (jobData.cphone?.trim() && jobData.cphone.trim() !== (selectedClientObj.phone || '')) updates.phone = jobData.cphone.trim();
          if (Object.keys(updates).length > 0) {
            await updateClient(selectedClientObj.id, updates);
            logger.debug('Updated existing client with new fields:', Object.keys(updates));
          }
        } catch (e) {
          logger.debug('Update client failed (non-critical):', e);
        }
      } else if (mode === 'user' && isOnline && !selectedClientObj && jobData.cname.trim()) {
        // Save as new client
        try {
          const clientToSave: { name: string; phone?: string } = { name: jobData.cname.trim() };
          if (jobData.cphone?.trim()) clientToSave.phone = jobData.cphone.trim();
          const savedClient = await addClient(clientToSave);
          if (savedClient) clientId = savedClient.id;
        } catch (e) {
          logger.debug('Auto-save client failed (non-critical):', e);
        }
      }

      const jobToSave = {
        title: jobData.title,
        timeFrom: jobData.timeFrom,
        timeTo: jobData.timeTo,
        location: jobData.location,
        travelDistance: travelDistance ? parseFloat(travelDistance) : null,
        description: jobData.description,
        cname: jobData.cname,
        cphone: jobData.cphone || '',
        ...(clientId && { cid: clientId }),
        signingPerson: jobData.signingPerson,
        photos: jobData.photos,
        signature: jobData.signature || undefined,
        status: 'finished' as const,
        wid: profile?.wid ? String(profile.wid) : undefined,
        wname: profile?.name || '',
        finishedAt: currentDate.toISOString(),
        updatedAt: currentDate.toISOString(),
        isCert: false, // New field for tax invoice tracking
        partsUsed: selectedParts.map(part => ({
          id: part.id,
          name: part.name,
          quantity: part.usedQuantity || part.quantity
        })),
      };

      if (mode === 'user') {
        if (!jobData.signature) {
          throw new Error('A client signature is required');
        }

        const payload = buildFinishedJobOutboxPayload({
          title: jobData.title,
          description: jobData.description,
          location: jobData.location,
          clientId,
          assigneeMemberNo: profile?.wid ?? null,
          timeFrom: jobData.timeFrom,
          timeTo: jobData.timeTo,
          signingPerson: jobData.signingPerson,
          travelDistance,
          parts: selectedParts,
        });
        const attachments = await stageFinishedJobAttachments({
          userId: sessionUser.id,
          photos: jobData.photos,
          signature: jobData.signature,
        });
        const operationId = await enqueueOutboxOperation({
          database: outboxDatabase,
          companyId: workspace.companyId,
          kind: 'job.create_finished',
          payload,
          attachments,
        });
        addJob({
          ...jobToSave,
          id: operationId,
          photos: jobData.photos,
          signature: jobData.signature,
          pendingSync: true,
        });
        storage.remove(getFillJobDraftStorageKey(mode, jobId));

        let synchronizationResult: OutboxOperationResult | null = null;
        if (isOnline) {
          try {
            synchronizationResult = await synchronizeOperation(operationId);
          } catch (syncError) {
            logger.warn('Finished job remains queued after synchronization failed', syncError);
            synchronizationResult = { operationId, outcome: 'queued' };
          }
        } else {
          void refreshOutbox().catch((refreshError) => {
            logger.warn('Could not refresh the pending-work list after enqueue', refreshError);
          });
        }
        void queryClient.invalidateQueries({
          queryKey: tenantQueryKey(sessionUser.id, workspace.companyId, 'jobs'),
        }).catch((queryError) => {
          logger.warn('Could not refresh the jobs list after enqueue', queryError);
        });

        alert.hideLoading();
        if (synchronizationResult) {
          showSynchronizationOutcome(synchronizationResult);
        } else {
          showSavedOffline();
        }
        setTimeout(() => {
          router.back();
        }, 500);
        return;
      }

      if (!editingJob?.id || !editingJob.entityVersion) {
        throw new Error('The assigned job is missing its current entity version');
      }
      if (!jobData.signature) {
        throw new Error('A client signature is required');
      }

      const completionPayload = buildAssignedJobCompletionOutboxPayload({
        jobId: editingJob.id,
        entityVersion: editingJob.entityVersion,
        timeFrom: jobData.timeFrom,
        timeTo: jobData.timeTo,
        signingPerson: jobData.signingPerson,
        travelDistance,
        parts: selectedParts,
      });
      const attachments = await stageFinishedJobAttachments({
        userId: sessionUser.id,
        photos: jobData.photos,
        signature: jobData.signature,
      });
      const operationId = await enqueueOutboxOperation({
        database: outboxDatabase,
        companyId: workspace.companyId,
        kind: 'job.complete_assigned',
        payload: completionPayload,
        entityVersion: editingJob.entityVersion,
        attachments,
      });
      storage.remove(getFillJobDraftStorageKey(mode, editingJob.id));

      let synchronizationResult: OutboxOperationResult | null = null;
      if (isOnline) {
        try {
          synchronizationResult = await synchronizeOperation(operationId);
        } catch (syncError) {
          logger.warn('Assigned-job completion remains queued after synchronization failed', syncError);
          synchronizationResult = { operationId, outcome: 'queued' };
        }
      } else {
        void refreshOutbox().catch((refreshError) => {
          logger.warn('Could not refresh the pending-work list after enqueue', refreshError);
        });
      }
      void queryClient.invalidateQueries({
        queryKey: tenantQueryKey(sessionUser.id, workspace.companyId, 'jobs'),
      }).catch((queryError) => {
        logger.warn('Could not refresh the jobs list after completion enqueue', queryError);
      });

      alert.hideLoading();
      if (synchronizationResult) {
        showSynchronizationOutcome(synchronizationResult);
      } else {
        showSavedOffline();
      }
      setTimeout(() => {
        router.back();
      }, 500);
    } catch (error) {
      logger.error('Error saving job:', error);
      alert.hideLoading();
      alert.error('Error', 'Failed to save job');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    try {
      const draftKey = getFillJobDraftStorageKey(mode, editingJob?.id ? String(editingJob.id) : null);
      const draftData = {
        jobData,
        selectedParts,
        travelDistance,
        timestamp: Date.now(),
      };
      storage.set(draftKey, JSON.stringify(draftData));
      alert.success('Success', t.draftSaved);
      router.back();
    } catch (error) {
      logger.error('Error saving draft:', error);
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
          <ScreenHeroCard
            title={editingJob ? t.editJob : t.fillJob}
            subtitle={mode === 'user' ? t.jobDescription : t.clientInfo}
            eyebrow="Jobs"
            icon="clipboard-text-outline"
            iconLibrary="material"
            accentColor={colors.boxIndigo}
            metrics={[
              { label: t.photosMetric, value: String(jobData.photos.length) },
              { label: t.partsMetric, value: String(selectedParts.length) },
              { label: t.modeMetric, value: String(mode) },
            ]}
            badges={[t.clientInfo, t.timeWorked, t.clientSignature]}
            style={styles.heroCard}
          />

          {/* Job Title Card (User mode only) */}
          {mode === 'user' && (
            <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
              <View style={styles.cardHeader}>
                <MaterialCommunityIcons name="briefcase" size={20} color={colors.secondary} />
                <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
                  {t.jobTitle} *
                </AppText>
              </View>
              <AppInput
                inputStyle={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
                placeholder={t.jobTitle}
                value={jobData.title}
                onChangeText={(text) => setJobData({ ...jobData, title: text })}
              />
            </AppCard>
          )}

          {/* Client Information Card - with embedded client search */}
          <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
            <View style={styles.cardHeader}>
              <Ionicons name="person" size={20} color={colors.secondary} />
              <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.clientInfo}
              </AppText>
            </View>

            {/* Embedded client selector (search + dropdown) */}
            {mode === 'user' && (
              <ClientSelector
                clients={cachedClients}
                onSelect={(client) => {
                  setSelectedClientObj(client);
                  setJobData(prev => ({
                    ...prev,
                    cname: client.cname || client.name || '',
                    cphone: client.cphone || client.phone || '',
                  }));
                }}
                selectedClient={selectedClientObj}
                onClear={() => {
                  setSelectedClientObj(null);
                  setJobData(prev => ({ ...prev, cname: '', cphone: '' }));
                }}
                colors={colors}
                language={language}
              />
            )}

            {/* Client fields - always visible, pre-filled when client selected */}
            <AppInput
              inputStyle={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder={t.clientName + (mode === 'user' ? ' *' : '')}
              value={jobData.cname}
              onChangeText={(text) => setJobData({ ...jobData, cname: text })}
              editable={mode === 'user'}
            />
            <AppInput
              inputStyle={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder={t.clientPhone}
              value={jobData.cphone}
              onChangeText={(text) => setJobData({ ...jobData, cphone: text })}
              keyboardType="phone-pad"
              editable={mode === 'user'}
            />

          </AppCard>

          {/* Time Worked Card */}
          <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
            <View style={styles.cardHeader}>
              <Ionicons name="time" size={20} color={colors.secondary} />
              <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.timeWorked} *
              </AppText>
            </View>
            <View style={styles.timeRow}>
              <View style={styles.timeColumn}>
                <AppText style={[styles.timeLabel, { color: colors.textSecondary }]}>{t.from}</AppText>
                <TouchableOpacity
                  style={[styles.timeButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setShowTimeFromPicker(true)}
                >
                  <AppText style={[styles.timeText, { color: colors.textPrimary }]}>
                    {jobData.timeFrom || 'HH:MM'}
                  </AppText>
                </TouchableOpacity>
              </View>

              <View style={styles.timeColumn}>
                <AppText style={[styles.timeLabel, { color: colors.textSecondary }]}>{t.to}</AppText>
                <TouchableOpacity
                  style={[styles.timeButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setShowTimeToPicker(true)}
                >
                  <AppText style={[styles.timeText, { color: colors.textPrimary }]}>
                    {jobData.timeTo || 'HH:MM'}
                  </AppText>
                </TouchableOpacity>
              </View>
            </View>
          </AppCard>

          {/* Location Card */}
          <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
            <View style={styles.cardHeader}>
              <Ionicons name="location" size={20} color={colors.secondary} />
              <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.location}{mode === 'user' ? ' *' : ''}
              </AppText>
            </View>
            <AppInput
              inputStyle={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder={t.locationPlaceholder}
              value={jobData.location}
              onChangeText={(text) => setJobData({ ...jobData, location: text })}
              editable={mode === 'user'}
            />
            {mode === 'user' && (
              <AppButton
                title={t.getLocation}
                iconLeft={{ name: 'navigate-outline' }}
                onPress={handleGetLocation}
                style={styles.locationButton}
              />
            )}
          </AppCard>

          {/* Travel Distance Card */}
          <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="map-marker-distance" size={20} color={colors.primary} />
              <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.travelDistance}
              </AppText>
            </View>
            
            <View style={styles.travelDistanceContainer}>
              <AppInput
                inputStyle={[
                  styles.input, 
                  styles.travelDistanceInput,
                  { 
                    color: colors.textPrimary, 
                    backgroundColor: colors.background, 
                    borderColor: travelDistanceError ? colors.error : colors.border 
                  }
                ]}
                placeholder={t.travelDistancePlaceholder}
                value={travelDistance}
                onChangeText={handleTravelDistanceChange}
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
              <View style={[styles.travelDistanceUnit, { backgroundColor: colors.primary }]}>
                <AppText style={styles.travelDistanceUnitText}>{t.travelDistanceUnit}</AppText>
              </View>
            </View>
            {travelDistanceError ? (
              <AppText style={[styles.errorText, { color: colors.error }]}>{travelDistanceError}</AppText>
            ) : null}
          </AppCard>

          {/* Description Card */}
          <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="text" size={20} color={colors.secondary} />
              <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.jobDescription}{mode === 'user' ? ' *' : ''}
              </AppText>
            </View>
            <AppInput
              inputStyle={[styles.input, styles.textArea, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder={t.descriptionPlaceholder}
              value={jobData.description}
              onChangeText={(text) => setJobData({ ...jobData, description: text })}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              editable={mode === 'user'}
            />
          </AppCard>

          {/* Photos Card */}
          <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
            <View style={styles.cardHeader}>
              <Ionicons name="images" size={20} color={colors.secondary} />
              <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.photos} * ({jobData.photos.length}/5)
              </AppText>
            </View>
            <AppButton
              title={t.addPhoto}
              iconLeft={{ name: 'camera-outline' }}
              onPress={() => setShowPhotoPicker(true)}
              style={styles.actionButton}
            />

            {jobData.photos.length > 0 && (
              <ScrollView horizontal style={styles.photosList}>
                {resolvedPhotoPreviewUrls.map((photoUri, index) => (
                  <Image key={index} source={{ uri: photoUri }} style={styles.photoPreview} />
                ))}
              </ScrollView>
            )}
          </AppCard>

          {/* Parts Used Card */}
          <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="cog" size={20} color={colors.secondary} />
              <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.partsUsed}
              </AppText>
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
                placeholder={language === 'en' ? 'Search parts to add...' : language === 'he' ? 'חפש חלקים להוספה...' : 'ابحث عن قطع لإضافتها...'}
                colors={colors}
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, marginHorizontal: 0, marginBottom: 0 }]}
              />
            </View>

            {selectedParts.length > 0 && (
              <View style={styles.partsList}>
                {selectedParts.map((part) => (
                  <View key={part.id} style={[styles.partItem, { backgroundColor: colors.background }]}>
                    <View style={{ flex: 1 }}>
                      <AppText style={[styles.partName, { color: colors.textPrimary }]}>{part.name}</AppText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: spacing.sm }}>
                        <AppText style={{ fontSize: 12, color: colors.textSecondary }}>
                          {language === 'en' ? 'Qty:' : language === 'he' ? 'כמות:' : 'الكمية:'}
                        </AppText>
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
                            <AppText style={{ fontSize: 16, fontWeight: '700', color: colors.textPrimary }}>−</AppText>
                          </TouchableOpacity>
                          <AppText style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary, minWidth: 24, textAlign: 'center' }}>
                            {part.usedQuantity || 1}
                          </AppText>
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
                            <AppText style={{ fontSize: 16, fontWeight: '700', color: 'white' }}>+</AppText>
                          </TouchableOpacity>
                        </View>
                        <AppText style={{ fontSize: 11, color: colors.textSecondary }}>
                          / {part.quantity || '∞'}
                        </AppText>
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
          </AppCard>

          {/* Signature Card */}
          <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="draw" size={20} color={colors.secondary} />
              <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t.clientSignature} *
              </AppText>
            </View>

            {/* Show existing signature prominently if it exists */}
            {jobData.signature && (
              <View style={[styles.signatureContainer, { backgroundColor: colors.background, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.md }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                  <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
                  <AppText style={[styles.signatureLabel, { color: colors.success, marginLeft: spacing.xs, marginBottom: 0 }]}>
                    {t.existingSignature || 'Existing Signature:'}
                  </AppText>
                </View>
                
                {signatureLoading ? (
                  <View style={[styles.signaturePreview, { borderColor: colors.border, marginTop: 0, justifyContent: 'center', alignItems: 'center' }]}>
                    <ActivityIndicator size="large" color={colors.secondary} />
                    <AppText style={[{ color: colors.textSecondary, marginTop: spacing.sm }]}>Loading signature...</AppText>
                  </View>
                ) : refreshedSignatureURL ? (
                  <Image 
                    source={{ uri: refreshedSignatureURL }} 
                    style={[styles.signaturePreview, { borderColor: colors.border, marginTop: 0 }]} 
                    resizeMode="contain"
                    onError={(error) => {
                      logger.error('Signature image failed to load from the refreshed URL:', error?.nativeEvent || error);
                      logger.debug('Refreshed signature URI:', refreshedSignatureURL);
                    }}
                    onLoad={() => {
                      logger.debug('Signature image loaded successfully from refreshed URL');
                    }}
                  />
                ) : (
                  <View style={[styles.signaturePreview, { borderColor: colors.border, marginTop: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }]}>
                    <MaterialCommunityIcons name="image-off" size={48} color={colors.textSecondary} />
                    <AppText style={[{ color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' }]}>
                      Signature not available
                    </AppText>
                  </View>
                )}
              </View>
            )}

            <AppInput
              inputStyle={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder={t.signingPerson + ' *'}
              value={jobData.signingPerson}
              onChangeText={(text) => setJobData({ ...jobData, signingPerson: text })}
            />
            <AppButton
              title={jobData.signature ? t.changeSignature || 'Change Signature' : t.addSignature}
              iconLeft={{ name: 'create-outline' }}
              onPress={() => setShowSignature(true)}
              variant={jobData.signature ? 'secondary' : 'primary'}
              style={styles.actionButton}
            />
          </AppCard>

          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            <AppButton
              title={t.cancel}
              variant="secondary"
              style={[styles.button, styles.cancelButton]}
              onPress={() => router.back()}
            />

            {!editingJob && (
              <AppButton
                title={t.saveDraft}
                variant="success"
                style={[styles.button, styles.draftButton]}
                onPress={handleSaveDraft}
              />
            )}

            <AppButton
              title={t.submit}
              style={[styles.button, styles.submitButton]}
              onPress={handleSubmit}
              disabled={submitting || !outboxReady || (mode === 'worker' && !editingJob?.entityVersion)}
              loading={submitting}
            />
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
