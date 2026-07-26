import React, { useEffect, useMemo, useState } from 'react';
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
import { colors as themeColors, getColors, shadows } from '../../../theme';
import { AppText, GlobalHeader, ViewJobDetails, DateFilter, ScrollableContainer } from '../../../components';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTenant } from '../../../contexts/TenantContext';
import { scopedKey, storage } from '../../../contexts/mmkv-storage';
import { logger } from '../../../utils/logger';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useJobsInfinite } from '../../jobs/lib/use-jobs-infinite';
import type { MobileJobSummary } from '../../jobs/lib/job-list-model';
import type { DateLike } from '../../../types';
import type { DateFilterRange } from '../../../components/forms/DateFilter';
import { ROUTES } from '../../../navigation/routes';

type WorkerJobRecord = MobileJobSummary & {
  workDescription?: string;
  submittedAt?: DateLike;
  dueDate?: string;
  timestamp?: DateLike;
};

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
  const { user } = useSession();
  const { workspace } = useTenant();
  const colors = getColors(isDarkMode);

  // ─── State ──────────────────────────────────────────────────────
  const [isOnline, setIsOnline] = useState(true);
  const [selectedJobDetails, setSelectedJobDetails] = useState<WorkerJobRecord | null>(null);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilterRange>({
    type: 'last7days',
    startDate: new Date(new Date().setDate(new Date().getDate() - 7)),
    endDate: new Date(),
    label: 'Last 7 Days',
  });
  const jobsFilters = useMemo(() => ({
    status: ['pending', 'waiting', 'finished', 'denied'] as const,
    dateFrom: dateFilter.startDate,
    dateTo: dateFilter.type === 'lastMonth' ? dateFilter.endDate : undefined,
    pageSize: 50,
  }), [dateFilter.endDate, dateFilter.startDate, dateFilter.type]);
  const { query: jobsQuery, jobs } = useJobsInfinite({
    uid: user?.id ?? null,
    companyId: workspace?.companyId ?? null,
    filters: jobsFilters,
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
    denied: 'נדחה',
    assignedBy: 'הוקצה על ידי',
    clientName: 'שם הלקוח',
    clientPhone: 'טלפון הלקוח',
    timeWorked: 'שעות עבודה',
    location: 'מיקום',
    description: 'תיאור',
    offlineMode: 'מצב לא מקוון',
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
    denied: 'مرفوض',
    assignedBy: 'تم التعيين بواسطة',
    clientName: 'اسم العميل',
    clientPhone: 'هاتف العميل',
    timeWorked: 'وقت العمل',
    location: 'الموقع',
    description: 'وصف',
    offlineMode: 'وضع عدم الاتصال',
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

  const canCompleteJob = (job: WorkerJobRecord) => (
    job.status === 'pending' || job.status === 'waiting'
  );

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
      case 'finished': return language === 'en' ? 'Finished' : language === 'he' ? 'הושלם' : 'منتهي';
      case 'denied': return t.denied;
      default: return status || t.pending;
    }
  };

  // ─── Data Loading ───────────────────────────────────────────────────

  useEffect(() => {
    if (jobsQuery.error) {
      logger.warn('Assigned jobs refresh failed; retaining cached query data', jobsQuery.error);
    }
  }, [jobsQuery.error]);

  // The outbox provider owns synchronization. This listener only drives offline UI.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
    return () => unsubscribe();
  }, []);

  // ─── Actions ────────────────────────────────────────────────────

  const handleFillDetails = (job: WorkerJobRecord) => {
    // Clear any existing draft for this job to prevent loading old data
    try {
      storage.remove(getWorkerDraftStorageKey(job.id));
    } catch (error) {
      logger.warn('Could not clear the assigned-job draft', error);
    }

    // Navigate to FillJob — it handles the full form
    router.push({
      pathname: ROUTES.fillJob,
      params: {
        mode: 'worker',
        job: JSON.stringify({
          id: job.id,
          jobNo: job.jobNo,
          entityVersion: job.entityVersion,
          title: job.title || '',
          timeFrom: job.timeFrom || '',
          timeTo: job.timeTo || '',
          location: job.location || '',
          description: job.workDescription || job.description || '',
          cname: job.cname || '',
          cphone: job.cphone || '',
          cid: job.cid || null,
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

  if (jobsQuery.isLoading && jobs.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  return (
    <View testID="worker-jobs-screen" style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />

      {/* Offline Banner */}
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <MaterialCommunityIcons name="wifi-off" size={20} color="#fff" />
          <AppText style={styles.offlineBannerText}>{t.offlineMode}</AppText>
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

        {jobsQuery.isError && (
          <View style={[styles.queryErrorBanner, { backgroundColor: colors.backgroundElevated, borderColor: colors.error }]}>
            <AppText style={[styles.queryErrorText, { color: colors.textPrimary }]}>
              {language === 'en'
                ? 'Jobs could not be refreshed. Saved results remain available.'
                : language === 'he'
                  ? 'לא ניתן היה לרענן את המשימות. התוצאות השמורות נשארו זמינות.'
                  : 'تعذّر تحديث المهام. ستبقى النتائج المحفوظة متاحة.'}
            </AppText>
            <TouchableOpacity
              style={[styles.retryButton, { backgroundColor: colors.secondary }]}
              onPress={() => { void jobsQuery.refetch(); }}
              disabled={jobsQuery.isFetching}
            >
              {jobsQuery.isFetching ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <AppText style={styles.retryButtonText}>
                  {language === 'en' ? 'Retry' : language === 'he' ? 'נסה שוב' : 'إعادة المحاولة'}
                </AppText>
              )}
            </TouchableOpacity>
          </View>
        )}

        {jobs.length === 0 && !jobsQuery.isError ? (
          <AppText style={styles.emptyText}>{t.noJobs}</AppText>
        ) : jobs.length > 0 ? (
          jobs.map((job) => (
            <TouchableOpacity
              key={job.id}
              testID={`worker-job-${job.id}`}
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
                  {canCompleteJob(job) && (
                    <TouchableOpacity
                      testID={`worker-job-complete-${job.id}`}
                      style={[styles.iconButton, styles.receiveIconButton]}
                      onPress={(e) => { e.stopPropagation(); handleFillDetails(job); }}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="clipboard-check" size={24} color="white" />
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
                  {language === 'en' ? 'Due Date' : language === 'he' ? 'תאריך יעד' : 'تاريخ الاستحقاق'}: {new Date(job.dueDate).toLocaleDateString()}
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
                    <Image source={require('../../../assets/icons8-waze-48.png')} style={styles.wazeIcon} />
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
        ) : null}

        {jobsQuery.hasNextPage && (
          <TouchableOpacity
            style={[styles.loadMoreButton, { backgroundColor: colors.secondary }]}
            onPress={() => { void jobsQuery.fetchNextPage(); }}
            disabled={jobsQuery.isFetchingNextPage}
          >
            {jobsQuery.isFetchingNextPage ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <AppText style={styles.loadMoreText}>
                {language === 'en' ? 'Load more' : language === 'he' ? 'טען עוד' : 'تحميل المزيد'}
              </AppText>
            )}
          </TouchableOpacity>
        )}
      </ScrollableContainer>

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
  queryErrorBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    gap: 12,
  },
  queryErrorText: {
    fontSize: 14,
    lineHeight: 20,
  },
  retryButton: {
    alignSelf: 'flex-start',
    minWidth: 88,
    minHeight: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  loadMoreButton: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  loadMoreText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});







