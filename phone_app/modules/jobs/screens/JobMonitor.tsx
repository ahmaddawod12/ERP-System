import { styles } from './JobMonitor.styles';
import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { auth } from '../../../firebase';
import { colors, gradients, getColors } from '../../../theme';
import { AppCard, AppEmptyState, AppText, SearchInput, ViewJobDetails, GlobalHeader, DateFilter, ScreenHeroCard } from '../../../components';
import { useScrollHandler } from '../../../contexts/HeaderContext';
import type { DateFilterRange } from '../../../components/forms/DateFilter';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useCache } from '../../../contexts/CacheContext';
import { ROUTES } from '../../../navigation/routes';
import type { Job } from '../../../types';

const getTimeMs = (value?: unknown): number => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return new Date(value).getTime();
  if (typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === 'object' && 'seconds' in value && typeof (value as { seconds?: number }).seconds === 'number') {
    return (value as { seconds: number }).seconds * 1000;
  }
  return 0;
};

const formatDateShort = (value?: unknown): string => {
  const ms = getTimeMs(value);
  if (!ms) return '';
  return new Date(ms).toLocaleDateString();
};

const formatTimeShort = (value?: unknown): string => {
  const ms = getTimeMs(value);
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

interface JobCardProps {
  job: Job;
  isHighlighted: boolean;
  language: string;
  themeColors: ReturnType<typeof getColors>;
  isDarkMode: boolean;
  t: Record<string, string>;
  onPress: (job: Job) => void;
  onEdit: (job: Job) => void;
}

const JobCard = memo(function JobCard({
  job,
  isHighlighted,
  language,
  themeColors,
  isDarkMode,
  t,
  onPress,
  onEdit,
}: JobCardProps) {
  const displayName = job.wname || 'Unknown Worker';
  const statusColor =
    job.status?.toLowerCase() === 'pending' ? '#f59e0b' :
    job.status?.toLowerCase() === 'waiting' ? '#8b5cf6' :
    job.status?.toLowerCase() === 'finished' ? '#10b981' : '#6b7280';

  const statusText =
    job.status?.toLowerCase() === 'pending' ? t.pending :
    job.status?.toLowerCase() === 'waiting' ? t.waiting :
    job.status?.toLowerCase() === 'finished' ? t.finished :
    job.status || 'unknown';

  const isNew = (() => {
    if (!job.createdAt) return false;
    const hoursDiff = (Date.now() - getTimeMs(job.createdAt)) / (1000 * 60 * 60);
    return hoursDiff <= 24;
  })();

  return (
    <TouchableOpacity onPress={() => onPress(job)}>
      <AppCard
        style={[
          styles.jobCard,
          { backgroundColor: themeColors.backgroundElevated, borderColor: themeColors.border },
          isHighlighted && styles.highlightedJobCard,
        ]}
      >
        <View style={styles.jobHeader}>
          <View style={styles.jobLeft}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <View style={styles.jobHeaderContent}>
              <View style={styles.jobTitleRow}>
                <AppText style={[styles.jobTitle, { color: themeColors.textPrimary }]}>{job.title || 'Untitled Job'}</AppText>
                {isNew && (
                  <View style={styles.newBadge}>
                    <AppText style={styles.newBadgeText}>NEW</AppText>
                  </View>
                )}
              </View>
              <AppText style={[styles.jobWorker, { color: themeColors.textSecondary }]}>
                👤 {displayName}
              </AppText>
              {job.createdAt && (
                <AppText style={[styles.jobDate, { color: themeColors.textSecondary }]}>
                  📅 {formatDateShort(job.createdAt)}
                </AppText>
              )}
              {job.status?.toLowerCase() === 'finished' && job.finishedAt && (
                <AppText style={[styles.jobFinishedDate, { color: themeColors.textSecondary }]}>
                  ✓ {t.finishedAt || 'Finished'}: {formatDateShort(job.finishedAt)} {formatTimeShort(job.finishedAt)}
                </AppText>
              )}
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <AppText style={styles.statusText}>{statusText}</AppText>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.editButton, {
            backgroundColor: isDarkMode ? themeColors.border : 'rgba(0, 172, 193, 0.08)',
            borderColor: isDarkMode ? themeColors.border : 'rgba(0, 172, 193, 0.2)',
          }]}
          onPress={(e) => {
            e.stopPropagation();
            onEdit(job);
          }}
        >
          <Ionicons name="create-outline" size={18} color={themeColors.secondary} />
          <AppText style={[styles.editButtonText, { color: themeColors.secondary }]}>{t.edit}</AppText>
        </TouchableOpacity>
      </AppCard>
    </TouchableOpacity>
  );
});

