import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { auth, db, doc, runTransaction } from '../../../firebase';
import { getColors, gradients, spacing, borderRadius, typography, shadows } from '../../../theme';
import { GlobalHeader, ScrollableContainer } from '../../../components';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';

export default function UserInventory() {
  const router = useRouter();
  const [inventory, setInventory] = useState([]);
  const [showAddPart, setShowAddPart] = useState(false);
  const [newPart, setNewPart] = useState({ name: '', quantity: '', lowThreshold: '' });
  // Common states
  const [showUsePart, setShowUsePart] = useState(null);
  const [useAmount, setUseAmount] = useState('');
  const [showAddQuantity, setShowAddQuantity] = useState(null);
  const [addAmount, setAddAmount] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingInventory, setIsLoadingInventory] = useState(true);

  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const {
    inventory: cachedInventory,
    getUid,
    updateInventory,
    isLoading: cacheLoading
  } = useCache();
  const colors = getColors(isDarkMode);

  const t = language === 'en' ? {
    title: 'Cooling Parts',
    subtitle: 'Inventory Manager',
    addNewPart: 'Add New Part',
    yourParts: 'Your Parts',
    noPartsYet: 'No parts yet.',
    addFirstPart: 'Add your first part!',
    partName: 'Part Name',
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
    egParts: 'Enter part name (e.g., Valve, Cable)',
    partNamePlaceholder: 'Part name...',
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
  } : language === 'he' ? {
    title: 'חלקי קירור',
    subtitle: 'מנהל מלאי',
    addNewPart: 'הוסף חלק חדש',
    yourParts: 'החלקים שלך',
    noPartsYet: 'אין חלקים עדיין.',
    addFirstPart: 'הוסף את החלק הראשון שלך!',
    partName: 'שם החלק',
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
    egParts: 'הזן שם חלק (לדוגמה: שסתום, כבל)',
    partNamePlaceholder: 'שם החלק...',
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
  } : {
    title: 'قطع التبريد',
    subtitle: 'مدير المخزون',
    addNewPart: 'إضافة قطعة جديدة',
    yourParts: 'قطعك',
    noPartsYet: 'لا توجد قطع بعد.',
    addFirstPart: 'أضف قطعتك الأولى!',
    partName: 'اسم القطعة',
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
    egParts: 'أدخل اسم القطعة (مثال: صمام، كابل)',
    partNamePlaceholder: 'اسم القطعة...',
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
  };

  // ─── Load inventory from cache ───────────────────────────────
  useEffect(() => {
    if (!cacheLoading) {
      const partsArray = Array.isArray(cachedInventory) ? cachedInventory : [];
      setInventory(partsArray);
      setIsLoadingInventory(false);
    }
  }, [cachedInventory, cacheLoading]);

  // ─── Save inventory to cache ─────────────────────────────────
  const saveInventory = async (updatedInventory) => {
    await updateInventory(updatedInventory);
  };

  // ─── Add part with own sequential nextId ─────────────────────
  const handleAddPartUser = async () => {
    if (!newPart.name || !newPart.quantity || !newPart.lowThreshold) {
      alert.error('Error', t.fillAllFields);
      return;
    }

    try {
      const user = auth.currentUser;
      const targetUid = getUid() || user.uid;
      const userDocRef = doc(db, targetUid, 'inventory');

      let updatedParts = [];

      // Use Firestore transaction to safely get/increment nextId
      await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(userDocRef);
        let currentParts = [];
        let nextId = 1;

        if (docSnap.exists()) {
          const data = docSnap.data();
          currentParts = Array.isArray(data.parts) ? data.parts : [];
          nextId = typeof data.nextId === 'number'
            ? data.nextId
            : (currentParts.length > 0 ? Math.max(...currentParts.map(p => p.id)) + 1 : 1);
        }

        const part = {
          id: nextId,
          name: newPart.name.trim(),
          quantity: parseInt(newPart.quantity),
          lowThreshold: parseInt(newPart.lowThreshold),
          dateAdded: new Date().toISOString(),
        };

        updatedParts = [...currentParts, part];
        transaction.set(userDocRef, {
          parts: updatedParts,
          nextId: nextId + 1,
          lastUpdated: new Date().toISOString(),
        });
      });

      // Update local state and sync cache
      setInventory(updatedParts);
      await updateInventory(updatedParts);

      alert.success(t.partAddedSuccess, `${newPart.name} ${t.partAddedMessage}`);
      setNewPart({ name: '', quantity: '', lowThreshold: '' });
      setShowAddPart(false);
    } catch (error) {
      console.error('Error adding part:', error);
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
  // NOTE: Removing does NOT recycle the ID. nextId stays unchanged.
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
              <Text style={[styles.idBadgeText, { color: colors.secondary }]}>#{part.id}</Text>
            </View>
            <Text style={[styles.partName, { color: colors.textPrimary }]}>{part.name}</Text>
          </View>
          <Text style={[styles.partQuantity, { color: colors.textSecondary }]}>
            {t.quantity}: {part.quantity} ({t.alert}: {part.lowThreshold || 0})
          </Text>
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
            <Text style={[styles.actionButtonText, { color: colors.secondary }]}>+ {t.add}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, {
              backgroundColor: isDarkMode ? 'rgba(0, 172, 193, 0.15)' : 'rgba(0, 172, 193, 0.08)',
              borderColor: colors.secondary,
              borderWidth: 1,
            }]}
            onPress={() => { setShowUsePart(part.id); setShowAddQuantity(null); }}
          >
            <Text style={[styles.actionButtonText, { color: colors.secondary }]}>- {t.use}</Text>
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
            <Text style={[styles.actionButtonText, { color: '#ef4444' }]}>🗑</Text>
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
              <Text style={styles.confirmButtonText}>{t.confirm}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setShowUsePart(null); setUseAmount(''); }}
              style={[styles.cancelButton, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}
            >
              <Text style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{t.cancel}</Text>
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
              <Text style={styles.confirmButtonText}>{t.confirm}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setShowAddQuantity(null); setAddAmount(''); }}
              style={[styles.cancelButton, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}
            >
              <Text style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{t.cancel}</Text>
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
                <Text style={[styles.warningTitle, { color: '#ef4444' }]}>{t.lowStockWarning}</Text>
                <Text style={[styles.warningDescription, { color: isDarkMode ? colors.textSecondary : '#7f1d1d' }]}>
                  {lowStockParts.length} {lowStockParts.length === 1 ? t.partLowStock : t.partsLowStock}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Add New Part Button */}
        <TouchableOpacity onPress={() => setShowAddPart(!showAddPart)}>
          <LinearGradient colors={gradients.secondary} style={styles.addButton}>
            <Text style={styles.addButtonText}>+ {t.addNewPart}</Text>
          </LinearGradient>
        </TouchableOpacity>

        {showAddPart && (
          <View style={[styles.formCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.formTitle, { color: colors.textPrimary }]}>{t.addNewPart}</Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.formLabel, { color: colors.textSecondary }]}>{t.partName}</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.textPrimary }]}
                value={newPart.name}
                onChangeText={(text) => setNewPart({ ...newPart, name: text })}
                placeholder={t.egParts}
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.formLabel, { color: colors.textSecondary }]}>{t.initialQuantity}</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.textPrimary }]}
                value={newPart.quantity}
                onChangeText={(text) => setNewPart({ ...newPart, quantity: text })}
                placeholder={t.howMany}
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.formLabel, { color: colors.textSecondary }]}>{t.lowStockAlert}</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.textPrimary }]}
                value={newPart.lowThreshold}
                onChangeText={(text) => setNewPart({ ...newPart, lowThreshold: text })}
                placeholder={t.alertAt}
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
              />
            </View>

            <View style={styles.formButtonRow}>
              <TouchableOpacity onPress={handleAddPartUser} style={[styles.formPrimaryButton, { backgroundColor: colors.secondary }]}>
                <Text style={styles.formPrimaryButtonText}>{t.add}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowAddPart(false)}
                style={[styles.formSecondaryButton, { backgroundColor: colors.background, borderColor: colors.border }]}
              >
                <Text style={[styles.formSecondaryButtonText, { color: colors.textPrimary }]}>{t.cancel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Loading State */}
        {isLoadingInventory || cacheLoading ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
            <ActivityIndicator size="large" color={colors.secondary} />
            <Text style={[styles.emptyTitle, { color: colors.textSecondary, marginTop: 16 }]}>Loading inventory...</Text>
          </View>
        ) : inventory.length === 0 ? (
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

            {/* Low Stock Parts */}
            {filteredLowStockParts.map((part) => renderPartCard(part, true))}

            {/* Normal Stock Parts */}
            {filteredNormalStockParts.map((part) => renderPartCard(part, false))}

            {filteredLowStockParts.length === 0 && filteredNormalStockParts.length === 0 && (
              <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
                <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>{t.noResults}</Text>
              </View>
            )}
          </>
        )}
      </ScrollableContainer>

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
});
