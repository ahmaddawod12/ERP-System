import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
 } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { auth, functions, httpsCallable } from '../../../firebase';
import { colors as themeColors, getColors, spacing, borderRadius, typography, shadows } from '../../../theme';
import { AppText, GlobalHeader, ViewJobDetails, DateFilter, ScrollableContainer, ClientSelectorModal } from '../../../components';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { scopedKey, storage } from '../../../contexts/mmkv-storage';
import { generateUuid, safeJsonParse } from '../../../utils/helpers';
import { uploadJobFilesForStorage } from '../lib/job-file-utils';
import type { DateLike, Job, JobItem } from '../../../types';
import type { DateFilterRange } from '../../../components/forms/DateFilter';
import { ROUTES } from '../../../navigation/routes';

type UserJobRecord = Job & {
  isCert?: boolean;
  customer?: string;
  partsUsed?: JobItem[];
};

type UserJobDraft = {
  jobData?: Partial<UserJobRecord>;
  selectedParts?: JobItem[];
};

type PendingJobRecord = {
  uid?: string;
  localJobId?: string;
  jobData?: Partial<UserJobRecord> & { attachmentUploadId?: string };
};

function getUserPendingJobsStorageKey() {
  return scopedKey('pendingJobs');
}

function getUserJobDraftStorageKey() {
  return scopedKey('userjobDraft');
}

function getDateLikeTime(value: DateLike | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return new Date(String(value)).getTime();
}

