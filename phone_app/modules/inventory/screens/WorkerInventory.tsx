import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Modal,
  FlatList,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { auth, functions, httpsCallable } from '../../../firebase';
import { getColors, spacing, borderRadius, typography, shadows } from '../../../theme';
import { AppButton, AppCard, AppEmptyState, AppInput, AppText, GlobalHeader, ScreenHeroCard, SearchInput } from '../../../components';
import { useScrollHandler } from '../../../contexts/HeaderContext';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { fetchUserInventoryParts } from '../../../utils/read-model';
import type { InventoryPart } from '../../../types';

interface PartRowProps {
  part: InventoryPart;
  colors: ReturnType<typeof getColors>;
  isDarkMode: boolean;
  t: Record<string, string>;
  onRemove: (id: string | number) => void;
  onUse: (id: string | number, amount: number) => void;
  onAddQuantity: (id: string | number, amount: number) => void;
}

const InventoryPartRow = memo(function InventoryPartRow({
  part,
  colors,
  isDarkMode,
  t,
  onRemove,
  onUse,
  onAddQuantity,
}: PartRowProps) {
  const alert = useAlert();
  const [useAmount, setUseAmount] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [showUse, setShowUse] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const isLowStock = part.quantity <= (part.lowThreshold || 0);

  const validateAmount = (value: string) => {
    const amount = parseInt(value, 10);
    if (!amount || amount <= 0) {
      alert.warning(t.invalidAmount, t.amountMustBePositive);
      return null;
    }
    return amount;
  };

  const handleUse = () => {
    const amount = validateAmount(useAmount);
    if (amount == null) return;
    onUse(part.id, amount);
    setUseAmount('');
    setShowUse(false);
  };

  const handleAdd = () => {
    const amount = validateAmount(addAmount);
    if (amount == null) return;
    onAddQuantity(part.id, amount);
    setAddAmount('');
    setShowAdd(false);
  };

  return (
    <View style={[styles.partCard, { backgroundColor: colors.surface }]}>
      <View style={styles.partHeader}>
        <View style={styles.partInfo}>
          <View style={styles.partNameRow}>
            {isLowStock && (
              <MaterialCommunityIcons
                name="alert-circle"
                size={24}
                color="#ef4444"
                style={styles.warningIcon}
              />
            )}
            <View style={[styles.idBadge, { backgroundColor: colors.secondary + '20' }]}>
              <AppText style={[styles.idBadgeText, { color: colors.secondary }]}>#{part.id}</AppText>
            </View>
            <AppText style={[styles.partName, { color: colors.textPrimary }]}>{part.name}</AppText>
          </View>
          <AppText style={[styles.partQuantity, { color: colors.textSecondary }]}>
            {t.quantity}: {part.quantity} ({t.alert}: {part.lowThreshold || 0})
          </AppText>
        </View>

        <View style={styles.partActions}>
          <TouchableOpacity
            style={[styles.actionButton, {
              backgroundColor: isDarkMode ? 'rgba(0, 172, 193, 0.15)' : 'rgba(0, 172, 193, 0.08)',
              borderColor: colors.secondary,
              borderWidth: 1,
            }]}
            onPress={() => { setShowAdd(true); setShowUse(false); }}
          >
            <AppText style={[styles.actionButtonText, { color: colors.secondary }]}>+ {t.add}</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, {
              backgroundColor: isDarkMode ? 'rgba(0, 172, 193, 0.15)' : 'rgba(0, 172, 193, 0.08)',
              borderColor: colors.secondary,
              borderWidth: 1,
            }]}
            onPress={() => { setShowUse(true); setShowAdd(false); }}
          >
            <AppText style={[styles.actionButtonText, { color: colors.secondary }]}>- {t.use}</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, {
              backgroundColor: isDarkMode ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.08)',
              borderColor: '#ef4444',
              borderWidth: 1,
            }]}
            onPress={() => {
              alert.confirm(
                t.confirmRemove,
                `${t.areYouSure}\n${part.name}\n\n${t.confirmRemoveMessage}`,
                [
                  { text: t.cancel, style: 'cancel', onPress: () => {} },
                  { text: t.remove, style: 'destructive', onPress: () => onRemove(part.id) },
                ]
              );
            }}
          >
            <AppText style={[styles.actionButtonText, { color: '#ef4444' }]}>🗑</AppText>
          </TouchableOpacity>
        </View>
      </View>

      {/* Use Part Input */}
      {showUse && (
        <View style={styles.amountInput}>
          <AppInput
            value={useAmount}
            onChangeText={setUseAmount}
            placeholder={t.amount}
            keyboardType="numeric"
            colors={colors}
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity onPress={handleUse} style={[styles.confirmButton, { backgroundColor: colors.secondary }]}>
              <AppText style={styles.confirmButtonText}>{t.confirm}</AppText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setShowUse(false); setUseAmount(''); }}
              style={[styles.cancelButton, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}
            >
              <AppText style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{t.cancel}</AppText>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Add Quantity Input */}
      {showAdd && (
        <View style={styles.amountInput}>
          <AppInput
            value={addAmount}
            onChangeText={setAddAmount}
            placeholder={t.amount}
            keyboardType="numeric"
            colors={colors}
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity onPress={handleAdd} style={[styles.confirmButton, { backgroundColor: colors.secondary }]}>
              <AppText style={styles.confirmButtonText}>{t.confirm}</AppText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setShowAdd(false); setAddAmount(''); }}
              style={[styles.cancelButton, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}
            >
              <AppText style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{t.cancel}</AppText>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
});

