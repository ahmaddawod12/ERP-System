import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  Platform,
  Linking,
 } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { auth, functions, httpsCallable } from '../../firebase';
import { colors as themeColors, getColors, shadows } from '../../theme';
import { AppText, GlobalHeader, ViewJobDetails, DateFilter, ScrollableContainer } from '../../components';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAlert } from '../../contexts/AlertContext';
import { useCache } from '../../contexts/CacheContext';
import { scopedKey, storage } from '../../contexts/mmkv-storage';
import { safeJsonParse } from '../../utils/helpers';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { fetchRecordById } from '../../utils/read-model';
import { uploadJobFilesForStorage } from '../shared/job-file-utils';
import type { DateLike, Job, JobItem } from '../../types';
import type { DateFilterRange } from '../../components/DateFilter';

type WorkerJobRecord = Job & {
  workDescription?: string;
  submittedAt?: DateLike;
  dueDate?: string;
  timestamp?: DateLike;
  partsUsed?: JobItem[];
};

type PendingWorkerJob = {
  companyId?: string;
  jobId?: string;
  jobData?: Partial<WorkerJobRecord>;
};

function getWorkerPendingJobsStorageKey() {
  return scopedKey('pendingWorkerJobs');
}

function getWorkerDraftStorageKey(jobId: string | null | undefined) {
  const normalizedJobId = String(jobId || '').trim();
  return scopedKey(normalizedJobId ? `workerjobDraft_${normalizedJobId}` : 'workerjobDraft_new');
}

function getDateLikeTime(value: DateLike | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return new Date(String(value)).getTime();
}

