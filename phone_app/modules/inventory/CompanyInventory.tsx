// @ts-nocheck
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { functions, httpsCallable } from '../../firebase';
import {
  borderRadius,
  getColors,
  shadows,
  spacing,
} from '../../theme';
import { useAlert } from '../../contexts/AlertContext';
import { useCache } from '../../contexts/CacheContext';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import {
  AppButton,
  AppCard,
  AppChip,
  AppDivider,
  AppEmptyState,
  SearchInput,
  AppText,
  GlobalHeader,
  LoadingSpinner,
  ScreenHeroCard,
} from '../../components';

const translations = {
  en: {
    title: 'Company Inventory',
    subtitle: 'Master parts list used by your team',
    addPart: 'Add Part',
    addPartTitle: 'Add New Part',
    partName: 'Part Name',
    placeholderPartName: 'Example: Compressor',
    search: 'Search by name or ID',
    all: 'All',
    active: 'Active',
    disabled: 'Disabled',
    lowStock: 'Low stock',
    quantity: 'Qty',
    threshold: 'Min',
    save: 'Save',
    cancel: 'Cancel',
    edit: 'Edit',
    disable: 'Disable',
    enable: 'Enable',
    rename: 'Rename Part',
    noParts: 'No parts yet',
    noResults: 'No matching parts',
    loading: 'Loading parts...',
    duplicateName: 'A part with this name already exists.',
    requiredName: 'Please enter a part name.',
    updateSuccess: 'Part updated successfully.',
    addSuccess: 'Part added successfully.',
    toggleConfirmDisable: 'Disable this part for workers?',
    toggleConfirmEnable: 'Enable this part for workers?',
  },
  he: {
    title: 'מלאי חברה',
    subtitle: 'רשימת חלקים ראשית לצוות שלך',
    addPart: 'הוסף חלק',
    addPartTitle: 'הוספת חלק חדש',
    partName: 'שם חלק',
    placeholderPartName: 'לדוגמה: מדחס',
    search: 'חיפוש לפי שם או מזהה',
    all: 'הכל',
    active: 'פעיל',
    disabled: 'מושבת',
    lowStock: 'מלאי נמוך',
    quantity: 'כמות',
    threshold: 'מינימום',
    save: 'שמור',
    cancel: 'ביטול',
    edit: 'ערוך',
    disable: 'השבת',
    enable: 'הפעל',
    rename: 'שנה שם חלק',
    noParts: 'אין חלקים עדיין',
    noResults: 'לא נמצאו חלקים תואמים',
    loading: 'טוען חלקים...',
    duplicateName: 'חלק עם שם זה כבר קיים.',
    requiredName: 'יש להזין שם חלק.',
    updateSuccess: 'החלק עודכן בהצלחה.',
    addSuccess: 'החלק נוסף בהצלחה.',
    toggleConfirmDisable: 'להשבית חלק זה עבור עובדים?',
    toggleConfirmEnable: 'להפעיל חלק זה עבור עובדים?',
  },
  ar: {
    title: 'مخزون الشركة',
    subtitle: 'قائمة القطع الرئيسية لفريقك',
    addPart: 'إضافة قطعة',
    addPartTitle: 'إضافة قطعة جديدة',
    partName: 'اسم القطعة',
    placeholderPartName: 'مثال: ضاغط',
    search: 'بحث بالاسم أو المعرف',
    all: 'الكل',
    active: 'نشط',
    disabled: 'معطل',
    lowStock: 'مخزون منخفض',
    quantity: 'الكمية',
    threshold: 'الحد الأدنى',
    save: 'حفظ',
    cancel: 'إلغاء',
    edit: 'تعديل',
    disable: 'تعطيل',
    enable: 'تمكين',
    rename: 'إعادة تسمية القطعة',
    noParts: 'لا توجد قطع بعد',
    noResults: 'لا توجد قطع مطابقة',
    loading: 'جاري تحميل القطع...',
    duplicateName: 'يوجد قطعة بهذا الاسم بالفعل.',
    requiredName: 'يرجى إدخال اسم القطعة.',
    updateSuccess: 'تم تحديث القطعة بنجاح.',
    addSuccess: 'تمت إضافة القطعة بنجاح.',
    toggleConfirmDisable: 'تعطيل هذه القطعة للعمال؟',
    toggleConfirmEnable: 'تمكين هذه القطعة للعمال؟',
  },
};

const filters = ['all', 'active', 'disabled'];

