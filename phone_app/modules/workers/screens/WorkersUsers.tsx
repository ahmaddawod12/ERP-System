import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { auth, functions, httpsCallable } from '../../../firebase';
import {
  borderRadius,
  getColors,
  shadows,
  spacing,
} from '../../../theme';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import type { Worker } from '../../../types';
import {
  AppButton,
  AppCard,
  AppChip,
  AppEmptyState,
  AppInput,
  AppText,
  GlobalHeader,
  LoadingSpinner,
} from '../../../components';
import { fetchCompanyWorkers } from '../../../utils/read-model';

const translations = {
  en: {
    title: 'Team Workers',
    subtitle: 'Create and manage worker accounts',
    addWorker: 'Add Worker',
    editWorker: 'Edit Worker',
    name: 'Name',
    email: 'Email',
    password: 'Password',
    phoneNumber: 'Phone Number',
    role: 'Role',
    submit: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    noWorkers: 'No workers yet',
    fillAllFields: 'Please fill all required fields.',
    invalidEmail: 'Invalid worker email format.',
    shortPassword: 'Password must be at least 8 characters.',
    workerAdded: 'Worker added successfully.',
    workerUpdated: 'Worker updated successfully.',
    workerDeleted: 'Worker deleted successfully.',
    confirmDelete: 'Are you sure you want to delete this worker?',
    loading: 'Loading workers...',
    worker: 'Worker',
  },
  he: {
    title: 'עובדי צוות',
    subtitle: 'יצירה וניהול חשבונות עובדים',
    addWorker: 'הוסף עובד',
    editWorker: 'ערוך עובד',
    name: 'שם',
    email: 'אימייל',
    password: 'סיסמה',
    phoneNumber: 'מספר טלפון',
    role: 'תפקיד',
    submit: 'שמור',
    cancel: 'ביטול',
    delete: 'מחק',
    edit: 'ערוך',
    noWorkers: 'אין עובדים עדיין',
    fillAllFields: 'יש למלא את כל השדות הנדרשים.',
    invalidEmail: 'כתובת אימייל לא תקינה.',
    shortPassword: 'הסיסמה חייבת להכיל 8 תווים לפחות.',
    workerAdded: 'העובד נוסף בהצלחה.',
    workerUpdated: 'העובד עודכן בהצלחה.',
    workerDeleted: 'העובד נמחק בהצלחה.',
    confirmDelete: 'האם אתה בטוח שברצונך למחוק עובד זה?',
    loading: 'טוען עובדים...',
    worker: 'עובד',
  },
  ar: {
    title: 'عمال الفريق',
    subtitle: 'إنشاء وإدارة حسابات العمال',
    addWorker: 'إضافة عامل',
    editWorker: 'تعديل عامل',
    name: 'الاسم',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    phoneNumber: 'رقم الهاتف',
    role: 'الدور',
    submit: 'حفظ',
    cancel: 'إلغاء',
    delete: 'حذف',
    edit: 'تعديل',
    noWorkers: 'لا يوجد عمال بعد',
    fillAllFields: 'يرجى ملء جميع الحقول المطلوبة.',
    invalidEmail: 'صيغة البريد الإلكتروني غير صالحة.',
    shortPassword: 'يجب أن تكون كلمة المرور 8 أحرف على الأقل.',
    workerAdded: 'تمت إضافة العامل بنجاح.',
    workerUpdated: 'تم تحديث العامل بنجاح.',
    workerDeleted: 'تم حذف العامل بنجاح.',
    confirmDelete: 'هل أنت متأكد من حذف هذا العامل؟',
    loading: 'جاري تحميل العمال...',
    worker: 'عامل',
  },
};

const initialNewWorker = { email: '', password: '', phoneNumber: '', name: '' };

