import React, { useState, useEffect } from 'react';
import { View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  Image,
  Platform,
  TextInput,
 } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { auth, db, doc, getDoc } from '../../firebase';
import { colors, gradients, spacing, borderRadius, typography, shadows, getColors } from '../../theme';
import { AppText, SearchInput, LoadingSpinner, PrimaryButton, SecondaryButton, DangerButton, ViewJobDetails, GlobalHeader, DateFilter, ScrollableContainer } from '../../components';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAlert } from '../../contexts/AlertContext';
import { useCache } from '../../contexts/CacheContext';

export default function JobMonitor() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams();
  const { language, toggleLanguage } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { 
    getCompanyId, 
    getUid, 
    companyPendingJobs: cachedPendingJobs, 
    companyFinishedJobs: cachedFinishedJobs,
    getDataForDateRange,
    getDataForMonth,
    isWithinCacheRange 
  } = useCache();
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
    received: 'Received',
    waiting: 'Waiting',
    finished: 'Finished',
    noJobs: 'No jobs in this category',
    jobDetails: 'Job Details',
    close: 'Close',
    worker: 'worker',
    assignedBy: 'Assigned By',
    createdAt: 'Created At',
    status: 'Status',
    title: 'Title',
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
  } : language === 'he' ? {
    title: 'ניטור משימות',
    subtitle: 'מעקב אחר כל משימות החברה',
    back: 'חזרה',
    all: 'הכל',
    pending: 'ממתין',
    received: 'התקבל',
    waiting: 'ממתין לאישור',
    finished: 'הושלם',
    noJobs: 'אין משימות בקטגוריה זו',
    jobDetails: 'פרטי משימה',
    close: 'סגור',
    worker: 'עובד',
    assignedBy: 'הוקצה על ידי',
    createdAt: 'נוצר ב',
    status: 'סטטוס',
    title: 'כותרת',
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
  } : {
    title: 'مراقبة المهام',
    subtitle: 'تتبع جميع مهام الشركة',
    back: 'رجوع',
    all: 'الكل',
    pending: 'قيد الانتظار',
    received: 'مستلم',
    waiting: 'في انتظار الموافقة',
    finished: 'منتهي',
    noJobs: 'لا توجد مهام في هذه الفئة',
    jobDetails: 'تفاصيل المهمة',
    close: 'إغلاق',
    worker: 'العامل',
    assignedBy: 'تم التعيين بواسطة',
    createdAt: 'تم الإنشاء في',
    status: 'الحالة',
    title: 'العنوان',
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
                workerName: job.name || job.workerName || 'Unknown',
              };
              
              const status = jobData.status?.toLowerCase();
              if (status === 'pending') {
                pendingJobsList.push(jobData);
              } else if (status === 'waiting' || status === 'received') {
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
        // This automatically handles cache vs Firebase based on date range
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
          // Date range extends beyond cache - use smart filtering
          // This will use cache for recent data + query Firebase for older data
          console.log('🔥 [FIREBASE READ] JobMonitor - fetching older finished jobs from Firebase');
          finishedJobsData = await getDataForDateRange(
            dateFilter.startDate, 
            dateFilter.endDate, 
            'finishedJobs'
          );
        }
        
        const finishedJobsList = finishedJobsData
          .map((job) => ({
            ...job,
            workerName: job.name || job.workerName || 'Unknown',
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
  }, [dateFilter, cachedPendingJobs, cachedFinishedJobs]); // Re-run when date filter or cache changes

  // Apply client name filter to jobs
  useEffect(() => {
    if (clientFilter.trim()) {
      const filterByClient = (jobsList) => {
        const query = clientFilter.toLowerCase();
        return jobsList.filter(job => 
          (job.signingPersonName && job.signingPersonName.toLowerCase().includes(query)) ||
          (job.clientName && job.clientName.toLowerCase().includes(query))
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
      case 'received': return '#8b5cf6';
      case 'waiting': return '#8b5cf6';
      case 'finished': return '#10b981';
      default: return '#6b7280';
    }
  };

  const getStatusText = (status) => {
    switch (status?.toLowerCase()) {
      case 'pending': return t.pending;
      case 'received': return t.waiting;
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
    
    // Date filtering is now handled by Firestore query (dateFilter state)
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
      pathname: '/EditJob',
      params: {
        jobData: JSON.stringify(job),
        from: 'jobMonitor'
      }
    });
  };

  const loadWorkerInventory = async (workerId) => {
    try {
      console.log('Loading inventory for worker:', workerId);
      const inventoryDocRef = doc(db, 'users', workerId, 'data', 'inventory');
      const inventoryDoc = await getDoc(inventoryDocRef);
      
      if (inventoryDoc.exists()) {
        const inventoryData = inventoryDoc.data();
        console.log('Inventory data:', inventoryData);
        
        let inventoryList = [];
        
        // Handle both array and object formats
        if (Array.isArray(inventoryData.parts)) {
          inventoryList = inventoryData.parts;
        } else if (inventoryData.parts && typeof inventoryData.parts === 'object') {
          // Convert object to array
          inventoryList = Object.entries(inventoryData.parts).map(([key, value]) => ({
            id: key,
            name: typeof value === 'object' ? value.name : key,
            quantity: typeof value === 'object' ? value.quantity : value,
            lowThreshold: typeof value === 'object' ? value.lowThreshold : 0
          }));
        }
        
        // Filter out parts with invalid quantities (NaN, null, undefined, or zero)
        const validInventory = inventoryList.filter(part => {
          const qty = parseInt(part.quantity);
          return !isNaN(qty) && qty > 0;
        });
        
        console.log('Processed inventory list:', validInventory);
        setWorkerInventory(validInventory);
      } else {
        console.log('No inventory document found for worker');
        setWorkerInventory([]);
      }
    } catch (error) {
      console.error('Error loading worker inventory:', error);
      alert.error('Error', 'Failed to load worker inventory: ' + error.message);
      setWorkerInventory([]);
    }
  };

  const handleEditJob = async (job) => {
    // Navigate to EditJob screen instead of showing modal
    router.push({
      pathname: '/EditJob',
      params: {
        job: JSON.stringify(job)
      }
    });
    return;
    
    // Load worker's inventory if we have the worker UID
    // Try multiple possible fields for worker UID
    const workerUid = job.workerId || job.completedBy || job.assignedTo || job.workerUid || job.uid;
    console.log('Worker UID identified:', workerUid);
    
    if (workerUid) {
      await loadWorkerInventory(workerUid);
    } else {
      console.warn('No worker UID found in job data:', job);
      alert.warning('Warning', 'Cannot load worker inventory: Worker information not found in job');
    }
  };

  const JobCard = ({ job }) => {
    // Use the name field from job data (never display raw UIDs)
    const displayName = job.workerName || job.name || 'Unknown Worker';
    
    // Check if this job is currently highlighted
    const isHighlighted = highlightedJobId === job.id;
    
    // Get status color for badge and dot
    const statusColor = getStatusColor(job.status);
    
    return (
      <TouchableOpacity onPress={() => setSelectedJobDetails(job)}>
        <View 
          style={[
            styles.jobCard,
            { backgroundColor: themeColors.surface },
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
        </View>
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
      
      {/* Header */}
      <View style={[styles.header, { backgroundColor: themeColors.surface, borderBottomColor: themeColors.border }]}>
        <View style={styles.headerCenter}>
          <AppText style={[styles.title, { color: themeColors.textPrimary }]}>{t.title}</AppText>
          <AppText style={[styles.subtitle, { color: themeColors.textSecondary }]}>{t.subtitle}</AppText>
        </View>
      </View>

      {/* Filter Controls */}
      <View style={styles.filtersRow}>
        {/* Date Filter Button */}
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

        {/* Client Filter Input */}
        <View style={[styles.clientFilterInput, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
          <Ionicons name="person-outline" size={18} color={themeColors.textSecondary} />
          <TextInput
            style={[styles.clientInput, { color: themeColors.textPrimary }]}
            placeholder={t.filterByClient}
            placeholderTextColor={themeColors.textSecondary}
            value={clientFilter}
            onChangeText={setClientFilter}
            returnKeyType="search"
          />
          {clientFilter.length > 0 && (
            <TouchableOpacity onPress={() => setClientFilter('')}>
              <Ionicons name="close-circle" size={18} color={themeColors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter Tabs - Colorful */}
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

      {/* Jobs List - White Background */}
      <ScrollableContainer 
        style={styles.content}
        contentContainerStyle={{ paddingTop: 0 }}
      >
        {filteredJobs.length === 0 ? (
          <View style={styles.emptyContainer}>
            <AppText style={styles.emptyText}>{t.noJobs}</AppText>
          </View>
        ) : (
          filteredJobs.map((job) => <JobCard key={`${job.workerId}-${job.id}`} job={job} />)
        )}
      </ScrollableContainer>

      {/* Job Details Modal */}
      <ViewJobDetails
        visible={!!selectedJobDetails}
        job={selectedJobDetails}
        onClose={() => setSelectedJobDetails(null)}
        translations={{
          jobDetails: t.jobDetails,
          jobTitle: t.title,
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: colors.textPrimary,
    marginTop: spacing.md,
    fontSize: typography.base,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 110 : 98,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 6,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  languageButton: {
    width: 80,
  },
  languageButtonInner: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  languageButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  dateFilterButtonWrapper: {
    flex: 1,
    borderRadius: 10,
    ...shadows.small,
  },
  dateFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  dateFilterButtonText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  dateFilterButtonTextSmall: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  filtersRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 10,
    alignItems: 'center',
  },
  clientFilterInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  clientInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },
  filterContainer: {
    maxHeight: 60,
    marginBottom: 0,
  },
  filterContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  filterButton: {
    marginRight: 8,
  },
  filterButtonInner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  filterButtonActive: {
  },
  filterText: {
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 14,
  },
  filterTextActive: {
    color: 'white',
  },
  dateFilterContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  dateFilterLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  datePickerRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  dateInputButton: {
    flex: 1,
  },
  datePickerButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  datePickerButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  clearDateButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  clearDateButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  jobCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    ...shadows.sm,
  },
  highlightedJobCard: {
    borderWidth: 3,
    borderColor: '#FFD700',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
    elevation: 8,
    transform: [{ scale: 1.02 }],
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  jobLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
    marginTop: 6,
  },
  jobHeaderContent: {
    flex: 1,
    marginRight: 12,
  },
  jobTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  jobTitle: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
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
  jobWorker: {
    fontSize: 14,
    marginBottom: 2,
  },
  jobDate: {
    fontSize: 12,
  },
  jobFinishedDate: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  statusBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    ...shadows.sm,
  },
  statusBadgeLarge: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 16,
    fontStyle: 'italic',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  detailsModalContent: {
    backgroundColor: '#FAFBFC',
    borderRadius: 24,
    padding: 24,
    maxHeight: '90%',
    width: '92%',
    maxWidth: 500,
    ...shadows.floating,
  },
  detailsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  detailItem: {
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 16,
    color: colors.primary,
  },
  signatureContainer: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
    minHeight: 100,
  },
  signatureImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
  },
  photosScroll: {
    marginTop: 8,
  },
  photoThumbnail: {
    width: 150,
    height: 150,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: '#f3f4f6',
  },
  signatureText: {
    fontSize: 14,
    color: '#4b5563',
    fontStyle: 'italic',
  },
  noDataText: {
    fontSize: 14,
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  closeModalButton: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
  },
  modalButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  jobCardContainer: {
    marginBottom: 10,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 8,
    marginTop: 12,
    borderWidth: 1,
    gap: 6,
  },
  disabledEditButton: {
    backgroundColor: '#9ca3af',
    borderColor: '#6b7280',
    opacity: 0.5,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  editModalContent: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: colors.background,
    borderRadius: 20,
    padding: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  editForm: {
    maxHeight: 400,
  },
  inputGroup: {
    marginBottom: 16,
  },
  addPartsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },
  addPartsButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
    color: colors.text,
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
  },
  textArea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  timeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timeField: {
    flex: 1,
  },
  timeLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  partsContainer: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    maxHeight: 150,
  },
  partItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
  },
  editablePartItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    gap: 8,
  },
  partInfoSection: {
    flex: 1,
  },
  quantityEditSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
  },
  quantityLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  quantityInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    fontWeight: '600',
    minWidth: 60,
    textAlign: 'center',
  },
  removePartButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    alignSelf: 'center',
  },
  removePartText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  partName: {
    fontSize: 14,
    fontWeight: '500',
  },
  partQuantity: {
    fontSize: 14,
    fontWeight: '600',
  },
  noPartsText: {
    fontSize: 14,
    fontStyle: 'italic',
    marginTop: 4,
  },
  statusButtonsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusButton: {
    flex: 1,
    minWidth: '45%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    backgroundColor: colors.card,
  },
  statusButtonActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  statusButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  statusButtonTextActive: {
    color: 'white',
  },
  editModalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  editActionButton: {
    flex: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  cancelButton: {
    backgroundColor: '#6B7280',
  },
  saveButton: {
    backgroundColor: '#10B981',
  },
  editActionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  partsModalContent: {
    width: '90%',
    maxHeight: '70%',
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 20,
    zIndex: 10000,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  partsModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  partsListScroll: {
    maxHeight: 400,
  },
  inventoryPartItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
  },
  inventoryPartInfo: {
    flex: 1,
  },
  inventoryPartName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  inventoryPartQty: {
    fontSize: 14,
  },
});






