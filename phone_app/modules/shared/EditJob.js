import React, { useState, useEffect } from 'react';
import { View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
 } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { db, doc, getDoc, updateDoc, functions, httpsCallable } from '../../firebase';
import { getColors, spacing, borderRadius, typography, shadows } from '../../theme';
import { AppText, GlobalHeader, ScrollableContainer } from '../../components';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAlert } from '../../contexts/AlertContext';
import { useCache } from '../../contexts/CacheContext';
import { safeJsonParse } from '../../utils/helpers';

export default function EditJob() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { getCompanyId, updateJob, workers: cachedWorkersList } = useCache();
  const colors = getColors(isDarkMode);

  const job = safeJsonParse(params.job);
  
  const [isSaving, setIsSaving] = useState(false);
  const [editingJob, setEditingJob] = useState(job || {
    title: '',
    description: '',
    location: '',
    status: '',
    timeFrom: '',
    timeTo: '',
    cname: '',
    cphone: '',
    signingPerson: '',
    partsUsed: [],
  });

  const t = language === 'en' ? {
    editJob: 'Edit Job',
    title: 'Job Title',
    description: 'Description',
    location: 'Location',
    status: 'Status',
    timeFrom: 'Time From',
    timeTo: 'Time To',
    clientName: 'Client Name',
    clientPhone: 'Client Phone',
    signingPerson: 'Signing Person',
    partsUsed: 'Parts Used',
    save: 'Save Changes',
    cancel: 'Cancel',
    saving: 'Saving...',
  } : language === 'he' ? {
    editJob: 'ערוך משימה',
    title: 'כותרת משימה',
    description: 'תיאור',
    location: 'מיקום',
    status: 'סטטוס',
    timeFrom: 'זמן התחלה',
    timeTo: 'זמן סיום',
    clientName: 'שם לקוח',
    clientPhone: 'טלפון לקוח',
    signingPerson: 'אדם חותם',
    partsUsed: 'חלקים בשימוש',
    save: 'שמור שינויים',
    cancel: 'ביטול',
    saving: 'שומר...',
  } : {
    editJob: 'تعديل المهمة',
    title: 'عنوان المهمة',
    description: 'الوصف',
    location: 'الموقع',
    status: 'الحالة',
    timeFrom: 'وقت البدء',
    timeTo: 'وقت الانتهاء',
    clientName: 'اسم العميل',
    clientPhone: 'هاتف العميل',
    signingPerson: 'الشخص الموقع',
    partsUsed: 'القطع المستخدمة',
    save: 'حفظ التغييرات',
    cancel: 'إلغاء',
    saving: 'جاري الحفظ...',
  };

  const handleSave = async () => {
    if (!editingJob || !editingJob.id) {
      alert.error('Error', 'No job selected for editing');
      return;
    }

    try {
      // Show loading alert and button state
      setIsSaving(true);
      alert.loading('Saving', 'Updating job details...');
      
      const companyId = getCompanyId();
      
      if (!companyId) {
        setIsSaving(false);
        alert.error('Error', 'Company name not found in profile');
        return;
      }

      // All jobs are in the unified 'jobs' collection
      const jobRef = doc(db, 'companies', companyId, 'jobs', editingJob.id);

      // Get worker uid from wid for inventory access
      const workerWid = editingJob.wid;
      const workerEntry = cachedWorkersList ? cachedWorkersList[workerWid] : null;
      const workerId = workerEntry?.uid || null;
      
      // Fetch the CURRENT job data from Firestore to get actual original parts
      if (workerId && editingJob.partsUsed) {
        const currentJobSnap = await getDoc(jobRef);
        if (currentJobSnap.exists()) {
          const currentJobData = currentJobSnap.data();
          const originalPartsInFirestore = currentJobData.partsUsed || [];
          
          // Calculate inventory changes
          const inventoryRef = doc(db, 'users', workerId, 'data', 'inventory');
          const inventorySnap = await getDoc(inventoryRef);
          
          if (inventorySnap.exists()) {
            const inventoryData = inventorySnap.data();
            let parts = inventoryData.parts;

            // First, add back quantities for parts that were removed
            originalPartsInFirestore.forEach(originalPart => {
              const stillInJob = editingJob.partsUsed.find(p => p.id === originalPart.id || p.name === originalPart.name);
              if (!stillInJob) {
                // Part was removed from job, add it back to inventory
                const originalQty = parseInt(originalPart.quantity) || 0;
                
                if (Array.isArray(parts)) {
                  const partIndex = parts.findIndex(p => p.id === originalPart.id || p.name === originalPart.name);
                  if (partIndex !== -1) {
                    parts[partIndex].quantity = (parts[partIndex].quantity || 0) + originalQty;
                  }
                } else if (typeof parts === 'object') {
                  const partKey = originalPart.name;
                  if (parts[partKey]) {
                    parts[partKey].quantity = (parts[partKey].quantity || 0) + originalQty;
                  }
                }
              }
            });

            // Then, handle quantity changes for parts still in the job
            editingJob.partsUsed.forEach(currentPart => {
              const originalPart = originalPartsInFirestore.find(p => p.id === currentPart.id || p.name === currentPart.name);
              const originalQty = originalPart ? (parseInt(originalPart.quantity) || 0) : 0;
              const currentQty = parseInt(currentPart.quantity) || 0;
              const difference = currentQty - originalQty;

              if (difference !== 0) {
                // Handle both array and object formats
                if (Array.isArray(parts)) {
                  const partIndex = parts.findIndex(p => p.id === currentPart.id || p.name === currentPart.name);
                  if (partIndex !== -1) {
                    parts[partIndex].quantity = Math.max(0, (parts[partIndex].quantity || 0) - difference);
                  }
                } else if (typeof parts === 'object') {
                  const partKey = currentPart.name;
                  if (parts[partKey]) {
                    parts[partKey].quantity = Math.max(0, (parts[partKey].quantity || 0) - difference);
                  }
                }
              }
            });

            // Clean up: remove parts with NaN or invalid quantities before saving
            if (Array.isArray(parts)) {
              parts = parts.filter(part => {
                const qty = parseInt(part.quantity);
                return !isNaN(qty) && qty >= 0;
              });
            } else if (typeof parts === 'object') {
              // Remove keys with NaN values
              Object.keys(parts).forEach(key => {
                const qty = parseInt(parts[key].quantity);
                if (isNaN(qty) || qty < 0) {
                  delete parts[key];
                }
              });
            }

            // P2-2: Route inventory mutation through Cloud Function
            const updateInvFn = httpsCallable(functions, 'updateInventoryV1');
            await updateInvFn({ companyId, action: 'replaceParts', scope: 'user', targetUid: workerId, parts });
          }
        }
      }

      // Update the job document AFTER inventory is updated
      const jobUpdates = {
        title: editingJob.title,
        description: editingJob.description,
        location: editingJob.location,
        status: editingJob.status,
        timeFrom: editingJob.timeFrom || '',
        timeTo: editingJob.timeTo || '',
        cname: editingJob.cname || '',
        cphone: editingJob.cphone || '',
        signingPerson: editingJob.signingPerson || '',
        partsUsed: editingJob.partsUsed || [],
      };
      // P2-2: Update the job document via Cloud Function
      const updateJobFn = httpsCallable(functions, 'updateJobV1');
      await updateJobFn({ companyId, jobId: editingJob.id, ...jobUpdates });
      
      // Update cache with document-level versioning
      const isPending = statusLower !== 'finished';
      await updateJob(editingJob.id, jobUpdates, isPending);

      // Success! Reset saving state and hide loading
      setIsSaving(false);
      alert.hideLoading();
      
      // Show success alert with OK button to navigate back
      alert.success('Success', 'Job updated successfully', [
        {
          text: 'OK',
          onPress: () => router.back()
        }
      ]);
      
    } catch (error) {
      console.error('Error updating job:', error);
      setIsSaving(false);
      alert.hideLoading();
      
      // Show error alert
      alert.error('Error', 'Failed to update job: ' + error.message);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollableContainer style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {/* Header */}
          <View style={[styles.header, { backgroundColor: colors.surface }]}>
            <AppText style={[styles.headerTitle, { color: colors.textPrimary }]}>
              {t.editJob}
            </AppText>
          </View>

          {/* Form Fields */}
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <AppText style={[styles.label, { color: colors.textSecondary }]}>{t.title}</AppText>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              value={editingJob.title}
              onChangeText={(text) => setEditingJob({ ...editingJob, title: text })}
              placeholder={t.title}
              placeholderTextColor={colors.textSecondary}
            />

            <AppText style={[styles.label, { color: colors.textSecondary }]}>{t.description}</AppText>
            <TextInput
              style={[styles.input, styles.textArea, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              value={editingJob.description}
              onChangeText={(text) => setEditingJob({ ...editingJob, description: text })}
              placeholder={t.description}
              placeholderTextColor={colors.textSecondary}
              multiline
              numberOfLines={4}
            />

            <AppText style={[styles.label, { color: colors.textSecondary }]}>{t.location}</AppText>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              value={editingJob.location}
              onChangeText={(text) => setEditingJob({ ...editingJob, location: text })}
              placeholder={t.location}
              placeholderTextColor={colors.textSecondary}
            />

            <AppText style={[styles.label, { color: colors.textSecondary }]}>{t.timeFrom}</AppText>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              value={editingJob.timeFrom}
              onChangeText={(text) => setEditingJob({ ...editingJob, timeFrom: text })}
              placeholder="HH:MM"
              placeholderTextColor={colors.textSecondary}
            />

            <AppText style={[styles.label, { color: colors.textSecondary }]}>{t.timeTo}</AppText>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              value={editingJob.timeTo}
              onChangeText={(text) => setEditingJob({ ...editingJob, timeTo: text })}
              placeholder="HH:MM"
              placeholderTextColor={colors.textSecondary}
            />

            <AppText style={[styles.label, { color: colors.textSecondary }]}>{t.clientName}</AppText>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              value={editingJob.cname}
              onChangeText={(text) => setEditingJob({ ...editingJob, cname: text })}
              placeholder={t.clientName}
              placeholderTextColor={colors.textSecondary}
            />

            <AppText style={[styles.label, { color: colors.textSecondary }]}>{t.clientPhone}</AppText>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              value={editingJob.cphone}
              onChangeText={(text) => setEditingJob({ ...editingJob, cphone: text })}
              placeholder={t.clientPhone}
              placeholderTextColor={colors.textSecondary}
              keyboardType="phone-pad"
            />

            <AppText style={[styles.label, { color: colors.textSecondary }]}>{t.signingPerson}</AppText>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
              value={editingJob.signingPerson}
              onChangeText={(text) => setEditingJob({ ...editingJob, signingPerson: text })}
              placeholder={t.signingPerson}
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={() => router.back()}
            >
              <AppText style={styles.cancelButtonText}>{t.cancel}</AppText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.saveButton, isSaving && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={isSaving}
            >
              <LinearGradient
                colors={['#10B981', '#059669']}
                style={styles.saveGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <MaterialCommunityIcons name="content-save" size={20} color="white" />
                <AppText style={styles.saveButtonText}>{t.save}</AppText>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </ScrollableContainer>
      </KeyboardAvoidingView>

      <GlobalHeader />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 100,
  },
  header: {
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  headerTitle: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    textAlign: 'center',
  },
  card: {
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  label: {
    fontSize: typography.md,
    fontWeight: typography.semibold,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: typography.md,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  button: {
    flex: 1,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  cancelButton: {
    backgroundColor: '#6B7280',
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    color: 'white',
    fontSize: typography.md,
    fontWeight: typography.semibold,
  },
  saveButton: {
    overflow: 'hidden',
  },
  saveGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  saveButtonText: {
    color: 'white',
    fontSize: typography.md,
    fontWeight: typography.semibold,
  },
});






