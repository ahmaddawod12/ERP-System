import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Modal,
  FlatList,
 } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { auth, db, doc, getDoc, onSnapshot, setDoc } from '../../firebase';
import { getColors, gradients, spacing, borderRadius, typography, shadows } from '../../theme';
import { AppText, GlobalHeader, ScrollableContainer } from '../../components';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAlert } from '../../contexts/AlertContext';
import { useCache } from '../../contexts/CacheContext';

export default function WorkerInventory() {
  const router = useRouter();
  const { workerId } = useLocalSearchParams();
  const [inventory, setInventory] = useState([]);
  // Manager/Worker role: select from company parts
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);
  const [companyParts, setCompanyParts] = useState([]);
  const [companyPickerSearch, setCompanyPickerSearch] = useState('');
  const [selectedCompanyPart, setSelectedCompanyPart] = useState(null);
  const [addQuantity, setAddQuantity] = useState('');
  const [addLowThreshold, setAddLowThreshold] = useState('');
  // Common states
  const [showUsePart, setShowUsePart] = useState(null);
  const [useAmount, setUseAmount] = useState('');
  const [showAddQuantity, setShowAddQuantity] = useState(null);
  const [addAmount, setAddAmount] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userRole, setUserRole] = useState('user');
  const [isLoadingInventory, setIsLoadingInventory] = useState(true);
  const [isLoadingCompanyParts, setIsLoadingCompanyParts] = useState(false);
  const unsubscribeRef = useRef(null);

  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const {
    inventory: cachedInventory,
    profile,
    getUid,
    getUserRole: getCachedUserRole,
    getCompanyId,
    updateInventory,
    isLoading: cacheLoading
  } = useCache();
  const colors = getColors(isDarkMode);

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

    const targetUid = workerId || getUid() || user.uid;

    // Set user role from cache
    const role = getCachedUserRole();
    if (role) setUserRole(role);

    // If viewing own inventory (not worker's), use cached data
    if (!workerId) {
      if (!cacheLoading) {
        const partsArray = Array.isArray(cachedInventory) ? cachedInventory : [];
        setInventory(partsArray);
        setIsLoadingInventory(false);
      }
    } else {
      // Viewing worker's inventory via WorkersMonitor → set up Firestore listener
      const userDocRef = doc(db, 'users', targetUid, 'data', 'inventory');

      const unsubscribe = onSnapshot(userDocRef, (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          const partsArray = Array.isArray(data.parts) ? data.parts : [];
          setInventory(partsArray);
        } else {
          setInventory([]);
        }
        setIsLoadingInventory(false);
      }, (error) => {
        if (auth.currentUser && error.code !== 'permission-denied') {
          console.log('Firestore listener error:', error.code);
        }
        setIsLoadingInventory(false);
      });

      unsubscribeRef.current = unsubscribe;
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [workerId]);

  // Update inventory from cache when it changes
  useEffect(() => {
    if (!workerId && !cacheLoading) {
      const partsArray = Array.isArray(cachedInventory) ? cachedInventory : [];
      setInventory(partsArray);
      setIsLoadingInventory(false);
    }
  }, [cachedInventory, cacheLoading, workerId]);

  // ─── Load company parts for manager/worker when picker opens ─
  const loadCompanyParts = useCallback(async () => {
    const companyId = getCompanyId();
    if (!companyId) return;

    setIsLoadingCompanyParts(true);
    const companyInvRef = doc(db, 'companies', companyId, 'business_data', 'inventory');

    try {
      const docSnap = await getDoc(companyInvRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        const parts = Array.isArray(data.parts) ? data.parts : [];
        setCompanyParts(parts);
      } else {
        setCompanyParts([]);
      }
    } catch (error) {
      console.error('Error loading company parts:', error);
    } finally {
      setIsLoadingCompanyParts(false);
    }
  }, [getCompanyId]);

  // ─── Save inventory to Firestore & cache ─────────────────────
  const saveInventory = async (updatedInventory) => {
    const user = auth.currentUser;
    if (!user) return;

    const targetUid = workerId || getUid() || user.uid;

    // 1. Update local cache first (if viewing own inventory)
    if (!workerId) {
      await updateInventory(updatedInventory);
    } else {
      // For worker inventory (manager viewing), write directly
      const invRef = doc(db, `users/${targetUid}/data/inventory`);
      await setDoc(invRef, { parts: updatedInventory, lastUpdated: new Date().toISOString() }, { merge: true });
    }
  };

  // ─── MANAGER/WORKER: Add part from company parts ─────────────
  const handleOpenCompanyPicker = () => {
    loadCompanyParts();
    setShowCompanyPicker(true);
    setCompanyPickerSearch('');
    setSelectedCompanyPart(null);
    setAddQuantity('');
    setAddLowThreshold('');
  };

  const handleSelectCompanyPart = (companyPart) => {
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

    const qty = parseInt(addQuantity);
    const lowThres = parseInt(addLowThreshold);
    if (!qty || qty <= 0 || isNaN(lowThres) || lowThres < 0) {
      alert.warning(t.invalidAmount, t.amountMustBePositive);
      return;
    }

    try {
      const part = {
        id: selectedCompanyPart.id, // Same ID as company part — source of truth
        name: selectedCompanyPart.name,
        quantity: qty,
        lowThreshold: lowThres,
        dateAdded: new Date().toISOString(),
      };

      const updated = [...inventory, part];
      await saveInventory(updated);

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
  const handleUsePart = async (id) => {
    const amount = parseInt(useAmount);
    if (!amount || amount <= 0) {
      alert.warning(t.invalidAmount, t.amountMustBePositive);
      return;
    }

    try {
      const part = inventory.find(p => p.id === id);
      const updated = inventory.map((p) =>
        p.id === id ? { ...p, quantity: Math.max(0, p.quantity - amount) } : p
      );
      await saveInventory(updated);

      alert.success(t.partUsedSuccess, `${amount} ${t.partUsedMessage} ${part.name}`);
      setShowUsePart(null);
      setUseAmount('');
    } catch (error) {
      console.error('Error using part:', error);
      alert.error('Error', 'Failed to update inventory. Please try again.');
    }
  };

  // ─── Common: Add Quantity ────────────────────────────────────
  const handleAddQuantityToPart = async (id) => {
    const amount = parseInt(addAmount);
    if (!amount || amount <= 0) {
      alert.warning(t.invalidAmount, t.amountMustBePositive);
      return;
    }

    try {
      const part = inventory.find(p => p.id === id);
      const updated = inventory.map((p) =>
        p.id === id ? { ...p, quantity: p.quantity + amount } : p
      );
      await saveInventory(updated);

      alert.success(t.quantityAddedSuccess, `${amount} ${t.quantityAddedMessage} ${part.name}`);
      setShowAddQuantity(null);
      setAddAmount('');
    } catch (error) {
      console.error('Error adding quantity:', error);
      alert.error('Error', 'Failed to update inventory. Please try again.');
    }
  };

  // ─── Common: Remove Part from inventory ──────────────────────
  // NOTE: Removing does NOT recycle the ID. For user role, nextId stays unchanged.
  // For manager/worker role, the company part ID stays in the company inventory.
  const handleRemovePart = async (id) => {
    try {
      const part = inventory.find(p => p.id === id);
      const updated = inventory.filter((p) => p.id !== id);
      await saveInventory(updated);

      alert.success(t.partRemovedSuccess, `${part.name} ${t.partRemovedMessage}`);
    } catch (error) {
      console.error('Error removing part:', error);
      alert.error('Error', 'Failed to remove part. Please try again.');
    }
  };

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

  // ─── Render a part card ──────────────────────────────────────
  const renderPartCard = (part, isLowStock) => (
    <View key={part.id} style={[styles.partCard, { backgroundColor: colors.surface }]}>
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
              <AppText style={[styles.idBadgeText, { color: colors.secondary }]}>#{part.id}</AppText
            </View>
            <AppText style={[styles.partName, { color: colors.textPrimary }]}>{part.name}</AppText
          </View>
          <AppText style={[styles.partQuantity, { color: colors.textSecondary }]}>
            {t.quantity}: {part.quantity} ({t.alert}: {part.lowThreshold || 0})
          </AppText
        </View>

        <View style={styles.partActions}>
          <TouchableOpacity
            style={[styles.actionButton, {
              backgroundColor: isDarkMode ? 'rgba(0, 172, 193, 0.15)' : 'rgba(0, 172, 193, 0.08)',
              borderColor: colors.secondary,
              borderWidth: 1,
            }]}
            onPress={() => { setShowAddQuantity(part.id); setShowUsePart(null); }}
          >
            <AppText style={[styles.actionButtonText, { color: colors.secondary }]}>+ {t.add}</AppText
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, {
              backgroundColor: isDarkMode ? 'rgba(0, 172, 193, 0.15)' : 'rgba(0, 172, 193, 0.08)',
              borderColor: colors.secondary,
              borderWidth: 1,
            }]}
            onPress={() => { setShowUsePart(part.id); setShowAddQuantity(null); }}
          >
            <AppText style={[styles.actionButtonText, { color: colors.secondary }]}>- {t.use}</AppText
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
                  { text: t.remove, style: 'destructive', onPress: () => handleRemovePart(part.id) },
                ]
              );
            }}
          >
            <AppText style={[styles.actionButtonText, { color: '#ef4444' }]}>🗑</AppText
          </TouchableOpacity>
        </View>
      </View>

      {/* Use Part Input */}
      {showUsePart === part.id && (
        <View style={styles.amountInput}>
          <TextInput
            style={[styles.amountTextInput, {
              backgroundColor: colors.background,
              borderColor: colors.border,
              color: colors.textPrimary,
            }]}
            value={useAmount}
            onChangeText={setUseAmount}
            placeholder={t.amount}
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity onPress={() => handleUsePart(part.id)} style={[styles.confirmButton, { backgroundColor: colors.secondary }]}>
              <AppText style={styles.confirmButtonText}>{t.confirm}</AppText
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setShowUsePart(null); setUseAmount(''); }}
              style={[styles.cancelButton, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}
            >
              <AppText style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{t.cancel}</AppText
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Add Quantity Input */}
      {showAddQuantity === part.id && (
        <View style={styles.amountInput}>
          <TextInput
            style={[styles.amountTextInput, {
              backgroundColor: colors.background,
              borderColor: colors.border,
              color: colors.textPrimary,
            }]}
            value={addAmount}
            onChangeText={setAddAmount}
            placeholder={t.amount}
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity onPress={() => handleAddQuantityToPart(part.id)} style={[styles.confirmButton, { backgroundColor: colors.secondary }]}>
              <AppText style={styles.confirmButtonText}>{t.confirm}</AppText
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setShowAddQuantity(null); setAddAmount(''); }}
              style={[styles.cancelButton, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}
            >
              <AppText style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{t.cancel}</AppText
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );

  // ─── Render ──────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      <ScrollableContainer
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Low Stock Warning */}
        {lowStockParts.length > 0 && (
          <View style={[styles.warningBox, {
            backgroundColor: isDarkMode ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.05)',
            borderColor: '#ef4444',
          }]}>
            <View style={styles.warningBoxContent}>
              <MaterialCommunityIcons name="alert-circle-outline" size={24} color="#ef4444" style={styles.warningBoxIcon} />
              <View style={styles.warningBoxText}>
                <AppText style={[styles.warningTitle, { color: '#ef4444' }]}>{t.lowStockWarning}</AppText
                <AppText style={[styles.warningDescription, { color: isDarkMode ? colors.textSecondary : '#7f1d1d' }]}>
                  {lowStockParts.length} {lowStockParts.length === 1 ? t.partLowStock : t.partsLowStock}
                </AppText
              </View>
            </View>
          </View>
        )}

        {/* Add from Company Parts */}
        <TouchableOpacity onPress={handleOpenCompanyPicker}>
          <LinearGradient colors={gradients.secondary} style={styles.addButton}>
            <AppText style={styles.addButtonText}>+ {t.addFromCompany}</AppText
          </LinearGradient>
        </TouchableOpacity>

        {/* Loading State */}
        {isLoadingInventory || cacheLoading ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
            <ActivityIndicator size="large" color={colors.secondary} />
            <AppText style={[styles.emptyTitle, { color: colors.textSecondary, marginTop: 16 }]}>Loading inventory...</AppText
          </View>
        ) : inventory.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
            <MaterialCommunityIcons name="package-variant" size={48} color={colors.textLight} style={{ marginBottom: 12 }} />
            <AppText style={[styles.emptyTitle, { color: colors.textSecondary }]}>{t.noPartsYet}</AppText
            <AppText style={[styles.emptySubtitle, { color: colors.textLight }]}>{t.addFirstPart}</AppText
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

            {/* Low Stock Parts */}
            {filteredLowStockParts.map((part) => renderPartCard(part, true))}

            {/* Normal Stock Parts */}
            {filteredNormalStockParts.map((part) => renderPartCard(part, false))}

            {filteredLowStockParts.length === 0 && filteredNormalStockParts.length === 0 && (
              <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
                <AppText style={[styles.emptyTitle, { color: colors.textSecondary }]}>{t.noResults}</AppText
              </View>
            )}
          </>
        )}
      </ScrollableContainer>

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
            </AppText
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
                  <AppText style={[styles.idBadgeText, { color: colors.secondary }]}>#{selectedCompanyPart.id}</AppText
                </View>
                <AppText style={[styles.selectedPartName, { color: colors.textPrimary }]}>{selectedCompanyPart.name}</AppText
              </View>

              <View style={styles.inputGroup}>
                <AppText style={[styles.formLabel, { color: colors.textSecondary }]}>{t.initialQuantity}</AppText
                <TextInput
                  style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.textPrimary }]}
                  value={addQuantity}
                  onChangeText={setAddQuantity}
                  placeholder={t.howMany}
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="numeric"
                  autoFocus
                />
              </View>

              <View style={styles.inputGroup}>
                <AppText style={[styles.formLabel, { color: colors.textSecondary }]}>{t.lowStockAlert}</AppText
                <TextInput
                  style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.textPrimary }]}
                  value={addLowThreshold}
                  onChangeText={setAddLowThreshold}
                  placeholder={t.alertAt}
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.formButtonRow}>
                <TouchableOpacity onPress={handleAddCompanyPart} style={[styles.formPrimaryButton, { backgroundColor: colors.secondary }]}>
                  <AppText style={styles.formPrimaryButtonText}>{t.add}</AppText
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setSelectedCompanyPart(null)}
                  style={[styles.formSecondaryButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                >
                  <AppText style={[styles.formSecondaryButtonText, { color: colors.textPrimary }]}>{t.back}</AppText
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            // No selection yet → show list of company parts
            <>
              <TextInput
                style={[styles.pickerSearch, {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.textPrimary,
                }]}
                value={companyPickerSearch}
                onChangeText={setCompanyPickerSearch}
                placeholder={t.searchCompanyParts}
                placeholderTextColor={colors.textSecondary}
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
                  </AppText
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
                        <AppText style={[styles.idBadgeText, { color: colors.secondary }]}>#{item.id}</AppText
                      </View>
                      <AppText style={[styles.pickerItemName, { color: colors.textPrimary }]}>{item.name}</AppText
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
  scrollView: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 95 : 85,
  },
  scrollContent: {
    padding: spacing.lg,
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





