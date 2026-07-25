import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
 } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { auth } from '../../../lib/auth/transport';
import { randomUUID } from 'expo-crypto';
import {
  deleteJob as deleteJobApi,
} from '../lib/jobs-api';
import { getColors } from '../../../theme';
import { AppText, GlobalHeader, ViewJobDetails, DateFilter, ScrollableContainer, ClientSelectorModal } from '../../../components';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { useOutbox } from '../../../contexts/OutboxContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTenant } from '../../../contexts/TenantContext';
import { scopedKey, storage } from '../../../contexts/mmkv-storage';
import { safeJsonParse } from '../../../utils/helpers';
import { enqueueOutboxOperation } from '../../../lib/outbox/operations';
import { stageFinishedJobAttachments } from '../lib/finished-job-outbox-attachments';
import { buildFinishedJobOutboxPayload } from '../lib/finished-job-outbox-model';
import type { JobItem } from '../../../types';
import type { DateFilterRange } from '../../../components/forms/DateFilter';
import { ROUTES } from '../../../navigation/routes';
import { logger } from '../../../utils/logger';
import { styles } from './Userjob.styles';
import { getUserJobCopy } from '../lib/user-job-copy';
import {
  canDeleteUserJob,
  canEditUserJob,
  formatUserJobDate,
  getDateLikeTime,
  getUserJobStatusColor,
  isUserJobNew,
  type UserJobRecord,
} from '../lib/user-job-model';

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

export default function Userjob() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const insets = useSafeAreaInsets();
  const { user: sessionUser } = useSession();
  const { workspace } = useTenant();
  const {
    database: outboxDatabase,
    ready: outboxReady,
    synchronizeOperation,
    refresh: refreshOutbox,
  } = useOutbox();
  const {
    profile,
    jobs: cachedJobs,
    companyJobs: cachedCompanyJobs,
    clients: cachedClients,
    getUid,
    getCompanyId,
    getUserRole,
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
  const t = getUserJobCopy(language);

  const checkPendingJobCount = async () => {
    try {
      const pending = storage.getString(getUserPendingJobsStorageKey());
      if (pending) setPendingJobCount((safeJsonParse<PendingJobRecord[]>(pending, []) || []).length);
    } catch (error) {
      logger.error('Error checking pending jobs:', error);
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
      logger.error('Error checking for draft:', error);
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
      if (!sessionUser || !workspace || !outboxReady || !outboxDatabase) {
        throw new Error('The encrypted pending-work queue is not ready');
      }
      let remainingJobs = [...pendingArray];

      for (const pendingJob of pendingArray) {
        try {
          const jobPayload = {
            ...(pendingJob.jobData || {}),
          };
          if (!jobPayload.signature) {
            throw new Error('The pending job is missing its required signature');
          }
          const attachments = await stageFinishedJobAttachments({
            userId: sessionUser.id,
            photos: Array.isArray(jobPayload.photos) ? jobPayload.photos : [],
            signature: jobPayload.signature,
          });
          const payload = buildFinishedJobOutboxPayload({
            title: String(jobPayload.title || ''),
            description: String(jobPayload.description || ''),
            location: String(jobPayload.location || ''),
            clientId: jobPayload.cid ?? null,
            assigneeMemberNo: jobPayload.wid ?? null,
            timeFrom: String(jobPayload.timeFrom || ''),
            timeTo: String(jobPayload.timeTo || ''),
            signingPerson: String(jobPayload.signingPerson || ''),
            travelDistance: jobPayload.travelDistance ?? null,
            parts: Array.isArray(jobPayload.partsUsed) ? jobPayload.partsUsed : [],
          });
          const operationId = await enqueueOutboxOperation({
            database: outboxDatabase,
            companyId: workspace.companyId,
            kind: 'job.create_finished',
            payload,
            attachments,
          });

          remainingJobs = remainingJobs.filter((candidate) => candidate !== pendingJob);
          if (remainingJobs.length > 0) {
            storage.set(getUserPendingJobsStorageKey(), JSON.stringify(remainingJobs));
          } else {
            storage.remove(getUserPendingJobsStorageKey());
          }
          if (pendingJob.localJobId) removeJob(String(pendingJob.localJobId));
          await synchronizeOperation(operationId).catch(() => undefined);
        } catch (error) {
          logger.error('Error syncing job:', error);
        }
      }

      await refreshOutbox();
      if (remainingJobs.length > 0) {
        storage.set(getUserPendingJobsStorageKey(), JSON.stringify(remainingJobs));
        setPendingJobCount(remainingJobs.length);
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
      logger.error('Error syncing pending jobs:', error);
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
      if (auth.currentUser) logger.error('Error loading jobs:', error);
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
    if (!canEditUserJob(job)) {
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
      pathname: ROUTES.editJob,
      params: {
        mode: 'user',
        job: JSON.stringify({
          id: job.id,
          entityVersion: job.entityVersion,
          status: job.status,
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
    if (job && !canDeleteUserJob(job)) {
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

              const companyIdStr = getCompanyId();
              if (!companyIdStr) {
                alert.error('Error', 'Cannot delete job: company not found');
                return;
              }
              const companyId = Number(companyIdStr);
              if (!Number.isSafeInteger(companyId) || companyId <= 0) {
                alert.error('Error', 'Cannot delete job: company ID is invalid');
                return;
              }
              const uid = getUid() || currentUser.uid;
              if (!uid) {
                alert.error('Error', 'User identity not found');
                return;
              }
              if (!job || !job.entityVersion) {
                alert.error('Error', 'The job version is missing. Reload the list and try again.');
                return;
              }

              await deleteJobApi({
                uid,
                companyId,
                jobId: String(jobId),
                request: { entityVersion: job.entityVersion },
                idempotencyKey: randomUUID(),
              });
              removeJob(jobId);
              alert.success('Success', 'Job deleted successfully');
              loadJobs();
            } catch (error) {
              logger.error('Error deleting job:', error);
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
                  {isUserJobNew(job) && (
                    <View style={styles.newBadge}>
                      <AppText style={styles.newBadgeText}>
                        {language === 'en' ? 'NEW' : language === 'he' ? 'חדש' : 'جديد'}
                      </AppText>
                    </View>
                  )}
                </View>
                <View style={styles.actionIcons}>
                  <TouchableOpacity
                    style={[styles.iconButton, styles.editIconButton, !canEditUserJob(job) && styles.disabledIconButton]}
                    onPress={(e) => { e.stopPropagation(); handleEditJob(job); }}
                    disabled={!canEditUserJob(job)}
                  >
                    <MaterialCommunityIcons name="pencil" size={20} color="white" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.iconButton, styles.deleteIconButton, !canDeleteUserJob(job) && styles.disabledIconButton]}
                    onPress={(e) => { e.stopPropagation(); handleDeleteJob(job.id); }}
                    disabled={!canDeleteUserJob(job)}
                  >
                    <MaterialCommunityIcons name="delete" size={20} color="white" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Job Info */}
              <AppText style={[styles.jobDescription, { color: colors.textSecondary }]}>{job.description}</AppText>
              <AppText style={[styles.jobDetails, { color: colors.textSecondary }]}>
                {formatUserJobDate(job.finishedAt) || 'No date'} | {job.timeFrom} - {job.timeTo}
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
        getStatusColor={getUserJobStatusColor}
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


