// @ts-nocheck
import { styles } from './JobMonitor.styles';
import React, { useState, useEffect } from 'react';
import { View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  Image,
  Platform,
 } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { auth } from '../../../firebase';
import { colors, gradients, spacing, borderRadius, typography, shadows, getColors } from '../../../theme';
import { AppCard, AppEmptyState, AppText, SearchInput, LoadingSpinner, PrimaryButton, SecondaryButton, DangerButton, ViewJobDetails, GlobalHeader, DateFilter, ScrollableContainer, ScreenHeroCard } from '../../../components';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { ROUTES } from '../../../navigation/routes';

export default function JobMonitor() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { 
    getCompanyId, 
    companyJobs,
    getDataForDateRange,
    isWithinCacheRange 
  } = useCache();
  const cachedPendingJobs = React.useMemo(
    () => (companyJobs || []).filter(j => j.status === 'pending' || j.status === 'waiting'),
    [companyJobs]
  );
  const cachedFinishedJobs = React.useMemo(
    () => (companyJobs || []).filter(j => j.status === 'finished'),
    [companyJobs]
  );
  const themeColors = getColors(isDarkMode);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState({
    pending: [],
    waiting: [],
    finished: [],
  });
  const [selectedJobDetails, setSelectedJobDetails] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');
  // OLD EDIT MODAL STATE - NO LONGER NEEDED (using /EditJob screen now)
  // const [showEditJob, setShowEditJob] = useState(false);
  // const [editingJob, setEditingJob] = useState(null);
  const [highlightedJobId, setHighlightedJobId] = useState(null);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFilter, setDateFilter] = useState({
    type: 'last7days',
    startDate: new Date(new Date().setDate(new Date().getDate() - 7)),
    endDate: new Date(),
    label: 'Last 7 Days'
  });
  const [clientFilter, setClientFilter] = useState('');
  // const [workerInventory, setWorkerInventory] = useState([]);
  // const [showAddPartsModal, setShowAddPartsModal] = useState(false);
  // const [partsSearchQuery, setPartsSearchQuery] = useState('');

  const t = language === 'en' ? {
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
    clientName: 'Client Name',
    allClients: 'All Clients',
    edit: 'Edit Job',
    save: 'Save',
    cancel: 'Cancel',
    timeWorked: 'Time Worked',
    from: 'From',
    to: 'To',
    clientName: 'Client Name',
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
    filterByDate: 'Filter by Date',
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
    clientName: 'اسم العميل',
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
  };

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
        const pendingJobsList = [];
        const waitingJobsList = [];
        
        if (cachedPendingJobs && cachedPendingJobs.length > 0) {
          console.log('📦 [CACHE READ] JobMonitor - pending jobs from cache:', cachedPendingJobs.length);
          cachedPendingJobs.forEach((job) => {
            // Apply date filter
            const jobDate = job.createdAt ? new Date(job.createdAt) : new Date(0);
            if (jobDate >= dateFilter.startDate && jobDate <= dateFilter.endDate) {
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
        const sortByDate = (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        pendingJobsList.sort(sortByDate);
        waitingJobsList.sort(sortByDate);
        
        // Get finished jobs using smart date filtering from CacheContext
        // This automatically handles cache vs backend/archive based on date range.
        let finishedJobsData = [];
        
        if (isStartInCache) {
          // Date range is within cache, filter from cached data
          if (cachedFinishedJobs && cachedFinishedJobs.length > 0) {
            console.log('📦 [CACHE READ] JobMonitor - finished jobs from cache:', cachedFinishedJobs.length);
            finishedJobsData = cachedFinishedJobs.filter((job) => {
              const finishedDate = job.finishedAt ? new Date(job.finishedAt) : new Date(0);
              return finishedDate >= dateFilter.startDate && finishedDate <= dateFilter.endDate;
            });
          }
        } else {
          // Date range extends beyond cache - use smart filtering.
          // This uses local cache for recent data and backend/archive reads for older data.
          console.log('[BACKEND READ] JobMonitor - fetching older finished jobs');
          finishedJobsData = await getDataForDateRange(
            dateFilter.startDate, 
            dateFilter.endDate, 
            'finishedJobs'
          );
        }
        
        const finishedJobsList = finishedJobsData
          .map((job) => ({
            ...job,
            workerName: job.wname || 'Unknown',
          }))
          .sort((a, b) => new Date(b.finishedAt || 0) - new Date(a.finishedAt || 0));
        
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
      const filterByClient = (jobsList) => {
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
      // Set the highlighted job
      setHighlightedJobId(jobId);
      
      // Remove highlight after 2.5 seconds
      const timer = setTimeout(() => {
        setHighlightedJobId(null);
      }, 2500);
      
      return () => clearTimeout(timer);
    }
  }, [jobId, loading]);

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'pending': return '#f59e0b';
      case 'waiting': return '#8b5cf6';
      case 'finished': return '#10b981';
      default: return '#6b7280';
    }
  };

  const getStatusText = (status) => {
    switch (status?.toLowerCase()) {
      case 'pending': return t.pending;
      case 'waiting': return t.waiting;
      case 'finished': return t.finished;
      default: return status || 'unknown';
    }
  };

  const getFilteredJobs = () => {
    let allJobs = [];
    if (activeFilter === 'all') {
      allJobs = [
        ...jobs.pending,
        ...jobs.waiting,
        ...jobs.finished,
      ];
    } else {
      allJobs = jobs[activeFilter] || [];
    }
    
    // Date filtering is handled by the backend read-model/archive query (dateFilter state).
    // No need for additional client-side date filtering here
    
    // Sort by date - newest first
    // Use finishedAt for finished jobs, createdAt for others
    return allJobs.sort((a, b) => {
      const dateFieldA = a.status?.toLowerCase() === 'finished' ? a.finishedAt : a.createdAt;
      const dateFieldB = b.status?.toLowerCase() === 'finished' ? b.finishedAt : b.createdAt;
      const dateA = dateFieldA ? new Date(dateFieldA).getTime() : 0;
      const dateB = dateFieldB ? new Date(dateFieldB).getTime() : 0;
      return dateB - dateA; // Descending order (newest first)
    });
  };

  const filteredJobs = getFilteredJobs();

  const isJobNew = (job) => {
    if (!job.createdAt) return false;
    const jobDate = new Date(job.createdAt);
    const now = new Date();
    const hoursDiff = (now - jobDate) / (1000 * 60 * 60);
    return hoursDiff <= 24; // Job is "new" if created within last 24 hours
  };

  const handleEditJobClick = (job) => {
    // Check if job can be edited
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

    // Close details modal and navigate to edit page
    setSelectedJobDetails(null);
    router.push({
      pathname: ROUTES.editJob,
      params: {
        job: JSON.stringify(job),
        from: 'jobMonitor'
      }
    });
  };

  const handleEditJob = (job) => {
    router.push({
      pathname: ROUTES.editJob,
      params: {
        job: JSON.stringify(job)
      }
    });
  };

  const JobCard = ({ job }) => {
    const displayName = job.wname || 'Unknown Worker';
    
    // Check if this job is currently highlighted
    const isHighlighted = highlightedJobId === job.id;
    
    // Get status color for badge and dot
    const statusColor = getStatusColor(job.status);
    
    return (
      <TouchableOpacity onPress={() => setSelectedJobDetails(job)}>
        <AppCard 
          style={[
            styles.jobCard,
            { backgroundColor: themeColors.backgroundElevated, borderColor: themeColors.border },
            isHighlighted && styles.highlightedJobCard
          ]}
        >
          <View style={styles.jobHeader}>
            <View style={styles.jobLeft}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <View style={styles.jobHeaderContent}>
                <View style={styles.jobTitleRow}>
                  <AppText style={[styles.jobTitle, { color: themeColors.textPrimary }]}>{job.title || 'Untitled Job'}</AppText>
                  {isJobNew(job) && (
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
                    📅 {new Date(job.createdAt).toLocaleDateString()}
                  </AppText>
                )}
                {job.status?.toLowerCase() === 'finished' && job.finishedAt && (
                  <AppText style={[styles.jobFinishedDate, { color: themeColors.textSecondary }]}>
                    ✓ {t.finishedAt || 'Finished'}: {new Date(job.finishedAt).toLocaleDateString()} {new Date(job.finishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </AppText>
                )}
              </View>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <AppText style={styles.statusText}>{getStatusText(job.status)}</AppText>
            </View>
          </View>
          
          <TouchableOpacity 
            style={[styles.editButton, { 
              backgroundColor: isDarkMode ? themeColors.border : 'rgba(0, 172, 193, 0.08)',
              borderColor: isDarkMode ? themeColors.border : 'rgba(0, 172, 193, 0.2)'
            }]}
            onPress={(e) => {
              e.stopPropagation();
              handleEditJob(job);
            }}
          >
            <Ionicons name="create-outline" size={18} color={themeColors.secondary} />
            <AppText style={[styles.editButtonText, { color: themeColors.secondary }]}>{t.edit}</AppText>
          </TouchableOpacity>
        </AppCard>
      </TouchableOpacity>
    );
  };

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
      <ScrollableContainer 
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
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

        {filteredJobs.length === 0 ? (
          <AppEmptyState title={t.noJobs} subtitle={t.subtitle} style={styles.emptyContainer} />
        ) : (
          filteredJobs.map((job) => <JobCard key={`${job.wid}-${job.id}`} job={job} />)
        )}
      </ScrollableContainer>

      {/* Job Details Modal */}
      <ViewJobDetails
        visible={!!selectedJobDetails}
        job={selectedJobDetails}
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
        }}
        getStatusColor={getStatusColor}
        onImagePress={(photo) => {/* Can add image modal if needed */}}
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
