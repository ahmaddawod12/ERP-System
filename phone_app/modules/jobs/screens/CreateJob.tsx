// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
 } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { auth, functions, httpsCallable } from '../../../firebase';
import { spacing, borderRadius, typography, shadows, getColors, gradients } from '../../../theme';
import { AppButton, AppCard, AppText, AppInput, SearchInput, LoadingSpinner, GlobalHeader, ScrollableContainer, ClientSelector, ScreenHeroCard } from '../../../components';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { fetchCompanyWorkers } from '../../../utils/read-model';

export default function CreateJob() {
  const router = useRouter();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const {
    getCompanyId,
    getUid,
    profile,
    workers: cachedWorkersList,
    addJob,
    updateWorkers,
    clients: cachedClients,
    addClient,
    updateClient,
    fetchClients,
  } = useCache();
  const themeColors = getColors(isDarkMode);
  const [workers, setWorkers] = useState([]);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [selectedWorkerWid, setSelectedWorkerWid] = useState(null);
  const [selectedWorkerName, setSelectedWorkerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClientObj, setSelectedClientObj] = useState(null);
  const [newJob, setNewJob] = useState({
    title: '',
    description: '',
    location: '',
    cname: '',
    cphone: '',
  });

  const t = language === 'en' ? {
    title: 'Create Job',
    subtitle: 'Assign a new job to a worker',
    back: 'Back',
    selectWorker: 'Select a Worker',
    searchWorker: 'Search workers...',
    jobDetails: 'Job Details',
    jobTitle: 'Job Title',
    description: 'Description',
    location: 'Location',
    clientName: 'Client Name',
    clientPhone: 'Client Phone Number',
    submit: 'Create Job',
    cancel: 'Cancel',
    assignedTo: 'Assigned to',
    workersMetric: 'Workers',
    selectedMetric: 'Selected',
    none: 'None',
    fillAllFields: 'Please fill all fields',
    selectWorkerFirst: 'Please select a worker first',
    jobCreated: 'Job created successfully',
  } : language === 'he' ? {
    title: 'יצירת משימה',
    subtitle: 'הקצה משימה חדשה לעובד',
    back: 'חזרה',
    selectWorker: 'בחר עובד',
    searchWorker: 'חפש עובדים...',
    jobDetails: 'פרטי משימה',
    jobTitle: 'כותרת משימה',
    description: 'תיאור',
    location: 'מיקום',
    clientName: 'שם הלקוח',
    clientPhone: 'טלפון הלקוח',
    submit: 'צור משימה',
    cancel: 'ביטול',
    assignedTo: 'מוקצה ל',
    workersMetric: 'עובדים',
    selectedMetric: 'נבחר',
    none: 'אין',
    fillAllFields: 'אנא מלא את כל השדות',
    selectWorkerFirst: 'אנא בחר עובד תחילה',
    jobCreated: 'המשימה נוצרה בהצלחה',
  } : {
    title: 'إنشاء مهمة',
    subtitle: 'تعيين مهمة جديدة للعامل',
    back: 'رجوع',
    selectWorker: 'اختر عاملاً',
    searchWorker: 'بحث عن عمال...',
    jobDetails: 'تفاصيل المهمة',
    jobTitle: 'عنوان المهمة',
    description: 'الوصف',
    location: 'الموقع',
    clientName: 'اسم العميل',
    clientPhone: 'رقم هاتف العميل',
    submit: 'إنشاء مهمة',
    cancel: 'إلغاء',
    assignedTo: 'مخصص لـ',
    workersMetric: 'العمال',
    selectedMetric: 'المحدد',
    none: 'لا يوجد',
    fillAllFields: 'يرجى ملء جميع الحقول',
    selectWorkerFirst: 'يرجى اختيار عامل أولاً',
    jobCreated: 'تم إنشاء المهمة بنجاح',
  };

  useEffect(() => {
    const user = auth.currentUser;
    if (user) {
      loadWorkers();
      // Fetch clients if not already cached
      if (cachedClients.length === 0) {
        fetchClients();
      }
    }
  }, []);

  // Watch for cached workers list changes and re-sync
  useEffect(() => {
    if (cachedWorkersList && Object.keys(cachedWorkersList).length > 0) {
      console.log('📦 CreateJob: cached workers list updated - re-syncing');
      loadWorkers();
    }
  }, [cachedWorkersList]);

  const loadWorkers = async () => {
    try {
      setLoading(true);
      const user = auth.currentUser;
      if (!user) return;

      // Get manager's companyId from cache
      const companyId = getCompanyId();
      
      if (!companyId) {
        console.log('No company ID found');
        return;
      }

      // Use cached workers list if available (keyed by wid or uid)
      if (cachedWorkersList && Object.keys(cachedWorkersList).length > 0) {
        const workersArray = Object.keys(cachedWorkersList).map((key) => {
          const workerData = cachedWorkersList[key] || {};
          return {
            uid: workerData.uid || key,
            wid: workerData.wid || key,
            email: workerData.email || '',
            name: workerData.name || '',
            phoneNumber: workerData.phoneNumber || '',
          };
        });
        setWorkers(workersArray);
        setLoading(false);
        return;
      }

      const fetchedWorkers = await fetchCompanyWorkers(companyId);
      if (fetchedWorkers.length > 0) {
        const workersData = {};
        fetchedWorkers.forEach((workerData) => {
          const wid = workerData.wid || workerData.uid;
          if (!wid) return;
          workersData[wid] = workerData;
        });
        
        // Save to cache for next time
        await updateWorkers(workersData);
        
        const workersArray = Object.values(workersData);
        setWorkers(workersArray);
      }
    } catch (error) {
      console.error('Error loading workers:', error);
      alert.error('Error', 'Failed to load workers');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateJob = async () => {
    if (!newJob.title || !newJob.description || !newJob.location || !newJob.cname || !newJob.cphone) {
      alert.error('Error', t.fillAllFields);
      return;
    }

    if (!selectedWorker) {
      alert.error('Error', t.selectWorkerFirst);
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      alert.error('Error', 'Not authenticated');
      return;
    }

    try {
      // Get manager's info and company name from cache
      const companyId = getCompanyId();
      const managerUid = getUid() || user.uid;
      const managerName = profile?.name || managerUid;
      
      if (!companyId) {
        alert.error('Error', 'Company ID not found');
        return;
      }

      // Auto-save new client or update existing client with missing fields
      let clientCid = selectedClientObj?.id || null;
      if (selectedClientObj && newJob.cname.trim()) {
        // Update existing client with any newly filled fields
        try {
          const updates = {};
          if (newJob.cname.trim() && newJob.cname.trim() !== (selectedClientObj.cname || selectedClientObj.name || '')) updates.name = newJob.cname.trim();
          if (newJob.cphone.trim() && newJob.cphone.trim() !== (selectedClientObj.cphone || selectedClientObj.phone || '')) updates.phone = newJob.cphone.trim();
          if (Object.keys(updates).length > 0) {
            await updateClient(selectedClientObj.id, updates);
            console.log('Updated existing client with new fields:', Object.keys(updates));
          }
        } catch (e) {
          console.log('Update client failed (non-critical):', e);
        }
      } else if (!selectedClientObj && newJob.cname.trim()) {
        // Save as new client
        try {
          const clientToSave = { name: newJob.cname.trim() };
          if (newJob.cphone.trim()) clientToSave.phone = newJob.cphone.trim();
          const savedClient = await addClient(clientToSave);
          if (savedClient) clientCid = savedClient.id;
        } catch (e) {
          console.log('Auto-save client failed (non-critical):', e);
        }
      }
      
      // Build clean job payload using new field names
      const selectedWorkerObj = workers.find(w => w.uid === selectedWorker);
      const workerWid = selectedWorkerObj?.wid || selectedWorkerWid;
      const managerMid = profile?.mid || null;

      const jobData = {
        title: newJob.title,
        description: newJob.description,
        location: newJob.location,
        status: 'pending',
        mname: managerName,
        mid: managerMid ? String(managerMid) : null,
        wid: workerWid ? String(workerWid) : null,
        wname: selectedWorkerName,
        cname: newJob.cname.trim(),
        cphone: newJob.cphone.trim(),
        ...(clientCid && { cid: clientCid }),
      };

      // Use createJobV1 Cloud Function for atomic job creation with sequential ID
      const createJobFn = httpsCallable(functions, 'createJobV1');
      const result = await createJobFn({
        companyId,
        type: 'pending',
        ...jobData,
      });

      const serverJobId = result.data?.jobId || result.jobId;
      const createdJob = { ...jobData, id: serverJobId, createdAt: new Date().toISOString() };

      // Update local cache with the server-generated ID
      await addJob(createdJob, true, selectedWorker);

      alert.success('Success', t.jobCreated);
      setNewJob({ title: '', description: '', location: '', cname: '', cphone: '' });
      setSelectedWorker(null);
      setSelectedWorkerName('');
      setSelectedWorkerWid(null);
      setSelectedClientObj(null);
      
      // Navigate back to manager homepage
      router.back();
    } catch (error) {
      console.error('Error creating job:', error);
      alert.error('Error', 'Failed to create job');
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
        contentContainerStyle={[styles.scrollContent, { paddingTop: 100 }]}
      >
        <ScreenHeroCard
          title={t.title}
          subtitle={t.subtitle}
          eyebrow="Dispatch"
          icon="clipboard-plus-outline"
          iconLibrary="material"
          accentColor={themeColors.boxIndigo}
          metrics={[
            { label: t.workersMetric, value: String(workers.length) },
            { label: t.selectedMetric, value: selectedWorkerName || t.none },
          ]}
          badges={[t.selectWorker, t.jobDetails]}
          style={styles.heroCard}
        />

        {/* Workers List */}
        <View style={styles.section}>
          <AppCard style={[styles.sectionCard, { backgroundColor: themeColors.backgroundElevated, borderColor: themeColors.border }]}> 
            <AppText style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>{t.selectWorker}</AppText>

            {!selectedWorker && (
              <SearchInput
                placeholder={t.searchWorker}
                value={searchQuery}
                onChangeText={setSearchQuery}
                colors={themeColors}
                style={styles.searchInput}
              />
            )}

            <View style={styles.workersListContainer}>
            {workers
              .filter((worker) => {
                // If a worker is selected, only show that worker
                if (selectedWorker) {
                  return worker.uid === selectedWorker;
                }
                
                // Otherwise, show all workers matching search
                const searchLower = searchQuery.toLowerCase();
                return (
                  worker.name?.toLowerCase().includes(searchLower) ||
                  worker.email?.toLowerCase().includes(searchLower)
                );
              })
              .map((worker) => {
                const isSelected = selectedWorker === worker.uid;
                return (
                  <TouchableOpacity
                    key={worker.uid}
                    style={[
                      styles.workerCard,
                      { 
                        backgroundColor: themeColors.surface,
                        borderColor: isSelected ? themeColors.secondary : themeColors.border,
                        borderWidth: isSelected ? 3 : 2,
                      },
                    ]}
                    onPress={() => {
                      if (selectedWorker === worker.uid) {
                        // Deselect worker, clear form, and show all workers again
                        setSelectedWorker(null);
                        setSelectedWorkerName('');
                        setSelectedWorkerWid(null);
                        setSearchQuery(''); // Clear search when deselecting
                        setNewJob({ title: '', description: '', location: '', cname: '', cphone: '' });
                      } else {
                        // Select new worker, clear form, and hide other workers
                        setSelectedWorker(worker.uid);
                        setSelectedWorkerName(worker.name || worker.email);
                        setSelectedWorkerWid(worker.wid);
                        setNewJob({ title: '', description: '', location: '', cname: '', cphone: '' });
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
                        <AppText style={[styles.workerName, { color: themeColors.textPrimary }]}>
                          {worker.name || worker.email}
                        </AppText>
                        <AppText style={[styles.workerEmail, { color: themeColors.textSecondary }]}>
                          {worker.email}
                        </AppText>
                        {worker.phoneNumber && (
                          <AppText style={[styles.workerPhone, { color: themeColors.textLight }]}>
                            📞 {worker.phoneNumber}
                          </AppText>
                        )}
                      </View>
                      {isSelected ? (
                        <View style={styles.selectedWorkerActions}>
                          <Ionicons name="checkmark-circle" size={32} color={themeColors.secondary} />
                          <AppText style={[styles.tapToChangeText, { color: themeColors.textLight }]}>
                            {language === 'en' ? 'Tap to change' : language === 'he' ? 'לחץ לשינוי' : 'اضغط للتغيير'}
                          </AppText>
                        </View>
                      ) : (
                        <Ionicons name="chevron-forward" size={24} color={themeColors.textLight} />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </AppCard>
        </View>

        {/* Job Form */}
        {selectedWorker && (
          <View style={styles.section}>
            <View style={styles.jobDetailsHeader}>
              <MaterialCommunityIcons name="clipboard-text" size={24} color={themeColors.secondary} />
              <AppText style={[styles.sectionTitle, { color: themeColors.textPrimary, marginBottom: 0, marginLeft: 8 }]}>
                {t.jobDetails}
              </AppText>
            </View>
            
            <AppCard style={[styles.formContainer, { backgroundColor: themeColors.backgroundElevated, borderColor: themeColors.border }]}> 
              {/* Assigned to badge */}
              <View style={styles.assignedToBadge}>
                <LinearGradient colors={gradients.secondary} style={styles.assignedToBadgeGradient}>
                  <MaterialCommunityIcons name="account-check" size={20} color="white" />
                  <AppText style={styles.assignedToBadgeText}>
                    {t.assignedTo}: {selectedWorkerName}
                  </AppText>
                </LinearGradient>
              </View>

              {/* Client Information - search + manual fields together */}
              <View style={[styles.clientSection, { backgroundColor: themeColors.backgroundLight, borderColor: themeColors.border }]}>
                <View style={styles.inputLabelRow}>
                  <Ionicons name="person" size={20} color={themeColors.secondary} />
                  <AppText style={[styles.inputLabel, { color: themeColors.textSecondary, fontWeight: 'bold' }]}>
                    {t.clientName}
                  </AppText>
                </View>

                {/* Embedded client selector (search + dropdown) */}
                <ClientSelector
                  clients={cachedClients}
                  onSelect={(client) => {
                    setSelectedClientObj(client);
                    setNewJob(prev => ({
                      ...prev,
                      cname: client.cname || client.name || '',
                      cphone: client.cphone || client.phone || '',
                    }));
                  }}
                  selectedClient={selectedClientObj}
                  onClear={() => {
                    setSelectedClientObj(null);
                    setNewJob(prev => ({ ...prev, cname: '', cphone: '' }));
                  }}
                  colors={themeColors}
                  language={language}
                />

                {/* Client fields - always visible, pre-filled when client selected */}
                <AppInput
                  value={newJob.cname}
                  onChangeText={(text) => setNewJob({ ...newJob, cname: text })}
                  placeholder={t.clientName + ' *'}
                  colors={themeColors}
                />
                <AppInput
                  value={newJob.cphone}
                  onChangeText={(text) => setNewJob({ ...newJob, cphone: text })}
                  placeholder={t.clientPhone}
                  colors={themeColors}
                  keyboardType="phone-pad"
                />
              </View>

              <View style={styles.inputWrapper}>
                <View style={styles.inputLabelRow}>
                  <MaterialCommunityIcons name="format-title" size={20} color={themeColors.secondary} />
                  <AppText style={[styles.inputLabel, { color: themeColors.textSecondary }]}>
                    {t.jobTitle} *
                  </AppText>
                </View>
                <AppInput
                  value={newJob.title}
                  onChangeText={(text) => setNewJob({ ...newJob, title: text })}
                  placeholder={t.jobTitle}
                  colors={themeColors}
                />
              </View>
              
              <View style={styles.inputWrapper}>
                <View style={styles.inputLabelRow}>
                  <MaterialCommunityIcons name="text" size={20} color={themeColors.secondary} />
                  <AppText style={[styles.inputLabel, { color: themeColors.textSecondary }]}>
                    {t.description} *
                  </AppText>
                </View>
                <AppInput
                  value={newJob.description}
                  onChangeText={(text) => setNewJob({ ...newJob, description: text })}
                  placeholder={t.description}
                  colors={themeColors}
                  multiline
                  numberOfLines={4}
                />
              </View>
              
              <View style={styles.inputWrapper}>
                <View style={styles.inputLabelRow}>
                  <MaterialCommunityIcons name="map-marker" size={20} color={themeColors.secondary} />
                  <AppText style={[styles.inputLabel, { color: themeColors.textSecondary }]}>
                    {t.location} *
                  </AppText>
                </View>
                <AppInput
                  value={newJob.location}
                  onChangeText={(text) => setNewJob({ ...newJob, location: text })}
                  placeholder={t.location}
                  colors={themeColors}
                />
              </View>
              
              <View style={styles.formActions}>
                <AppButton
                  title={t.cancel}
                  variant="secondary"
                  iconLeft={{ name: 'close-circle-outline' }}
                  style={styles.cancelButtonWrapper}
                  onPress={() => {
                    setSelectedWorker(null);
                    setSelectedWorkerWid(null);
                    setSelectedWorkerName('');
                    setSearchQuery(''); // Clear search when canceling
                    setSelectedClientObj(null);
                    setNewJob({ title: '', description: '', location: '', cname: '', cphone: '' });
                  }}
                />

                <AppButton
                  title={t.submit}
                  iconLeft={{ name: 'checkmark-circle-outline' }}
                  style={styles.submitButtonWrapper}
                  onPress={handleCreateJob}
                />
              </View>
            </AppCard>
          </View>
        )}
      </ScrollableContainer>
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
  scrollContent: {
    paddingTop: Platform.OS === 'ios' ? 110 : 98,
    paddingBottom: 40,
  },
  heroCard: {
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: 24,
  },
  sectionCard: {
    ...shadows.card,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  workersListContainer: {
    gap: 12,
  },
  searchInput: {
    marginBottom: spacing.md,
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
  workerPhone: {
    fontSize: typography.xs,
  },
  jobDetailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  formContainer: {
    ...shadows.lg,
  },
  assignedToBadge: {
    marginBottom: spacing.lg,
  },
  assignedToBadgeGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.lg,
    gap: spacing.xs,
  },
  assignedToBadgeText: {
    color: 'white',
    fontSize: typography.sm,
    fontWeight: typography.bold,
  },
  clientSection: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  inputWrapper: {
    marginBottom: spacing.md,
  },
  inputLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    gap: spacing.xs,
  },
  inputLabel: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  input: {
    borderWidth: 2,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: typography.base,
    color: '#1f2937',
    backgroundColor: '#ffffff',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  formActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  cancelButtonWrapper: {
    flex: 1,
  },
  submitButtonWrapper: {
    flex: 1,
  },
  selectedWorkerActions: {
    alignItems: 'center',
    gap: 4,
  },
  tapToChangeText: {
    fontSize: 10,
    fontStyle: 'italic',
  },
});







