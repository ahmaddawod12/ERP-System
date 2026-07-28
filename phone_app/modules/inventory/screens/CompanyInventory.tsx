import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { randomUUID } from 'expo-crypto';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  borderRadius,
  getColors,
  shadows,
  spacing,
  type ColorPalette,
} from '../../../theme';
import { useAlert } from '../../../contexts/AlertContext';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTenant } from '../../../contexts/TenantContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { logger } from '../../../utils/logger';
import AccessibleModal from '../../../components/feedback/AccessibleModal';
import { StableInventoryActionKeys } from '../lib/inventory-action-keys';
import {
  resolveInventoryReadScope,
  type MobileInventoryPart,
} from '../lib/inventory-list-model';
import { useInventoryInfinite } from '../lib/use-inventory-infinite';
import { useInventoryMutations } from '../lib/use-inventory-mutations';
import {
  AppButton,
  AppCard,
  AppChip,
  AppDivider,
  AppEmptyState,
  AppInput,
  SearchInput,
  AppText,
  GlobalHeader,
  ScreenHeroCard,
} from '../../../components';

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
    loadFailed: 'Inventory could not be loaded. Check your connection and try again.',
    refreshFailed: 'Inventory could not be refreshed. Saved results remain available.',
    retry: 'Retry',
    loadMore: 'Load more',
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
    loadFailed: 'לא ניתן היה לטעון את המלאי. בדוק את החיבור ונסה שוב.',
    refreshFailed: 'לא ניתן היה לרענן את המלאי. התוצאות השמורות נשארו זמינות.',
    retry: 'נסה שוב',
    loadMore: 'טען עוד',
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
    loadFailed: 'تعذر تحميل المخزون. تحقق من الاتصال وحاول مرة أخرى.',
    refreshFailed: 'تعذر تحديث المخزون. ستبقى النتائج المحفوظة متاحة.',
    retry: 'إعادة المحاولة',
    loadMore: 'تحميل المزيد',
    duplicateName: 'يوجد قطعة بهذا الاسم بالفعل.',
    requiredName: 'يرجى إدخال اسم القطعة.',
    updateSuccess: 'تم تحديث القطعة بنجاح.',
    addSuccess: 'تمت إضافة القطعة بنجاح.',
    toggleConfirmDisable: 'تعطيل هذه القطعة للعمال؟',
    toggleConfirmEnable: 'تمكين هذه القطعة للعمال؟',
  },
};

const filters = ['all', 'active', 'disabled'] as const;
type InventoryFilter = (typeof filters)[number];

