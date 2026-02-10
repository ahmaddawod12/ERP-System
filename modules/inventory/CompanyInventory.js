import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { auth, db, doc, onSnapshot, runTransaction } from '../../firebase';
import { getColors, gradients, spacing, borderRadius, typography, shadows } from '../../theme';
import { GlobalHeader, ScrollableContainer } from '../../components';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAlert } from '../../contexts/AlertContext';
import { useCache } from '../../contexts/CacheContext';

export default function CompanyInventory() {
  const router = useRouter();
  const [companyParts, setCompanyParts] = useState([]);
  const [showAddPart, setShowAddPart] = useState(false);
  const [newPartName, setNewPartName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(null);
  const [editName, setEditName] = useState('');
  const [filterActive, setFilterActive] = useState('all'); // 'all' | 'active' | 'disabled'
  const unsubscribeRef = useRef(null);

  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { getCompanyId } = useCache();
  const colors = getColors(isDarkMode);

  const t = language === 'en' ? {
    title: 'Company Parts',
    subtitle: 'Master parts list',
    addNewPart: 'Add New Part',
    partName: 'Part Name',
    add: 'Add',
    cancel: 'Cancel',
    searchParts: 'Search parts...',
    noPartsYet: 'No company parts yet.',
    addFirstPart: 'Add your first company part!',
    noResults: 'No parts found',
    partAdded: 'Part Added!',
    partAddedMsg: 'has been added to company parts',
    disable: 'Disable',
    enable: 'Enable',
    edit: 'Edit',
    rename: 'Rename Part',
    save: 'Save',
    partDisabled: 'Part Disabled',
    partDisabledMsg: 'has been disabled',
    partEnabled: 'Part Enabled',
    partEnabledMsg: 'has been enabled',
    partRenamed: 'Part Renamed!',
    partRenamedMsg: 'has been renamed successfully',
    confirmDisable: 'Disable Part?',
    confirmDisableMsg: 'Workers will no longer be able to add this part to their inventory.',
    confirmEnable: 'Enable Part?',
    confirmEnableMsg: 'Workers will be able to add this part to their inventory again.',
    active: 'Active',
    disabled: 'Disabled',
    all: 'All',
    fillPartName: 'Please enter a part name',
    duplicateName: 'A part with this name already exists',
    id: 'ID',
    status: 'Status',
    partCount: 'parts',
  } : language === 'he' ? {
    title: 'חלקי חברה',
    subtitle: 'רשימת חלקים ראשית',
    addNewPart: 'הוסף חלק חדש',
    partName: 'שם החלק',
    add: 'הוסף',
    cancel: 'ביטול',
    searchParts: 'חיפוש חלקים...',
    noPartsYet: 'אין חלקי חברה עדיין.',
    addFirstPart: 'הוסף את חלק החברה הראשון!',
    noResults: 'לא נמצאו חלקים',
    partAdded: 'החלק נוסף!',
    partAddedMsg: 'נוסף לחלקי החברה',
    disable: 'השבת',
    enable: 'הפעל',
    edit: 'עריכה',
    rename: 'שנה שם חלק',
    save: 'שמור',
    partDisabled: 'החלק הושבת',
    partDisabledMsg: 'הושבת',
    partEnabled: 'החלק הופעל',
    partEnabledMsg: 'הופעל',
    partRenamed: 'שם החלק שונה!',
    partRenamedMsg: 'שונה בהצלחה',
    confirmDisable: 'להשבית חלק?',
    confirmDisableMsg: 'עובדים לא יוכלו להוסיף חלק זה למלאי שלהם.',
    confirmEnable: 'להפעיל חלק?',
    confirmEnableMsg: 'עובדים יוכלו להוסיף חלק זה למלאי שלהם שוב.',
    active: 'פעיל',
    disabled: 'מושבת',
    all: 'הכל',
    fillPartName: 'אנא הזן שם חלק',
    duplicateName: 'חלק עם שם זה כבר קיים',
    id: 'מזהה',
    status: 'סטטוס',
    partCount: 'חלקים',
  } : {
    title: 'قطع الشركة',
    subtitle: 'قائمة القطع الرئيسية',
    addNewPart: 'إضافة قطعة جديدة',
    partName: 'اسم القطعة',
    add: 'إضافة',
    cancel: 'إلغاء',
    searchParts: 'بحث عن قطع...',
    noPartsYet: 'لا توجد قطع شركة بعد.',
    addFirstPart: 'أضف أول قطعة شركة!',
    noResults: 'لم يتم العثور على قطع',
    partAdded: 'تمت إضافة القطعة!',
    partAddedMsg: 'تمت إضافتها إلى قطع الشركة',
    disable: 'تعطيل',
    enable: 'تفعيل',
    edit: 'تعديل',
    rename: 'إعادة تسمية القطعة',
    save: 'حفظ',
    partDisabled: 'تم تعطيل القطعة',
    partDisabledMsg: 'تم تعطيلها',
    partEnabled: 'تم تفعيل القطعة',
    partEnabledMsg: 'تم تفعيلها',
    partRenamed: 'تم تغيير اسم القطعة!',
    partRenamedMsg: 'تم تغيير الاسم بنجاح',
    confirmDisable: 'تعطيل القطعة؟',
    confirmDisableMsg: 'لن يتمكن العمال من إضافة هذه القطعة إلى مخزونهم.',
    confirmEnable: 'تفعيل القطعة؟',
    confirmEnableMsg: 'سيتمكن العمال من إضافة هذه القطعة إلى مخزونهم مرة أخرى.',
    active: 'مفعّل',
    disabled: 'معطّل',
    all: 'الكل',
    fillPartName: 'يرجى إدخال اسم القطعة',
    duplicateName: 'يوجد قطعة بهذا الاسم بالفعل',
    id: 'معرّف',
    status: 'الحالة',
    partCount: 'قطع',
  };

  // Listen to company inventory in real-time
  useEffect(() => {
    const companyId = getCompanyId();
    if (!companyId) {
      setIsLoading(false);
      return;
    }

    const companyInvRef = doc(db, 'companies', companyId, 'business_data', 'inventory');
    
    const unsubscribe = onSnapshot(companyInvRef, (docSnapshot) => {
      if (docSnapshot.exists()) {
        const data = docSnapshot.data();
        const partsArray = Array.isArray(data.parts) ? data.parts : [];
        setCompanyParts(partsArray);
      } else {
        setCompanyParts([]);
      }
      setIsLoading(false);
    }, (error) => {
      console.error('Company inventory listener error:', error);
      setIsLoading(false);
    });

    unsubscribeRef.current = unsubscribe;

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, []);

  /**
   * Add a new company part using Firestore transaction for safe concurrent writes.
   * Uses nextId to assign a sequential numeric ID.
   */
  const handleAddPart = async () => {
    const trimmedName = newPartName.trim();
    if (!trimmedName) {
      alert.error('Error', t.fillPartName);
      return;
    }

    // Check for duplicate names (case-insensitive)
    const duplicate = companyParts.find(
      p => p.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      alert.warning('Warning', t.duplicateName);
      return;
    }

    try {
      const companyId = getCompanyId();
      const companyInvRef = doc(db, 'companies', companyId, 'business_data', 'inventory');

      await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(companyInvRef);
        let currentParts = [];
        let nextId = 1;

        if (docSnap.exists()) {
          const data = docSnap.data();
          currentParts = Array.isArray(data.parts) ? data.parts : [];
          nextId = typeof data.nextId === 'number' ? data.nextId : (currentParts.length > 0 ? Math.max(...currentParts.map(p => p.id)) + 1 : 1);
        }

        const newPart = {
          id: nextId,
          name: trimmedName,
          active: true,
          dateAdded: new Date().toISOString(),
        };

        transaction.set(companyInvRef, {
          parts: [...currentParts, newPart],
          nextId: nextId + 1,
          lastUpdated: new Date().toISOString(),
        });
      });

      alert.success(t.partAdded, `${trimmedName} ${t.partAddedMsg}`);
      setNewPartName('');
      setShowAddPart(false);
    } catch (error) {
      console.error('Error adding company part:', error);
      alert.error('Error', 'Failed to add part. Please try again.');
    }
  };

  /**
   * Toggle part active/disabled status using transaction.
   */
  const handleToggleActive = async (partId, currentlyActive) => {
    const confirmTitle = currentlyActive ? t.confirmDisable : t.confirmEnable;
    const confirmMsg = currentlyActive ? t.confirmDisableMsg : t.confirmEnableMsg;

    alert.confirm(confirmTitle, confirmMsg, [
      { text: t.cancel, style: 'cancel', onPress: () => {} },
      {
        text: currentlyActive ? t.disable : t.enable,
        style: currentlyActive ? 'destructive' : 'primary',
        onPress: async () => {
          try {
            const companyId = getCompanyId();
            const companyInvRef = doc(db, 'companies', companyId, 'business_data', 'inventory');

            await runTransaction(db, async (transaction) => {
              const docSnap = await transaction.get(companyInvRef);
              if (!docSnap.exists()) return;
              
              const data = docSnap.data();
              const parts = Array.isArray(data.parts) ? data.parts : [];
              const updatedParts = parts.map(p => 
                p.id === partId ? { ...p, active: !currentlyActive } : p
              );

              transaction.update(companyInvRef, {
                parts: updatedParts,
                lastUpdated: new Date().toISOString(),
              });
            });

            const part = companyParts.find(p => p.id === partId);
            if (currentlyActive) {
              alert.success(t.partDisabled, `${part?.name} ${t.partDisabledMsg}`);
            } else {
              alert.success(t.partEnabled, `${part?.name} ${t.partEnabledMsg}`);
            }
          } catch (error) {
            console.error('Error toggling part status:', error);
            alert.error('Error', 'Failed to update part. Please try again.');
          }
        },
      },
    ]);
  };

  /**
   * Rename a company part.
   */
  const handleRenamePart = async () => {
    const trimmedName = editName.trim();
    if (!trimmedName) {
      alert.error('Error', t.fillPartName);
      return;
    }

    // Check for duplicate names
    const duplicate = companyParts.find(
      p => p.name.toLowerCase() === trimmedName.toLowerCase() && p.id !== showEditModal
    );
    if (duplicate) {
      alert.warning('Warning', t.duplicateName);
      return;
    }

    try {
      const companyId = getCompanyId();
      const companyInvRef = doc(db, 'companies', companyId, 'business_data', 'inventory');

      await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(companyInvRef);
        if (!docSnap.exists()) return;

        const data = docSnap.data();
        const parts = Array.isArray(data.parts) ? data.parts : [];
        const updatedParts = parts.map(p =>
          p.id === showEditModal ? { ...p, name: trimmedName } : p
        );

        transaction.update(companyInvRef, {
          parts: updatedParts,
          lastUpdated: new Date().toISOString(),
        });
      });

      alert.success(t.partRenamed, `${trimmedName} ${t.partRenamedMsg}`);
      setShowEditModal(null);
      setEditName('');
    } catch (error) {
      console.error('Error renaming part:', error);
      alert.error('Error', 'Failed to rename part. Please try again.');
    }
  };

  // Filter parts
  const getFilteredParts = () => {
    let filtered = companyParts;

    // Filter by active status
    if (filterActive === 'active') {
      filtered = filtered.filter(p => p.active !== false);
    } else if (filterActive === 'disabled') {
      filtered = filtered.filter(p => p.active === false);
    }

    // Filter by search
    if (searchQuery) {
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(p.id).includes(searchQuery)
      );
    }

    return filtered;
  };

  const filteredParts = getFilteredParts();
  const activeCount = companyParts.filter(p => p.active !== false).length;
  const disabledCount = companyParts.filter(p => p.active === false).length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      <ScrollableContainer
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Stats Row */}
        {companyParts.length > 0 && (
          <View style={styles.statsRow}>
            <TouchableOpacity
              style={[
                styles.statChip,
                { 
                  backgroundColor: filterActive === 'all' ? colors.secondary : colors.surface,
                  borderColor: filterActive === 'all' ? colors.secondary : colors.border,
                },
              ]}
              onPress={() => setFilterActive('all')}
            >
              <Text style={[
                styles.statChipText,
                { color: filterActive === 'all' ? '#fff' : colors.textPrimary },
              ]}>
                {t.all} ({companyParts.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.statChip,
                {
                  backgroundColor: filterActive === 'active' ? '#22c55e' : colors.surface,
                  borderColor: filterActive === 'active' ? '#22c55e' : colors.border,
                },
              ]}
              onPress={() => setFilterActive('active')}
            >
              <Text style={[
                styles.statChipText,
                { color: filterActive === 'active' ? '#fff' : colors.textPrimary },
              ]}>
                {t.active} ({activeCount})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.statChip,
                {
                  backgroundColor: filterActive === 'disabled' ? '#ef4444' : colors.surface,
                  borderColor: filterActive === 'disabled' ? '#ef4444' : colors.border,
                },
              ]}
              onPress={() => setFilterActive('disabled')}
            >
              <Text style={[
                styles.statChipText,
                { color: filterActive === 'disabled' ? '#fff' : colors.textPrimary },
              ]}>
                {t.disabled} ({disabledCount})
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Add Part Button */}
        <TouchableOpacity onPress={() => setShowAddPart(!showAddPart)}>
          <LinearGradient colors={gradients.secondary} style={styles.addButton}>
            <Text style={styles.addButtonText}>+ {t.addNewPart}</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Add Part Form */}
        {showAddPart && (
          <View style={[styles.formCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.formTitle, { color: colors.textPrimary }]}>{t.addNewPart}</Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.formLabel, { color: colors.textSecondary }]}>{t.partName}</Text>
              <TextInput
                style={[styles.formInput, {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.textPrimary,
                }]}
                value={newPartName}
                onChangeText={setNewPartName}
                placeholder={language === 'en' ? 'e.g., Valve, Filter, Cable' : language === 'he' ? 'לדוגמה: שסתום, מסנן, כבל' : 'مثال: صمام، فلتر، كابل'}
                placeholderTextColor={colors.textSecondary}
                autoFocus
              />
            </View>

            <View style={styles.formButtonRow}>
              <TouchableOpacity
                onPress={handleAddPart}
                style={[styles.formPrimaryButton, { backgroundColor: colors.secondary }]}
              >
                <Text style={styles.formPrimaryButtonText}>{t.add}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setShowAddPart(false); setNewPartName(''); }}
                style={[styles.formSecondaryButton, {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                }]}
              >
                <Text style={[styles.formSecondaryButtonText, { color: colors.textPrimary }]}>{t.cancel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Loading State */}
        {isLoading ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
            <ActivityIndicator size="large" color={colors.secondary} />
            <Text style={[styles.emptyTitle, { color: colors.textSecondary, marginTop: 16 }]}>Loading...</Text>
          </View>
        ) : companyParts.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
            <MaterialCommunityIcons name="package-variant" size={48} color={colors.textLight} style={{ marginBottom: 12 }} />
            <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>{t.noPartsYet}</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textLight }]}>{t.addFirstPart}</Text>
          </View>
        ) : (
          <>
            {/* Search */}
            <TextInput
              style={[styles.searchInput, {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                color: colors.textPrimary,
              }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t.searchParts}
              placeholderTextColor={colors.textSecondary}
            />

            {/* Parts List */}
            {filteredParts.map((part) => (
              <View
                key={part.id}
                style={[
                  styles.partCard,
                  { 
                    backgroundColor: colors.surface,
                    opacity: part.active === false ? 0.6 : 1,
                  },
                ]}
              >
                <View style={styles.partHeader}>
                  <View style={styles.partInfo}>
                    <View style={styles.partNameRow}>
                      <View style={[
                        styles.idBadge,
                        { backgroundColor: part.active === false ? '#ef4444' + '20' : colors.secondary + '20' },
                      ]}>
                        <Text style={[
                          styles.idBadgeText,
                          { color: part.active === false ? '#ef4444' : colors.secondary },
                        ]}>
                          #{part.id}
                        </Text>
                      </View>
                      <Text style={[styles.partName, { color: colors.textPrimary }]}>{part.name}</Text>
                    </View>
                    <View style={styles.partMeta}>
                      <View style={[
                        styles.statusBadge,
                        { backgroundColor: part.active === false ? '#ef4444' + '15' : '#22c55e' + '15' },
                      ]}>
                        <View style={[
                          styles.statusDot,
                          { backgroundColor: part.active === false ? '#ef4444' : '#22c55e' },
                        ]} />
                        <Text style={[
                          styles.statusText,
                          { color: part.active === false ? '#ef4444' : '#22c55e' },
                        ]}>
                          {part.active === false ? t.disabled : t.active}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.partActions}>
                    {/* Edit/Rename button */}
                    <TouchableOpacity
                      style={[styles.actionButton, {
                        backgroundColor: isDarkMode ? 'rgba(0, 172, 193, 0.15)' : 'rgba(0, 172, 193, 0.08)',
                        borderColor: colors.secondary,
                        borderWidth: 1,
                      }]}
                      onPress={() => {
                        setShowEditModal(part.id);
                        setEditName(part.name);
                      }}
                    >
                      <MaterialCommunityIcons name="pencil" size={16} color={colors.secondary} />
                    </TouchableOpacity>

                    {/* Enable/Disable button */}
                    <TouchableOpacity
                      style={[styles.actionButton, {
                        backgroundColor: part.active === false
                          ? (isDarkMode ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.08)')
                          : (isDarkMode ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.08)'),
                        borderColor: part.active === false ? '#22c55e' : '#ef4444',
                        borderWidth: 1,
                      }]}
                      onPress={() => handleToggleActive(part.id, part.active !== false)}
                    >
                      <MaterialCommunityIcons
                        name={part.active === false ? 'check-circle-outline' : 'close-circle-outline'}
                        size={16}
                        color={part.active === false ? '#22c55e' : '#ef4444'}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))}

            {filteredParts.length === 0 && (
              <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
                <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>{t.noResults}</Text>
              </View>
            )}
          </>
        )}
      </ScrollableContainer>

      {/* Rename Modal */}
      <Modal
        visible={showEditModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { setShowEditModal(null); setEditName(''); }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{t.rename}</Text>

            <TextInput
              style={[styles.formInput, {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.textPrimary,
              }]}
              value={editName}
              onChangeText={setEditName}
              placeholder={t.partName}
              placeholderTextColor={colors.textSecondary}
              autoFocus
            />

            <View style={styles.formButtonRow}>
              <TouchableOpacity
                onPress={handleRenamePart}
                style={[styles.formPrimaryButton, { backgroundColor: colors.secondary }]}
              >
                <Text style={styles.formPrimaryButtonText}>{t.save}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setShowEditModal(null); setEditName(''); }}
                style={[styles.formSecondaryButton, {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                }]}
              >
                <Text style={[styles.formSecondaryButtonText, { color: colors.textPrimary }]}>{t.cancel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 95 : 85,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statChip: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  statChipText: {
    fontSize: typography.sm,
    fontWeight: typography.bold,
    letterSpacing: 0.2,
  },
  addButton: {
    paddingVertical: spacing.md + 6,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
    ...shadows.primary,
  },
  addButtonText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.bold,
    letterSpacing: 0.3,
  },
  formCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  formTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    marginBottom: spacing.lg,
    letterSpacing: -0.3,
  },
  formLabel: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    marginBottom: spacing.xs,
    letterSpacing: 0.2,
  },
  formInput: {
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.base,
    fontWeight: '600',
    borderWidth: 1.5,
  },
  formButtonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  formPrimaryButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  formPrimaryButtonText: {
    color: 'white',
    fontWeight: typography.bold,
    fontSize: typography.base,
    letterSpacing: 0.3,
  },
  formSecondaryButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  formSecondaryButtonText: {
    fontWeight: typography.bold,
    fontSize: typography.base,
    letterSpacing: 0.3,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  searchInput: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    fontSize: typography.base,
  },
  emptyCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.xxl,
    alignItems: 'center',
    ...shadows.card,
  },
  emptyTitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    marginBottom: spacing.xs,
    letterSpacing: -0.2,
  },
  emptySubtitle: {
    fontSize: typography.sm,
    letterSpacing: 0.2,
  },
  partCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  partHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  partInfo: {
    flex: 1,
  },
  partNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  idBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  idBadgeText: {
    fontSize: typography.sm,
    fontWeight: typography.bold,
    letterSpacing: 0.3,
  },
  partName: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    letterSpacing: -0.2,
    flex: 1,
  },
  partMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: typography.xs,
    fontWeight: typography.bold,
    letterSpacing: 0.3,
  },
  partActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionButton: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 4,
    borderRadius: borderRadius.md,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalContent: {
    width: '100%',
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    ...shadows.floating,
  },
  modalTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    marginBottom: spacing.lg,
    letterSpacing: -0.3,
  },
});
