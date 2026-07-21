import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Platform,
  FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { auth } from '../../../lib/auth/transport';
import { spacing, borderRadius, typography, shadows, getColors } from '../../../theme';
import { AppText, SearchInput, LoadingSpinner, GlobalHeader, ViewJobDetails } from '../../../components';
import { useScrollHandler } from '../../../contexts/HeaderContext';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useCache } from '../../../contexts/CacheContext';
import { fetchCompanyWorkers, fetchUserInventoryParts } from '../../../utils/read-model';
import { ROUTES } from '../../../navigation/routes';
import type { Job, Worker, InventoryPart } from '../../../types';

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

const EMPTY_JOBS: Job[] = [];

interface WorkerRowProps {
  worker: Worker;
  isSelected: boolean;
  recentJobs: Job[];
  t: Record<string, string>;
  themeColors: ReturnType<typeof getColors>;
  isDarkMode: boolean;
  getStatusColor: (status?: string) => string;
  getStatusText: (status?: string) => string;
  onSelect: (worker: Worker) => void;
  onJobPress: (job: Job) => void;
  onInventoryPress: (workerWid: string | number) => void;
}

const WorkerRow = memo(function WorkerRow({
  worker,
  isSelected,
  recentJobs,
  t,
  themeColors,
  isDarkMode,
  getStatusColor,
  getStatusText,
  onSelect,
  onJobPress,
  onInventoryPress,
}: WorkerRowProps) {
  return (
    <View>
      <TouchableOpacity
        style={[
          styles.workerCard,
          {
            backgroundColor: themeColors.surface,
            borderColor: isSelected ? themeColors.secondary : themeColors.border,
            borderWidth: isSelected ? 3 : 2,
          },
        ]}
        onPress={() => onSelect(worker)}
      >
        <View style={styles.workerCardContent}>
          <View style={[styles.workerIconContainer, { backgroundColor: themeColors.backgroundLight }]}>
            <MaterialCommunityIcons
              name="account-circle"
              size={48}
              color={isSelected ? themeColors.secondary : themeColors.textSecondary}
            />
          </View>
          <View style={styles.workerInfo}>
            <AppText style={[styles.workerName, { color: themeColors.textPrimary }]}>
              {worker.name || worker.uid}
            </AppText>
            <AppText style={[styles.workerEmail, { color: themeColors.textSecondary }]}>
              {worker.email}
            </AppText>
          </View>
          {isSelected ? (
            <Ionicons name="checkmark-circle" size={32} color={themeColors.secondary} />
          ) : (
            <Ionicons name="chevron-forward" size={24} color={themeColors.textLight} />
          )}
        </View>
      </TouchableOpacity>

      {/* Elegant Expandable Preview */}
      {isSelected && (
        <View style={[styles.expandedContent, { backgroundColor: themeColors.surface }]}>
          <LinearGradient
            colors={isDarkMode
              ? ['rgba(0, 172, 193, 0.3)', 'rgba(15, 42, 77, 0.5)']
              : ['rgba(0, 172, 193, 0.15)', 'rgba(15, 42, 77, 0.25)']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.expandedGradient}
          >
            {/* Quick Stats */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <View style={[styles.statIconContainer, { backgroundColor: themeColors.secondary }]}>
                  <MaterialCommunityIcons name="briefcase-outline" size={24} color="white" />
                </View>
                <AppText style={[styles.statNumber, { color: themeColors.textPrimary }]}>{recentJobs.length}</AppText>
                <AppText style={[styles.statLabel, { color: themeColors.textSecondary }]}>{t.jobs}</AppText>
              </View>

              <View style={[styles.statDivider, { backgroundColor: themeColors.border }]} />

              <TouchableOpacity
                style={styles.statCard}
                onPress={() => onInventoryPress(worker.wid)}
              >
                <View style={[styles.statIconContainer, { backgroundColor: themeColors.secondary }]}>
                  <MaterialCommunityIcons name="package-variant" size={24} color="white" />
                </View>
                <AppText style={[styles.statLabel, { color: themeColors.textSecondary }]}>{t.parts}</AppText>
                <Ionicons name="arrow-forward-circle" size={18} color={themeColors.secondary} style={{ marginTop: 4 }} />
              </TouchableOpacity>
            </View>
          </LinearGradient>

          {/* Recent Jobs List */}
          {recentJobs.length > 0 && (
            <View style={styles.recentJobsContainer}>
              <AppText style={[styles.recentJobsTitle, { color: themeColors.textPrimary }]}>
                {t.recentJobs}
              </AppText>
              {recentJobs.slice(0, 3).map((job) => (
                <TouchableOpacity
                  key={job.id}
                  style={[styles.compactJobCard, { backgroundColor: themeColors.background }]}
                  onPress={() => onJobPress(job)}
                >
                  <View style={styles.compactJobLeft}>
                    <View style={[styles.compactJobStatusDot, { backgroundColor: getStatusColor(job.status) }]} />
                    <View style={styles.compactJobInfo}>
                      <AppText style={[styles.compactJobTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>
                        {job.title}
                      </AppText>
                      <View style={styles.compactJobBottom}>
                        {job.createdAt && (
                          <AppText style={[styles.compactJobDate, { color: themeColors.textSecondary }]}>
                            {new Date(getTimeMs(job.createdAt)).toLocaleDateString()}
                          </AppText>
                        )}
                        <View style={[styles.compactStatusBadge, { backgroundColor: getStatusColor(job.status) }]}>
                          <AppText style={styles.compactStatusText}>{getStatusText(job.status)}</AppText>
                        </View>
                      </View>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={themeColors.textSecondary} />
                </TouchableOpacity>
              ))}
              {recentJobs.length > 3 && (
                <AppText style={[styles.moreJobsText, { color: themeColors.secondary }]}>
                  +{recentJobs.length - 3} {t.moreJobs}
                </AppText>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
});

export default function WorkersMonitor() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const { scrollProps } = useScrollHandler();
  const {
    getCompanyId,
    workers: cachedWorkersList,
    companyJobs,
    updateWorkers,
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
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<string | number | null>(null);
  const [selectedWorkerName, setSelectedWorkerName] = useState('');
  const [workerJobs, setWorkerJobs] = useState<Job[]>([]);
  const [workerInventory, setWorkerInventory] = useState<InventoryPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedJobDetails, setSelectedJobDetails] = useState<Job | null>(null);

  const t = (language === 'en' ? {
    title: 'Workers Monitor',
    subtitle: 'Monitor worker inventory and jobs',
    back: 'Back',
    selectWorker: 'Select a Worker',
    searchWorker: 'Search workers...',
    viewEditInventory: 'View and Edit Inventory',
    jobs: 'Jobs',
    inventory: 'Inventory',
    parts: 'Parts',
    recentJobs: 'Recent Jobs',
    moreJobs: 'more jobs',
    pending: 'Pending',
    waiting: 'Waiting for Approval',
    denied: 'Denied',
    finished: 'Finished',
    approve: 'Approve',
    deny: 'Deny',
    edit: 'Edit Job',
    saveChanges: 'Save Changes',
    editJob: 'Edit Job Details',
    noJobs: 'No jobs yet',
    noInventory: 'No inventory items',
    jobTitle: 'Job Title',
    description: 'Description',
    location: 'Location',
    clientName: 'Client Name',
    clientPhone: 'Client Phone Number',
    assignedBy: 'Assigned By',
    createdAt: 'Created At',
    status: 'Status',
    submit: 'Submit',
    cancel: 'Cancel',
    fillAllFields: 'Please fill all fields',
    jobCreated: 'Job created successfully',
    viewDetails: 'View Details',
    jobDetails: 'Job Details',
    close: 'Close',
    signature: 'Signature',
    noSignature: 'No signature available',
    createdDate: 'Created',
    photos: 'Photos',
    noPhotos: 'No photos available',
    quantity: 'Qty',
    editInventory: 'Edit Inventory',
    partName: 'Part Name',
    updateInventory: 'Update Inventory',
    clientInfo: 'Client Information',
    timeStatus: 'Timeline & Status',
    timeWorked: 'Time Worked',
    partsUsed: 'Parts Used',
    signingPerson: 'Signing Person',
    travelDistance: 'Travel Distance',
    km: 'km',
  } : language === 'he' ? {
    title: 'ניטור עובדים',
    subtitle: 'ניטור מלאי ומשימות עובדים',
    back: 'חזרה',
    selectWorker: 'בחר עובד',
    searchWorker: 'חפש עובדים...',
    viewEditInventory: 'צפייה ועריכת מלאי',
    jobs: 'משימות',
    inventory: 'מלאי',
    parts: 'חלקים',
    recentJobs: 'משימות אחרונות',
    moreJobs: 'משימות נוספות',
    pending: 'ממתין',
    waiting: 'ממתין לאישור',
    accepted: 'אושר',
    denied: 'נדחה',
    finished: 'הושלם',
    approve: 'אשר',
    deny: 'דחה',
    edit: 'ערוך משימה',
    saveChanges: 'שמור שינויים',
    editJob: 'ערוך פרטי משימה',
    noJobs: 'אין משימות עדיין',
    noInventory: 'אין פריטי מלאי',
    jobTitle: 'כותרת משימה',
    description: 'תיאור',
    location: 'מיקום',
    clientName: 'שם הלקוח',
    clientPhone: 'טלפון הלקוח',
    assignedBy: 'הוקצה על ידי',
    createdAt: 'נוצר ב',
    status: 'סטטוס',
    submit: 'שלח',
    cancel: 'ביטול',
    fillAllFields: 'אנא מלא את כל השדות',
    jobCreated: 'המשימה נוצרה בהצלחה',
    viewDetails: 'צפה בפרטים',
    jobDetails: 'פרטי משימה',
    close: 'סגור',
    signature: 'חתימה',
    noSignature: 'אין חתימה זמינה',
    createdDate: 'נוצר',
    photos: 'תמונות',
    noPhotos: 'אין תמונות זמינות',
    quantity: 'כמות',
    editInventory: 'עריכת מלאי',
    partName: 'שם החלק',
    updateInventory: 'עדכן מלאי',
    clientInfo: 'מידע לקוח',
    timeStatus: 'ציר זמן וסטטוס',
    timeWorked: 'זמן עבודה',
    partsUsed: 'חלקים ששומשו',
    signingPerson: 'חותם',
    travelDistance: 'מרחק נסיעה',
    km: 'ק"מ',
  } : {
    title: 'مراقبة العمال',
    subtitle: 'مراقبة مخزون ومهام العمال',
    back: 'رجوع',
    selectWorker: 'اختر عاملاً',
    searchWorker: 'بحث عن عمال...',
    viewEditInventory: 'عرض وتحرير المخزون',
    jobs: 'المهام',
    inventory: 'المخزون',
    parts: 'القطع',
    recentJobs: 'المهام الأخيرة',
    moreJobs: 'مهام إضافية',
    pending: 'قيد الانتظار',
    waiting: 'في انتظار الموافقة',
    accepted: 'مقبول',
    denied: 'مرفوض',
    finished: 'منتهي',
    approve: 'موافقة',
    deny: 'رفض',
    edit: 'تعديل المهمة',
    saveChanges: 'حفظ التغييرات',
    editJob: 'تعديل تفاصيل المهمة',
    noJobs: 'لا توجد مهام بعد',
    noInventory: 'لا توجد عناصر في المخزون',
    jobTitle: 'عنوان المهمة',
    description: 'الوصف',
    location: 'الموقع',
    clientName: 'اسم العميل',
    clientPhone: 'رقم هاتف العميل',
    assignedBy: 'تم التعيين بواسطة',
    createdAt: 'تم الإنشاء في',
    status: 'الحالة',
    submit: 'إرسال',
    cancel: 'إلغاء',
    fillAllFields: 'يرجى ملء جميع الحقول',
    jobCreated: 'تم إنشاء المهمة بنجاح',
    viewDetails: 'عرض التفاصيل',
    jobDetails: 'تفاصيل المهمة',
    close: 'إغلاق',
    signature: 'التوقيع',
    noSignature: 'لا يوجد توقيع متاح',
    createdDate: 'تم الإنشاء',
    photos: 'الصور',
    noPhotos: 'لا توجد صور متاحة',
    quantity: 'الكمية',
    editInventory: 'تحرير المخزون',
    partName: 'اسم القطعة',
    updateInventory: 'تحديث المخزون',
    clientInfo: 'معلومات العميل',
    timeStatus: 'الجدول الزمني والحالة',
    timeWorked: 'وقت العمل',
    partsUsed: 'القطع المستخدمة',
    signingPerson: 'الموقّع',
    travelDistance: 'مسافة السفر',
    km: 'كم',
  }) as Record<string, string>;

  useEffect(() => {
    const user = auth.currentUser;
    if (user) {
      loadWorkers();
    }
  }, []);

  // Watch for cached workers list changes and re-sync
  useEffect(() => {
    if (cachedWorkersList && Object.keys(cachedWorkersList).length > 0) {
      console.log('📦 WorkersMonitor: cached workers list updated - re-syncing');
      loadWorkers();
    }
  }, [cachedWorkersList]);

  // Effect 1: Setup inventory listener ONLY when selectedWorker changes
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    const user = auth.currentUser;

    if (selectedWorker && user) {
      const setupListener = async () => {
        const workerObj = workers.find(w => w.wid === selectedWorker);
        if (workerObj?.wid) {
          unsubscribe = await loadWorkerData(workerObj.wid);
        }
      };
      setupListener();
    }

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [selectedWorker]);

  // Effect 2: Update worker jobs from cache (no backend reads)
  useEffect(() => {
    if (!selectedWorker) return;

    const pendingJobs = (cachedPendingJobs || []).filter(
      job => job.wid === selectedWorker
    );
    const finishedJobs = (cachedFinishedJobs || []).filter(
      job => job.wid === selectedWorker
    );

    const allJobs = [...pendingJobs, ...finishedJobs];
    allJobs.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt));

    setWorkerJobs(allJobs);
  }, [selectedWorker, companyJobs]);

  useEffect(() => {
    if (searchQuery) {
      setSelectedWorker(null);
      setSelectedWorkerName('');
      setWorkerJobs([]);
    }
  }, [searchQuery]);

  const loadWorkers = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }

      const companyId = getCompanyId();

      if (!companyId) {
        console.error('CompanyId not found in cache');
        setLoading(false);
        return;
      }

      if (cachedWorkersList && Object.keys(cachedWorkersList).length > 0) {
        console.log('📦 [CACHE READ] WorkersMonitor - workers list from cache:', Object.keys(cachedWorkersList).length, 'workers');
        const workersList = Object.keys(cachedWorkersList).map((wid) => {
          const workerData = cachedWorkersList[wid] || {};
          return {
            wid,
            email: workerData.email || '',
            uid: workerData.uid || wid,
            name: workerData.name || '',
          };
        });
        setWorkers(workersList);
        setLoading(false);
        return;
      }

      console.log('[BACKEND READ] WorkersMonitor - fetching workers from backend (no cache)');
      const fetchedWorkers = await fetchCompanyWorkers(companyId);

      if (fetchedWorkers.length > 0) {
        const workersData: Record<string, Worker> = {};
        fetchedWorkers.forEach((workerData) => {
          const wid = String(workerData.wid || workerData.uid);
          if (!wid) return;
          workersData[wid] = {
            ...workerData,
            wid,
          } as Worker;
        });

        await updateWorkers(workersData);

        const workersList = Object.keys(workersData).map((wid) => {
          const workerData = workersData[wid] || {};
          return {
            wid,
            email: workerData.email || '',
            uid: workerData.uid || wid,
            name: workerData.name || '',
          };
        });
        setWorkers(workersList);
      }
    } catch (error) {
      console.error('Error loading workers:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadWorkerData = async (workerMemberNo: string | number) => {
    try {
      const user = auth.currentUser;
      if (!user) {
        return () => {};
      }

      const companyId = getCompanyId();
      if (!companyId) {
        setWorkerInventory([]);
        return () => {};
      }

      const inventoryList = await fetchUserInventoryParts(companyId, workerMemberNo);
      setWorkerInventory(inventoryList);
      return () => {};
    } catch (error) {
      console.error('Error setting up worker data listeners:', error);
      return () => {};
    }
  };

  const getStatusColor = useCallback((status?: string) => {
    switch (status) {
      case 'pending': return '#D97706';
      case 'waiting': return '#7C3AED';
      case 'denied': return '#DC2626';
      case 'finished': return '#059669';
      default: return '#6b7280';
    }
  }, []);

  const getStatusText = useCallback((status?: string) => {
    switch (status?.toLowerCase()) {
      case 'pending': return t.pending;
      case 'waiting': return t.waiting;
      case 'denied': return t.denied;
      case 'finished': return t.finished;
      default: return status || 'unknown';
    }
  }, [t]);

  const filteredWorkers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return workers;
    return workers.filter((worker) =>
      (worker.name && worker.name.toLowerCase().includes(query)) ||
      (worker.email && worker.email.toLowerCase().includes(query))
    );
  }, [workers, searchQuery]);

  const handleSelectWorker = useCallback((worker: Worker) => {
    setSelectedWorker((current) => {
      if (current === worker.wid) {
        setSelectedWorkerName('');
        setWorkerJobs([]);
        setWorkerInventory([]);
        return null;
      }
      setSelectedWorkerName(worker.name || String(worker.wid));
      return worker.wid;
    });
  }, []);

  const handleJobPress = useCallback((job: Job) => {
    setSelectedJobDetails(job);
  }, []);

  const handleInventoryPress = useCallback((workerWid: string | number) => {
    router.push({
      pathname: ROUTES.inventory,
      params: { wid: workerWid },
    });
  }, [router]);

  const renderItem = useCallback(({ item }: { item: Worker }) => {
    const isSelected = selectedWorker === item.wid;
    return (
      <WorkerRow
        worker={item}
        isSelected={isSelected}
        recentJobs={isSelected ? workerJobs : EMPTY_JOBS}
        t={t}
        themeColors={themeColors}
        isDarkMode={isDarkMode}
        getStatusColor={getStatusColor}
        getStatusText={getStatusText}
        onSelect={handleSelectWorker}
        onJobPress={handleJobPress}
        onInventoryPress={handleInventoryPress}
      />
    );
  }, [selectedWorker, workerJobs, t, themeColors, isDarkMode, getStatusColor, getStatusText, handleSelectWorker, handleJobPress, handleInventoryPress]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <LoadingSpinner size={60} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      <FlatList
        style={[styles.content, { backgroundColor: themeColors.background }]}
        contentContainerStyle={{ paddingTop: 100 }}
        data={filteredWorkers}
        keyExtractor={(item) => String(item.wid)}
        renderItem={renderItem}
        ListHeaderComponent={
          <View style={styles.section}>
            <View style={styles.sectionHeaderWithIcon}>
              <MaterialCommunityIcons name="account-group" size={28} color={themeColors.primary} />
              <AppText style={[styles.sectionTitle, { color: themeColors.textPrimary, marginLeft: 12 }]}>{t.selectWorker}</AppText>
            </View>

            <SearchInput
              placeholder={t.searchWorker}
              value={searchQuery}
              onChangeText={setSearchQuery}
              colors={themeColors}
            />
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyText}>
            <AppText style={{ color: themeColors.textSecondary, fontStyle: 'italic' }}>
              {searchQuery ? 'No workers match your search' : t.noJobs}
            </AppText>
          </View>
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
        translations={t as Record<string, string>}
        getStatusColor={getStatusColor}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeaderWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  selectedWorkerChip: {
    marginBottom: 12,
  },
  chipContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 24,
  },
  chipLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  searchInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: 'white',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  workersListContainer: {
    borderRadius: 16,
    gap: 12,
  },
  workerCard: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
    ...shadows.md,
  },
  workerCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  workerIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  workerInfo: {
    flex: 1,
  },
  workerName: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    marginBottom: 4,
  },
  workerEmail: {
    fontSize: typography.sm,
    marginBottom: 2,
  },
  expandedContent: {
    marginTop: 0,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    overflow: 'hidden',
    ...shadows.md,
  },
  expandedGradient: {
    padding: 20,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  statIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    ...shadows.sm,
  },
  statNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  statDivider: {
    width: 1,
    height: 60,
    marginHorizontal: 12,
  },
  recentJobsContainer: {
    padding: 16,
  },
  recentJobsTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  compactJobCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    ...shadows.sm,
  },
  compactJobLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  compactJobStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  compactJobInfo: {
    flex: 1,
  },
  compactJobTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  compactJobBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactJobDate: {
    fontSize: 12,
  },
  compactStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    ...shadows.sm,
  },
  compactStatusText: {
    fontSize: 10,
    fontWeight: '700',
    color: 'white',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  moreJobsText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
  emptyText: {
    alignItems: 'center',
    paddingVertical: 20,
  },
});