export default function Userjob() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const insets = useSafeAreaInsets();
  const {
    profile,
    jobs: cachedJobs,
    companyJobs: cachedCompanyJobs,
    clients: cachedClients,
    getUid,
    getCompanyId,
    getUserRole,
    addJob,
    removeJob,
    getDataForDateRange,
    isWithinCacheRange,
    fetchClients,
  } = useCache();
  const colors = getColors(isDarkMode);

  // ─── State ──────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<UserJobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const hasInitialLoadedRef = useRef(false);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingJobCount, setPendingJobCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedJobDetails, setSelectedJobDetails] = useState<UserJobRecord | null>(null);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [clientFilter, setClientFilter] = useState('');
  const [showClientSelector, setShowClientSelector] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilterRange>({
    type: 'last7days',
    startDate: new Date(new Date().setDate(new Date().getDate() - 7)),
    endDate: (() => {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      return today;
    })(),
    label: 'Last 7 Days',
  });

  // ─── Translations ───────────────────────────────────────────────
  const t = language === 'en' ? {
    title: 'My Jobs',
    createJob: 'Create New Job',
    noJobs: 'No jobs yet',
    timeWorked: 'Time Worked',
    location: 'Job Location',
    clientName: 'Client Name',
    clientPhone: 'Client Phone',
    photos: 'Photos',
    noPhotos: 'No photos',
    signingPerson: 'Signing Person',
    signature: 'Signature',
    noSignature: 'No signature',
    cancel: 'Cancel',
    delete: 'Delete',
    confirmDelete: 'Are you sure you want to delete this job?',
    partsUsed: 'Parts Used',
    noParts: 'No parts available in inventory',
    offlineMode: 'Offline Mode',
    pendingJobs: 'Pending Jobs',
    syncSuccess: 'Successfully synced pending jobs!',
    syncError: 'Some jobs failed to sync. They will be retried later.',
    filterByClient: 'Filter by Client',
    clearFilter: 'Clear Filter',
    searchClients: 'Search clients...',
    noClients: 'No clients found',
    noSearchResults: 'No clients match your search',
    close: 'Close',
    jobDetails: 'Job Details',
    description: 'Description',
    createdAt: 'Created At',
    finishedAt: 'Finished At',
    status: 'Status',
    assignedBy: 'Assigned By',
    draftFound: 'Draft Found',
    draftFoundMessage: 'You have an unsaved draft. Would you like to continue working on it?',
    continueWithDraft: 'Continue',
    discardDraft: 'Discard',
  } : language === 'he' ? {
    title: 'המשימות שלי',
    createJob: 'יצירת משימה חדשה',
    noJobs: 'אין משימות עדיין',
    timeWorked: 'שעות עבודה',
    location: 'מיקום העבודה',
    clientName: 'שם הלקוח',
    clientPhone: 'טלפון לקוח',
    photos: 'תמונות',
    noPhotos: 'אין תמונות',
    signingPerson: 'שם החותם',
    signature: 'חתימה',
    noSignature: 'אין חתימה',
    cancel: 'ביטול',
    delete: 'מחק',
    confirmDelete: 'האם אתה בטוח שברצונך למחוק משימה זו?',
    partsUsed: 'חלקים בשימוש',
    noParts: 'אין חלקים זמינים במלאי',
    offlineMode: 'מצב לא מקוון',
    pendingJobs: 'משימות ממתינות',
    syncSuccess: 'המשימות הממתינות סונכרנו בהצלחה!',
    syncError: 'חלק מהמשימות נכשלו בסנכרון. הן ינסו שוב מאוחר יותר.',
    filterByClient: 'סינון לפי לקוח',
    clearFilter: 'נקה סינון',
    searchClients: 'חפש לקוחות...',
    noClients: 'לא נמצאו לקוחות',
    noSearchResults: 'לא נמצאו לקוחות התואמים לחיפוש',
    close: 'סגור',
    jobDetails: 'פרטי משימה',
    description: 'תיאור',
    createdAt: 'נוצר ב',
    finishedAt: 'הושלם ב',
    status: 'סטטוס',
    assignedBy: 'הוקצה על ידי',
    draftFound: 'נמצא טיוטה',
    draftFoundMessage: 'יש לך טיוטה שלא נשמרה. האם תרצה להמשיך לעבוד עליה?',
    continueWithDraft: 'המשך',
    discardDraft: 'מחק',
  } : {
    title: 'مهامي',
    createJob: 'إنشاء مهمة جديدة',
    noJobs: 'لا توجد مهام بعد',
    timeWorked: 'وقت العمل',
    location: 'موقع العمل',
    clientName: 'اسم العميل',
    clientPhone: 'هاتف العميل',
    photos: 'الصور',
    noPhotos: 'لا توجد صور',
    signingPerson: 'اسم الموقع',
    signature: 'التوقيع',
    noSignature: 'لا يوجد توقيع',
    cancel: 'إلغاء',
    delete: 'حذف',
    confirmDelete: 'هل أنت متأكد من حذف هذه المهمة؟',
    partsUsed: 'القطع المستخدمة',
    noParts: 'لا توجد قطع متاحة في المخزون',
    offlineMode: 'وضع عدم الاتصال',
    pendingJobs: 'المهام المعلقة',
    syncSuccess: 'تم مزامنة المهام المعلقة بنجاح!',
    syncError: 'فشلت بعض المهام في المزامنة. سيتم المحاولة مرة أخرى لاحقاً.',
    filterByClient: 'تصفية حسب العميل',
    clearFilter: 'مسح التصفية',
    searchClients: 'البحث عن العملاء...',
    noClients: 'لم يتم العثور على عملاء',
    noSearchResults: 'لا يوجد عملاء مطابقين للبحث',
    close: 'إغلاق',
    jobDetails: 'تفاصيل المهمة',
    description: 'وصف',
    createdAt: 'أنشئت في',
    finishedAt: 'انتهت في',
    status: 'الحالة',
    assignedBy: 'تم التعيين بواسطة',
    draftFound: 'تم العثور على مسودة',
    draftFoundMessage: 'لديك مسودة غير محفوظة. هل تريد متابعة العمل عليها؟',
    continueWithDraft: 'متابعة',
    discardDraft: 'تجاهل',
  };

  // ─── Helpers ────────────────────────────────────────────────────

  const isJobNew = (job: UserJobRecord) => {
    if (!job.finishedAt && !job.createdAt) return false;
    const jobDate = getDateLikeTime(job.finishedAt || job.createdAt);
    const hoursDiff = (Date.now() - jobDate) / (1000 * 60 * 60);
    return hoursDiff <= 24;
  };

  const canEditJob = (job: UserJobRecord) => {
    if (job.isCert === true) return false;
    if (job.finishedAt) {
      const finishedDateMs = getDateLikeTime(job.finishedAt);
      const daysDiff = (Date.now() - finishedDateMs) / (1000 * 60 * 60 * 24);
      if (daysDiff > 7) return false;
    }
    return true;
  };

  const canDeleteJob = (job: UserJobRecord) => job.isCert !== true;

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'finished': return '#10b981';
      case 'pending': return '#f59e0b';
      case 'denied': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const formatDate = (timestamp: DateLike | null | undefined) => {
    if (!timestamp) return 'N/A';
    const date = typeof (timestamp as { toDate?: () => Date }).toDate === 'function'
      ? (timestamp as { toDate: () => Date }).toDate()
      : new Date(String(timestamp));
    return date.toLocaleDateString();
  };

  const checkPendingJobCount = async () => {
    try {
      const pending = storage.getString(getUserPendingJobsStorageKey());
      if (pending) setPendingJobCount((safeJsonParse<PendingJobRecord[]>(pending, []) || []).length);
    } catch (error) {
      console.log('Error checking pending jobs:', error);
    }
  };

  /**
   * Check for saved draft on mount. If found, offer to resume it in FillJob.
   */
  const checkForDraft = async () => {
    try {
      const draft = storage.getString(getUserJobDraftStorageKey());
      if (draft) {
        const parsed = safeJsonParse<UserJobDraft | null>(draft, null);
        if (parsed?.jobData && (parsed.jobData.title || parsed.jobData.description ||
            (parsed.jobData.photos?.length ?? 0) > 0 || (parsed.selectedParts?.length ?? 0) > 0)) {
          alert.confirm(
            t.draftFound,
            t.draftFoundMessage,
            [
              {
                text: t.discardDraft,
                style: 'destructive',
                onPress: async () => {
                  storage.remove(getUserJobDraftStorageKey());
                },
              },
              {
                text: t.cancel,
                style: 'cancel',
                onPress: () => {},
              },
              {
                text: t.continueWithDraft,
                style: 'default',
                onPress: async () => {
                  storage.remove(getUserJobDraftStorageKey());
                  // Navigate to FillJob with the draft data
                  router.push({
                    pathname: ROUTES.fillJob,
                    params: {
                      mode: 'user',
                      draft: JSON.stringify(parsed),
                    },
                  });
                },
              },
            ]
          );
        }
      }
    } catch (error) {
      console.error('Error checking for draft:', error);
    }
  };

  /**
   * Sync offline-queued jobs. Tries to submit each pending job through the backend.
   */
  const syncPendingJobs = async () => {
    try {
      const pending = storage.getString(getUserPendingJobsStorageKey());
      if (!pending) return;
      const pendingArray = safeJsonParse<PendingJobRecord[]>(pending, []) || [];
      if (pendingArray.length === 0) return;

      setIsSyncing(true);
      const failedJobs: PendingJobRecord[] = [];

      for (const pendingJob of pendingArray) {
        try {
          const companyId = getCompanyId();
          const user = auth.currentUser;

          if (!companyId) throw new Error('No companyId');
          if (!user?.uid) throw new Error('No user session');

          const jobPayload = {
            ...(pendingJob.jobData || {}),
          };

          const attachmentUploadId = typeof jobPayload.attachmentUploadId === 'string' && jobPayload.attachmentUploadId.trim()
            ? jobPayload.attachmentUploadId.trim()
            : `pending-${generateUuid()}`;

          const uploadResult = await uploadJobFilesForStorage(
            companyId,
            attachmentUploadId,
            Array.isArray(jobPayload.photos) ? jobPayload.photos as Array<string | { storagePath?: string; uri?: string }> : [],
            (jobPayload.signature as string | { storagePath?: string; uri?: string } | null | undefined) || null,
          );
          jobPayload.photos = uploadResult.photoRefs;
          jobPayload.signature = uploadResult.signatureRef ?? undefined;
          jobPayload.attachmentUploadId = attachmentUploadId;

          const createJobFn = httpsCallable(functions, 'createJobV1');
          const result = await createJobFn({
            companyId,
            type: 'finished',
            ...jobPayload,
          }) as { data?: { jobId?: string } };

          const serverJobId = result.data?.jobId;
          if (!serverJobId) {
            throw new Error('Job was created without a server job ID');
          }

          const jobToSave = {
            id: serverJobId,
            ...jobPayload,
            signature: uploadResult.signatureRef ?? undefined,
            status: 'finished',
            finishedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          if (pendingJob.localJobId) {
            removeJob(String(pendingJob.localJobId));
          }
          addJob(jobToSave);
        } catch (error) {
          console.error('Error syncing job:', error);
          failedJobs.push(pendingJob);
        }
      }

      if (failedJobs.length > 0) {
        storage.set(getUserPendingJobsStorageKey(), JSON.stringify(failedJobs));
        setPendingJobCount(failedJobs.length);
        alert.error(t.syncError);
      } else {
        storage.remove(getUserPendingJobsStorageKey());
        setPendingJobCount(0);
        alert.success(
          language === 'en' ? 'Sync Complete' : language === 'he' ? 'סנכרון הושלם' : 'اكتمل التزامن',
          t.syncSuccess
        );
        loadJobs();
      }
    } catch (error) {
      console.log('Error syncing pending jobs:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const loadJobs = useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user || !user.email) {
        setLoading(false);
        return;
      }

      const uid = getUid();
      const companyId = getCompanyId();
      const role = getUserRole();

      if (!companyId) {
        setJobs([]);
        setLoading(false);
        return;
      }

      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      // Beyond 90 days - fetch from archive/backend.
      if (dateFilter.startDate < ninetyDaysAgo) {
        const olderJobs = await getDataForDateRange(dateFilter.startDate, dateFilter.endDate, 'finishedJobs') as UserJobRecord[];
        const filtered = olderJobs
          .sort((a, b) => getDateLikeTime(b.finishedAt) - getDateLikeTime(a.finishedAt));
        setJobs(filtered);
        setLoading(false);
        return;
      }

      // Recent data — use cache
      let jobsList: UserJobRecord[] = [];
      if (role === 'manager') {
        jobsList = (cachedCompanyJobs || []).filter((job): job is UserJobRecord => job.status === 'finished');
      } else if (role === 'user') {
        jobsList = (cachedJobs || []).filter((job): job is UserJobRecord => job.status === 'finished');
      } else {
        jobsList = (cachedJobs || []).filter((job): job is UserJobRecord => job.status === 'finished');
      }

      // Apply date filter
      jobsList = jobsList.filter(job => {
        const jobDate = getDateLikeTime(job.finishedAt);
        return jobDate >= dateFilter.startDate.getTime() && jobDate <= dateFilter.endDate.getTime();
      });

      // Apply client filter
      if (clientFilter.trim()) {
        const q = clientFilter.toLowerCase();
        jobsList = jobsList.filter(job =>
          (job.cname && job.cname.toLowerCase().includes(q)) ||
          (job.signingPerson && job.signingPerson.toLowerCase().includes(q)) ||
          (job.customer && job.customer.toLowerCase().includes(q))
        );
      }

      // Sort by finishedAt descending
      jobsList.sort((a, b) => getDateLikeTime(b.finishedAt) - getDateLikeTime(a.finishedAt));

      setJobs(jobsList);
      setLoading(false);
    } catch (error) {
      if (auth.currentUser) console.error('Error loading jobs:', error);
      setLoading(false);
    }
  }, [cachedJobs, cachedCompanyJobs, dateFilter, clientFilter, getUid, getCompanyId, getUserRole, getDataForDateRange, isWithinCacheRange]);

  // ─── Data Loading ───────────────────────────────────────────────

  // Fetch clients on mount
  useEffect(() => {
    const companyId = getCompanyId();
    if (companyId && fetchClients) {
      fetchClients(companyId);
    }
  }, [getCompanyId, fetchClients]);

  // Initial data load + re-load on filter changes
  useEffect(() => {
    const initializeData = async () => {
      await checkForDraft();
      await loadJobs();
      hasInitialLoadedRef.current = true;
    };
    void initializeData();
  }, [dateFilter, clientFilter, loadJobs]);

  // Watch for cached jobs changes
  useEffect(() => {
    if (!hasInitialLoadedRef.current) return;
    void loadJobs();
  }, [cachedJobs, cachedCompanyJobs, loadJobs, getUserRole]);

  // Network listener — sync pending offline jobs when back online
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

  const handleEditJob = (job: UserJobRecord) => {
    if (!canEditJob(job)) {
      let message = '';
      if (job.isCert === true) {
        message = language === 'en'
          ? 'This job has a tax document and cannot be edited.'
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

  storage.remove(getUserJobDraftStorageKey());

    router.push({
      pathname: ROUTES.fillJob,
      params: {
        mode: 'user',
        job: JSON.stringify({
          id: job.id,
          title: job.title || '',
          timeFrom: job.timeFrom || '',
          timeTo: job.timeTo || '',
          location: job.location || '',
          description: job.description || '',
          cname: job.cname || '',
          cphone: job.cphone || '',
          signingPerson: job.signingPerson || '',
          photos: job.photos || [],
          signature: job.signature || null,
          partsUsed: job.partsUsed || [],
        }),
      },
    });
  };

  const handleDeleteJob = async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (job && !canDeleteJob(job)) {
      alert.warning(
        language === 'en' ? 'Cannot Delete Job' : language === 'he' ? 'לא ניתן למחוק משימה' : 'لا يمكن حذف المهمة',
        language === 'en'
          ? 'This job has a tax document and cannot be deleted.'
          : language === 'he'
          ? 'למשימה זו יש אישור מס ולא ניתן למחוק אותה.'
          : 'هذه المهمة لها شهادة ضريبية ولا يمكن حذفها.'
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
              const currentUser = auth.currentUser;
              if (!currentUser) {
                alert.error('Error', 'User session not found');
                return;
              }

              const companyId = getCompanyId();
              if (!companyId) {
                alert.error('Error', 'Cannot delete job: company not found');
                return;
              }

              // Use deleteJobV1 Cloud Function for secure deletion
              const deleteJobFn = httpsCallable(functions, 'deleteJobV1');
              await deleteJobFn({ companyId, jobId });
              removeJob(jobId);
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
          paddingTop: 30,
          paddingBottom: Platform.OS === 'android' ? 220 + insets.bottom : 100 + insets.bottom,
        }}
      >
        {/* Create Job Button */}
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => router.push({ pathname: ROUTES.fillJob, params: { mode: 'user' } })}
        >
          <AppText style={styles.createButtonText}>{t.createJob}</AppText>
        </TouchableOpacity>

        {/* Filters Row */}
        <View style={styles.filtersRow}>
          {/* Date Filter */}
          <TouchableOpacity onPress={() => setShowDateFilter(true)} style={styles.dateFilterButtonWrapper}>
            <LinearGradient
              colors={isDarkMode ? ['#0f172a', '#1e3a8a'] : ['#3b82f6', '#1e40af']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.dateFilterButton}
            >
              <Ionicons name="calendar-outline" size={22} color="#fff" />
              <AppText style={styles.dateFilterButtonText}>{dateFilter.label}</AppText>
            </LinearGradient>
          </TouchableOpacity>

          {/* Client Filter */}
          <TouchableOpacity
            style={[styles.clientFilterContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => setShowClientSelector(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="person-outline" size={20} color={colors.textSecondary} />
            <AppText style={[styles.clientFilterInput, { color: clientFilter ? colors.textPrimary : colors.textSecondary }]}>
              {clientFilter || t.filterByClient}
            </AppText>
            {clientFilter.length > 0 ? (
              <TouchableOpacity onPress={() => { setClientFilter(''); }}>
                <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : (
              <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
            )}
          </TouchableOpacity>
        </View>

        {/* Jobs List */}
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
                <View style={styles.actionIcons}>
                  <TouchableOpacity
                    style={[styles.iconButton, styles.editIconButton, !canEditJob(job) && styles.disabledIconButton]}
                    onPress={(e) => { e.stopPropagation(); handleEditJob(job); }}
                    disabled={!canEditJob(job)}
                  >
                    <MaterialCommunityIcons name="pencil" size={20} color="white" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.iconButton, styles.deleteIconButton, !canDeleteJob(job) && styles.disabledIconButton]}
                    onPress={(e) => { e.stopPropagation(); handleDeleteJob(job.id); }}
                    disabled={!canDeleteJob(job)}
                  >
                    <MaterialCommunityIcons name="delete" size={20} color="white" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Job Info */}
              <AppText style={[styles.jobDescription, { color: colors.textSecondary }]}>{job.description}</AppText>
              <AppText style={[styles.jobDetails, { color: colors.textSecondary }]}>
                {formatDate(job.finishedAt) || 'No date'} | {job.timeFrom} - {job.timeTo}
              </AppText>
              <AppText style={[styles.jobLocation, { color: colors.textSecondary }]}>
                <AppText style={styles.locationLabel}>{t.location}: </AppText>{job.location}
              </AppText>
              {job.cname && (
                <AppText style={[styles.jobCustomer, { color: colors.textSecondary }]}>
                  {t.clientName}: {job.cname}
                  {job.cphone && `   ${t.clientPhone}: ${job.cphone}`}
                </AppText>
              )}
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
            <AppText style={styles.syncingSubtext}>
              {language === 'en' ? 'Please wait, do not close the app'
                : language === 'he' ? 'אנא המתן, אל תסגור את האפליקציה'
                : 'يرجى الانتظار، لا تغلق التطبيق'}
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
          jobDetails: t.jobDetails,
          title: t.title,
          description: t.description,
          location: t.location,
          clientName: t.clientName,
          clientPhone: t.clientPhone,
          clientInfo: t.clientName,
          createdAt: t.createdAt,
          finishedAt: t.finishedAt,
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

      {/* Client Selector Modal */}
      <ClientSelectorModal
        visible={showClientSelector}
        onClose={() => setShowClientSelector(false)}
        onSelectClient={(name) => setClientFilter(name)}
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
    marginBottom: 12,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  jobTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.3,
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