const normalizeEmail = (value: string) => (value || '').trim().toLowerCase();
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export default function WorkersUsers() {
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const palette = getColors(isDarkMode);
  const t = translations[language] || translations.en;
  const {
    getCompanyId,
    workers: cachedWorkersList,
    updateWorkers,
    addWorker,
    editWorker,
    deleteWorker,
  } = useCache();

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [newWorker, setNewWorker] = useState(initialNewWorker);
  const [editingWorker, setEditingWorker] = useState<(Worker & { password?: string }) | null>(null);

  const hasCachedWorkers = useMemo(
    () => cachedWorkersList && Object.keys(cachedWorkersList).length > 0,
    [cachedWorkersList]
  );

  useEffect(() => {
    loadWorkers();
  }, []);

  useEffect(() => {
    if (hasCachedWorkers) {
      loadWorkers();
    }
  }, [hasCachedWorkers]);

  const loadWorkers = async () => {
    try {
      setLoading(true);
      const user = auth.currentUser;
      if (!user) return;

      const companyId = getCompanyId();
      if (!companyId) return;

      if (cachedWorkersList && Object.keys(cachedWorkersList).length > 0) {
        const workersList = Object.keys(cachedWorkersList).map((docKey) => {
          const worker = cachedWorkersList[docKey] || {};
          return {
            uid: worker.uid || docKey,
            wid: worker.wid || docKey,
            email: worker.email || '',
            phoneNumber: worker.phoneNumber || '',
            name: worker.name || '',
          };
        });
        setWorkers(workersList);
        return;
      }

      const fetchedWorkers = await fetchCompanyWorkers(companyId);
      const workersData: Record<string, Worker> = {};
      const workersList = fetchedWorkers
        .filter((worker): worker is Worker & { email: string } => Boolean(worker.email))
        .map((worker) => {
          const wid = String(worker.wid || worker.uid);
          workersData[wid] = worker;
          return worker;
        });

      setWorkers(workersList);
      await updateWorkers(workersData);
    } catch (error) {
      console.error('WorkersUsers loadWorkers error:', error);
      alert.error('Error', error instanceof Error ? error.message : 'Failed to load workers.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddWorker = async () => {
    if (!newWorker.email || !newWorker.name) {
      alert.error('Error', t.fillAllFields);
      return;
    }

    const email = normalizeEmail(newWorker.email);
    if (!isValidEmail(email)) {
      alert.error('Error', t.invalidEmail);
      return;
    }

    try {
      setLoading(true);
      const user = auth.currentUser;
      if (!user) {
        alert.error('Error', 'User not authenticated.');
        return;
      }

      await user.getIdToken(true);
      const companyId = getCompanyId();
      if (!companyId) {
        alert.error('Error', 'Company ID not found.');
        return;
      }

      const manageWorkerFn = httpsCallable(functions, 'manageWorker');
      const result = await manageWorkerFn({
        action: 'add',
        email,
        name: newWorker.name.trim(),
        phoneNumber: newWorker.phoneNumber || '',
        companyId,
      });

      const workerUid = (result?.data as { uid?: string; wid?: string } | undefined)?.uid;
      const workerWid = (result?.data as { uid?: string; wid?: string } | undefined)?.wid;
      if (!workerUid || !workerWid) {
        throw new Error('Worker UID or wid was not returned from backend.');
      }

      await addWorker(workerWid, {
        uid: workerUid,
        wid: workerWid,
        email,
        name: newWorker.name.trim(),
        phoneNumber: newWorker.phoneNumber || '',
        role: 'worker',
        companyId,
      });

      setShowAddModal(false);
      setNewWorker(initialNewWorker);
      alert.success('Success', t.workerAdded);
      await loadWorkers();
    } catch (error) {
      console.error('WorkersUsers handleAddWorker error:', error);
      alert.error('Error', error instanceof Error ? error.message : 'Failed to add worker.');
    } finally {
      setLoading(false);
    }
  };

  const handleEditWorker = async () => {
    if (!editingWorker?.email) {
      alert.error('Error', t.fillAllFields);
      return;
    }

    try {
      setLoading(true);
      const user = auth.currentUser;
      if (!user) {
        alert.error('Error', 'User not authenticated.');
        return;
      }

      await user.getIdToken(true);
      const companyId = getCompanyId();
      if (!companyId) {
        alert.error('Error', 'Company ID not found.');
        return;
      }

      const payload = {
        action: 'edit',
        email: normalizeEmail(editingWorker.email),
        name: editingWorker.name?.trim(),
        phoneNumber: editingWorker.phoneNumber || '',
        companyId,
        workerUid: editingWorker.uid,
        wid: editingWorker.wid,
      };

      const manageWorkerFn = httpsCallable(functions, 'manageWorker');
      await manageWorkerFn(payload);

      await editWorker(String(editingWorker.wid), {
        name: editingWorker.name?.trim() || '',
        phoneNumber: editingWorker.phoneNumber || '',
      });

      setShowEditModal(false);
      setEditingWorker(null);
      alert.success('Success', t.workerUpdated);
      await loadWorkers();
    } catch (error) {
      console.error('WorkersUsers handleEditWorker error:', error);
      alert.error('Error', error instanceof Error ? error.message : 'Failed to edit worker.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWorker = (worker: Worker) => {
    alert.confirm('Confirm Delete', t.confirmDelete, [
      { text: t.cancel, style: 'cancel', onPress: () => {} },
      {
        text: t.delete,
        style: 'destructive',
        onPress: async () => {
          try {
            setLoading(true);
            const user = auth.currentUser;
            if (!user) {
              alert.error('Error', 'User not authenticated.');
              return;
            }

            await user.getIdToken(true);
            const companyId = getCompanyId();
            if (!companyId) {
              alert.error('Error', 'Company ID not found.');
              return;
            }

            const manageWorkerFn = httpsCallable(functions, 'manageWorker');
            await manageWorkerFn({
              action: 'delete',
              email: normalizeEmail(worker.email || ''),
              companyId,
              workerUid: worker.uid,
              wid: String(worker.wid),
            });

            await deleteWorker(String(worker.wid));
            alert.success('Success', t.workerDeleted);
            await loadWorkers();
          } catch (error) {
            console.error('WorkersUsers handleDeleteWorker error:', error);
            alert.error('Error', error instanceof Error ? error.message : 'Failed to delete worker.');
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  };

  const renderWorker = ({ item }: { item: Worker }) => (
    <AppCard style={styles.workerCard}>
      <View style={styles.workerTopRow}>
        <View style={[styles.avatar, { backgroundColor: `${palette.secondary}20` }]}>
          <MaterialCommunityIcons name="account-outline" size={24} color={palette.secondary} />
        </View>
        <View style={styles.workerInfo}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {item.name || item.email}
          </AppText>
          <AppText variant="caption" color={palette.textSecondary} numberOfLines={1}>
            {item.email}
          </AppText>
          {item.phoneNumber ? (
            <AppText variant="caption" color={palette.textLight}>
              {item.phoneNumber}
            </AppText>
          ) : null}
        </View>
        <AppChip label={t.worker} status="active" size="sm" />
      </View>

      <View style={styles.workerActions}>
        <AppButton
          title={t.edit}
          variant="secondary"
          iconLeft={{ name: 'create-outline' }}
          onPress={() => {
            setEditingWorker({ ...item, password: '' });
            setShowEditModal(true);
          }}
          style={styles.workerActionBtn}
        />
        <AppButton
          title={t.delete}
          variant="destructive"
          iconLeft={{ name: 'trash-outline' }}
          onPress={() => handleDeleteWorker(item)}
          style={styles.workerActionBtn}
        />
      </View>
    </AppCard>
  );

  interface WorkerFormData {
    name: string;
    email: string;
    phoneNumber: string;
    password?: string;
  }

  const renderWorkerForm = ({ mode }: { mode: 'add' | 'edit' }) => {
    const isEdit = mode === 'edit';
    const data: WorkerFormData | null = isEdit
      ? (editingWorker as WorkerFormData | null)
      : newWorker;
    const onSubmit = isEdit ? handleEditWorker : handleAddWorker;

    if (!data) return null;

    const updateData = (patch: Partial<WorkerFormData>) => {
      if (isEdit) {
        setEditingWorker((prev) => (prev ? { ...prev, ...patch } : prev));
      } else {
        setNewWorker((prev) => ({ ...prev, ...patch }));
      }
    };

    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.modalOverlay, { backgroundColor: palette.overlay }]}
      >
        <AppCard style={styles.modalCard}>
          <AppText variant="heading">{isEdit ? t.editWorker : t.addWorker}</AppText>
          <AppInput
            label={t.name}
            value={data.name}
            onChangeText={(value) => updateData({ name: value })}
            placeholder="Full name"
            autoFocus
          />
          <AppInput
            label={t.email}
            value={data.email}
            onChangeText={(value) => updateData({ email: value })}
            placeholder="worker@company.com"
            keyboardType="email-address"
            autoCapitalize="none"
            editable={!isEdit}
          />
          <AppText variant="caption" style={{ color: palette.textSecondary }}>
            Workers claim or reset their own password from the login screen.
          </AppText>
          <AppInput
            label={t.phoneNumber}
            value={data.phoneNumber}
            onChangeText={(value) => updateData({ phoneNumber: value })}
            placeholder="+972..."
            keyboardType="phone-pad"
          />
          <View style={styles.modalActions}>
            <AppButton
              title={t.cancel}
              variant="secondary"
              onPress={() => {
                if (isEdit) {
                  setShowEditModal(false);
                  setEditingWorker(null);
                } else {
                  setShowAddModal(false);
                  setNewWorker(initialNewWorker);
                }
              }}
              style={styles.modalButton}
            />
            <AppButton title={t.submit} onPress={onSubmit} style={styles.modalButton} />
          </View>
        </AppCard>
      </KeyboardAvoidingView>
    );
  };

  if (loading && workers.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: palette.background }]}>
        <StatusBar style={isDarkMode ? 'light' : 'dark'} />
        <View style={styles.loadingWrap}>
          <LoadingSpinner text={t.loading} />
        </View>
        <GlobalHeader />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />

      <FlatList
        data={workers}
        keyExtractor={(item) => String(item.wid)}
        renderItem={renderWorker}
        contentContainerStyle={{
          paddingTop: Platform.OS === 'ios' ? 108 : 96,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.xxxl + 80,
          flexGrow: workers.length === 0 ? 1 : 0,
        }}
        ListHeaderComponent={
          <View style={styles.headerSection}>
            <AppText variant="title">{t.title}</AppText>
            <AppText variant="caption" color={palette.textSecondary}>
              {t.subtitle}
            </AppText>
            <AppButton
              title={t.addWorker}
              iconLeft={{ name: 'add-circle-outline' }}
              onPress={() => setShowAddModal(true)}
              style={styles.addButton}
            />
          </View>
        }
        ListEmptyComponent={
          <AppEmptyState
            icon="account-group-outline"
            title={t.noWorkers}
            action={<AppButton title={t.addWorker} onPress={() => setShowAddModal(true)} />}
          />
        }
      />

      <Modal visible={showAddModal} transparent animationType="fade" onRequestClose={() => setShowAddModal(false)}>
        {renderWorkerForm({ mode: 'add' })}
      </Modal>

      <Modal visible={showEditModal} transparent animationType="fade" onRequestClose={() => setShowEditModal(false)}>
        {renderWorkerForm({ mode: 'edit' })}
      </Modal>

      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSection: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  addButton: {
    marginTop: spacing.xs,
  },
  workerCard: {
    marginBottom: spacing.md,
    ...shadows.card,
  },
  workerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workerInfo: {
    flex: 1,
    gap: 2,
  },
  workerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  workerActionBtn: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 460,
    gap: spacing.sm,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  modalButton: {
    flex: 1,
  },
});

