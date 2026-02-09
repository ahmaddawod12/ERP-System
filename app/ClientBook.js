/**
 * ClientBook.js - Client management screen
 * 
 * Allows users to view, search, add, edit, and delete clients.
 * All fields combined from job forms and document forms.
 * Available to all roles (Manager, Worker, User, Basic).
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  ActivityIndicator,
  FlatList,
  ScrollView,
  TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getColors, gradients, spacing, borderRadius, typography, shadows } from '../theme';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { useAlert } from '../contexts/AlertContext';
import { useCache } from '../contexts/CacheContext';
import { GlobalHeader, ScrollableContainer } from '../components';

export default function ClientBook() {
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const insets = useSafeAreaInsets();
  const colors = getColors(isDarkMode);
  const {
    clients: cachedClients,
    addClient,
    updateClient,
    deleteClient,
    fetchClients,
  } = useCache();

  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState(null); // null = add new, object = editing
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    vatNumber: '',
  });

  const t = language === 'en' ? {
    title: 'Client Book',
    subtitle: 'Manage your clients',
    searchPlaceholder: 'Search clients...',
    addClient: 'New Client',
    editClient: 'Edit Client',
    noClients: 'No clients yet',
    noClientsDesc: 'Tap the + button to add your first client',
    noResults: 'No clients found',
    noResultsDesc: 'Try a different search term',
    name: 'Client Name',
    phone: 'Phone Number',
    email: 'Email Address',
    address: 'Address',
    city: 'City',
    vatNumber: 'VAT Number',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    deleteConfirm: 'Delete Client',
    deleteMessage: 'Are you sure you want to delete this client? This action cannot be undone.',
    clientSaved: 'Client saved successfully',
    clientUpdated: 'Client updated successfully',
    clientDeleted: 'Client deleted successfully',
    required: 'Client name is required',
    totalClients: 'clients',
  } : language === 'he' ? {
    title: 'ספר לקוחות',
    subtitle: 'ניהול הלקוחות שלך',
    searchPlaceholder: 'חיפוש לקוחות...',
    addClient: 'לקוח חדש',
    editClient: 'עריכת לקוח',
    noClients: 'אין לקוחות עדיין',
    noClientsDesc: 'לחץ על כפתור + להוספת לקוח ראשון',
    noResults: 'לא נמצאו לקוחות',
    noResultsDesc: 'נסה מילת חיפוש אחרת',
    name: 'שם לקוח',
    phone: 'מספר טלפון',
    email: 'כתובת אימייל',
    address: 'כתובת',
    city: 'עיר',
    vatNumber: 'מספר עוסק מורשה',
    save: 'שמור',
    cancel: 'ביטול',
    delete: 'מחק',
    deleteConfirm: 'מחיקת לקוח',
    deleteMessage: 'האם אתה בטוח שברצונך למחוק לקוח זה? פעולה זו לא ניתנת לביטול.',
    clientSaved: 'הלקוח נשמר בהצלחה',
    clientUpdated: 'הלקוח עודכן בהצלחה',
    clientDeleted: 'הלקוח נמחק בהצלחה',
    required: 'שם לקוח נדרש',
    totalClients: 'לקוחות',
  } : {
    title: 'دفتر العملاء',
    subtitle: 'إدارة عملائك',
    searchPlaceholder: 'البحث عن عملاء...',
    addClient: 'عميل جديد',
    editClient: 'تعديل عميل',
    noClients: 'لا يوجد عملاء بعد',
    noClientsDesc: 'اضغط على زر + لإضافة أول عميل',
    noResults: 'لم يتم العثور على عملاء',
    noResultsDesc: 'جرب كلمة بحث مختلفة',
    name: 'اسم العميل',
    phone: 'رقم الهاتف',
    email: 'البريد الإلكتروني',
    address: 'العنوان',
    city: 'المدينة',
    vatNumber: 'رقم ضريبي',
    save: 'حفظ',
    cancel: 'إلغاء',
    delete: 'حذف',
    deleteConfirm: 'حذف عميل',
    deleteMessage: 'هل أنت متأكد أنك تريد حذف هذا العميل؟ لا يمكن التراجع عن هذا الإجراء.',
    clientSaved: 'تم حفظ العميل بنجاح',
    clientUpdated: 'تم تحديث العميل بنجاح',
    clientDeleted: 'تم حذف العميل بنجاح',
    required: 'اسم العميل مطلوب',
    totalClients: 'عملاء',
  };

  // Fetch clients on mount
  useEffect(() => {
    if (cachedClients.length === 0) {
      fetchClients();
    }
  }, []);

  // Filter clients by search
  const filteredClients = useMemo(() => {
    if (!searchQuery.trim()) return cachedClients;
    const q = searchQuery.toLowerCase();
    const filtered = cachedClients.filter(client =>
      (client.name && client.name.toLowerCase().includes(q)) ||
      (client.phone && client.phone.toLowerCase().includes(q)) ||
      (client.email && client.email.toLowerCase().includes(q)) ||
      (client.address && client.address.toLowerCase().includes(q)) ||
      (client.city && client.city.toLowerCase().includes(q)) ||
      (client.vatNumber && client.vatNumber.toLowerCase().includes(q)) ||
      (client.id && client.id.toString().includes(q))
    );
    
    // Deduplicate by ID to prevent key conflicts
    const seen = new Set();
    return filtered.filter(client => {
      if (seen.has(client.id)) {
        return false;
      }
      seen.add(client.id);
      return true;
    });
  }, [cachedClients, searchQuery]);

  const resetForm = () => {
    setFormData({ name: '', phone: '', email: '', address: '', city: '', vatNumber: '' });
    setEditingClient(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (client) => {
    setEditingClient(client);
    setFormData({
      name: client.name || '',
      phone: client.phone || '',
      email: client.email || '',
      address: client.address || '',
      city: client.city || '',
      vatNumber: client.vatNumber || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      alert.warning(t.required, t.required);
      return;
    }

    Keyboard.dismiss();
    setLoading(true);

    try {
      const clientData = {};
      if (formData.name.trim()) clientData.name = formData.name.trim();
      if (formData.phone.trim()) clientData.phone = formData.phone.trim();
      if (formData.email.trim()) clientData.email = formData.email.trim();
      if (formData.address.trim()) clientData.address = formData.address.trim();
      if (formData.city.trim()) clientData.city = formData.city.trim();
      if (formData.vatNumber.trim()) clientData.vatNumber = formData.vatNumber.trim();

      if (editingClient) {
        await updateClient(editingClient.id, clientData);
        alert.success('✅', t.clientUpdated);
      } else {
        await addClient(clientData);
        alert.success('✅', t.clientSaved);
      }

      setShowModal(false);
      resetForm();
    } catch (error) {
      console.error('Error saving client:', error);
      alert.error('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (client) => {
    alert.confirm(
      t.deleteConfirm,
      t.deleteMessage,
      [
        { text: t.cancel, style: 'cancel', onPress: () => {} },
        {
          text: t.delete,
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteClient(client.id);
              alert.success('✅', t.clientDeleted);
              if (showModal) {
                setShowModal(false);
                resetForm();
              }
            } catch (error) {
              console.error('Error deleting client:', error);
              alert.error('Error', error.message);
            }
          },
        },
      ]
    );
  };

  const renderClientCard = ({ item: client }) => (
    <TouchableOpacity
      style={[styles.clientCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => openEditModal(client)}
      activeOpacity={0.7}
    >
      <View style={styles.clientCardRow}>
        <View style={[styles.clientAvatar, { backgroundColor: colors.secondary + '15' }]}>
          <MaterialCommunityIcons name="account" size={28} color={colors.secondary} />
        </View>
        <View style={styles.clientCardInfo}>
          <View style={styles.clientNameRow}>
            <Text style={[styles.clientName, { color: colors.textPrimary }]} numberOfLines={1}>
              {client.name}
            </Text>
            <View style={[styles.idBadge, { backgroundColor: colors.secondary + '15' }]}>
              <Text style={[styles.idBadgeText, { color: colors.secondary }]}>#{client.id}</Text>
            </View>
          </View>
          {client.phone ? (
            <View style={styles.detailRow}>
              <Ionicons name="call-outline" size={13} color={colors.textSecondary} />
              <Text style={[styles.clientDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                {client.phone}
              </Text>
            </View>
          ) : null}
          {client.email ? (
            <View style={styles.detailRow}>
              <Ionicons name="mail-outline" size={13} color={colors.textSecondary} />
              <Text style={[styles.clientDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                {client.email}
              </Text>
            </View>
          ) : null}
          {client.address || client.city ? (
            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
              <Text style={[styles.clientDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                {[client.address, client.city].filter(Boolean).join(', ')}
              </Text>
            </View>
          ) : null}
          {client.vatNumber ? (
            <View style={styles.detailRow}>
              <MaterialCommunityIcons name="file-document-outline" size={13} color={colors.textSecondary} />
              <Text style={[styles.clientDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                {client.vatNumber}
              </Text>
            </View>
          ) : null}
        </View>
        <Feather name="chevron-right" size={20} color={colors.textLight} />
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialCommunityIcons
        name={searchQuery ? 'account-search' : 'book-account-outline'}
        size={72}
        color={colors.textLight}
      />
      <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
        {searchQuery ? t.noResults : t.noClients}
      </Text>
      <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>
        {searchQuery ? t.noResultsDesc : t.noClientsDesc}
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.headerContainer, { paddingTop: insets.top + 50 }]}>
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerGradient}
        >
          <View style={styles.headerContent}>
            <View>
              <Text style={styles.headerTitle}>{t.title}</Text>
              <Text style={styles.headerSubtitle}>
                {cachedClients.length} {t.totalClients}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.addButton}
              onPress={openAddModal}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={28} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>

      {/* Search Bar */}
      <View style={[styles.searchWrapper, { backgroundColor: colors.background }]}>
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialCommunityIcons name="book-account-outline" size={20} color={colors.secondary} />
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.textPrimary }]}
            placeholder={t.searchPlaceholder}
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Client List */}
      <FlatList
        data={filteredClients}
        renderItem={renderClientCard}
        keyExtractor={(item, index) => `client-${item.id}-${index}-${item.name?.substring(0,3) || 'x'}`}
        contentContainerStyle={[
          styles.listContent,
          filteredClients.length === 0 && styles.listContentEmpty,
        ]}
        ListEmptyComponent={renderEmptyState}
        showsVerticalScrollIndicator={false}
      />

      {/* Add/Edit Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowModal(false);
          resetForm();
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <LinearGradient
                  colors={editingClient ? gradients.secondary : gradients.primary}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.modalHeaderGradient}
                >
                  <MaterialCommunityIcons
                    name={editingClient ? 'account-edit' : 'account-plus'}
                    size={28}
                    color="white"
                  />
                  <Text style={styles.modalTitle}>
                    {editingClient ? t.editClient : t.addClient}
                  </Text>
                </LinearGradient>
              </View>

              {/* Form */}
              <ScrollView 
                style={styles.formScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
              {/* Name */}
              <View style={styles.formField}>
                <View style={styles.fieldLabelRow}>
                  <Ionicons name="person" size={16} color={colors.secondary} />
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                    {t.name} *
                  </Text>
                </View>
                <TextInput
                  style={[styles.formInput, {
                    backgroundColor: colors.backgroundLight,
                    borderColor: formData.name ? colors.secondary : colors.border,
                    color: colors.textPrimary,
                  }]}
                  placeholder={t.name}
                  placeholderTextColor={colors.textLight}
                  value={formData.name}
                  onChangeText={(text) => setFormData({ ...formData, name: text })}
                  autoFocus={!editingClient}
                />
              </View>

              {/* Phone */}
              <View style={styles.formField}>
                <View style={styles.fieldLabelRow}>
                  <Ionicons name="call" size={16} color={colors.secondary} />
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                    {t.phone}
                  </Text>
                </View>
                <TextInput
                  style={[styles.formInput, {
                    backgroundColor: colors.backgroundLight,
                    borderColor: formData.phone ? colors.secondary : colors.border,
                    color: colors.textPrimary,
                  }]}
                  placeholder={t.phone}
                  placeholderTextColor={colors.textLight}
                  value={formData.phone}
                  onChangeText={(text) => setFormData({ ...formData, phone: text })}
                  keyboardType="phone-pad"
                />
              </View>

              {/* Email */}
              <View style={styles.formField}>
                <View style={styles.fieldLabelRow}>
                  <Ionicons name="mail" size={16} color={colors.secondary} />
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                    {t.email}
                  </Text>
                </View>
                <TextInput
                  style={[styles.formInput, {
                    backgroundColor: colors.backgroundLight,
                    borderColor: formData.email ? colors.secondary : colors.border,
                    color: colors.textPrimary,
                  }]}
                  placeholder={t.email}
                  placeholderTextColor={colors.textLight}
                  value={formData.email}
                  onChangeText={(text) => setFormData({ ...formData, email: text })}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              {/* Address */}
              <View style={styles.formField}>
                <View style={styles.fieldLabelRow}>
                  <Ionicons name="location" size={16} color={colors.secondary} />
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                    {t.address}
                  </Text>
                </View>
                <TextInput
                  style={[styles.formInput, {
                    backgroundColor: colors.backgroundLight,
                    borderColor: formData.address ? colors.secondary : colors.border,
                    color: colors.textPrimary,
                  }]}
                  placeholder={t.address}
                  placeholderTextColor={colors.textLight}
                  value={formData.address}
                  onChangeText={(text) => setFormData({ ...formData, address: text })}
                />
              </View>

              {/* City */}
              <View style={styles.formField}>
                <View style={styles.fieldLabelRow}>
                  <MaterialCommunityIcons name="city" size={16} color={colors.secondary} />
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                    {t.city}
                  </Text>
                </View>
                <TextInput
                  style={[styles.formInput, {
                    backgroundColor: colors.backgroundLight,
                    borderColor: formData.city ? colors.secondary : colors.border,
                    color: colors.textPrimary,
                  }]}
                  placeholder={t.city}
                  placeholderTextColor={colors.textLight}
                  value={formData.city}
                  onChangeText={(text) => setFormData({ ...formData, city: text })}
                />
              </View>

              {/* VAT Number */}
              <View style={styles.formField}>
                <View style={styles.fieldLabelRow}>
                  <MaterialCommunityIcons name="file-document-outline" size={16} color={colors.secondary} />
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                    {t.vatNumber}
                  </Text>
                </View>
                <TextInput
                  style={[styles.formInput, {
                    backgroundColor: colors.backgroundLight,
                    borderColor: formData.vatNumber ? colors.secondary : colors.border,
                    color: colors.textPrimary,
                  }]}
                  placeholder={t.vatNumber}
                  placeholderTextColor={colors.textLight}
                  value={formData.vatNumber}
                  onChangeText={(text) => setFormData({ ...formData, vatNumber: text })}
                  keyboardType="numeric"
                />
              </View>
            </ScrollView>

            {/* Action Buttons */}
            <View style={styles.modalActions}>
              {editingClient && (
                <TouchableOpacity
                  style={[styles.deleteButton, { borderColor: colors.error }]}
                  onPress={() => handleDelete(editingClient)}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.error} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.cancelButton, { borderColor: colors.border, flex: 1 }]}
                onPress={() => {
                  setShowModal(false);
                  resetForm();
                }}
              >
                <Text style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButtonWrapper, { flex: 1 }]}
                onPress={handleSave}
                disabled={loading}
              >
                <LinearGradient
                  colors={editingClient ? gradients.secondary : gradients.primary}
                  style={styles.saveButton}
                >
                  {loading ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={20} color="white" />
                      <Text style={styles.saveButtonText}>{t.save}</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Header
  headerContainer: {
    zIndex: 1,
  },
  headerGradient: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomLeftRadius: borderRadius.xl,
    borderBottomRightRadius: borderRadius.xl,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: typography.xxl + 2,
    fontWeight: typography.bold,
    color: 'white',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: typography.sm,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.md,
  },
  // Search
  searchWrapper: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    height: 48,
    gap: spacing.xs,
    ...shadows.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.base,
    paddingVertical: 0,
  },
  // List
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl + 20,
  },
  listContentEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  // Client Card
  clientCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  clientCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clientAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  clientCardInfo: {
    flex: 1,
  },
  clientNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 3,
  },
  clientName: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    flex: 1,
  },
  idBadge: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  idBadgeText: {
    fontSize: typography.xs - 1,
    fontWeight: typography.bold,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  clientDetail: {
    fontSize: typography.xs,
    flex: 1,
  },
  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl * 2,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    marginTop: spacing.sm,
  },
  emptyDesc: {
    fontSize: typography.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContainer: {
    borderTopLeftRadius: borderRadius.xl + 4,
    borderTopRightRadius: borderRadius.xl + 4,
    maxHeight: '85%',
    ...shadows.lg,
  },
  modalHeader: {
    overflow: 'hidden',
    borderTopLeftRadius: borderRadius.xl + 4,
    borderTopRightRadius: borderRadius.xl + 4,
  },
  modalHeaderGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  modalTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: 'white',
  },
  // Form
  formScroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  formField: {
    marginBottom: spacing.md,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  formInput: {
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    fontSize: typography.base,
  },
  // Actions
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  deleteButton: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    height: 48,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  saveButtonWrapper: {
    height: 48,
  },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  saveButtonText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    color: 'white',
  },
});
