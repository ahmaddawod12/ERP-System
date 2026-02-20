import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { auth, db, collection, doc, getDocs, setDoc, functions, httpsCallable } from '../../firebase';
import { colors, spacing, borderRadius, typography, shadows, getColors, gradients } from '../../theme';
import { SearchInput, LoadingSpinner, GlobalHeader, ScrollableContainer, ClientSelector } from '../../components';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAlert } from '../../contexts/AlertContext';
import { useCache } from '../../contexts/CacheContext';

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
    updateWorkersList,
    clients: cachedClients,
    addClient,
    updateClient,
    fetchClients,
  } = useCache();
  const themeColors = getColors(isDarkMode);
  const [workers, setWorkers] = useState([]);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [selectedWorkerName, setSelectedWorkerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClientObj, setSelectedClientObj] = useState(null);
  const [newJob, setNewJob] = useState({
    title: '',
    description: '',
    location: '',
    clientName: '',
    clientPhone: '',
    clientEmail: '',
    clientAddress: '',
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
    clientEmail: 'Client Email',
    clientAddress: 'Client Address',
    submit: 'Create Job',
    cancel: 'Cancel',
    assignedTo: 'Assigned to',
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
    clientEmail: 'אימייל הלקוח',
    clientAddress: 'כתובת הלקוח',
    submit: 'צור משימה',
    cancel: 'ביטול',
    assignedTo: 'מוקצה ל',
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
    clientEmail: 'بريد العميل الإلكتروني',
    clientAddress: 'عنوان العميل',
    submit: 'إنشاء مهمة',
    cancel: 'إلغاء',
    assignedTo: 'مخصص لـ',
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

      // Use cached workers list if available (keyed by UID)
      if (cachedWorkersList && Object.keys(cachedWorkersList).length > 0) {
        const workersArray = Object.keys(cachedWorkersList).map((key) => {
          const workerData = cachedWorkersList[key] || {};
          return {
            uid: workerData.uid || key,
            email: workerData.email || '',
            name: workerData.name || '',
            phoneNumber: workerData.phoneNumber || '',
          };
        });
        setWorkers(workersArray);
        setLoading(false);
        return;
      }

      // Fallback to Firebase (workers docs are keyed by UID)
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
        
        const workersArray = Object.entries(workersData).map(([uid, data]) => ({
          ...data,
          uid,
        }));
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
    if (!newJob.title || !newJob.description || !newJob.location || !newJob.clientName || !newJob.clientPhone) {
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
      let clientId = selectedClientObj?.id || null;
      if (selectedClientObj && newJob.clientName.trim()) {
        // Update existing client with any newly filled fields
        try {
          const updates = {};
          if (newJob.clientName.trim() && newJob.clientName.trim() !== (selectedClientObj.name || '')) updates.name = newJob.clientName.trim();
          if (newJob.clientPhone.trim() && newJob.clientPhone.trim() !== (selectedClientObj.phone || '')) updates.phone = newJob.clientPhone.trim();
          if (newJob.clientEmail.trim() && newJob.clientEmail.trim() !== (selectedClientObj.email || '')) updates.email = newJob.clientEmail.trim();
          if (newJob.clientAddress.trim() && newJob.clientAddress.trim() !== (selectedClientObj.address || '')) updates.address = newJob.clientAddress.trim();
          if (Object.keys(updates).length > 0) {
            await updateClient(selectedClientObj.id, updates);
            console.log('✅ Updated existing client with new fields:', Object.keys(updates));
          }
        } catch (e) {
          console.log('Update client failed (non-critical):', e);
        }
      } else if (!selectedClientObj && newJob.clientName.trim()) {
        // Save as new client
        try {
          const clientToSave = { name: newJob.clientName.trim() };
          if (newJob.clientPhone.trim()) clientToSave.phone = newJob.clientPhone.trim();
          if (newJob.clientEmail.trim()) clientToSave.email = newJob.clientEmail.trim();
          if (newJob.clientAddress.trim()) clientToSave.address = newJob.clientAddress.trim();
          const savedClient = await addClient(clientToSave);
          if (savedClient) clientId = savedClient.id;
        } catch (e) {
          console.log('Auto-save client failed (non-critical):', e);
        }
      }
      
      const jobData = {
        ...newJob,
        status: 'pending',
        MName: managerName,
        completedBy: selectedWorker,  // Worker UID for filtering
        workerId: selectedWorker,     // Canonical worker identifier
        name: selectedWorkerName,      // Worker name for display
        MUser: managerUid,        // Manager UID
        ...(clientId && { clientId }),
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
      setNewJob({ title: '', description: '', location: '', clientName: '', clientPhone: '' });
      setSelectedWorker(null);
      setSelectedWorkerName('');
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
        {/* Workers List */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>{t.selectWorker}</Text>
          
          {!selectedWorker && (
            <SearchInput
              placeholder={t.searchWorker}
              value={searchQuery}
              onChangeText={setSearchQuery}
              colors={themeColors}
            />
          )}
          
          <View style={[styles.workersListContainer, { backgroundColor: themeColors.surface }]}>
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
                        setSearchQuery(''); // Clear search when deselecting
                        setNewJob({ title: '', description: '', location: '', clientName: '', clientPhone: '', clientEmail: '', clientAddress: '' });
                      } else {
                        // Select new worker, clear form, and hide other workers
                        setSelectedWorker(worker.uid);
                        setSelectedWorkerName(worker.name || worker.email);
                        setNewJob({ title: '', description: '', location: '', clientName: '', clientPhone: '', clientEmail: '', clientAddress: '' });
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
                          {worker.name || worker.email}
                        </Text>
                        <Text style={[styles.workerEmail, { color: themeColors.textSecondary }]}>
                          {worker.email}
                        </Text>
                        {worker.phoneNumber && (
                          <Text style={[styles.workerPhone, { color: themeColors.textLight }]}>
                            📞 {worker.phoneNumber}
                          </Text>
                        )}
                      </View>
                      {isSelected ? (
                        <View style={styles.selectedWorkerActions}>
                          <Ionicons name="checkmark-circle" size={32} color={themeColors.secondary} />
                          <Text style={[styles.tapToChangeText, { color: themeColors.textLight }]}>
                            {language === 'en' ? 'Tap to change' : language === 'he' ? 'לחץ לשינוי' : 'اضغط للتغيير'}
                          </Text>
                        </View>
                      ) : (
                        <Ionicons name="chevron-forward" size={24} color={themeColors.textLight} />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
          </View>
        </View>

        {/* Job Form */}
        {selectedWorker && (
          <View style={styles.section}>
            <View style={styles.jobDetailsHeader}>
              <MaterialCommunityIcons name="clipboard-text" size={24} color={themeColors.secondary} />
              <Text style={[styles.sectionTitle, { color: themeColors.textPrimary, marginBottom: 0, marginLeft: 8 }]}>
                {t.jobDetails}
              </Text>
            </View>
            
            <View style={[styles.formContainer, { backgroundColor: themeColors.surface }]}>
              {/* Assigned to badge */}
              <View style={styles.assignedToBadge}>
                <LinearGradient colors={gradients.secondary} style={styles.assignedToBadgeGradient}>
                  <MaterialCommunityIcons name="account-check" size={20} color="white" />
                  <Text style={styles.assignedToBadgeText}>
                    {t.assignedTo}: {selectedWorkerName}
                  </Text>
                </LinearGradient>
              </View>

              {/* Client Information - search + manual fields together */}
              <View style={[styles.clientSection, { backgroundColor: themeColors.backgroundLight, borderColor: themeColors.border }]}>
                <View style={styles.inputLabelRow}>
                  <Ionicons name="person" size={20} color={themeColors.secondary} />
                  <Text style={[styles.inputLabel, { color: themeColors.textSecondary, fontWeight: 'bold' }]}>
                    {t.clientName}
                  </Text>
                </View>

                {/* Embedded client selector (search + dropdown) */}
                <ClientSelector
                  clients={cachedClients}
                  onSelect={(client) => {
                    setSelectedClientObj(client);
                    setNewJob(prev => ({
                      ...prev,
                      clientName: client.name || '',
                      clientPhone: client.phone || '',
                      clientEmail: client.email || '',
                      clientAddress: client.address || '',
                    }));
                  }}
                  selectedClient={selectedClientObj}
                  onClear={() => {
                    setSelectedClientObj(null);
                    setNewJob(prev => ({ ...prev, clientName: '', clientPhone: '', clientEmail: '', clientAddress: '' }));
                  }}
                  colors={themeColors}
                  language={language}
                />

                {/* Client fields - always visible, pre-filled when client selected */}
                <TextInput
                  style={[styles.input, { 
                    backgroundColor: themeColors.surface, 
                    borderColor: newJob.clientName ? themeColors.secondary : themeColors.border,
                    color: themeColors.textPrimary 
                  }]}
                  placeholder={t.clientName + ' *'}
                  placeholderTextColor={themeColors.textLight}
                  value={newJob.clientName}
                  onChangeText={(text) => setNewJob({ ...newJob, clientName: text })}
                />
                <TextInput
                  style={[styles.input, { 
                    backgroundColor: themeColors.surface, 
                    borderColor: newJob.clientPhone ? themeColors.secondary : themeColors.border,
                    color: themeColors.textPrimary 
                  }]}
                  placeholder={t.clientPhone}
                  placeholderTextColor={themeColors.textLight}
                  value={newJob.clientPhone}
                  onChangeText={(text) => setNewJob({ ...newJob, clientPhone: text })}
                  keyboardType="phone-pad"
                />
                <TextInput
                  style={[styles.input, { 
                    backgroundColor: themeColors.surface, 
                    borderColor: newJob.clientEmail ? themeColors.secondary : themeColors.border,
                    color: themeColors.textPrimary 
                  }]}
                  placeholder={t.clientEmail}
                  placeholderTextColor={themeColors.textLight}
                  value={newJob.clientEmail}
                  onChangeText={(text) => setNewJob({ ...newJob, clientEmail: text })}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <TextInput
                  style={[styles.input, { 
                    backgroundColor: themeColors.surface, 
                    borderColor: newJob.clientAddress ? themeColors.secondary : themeColors.border,
                    color: themeColors.textPrimary 
                  }]}
                  placeholder={t.clientAddress}
                  placeholderTextColor={themeColors.textLight}
                  value={newJob.clientAddress}
                  onChangeText={(text) => setNewJob({ ...newJob, clientAddress: text })}
                />
              </View>

              <View style={styles.inputWrapper}>
                <View style={styles.inputLabelRow}>
                  <MaterialCommunityIcons name="format-title" size={20} color={themeColors.secondary} />
                  <Text style={[styles.inputLabel, { color: themeColors.textSecondary }]}>
                    {t.jobTitle} *
                  </Text>
                </View>
                <TextInput
                  style={[styles.input, { 
                    backgroundColor: themeColors.backgroundLight, 
                    borderColor: newJob.title ? themeColors.secondary : themeColors.border,
                    color: themeColors.textPrimary 
                  }]}
                  placeholder={t.jobTitle}
                  placeholderTextColor={themeColors.textLight}
                  value={newJob.title}
                  onChangeText={(text) => setNewJob({ ...newJob, title: text })}
                />
              </View>
              
              <View style={styles.inputWrapper}>
                <View style={styles.inputLabelRow}>
                  <MaterialCommunityIcons name="text" size={20} color={themeColors.secondary} />
                  <Text style={[styles.inputLabel, { color: themeColors.textSecondary }]}>
                    {t.description} *
                  </Text>
                </View>
                <TextInput
                  style={[styles.input, styles.textArea, { 
                    backgroundColor: themeColors.backgroundLight, 
                    borderColor: newJob.description ? themeColors.secondary : themeColors.border,
                    color: themeColors.textPrimary 
                  }]}
                  placeholder={t.description}
                  placeholderTextColor={themeColors.textLight}
                  value={newJob.description}
                  onChangeText={(text) => setNewJob({ ...newJob, description: text })}
                  multiline
                  numberOfLines={4}
                />
              </View>
              
              <View style={styles.inputWrapper}>
                <View style={styles.inputLabelRow}>
                  <MaterialCommunityIcons name="map-marker" size={20} color={themeColors.secondary} />
                  <Text style={[styles.inputLabel, { color: themeColors.textSecondary }]}>
                    {t.location} *
                  </Text>
                </View>
                <TextInput
                  style={[styles.input, { 
                    backgroundColor: themeColors.backgroundLight, 
                    borderColor: newJob.location ? themeColors.secondary : themeColors.border,
                    color: themeColors.textPrimary 
                  }]}
                  placeholder={t.location}
                  placeholderTextColor={themeColors.textLight}
                  value={newJob.location}
                  onChangeText={(text) => setNewJob({ ...newJob, location: text })}
                />
              </View>
              
              <View style={styles.formActions}>
                <TouchableOpacity
                  style={styles.cancelButtonWrapper}
                  onPress={() => {
                    setSelectedWorker(null);
                    setSelectedWorkerName('');
                    setSearchQuery(''); // Clear search when canceling
                    setSelectedClientObj(null);
                    setNewJob({ title: '', description: '', location: '', clientName: '', clientPhone: '', clientEmail: '', clientAddress: '' });
                  }}
                >
                  <View style={[styles.cancelButton, { borderColor: themeColors.border, backgroundColor: themeColors.background }]}>
                    <Ionicons name="close-circle-outline" size={20} color={themeColors.textSecondary} />
                    <Text style={[styles.cancelButtonText, { color: themeColors.textPrimary }]}>{t.cancel}</Text>
                  </View>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.submitButtonWrapper}
                  onPress={handleCreateJob}
                >
                  <LinearGradient colors={gradients.indigoBox} style={styles.submitButton}>
                    <Ionicons name="checkmark-circle" size={20} color="white" />
                    <Text style={styles.submitButtonText}>{t.submit}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
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
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  workersListContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
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
  workerPhone: {
    fontSize: typography.xs,
  },
  jobDetailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  formContainer: {
    backgroundColor: 'white',
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
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
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    borderWidth: 2,
  },
  cancelButtonText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  submitButtonWrapper: {
    flex: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
  },
  submitButtonText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.bold,
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
