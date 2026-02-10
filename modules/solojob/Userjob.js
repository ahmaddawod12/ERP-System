import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db, storage, doc, getDoc, setDoc, deleteDoc } from '../../firebase';
import { colors as themeColors, getColors, spacing, borderRadius, typography, shadows } from '../../theme';
import { GlobalHeader, ViewJobDetails, DateFilter, ScrollableContainer, ClientSelectorModal } from '../../components';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAlert } from '../../contexts/AlertContext';
import { useCache } from '../../contexts/CacheContext';
import { generateFinishedJobId } from '../../utils/helpers';

export default function Userjob() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const insets = useSafeAreaInsets();
  const {
    profile,
    finishedJobs: cachedFinishedJobs,
    companyFinishedJobs: cachedCompanyFinishedJobs,
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
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const hasInitialLoadedRef = useRef(false);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingJobCount, setPendingJobCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedJobDetails, setSelectedJobDetails] = useState(null);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [clientFilter, setClientFilter] = useState('');
  const [showClientSelector, setShowClientSelector] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState({
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

  const isJobNew = (job) => {
    if (!job.finishedAt && !job.createdAt) return false;
    const jobDate = new Date(job.finishedAt || job.createdAt);
    const hoursDiff = (new Date() - jobDate) / (1000 * 60 * 60);
    return hoursDiff <= 24;
  };

  const canEditJob = (job) => {
    if (job.isCert === true) return false;
    if (job.finishedAt) {
      const finishedDate = job.finishedAt.toDate ? job.finishedAt.toDate() : new Date(job.finishedAt);
      const daysDiff = (new Date() - finishedDate) / (1000 * 60 * 60 * 24);
      if (daysDiff > 7) return false;
    }
    return true;
  };

  const canDeleteJob = (job) => job.isCert !== true;

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'finished': return '#10b981';
      case 'pending': return '#f59e0b';
      case 'declined': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate?.() || new Date(timestamp);
    return date.toLocaleDateString();
  };

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
    initializeData();
  }, [dateFilter, clientFilter]);

  // Watch for cached jobs changes
  useEffect(() => {
    if (!hasInitialLoadedRef.current) return;
    loadJobs();
  }, [cachedFinishedJobs, cachedCompanyFinishedJobs, loadJobs, getUserRole]);

  // Network listener — sync pending offline jobs when back online
  useEffect(() => {
    let previousOnlineState = true;
    const unsubscribe = NetInfo.addEventListener(state => {
      const currentOnlineState = state.isConnected;
      if (!previousOnlineState && currentOnlineState) syncPendingJobs();
      previousOnlineState = currentOnlineState;
      setIsOnline(currentOnlineState);
    });
    checkPendingJobCount();
    return () => unsubscribe();
  }, []);

  const checkPendingJobCount = async () => {
    try {
      const pending = await AsyncStorage.getItem('pendingJobs');
      if (pending) setPendingJobCount(JSON.parse(pending).length);
    } catch (error) {
      console.log('Error checking pending jobs:', error);
    }
  };

  /**
   * Check for saved draft on mount. If found, offer to resume it in FillJob.
   */
  const checkForDraft = async () => {
    try {
      const draft = await AsyncStorage.getItem('userjobDraft');
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.jobData && (parsed.jobData.title || parsed.jobData.description ||
            parsed.jobData.photos?.length > 0 || parsed.selectedParts?.length > 0)) {
          alert.confirm(
            t.draftFound,
            t.draftFoundMessage,
            [
              {
                text: t.discardDraft,
                style: 'destructive',
                onPress: async () => {
                  await AsyncStorage.removeItem('userjobDraft');
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
                  await AsyncStorage.removeItem('userjobDraft');
                  // Navigate to FillJob with the draft data
                  router.push({
                    pathname: '/FillJob',
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
   * Sync offline-queued jobs. Tries to submit each pending job to Firestore.
   */
  const syncPendingJobs = async () => {
    try {
      const pending = await AsyncStorage.getItem('pendingJobs');
      if (!pending) return;
      const pendingArray = JSON.parse(pending);
      if (pendingArray.length === 0) return;

      setIsSyncing(true);
      const failedJobs = [];

      for (const pendingJob of pendingArray) {
        try {
          const uid = pendingJob.uid || getUid();
          const companyId = getCompanyId();
          const jobId = pendingJob.id || generateFinishedJobId();

          if (!companyId) throw new Error('No companyId');

          const jobToSave = {
            id: jobId,
            ...pendingJob.jobData,
            status: 'finished',
            completedBy: uid,
            name: profile?.name || '',
            finishedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          await addJob(jobToSave, false);
          await setDoc(doc(db, 'companies', companyId, 'finishedJobs', jobId), jobToSave);
        } catch (error) {
          console.error('Error syncing job:', error);
          failedJobs.push(pendingJob);
        }
      }

      if (failedJobs.length > 0) {
        await AsyncStorage.setItem('pendingJobs', JSON.stringify(failedJobs));
        setPendingJobCount(failedJobs.length);
        alert.error(t.syncError);
      } else {
        await AsyncStorage.removeItem('pendingJobs');
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

      // Beyond 90 days — fetch from archive / Firestore
      if (dateFilter.startDate < ninetyDaysAgo) {
        const olderJobs = await getDataForDateRange(dateFilter.startDate, dateFilter.endDate, 'finishedJobs');
        const filtered = olderJobs
          .filter(job => job.completedBy === uid)
          .sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
        setJobs(filtered);
        setLoading(false);
        return;
      }

      // Recent data — use cache
      let jobsList = [];
      if (role === 'manager') {
        jobsList = (cachedCompanyFinishedJobs || []).filter(job => job.completedBy === uid);
      } else if (role === 'user') {
        jobsList = cachedFinishedJobs || [];
      } else {
        jobsList = (cachedFinishedJobs || []).filter(job => job.completedBy === uid);
      }

      // Apply date filter
      jobsList = jobsList.filter(job => {
        const jobDate = new Date(job.finishedAt);
        return jobDate >= dateFilter.startDate && jobDate <= dateFilter.endDate;
      });

      // Apply client filter
      if (clientFilter.trim()) {
        const q = clientFilter.toLowerCase();
        jobsList = jobsList.filter(job =>
          (job.clientName && job.clientName.toLowerCase().includes(q)) ||
          (job.signingPerson && job.signingPerson.toLowerCase().includes(q)) ||
          (job.customer && job.customer.toLowerCase().includes(q))
        );
      }

      // Sort by finishedAt descending
      jobsList.sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));

      setJobs(jobsList);
      setLoading(false);
    } catch (error) {
      if (auth.currentUser) console.error('Error loading jobs:', error);
      setLoading(false);
    }
  }, [cachedFinishedJobs, cachedCompanyFinishedJobs, dateFilter, clientFilter, getUid, getCompanyId, getUserRole, getDataForDateRange, isWithinCacheRange]);

  // ─── Actions ────────────────────────────────────────────────────

  const handleEditJob = (job) => {
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

    AsyncStorage.removeItem('userjobDraft').catch(() => {});

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
        }),
      },
    });
  };

  const handleDeleteJob = async (jobId) => {
    const job = jobs.find(j => j.id === jobId);
    if (job && !canDeleteJob(job)) {
      alert.warning(
        language === 'en' ? 'Cannot Delete Job' : language === 'he' ? 'לא ניתן למחוק משימה' : 'لا يمكن حذف المهمة',
        language === 'en'
          ? 'This job has a tax certificate and cannot be deleted.'
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
              const uid = getUid() || auth.currentUser.uid;

              // Delete job files from storage
              try {
                const jobFolderRef = storage().ref(`${uid}/jobs/${jobId}`);
                const fileList = await jobFolderRef.listAll();
                for (const fileRef of fileList.items) {
                  try { await fileRef.delete(); } catch (e) { /* ignore */ }
                }
              } catch (storageError) {
                console.log('Error deleting storage files:', storageError);
              }

              const companyId = getCompanyId();
              if (!companyId) {
                alert.error('Error', 'Cannot delete job: company not found');
                return;
              }

              await deleteDoc(doc(db, 'companies', companyId, 'finishedJobs', jobId));
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
          <Text style={styles.offlineBannerText}>{t.offlineMode}</Text>
        </View>
      )}

      {/* Pending Jobs Indicator */}
      {isOnline && pendingJobCount > 0 && (
        <View style={styles.pendingJobsBanner}>
          <MaterialCommunityIcons name="cloud-upload" size={20} color="#fff" />
          <Text style={styles.pendingJobsText}>
            {t.pendingJobs}: {pendingJobCount}
          </Text>
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
          onPress={() => router.push({ pathname: '/FillJob', params: { mode: 'user' } })}
        >
          <Text style={styles.createButtonText}>{t.createJob}</Text>
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
              <Text style={styles.dateFilterButtonText}>{dateFilter.label}</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Client Filter */}
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

        {/* Jobs List */}
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
              {/* Title Row */}
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
              <Text style={[styles.jobDescription, { color: colors.textSecondary }]}>{job.description}</Text>
              <Text style={[styles.jobDetails, { color: colors.textSecondary }]}>
                {formatDate(job.finishedAt) || 'No date'} | {job.timeFrom} - {job.timeTo}
              </Text>
              <Text style={[styles.jobLocation, { color: colors.textSecondary }]}>
                <Text style={styles.locationLabel}>{t.location}: </Text>{job.location}
              </Text>
              {job.clientName && (
                <Text style={[styles.jobCustomer, { color: colors.textSecondary }]}>
                  {t.clientName}: {job.clientName}
                  {job.clientPhone && `   ${t.clientPhone}: ${job.clientPhone}`}
                </Text>
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
            <Text style={styles.syncingText}>
              {language === 'en' ? 'Syncing pending jobs...'
                : language === 'he' ? 'מסנכרן משימות ממתינות...'
                : 'مزامنة المهام المعلقة...'}
            </Text>
            <Text style={styles.syncingSubtext}>
              {language === 'en' ? 'Please wait, do not close the app'
                : language === 'he' ? 'אנא המתן, אל תסגור את האפליקציה'
                : 'يرجى الانتظار، لا تغلق التطبيق'}
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
        onFilterChange={(filter) => { setDateFilter(filter); setShowDateFilter(false); }}
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
