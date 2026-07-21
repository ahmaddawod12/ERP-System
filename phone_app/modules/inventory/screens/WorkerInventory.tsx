import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { randomUUID } from 'expo-crypto';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getColors, spacing, borderRadius, typography, shadows } from '../../../theme';
import { AppButton, AppCard, AppEmptyState, AppInput, AppText, GlobalHeader, ScreenHeroCard, SearchInput } from '../../../components';
import { useScrollHandler } from '../../../contexts/HeaderContext';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTenant } from '../../../contexts/TenantContext';
import { logger } from '../../../utils/logger';
import { StableInventoryActionKeys } from '../lib/inventory-action-keys';
import {
  mapInventoryPartSummary,
  resolveInventoryReadScope,
  type MobileInventoryPart,
} from '../lib/inventory-list-model';
import { useInventoryInfinite } from '../lib/use-inventory-infinite';
import { useInventoryMutations } from '../lib/use-inventory-mutations';
import InventoryPartRowView from '../components/InventoryPartRow';

export default function WorkerInventory() {
  const [inventory, setInventory] = useState<MobileInventoryPart[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { scrollProps } = useScrollHandler();
  const { user } = useSession();
  const { workspace, status: tenantStatus } = useTenant();
  const colors = getColors(isDarkMode);
  const [actionKeys] = useState(() => new StableInventoryActionKeys(() => randomUUID()));

  useEffect(() => {
    actionKeys.reset();
  }, [actionKeys, user?.id, workspace?.companyId]);

  const inventoryRef = useRef(inventory);

  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);

  const t = language === 'en' ? {
    title: 'Cooling Parts',
    subtitle: 'Inventory Manager',
    addFromCompany: 'Add from Company Parts',
    yourParts: 'Your Parts',
    noPartsYet: 'No parts yet.',
    addFirstPart: 'Add your first part!',
    initialQuantity: 'Initial Quantity',
    lowStockAlert: 'Low Stock Alert',
    add: 'Add',
    cancel: 'Cancel',
    use: 'Use',
    remove: 'Remove',
    confirm: 'Confirm',
    quantity: 'Quantity',
    alert: 'Alert',
    lowStockWarning: 'Low Stock Alert!',
    lowStock: 'LOW STOCK!',
    amount: 'Amount',
    fillAllFields: 'Please fill all fields',
    areYouSure: 'Are you sure you want to remove this part from your inventory?',
    at: 'at',
    howMany: 'Enter quantity (e.g., 10)',
    alertAt: 'Enter alert threshold (e.g., 5)',
    quantityPlaceholder: 'Number...',
    alertPlaceholder: 'Minimum quantity...',
    beCareful: 'Be careful!',
    partsLowStock: 'parts are in low stock',
    partLowStock: 'part is in low stock',
    searchParts: 'Search parts...',
    noResults: 'No parts found',
    back: 'Back',
    partAddedSuccess: 'Part Added Successfully!',
    partAddedMessage: 'has been added to your inventory',
    quantityAddedSuccess: 'Quantity Added!',
    quantityAddedMessage: 'units added to',
    partUsedSuccess: 'Quantity Used!',
    partUsedMessage: 'units removed from',
    partRemovedSuccess: 'Part Removed!',
    partRemovedMessage: 'has been removed from inventory',
    invalidAmount: 'Invalid Amount',
    amountMustBePositive: 'Amount must be greater than zero',
    confirmRemove: 'Confirm Removal',
    confirmRemoveMessage: 'This action cannot be undone.',
    selectCompanyPart: 'Select Company Part',
    searchCompanyParts: 'Search company parts...',
    noCompanyParts: 'No company parts available',
    noActiveCompanyParts: 'No active company parts found',
    alreadyInInventory: 'This part is already in your inventory',
    companyPartId: 'Company ID',
    catalogUnavailable: 'Adding new company parts is temporarily unavailable until a secure catalog transfer API is added. You can still adjust parts already assigned to you.',
    loadingInventory: 'Loading inventory...',
    loadFailed: 'Inventory could not be loaded. Check your connection and try again.',
    refreshFailed: 'Inventory could not be refreshed. Saved results remain available.',
    retry: 'Retry',
    loadMore: 'Load more',
  } : language === 'he' ? {
    title: 'חלקי קירור',
    subtitle: 'מנהל מלאי',
    addFromCompany: 'הוסף מחלקי החברה',
    yourParts: 'החלקים שלך',
    noPartsYet: 'אין חלקים עדיין.',
    addFirstPart: 'הוסף את החלק הראשון שלך!',
    initialQuantity: 'כמות התחלתית',
    lowStockAlert: 'התראת מלאי נמוך',
    add: 'הוסף',
    cancel: 'ביטול',
    use: 'השתמש',
    remove: 'הסר',
    confirm: 'אישור',
    quantity: 'כמות',
    alert: 'התראה',
    lowStockWarning: 'התראת מלאי נמוך!',
    lowStock: 'מלאי נמוך!',
    amount: 'כמות',
    fillAllFields: 'אנא מלא את כל השדות',
    areYouSure: 'האם אתה בטוח שברצונך להסיר חלק זה מהמלאי שלך?',
    at: 'ב',
    howMany: 'הזן כמות (לדוגמה: 10)',
    alertAt: 'הזן סף התראה (לדוגמה: 5)',
    quantityPlaceholder: 'מספר...',
    alertPlaceholder: 'כמות מינימלית...',
    beCareful: 'היזהר!',
    partsLowStock: 'חלקים במלאי נמוך',
    partLowStock: 'חלק במלאי נמוך',
    searchParts: 'חיפוש חלקים...',
    noResults: 'לא נמצאו חלקים',
    back: 'חזרה',
    partAddedSuccess: 'החלק נוסף בהצלחה!',
    partAddedMessage: 'נוסף למלאי שלך',
    quantityAddedSuccess: 'הכמות נוספה!',
    quantityAddedMessage: 'יחידות נוספו ל',
    partUsedSuccess: 'הכמות נוצלה!',
    partUsedMessage: 'יחידות הוסרו מ',
    partRemovedSuccess: 'החלק הוסר!',
    partRemovedMessage: 'הוסר מהמלאי',
    invalidAmount: 'כמות לא תקינה',
    amountMustBePositive: 'הכמות חייבת להיות גדולה מאפס',
    confirmRemove: 'אישור הסרה',
    confirmRemoveMessage: 'פעולה זו לא ניתנת לביטול.',
    selectCompanyPart: 'בחר חלק חברה',
    searchCompanyParts: 'חיפוש חלקי חברה...',
    noCompanyParts: 'אין חלקי חברה זמינים',
    noActiveCompanyParts: 'לא נמצאו חלקי חברה פעילים',
    alreadyInInventory: 'חלק זה כבר נמצא במלאי שלך',
    companyPartId: 'מזהה חברה',
    catalogUnavailable: 'הוספת חלקים חדשים ממלאי החברה אינה זמינה זמנית עד להוספת ממשק העברה מאובטח. עדיין ניתן לעדכן חלקים שכבר הוקצו לך.',
    loadingInventory: 'טוען מלאי...',
    loadFailed: 'לא ניתן היה לטעון את המלאי. בדוק את החיבור ונסה שוב.',
    refreshFailed: 'לא ניתן היה לרענן את המלאי. התוצאות השמורות נשארו זמינות.',
    retry: 'נסה שוב',
    loadMore: 'טען עוד',
  } : {
    title: 'قطع التبريد',
    subtitle: 'مدير المخزون',
    addFromCompany: 'إضافة من قطع الشركة',
    yourParts: 'قطعك',
    noPartsYet: 'لا توجد قطع بعد.',
    addFirstPart: 'أضف قطعتك الأولى!',
    initialQuantity: 'الكمية الأولية',
    lowStockAlert: 'تنبيه مخزون منخفض',
    add: 'إضافة',
    cancel: 'إلغاء',
    use: 'استخدام',
    remove: 'إزالة',
    confirm: 'تأكيد',
    quantity: 'الكمية',
    alert: 'تنبيه',
    lowStockWarning: 'تنبيه مخزون منخفض!',
    lowStock: 'مخزون منخفض!',
    amount: 'الكمية',
    fillAllFields: 'يرجى ملء جميع الحقول',
    areYouSure: 'هل أنت متأكد من إزالة هذه القطعة من مخزونك؟',
    at: 'عند',
    howMany: 'أدخل الكمية (مثال: 10)',
    alertAt: 'أدخل حد التنبيه (مثال: 5)',
    quantityPlaceholder: 'عدد...',
    alertPlaceholder: 'الحد الأدنى للكمية...',
    beCareful: 'كن حذرا!',
    partsLowStock: 'قطع في مخزون منخفض',
    partLowStock: 'قطعة في مخزون منخفض',
    searchParts: 'بحث عن قطع...',
    noResults: 'لم يتم العثور على قطع',
    back: 'رجوع',
    partAddedSuccess: 'تمت إضافة القطعة بنجاح!',
    partAddedMessage: 'تمت الإضافة إلى مخزونك',
    quantityAddedSuccess: 'تمت إضافة الكمية!',
    quantityAddedMessage: 'وحدات أضيفت إلى',
    partUsedSuccess: 'تم استخدام الكمية!',
    partUsedMessage: 'وحدات أزيلت من',
    partRemovedSuccess: 'تم إزالة القطعة!',
    partRemovedMessage: 'تمت إزالتها من المخزون',
    invalidAmount: 'كمية غير صالحة',
    amountMustBePositive: 'يجب أن تكون الكمية أكبر من الصفر',
    confirmRemove: 'تأكيد الإزالة',
    confirmRemoveMessage: 'لا يمكن التراجع عن هذا الإجراء.',
    selectCompanyPart: 'اختر قطعة شركة',
    searchCompanyParts: 'بحث عن قطع الشركة...',
    noCompanyParts: 'لا توجد قطع شركة متاحة',
    noActiveCompanyParts: 'لم يتم العثور على قطع شركة مفعّلة',
    alreadyInInventory: 'هذه القطعة موجودة بالفعل في مخزونك',
    companyPartId: 'معرّف الشركة',
    catalogUnavailable: 'إضافة قطع جديدة من مخزون الشركة غير متاحة مؤقتًا حتى تتوفر واجهة نقل آمنة. لا يزال بإمكانك تعديل القطع المخصصة لك.',
    loadingInventory: 'جارٍ تحميل المخزون...',
    loadFailed: 'تعذر تحميل المخزون. تحقق من الاتصال وحاول مرة أخرى.',
    refreshFailed: 'تعذر تحديث المخزون. ستبقى النتائج المحفوظة متاحة.',
    retry: 'إعادة المحاولة',
    loadMore: 'تحميل المزيد',
  };

  const readScope = resolveInventoryReadScope(workspace);
  const inventoryFilters = useMemo(() => ({
    search: debouncedSearchQuery,
    pageSize: 50,
  }), [debouncedSearchQuery]);
  const { query: inventoryQuery, parts: apiInventory } = useInventoryInfinite({
    uid: user?.id ?? null,
    companyId: workspace?.companyId ?? null,
    scope: 'member',
    filters: inventoryFilters,
    enabled: tenantStatus === 'ready' && readScope === 'member',
  });
  const { adjustMutation } = useInventoryMutations({
    uid: user?.id ?? null,
    companyId: workspace?.companyId ?? null,
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim().slice(0, 80));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setInventory(apiInventory);
  }, [apiInventory]);

  useEffect(() => {
    if (inventoryQuery.error) {
      logger.warn('Member inventory refresh failed; retaining cached query data', inventoryQuery.error);
    }
  }, [inventoryQuery.error]);

  const mutateStock = useCallback((
    part: MobileInventoryPart,
    quantityDelta: number,
    success: () => void,
  ) => {
    const body = {
      stockEntityVersion: part.stockEntityVersion,
      quantityDelta,
    };
    const action = `member:adjust:${part.partId}`;
    const key = actionKeys.keyFor(action, JSON.stringify(body));
    void adjustMutation.mutateAsync({
      scope: 'member',
      partId: part.partId,
      body,
      idempotencyKey: key,
    }).then((updated) => {
      actionKeys.complete(action, key);
      const mapped = mapInventoryPartSummary(updated);
      setInventory((current) => current.map((candidate) => (
        candidate.partId === mapped.partId ? mapped : candidate
      )));
      success();
    }).catch((error: unknown) => {
      logger.error('Member inventory mutation failed', error);
      alert.error('Error', error instanceof Error ? error.message : 'Failed to update inventory.');
    });
  }, [actionKeys, adjustMutation, alert]);

  // ─── Common: Use Part ────────────────────────────────────────
  const handleUsePart = useCallback((id: string | number, amount: number) => {
    const part = inventoryRef.current.find(p => p.id === id);
    if (!part) return;
    const quantityDelta = -Math.min(amount, part.quantity);
    if (quantityDelta === 0) {
      alert.warning(t.invalidAmount, t.amountMustBePositive);
      return;
    }
    mutateStock(
      part,
      quantityDelta,
      () => alert.success(t.partUsedSuccess, `${amount} ${t.partUsedMessage} ${part.name}`),
    );
  }, [alert, t, mutateStock]);

  // ─── Common: Add Quantity ────────────────────────────────────
  const handleAddQuantityToPart = useCallback((id: string | number, amount: number) => {
    const part = inventoryRef.current.find(p => p.id === id);
    if (!part) return;
    mutateStock(
      part,
      amount,
      () => alert.success(t.quantityAddedSuccess, `${amount} ${t.quantityAddedMessage} ${part.name}`),
    );
  }, [alert, t, mutateStock]);

  // ─── Common: Remove Part from inventory ──────────────────────
  const handleRemovePart = useCallback((id: string | number) => {
    const part = inventoryRef.current.find(p => p.id === id);
    if (!part) return;
    if (part.quantity <= 0) {
      alert.warning(t.invalidAmount, t.amountMustBePositive);
      return;
    }
    mutateStock(
      part,
      -part.quantity,
      () => alert.success(t.partRemovedSuccess, `${part.name} ${t.partRemovedMessage}`),
    );
  }, [alert, t, mutateStock]);

  // ─── Filtering ───────────────────────────────────────────────
  const safeInventory = Array.isArray(inventory) ? inventory : [];
  const lowStockParts = safeInventory.filter(
    (part) => part.quantity <= (part.lowThreshold || 0)
  );
  const normalStockParts = safeInventory.filter(
    (part) => part.quantity > (part.lowThreshold || 0)
  );

  const listData = useMemo(
    () => [...lowStockParts, ...normalStockParts],
    [lowStockParts, normalStockParts]
  );

  const renderItem = useCallback(({ item }: { item: MobileInventoryPart }) => (
    <InventoryPartRowView
      part={item}
      colors={colors}
      isDarkMode={isDarkMode}
      disabled={adjustMutation.isPending}
      copy={t}
      onRemove={handleRemovePart}
      onUse={handleUsePart}
      onAddQuantity={handleAddQuantityToPart}
    />
  ), [colors, isDarkMode, adjustMutation.isPending, t, handleRemovePart, handleUsePart, handleAddQuantityToPart]);

  const ListHeader = useCallback(() => (
    <View>
      <ScreenHeroCard
        title={t.title}
        subtitle={t.subtitle}
        eyebrow="Inventory"
        icon="package-variant"
        iconLibrary="material"
        accentColor={colors.boxOrange}
        metrics={[
          { label: t.quantity, value: String(safeInventory.length) },
          { label: t.lowStock, value: String(lowStockParts.length) },
        ]}
        badges={[t.addFromCompany, t.searchParts]}
        style={styles.heroCard}
      />

      {/* Low Stock Warning */}
      {lowStockParts.length > 0 && (
        <AppCard style={[styles.warningBox, {
          backgroundColor: isDarkMode ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.05)',
          borderColor: '#ef4444',
        }]}>
          <View style={styles.warningBoxContent}>
            <MaterialCommunityIcons name="alert-circle-outline" size={24} color="#ef4444" style={styles.warningBoxIcon} />
            <View style={styles.warningBoxText}>
              <AppText style={[styles.warningTitle, { color: '#ef4444' }]}>{t.lowStockWarning}</AppText>
              <AppText style={[styles.warningDescription, { color: isDarkMode ? colors.textSecondary : '#7f1d1d' }]}>
                {lowStockParts.length} {lowStockParts.length === 1 ? t.partLowStock : t.partsLowStock}
              </AppText>
            </View>
          </View>
        </AppCard>
      )}

      {/* A secure company catalog/transfer API is required before adding new parts. */}
      <AppButton
        title={`+ ${t.addFromCompany}`}
        onPress={() => undefined}
        disabled
        style={styles.addButton}
      />
      <AppCard style={[styles.catalogNotice, { borderColor: colors.border }]}>
        <MaterialCommunityIcons name="shield-lock-outline" size={20} color={colors.textSecondary} />
        <AppText style={[styles.catalogNoticeText, { color: colors.textSecondary }]}>
          {t.catalogUnavailable}
        </AppText>
      </AppCard>

      <SearchInput
        value={searchQuery}
        onChangeText={(value) => setSearchQuery(value.slice(0, 80))}
        placeholder={t.searchParts}
        colors={colors}
        style={styles.searchInput}
      />

      {inventoryQuery.isError && inventory.length > 0 ? (
        <AppCard style={[styles.queryErrorCard, { borderColor: colors.error }]}>
          <AppText style={{ color: colors.textPrimary }}>{t.refreshFailed}</AppText>
          <AppButton
            title={t.retry}
            size="sm"
            loading={inventoryQuery.isFetching}
            onPress={() => { void inventoryQuery.refetch(); }}
            style={styles.retryButton}
          />
        </AppCard>
      ) : null}
    </View>
  ), [t, colors, isDarkMode, safeInventory, lowStockParts, searchQuery, inventoryQuery, inventory.length]);

  const ListEmpty = useCallback(() => {
    if (inventoryQuery.isLoading) {
      return (
        <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
          <ActivityIndicator size="large" color={colors.secondary} />
          <AppText style={[styles.emptyTitle, { color: colors.textSecondary, marginTop: 16 }]}>{t.loadingInventory}</AppText>
        </View>
      );
    }
    if (inventoryQuery.isError) {
      return (
        <AppEmptyState
          icon="cloud-alert-outline"
          title={t.loadFailed}
          action={
            <AppButton
              title={t.retry}
              loading={inventoryQuery.isFetching}
              onPress={() => { void inventoryQuery.refetch(); }}
              style={{ marginTop: spacing.sm }}
            />
          }
          style={[styles.emptyCard, { backgroundColor: colors.surface }]}
        />
      );
    }
    if (!searchQuery.trim()) {
      return (
        <AppEmptyState
          icon="package-variant"
          title={t.noPartsYet}
          subtitle={t.addFirstPart}
          style={[styles.emptyCard, { backgroundColor: colors.surface }]}
        />
      );
    }
    return <AppEmptyState title={t.noResults} style={[styles.emptyCard, { backgroundColor: colors.surface }]} />;
  }, [inventoryQuery, searchQuery, colors, t]);

  // ─── Render ──────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      <FlatList
        data={listData}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={{
          paddingTop: Platform.OS === 'ios' ? 95 : 85,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.xxxl + 80,
        }}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={inventoryQuery.hasNextPage ? (
          <AppButton
            title={t.loadMore}
            loading={inventoryQuery.isFetchingNextPage}
            disabled={inventoryQuery.isFetchingNextPage}
            onPress={() => { void inventoryQuery.fetchNextPage(); }}
            style={styles.loadMoreButton}
          />
        ) : null}
        refreshing={inventoryQuery.isRefetching && !inventoryQuery.isFetchingNextPage}
        onRefresh={() => { void inventoryQuery.refetch(); }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        {...scrollProps}
      />

      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  warningBox: {
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    ...shadows.sm,
  },
  warningBoxContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  warningBoxIcon: {
    marginRight: spacing.md,
  },
  warningBoxText: {
    flex: 1,
  },
  warningTitle: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    marginBottom: spacing.xs / 2,
    letterSpacing: 0.2,
  },
  warningDescription: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  heroCard: {
    marginBottom: spacing.lg,
  },
  addButton: {
    marginBottom: spacing.md,
  },
  catalogNotice: {
    marginBottom: spacing.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  catalogNoticeText: {
    flex: 1,
    fontSize: typography.sm,
    lineHeight: 20,
  },
  queryErrorCard: {
    marginBottom: spacing.md,
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
    marginTop: spacing.sm,
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
    marginBottom: spacing.xs,
    gap: spacing.xs,
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
  warningIcon: {
    marginRight: spacing.xs,
  },
  partName: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    letterSpacing: -0.2,
    flex: 1,
  },
  partQuantity: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  partActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionButton: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 6,
    borderRadius: borderRadius.md,
  },
  actionButtonText: {
    fontWeight: typography.bold,
    fontSize: typography.xs,
    letterSpacing: 0.3,
  },
  amountInput: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.2)',
  },
  amountTextInput: {
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.base,
    fontWeight: '600',
    borderWidth: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  confirmButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: 'white',
    fontWeight: typography.bold,
    letterSpacing: 0.3,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontWeight: typography.bold,
    letterSpacing: 0.3,
  },
  // ─── Company Parts Picker Modal ───
  pickerOverlay: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  pickerTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    letterSpacing: -0.3,
    flex: 1,
  },
  pickerCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerSearch: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    fontSize: typography.base,
  },
  pickerList: {
    padding: spacing.lg,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    gap: spacing.sm,
  },
  pickerItemName: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    flex: 1,
    letterSpacing: -0.2,
  },
  pickerEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  pickerEmptyText: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
  },
  pickerForm: {
    padding: spacing.lg,
  },
  selectedPartBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  selectedPartName: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    flex: 1,
    letterSpacing: -0.2,
  },
});
