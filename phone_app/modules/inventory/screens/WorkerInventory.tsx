import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { randomUUID } from 'expo-crypto';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getColors, spacing } from '../../../theme';
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
import { getWorkerInventoryCopy } from '../lib/worker-inventory-copy';
import { useInventoryInfinite } from '../lib/use-inventory-infinite';
import { useInventoryMutations } from '../lib/use-inventory-mutations';
import InventoryPartRowView from '../components/InventoryPartRow';
import { styles } from './WorkerInventory.styles';

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

  const t = getWorkerInventoryCopy(language);

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
