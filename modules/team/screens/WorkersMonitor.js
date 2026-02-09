import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { auth, db, collection, doc, getDocs, onSnapshot } from '../../../firebase';
import { colors, spacing, borderRadius, typography, shadows, getColors } from '../../../theme';
import { SearchInput, LoadingSpinner, GlobalHeader, ViewJobDetails, ScrollableContainer } from '../../../components';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useCache } from '../../../contexts/CacheContext';

export default function WorkersMonitor() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const {
    getCompanyId,
    workers: cachedWorkersList,
    companyPendingJobs: cachedPendingJobs,
    companyFinishedJobs: cachedFinishedJobs,
    updateWorkersList
  } = useCache();
  const themeColors = getColors(isDarkMode);
  const [workers, setWorkers] = useState([]);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [selectedWorkerName, setSelectedWorkerName] = useState('');
  const [workerJobs, setWorkerJobs] = useState([]);
  const [workerInventory, setWorkerInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedJobDetails, setSelectedJobDetails] = useState(null);

  const t = language === 'en' ? {
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
    received: 'Received',
    waiting: 'Waiting for Approval',
    accepted: 'Accepted',
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
    received: 'התקבל',
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
    received: 'مستلم',
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
  };



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
    let unsubscribe;
    const user = auth.currentUser;
    
    if (selectedWorker && user) {
      const setupListener = async () => {
        // loadWorkerData sets up the inventory listener and returns cleanup function
        unsubscribe = await loadWorkerData(selectedWorker);
      };
      setupListener();
    }
    
    // Cleanup function
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [selectedWorker]); // Only depend on selectedWorker - prevents listener recreation on cache updates

  // Effect 2: Update worker jobs from cache (no Firebase reads)
  useEffect(() => {
    if (!selectedWorker) return;
    
    // Filter jobs from cache by selected worker (no Firebase reads)
    const pendingJobs = (cachedPendingJobs || []).filter(
      job => job.workerId === selectedWorker || job.completedBy === selectedWorker || job.assignedTo === selectedWorker
    );
    const finishedJobs = (cachedFinishedJobs || []).filter(
      job => job.workerId === selectedWorker || job.completedBy === selectedWorker || job.assignedTo === selectedWorker
    );
    
    // Combine and sort
    const allJobs = [...pendingJobs, ...finishedJobs];
    allJobs.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA; // Descending order (newest first)
    });
    
    setWorkerJobs(allJobs);
  }, [selectedWorker, cachedPendingJobs, cachedFinishedJobs]);

  useEffect(() => {
    // Deselect worker when search query changes
    if (searchQuery) {
      setSelectedWorker(null);
      setSelectedWorkerName('');
    }
  }, [searchQuery]);

  const loadWorkers = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }

      // Get manager's companyId from cache
      const companyId = getCompanyId();
      
      if (!companyId) {
        console.error('CompanyId not found in cache');
        setLoading(false);
        return;
      }

      // Use cached workers list if available
      if (cachedWorkersList && Object.keys(cachedWorkersList).length > 0) {
        console.log('📦 [CACHE READ] WorkersMonitor - workers list from cache:', Object.keys(cachedWorkersList).length, 'workers');
        const workersList = Object.keys(cachedWorkersList).map((key) => {
          const workerData = cachedWorkersList[key] || {};
          return {
            email: workerData.email || '',
            uid: workerData.uid || key,
            name: workerData.name || '',
          };
        });
        setWorkers(workersList);
        setLoading(false);
        return;
      }
      
      // Fallback to Firebase
      console.log('🔥 [FIREBASE READ] WorkersMonitor - fetching workers from Firebase (no cache)');
      const workersRef = collection(db, 'companies', companyId, 'workers');
      const workersSnapshot = await getDocs(workersRef);

      if (!workersSnapshot.empty) {
        const workersData = {};
        workersSnapshot.forEach(docSnap => {
          const workerData = docSnap.data() || {};
          const uid = workerData.uid || docSnap.id;
          workersData[uid] = {
            ...workerData,
            uid,
          };
        });
        
        // Save to cache for next time
        await updateWorkersList(workersData);
        
        // Keys are UIDs
        const workersList = Object.keys(workersData).map((uid) => {
          const workerData = workersData[uid] || {};
          return {
            email: workerData.email || '',
            uid: workerData.uid || uid,
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

  const loadWorkerData = async (workerUid) => {
    try {
      const user = auth.currentUser;
      if (!user) {
        console.log('No authenticated user, skipping worker data load');
        return () => {}; // Return empty cleanup function
      }
      
      // NOTE: Worker jobs are now handled by separate cache-based effect (no Firebase reads)
      // This function only sets up the inventory listener

      // Real-time listener for worker inventory (not cached at company level)
      const inventoryDocRef = doc(db, workerUid, 'inventory');
      const unsubscribeInventory = onSnapshot(inventoryDocRef, (docSnap) => {
        if (docSnap.exists()) {
          const inventoryData = docSnap.data();
          const inventoryList = inventoryData.parts || [];
          setWorkerInventory(inventoryList);
        } else {
          setWorkerInventory([]);
        }
      }, (error) => {
        if (auth.currentUser && error.code !== 'permission-denied') {
          console.error('Error loading worker inventory:', error);
        }
      });

      // Return cleanup function for inventory listener
      return () => {
        unsubscribeInventory();
      };
    } catch (error) {
      console.error('Error setting up worker data listeners:', error);
      return () => {}; // Return empty cleanup
    }
  };

  const isJobNew = (job) => {
    if (!job.createdAt) return false;
    const jobDate = new Date(job.createdAt);
    const now = new Date();
    const hoursDiff = (now - jobDate) / (1000 * 60 * 60);
    return hoursDiff <= 24; // Job is "new" if created within last 24 hours
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return '#D97706';    // Amber (matches yellowBox)
      case 'received': return '#2563EB';   // Blue (matches blueBox)
      case 'waiting': return '#7C3AED';    // Violet (matches purpleBox)
      case 'accepted': return '#059669';   // Emerald (matches greenBox)
      case 'denied': return '#DC2626';     // Red (matches redBox)
      case 'finished': return '#059669';   // Emerald (matches greenBox)
      default: return '#6b7280';           // Gray
    }
  };

  const getStatusText = (status) => {
    switch (status?.toLowerCase()) {
      case 'pending': return t.pending;
      case 'received': return t.received || 'Received';
      case 'waiting': return t.waiting;
      case 'accepted': return t.accepted;
      case 'denied': return t.denied;
      case 'finished': return t.finished;
      default: return status || 'unknown';
    }
  };

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

      {/* Content */}
      <ScrollableContainer 
        style={[styles.content, { backgroundColor: themeColors.background }]}
        contentContainerStyle={{ paddingTop: 100 }}
      >
          {/* Workers Selection Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderWithIcon}>
              <MaterialCommunityIcons name="account-group" size={28} color={themeColors.primary} />
              <Text style={[styles.sectionTitle, { color: themeColors.textPrimary, marginLeft: 12 }]}>{t.selectWorker}</Text>
            </View>
            
            {/* Always Visible Search Bar */}
            <SearchInput
              placeholder={t.searchWorker}
              value={searchQuery}
              onChangeText={setSearchQuery}
              colors={themeColors}
            />

            {/* Workers List - Always Visible */}
            <View style={[styles.workersListContainer, { backgroundColor: themeColors.surface }]}>
              {workers
                .filter((worker) => {
                  // Apply search filter to all workers
                  const searchLower = searchQuery.toLowerCase();
                  return (
                    (worker.name && worker.name.toLowerCase().includes(searchLower)) ||
                    (worker.email && worker.email.toLowerCase().includes(searchLower))
                  );
                })
                .map((worker) => {
                  const isSelected = selectedWorker === worker.uid;
                  return (
                    <View key={worker.uid}>
                      <TouchableOpacity
                        style={[
                          styles.workerCard,
                          { 
                            backgroundColor: themeColors.surface,
                            borderColor: isSelected ? themeColors.secondary : themeColors.border,
                            borderWidth: isSelected ? 3 : 2,
                          },
                        ]}
                        onPress={() => {
                          if (isSelected) {
                            // Deselect if clicking the same worker
                            setSelectedWorker(null);
                            setSelectedWorkerName('');
                            setWorkerJobs([]);
                            setWorkerInventory([]);
                          } else {
                            // Select different worker
                            setSelectedWorker(worker.uid);
                            setSelectedWorkerName(worker.name || worker.uid);
                          }
                        }}
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
                            <Text style={[styles.workerName, { color: themeColors.textPrimary }]}>
                              {worker.name || worker.uid}
                            </Text>
                            <Text style={[styles.workerEmail, { color: themeColors.textSecondary }]}>
                              {worker.email}
                            </Text>
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
                                <Text style={[styles.statNumber, { color: themeColors.textPrimary }]}>{workerJobs.length}</Text>
                                <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>{t.jobs}</Text>
                              </View>
                              
                              <View style={[styles.statDivider, { backgroundColor: themeColors.border }]} />
                              
                              <TouchableOpacity 
                                style={styles.statCard}
                                onPress={() => router.push({
                                  pathname: '/inventory',
                                  params: { workerId: selectedWorker }
                                })}
                              >
                                <View style={[styles.statIconContainer, { backgroundColor: themeColors.secondary }]}>
                                  <MaterialCommunityIcons name="package-variant" size={24} color="white" />
                                </View>
                                <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>{t.parts}</Text>
                                <Ionicons name="arrow-forward-circle" size={18} color={themeColors.secondary} style={{ marginTop: 4 }} />
                              </TouchableOpacity>
                            </View>
                          </LinearGradient>

                          {/* Recent Jobs List */}
                          {workerJobs.length > 0 && (
                            <View style={styles.recentJobsContainer}>
                              <Text style={[styles.recentJobsTitle, { color: themeColors.textPrimary }]}>
                                {t.recentJobs}
                              </Text>
                              {workerJobs.slice(0, 3).map((job) => (
                                <TouchableOpacity
                                  key={job.id}
                                  style={[styles.compactJobCard, { backgroundColor: themeColors.background }]}
                                  onPress={() => setSelectedJobDetails(job)}
                                >
                                  <View style={styles.compactJobLeft}>
                                    <View style={[styles.compactJobStatusDot, { backgroundColor: getStatusColor(job.status) }]} />
                                    <View style={styles.compactJobInfo}>
                                      <Text style={[styles.compactJobTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>
                                        {job.title}
                                      </Text>
                                      <View style={styles.compactJobBottom}>
                                        {job.createdAt && (
                                          <Text style={[styles.compactJobDate, { color: themeColors.textSecondary }]}>
                                            {new Date(job.createdAt).toLocaleDateString()}
                                          </Text>
                                        )}
                                        <View style={[styles.compactStatusBadge, { backgroundColor: getStatusColor(job.status) }]}>
                                          <Text style={styles.compactStatusText}>{getStatusText(job.status)}</Text>
                                        </View>
                                      </View>
                                    </View>
                                  </View>
                                  <Ionicons name="chevron-forward" size={20} color={themeColors.textSecondary} />
                                </TouchableOpacity>
                              ))}
                              {workerJobs.length > 3 && (
                                <Text style={[styles.moreJobsText, { color: themeColors.secondary }]}>
                                  +{workerJobs.length - 3} {t.moreJobs}
                                </Text>
                              )}
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
            </View>
          </View>
        </ScrollableContainer>

      {/* Job Details Modal */}
      <ViewJobDetails
        visible={!!selectedJobDetails}
        job={selectedJobDetails}
        onClose={() => setSelectedJobDetails(null)}
        translations={t}
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
  // New Elegant Expanded Content Styles
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
  // Old styles to keep for compatibility
  workerContentContainer: {
    backgroundColor: 'rgba(0, 172, 193, 0.03)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#00ACC1',
  },
  workerSection: {
    marginBottom: 16,
  },
  workerSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 172, 193, 0.2)',
  },
  workerSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
  },
  emptyText: {
    fontSize: 14,
    fontStyle: 'italic',
    paddingVertical: 12,
  },
  createButton: {
    backgroundColor: '#10b981',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  createButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  jobCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    ...shadows.sm,
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  jobHeaderContent: {
    flex: 1,
    marginRight: 12,
  },
  jobTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
  },
  jobTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
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
  jobCreatedDate: {
    fontSize: 12,
    color: '#6b7280',
  },
  viewDetailsButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  viewDetailsText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  editJobButton: {
    backgroundColor: '#8b5cf6',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  editJobButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  statusBadge: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  jobActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  approveButton: {
    backgroundColor: '#10b981',
  },
  denyButton: {
    backgroundColor: '#ef4444',
  },
  actionButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  inventoryContainer: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#d1d5db',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  inventoryCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inventoryName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.primary,
  },
  inventoryQuantity: {
    fontSize: 14,
    color: '#6b7280',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 400,
  },
  detailsModalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    maxHeight: '90%',
    width: '90%',
    maxWidth: 500,
  },
  detailsModalScrollContent: {
    paddingBottom: Platform.OS === 'android' ? 40 : 20,
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
    height: 130,
  },
  photoThumbnail: {
    width: 120,
    height: 120,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: '#e5e7eb',
    borderWidth: 2,
    borderColor: '#9ca3af',
  },
  signatureText: {
    fontSize: 14,
    color: '#4b5563',
    fontStyle: 'italic',
  },
  noSignatureText: {
    fontSize: 14,
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  closeModalButton: {
    backgroundColor: colors.secondary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    borderWidth: 2,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    color: '#1f2937',
    backgroundColor: '#ffffff',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  modalButton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#6b7280',
  },
  submitButton: {
    backgroundColor: colors.secondary,
  },
  modalButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  viewInventoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    ...shadows.md,
  },
  viewInventoryButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  imageModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
  },
  imageModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  enlargedImage: {
    width: '100%',
    height: '80%',
  },
});
