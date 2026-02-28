import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { auth, functions, httpsCallable } from '../../firebase';
import {
  borderRadius,
  getColors,
  gradients,
  shadows,
  spacing,
} from '../../theme';
import { useAlert } from '../../contexts/AlertContext';
import { useCache } from '../../contexts/CacheContext';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import {
  AppButton,
  AppCard,
  AppChip,
  AppEmptyState,
  AppText,
  GlobalHeader,
  LoadingSpinner,
  ViewJobDetails,
} from '../../components';


const JobCard = memo(function JobCard({
  job,
  palette,
  t,
  statusColor,
  statusLabel,
  highlighted,
  onOpenDetails,
  onAccept,
  onDeny,
}) {
  const isWaiting = String(job.status || '').toLowerCase() === 'waiting';

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={() => onOpenDetails(job)} style={styles.cardTouchable}>
      <AppCard
        style={[
          styles.jobCard,
          highlighted && [styles.highlightedCard, { borderColor: palette.secondary }],
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <View style={styles.topRow}>
          <View style={styles.titleWrap}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <View style={styles.metaWrap}>
              <AppText variant="heading" numberOfLines={1}>
                {job.title || t.untitled}
              </AppText>
              <AppText variant="caption" color={palette.textSecondary} numberOfLines={1}>
                {t.worker}: {job.workerName || t.unknownWorker}
              </AppText>
              {job.clientName ? (
                <AppText variant="caption" color={palette.textSecondary} numberOfLines={1}>
                  {t.clientName}: {job.clientName}
                </AppText>
              ) : null}
              {job.location ? (
                <AppText variant="caption" color={palette.textLight} numberOfLines={1}>
                  {t.location}: {job.location}
                </AppText>
              ) : null}
              {job.createdAt ? (
                <AppText variant="caption" color={palette.textLight} numberOfLines={1}>
                  {t.createdAt}: {new Date(job.createdAt).toLocaleDateString()}
                </AppText>
              ) : null}
            </View>
          </View>
          <AppChip label={statusLabel} status={job.status} color={statusColor} />
        </View>

        {isWaiting ? (
          <View style={styles.waitingActions}>
            <AppButton
              title={t.accept}
              iconLeft={{ name: 'checkmark-circle-outline' }}
              onPress={() => onAccept(job)}
              style={styles.actionButton}
            />
            <AppButton
              title={t.deny}
              variant="destructive"
              iconLeft={{ name: 'close-circle-outline' }}
              onPress={() => onDeny(job)}
              style={styles.actionButton}
            />
          </View>
        ) : null}
      </AppCard>
    </TouchableOpacity>
  );
});

const translateMap = {
  en: {
    title: 'Manage Jobs',
    subtitle: 'Approve worker submissions',
    assignJob: 'Assign New Job',
    noJobs: 'No pending jobs',
    pending: 'Pending',
    waiting: 'Waiting',
    finished: 'Finished',
    denied: 'Denied',
    jobDetails: 'Job Details',
    close: 'Close',
    accept: 'Accept',
    deny: 'Deny',
    worker: 'Worker',
    unknownWorker: 'Unknown worker',
    createdAt: 'Created',
    status: 'Status',
    titleLabel: 'Title',
    description: 'Description',
    location: 'Location',
    photos: 'Photos',
    noPhotos: 'No photos',
    signature: 'Signature',
    noSignature: 'No signature',
    timeWorked: 'Time worked',
    clientName: 'Client',
    clientPhone: 'Client phone',
    partsUsed: 'Parts used',
    noParts: 'No parts',
    acceptSuccess: 'Job accepted successfully',
    denySuccess: 'Job denied',
    confirmAccept: 'Accept Job',
    confirmAcceptMessage: 'Are you sure you want to accept this job?',
    confirmDeny: 'Deny Job',
    confirmDenyMessage: 'Are you sure you want to deny this job?',
    cancel: 'Cancel',
    loading: 'Loading jobs...',
    untitled: 'Untitled Job',
  },
};

export default function ManageJobs() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const insets = useSafeAreaInsets();
  const {
    companyJobs,
    cachedWorkersList,
    getCompanyId,
    getUid,
    acceptJob,
    updateJob,
  } = useCache();

  const cachedPendingJobs = useMemo(
    () => (companyJobs || []).filter(j => j.status === 'pending' || j.status === 'waiting'),
    [companyJobs]
  );

  const palette = getColors(isDarkMode);
  const t = translateMap[language] || translateMap.en;
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [selectedJobDetails, setSelectedJobDetails] = useState(null);
  const [highlightedJobId, setHighlightedJobId] = useState(null);

  const workerNameByUid = useMemo(() => {
    const source = cachedWorkersList || {};
    if (Array.isArray(source)) {
      return source.reduce((acc, worker) => {
        if (worker?.uid) acc[worker.uid] = worker.name || worker.email || worker.uid;
        return acc;
      }, {});
    }
    return Object.keys(source).reduce((acc, uid) => {
      const worker = source[uid] || {};
      acc[uid] = worker.name || worker.email || uid;
      return acc;
    }, {});
  }, [cachedWorkersList]);

  useEffect(() => {
    const list = Array.isArray(cachedPendingJobs) ? [...cachedPendingJobs] : [];
    list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    setJobs(
      list.map((job) => ({
        ...job,
        workerName:
          job.name ||
          workerNameByUid[job.completedBy] ||
          workerNameByUid[job.assignedTo] ||
          workerNameByUid[job.workerId],
      }))
    );
    setLoading(false);
  }, [cachedPendingJobs, workerNameByUid]);

  useEffect(() => {
    if (!jobId || loading) return;
    setHighlightedJobId(String(jobId));
    const timer = setTimeout(() => setHighlightedJobId(null), 2400);
    return () => clearTimeout(timer);
  }, [jobId, loading]);

  const getStatusColor = useCallback((status) => {
    const key = String(status || '').toLowerCase();
    if (key === 'pending') return '#F59E0B';
    if (key === 'waiting') return '#8B5CF6';
    if (key === 'finished') return '#10B981';
    if (key === 'denied') return '#DC2626';
    return '#64748B';
  }, []);

  const getStatusLabel = useCallback((status) => {
    const key = String(status || '').toLowerCase();
    if (key === 'pending') return t.pending;
    if (key === 'waiting') return t.waiting;
    if (key === 'finished') return t.finished;
    if (key === 'denied') return t.denied;
    return status || '-';
  }, [t]);

  const renderJobCard = useCallback(({ item }) => (
    <JobCard
      job={item}
      palette={palette}
      t={t}
      statusColor={getStatusColor(item.status)}
      statusLabel={getStatusLabel(item.status)}
      highlighted={highlightedJobId === String(item.id)}
      onOpenDetails={setSelectedJobDetails}
      onAccept={handleAcceptJob}
      onDeny={handleDenyJob}
    />
  ), [palette, t, getStatusColor, getStatusLabel, highlightedJobId, handleAcceptJob, handleDenyJob]);

  const keyExtractor = useCallback((item) => String(item.id), []);

  const handleAcceptJob = useCallback((job) => {
    alert.confirm(t.confirmAccept, t.confirmAcceptMessage, [
      { text: t.cancel, style: 'cancel', onPress: () => {} },
      {
        text: t.accept,
        style: 'primary',
        onPress: async () => {
          try {
            const companyId = getCompanyId();
            if (!companyId) {
              alert.error('Error', 'Company ID not found in profile.');
              return;
            }

            const acceptJobFn = httpsCallable(functions, 'acceptJobV1');

            await acceptJobFn({ companyId, jobId: job.id });

            const acceptedAt = new Date().toISOString();

            await acceptJob(job.id, {
              status: 'finished',
              finishedAt: job.finishedAt || acceptedAt,
              acceptedAt,
              acceptedBy: getUid() || auth.currentUser?.uid,
              updatedAt: acceptedAt,
              isCert: job.isCert === true,
            });

            setSelectedJobDetails(null);
            alert.success('Success', t.acceptSuccess);
          } catch (error) {
            console.error('ManageJobs accept error:', error);
            alert.error('Error', `Failed to accept job: ${error.message}`);
          }
        },
      },
    ]);
  }, [alert, t, getCompanyId, getUid, acceptJob]);

  const handleDenyJob = useCallback((job) => {
    alert.confirm(t.confirmDeny, t.confirmDenyMessage, [
      { text: t.cancel, style: 'cancel', onPress: () => {} },
      {
        text: t.deny,
        style: 'destructive',
        onPress: async () => {
          try {
            const companyId = getCompanyId();
            if (!companyId) {
              alert.error('Error', 'Company ID not found in profile.');
              return;
            }

            const deniedBy = getUid() || auth.currentUser?.uid;
            const payload = {
              status: 'denied',
              deniedAt: new Date().toISOString(),
              deniedBy,
            };

            const updateJobFn = httpsCallable(functions, 'updateJobV1');
            await updateJobFn({ companyId, jobId: job.id, ...payload });
            await updateJob(job.id, payload, true);

            setSelectedJobDetails(null);
            alert.success('Success', t.denySuccess);
          } catch (error) {
            console.error('ManageJobs deny error:', error);
            alert.error('Error', `Failed to deny job: ${error.message}`);
          }
        },
      },
    ]);
  }, [alert, t, getCompanyId, getUid, updateJob]);

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: palette.background }]}>
        <StatusBar style={isDarkMode ? 'light' : 'dark'} />
        <View style={styles.centered}>
          <LoadingSpinner text={t.loading} />
        </View>
        <GlobalHeader />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />

      <View style={[styles.topCtaWrap, { paddingTop: Platform.OS === 'ios' ? 108 : 96 }]}>
        <TouchableOpacity activeOpacity={0.9} onPress={() => router.push('/CreateJob')}>
          <LinearGradient colors={gradients.indigoBox} style={styles.ctaGradient}>
            <MaterialCommunityIcons name="clipboard-plus-outline" size={22} color="#FFFFFF" />
            <AppText variant="bodyStrong" color="#FFFFFF">
              {t.assignJob}
            </AppText>
            <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <FlatList
        data={jobs}
        keyExtractor={keyExtractor}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + 110,
          paddingTop: spacing.sm,
          flexGrow: jobs.length === 0 ? 1 : 0,
        }}
        renderItem={renderJobCard}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews
        ListEmptyComponent={
          <AppEmptyState
            icon="clipboard-text-off-outline"
            title={t.noJobs}
            subtitle={t.subtitle}
            action={
              <AppButton
                title={t.assignJob}
                onPress={() => router.push('/CreateJob')}
                iconLeft={{ name: 'add-circle-outline' }}
                style={{ marginTop: spacing.md }}
              />
            }
          />
        }
      />

      <ViewJobDetails
        visible={!!selectedJobDetails}
        job={selectedJobDetails}
        onClose={() => setSelectedJobDetails(null)}
        translations={{
          jobDetails: t.jobDetails,
          title: t.titleLabel,
          description: t.description,
          location: t.location,
          clientName: t.clientName,
          clientPhone: t.clientPhone,
          createdAt: t.createdAt,
          finishedAt: t.finished,
          status: t.status,
          photos: t.photos,
          noPhotos: t.noPhotos,
          signature: t.signature,
          noSignature: t.noSignature,
          partsUsed: t.partsUsed,
          noParts: t.noParts,
          close: t.close,
          timeWorked: t.timeWorked,
          assignedBy: t.worker,
        }}
        getStatusColor={getStatusColor}
        onImagePress={() => {}}
        isDarkMode={isDarkMode}
      />

      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topCtaWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  ctaGradient: {
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    ...shadows.primary,
  },
  cardTouchable: {
    marginBottom: spacing.md,
  },
  jobCard: {
    borderWidth: 1,
    ...shadows.card,
  },
  highlightedCard: {
    borderWidth: 2,
    transform: [{ scale: 1.01 }],
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleWrap: {
    flexDirection: 'row',
    flex: 1,
    gap: spacing.sm,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 8,
  },
  metaWrap: {
    flex: 1,
    gap: 2,
  },
  waitingActions: {
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
});
