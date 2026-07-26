import React, { useState, useEffect } from 'react';
import {
  Platform,
  SafeAreaView,
  KeyboardAvoidingView,
 } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { getColors } from '../../../theme';
import { TimePicker, PhotoPicker, SignaturePad, GlobalHeader, ScrollableContainer } from '../../../components';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import {
  useCacheLifecycle,
  useDirectoryCache,
  useInventoryCache,
  useJobsCache,
} from '../../../contexts/CacheContext';
import { useOutbox } from '../../../contexts/OutboxContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTenant } from '../../../contexts/TenantContext';
import { storage } from '../../../contexts/mmkv-storage';
import { safeJsonParse } from '../../../utils/helpers';
import { logger } from '../../../utils/logger';
import AccessibleModal from '../../../components/feedback/AccessibleModal';
import FillJobForm from '../components/FillJobForm';
import { enqueueOutboxOperation } from '../../../lib/outbox/operations';
import type { OutboxOperationResult } from '../../../lib/outbox/processor';
import { invalidateTenantQueries } from '../../../lib/query/client';
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
import { getFillJobCopy } from '../lib/fill-job-copy';
import { generateTempId, getFillJobDraftStorageKey, validateFillJobForm, type EditableJob, type FillJobDraft, type FillJobFormData, type FillJobMode, type FillJobPart } from '../lib/fill-job-model';

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
  const { getCompanyId, profile } = useCacheLifecycle();
  const { addJob } = useJobsCache();
  const { inventory: cachedInventory } = useInventoryCache();
  const {
    clients: cachedClients,
    addClient,
    updateClient,
    fetchClients,
  } = useDirectoryCache();
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

  const t = getFillJobCopy(language);

  const refreshSignatureURL = async (signatureRef: string | JobFileRef | null) => {
    if (!signatureRef) {
      logger.debug('No signature URL to refresh');
      setRefreshedSignatureURL(null);
      return null;
    }

    try {
      setSignatureLoading(true);
      const companyId = Number(getCompanyId());
      const currentJobId = editingJob?.id || null;
      const freshURL = await resolveJobFileUri(
        signatureRef,
        sessionUser?.id,
        companyId,
        currentJobId,
      );
      
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
      const companyId = Number(getCompanyId());
      const currentJobId = editingJob?.id || null;
      const nextUrls = await Promise.all(
        (Array.isArray(photos) ? photos : []).map((photo) => resolveJobFileUri(
          photo,
          sessionUser?.id,
          companyId,
          currentJobId,
        )),
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
    const validationCode = validateFillJobForm(mode, jobData);
    if (!validationCode) return true;
    const validationMessage = validationCode === 'invalid-time'
      ? t.invalidTime
      : validationCode === 'missing-photo'
        ? t.addAtLeastOnePhoto
        : validationCode === 'missing-signature'
          ? t.addSignatureRequired
          : t.fillAllFields;
    alert.error('Error', validationMessage);
    return false;
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
        void invalidateTenantQueries(sessionUser.id, workspace.companyId, 'jobs').catch((queryError) => {
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
      void invalidateTenantQueries(sessionUser.id, workspace.companyId, 'jobs').catch((queryError) => {
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
          <FillJobForm
            cachedClients={cachedClients}
            colors={colors}
            editingJob={editingJob}
            handleGetLocation={handleGetLocation}
            handleSaveDraft={handleSaveDraft}
            handleSubmit={handleSubmit}
            handleTravelDistanceChange={handleTravelDistanceChange}
            inventory={inventory}
            jobData={jobData}
            language={language}
            mode={mode}
            onBack={() => router.back()}
            outboxReady={outboxReady}
            partsSearchText={partsSearchText}
            refreshedSignatureURL={refreshedSignatureURL}
            resolvedPhotoPreviewUrls={resolvedPhotoPreviewUrls}
            selectedClientObj={selectedClientObj}
            selectedParts={selectedParts}
            setJobData={setJobData}
            setPartsSearchText={setPartsSearchText}
            setSelectedClientObj={setSelectedClientObj}
            setSelectedParts={setSelectedParts}
            setShowPhotoPicker={setShowPhotoPicker}
            setShowSignature={setShowSignature}
            setShowTimeFromPicker={setShowTimeFromPicker}
            setShowTimeToPicker={setShowTimeToPicker}
            signatureLoading={signatureLoading}
            submitting={submitting}
            t={t}
            travelDistance={travelDistance}
            travelDistanceError={travelDistanceError}
          />
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
      <AccessibleModal
        visible={showSignature}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowSignature(false)}
        announcement="Signature pad"
      >
        <SignaturePad
          onSave={handleSignature}
          onCancel={() => setShowSignature(false)}
        />
      </AccessibleModal>

      <GlobalHeader />
    </SafeAreaView>
  );
}