export default function CompanyInventory() {
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { user } = useSession();
  const { workspace, status: tenantStatus } = useTenant();
  const palette = getColors(isDarkMode);
  const t = translations[language] || translations.en;

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [filter, setFilter] = useState<InventoryFilter>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [newPartName, setNewPartName] = useState('');
  const [editingPart, setEditingPart] = useState<MobileInventoryPart | null>(null);
  const [editName, setEditName] = useState('');
  const [actionKeys] = useState(() => new StableInventoryActionKeys(() => randomUUID()));

  useEffect(() => {
    actionKeys.reset();
  }, [actionKeys, user?.uid, workspace?.companyId]);

  const readScope = resolveInventoryReadScope(workspace);
  const canManageCompanyInventory = readScope === 'company'
    && (workspace?.role === 'manager' || workspace?.role === 'dev');
  const inventoryFilters = useMemo(() => ({
    status: filter === 'active' ? 'active' as const : filter === 'disabled' ? 'inactive' as const : undefined,
    search: debouncedSearchQuery,
    pageSize: 50,
  }), [debouncedSearchQuery, filter]);
  const { query: inventoryQuery, parts: companyParts } = useInventoryInfinite({
    uid: user?.uid ?? null,
    companyId: workspace?.companyId ?? null,
    scope: 'company',
    filters: inventoryFilters,
    enabled: tenantStatus === 'ready' && readScope === 'company',
  });
  const { createMutation, updateMutation } = useInventoryMutations({
    uid: user?.uid ?? null,
    companyId: workspace?.companyId ?? null,
  });
  const filteredParts = companyParts;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim().slice(0, 80));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (inventoryQuery.error) {
      logger.warn('Company inventory refresh failed; retaining cached query data', inventoryQuery.error);
    }
  }, [inventoryQuery.error]);

  const activeCount = useMemo(() => companyParts.filter((part) => part.active !== false).length, [companyParts]);
  const disabledCount = useMemo(() => companyParts.filter((part) => part.active === false).length, [companyParts]);

  const addPart = async () => {
    if (!canManageCompanyInventory) {
      alert.error('Error', 'Only workspace managers can change company inventory.');
      return;
    }
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
      const body = {
        name: partName,
        initialQuantity: 0,
        lowThreshold: 0,
        unit: null,
      } as const;
      const action = 'part:create';
      const key = actionKeys.keyFor(action, JSON.stringify(body));
      await createMutation.mutateAsync({ body, idempotencyKey: key });
      actionKeys.complete(action, key);
      alert.success('Success', t.addSuccess);
      setNewPartName('');
      setShowAddModal(false);
    } catch (error) {
      logger.error('Company inventory add-part failed', error);
      alert.error('Error', error instanceof Error ? error.message : 'Failed to add part.');
    }
  };

  const togglePart = (part: MobileInventoryPart) => {
    const nextActionLabel = part.active === false ? t.enable : t.disable;
    const confirmMessage = part.active === false ? t.toggleConfirmEnable : t.toggleConfirmDisable;

    alert.confirm(nextActionLabel, confirmMessage, [
      { text: t.cancel, style: 'cancel', onPress: () => {} },
      {
        text: nextActionLabel,
        style: part.active === false ? 'default' : 'destructive',
         onPress: async () => {
          if (!canManageCompanyInventory) return;
          try {
            const body = {
              entityVersion: part.entityVersion,
              active: part.active === false,
            };
            const action = `part:toggle:${part.partId}`;
            const key = actionKeys.keyFor(action, JSON.stringify(body));
            await updateMutation.mutateAsync({
              partId: part.partId,
              body,
              idempotencyKey: key,
            });
            actionKeys.complete(action, key);
            alert.success('Success', t.updateSuccess);
          } catch (error) {
            logger.error('Company inventory toggle failed', error);
            alert.error('Error', error instanceof Error ? error.message : 'Failed to update part.');
          }
        },
      },
    ]);
  };

  const startEdit = (part: MobileInventoryPart) => {
    setEditingPart(part);
    setEditName(part.name || '');
    setShowEditModal(true);
  };

  const saveEdit = async () => {
    const partName = editName.trim();
    if (!editingPart || !canManageCompanyInventory) return;
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
      const body = {
        entityVersion: editingPart.entityVersion,
        name: partName,
      };
      const action = `part:update:${editingPart.partId}`;
      const key = actionKeys.keyFor(action, JSON.stringify(body));
      await updateMutation.mutateAsync({
        partId: editingPart.partId,
        body,
        idempotencyKey: key,
      });
      actionKeys.complete(action, key);
      alert.success('Success', t.updateSuccess);
      setShowEditModal(false);
      setEditingPart(null);
      setEditName('');
    } catch (error) {
      logger.error('Company inventory rename failed', error);
      alert.error('Error', error instanceof Error ? error.message : 'Failed to rename part.');
    }
  };

  const renderPart = ({ item }: { item: MobileInventoryPart }) => {
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

        {canManageCompanyInventory ? (
          <View style={styles.partActions}>
            <AppButton
              title={t.edit}
              variant="secondary"
              iconLeft={{ name: 'create-outline' }}
              onPress={() => startEdit(item)}
              disabled={updateMutation.isPending}
              style={styles.partActionButton}
            />
            <AppButton
              title={item.active === false ? t.enable : t.disable}
              variant={item.active === false ? 'primary' : 'destructive'}
              iconLeft={{ name: item.active === false ? 'checkmark-circle-outline' : 'close-circle-outline' }}
              onPress={() => togglePart(item)}
              disabled={updateMutation.isPending}
              style={styles.partActionButton}
            />
          </View>
        ) : null}
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
            flexGrow: filteredParts.length === 0 && !inventoryQuery.isLoading ? 1 : 0,
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
                        {t[item as keyof typeof t]} ({count})
                      </AppText>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <SearchInput
                value={searchQuery}
                onChangeText={(value) => setSearchQuery(value.slice(0, 80))}
                placeholder={t.search}
                colors={palette}
                style={styles.searchInput}
              />

              {canManageCompanyInventory ? (
                <AppButton
                  title={t.addPart}
                  iconLeft={{ name: 'add-circle-outline' }}
                  onPress={() => setShowAddModal(true)}
                  disabled={createMutation.isPending}
                />
              ) : null}

              {inventoryQuery.isError && companyParts.length > 0 ? (
                <AppCard style={[styles.queryErrorCard, { borderColor: palette.error }]}>
                  <AppText variant="caption" color={palette.textPrimary}>
                    {t.refreshFailed}
                  </AppText>
                  <AppButton
                    title={t.retry}
                    size="sm"
                    onPress={() => { void inventoryQuery.refetch(); }}
                    loading={inventoryQuery.isFetching}
                    style={styles.retryButton}
                  />
                </AppCard>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            inventoryQuery.isLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="large" color={palette.secondary} />
                <AppText variant="body" color={palette.textSecondary}>{t.loading}</AppText>
              </View>
            ) : inventoryQuery.isError ? (
              <AppEmptyState
                icon="cloud-alert-outline"
                title={t.loadFailed}
                action={
                  <AppButton
                    title={t.retry}
                    onPress={() => { void inventoryQuery.refetch(); }}
                    loading={inventoryQuery.isFetching}
                    style={{ marginTop: spacing.sm }}
                  />
                }
              />
            ) : !searchQuery.trim() && filter === 'all' ? (
              <AppEmptyState
                icon="package-variant-closed-plus"
                title={t.noParts}
                subtitle={t.subtitle}
                action={canManageCompanyInventory ? (
                  <AppButton
                    title={t.addPart}
                    onPress={() => setShowAddModal(true)}
                    style={{ marginTop: spacing.sm }}
                  />
                ) : undefined}
              />
            ) : <AppEmptyState icon="magnify-close" title={t.noResults} />
          }
          ListFooterComponent={inventoryQuery.hasNextPage ? (
            <AppButton
              title={t.loadMore}
              onPress={() => { void inventoryQuery.fetchNextPage(); }}
              loading={inventoryQuery.isFetchingNextPage}
              disabled={inventoryQuery.isFetchingNextPage}
              style={styles.loadMoreButton}
            />
          ) : null}
          refreshing={inventoryQuery.isRefetching && !inventoryQuery.isFetchingNextPage}
          onRefresh={() => { void inventoryQuery.refetch(); }}
        />
      </View>

      <AccessibleModal visible={showAddModal} transparent animationType="fade" onRequestClose={() => setShowAddModal(false)} announcement={t.addPartTitle}>
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
               <AppButton title={t.save} onPress={addPart} loading={createMutation.isPending} />
            </View>
          </AppCard>
        </View>
      </AccessibleModal>

      <AccessibleModal visible={showEditModal} transparent animationType="fade" onRequestClose={() => setShowEditModal(false)} announcement={t.rename}>
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
              <AppButton title={t.save} onPress={saveEdit} loading={updateMutation.isPending} />
            </View>
          </AppCard>
        </View>
      </AccessibleModal>

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
    gap: spacing.sm,
  },
  queryErrorCard: {
    borderWidth: 1,
    gap: spacing.sm,
  },
  retryButton: {
    alignSelf: 'flex-start',
  },
  loadMoreButton: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
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