export default function CompanyInventory() {
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { getCompanyId, companyInventory } = useCache();
  const palette = getColors(isDarkMode);
  const t = translations[language] || translations.en;

  // I9: Use CacheContext-managed company inventory instead of direct listener
  const companyParts = companyInventory;
  const loading = false; // CacheContext handles loading state
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [newPartName, setNewPartName] = useState('');
  const [editingPart, setEditingPart] = useState(null);
  const [editName, setEditName] = useState('');

  const filteredParts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return companyParts
      .filter((part) => {
        const active = part.active !== false;
        if (filter === 'active' && !active) return false;
        if (filter === 'disabled' && active) return false;
        if (!query) return true;
        return String(part.name || '').toLowerCase().includes(query) || String(part.id || '').includes(query);
      })
      .sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  }, [companyParts, filter, searchQuery]);

  const activeCount = useMemo(() => companyParts.filter((part) => part.active !== false).length, [companyParts]);
  const disabledCount = useMemo(() => companyParts.filter((part) => part.active === false).length, [companyParts]);

  const callInventoryFn = async (payload) => {
    const companyId = getCompanyId();
    if (!companyId) {
      throw new Error('Company ID not found.');
    }
    const updateInventoryFn = httpsCallable(functions, 'updateInventoryV1');
    return updateInventoryFn({ companyId, scope: 'company', ...payload });
  };

  const addPart = async () => {
    const partName = newPartName.trim();
    if (!partName) {
      alert.error('Error', t.requiredName);
      return;
    }

    const duplicate = companyParts.some(
      (part) => String(part.name || '').toLowerCase() === partName.toLowerCase()
    );
    if (duplicate) {
      alert.warning('Warning', t.duplicateName);
      return;
    }

    try {
      await callInventoryFn({ action: 'addPart', partName, quantity: 0 });
      alert.success('Success', t.addSuccess);
      setNewPartName('');
      setShowAddModal(false);
    } catch (error) {
      console.error('CompanyInventory addPart error:', error);
      alert.error('Error', error.message || 'Failed to add part.');
    }
  };

  const togglePart = (part) => {
    const nextActionLabel = part.active === false ? t.enable : t.disable;
    const confirmMessage = part.active === false ? t.toggleConfirmEnable : t.toggleConfirmDisable;

    alert.confirm(nextActionLabel, confirmMessage, [
      { text: t.cancel, style: 'cancel', onPress: () => {} },
      {
        text: nextActionLabel,
        style: part.active === false ? 'primary' : 'destructive',
        onPress: async () => {
          try {
            await callInventoryFn({ action: 'togglePart', partId: Number(part.id) });
            alert.success('Success', t.updateSuccess);
          } catch (error) {
            console.error('CompanyInventory togglePart error:', error);
            alert.error('Error', error.message || 'Failed to update part.');
          }
        },
      },
    ]);
  };

  const startEdit = (part) => {
    setEditingPart(part);
    setEditName(part.name || '');
    setShowEditModal(true);
  };

  const saveEdit = async () => {
    const partName = editName.trim();
    if (!editingPart) return;
    if (!partName) {
      alert.error('Error', t.requiredName);
      return;
    }

    const duplicate = companyParts.some(
      (part) =>
        part.id !== editingPart.id &&
        String(part.name || '').toLowerCase() === partName.toLowerCase()
    );
    if (duplicate) {
      alert.warning('Warning', t.duplicateName);
      return;
    }

    try {
      await callInventoryFn({
        action: 'updatePart',
        partId: Number(editingPart.id),
        partName,
      });
      alert.success('Success', t.updateSuccess);
      setShowEditModal(false);
      setEditingPart(null);
      setEditName('');
    } catch (error) {
      console.error('CompanyInventory saveEdit error:', error);
      alert.error('Error', error.message || 'Failed to rename part.');
    }
  };

  const renderPart = ({ item }) => {
    const quantity = Number(item.quantity || 0);
    const threshold = Number(item.lowThreshold || 0);
    const lowStock = threshold > 0 && quantity <= threshold;
    const statusLabel = item.active === false ? t.disabled : t.active;

    return (
      <AppCard
        style={[
          styles.partCard,
          {
            borderColor: item.active === false ? palette.border : palette.borderDark,
            opacity: item.active === false ? 0.78 : 1,
          },
        ]}
      >
        <View style={styles.partHeader}>
          <View style={styles.partHeaderMain}>
            <AppText variant="bodyStrong">#{item.id}</AppText>
            <AppText variant="heading" numberOfLines={1} style={styles.partName}>
              {item.name}
            </AppText>
          </View>
          <AppChip
            label={statusLabel}
            status={item.active === false ? 'disabled' : 'active'}
            size="sm"
          />
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metric}>
            <AppText variant="caption" color={palette.textSecondary}>
              {t.quantity}
            </AppText>
            <AppText variant="bodyStrong">{quantity}</AppText>
          </View>
          <View style={styles.metric}>
            <AppText variant="caption" color={palette.textSecondary}>
              {t.threshold}
            </AppText>
            <AppText variant="bodyStrong">{threshold}</AppText>
          </View>
          {lowStock ? (
            <View style={[styles.lowStockBadge, { backgroundColor: `${palette.lowStock}20` }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color={palette.lowStock} />
              <AppText variant="caption" color={palette.lowStock}>
                {t.lowStock}
              </AppText>
            </View>
          ) : null}
        </View>

        <AppDivider style={styles.partDivider} />

        <View style={styles.partActions}>
          <AppButton
            title={t.edit}
            variant="secondary"
            iconLeft={{ name: 'create-outline' }}
            onPress={() => startEdit(item)}
            style={styles.partActionButton}
          />
          <AppButton
            title={item.active === false ? t.enable : t.disable}
            variant={item.active === false ? 'primary' : 'destructive'}
            iconLeft={{ name: item.active === false ? 'checkmark-circle-outline' : 'close-circle-outline' }}
            onPress={() => togglePart(item)}
            style={styles.partActionButton}
          />
        </View>
      </AppCard>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />

      <View style={styles.content}>
        <FlatList
          data={filteredParts}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderPart}
          contentContainerStyle={{
            paddingTop: Platform.OS === 'ios' ? 108 : 96,
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xxxl + 80,
            flexGrow: filteredParts.length === 0 && !loading ? 1 : 0,
          }}
          ListHeaderComponent={
            <View style={styles.headerArea}>
              <ScreenHeroCard
                title={t.title}
                subtitle={t.subtitle}
                eyebrow="Inventory"
                icon="package-variant-closed"
                iconLibrary="material"
                accentColor={palette.boxOrange}
                metrics={[
                  { label: t.all, value: String(companyParts.length) },
                  { label: t.active, value: String(activeCount) },
                  { label: t.disabled, value: String(disabledCount) },
                ]}
                badges={[t.lowStock, t.active, t.disabled]}
              />

              <View style={styles.filterRow}>
                {filters.map((item) => {
                  const count =
                    item === 'all' ? companyParts.length : item === 'active' ? activeCount : disabledCount;
                  return (
                    <TouchableOpacity
                      key={item}
                      onPress={() => setFilter(item)}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: filter === item ? palette.secondary : palette.surface,
                          borderColor: filter === item ? palette.secondary : palette.border,
                        },
                      ]}
                    >
                      <AppText
                        variant="caption"
                        color={filter === item ? '#FFFFFF' : palette.textPrimary}
                      >
                        {t[item]} ({count})
                      </AppText>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <SearchInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={t.search}
                colors={palette}
                style={styles.searchInput}
              />

              <AppButton
                title={t.addPart}
                iconLeft={{ name: 'add-circle-outline' }}
                onPress={() => setShowAddModal(true)}
              />
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <View style={styles.loadingWrap}>
                <LoadingSpinner text={t.loading} />
              </View>
            ) : companyParts.length === 0 ? (
              <AppEmptyState
                icon="package-variant-closed-plus"
                title={t.noParts}
                subtitle={t.subtitle}
                action={
                  <AppButton
                    title={t.addPart}
                    onPress={() => setShowAddModal(true)}
                    style={{ marginTop: spacing.sm }}
                  />
                }
              />
            ) : (
              <AppEmptyState icon="magnify-close" title={t.noResults} />
            )
          }
        />
      </View>

      <Modal visible={showAddModal} transparent animationType="fade" onRequestClose={() => setShowAddModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: palette.overlay }]}>
          <AppCard style={styles.modalCard}>
            <AppText variant="heading">{t.addPartTitle}</AppText>
            <AppInput
              label={t.partName}
              value={newPartName}
              onChangeText={setNewPartName}
              placeholder={t.placeholderPartName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <AppButton title={t.cancel} variant="secondary" onPress={() => setShowAddModal(false)} />
              <AppButton title={t.save} onPress={addPart} />
            </View>
          </AppCard>
        </View>
      </Modal>

      <Modal visible={showEditModal} transparent animationType="fade" onRequestClose={() => setShowEditModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: palette.overlay }]}>
          <AppCard style={styles.modalCard}>
            <AppText variant="heading">{t.rename}</AppText>
            <AppInput
              label={t.partName}
              value={editName}
              onChangeText={setEditName}
              placeholder={t.placeholderPartName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <AppButton title={t.cancel} variant="secondary" onPress={() => setShowEditModal(false)} />
              <AppButton title={t.save} onPress={saveEdit} />
            </View>
          </AppCard>
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
  content: {
    flex: 1,
  },
  headerArea: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  searchInput: {
    marginTop: spacing.xs,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
  },
  partCard: {
    marginBottom: spacing.md,
    borderWidth: 1,
    ...shadows.card,
  },
  partHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  partHeaderMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  partName: {
    flex: 1,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  metric: {
    minWidth: 58,
    gap: 2,
  },
  lowStockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.pill,
    gap: spacing.xs,
  },
  partDivider: {
    marginVertical: spacing.sm,
  },
  partActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  partActionButton: {
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
    maxWidth: 440,
    gap: spacing.sm,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});