export default function Workerjob() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const insets = useSafeAreaInsets();
  const {
    profile,
    jobs: cachedJobs,
    getUid,
    getCompanyId,
    updateJob,
    getDataForDateRange,
  } = useCache();
  const colors = getColors(isDarkMode);

  // ─── State ──────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<WorkerJobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const hasInitialLoadedRef = useRef(false);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingJobCount, setPendingJobCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedJobDetails, setSelectedJobDetails] = useState<WorkerJobRecord | null>(null);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilterRange>({
    type: 'last7days',
    startDate: new Date(new Date().setDate(new Date().getDate() - 7)),
    endDate: new Date(),
    label: 'Last 7 Days',
  });

  // ─── Translations ───────────────────────────────────────────────
  const t = language === 'en' ? {
    title: 'My Assigned Jobs',
    noJobs: 'No jobs assigned yet',
    pending: 'Pending',
    waiting: 'Waiting for Approval',
    denied: 'Denied',
    assignedBy: 'Assigned by',
    clientName: 'Client Name',
    clientPhone: 'Client Phone',
    timeWorked: 'Time Worked',
    location: 'Location',
    description: 'Description',
    offlineMode: 'Offline Mode',
    pendingJobs: 'Pending Jobs',
    syncSuccess: 'Successfully synced pending jobs!',
    syncError: 'Some jobs failed to sync. They will be retried later.',
    partsUsed: 'Parts Used',
    noParts: 'No parts used',
    close: 'Close',
    signingPerson: 'Signing Person',
    photos: 'Photos',
    noPhotos: 'No photos',
    signature: 'Signature',
    noSignature: 'No signature',
    invalidIsraeliPhone: 'Invalid Israeli phone number',
    invalidPhoneMessage: 'Please provide a valid Israeli phone number (starting with 05X or +9725X)',
  } : language === 'he' ? {
    title: 'המשימות שלי',
    noJobs: 'אין משימות מוקצות עדיין',
    pending: 'ממתין',
    waiting: 'ממתין לאישור',
    accepted: 'אושר',
    denied: 'נדחה',
    assignedBy: 'הוקצה על ידי',
    clientName: 'שם הלקוח',
    clientPhone: 'טלפון הלקוח',
    timeWorked: 'שעות עבודה',
    location: 'מיקום',
    description: 'תיאור',
    markReceived: 'סמן כהתקבל',
    offlineMode: 'מצב לא מקוון',
    pendingJobs: 'משימות ממתינות',
    syncSuccess: 'המשימות הממתינות סונכרנו בהצלחה!',
    syncError: 'חלק מהמשימות נכשלו בסנכרון. הן ינסו שוב מאוחר יותר.',
    partsUsed: 'חלקים בשימוש',
    noParts: 'לא נעשה שימוש בחלקים',
    close: 'סגור',
    signingPerson: 'שם החותם',
    photos: 'תמונות',
    noPhotos: 'אין תמונות',
    signature: 'חתימה',
    noSignature: 'אין חתימה',
    invalidIsraeliPhone: 'מספר טלפון ישראלי לא חוקי',
    invalidPhoneMessage: 'אנא ספק מספר טלפון ישראלי תקין (מתחיל ב-05X או +9725X)',
  } : {
    title: 'المهام المعينة لي',
    noJobs: 'لا توجد مهام معينة بعد',
    pending: 'قيد الانتظار',
    waiting: 'في انتظار الموافقة',
    accepted: 'مقبول',
    denied: 'مرفوض',
    assignedBy: 'تم التعيين بواسطة',
    clientName: 'اسم العميل',
    clientPhone: 'هاتف العميل',
    timeWorked: 'وقت العمل',
    location: 'الموقع',
    description: 'وصف',
    markReceived: 'وضع علامة كمستلم',
    offlineMode: 'وضع عدم الاتصال',
    pendingJobs: 'المهام المعلقة',
    syncSuccess: 'تم مزامنة المهام المعلقة بنجاح!',
    syncError: 'فشلت بعض المهام في المزامنة. سيتم المحاولة مرة أخرى لاحقاً.',
    partsUsed: 'القطع المستخدمة',
    noParts: 'لم يتم استخدام قطع',
    close: 'إغلاق',
    signingPerson: 'اسم الموقع',
    photos: 'الصور',
    noPhotos: 'لا توجد صور',
    signature: 'التوقيع',
    noSignature: 'لا يوجد توقيع',
    invalidIsraeliPhone: 'رقم هاتف إسرائيلي غير صالح',
    invalidPhoneMessage: 'يرجى تقديم رقم هاتف إسرائيلي صالح (يبدأ بـ 05X أو +9725X)',
  };

  // ─── Helpers ────────────────────────────────────────────────────

  const isJobNew = (job: WorkerJobRecord) => {
    if (!job.timestamp && !job.createdAt) return false;
    const jobDate = getDateLikeTime(job.timestamp || job.createdAt);
    const hoursDiff = (Date.now() - jobDate) / (1000 * 60 * 60);
    return hoursDiff <= 24;
  };

  const canEditJob = (job: WorkerJobRecord) => job.status !== 'finished';

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#f59e0b';
      case 'waiting': return '#8b5cf6';
      case 'finished': return '#10b981';
      case 'denied': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return t.pending;
      case 'waiting': return t.waiting;
      case 'finished': return language === 'en' ? 'Finished' : language === 'he' ? 'Ã—â€Ã—â€¢Ã—Â©Ã—Å“Ã—Â' : 'Ã™â€¦Ã™â€ Ã˜ÂªÃ™â€¡Ã™Å ';
      case 'denied': return t.denied;
      default: return status || t.pending;
    }
  };

  const checkPendingJobCount = async () => {
    try {
      const pending = storage.getString(getWorkerPendingJobsStorageKey());
      if (pending) {
        setPendingJobCount((safeJsonParse<PendingWorkerJob[]>(pending, []) || []).length);
      }
    } catch (error) {
      console.error('Error checking pending jobs:', error);
    }
  };

  /**
   * Sync offline-queued jobs. These were saved when the worker submitted a job
   * while offline. Each entry contains the full jobData that was already built
   * by FillJob (or the inline modal). We re-submit them to Firestore.
   */
  const syncPendingJobs = async () => {
    try {
      const pending = storage.getString(getWorkerPendingJobsStorageKey());
      if (!pending) return;
      const pendingArray = safeJsonParse<PendingWorkerJob[]>(pending, []) || [];
      if (pendingArray.length === 0) return;

      setIsSyncing(true);
      const failedJobs: PendingWorkerJob[] = [];

      for (const pendingJob of pendingArray) {
        try {
          const companyId = pendingJob.companyId || getCompanyId();
          const jobId = pendingJob.jobId;
          const user = auth.currentUser;
          if (!companyId || !jobId) {
            throw new Error('Missing companyId or jobId for pending worker job');
          }
          if (!user?.uid) {
            throw new Error('Missing user session for pending worker job');
          }

          const existingData = await fetchRecordById(companyId, jobId) as Partial<WorkerJobRecord> | null;

          if (existingData) {
            const uploadResult = await uploadJobFilesForStorage(
              user.uid,
              jobId,
              Array.isArray(pendingJob.jobData?.photos)
                ? pendingJob.jobData.photos as Array<string | { storagePath?: string; uri?: string }>
                : [],
              (pendingJob.jobData?.signature as string | { storagePath?: string; uri?: string } | null | undefined) || null,
            );
            const updatedJob = {
              ...existingData,
              ...pendingJob.jobData,
              photos: uploadResult.photoRefs.length > 0 ? uploadResult.photoRefs : pendingJob.jobData?.photos,
              signature: uploadResult.signatureRef ?? pendingJob.jobData?.signature,
              status: 'waiting',
              submittedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            updateJob(jobId, updatedJob);
            const updateJobFn = httpsCallable(functions, 'updateJobV1');
            await updateJobFn({ companyId, jobId, ...updatedJob });
          } else {
            // Job no longer exists — skip
            console.warn('Job not found during sync, skipping:', jobId);
          }
        } catch (error) {
          console.error('Error syncing job:', error);
          failedJobs.push(pendingJob);
        }
      }

      if (failedJobs.length > 0) {
        storage.set(getWorkerPendingJobsStorageKey(), JSON.stringify(failedJobs));
        setPendingJobCount(failedJobs.length);
        alert.error(t.syncError || 'Some jobs failed to sync');
      } else {
        storage.remove(getWorkerPendingJobsStorageKey());
        setPendingJobCount(0);
        alert.success(t.syncSuccess || 'All jobs synced successfully!');
        void loadJobs();
      }
    } catch (error) {
      console.error('Error syncing pending jobs:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const loadJobs = useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }

      const uid = getUid();
      const companyId = getCompanyId();
      if (!companyId) {
        setLoading(false);
        return;
      }

      const ninetyDaysAgoMs = Date.now() - 90 * 24 * 60 * 60 * 1000;

      // Beyond 90 days — fetch from archive / Firestore
      if (dateFilter.startDate.getTime() < ninetyDaysAgoMs) {
        const olderJobs = await getDataForDateRange(dateFilter.startDate, dateFilter.endDate, 'finishedJobs') as WorkerJobRecord[];
        const filtered = olderJobs
          .filter((job) => job.wid === profile?.wid)
          .sort((a, b) => getDateLikeTime(b.finishedAt || b.createdAt) - getDateLikeTime(a.finishedAt || a.createdAt));
        setJobs(filtered);
        setLoading(false);
        return;
      }

      // Recent data — use cache
      const allCachedJobs = (cachedJobs || []) as WorkerJobRecord[];
      const pending = allCachedJobs.filter(job => {
        if (job.status !== 'pending' && job.status !== 'waiting') return false;
        const createdAtMs = getDateLikeTime(job.createdAt);
        return createdAtMs >= dateFilter.startDate.getTime() && createdAtMs <= dateFilter.endDate.getTime();
      });
      const finished = allCachedJobs.filter(job => {
        if (job.status !== 'finished') return false;
        const finishedAtMs = getDateLikeTime(job.finishedAt);
        return finishedAtMs >= dateFilter.startDate.getTime() && finishedAtMs <= dateFilter.endDate.getTime();
      });

      const jobsList = [...pending, ...finished].sort(
        (a, b) => getDateLikeTime(b.finishedAt || b.createdAt) - getDateLikeTime(a.finishedAt || a.createdAt)
      );
      setJobs(jobsList);
      setLoading(false);
    } catch (error) {
      if (auth.currentUser) console.error('Error loading jobs:', error);
      setLoading(false);
    }
  }, [cachedJobs, dateFilter, getUid, getCompanyId, getDataForDateRange, profile?.wid]);

  // ─── Data Loading ───────────────────────────────────────────────────

  useEffect(() => {
    const initializeData = async () => {
      await loadJobs();
      hasInitialLoadedRef.current = true;
    };
    void initializeData();
  }, [dateFilter, loadJobs]);

  useEffect(() => {
    if (!hasInitialLoadedRef.current) return;
    void loadJobs();
  }, [cachedJobs, loadJobs]);

  // Network state listener — sync pending offline jobs when back online
  useEffect(() => {
    let previousOnlineState = true;
    const unsubscribe = NetInfo.addEventListener((state) => {
      const currentOnlineState = Boolean(state.isConnected);
      if (!previousOnlineState && currentOnlineState) {
        void syncPendingJobs();
      }
      previousOnlineState = currentOnlineState;
      setIsOnline(currentOnlineState);
    });
    void checkPendingJobCount();
    return () => unsubscribe();
  }, []);

  // ─── Actions ────────────────────────────────────────────────────

  const handleMoveToWaiting = async (job: WorkerJobRecord) => {
    try {
      const companyId = getCompanyId();
      if (!companyId) {
        alert.error('Error', 'Company not found');
        return;
      }

      const updates = {
        status: 'waiting',
        wname: profile?.name || '',
      };

      const updateJobFn = httpsCallable(functions, 'updateJobV1');
      await updateJobFn({ companyId, jobId: job.id, ...updates });
      updateJob(job.id, updates);

      alert.success('Success',
        language === 'en' ? 'Job moved to waiting'
          : language === 'he' ? 'המשימה סומנה כהתקבלה'
          : 'تم وضع علامة كمستلم'
      );
    } catch (error) {
      console.error('Error updating job:', error);
      alert.error('Error', 'Failed to update job');
    }
  };

  const handleFillDetails = async (job: WorkerJobRecord) => {
    // Clear any existing draft for this job to prevent loading old data
    try {
      storage.remove(getWorkerDraftStorageKey(job.id));
    } catch (error) {
      console.error('Error clearing draft:', error);
    }

    // Navigate to FillJob — it handles the full form
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
          cname: job.cname || '',
          cphone: job.cphone || '',
          photos: job.photos || [],
          signingPerson: job.signingPerson || '',
          signature: job.signature || null,
          partsUsed: job.partsUsed || [],
          mname: job.mname || '',
        }),
      },
    });
  };

  // ─── Quick Actions (Waze, Phone, WhatsApp) ──────────────────────

  const handleOpenWaze = (location: string | undefined) => {
    if (!location) {
      alert.warning(
        language === 'en' ? 'No Location' : language === 'he' ? 'אין מיקום' : 'لا يوجد موقع',
        language === 'en' ? 'This job does not have a location set.'
          : language === 'he' ? 'למשימה זו אין מיקום מוגדר.'
          : 'هذه المهمة لا تحتوي على موقع محدد.'
      );
      return;
    }
    const wazeUrl = `https://waze.com/ul?q=${encodeURIComponent(location)}`;
    Linking.canOpenURL(wazeUrl)
      .then(ok => {
        if (ok) Linking.openURL(wazeUrl);
        else alert.error(
          language === 'en' ? 'Cannot Open Waze' : language === 'he' ? 'לא ניתן לפתוח Waze' : 'لا يمكن فتح Waze',
          language === 'en' ? 'Please make sure Waze is installed on your device.'
            : language === 'he' ? 'אנא וודא ש-Waze מותקן במכשיר שלך.'
            : 'يرجى التأكد من تثبيت Waze على جهازك.'
        );
      })
      .catch(() => alert.error(
        language === 'en' ? 'Error' : language === 'he' ? 'שגיאה' : 'خطأ',
        language === 'en' ? 'Failed to open Waze.' : language === 'he' ? 'נכשל לפתוח Waze.' : 'فشل في فتح Waze.'
      ));
  };

  const handleCallClient = (phoneNumber: string | undefined) => {
    if (!phoneNumber) {
      alert.warning(
        language === 'en' ? 'No Phone Number' : language === 'he' ? 'אין מספר טלפון' : 'لا يوجد رقم هاتف',
        language === 'en' ? 'This job does not have a client phone number.'
          : language === 'he' ? 'למשימה זו אין מספר טלפון של לקוח.'
          : 'هذه المهمة لا تحتوي على رقم هاتف العميل.'
      );
      return;
    }
    const phoneUrl = `tel:${phoneNumber.replace(/[^0-9+]/g, '')}`;
    Linking.canOpenURL(phoneUrl)
      .then(ok => {
        if (ok) Linking.openURL(phoneUrl);
        else alert.error('Error', 'Cannot open dialer.');
      })
      .catch(() => alert.error('Error', 'Failed to open dialer.'));
  };

  const handleOpenWhatsApp = (phoneNumber: string | undefined) => {
    if (!phoneNumber) {
      alert.warning(
        language === 'en' ? 'No Phone Number' : language === 'he' ? 'אין מספר טלפון' : 'لا يوجد رقم هاتف',
        language === 'en' ? 'This job does not have a client phone number.'
          : language === 'he' ? 'למשימה זו אין מספר טלפון של לקוח.'
          : 'هذه المهمة لا تحتوي على رقم هاتف العميل.'
      );
      return;
    }
    const cleaned = phoneNumber.replace(/[^0-9+]/g, '');
    const match = cleaned.match(/^(?:\+?972|0)(5[0-9])([0-9]{7})$/);
    if (!match) {
      alert.warning(t.invalidIsraeliPhone, t.invalidPhoneMessage);
      return;
    }
    const intlNumber = `972${match[1]}${match[2]}`;
    Linking.canOpenURL(`https://wa.me/${intlNumber}`)
      .then(ok => {
        if (ok) Linking.openURL(`https://wa.me/${intlNumber}`);
        else alert.error(
          language === 'en' ? 'Cannot Open WhatsApp' : language === 'he' ? 'לא ניתן לפתוח וואטסאפ' : 'لا يمكن فتح واتساب',
          language === 'en' ? 'Please make sure WhatsApp is installed on your device.'
            : language === 'he' ? 'אנא וודא ש-WhatsApp מותקן במכשיר שלך.'
            : 'يرجى التأكد من تثبيت WhatsApp على جهازك.'
        );
      })
      .catch(() => alert.error(
        language === 'en' ? 'Error' : language === 'he' ? 'שגיאה' : 'خطأ',
        language === 'en' ? 'Failed to open WhatsApp.' : language === 'he' ? 'נכשל לפתוח וואטסאפ.' : 'فشل في فتح واتساب.'
      ));
  };

  // ─── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />

      {/* Offline Banner */}
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <MaterialCommunityIcons name="wifi-off" size={20} color="#fff" />
          <AppText style={styles.offlineBannerText}>{t.offlineMode}</AppText>
        </View>
      )}

      {/* Pending Jobs Indicator */}
      {isOnline && pendingJobCount > 0 && (
        <View style={styles.pendingJobsBanner}>
          <MaterialCommunityIcons name="cloud-upload" size={20} color="#fff" />
          <AppText style={styles.pendingJobsText}>
            {t.pendingJobs}: {pendingJobCount}
          </AppText>
        </View>
      )}

      {/* Job List */}
      <ScrollableContainer
        style={styles.content}
        contentContainerStyle={{
          paddingTop: 100,
          paddingBottom: Platform.OS === 'android' ? 220 + insets.bottom : 100 + insets.bottom,
        }}
      >
        {/* Date Filter Button */}
        <TouchableOpacity onPress={() => setShowDateFilter(true)} style={styles.dateFilterButtonWrapper}>
          <LinearGradient
            colors={isDarkMode ? ['#0f172a', '#1e3a8a'] : ['#3b82f6', '#1e40af']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.dateFilterButton}
          >
            <Ionicons name="calendar-outline" size={22} color="#fff" />
            <AppText style={styles.dateFilterButtonText}>{dateFilter.label}</AppText>
            <Ionicons name="chevron-down" size={20} color="rgba(255,255,255,0.8)" />
          </LinearGradient>
        </TouchableOpacity>

        {jobs.length === 0 ? (
          <AppText style={styles.emptyText}>{t.noJobs}</AppText>
        ) : (
          jobs.map((job) => (
            <TouchableOpacity
              key={job.id}
              style={[styles.jobCard, { backgroundColor: colors.surface }]}
              onPress={() => setSelectedJobDetails(job)}
              activeOpacity={0.7}
            >
              {/* Title Row */}
              <View style={styles.jobTitleRow}>
                <View style={styles.titleContainer}>
                  <AppText style={[styles.jobTitle, { color: colors.primary }]}>{job.title}</AppText>
                  {isJobNew(job) && (
                    <View style={styles.newBadge}>
                      <AppText style={styles.newBadgeText}>
                        {language === 'en' ? 'NEW' : language === 'he' ? 'חדש' : 'جديد'}
                      </AppText>
                    </View>
                  )}
                </View>

                {/* Action Icons */}
                <View style={styles.actionIcons}>
                  {job.status === 'pending' && (
                    <TouchableOpacity
                      style={[styles.iconButton, styles.receiveIconButton]}
                      onPress={(e) => { e.stopPropagation(); handleMoveToWaiting(job); }}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="check-circle" size={24} color="white" />
                    </TouchableOpacity>
                  )}
                  {job.status === 'denied' && (
                    <TouchableOpacity
                      style={[styles.iconButton, styles.fillIconButton, !canEditJob(job) && styles.disabledIconButton]}
                      onPress={(e) => {
                        e.stopPropagation();
                        if (canEditJob(job)) handleFillDetails(job);
                        else alert.warning(
                          language === 'en' ? 'Cannot Edit' : language === 'he' ? 'לא ניתן לערוך' : 'لا يمكن التعديل',
                          language === 'en' ? 'Finished jobs cannot be edited by workers.' : language === 'he' ? 'משימות שהסתיימו לא ניתן לערוך על ידי עובדים.' : 'لا يمكن للعمال تعديل المهام المنتهية.'
                        );
                      }}
                      activeOpacity={0.7}
                      disabled={!canEditJob(job)}
                    >
                      <MaterialCommunityIcons name="pencil-box" size={24} color="white" />
                    </TouchableOpacity>
                  )}
                  {job.status === 'waiting' && (
                    <TouchableOpacity
                      style={[styles.iconButton, styles.editIconButton, !canEditJob(job) && styles.disabledIconButton]}
                      onPress={(e) => {
                        e.stopPropagation();
                        if (canEditJob(job)) handleFillDetails(job);
                        else alert.warning(
                          language === 'en' ? 'Cannot Edit' : language === 'he' ? 'לא ניתן לערוך' : 'لا يمكن التعديל',
                          language === 'en' ? 'Finished jobs cannot be edited by workers.' : language === 'he' ? 'משימות שהסתיימו לא ניתן לערוך על ידי עובדים.' : 'لا يمكن للعمال تعديل المهام المنتهية.'
                        );
                      }}
                      activeOpacity={0.7}
                      disabled={!canEditJob(job)}
                    >
                      <MaterialCommunityIcons name="pencil" size={24} color="white" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* Job Info */}
              <AppText style={[styles.jobDescription, { color: colors.textSecondary }]}>{job.description}</AppText>
              {job.mname && (
                <AppText style={[styles.jobDetails, { color: colors.textSecondary }]}>
                  {t.assignedBy}: {job.mname}
                </AppText>
              )}
              {(job.cname || job.cphone) && (
                <AppText style={[styles.jobCustomer, { color: colors.textSecondary }]}>
                  {job.cname && `${t.clientName}: ${job.cname}`}
                  {job.cname && job.cphone ? ' • ' : ''}
                  {job.cphone && `${t.clientPhone}: ${job.cphone}`}
                </AppText>
              )}
              {job.dueDate && (
                <AppText style={[styles.jobDetails, { color: colors.textSecondary }]}>
                  {language === 'en' ? 'Due Date' : language === 'he' ? 'תאריך יעד' : 'تاريخ الاستحقاق'}: {job.dueDate}
                </AppText>
              )}
              {job.location && (
                <AppText style={[styles.jobLocation, { color: colors.textSecondary }]}>
                  <AppText style={styles.locationLabel}>{t.location}:</AppText> {job.location}
                </AppText>
              )}

              {/* Status + Quick Actions Row */}
              <View style={styles.statusAndWazeRow}>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(job.status) }]}>
                  <AppText style={styles.statusText}>{getStatusText(job.status)}</AppText>
                </View>
                {job.location && (
                  <TouchableOpacity
                    style={styles.wazeButton}
                    onPress={(e) => { e.stopPropagation(); handleOpenWaze(job.location); }}
                    activeOpacity={0.7}
                  >
                    <Image source={require('../../assets/icons8-waze-48.png')} style={styles.wazeIcon} />
                  </TouchableOpacity>
                )}
                {job.cphone && (
                  <TouchableOpacity
                    style={styles.phoneButton}
                    onPress={(e) => { e.stopPropagation(); handleCallClient(job.cphone); }}
                    activeOpacity={0.7}
                  >
                    <AppText style={styles.phoneIcon}>📞</AppText>
                  </TouchableOpacity>
                )}
                {job.cphone && (
                  <TouchableOpacity
                    style={styles.whatsappButton}
                    onPress={(e) => { e.stopPropagation(); handleOpenWhatsApp(job.cphone); }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="logo-whatsapp" size={22} color="#000000" />
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollableContainer>

      {/* Syncing Overlay */}
      {isSyncing && (
        <View style={styles.syncingOverlay}>
          <View style={styles.syncingContainer}>
            <ActivityIndicator size="large" color="#fff" />
            <AppText style={styles.syncingText}>
              {language === 'en' ? 'Syncing pending jobs...'
                : language === 'he' ? 'מסנכרן משימות ממתינות...'
                : 'مزامنة المهام المعلقة...'}
            </AppText>
          </View>
        </View>
      )}

      {/* Job Details Modal */}
      <ViewJobDetails
        visible={!!selectedJobDetails}
        job={selectedJobDetails}
        onClose={() => setSelectedJobDetails(null)}
        translations={{
          title: t.title,
          description: t.description,
          location: t.location,
          clientName: t.clientName,
          clientPhone: t.clientPhone,
          clientInfo: t.clientName,
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
        }}
        getStatusColor={getStatusColor}
        onImagePress={() => {}}
        isDarkMode={isDarkMode}
      />

      {/* Date Filter Modal */}
      <DateFilter
        visible={showDateFilter}
        onClose={() => setShowDateFilter(false)}
        onFilterChange={(filter: DateFilterRange) => { setDateFilter(filter); setShowDateFilter(false); }}
        currentFilter={dateFilter.type}
        isDarkMode={isDarkMode}
        language={language}
      />

      <GlobalHeader />
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

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
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 30,
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
  jobTitle: {
    fontSize: 18,
    fontWeight: 'bold',
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
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  wazeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#33CCFF',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84 },
      android: { elevation: 5 },
    }),
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
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84 },
      android: { elevation: 5 },
    }),
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
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84 },
      android: { elevation: 5 },
    }),
  },
  emptyText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 40,
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
});