export default function JobMonitor() {
  const router = useRouter();
  const { jobId: rawJobId } = useLocalSearchParams();
  const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId;
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const { scrollProps } = useScrollHandler();
  const {
    getCompanyId,
    companyJobs,
    getDataForDateRange,
    isWithinCacheRange,
  } = useCache();
  const cachedPendingJobs = useMemo(
    () => (companyJobs || []).filter(j => j.status === 'pending' || j.status === 'waiting'),
    [companyJobs]
  );
  const cachedFinishedJobs = useMemo(
    () => (companyJobs || []).filter(j => j.status === 'finished'),
    [companyJobs]
  );
  const themeColors = getColors(isDarkMode);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<{
    pending: Job[];
    waiting: Job[];
    finished: Job[];
  }>({
    pending: [],
    waiting: [],
    finished: [],
  });
  const [selectedJobDetails, setSelectedJobDetails] = useState<Job | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'pending' | 'waiting' | 'finished'>('all');
  const [highlightedJobId, setHighlightedJobId] = useState<string | null>(null);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilterRange>({
    type: 'last7days',
    startDate: new Date(new Date().setDate(new Date().getDate() - 7)),
    endDate: new Date(),
    label: 'Last 7 Days',
  });
  const [clientFilter, setClientFilter] = useState('');

  const t = (language === 'en' ? {
    title: 'Job Monitor',
    subtitle: 'Track all company jobs',
    back: 'Back',
    all: 'All',
    pending: 'Pending',
    waiting: 'Waiting',
    finished: 'Finished',
    noJobs: 'No jobs in this category',
    jobDetails: 'Job Details',
    close: 'Close',
    worker: 'worker',
    assignedBy: 'Assigned By',
    createdAt: 'Created At',
    status: 'Status',
    fieldTitle: 'Title',
    description: 'Description',
    location: 'Location',
    dueDate: 'Due Date',
    finishedAt: 'Finished',
    photos: 'Photos',
    noPhotos: 'No photos available',
    signingPerson: 'Signing Person',
    signature: 'Signature',
    noSignature: 'No signature available',
    loading: 'Loading jobs...',
    filterByDate: 'Filter by Date',
    selectDate: 'Select Date',
    clearDate: 'Clear Filter',
    allDates: 'All Dates',
    filterByClient: 'Filter by Client',
    allClients: 'All Clients',
    edit: 'Edit Job',
    save: 'Save',
    cancel: 'Cancel',
    timeWorked: 'Time Worked',
    from: 'From',
    to: 'To',
    clientPhone: 'Client Phone',
    partsUsed: 'Parts Used',
    noParts: 'No parts used',
    travelDistance: 'Travel Distance',
    km: 'km',
    editQuantity: 'Edit Qty',
    removePart: 'Remove',
    quantity: 'Quantity',
    addParts: 'Add Parts',
    addFromInventory: 'Add from Worker Inventory',
    selectParts: 'Select Parts to Add',
    searchParts: 'Search parts...',
    noInventoryParts: 'No parts in worker inventory',
    add: 'Add',
    showingJobsFrom: 'Showing jobs from',
    visible: 'Visible',
  } : language === 'he' ? {
    title: 'ניטור משימות',
    subtitle: 'מעקב אחר כל משימות החברה',
    back: 'חזרה',
    all: 'הכל',
    pending: 'ממתין',
    waiting: 'ממתין לאישור',
    finished: 'הושלם',
    noJobs: 'אין משימות בקטגוריה זו',
    jobDetails: 'פרטי משימה',
    close: 'סגור',
    worker: 'עובד',
    assignedBy: 'הוקצה על ידי',
    createdAt: 'נוצר ב',
    status: 'סטטוס',
    fieldTitle: 'כותרת',
    description: 'תיאור',
    location: 'מיקום',
    dueDate: 'תאריך יעד',
    finishedAt: 'הושלם',
    photos: 'תמונות',
    noPhotos: 'אין תמונות זמינות',
    signingPerson: 'שם החותם',
    signature: 'חתימה',
    noSignature: 'אין חתימה זמינה',
    loading: 'טוען משימות...',
    filterByDate: 'סינון לפי תאריך',
    selectDate: 'בחר תאריך',
    clearDate: 'נקה סינון',
    allDates: 'כל התאריכים',
    filterByClient: 'סינון לפי לקוח',
    allClients: 'כל הלקוחות',
    edit: 'ערוך משימה',
    save: 'שמור',
    cancel: 'בטל',
    timeWorked: 'זמן עבודה',
    from: 'מ',
    to: 'עד',
    clientName: 'שם הלקוח',
    clientPhone: 'טלפון הלקוח',
    partsUsed: 'חלקים בשימוש',
    noParts: 'אין חלקים בשימוש',
    travelDistance: 'מרחק נסיעה',
    km: 'ק"מ',
    editQuantity: 'ערוך כמות',
    removePart: 'הסר',
    quantity: 'כמות',
    addParts: 'הוסף חלקים',
    addFromInventory: 'הוסף ממלאי העובד',
    selectParts: 'בחר חלקים להוספה',
    searchParts: 'חיפוש חלקים...',
    noInventoryParts: 'אין חלקים במלאי העובד',
    add: 'הוסף',
    visible: 'מוצג',
  } : {
    title: 'مراقبة المهام',
    subtitle: 'تتبع جميع مهام الشركة',
    back: 'رجوع',
    all: 'الكل',
    pending: 'قيد الانتظار',
    waiting: 'في انتظار الموافقة',
    finished: 'منتهي',
    noJobs: 'لا توجد مهام في هذه الفئة',
    jobDetails: 'تفاصيل المهمة',
    close: 'إغلاق',
    worker: 'العامل',
    assignedBy: 'تم التعيين بواسطة',
    createdAt: 'تم الإنشاء في',
    status: 'الحالة',
    fieldTitle: 'العنوان',
    description: 'الوصف',
    location: 'الموقع',
    dueDate: 'تاريخ الاستحقاق',
    finishedAt: 'انتهى',
    photos: 'الصور',
    noPhotos: 'لا توجد صور متاحة',
    signingPerson: 'اسم الموقع',
    signature: 'التوقيع',
    noSignature: 'لا يوجد توقيع متاح',
    loading: 'جاري تحميل المهام...',
    filterByDate: 'تصفية حسب التاريخ',
    selectDate: 'حدد التاريخ',
    clearDate: 'مسح الفلتر',
    allDates: 'جميع التواريخ',
    filterByClient: 'تصفية حسب العميل',
    clientName: 'اسم العميل',
    allClients: 'جميع العملاء',
    edit: 'تعديل المهمة',
    save: 'حفظ',
    cancel: 'إلغاء',
    timeWorked: 'وقت العمل',
    from: 'من',
    to: 'إلى',
    clientPhone: 'هاتف العميل',
    partsUsed: 'القطع المستخدمة',
    noParts: 'لا توجد قطع مستخدمة',
    travelDistance: 'مسافة السفر',
    km: 'كم',
    editQuantity: 'تعديل الكمية',
    removePart: 'إزالة',
    quantity: 'الكمية',
    addParts: 'إضافة قطع',
    addFromInventory: 'إضافة من مخزون العامل',
    selectParts: 'اختر قطع للإضافة',
    searchParts: 'بحث عن قطع...',
    noInventoryParts: 'لا توجد قطع في مخزون العامل',
    add: 'إضافة',
    visible: 'المعروض',
  }) as Record<string, string>;

  // Use cached data with smart date filtering from CacheContext
  useEffect(() => {
    const loadJobsFromCache = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        const companyId = getCompanyId();

        if (!companyId) {
          console.error('CompanyId not found in cache');
          setLoading(false);
          return;
        }

        setLoading(true);

        // Check if date filter is within 90 days (use isWithinCacheRange from CacheContext)
        const isStartInCache = isWithinCacheRange(dateFilter.startDate);

        // Process pending jobs from cache (always within cache range since they're current)
        const pendingJobsList: Job[] = [];
        const waitingJobsList: Job[] = [];

        if (cachedPendingJobs && cachedPendingJobs.length > 0) {
          console.log('📦 [CACHE READ] JobMonitor - pending jobs from cache:', cachedPendingJobs.length);
          cachedPendingJobs.forEach((job) => {
            // Apply date filter
            const jobDateMs = getTimeMs(job.createdAt);
            if (jobDateMs >= dateFilter.startDate.getTime() && jobDateMs <= dateFilter.endDate.getTime()) {
              const jobData = {
                ...job,
                workerName: job.wname || 'Unknown',
              };

              const status = jobData.status?.toLowerCase();
              if (status === 'pending') {
                pendingJobsList.push(jobData);
              } else if (status === 'waiting') {
                waitingJobsList.push(jobData);
              }
            }
          });
        }

        // Sort pending jobs lists
        const sortByDate = (a: Job, b: Job) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt);
        pendingJobsList.sort(sortByDate);
        waitingJobsList.sort(sortByDate);

        // Get finished jobs using smart date filtering from CacheContext
        let finishedJobsData: Job[] = [];

        if (isStartInCache) {
          // Date range is within cache, filter from cached data
          if (cachedFinishedJobs && cachedFinishedJobs.length > 0) {
            console.log('📦 [CACHE READ] JobMonitor - finished jobs from cache:', cachedFinishedJobs.length);
            finishedJobsData = cachedFinishedJobs.filter((job) => {
              const finishedDateMs = getTimeMs(job.finishedAt);
              return finishedDateMs >= dateFilter.startDate.getTime() && finishedDateMs <= dateFilter.endDate.getTime();
            });
          }
        } else {
          // Date range extends beyond cache - use smart filtering.
          console.log('[BACKEND READ] JobMonitor - fetching older finished jobs');
          finishedJobsData = await getDataForDateRange(
            dateFilter.startDate,
            dateFilter.endDate,
            'finishedJobs'
          );
        }

        const finishedJobsList = (finishedJobsData as Job[])
          .map((job) => ({
            ...job,
            workerName: job.wname || 'Unknown',
          }))
          .sort((a, b) => getTimeMs(b.finishedAt) - getTimeMs(a.finishedAt));

        setJobs({
          pending: pendingJobsList,
          waiting: waitingJobsList,
          finished: finishedJobsList,
        });

        setLoading(false);

      } catch (error) {
        console.error('Error loading jobs from cache:', error);
        setLoading(false);
      }
    };

    loadJobsFromCache();
  }, [dateFilter, companyJobs]); // Re-run when date filter or cache changes

  // Apply client name filter to jobs
  useEffect(() => {
    if (clientFilter.trim()) {
      const filterByClient = (jobsList: Job[]) => {
        const query = clientFilter.toLowerCase();
        return jobsList.filter(job =>
          (job.signingPersonName && job.signingPersonName.toLowerCase().includes(query)) ||
          (job.cname && job.cname.toLowerCase().includes(query))
        );
      };

      setJobs(prevJobs => ({
        pending: filterByClient(prevJobs.pending),
        waiting: filterByClient(prevJobs.waiting),
        finished: filterByClient(prevJobs.finished),
      }));
    }
  }, [clientFilter]);

  // Highlight job when navigating from WorkersMonitor with jobId
  useEffect(() => {
    if (jobId && !loading) {
      setHighlightedJobId(jobId);
      const timer = setTimeout(() => {
        setHighlightedJobId(null);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [jobId, loading]);

  const handleEditJob = useCallback((job: Job) => {
    router.push({
      pathname: ROUTES.editJob,
      params: {
        job: JSON.stringify(job),
      },
    });
  }, [router]);

  const handlePressJob = useCallback((job: Job) => {
    setSelectedJobDetails(job);
  }, []);

  const getFilteredJobs = () => {
    let allJobs: Job[] = [];
    if (activeFilter === 'all') {
      allJobs = [
        ...jobs.pending,
        ...jobs.waiting,
        ...jobs.finished,
      ];
    } else {
      allJobs = jobs[activeFilter] || [];
    }

    return allJobs.sort((a, b) => {
      const dateFieldA = a.status?.toLowerCase() === 'finished' ? a.finishedAt : a.createdAt;
      const dateFieldB = b.status?.toLowerCase() === 'finished' ? b.finishedAt : b.createdAt;
      const dateA = getTimeMs(dateFieldA);
      const dateB = getTimeMs(dateFieldB);
      return dateB - dateA;
    });
  };

  const filteredJobs = getFilteredJobs();

  const renderItem = useCallback(({ item }: { item: Job }) => (
    <JobCard
      job={item}
      isHighlighted={highlightedJobId === item.id}
      language={language}
      themeColors={themeColors}
      isDarkMode={isDarkMode}
      t={t}
      onPress={handlePressJob}
      onEdit={handleEditJob}
    />
  ), [highlightedJobId, language, themeColors, isDarkMode, t, handlePressJob, handleEditJob]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.secondary} />
        <AppText style={styles.loadingText}>{t.loading}</AppText>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />
      <FlatList
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        data={filteredJobs}
        keyExtractor={(item) => `${item.wid}-${item.id}`}
        renderItem={renderItem}
        ListHeaderComponent={
          <View>
            <ScreenHeroCard
              title={t.title}
              subtitle={t.subtitle}
              eyebrow="Monitoring"
              icon="clipboard-text-clock"
              iconLibrary="material"
              accentColor={themeColors.boxIndigo}
              metrics={[
                { label: t.pending, value: String(jobs.pending.length) },
                { label: t.waiting, value: String(jobs.waiting.length) },
                { label: t.visible, value: String(filteredJobs.length) },
              ]}
              badges={[t.filterByDate, t.filterByClient, dateFilter.label]}
              style={styles.heroCard}
            />

            <AppCard style={[styles.filtersCard, { backgroundColor: themeColors.backgroundElevated, borderColor: themeColors.border }]}>
              <View style={styles.filtersRow}>
                <TouchableOpacity
                  onPress={() => setShowDateFilter(true)}
                  style={styles.dateFilterButtonWrapper}
                >
                  <LinearGradient
                    colors={isDarkMode ? ['#0f172a', '#1e3a8a'] : ['#3b82f6', '#1e40af']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.dateFilterButton}
                  >
                    <Ionicons name="calendar-outline" size={20} color="#fff" />
                    <AppText style={styles.dateFilterButtonTextSmall}>
                      {dateFilter.label}
                    </AppText>
                  </LinearGradient>
                </TouchableOpacity>

                <SearchInput
                  value={clientFilter}
                  onChangeText={setClientFilter}
                  placeholder={t.filterByClient}
                  onClear={() => setClientFilter('')}
                  colors={themeColors}
                  style={styles.clientFilterInput}
                />
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterContainer}
                contentContainerStyle={styles.filterContent}
              >
                <TouchableOpacity
                  style={[styles.filterButton, activeFilter === 'all' && styles.filterButtonActive]}
                  onPress={() => setActiveFilter('all')}
                >
                  <LinearGradient
                    colors={activeFilter === 'all' ? gradients.indigoBox : ['#F3F4F6', '#F3F4F6']}
                    style={styles.filterButtonInner}
                  >
                    <AppText style={[styles.filterText, activeFilter === 'all' && styles.filterTextActive]}>
                      {t.all} ({jobs.pending.length + jobs.waiting.length + jobs.finished.length})
                    </AppText>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.filterButton, activeFilter === 'pending' && styles.filterButtonActive]}
                  onPress={() => setActiveFilter('pending')}
                >
                  <LinearGradient
                    colors={activeFilter === 'pending' ? gradients.yellowBox : ['#F3F4F6', '#F3F4F6']}
                    style={styles.filterButtonInner}
                  >
                    <AppText style={[styles.filterText, activeFilter === 'pending' && styles.filterTextActive]}>
                      {t.pending} ({jobs.pending.length})
                    </AppText>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.filterButton, activeFilter === 'waiting' && styles.filterButtonActive]}
                  onPress={() => setActiveFilter('waiting')}
                >
                  <LinearGradient
                    colors={activeFilter === 'waiting' ? gradients.purpleBox : ['#F3F4F6', '#F3F4F6']}
                    style={styles.filterButtonInner}
                  >
                    <AppText style={[styles.filterText, activeFilter === 'waiting' && styles.filterTextActive]}>
                      {t.waiting} ({jobs.waiting.length})
                    </AppText>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.filterButton, activeFilter === 'finished' && styles.filterButtonActive]}
                  onPress={() => setActiveFilter('finished')}
                >
                  <LinearGradient
                    colors={activeFilter === 'finished' ? gradients.greenBox : ['#F3F4F6', '#F3F4F6']}
                    style={styles.filterButtonInner}
                  >
                    <AppText style={[styles.filterText, activeFilter === 'finished' && styles.filterTextActive]}>
                      {t.finished} ({jobs.finished.length})
                    </AppText>
                  </LinearGradient>
                </TouchableOpacity>
              </ScrollView>
            </AppCard>
          </View>
        }
        ListEmptyComponent={
          <AppEmptyState title={t.noJobs} subtitle={t.subtitle} style={styles.emptyContainer} />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        {...scrollProps}
      />

      {/* Job Details Modal */}
      <ViewJobDetails
        visible={!!selectedJobDetails}
        job={selectedJobDetails as any}
        onClose={() => setSelectedJobDetails(null)}
        translations={{
          jobDetails: t.jobDetails,
          jobTitle: t.fieldTitle,
          description: t.description,
          location: t.location,
          dueDate: t.dueDate,
          assignedBy: t.assignedBy,
          createdAt: t.createdAt,
          finishedAt: t.finishedAt,
          status: t.status,
          photos: t.photos,
          noPhotos: t.noPhotos,
          signature: t.signature,
          noSignature: t.noSignature,
          close: t.close,
          timeWorked: t.timeWorked,
          clientInfo: t.clientName,
          clientName: t.clientName,
          clientPhone: t.clientPhone,
          partsUsed: t.partsUsed,
          signingPerson: t.signingPerson,
          timeStatus: t.timeWorked,
        } as Record<string, string>}
        getStatusColor={(status?: string) => {
          switch (status?.toLowerCase()) {
            case 'pending': return '#f59e0b';
            case 'waiting': return '#8b5cf6';
            case 'finished': return '#10b981';
            default: return '#6b7280';
          }
        }}
        onImagePress={() => {}}
        isDarkMode={false}
      />

      {/* Date Filter Modal */}
      <DateFilter
        visible={showDateFilter}
        onClose={() => setShowDateFilter(false)}
        onFilterChange={(filter) => {
          setDateFilter(filter);
          setShowDateFilter(false);
        }}
        currentFilter={dateFilter.type}
        isDarkMode={isDarkMode}
        language={language}
      />

      <GlobalHeader />
    </View>
  );
}
