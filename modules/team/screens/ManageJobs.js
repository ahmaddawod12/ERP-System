import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Image,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { auth, db, FieldValue, doc, setDoc, getDoc, updateDoc, deleteDoc } from '../../../firebase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getColors, gradients, spacing, borderRadius, typography, shadows } from '../../../theme';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { GlobalHeader, ViewJobDetails, ScrollableContainer } from '../../../components';
import { convertToFinishedJobId } from '../../../utils/helpers';

export default function ManageJobs() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const {
    getCompanyId,
    getUid,
    companyPendingJobs: cachedPendingJobs,
    cachedWorkersList,
    moveJobToFinished,
    updateJob,
  } = useCache();
  const themeColors = getColors(isDarkMode);
  const [loading, setLoading] = useState(true);
  const [pendingJobs, setPendingJobs] = useState([]);
  const [selectedJobDetails, setSelectedJobDetails] = useState(null);
  const [highlightedJobId, setHighlightedJobId] = useState(null);
  const insets = useSafeAreaInsets();

  const t = language === 'en' ? {
    title: 'Manage Jobs',
    subtitle: 'Assign new jobs to workers',
    createJob: 'Create Job',
    assignJob: 'Assign New Job',
    noJobs: 'No pending jobs',
    pending: 'Pending',
    received: 'Received',
    waiting: 'Waiting for Approval',
    finished: 'Finished',
    jobDetails: 'Job Details',
    close: 'Close',
    accept: 'Accept',
    deny: 'Deny',
    worker: 'Worker',
    createdAt: 'Created At',
    status: 'Status',
    title: 'Title',
    description: 'Description',
    location: 'Location',
    photos: 'Photos',
    noPhotos: 'No photos available',
    signature: 'Signature',
    noSignature: 'No signature available',
    timeWorked: 'Time Worked',
    clientName: 'Client Name',
    clientPhone: 'Client Phone',
    partsUsed: 'Parts Used',
    noParts: 'No parts used',
    travelDistance: 'Travel Distance',
    km: 'km',
    acceptSuccess: 'Job accepted successfully',
    denySuccess: 'Job denied',
    confirmAccept: 'Accept Job',
    confirmAcceptMessage: 'Are you sure you want to accept this job?',
    confirmDeny: 'Deny Job',
    confirmDenyMessage: 'Are you sure you want to deny this job?',
    cancel: 'Cancel',
    loading: 'Loading jobs...',
  } : language === 'he' ? {
    title: 'ניהול משימות',
    subtitle: 'הקצאת משימות חדשות לעובדים',
    createJob: 'יצירת משימה',
    assignJob: 'הקצאת משימה חדשה',
    noJobs: 'אין משימות ממתינות',
    pending: 'ממתין',
    received: 'התקבל',
    waiting: 'ממתין לאישור',
    finished: 'הושלם',
    jobDetails: 'פרטי משימה',
    close: 'סגור',
    accept: 'אשר',
    deny: 'דחה',
    worker: 'עובד',
    createdAt: 'נוצר ב',
    status: 'סטטוס',
    title: 'כותרת',
    description: 'תיאור',
    location: 'מיקום',
    photos: 'תמונות',
    noPhotos: 'אין תמונות זמינות',
    signature: 'חתימה',
    noSignature: 'אין חתימה זמינה',
    timeWorked: 'זמן עבודה',
    clientName: 'שם הלקוח',
    clientPhone: 'טלפון הלקוח',
    partsUsed: 'חלקים בשימוש',
    noParts: 'אין חלקים בשימוש',
    travelDistance: 'מרחק נסיעה',
    km: 'ק"מ',
    acceptSuccess: 'המשימה אושרה בהצלחה',
    denySuccess: 'המשימה נדחתה',
    confirmAccept: 'אישור משימה',
    confirmAcceptMessage: 'האם אתה בטוח שברצונך לאשר את המשימה?',
    confirmDeny: 'דחיית משימה',
    confirmDenyMessage: 'האם אתה בטוח שברצונך לדחות את המשימה?',
    cancel: 'ביטול',
    loading: 'טוען משימות...',
  } : {
    title: 'إدارة المهام',
    subtitle: 'تعيين مهام جديدة للعمال',
    createJob: 'إنشاء مهمة',
    assignJob: 'تعيين مهمة جديدة',
    noJobs: 'لا توجد مهام معلقة',
    pending: 'قيد الانتظار',
    received: 'مستلم',
    waiting: 'في انتظار الموافقة',
    finished: 'مكتمل',
    jobDetails: 'تفاصيل المهمة',
    close: 'إغلاق',
    accept: 'قبول',
    deny: 'رفض',
    worker: 'العامل',
    createdAt: 'تم الإنشاء في',
    status: 'الحالة',
    title: 'العنوان',
    description: 'الوصف',
    location: 'الموقع',
    photos: 'الصور',
    noPhotos: 'لا توجد صور متاحة',
    signature: 'التوقيع',
    noSignature: 'لا يوجد توقيع متاح',
    timeWorked: 'وقت العمل',
    clientName: 'اسم العميل',
    clientPhone: 'هاتف العميل',
    partsUsed: 'القطع المستخدمة',
    noParts: 'لا توجد قطع مستخدمة',
    travelDistance: 'مسافة السفر',
    km: 'كم',
    acceptSuccess: 'تم قبول المهمة بنجاح',
    denySuccess: 'تم رفض المهمة',
    confirmAccept: 'قبول المهمة',
    confirmAcceptMessage: 'هل أنت متأكد أنك تريد قبول هذه المهمة؟',
    confirmDeny: 'رفض المهمة',
    confirmDenyMessage: 'هل أنت متأكد أنك تريد رفض هذه المهمة؟',
    cancel: 'إلغاء',
    loading: 'جاري تحميل المهام...',
  };

  // Helper to resolve worker UID to display name
  const getWorkerDisplayName = (uid) => {
    if (!uid) return 'Unknown Worker';
    if (cachedWorkersList && cachedWorkersList.length > 0) {
      const worker = cachedWorkersList.find(w => w.uid === uid);
      if (worker) return worker.name || worker.email;
    }
    return 'Unknown Worker';
  };

  // Load pending jobs from cache - CacheContext already has listeners for real-time updates
  useEffect(() => {
    const loadJobsFromCache = () => {
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
        
        // Use cached pending jobs - CacheContext handles real-time updates
        if (cachedPendingJobs && cachedPendingJobs.length > 0) {
          console.log('📦 [CACHE READ] ManageJobs - pending jobs from cache:', cachedPendingJobs.length);
          const jobsList = cachedPendingJobs.map((job) => ({
            ...job,
            workerName: job.name || getWorkerDisplayName(job.completedBy || job.assignedTo),
          }));
          
          // Sort by creation date - newest first
          jobsList.sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
          });
          
          setPendingJobs(jobsList);
        } else {
          setPendingJobs([]);
        }
        
        setLoading(false);
      } catch (error) {
        console.error('Error loading jobs from cache:', error);
        setLoading(false);
      }
    };

    loadJobsFromCache();
  }, [cachedPendingJobs]); // Re-run when cache updates

  // Highlight job when navigating with jobId
  useEffect(() => {
    if (jobId && !loading) {
      setHighlightedJobId(jobId);
      
      const timer = setTimeout(() => {
        setHighlightedJobId(null);
      }, 2500);
      
      return () => clearTimeout(timer);
    }
  }, [jobId, loading]);

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'pending': return '#f59e0b';
      case 'received': return '#3b82f6';
      case 'waiting': return '#8b5cf6';
      case 'finished': return '#10b981';
      default: return '#6b7280';
    }
  };

  const getStatusText = (status) => {
    switch (status?.toLowerCase()) {
      case 'pending': return t.pending;
      case 'received': return t.received;
      case 'waiting': return t.waiting;
      case 'finished': return t.finished || 'Finished';
      default: return status || 'unknown';
    }
  };

  const handleAcceptJob = async (job) => {
    alert.confirm(
      t.confirmAccept,
      t.confirmAcceptMessage,
      [
        {
          text: t.cancel,
          style: 'cancel',
          onPress: () => {}
        },
        {
          text: t.accept,
          style: 'primary',
          onPress: async () => {
            try {
              const companyId = getCompanyId();
              
              if (!companyId) {
                alert.error('Error', 'Company ID not found in profile');
                return;
              }

              const workerId = job.workerId || job.completedBy || job.assignedTo;
              const currentUid = getUid();
              
              // Convert pending job ID (p_) to finished job ID (f_)
              const finishedJobId = convertToFinishedJobId(job.id);
              
              // Prepare finished job data with new f_ ID
              const finishedJobData = {
                ...job,
                id: finishedJobId,  // Update ID with f_ prefix
                status: 'finished',
                isCert: false,
                finishedAt: new Date().toISOString(),
                approvedBy: currentUid || auth.currentUser.uid,
              };
              

              
              // STEP 1: Move job to finishedJobs collection in Firebase
              console.log('🔥 ManageJobs: Writing to Firebase...');
              const finishedJobRef = doc(db, 'companies', companyId, 'finishedJobs', finishedJobId);
              await setDoc(finishedJobRef, finishedJobData);
              // STEP 2: Update local cache FIRST (prevents unnecessary Firebase read when snapshot fires)
              // Also deletes p_jobId from company cache and worker cache, adds f_jobId
              console.log('📦 ManageJobs: Updating local cache first...');
              await moveJobToFinished(job.id, finishedJobData, workerId);
              // STEP 3: Delete from PendingJobs using original p_ ID
              const pendingJobRef = doc(db, 'companies', companyId, 'PendingJobs', job.id);
              await deleteDoc(pendingJobRef);
              
              console.log('✅ ManageJobs: Job accepted successfully');

              // Deduct parts from worker's inventory if parts were used
              if (workerId && job.partsUsed && job.partsUsed.length > 0) {
                const inventoryRef = doc(db, workerId, 'inventory');
                const inventorySnap = await getDoc(inventoryRef);
                
                if (inventorySnap.exists()) {
                  const inventoryDoc = inventorySnap.data();
                  let partsArray = Array.isArray(inventoryDoc.parts) ? [...inventoryDoc.parts] : [];
                  
                  // Deduct parts from array (matching FillJob.js logic)
                  job.partsUsed.forEach(usedPart => {
                    const partIndex = partsArray.findIndex(p => p.id === usedPart.id);
                    if (partIndex !== -1) {
                      const currentQty = parseInt(partsArray[partIndex].quantity) || 0;
                      const usedQty = parseInt(usedPart.quantity) || 0;
                      const newQty = Math.max(0, currentQty - usedQty);
                      
                      partsArray[partIndex] = {
                        ...partsArray[partIndex],
                        quantity: newQty
                      };
                      console.log(`📦 ManageJobs: Deducting ${usedQty} of ${partsArray[partIndex].name} from worker inventory. New qty: ${newQty}`);
                    }
                  });
                  
                  // Update Firestore with array structure
                  await setDoc(inventoryRef, {
                    parts: partsArray,
                    lastUpdated: new Date().toISOString()
                  });
                  
                  // Increment worker's inventory version
                  const workerCacheRef = doc(db, workerId, 'cache');
                  await updateDoc(workerCacheRef, {
                    inventory: FieldValue.increment(1)
                  }).catch(() => {
                    // Cache doc might not exist for this worker
                    setDoc(workerCacheRef, { inventory: 1 }, { merge: true });
                  });
                }
              }

              alert.success('Success', t.acceptSuccess);
              setSelectedJobDetails(null);
            } catch (error) {
              console.error('Error accepting job:', error);
              alert.error('Error', 'Failed to accept job: ' + error.message);
            }
          }
        }
      ]
    );
  };

  const handleDenyJob = async (job) => {
    alert.confirm(
      t.confirmDeny,
      t.confirmDenyMessage,
      [
        {
          text: t.cancel,
          style: 'cancel',
          onPress: () => {}
        },
        {
          text: t.deny,
          style: 'destructive',
          onPress: async () => {
            try {
              const companyId = getCompanyId();
              
              if (!companyId) {
                alert.error('Error', 'Company ID not found in profile');
                return;
              }

              const currentUid = getUid();

              // Update job status to denied in PendingJobs
              const pendingJobRef = doc(db, 'companies', companyId, 'PendingJobs', job.id);
              await updateDoc(pendingJobRef, {
                status: 'denied',
                deniedAt: new Date().toISOString(),
                deniedBy: currentUid || auth.currentUser.uid,
              });

              // Update job in cache with document-level versioning
              await updateJob(job.id, {
                status: 'denied',
                deniedAt: new Date().toISOString(),
                deniedBy: currentUid || auth.currentUser.uid,
              }, true);

              alert.success('Success', t.denySuccess);
              setSelectedJobDetails(null);
            } catch (error) {
              console.error('Error denying job:', error);
              alert.error('Error', 'Failed to deny job: ' + error.message);
            }
          }
        }
      ]
    );
  };

  const JobCard = ({ job }) => {
    const displayName = job.workerName || job.name || getWorkerDisplayName(job.completedBy || job.assignedTo);
    const isHighlighted = highlightedJobId === job.id;
    const isWaiting = job.status?.toLowerCase() === 'waiting';
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
                <Text style={[styles.jobTitle, { color: themeColors.textPrimary }]}>{job.title || 'Untitled Job'}</Text>
                <Text style={[styles.jobWorker, { color: themeColors.textSecondary }]}>👤 {displayName}</Text>
                {job.createdAt && (
                  <Text style={[styles.jobDate, { color: themeColors.textSecondary }]}>
                    📅 {new Date(job.createdAt).toLocaleDateString()}
                  </Text>
                )}
              </View>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <Text style={styles.statusText}>{getStatusText(job.status)}</Text>
            </View>
          </View>
          
          {isWaiting && (
            <View style={styles.actionsRow}>
              <TouchableOpacity 
                style={styles.acceptButton}
                onPress={(e) => {
                  e.stopPropagation();
                  handleAcceptJob(job);
                }}
              >
                <LinearGradient colors={gradients.greenBox} style={styles.actionButtonGradient}>
                  <Ionicons name="checkmark-circle" size={20} color="white" />
                  <Text style={styles.actionButtonText}>{t.accept}</Text>
                </LinearGradient>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.denyButton}
                onPress={(e) => {
                  e.stopPropagation();
                  handleDenyJob(job);
                }}
              >
                <LinearGradient colors={gradients.redBox} style={styles.actionButtonGradient}>
                  <Ionicons name="close-circle" size={20} color="white" />
                  <Text style={styles.actionButtonText}>{t.deny}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.background }]}>
        <StatusBar style={isDarkMode ? "light" : "dark"} />
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: themeColors.textPrimary }]}>{t.loading}</Text>
        </View>
        <GlobalHeader />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      {/* Create Job Button */}
      <View style={styles.createJobContainer}>
        <TouchableOpacity onPress={() => router.push('/CreateJob')}>
          <LinearGradient colors={gradients.indigoBox} style={styles.createJobButton}>
            <MaterialCommunityIcons name="clipboard-plus" size={24} color="white" />
            <Text style={styles.createJobText}>{t.assignJob}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Jobs List */}
      <ScrollableContainer 
        style={styles.content}
        contentContainerStyle={{ paddingBottom: Platform.OS === 'android' ? 120 + insets.bottom : 30 + insets.bottom }}
      >
        {pendingJobs.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="clipboard-text-off" size={64} color={themeColors.textSecondary} />
            <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>{t.noJobs}</Text>
          </View>
        ) : (
          pendingJobs.map((job) => <JobCard key={job.id} job={job} />)
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
          clientName: t.clientName,
          clientPhone: t.clientPhone,
          clientInfo: t.clientName,
          createdAt: t.createdAt,
          finishedAt: t.finishedAt || t.createdAt,
          status: t.status,
          timeStatus: t.timeWorked,
          photos: t.photos,
          noPhotos: t.noPhotos,
          signature: t.signature,
          noSignature: t.noSignature,
          signingPerson: t.signingPerson || t.clientName,
          close: t.close,
          timeWorked: t.timeWorked,
          partsUsed: t.partsUsed,
          noParts: t.noParts,
          assignedBy: t.assignedBy || t.createdAt,
        }}
        getStatusColor={getStatusColor}
        onImagePress={(photo) => {/* Can add image modal if needed */}}
        isDarkMode={isDarkMode}
      />

      {/* Fixed GlobalHeader */}
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
    fontSize: typography.lg,
    marginTop: spacing.md,
  },
  header: {
    paddingTop: 60,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    ...shadows.card,
  },
  headerCenter: {
    alignItems: 'center',
  },
  title: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.base,
  },
  createJobContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingTop: 110,
  },
  createJobButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md + 4,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
    ...shadows.floating,
  },
  createJobText: {
    color: 'white',
    fontSize: typography.lg,
    fontWeight: typography.bold,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xxl * 2,
  },
  emptyText: {
    fontSize: typography.lg,
    marginTop: spacing.md,
  },
  jobCard: {
    borderRadius: 12,
    padding: spacing.lg,
    marginBottom: spacing.md,
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
    marginBottom: spacing.sm,
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
  },
  jobTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  jobWorker: {
    fontSize: typography.base,
    marginBottom: spacing.xs,
  },
  jobDate: {
    fontSize: typography.sm,
  },
  statusBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    ...shadows.sm,
  },
  statusText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  acceptButton: {
    flex: 1,
  },
  denyButton: {
    flex: 1,
  },
  actionButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 4,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  actionButtonText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
});
