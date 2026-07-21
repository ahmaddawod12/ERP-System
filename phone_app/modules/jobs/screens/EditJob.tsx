import { useState } from 'react';
import { View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
 } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { updateJob as updateJobApi } from '../lib/jobs-api';
import { getColors, spacing, borderRadius, typography, shadows } from '../../../theme';
import { AppText, AppInput, GlobalHeader, ScrollableContainer } from '../../../components';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { safeJsonParse } from '../../../utils/helpers';
import type { Job } from '../../../types';
import { logger } from '../../../utils/logger';

export default function EditJob() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { getCompanyId, getUid, updateJob } = useCache();
  const colors = getColors(isDarkMode);

  const job = safeJsonParse(params.job) as Job | null;

  const [isSaving, setIsSaving] = useState(false);
  const [editingJob, setEditingJob] = useState<Job>(job || {
    id: '',
    title: '',
    description: '',
    location: '',
    status: 'pending',
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
      setIsSaving(true);
      alert.loading('Saving', 'Updating job details...');

      const companyIdStr = getCompanyId();
      const uid = getUid();

      if (!companyIdStr) {
        setIsSaving(false);
        alert.error('Error', 'Company name not found in profile');
        return;
      }
      if (!uid) {
        setIsSaving(false);
        alert.error('Error', 'User session not found');
        return;
      }
      if (!editingJob.entityVersion) {
        setIsSaving(false);
        alert.error('Error', 'The job version is missing. Reload the list and try again.');
        return;
      }

      const companyId = Number(companyIdStr);
      if (!Number.isSafeInteger(companyId) || companyId <= 0) {
        setIsSaving(false);
        alert.error('Error', 'Company ID is invalid');
        return;
      }

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
      };

      const statusForApi = editingJob.status === 'pending' || editingJob.status === 'waiting' || editingJob.status === 'denied'
        ? editingJob.status
        : undefined;

      await updateJobApi({
        uid,
        companyId,
        jobId: String(editingJob.id),
        request: {
          entityVersion: editingJob.entityVersion,
          title: editingJob.title || undefined,
          description: editingJob.description || undefined,
          location: editingJob.location || undefined,
          status: statusForApi,
        },
        idempotencyKey: randomUUID(),
      });

      await updateJob(editingJob.id, jobUpdates);

      setIsSaving(false);
      alert.hideLoading();

      alert.success('Success', 'Job updated successfully', [
        {
          text: 'OK',
          onPress: () => router.back()
        }
      ]);

    } catch (error) {
      logger.error('Error updating job:', error);
      setIsSaving(false);
      alert.hideLoading();

      alert.error('Error', 'Failed to update job: ' + (error instanceof Error ? error.message : String(error)));
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
            <AppInput
              label={t.title}
              value={editingJob.title}
              onChangeText={(text) => setEditingJob({ ...editingJob, title: text })}
              placeholder={t.title}
            />

            <AppInput
              label={t.description}
              value={editingJob.description}
              onChangeText={(text) => setEditingJob({ ...editingJob, description: text })}
              placeholder={t.description}
              multiline
              numberOfLines={4}
            />

            <AppInput
              label={t.location}
              value={editingJob.location}
              onChangeText={(text) => setEditingJob({ ...editingJob, location: text })}
              placeholder={t.location}
            />

            <AppInput
              label={t.timeFrom}
              value={editingJob.timeFrom}
              onChangeText={(text) => setEditingJob({ ...editingJob, timeFrom: text })}
              placeholder="HH:MM"
            />

            <AppInput
              label={t.timeTo}
              value={editingJob.timeTo}
              onChangeText={(text) => setEditingJob({ ...editingJob, timeTo: text })}
              placeholder="HH:MM"
            />

            <AppInput
              label={t.clientName}
              value={editingJob.cname}
              onChangeText={(text) => setEditingJob({ ...editingJob, cname: text })}
              placeholder={t.clientName}
            />

            <AppInput
              label={t.clientPhone}
              value={editingJob.cphone}
              onChangeText={(text) => setEditingJob({ ...editingJob, cphone: text })}
              placeholder={t.clientPhone}
              keyboardType="phone-pad"
            />

            <AppInput
              label={t.signingPerson}
              value={editingJob.signingPerson}
              onChangeText={(text) => setEditingJob({ ...editingJob, signingPerson: text })}
              placeholder={t.signingPerson}
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







