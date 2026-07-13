import { ROUTES } from '../../../navigation/routes';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { auth, functions, httpsCallable } from '../../../firebase';
import {
  borderRadius,
  getColors,
  gradients,
  shadows,
  spacing,
} from '../../../theme';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import {
  AppButton,
  AppCard,
  AppChip,
  AppEmptyState,
  AppText,
  GlobalHeader,
  LoadingSpinner,
  ScreenHeroCard,
  ViewJobDetails,
} from '../../../components';
import type { Job, Worker } from '../../../types';

type Translations = typeof translateMap.en;

interface JobCardProps {
  job: Job & { workerName?: string };
  palette: ReturnType<typeof getColors>;
  t: Translations;
  statusColor: string;
  statusLabel: string;
  highlighted: boolean;
  onOpenDetails: (job: Job & { workerName?: string }) => void;
  onAccept: (job: Job & { workerName?: string }) => void;
  onDeny: (job: Job & { workerName?: string }) => void;
}


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
}: JobCardProps) {
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
              {job.cname ? (
                <AppText variant="caption" color={palette.textSecondary} numberOfLines={1}>
                  {t.clientName}: {job.cname}
                </AppText>
              ) : null}
              {job.location ? (
                <AppText variant="caption" color={palette.textLight} numberOfLines={1}>
                  {t.location}: {job.location}
                </AppText>
              ) : null}
              {job.createdAt ? (
                <AppText variant="caption" color={palette.textLight} numberOfLines={1}>
                  {t.createdAt}: {new Date(String(job.createdAt)).toLocaleDateString()}
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
  he: {
    title: 'ניהול משימות',
    subtitle: 'אישור הגשות עובדים',
    assignJob: 'הקצה משימה חדשה',
    noJobs: 'אין משימות ממתינות',
    pending: 'ממתין',
    waiting: 'בהמתנה',
    finished: 'הושלם',
    denied: 'נדחה',
    jobDetails: 'פרטי משימה',
    close: 'סגור',
    accept: 'אשר',
    deny: 'דחה',
    worker: 'עובד',
    unknownWorker: 'עובד לא ידוע',
    createdAt: 'נוצר',
    status: 'סטטוס',
    titleLabel: 'כותרת',
    description: 'תיאור',
    location: 'מיקום',
    photos: 'תמונות',
    noPhotos: 'אין תמונות',
    signature: 'חתימה',
    noSignature: 'אין חתימה',
    timeWorked: 'זמן עבודה',
    clientName: 'לקוח',
    clientPhone: 'טלפון לקוח',
    partsUsed: 'חלקים שנעשה בהם שימוש',
    noParts: 'אין חלקים',
    acceptSuccess: 'המשימה אושרה בהצלחה',
    denySuccess: 'המשימה נדחתה',
    confirmAccept: 'אשר משימה',
    confirmAcceptMessage: 'האם אתה בטוח שברצונך לאשר משימה זו?',
    confirmDeny: 'דחה משימה',
    confirmDenyMessage: 'האם אתה בטוח שברצונך לדחות משימה זו?',
    cancel: 'ביטול',
    loading: 'טוען משימות...',
    untitled: 'משימה ללא שם',
  },
  ar: {
    title: 'إدارة المهام',
    subtitle: 'الموافقة على تقديمات العمال',
    assignJob: 'تعيين مهمة جديدة',
    noJobs: 'لا توجد مهام معلقة',
    pending: 'معلق',
    waiting: 'في الانتظار',
    finished: 'مكتمل',
    denied: 'مرفوض',
    jobDetails: 'تفاصيل المهمة',
    close: 'إغلاق',
    accept: 'قبول',
    deny: 'رفض',
    worker: 'عامل',
    unknownWorker: 'عامل غير معروف',
    createdAt: 'تم الإنشاء',
    status: 'الحالة',
    titleLabel: 'العنوان',
    description: 'الوصف',
    location: 'الموقع',
    photos: 'الصور',
    noPhotos: 'لا توجد صور',
    signature: 'التوقيع',
    noSignature: 'لا يوجد توقيع',
    timeWorked: 'وقت العمل',
    clientName: 'العميل',
    clientPhone: 'هاتف العميل',
    partsUsed: 'القطع المستخدمة',
    noParts: 'لا توجد قطع',
    acceptSuccess: 'تم قبول المهمة بنجاح',
    denySuccess: 'تم رفض المهمة',
    confirmAccept: 'قبول المهمة',
    confirmAcceptMessage: 'هل أنت متأكد من قبول هذه المهمة؟',
    confirmDeny: 'رفض المهمة',
    confirmDenyMessage: 'هل أنت متأكد من رفض هذه المهمة؟',
    cancel: 'إلغاء',
    loading: 'جاري تحميل المهام...',
    untitled: 'مهمة بدون عنوان',
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
    workers,
    getCompanyId,
    getUid,
    acceptJob,
    updateJob,
  } = useCache();

  const cachedPendingJobs = useMemo(
    () => (companyJobs || []).filter(j => String(j.status) === 'pending' || String(j.status) === 'waiting'),
    [companyJobs]
  );

  const palette = getColors(isDarkMode);
  const t = translateMap[language] || translateMap.en;
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<(Job & { workerName?: string })[]>([]);
  const [selectedJobDetails, setSelectedJobDetails] = useState<(Job & { workerName?: string }) | null>(null);
  const [highlightedJobId, setHighlightedJobId] = useState<string | null>(null);

  const waitingCount = useMemo(
    () => jobs.filter((job) => String(job.status || '').toLowerCase() === 'waiting').length,
    [jobs]
  );

  const pendingCount = useMemo(
    () => jobs.filter((job) => String(job.status || '').toLowerCase() === 'pending').length,
    [jobs]
  );

  const workerNameByWid = useMemo<Record<string, string>>(() => {
    const source = workers || {};
    if (Array.isArray(source)) {
      return (source as Worker[]).reduce<Record<string, string>>((acc, worker) => {
        if (worker?.wid) acc[String(worker.wid)] = String(worker.name || worker.email || worker.wid);
        return acc;
      }, {});
    }
    return Object.keys(source as Record<string, Worker>).reduce<Record<string, string>>((acc, wid) => {
      const worker = (source as Record<string, Worker>)[wid] || {};
      acc[wid] = String(worker.name || worker.email || wid);
      return acc;
    }, {});
  }, [workers]);

  useEffect(() => {
    const list = Array.isArray(cachedPendingJobs) ? [...cachedPendingJobs] : [];
    list.sort((a, b) => new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime());
    setJobs(
      list.map((job) => ({
        ...job,
        workerName: job.wname || workerNameByWid[String(job.wid)],
      }))
    );
    setLoading(false);
  }, [cachedPendingJobs, workerNameByWid]);

  useEffect(() => {
    if (!jobId || loading) return;
    setHighlightedJobId(String(jobId));
    const timer = setTimeout(() => setHighlightedJobId(null), 2400);
    return () => clearTimeout(timer);
  }, [jobId, loading]);

  const getStatusColor = useCallback((status: string | null | undefined) => {
    const key = String(status || '').toLowerCase();
    if (key === 'pending') return '#F59E0B';
    if (key === 'waiting') return '#8B5CF6';
    if (key === 'finished') return '#10B981';
    if (key === 'denied') return '#DC2626';
    return '#64748B';
  }, []);

  const getStatusLabel = useCallback((status: string | null | undefined) => {
    const key = String(status || '').toLowerCase();
    if (key === 'pending') return t.pending;
    if (key === 'waiting') return t.waiting;
    if (key === 'finished') return t.finished;
    if (key === 'denied') return t.denied;
    return status || '-';
  }, [t]);

  const handleAcceptJob = useCallback((job: Job & { workerName?: string }) => {
    alert.confirm(t.confirmAccept, t.confirmAcceptMessage, [
      { text: t.cancel, style: 'cancel', onPress: () => {} },
      {
        text: t.accept,
        style: 'default',
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
          } catch (error: any) {
            console.error('ManageJobs accept error:', error);
            alert.error('Error', `Failed to accept job: ${error.message}`);
          }
        },
      },
    ]);
  }, [alert, t, getCompanyId, getUid, acceptJob]);

  const handleDenyJob = useCallback((job: Job & { workerName?: string }) => {
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
              status: 'denied' as const,
              deniedAt: new Date().toISOString(),
              deniedBy,
            };

            const updateJobFn = httpsCallable(functions, 'updateJobV1');
            await updateJobFn({ companyId, jobId: job.id, ...payload });
            await updateJob(job.id, payload);

            setSelectedJobDetails(null);
            alert.success('Success', t.denySuccess);
          } catch (error: any) {
            console.error('ManageJobs deny error:', error);
            alert.error('Error', `Failed to deny job: ${error.message}`);
          }
        },
      },
    ]);
  }, [alert, t, getCompanyId, getUid, updateJob]);

  const renderJobCard = useCallback(({ item }: { item: Job & { workerName?: string } }) => (
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

  const keyExtractor = useCallback((item: Job & { workerName?: string }) => String(item.id), []);

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

      <FlatList
        data={jobs}
        keyExtractor={keyExtractor}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + 110,
          paddingTop: Platform.OS === 'ios' ? 108 : 96,
          flexGrow: jobs.length === 0 ? 1 : 0,
        }}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <ScreenHeroCard
              title={t.title}
              subtitle={t.subtitle}
              eyebrow="Approvals"
              icon="clipboard-check-multiple"
              iconLibrary="material"
              accentColor={palette.boxIndigo}
              metrics={[
                { label: t.pending, value: String(pendingCount) },
                { label: t.waiting, value: String(waitingCount) },
                { label: language === 'he' ? 'בתור' : language === 'ar' ? 'في القائمة' : 'Queue', value: String(jobs.length) },
              ]}
              badges={[t.assignJob, t.accept, t.deny]}
            />

            <TouchableOpacity activeOpacity={0.9} onPress={() => router.push(ROUTES.createJob)}>
              <AppCard style={[styles.ctaCard, { backgroundColor: palette.backgroundElevated, borderColor: palette.border }]}> 
                <View style={styles.ctaCardRow}>
                  <View style={[styles.ctaIconWrap, { backgroundColor: `${palette.secondary}12` }]}> 
                    <MaterialCommunityIcons name="clipboard-plus-outline" size={22} color={palette.secondary} />
                  </View>
                  <View style={styles.ctaCopyWrap}>
                    <AppText variant="bodyStrong">{t.assignJob}</AppText>
                    <AppText variant="caption" color={palette.textSecondary}>
                      {t.subtitle}
                    </AppText>
                  </View>
                  <Ionicons name="arrow-forward" size={18} color={palette.secondary} />
                </View>
              </AppCard>
            </TouchableOpacity>
          </View>
        }
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
                onPress={() => router.push(ROUTES.createJob)}
                iconLeft={{ name: 'add-circle-outline' }}
                style={{ marginTop: spacing.md }}
              />
            }
          />
        }
      />

      <ViewJobDetails
        visible={!!selectedJobDetails}
        job={selectedJobDetails as any}
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
  listHeader: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  ctaCard: {
    ...shadows.card,
  },
  ctaCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  ctaIconWrap: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaCopyWrap: {
    flex: 1,
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