export default function WorkerInventory() {
  const { wid: rawWorkerId } = useLocalSearchParams();
  const wid = Array.isArray(rawWorkerId) ? rawWorkerId[0] : rawWorkerId;
  const [inventory, setInventory] = useState<InventoryPart[]>([]);
  // Manager/Worker role: select from company parts
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);
  const [companyParts, setCompanyParts] = useState<InventoryPart[]>([]);
  const [companyPickerSearch, setCompanyPickerSearch] = useState('');
  const [selectedCompanyPart, setSelectedCompanyPart] = useState<InventoryPart | null>(null);
  const [addQuantity, setAddQuantity] = useState('');
  const [addLowThreshold, setAddLowThreshold] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingInventory, setIsLoadingInventory] = useState(true);
  const [isLoadingCompanyParts, setIsLoadingCompanyParts] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const { scrollProps } = useScrollHandler();
  const {
    inventory: cachedInventory,
    companyInventory: cachedCompanyInventory,
    getUid,
    getCompanyId,
    updateInventory,
    isLoading: cacheLoading
  } = useCache();
  const colors = getColors(isDarkMode);

  const inventoryRef = useRef(inventory);
  const updateInventoryRef = useRef(updateInventory);
  const widRef = useRef(wid);

  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);
  useEffect(() => { updateInventoryRef.current = updateInventory; }, [updateInventory]);
  useEffect(() => { widRef.current = wid; }, [wid]);

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
  };

  // ─── Load inventory data ─────────────────────────────────────
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const targetUid = wid || getUid() || user.uid;

    // If viewing own inventory (not worker's), use cached data
    if (!wid) {
      if (!cacheLoading) {
        const partsArray = Array.isArray(cachedInventory) ? cachedInventory : [];
        setInventory(partsArray);
        setIsLoadingInventory(false);
      }
    } else {
      const companyId = getCompanyId();
      if (!companyId) {
        setInventory([]);
        setIsLoadingInventory(false);
        return;
      }

      void fetchUserInventoryParts(companyId, targetUid)
        .then((partsArray) => {
          setInventory(partsArray);
        })
        .catch((error) => {
          console.log('Worker inventory fetch error:', error?.message || error);
          setInventory([]);
        })
        .finally(() => {
          setIsLoadingInventory(false);
        });
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [wid]);

  // Update inventory from cache when it changes
  useEffect(() => {
    if (!wid && !cacheLoading) {
      const partsArray = Array.isArray(cachedInventory) ? cachedInventory : [];
      setInventory(partsArray);
      setIsLoadingInventory(false);
    }
  }, [cachedInventory, cacheLoading, wid]);

  // ─── Load company parts for manager/worker when picker opens ─
  const loadCompanyParts = useCallback(async () => {
    setIsLoadingCompanyParts(true);
    try {
      const parts = Array.isArray(cachedCompanyInventory) ? cachedCompanyInventory : [];
      setCompanyParts(parts);
    } catch (error) {
      console.error('Error loading company parts:', error);
    } finally {
      setIsLoadingCompanyParts(false);
    }
  }, [cachedCompanyInventory]);

  // ─── Persist inventory through backend & cache ─────────────────────
  const persistInventory = useCallback(async (updatedInventory: InventoryPart[]) => {
    const user = auth.currentUser;
    if (!user) return;

    const targetUid = widRef.current || getUid() || user.uid;
    const companyId = getCompanyId();
    if (!companyId) {
      throw new Error('Company ID not found');
    }

    if (!widRef.current) {
      await updateInventoryRef.current(updatedInventory);
    } else {
      const updateInventoryFn = httpsCallable(functions, 'updateInventoryV1');
      await updateInventoryFn({
        companyId,
        action: 'replaceParts',
        scope: 'user',
        targetUid,
        parts: Array.isArray(updatedInventory) ? updatedInventory : [],
      });
    }
  }, [getUid, getCompanyId]);

  // ─── MANAGER/WORKER: Add part from company parts ─────────────
  const handleOpenCompanyPicker = () => {
    loadCompanyParts();
    setShowCompanyPicker(true);
    setCompanyPickerSearch('');
    setSelectedCompanyPart(null);
    setAddQuantity('');
    setAddLowThreshold('');
  };

  const handleSelectCompanyPart = (companyPart: InventoryPart) => {
    // Check if already in inventory (no duplicate IDs allowed)
    const exists = inventory.find(p => p.id === companyPart.id);
    if (exists) {
      alert.warning('Warning', t.alreadyInInventory);
      return;
    }
    setSelectedCompanyPart(companyPart);
  };

  const handleAddCompanyPart = async () => {
    if (!selectedCompanyPart || !addQuantity || !addLowThreshold) {
      alert.error('Error', t.fillAllFields);
      return;
    }

    const qty = parseInt(addQuantity, 10);
    const lowThres = parseInt(addLowThreshold, 10);
    if (!qty || qty <= 0 || Number.isNaN(lowThres) || lowThres < 0) {
      alert.warning(t.invalidAmount, t.amountMustBePositive);
      return;
    }

    try {
      const part: InventoryPart = {
        id: selectedCompanyPart.id, // Same ID as company part — source of truth
        name: selectedCompanyPart.name,
        quantity: qty,
        lowThreshold: lowThres,
        dateAdded: new Date().toISOString(),
      };

      const updated = [...inventory, part];
      await persistInventory(updated);
      setInventory(updated);

      alert.success(t.partAddedSuccess, `${part.name} ${t.partAddedMessage}`);
      setShowCompanyPicker(false);
      setSelectedCompanyPart(null);
      setAddQuantity('');
      setAddLowThreshold('');
    } catch (error) {
      console.error('Error adding company part:', error);
      alert.error('Error', 'Failed to add part. Please try again.');
    }
  };

  // ─── Common: Use Part ────────────────────────────────────────
  const handleUsePart = useCallback((id: string | number, amount: number) => {
    const part = inventoryRef.current.find(p => p.id === id);
    if (!part) return;
    const updated = inventoryRef.current.map((p) =>
      p.id === id ? { ...p, quantity: Math.max(0, p.quantity - amount) } : p
    );
    setInventory(updated);
    void persistInventory(updated);

    alert.success(t.partUsedSuccess, `${amount} ${t.partUsedMessage} ${part.name}`);
  }, [alert, t, persistInventory]);

  // ─── Common: Add Quantity ────────────────────────────────────
  const handleAddQuantityToPart = useCallback((id: string | number, amount: number) => {
    const part = inventoryRef.current.find(p => p.id === id);
    if (!part) return;
    const updated = inventoryRef.current.map((p) =>
      p.id === id ? { ...p, quantity: p.quantity + amount } : p
    );
    setInventory(updated);
    void persistInventory(updated);

    alert.success(t.quantityAddedSuccess, `${amount} ${t.quantityAddedMessage} ${part.name}`);
  }, [alert, t, persistInventory]);

  // ─── Common: Remove Part from inventory ──────────────────────
  const handleRemovePart = useCallback((id: string | number) => {
    const part = inventoryRef.current.find(p => p.id === id);
    if (!part) return;
    const updated = inventoryRef.current.filter((p) => p.id !== id);
    setInventory(updated);
    void persistInventory(updated);

    alert.success(t.partRemovedSuccess, `${part.name} ${t.partRemovedMessage}`);
  }, [alert, t, persistInventory]);

  // ─── Filtering ───────────────────────────────────────────────
  const safeInventory = Array.isArray(inventory) ? inventory : [];
  const lowStockParts = safeInventory.filter(
    (part) => part.quantity <= (part.lowThreshold || 0)
  );
  const normalStockParts = safeInventory.filter(
    (part) => part.quantity > (part.lowThreshold || 0)
  );

  const filteredLowStockParts = lowStockParts.filter((part) =>
    part.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredNormalStockParts = normalStockParts.filter((part) =>
    part.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Company parts filter (for picker — only active, not already in inventory)
  const filteredCompanyParts = companyParts
    .filter(p => p.active !== false)
    .filter(p => !inventory.find(inv => inv.id === p.id))
    .filter(p =>
      companyPickerSearch
        ? p.name.toLowerCase().includes(companyPickerSearch.toLowerCase()) ||
          String(p.id).includes(companyPickerSearch)
        : true
    );

  const listData = useMemo(
    () => [...filteredLowStockParts, ...filteredNormalStockParts],
    [filteredLowStockParts, filteredNormalStockParts]
  );

  const renderItem = useCallback(({ item }: { item: InventoryPart }) => (
    <InventoryPartRow
      part={item}
      colors={colors}
      isDarkMode={isDarkMode}
      t={t}
      onRemove={handleRemovePart}
      onUse={handleUsePart}
      onAddQuantity={handleAddQuantityToPart}
    />
  ), [colors, isDarkMode, t, handleRemovePart, handleUsePart, handleAddQuantityToPart]);

  const hasListContent = !isLoadingInventory && !cacheLoading && inventory.length > 0;

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

      {/* Add from Company Parts */}
      <AppButton
        title={`+ ${t.addFromCompany}`}
        onPress={handleOpenCompanyPicker}
        style={styles.addButton}
      />

      {hasListContent && (
        <SearchInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t.searchParts}
          colors={colors}
          style={styles.searchInput}
        />
      )}
    </View>
  ), [t, colors, isDarkMode, safeInventory, lowStockParts, searchQuery, hasListContent, handleOpenCompanyPicker]);

  const ListEmpty = useCallback(() => {
    if (isLoadingInventory || cacheLoading) {
      return (
        <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
          <ActivityIndicator size="large" color={colors.secondary} />
          <AppText style={[styles.emptyTitle, { color: colors.textSecondary, marginTop: 16 }]}>Loading inventory...</AppText>
        </View>
      );
    }
    if (inventory.length === 0) {
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
  }, [isLoadingInventory, cacheLoading, inventory.length, colors, t]);

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
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        {...scrollProps}
      />

      {/* ─── Company Parts Picker Modal (Manager/Worker) ─── */}
      <Modal
        visible={showCompanyPicker}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowCompanyPicker(false);
        }}
      >
        <View style={[styles.pickerOverlay, { backgroundColor: colors.background }]}>
          <View style={[styles.pickerHeader, { borderBottomColor: colors.border }]}>
            <AppText style={[styles.pickerTitle, { color: colors.textPrimary }]}>
              {selectedCompanyPart ? selectedCompanyPart.name : t.selectCompanyPart}
            </AppText>
            <TouchableOpacity
              onPress={() => {
                setShowCompanyPicker(false);
                setSelectedCompanyPart(null);
              }}
              style={[styles.pickerCloseBtn, { backgroundColor: colors.surface }]}
            >
              <MaterialCommunityIcons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {selectedCompanyPart ? (
            // Part selected → show quantity/threshold form
            <View style={styles.pickerForm}>
              <View style={[styles.selectedPartBanner, { backgroundColor: colors.secondary + '15' }]}>
                <View style={[styles.idBadge, { backgroundColor: colors.secondary + '30' }]}>
                  <AppText style={[styles.idBadgeText, { color: colors.secondary }]}>#{selectedCompanyPart.id}</AppText>
                </View>
                <AppText style={[styles.selectedPartName, { color: colors.textPrimary }]}>{selectedCompanyPart.name}</AppText>
              </View>

              <View style={styles.inputGroup}>
                <AppText style={[styles.formLabel, { color: colors.textSecondary }]}>{t.initialQuantity}</AppText>
                <AppInput
                  value={addQuantity}
                  onChangeText={setAddQuantity}
                  placeholder={t.howMany}
                  keyboardType="numeric"
                  autoFocus
                  colors={colors}
                />
              </View>

              <View style={styles.inputGroup}>
                <AppText style={[styles.formLabel, { color: colors.textSecondary }]}>{t.lowStockAlert}</AppText>
                <AppInput
                  value={addLowThreshold}
                  onChangeText={setAddLowThreshold}
                  placeholder={t.alertAt}
                  keyboardType="numeric"
                  colors={colors}
                />
              </View>

              <View style={styles.formButtonRow}>
                <TouchableOpacity onPress={handleAddCompanyPart} style={[styles.formPrimaryButton, { backgroundColor: colors.secondary }]}>
                  <AppText style={styles.formPrimaryButtonText}>{t.add}</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setSelectedCompanyPart(null)}
                  style={[styles.formSecondaryButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                >
                  <AppText style={[styles.formSecondaryButtonText, { color: colors.textPrimary }]}>{t.back}</AppText>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            // No selection yet → show list of company parts
            <>
              <AppInput
                value={companyPickerSearch}
                onChangeText={setCompanyPickerSearch}
                placeholder={t.searchCompanyParts}
                colors={colors}
                containerStyle={styles.pickerSearch}
              />

              {isLoadingCompanyParts ? (
                <View style={styles.pickerEmpty}>
                  <ActivityIndicator size="large" color={colors.secondary} />
                </View>
              ) : filteredCompanyParts.length === 0 ? (
                <View style={styles.pickerEmpty}>
                  <MaterialCommunityIcons name="package-variant" size={48} color={colors.textLight} />
                  <AppText style={[styles.pickerEmptyText, { color: colors.textSecondary }]}>
                    {companyParts.length === 0 ? t.noCompanyParts : t.noActiveCompanyParts}
                  </AppText>
                </View>
              ) : (
                <FlatList
                  data={filteredCompanyParts}
                  keyExtractor={(item) => String(item.id)}
                  contentContainerStyle={styles.pickerList}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.pickerItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
                      onPress={() => handleSelectCompanyPart(item)}
                    >
                      <View style={[styles.idBadge, { backgroundColor: colors.secondary + '20' }]}>
                        <AppText style={[styles.idBadgeText, { color: colors.secondary }]}>#{item.id}</AppText>
                      </View>
                      <AppText style={[styles.pickerItemName, { color: colors.textPrimary }]}>{item.name}</AppText>
                      <MaterialCommunityIcons name="plus-circle-outline" size={24} color={colors.secondary} />
                    </TouchableOpacity>
                  )}
                />
              )}
            </>
          )}
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
