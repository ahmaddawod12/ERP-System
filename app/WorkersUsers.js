import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
  KeyboardAvoidingView,
  SafeAreaView,
  Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { auth, db, functions, collection, getDocs, httpsCallable } from '../firebase';
import { colors, gradients, shadows, getColors } from '../theme';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { useAlert } from '../contexts/AlertContext';
import { useCache } from '../contexts/CacheContext';
import { GlobalHeader, ScrollableContainer } from '../components';

export default function WorkersUsers() {
  const router = useRouter();
  const { language, toggleLanguage } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const {
    getCompanyName,
    getUsername,
    workers: cachedWorkersList,
    addWorker,
    editWorker,
    deleteWorker,
  } = useCache();
  const themeColors = getColors(isDarkMode);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddWorker, setShowAddWorker] = useState(false);
  const [showEditWorker, setShowEditWorker] = useState(false);
  const [newWorker, setNewWorker] = useState({ email: '', password: '', phoneNumber: '', name: '' });
  const [editingWorker, setEditingWorker] = useState(null);

  const t = language === 'en' ? {
    title: 'Manage Workers',
    subtitle: 'Create, edit, and delete worker accounts',
    back: 'Back',
    addWorker: 'Add Worker',
    editWorker: 'Edit Worker',
    username: 'Username',
    password: 'Password',
    email: 'Email',
    name: 'Worker Name',
    phoneNumber: 'Phone Number (Optional)',
    submit: 'Submit',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    noWorkers: 'No workers yet',
    fillAllFields: 'Please fill all fields',
    workerAdded: 'Worker added successfully',
    workerUpdated: 'Worker updated successfully',
    workerDeleted: 'Worker deleted successfully',
    confirmDelete: 'Are you sure you want to delete this worker?',
    error: 'Error',
  } : language === 'he' ? {
    title: 'ניהול עובדים',
    subtitle: 'יצירה, עריכה ומחיקת חשבונות עובדים',
    back: 'חזרה',
    addWorker: 'הוסף עובד',
    editWorker: 'ערוך עובד',
    username: 'שם משתמש',
    password: 'סיסמה',
    email: 'אימייל',
    name: 'שם העובד',
    phoneNumber: 'מספר טלפון (אופציונלי)',
    submit: 'שלח',
    cancel: 'ביטול',
    delete: 'מחק',
    edit: 'ערוך',
    noWorkers: 'אין עובדים עדיין',
    fillAllFields: 'אנא מלא את כל השדות',
    workerAdded: 'העובד נוסף בהצלחה',
    workerUpdated: 'העובד עודכן בהצלחה',
    workerDeleted: 'העובד נמחק בהצלחה',
    confirmDelete: 'האם אתה בטוח שברצונך למחוק עובד זה?',
    error: 'שגיאה',
  } : {
    title: 'إدارة العمال',
    subtitle: 'إنشاء وتعديل وحذف حسابات العمال',
    back: 'رجوع',
    addWorker: 'إضافة عامل',
    editWorker: 'تعديل عامل',
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
    email: 'البريد الإلكتروني',
    name: 'اسم العامل',
    phoneNumber: 'رقم الهاتف (اختياري)',
    submit: 'إرسال',
    cancel: 'إلغاء',
    delete: 'حذف',
    edit: 'تعديل',
    noWorkers: 'لا يوجد عمال بعد',
    fillAllFields: 'يرجى ملء جميع الحقول',
    workerAdded: 'تمت إضافة العامل بنجاح',
    workerUpdated: 'تم تحديث العامل بنجاح',
    workerDeleted: 'تم حذف العامل بنجاح',
    confirmDelete: 'هل أنت متأكد من حذف هذا العامل؟',
    error: 'خطأ',
  };

  const getUsernameFromEmail = (email) => {
    return email.split('@')[0];
  };

  useEffect(() => {
    loadWorkers();
  }, []);

  // Watch for cached workers list changes and re-sync
  useEffect(() => {
    if (cachedWorkersList && Object.keys(cachedWorkersList).length > 0) {
      console.log('📦 WorkersUsers: cached workers list updated - re-syncing');
      loadWorkers();
    }
  }, [cachedWorkersList]);

  const loadWorkers = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const managerUsername = getUsername() || getUsernameFromEmail(user.email);
      
      // Get manager's companyName from cache
      const companyName = getCompanyName();
      
      if (!companyName) {
        console.error('CompanyName not found in cache');
        setLoading(false);
        return;
      }
      
      // Use cached workers list if available (it's an object keyed by email)
      if (cachedWorkersList && Object.keys(cachedWorkersList).length > 0) {
        console.log('📦 [CACHE READ] WorkersUsers - workers list from cache:', Object.keys(cachedWorkersList).length, 'workers');
        const workersList = Object.keys(cachedWorkersList).map(email => {
          const workerData = cachedWorkersList[email];
          return {
            email: email,
            password: workerData?.password || workerData || '',
            phoneNumber: workerData?.phoneNumber || '',
            name: workerData?.name || '',
            username: getUsernameFromEmail(email),
          };
        });
        setWorkers(workersList);
        setLoading(false);
        return;
      }
      
      // Fallback to Firebase
      console.log('🔥 [FIREBASE READ] WorkersUsers - fetching workers from Firebase (no cache)');
      const workersCollectionRef = collection(db, 'companies', companyName, 'workers');
      const workersSnapshot = await getDocs(workersCollectionRef);

      if (!workersSnapshot.empty) {
        const workersData = {};
        const workersList = workersSnapshot.docs.map((doc) => {
          const workerData = doc.data();
          // Store in object format for cache
          workersData[workerData.email] = {
            password: workerData.password || '',
            phoneNumber: workerData.phoneNumber || '',
            name: workerData.name || '',
          };
          return {
            email: workerData.email,
            password: workerData.password || '',
            phoneNumber: workerData.phoneNumber || '',
            name: workerData.name || '',
            username: doc.id, // Document ID is the username
          };
        });
        setWorkers(workersList);
        // Update cache with object format
        await updateWorkersList(workersData);
      }
    } catch (error) {
      console.error('Error loading workers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddWorker = async () => {
    if (!newWorker.email || !newWorker.password || !newWorker.name) {
      alert.error(t.error, t.fillAllFields);
      return;
    }

    try {
      setLoading(true);
      const user = auth.currentUser;
      
      if (!user) {
        alert.error(t.error, 'User not authenticated');
        setLoading(false);
        return;
      }
      
      // Force token refresh to ensure authentication
      await user.getIdToken(true);
      
      // Get manager's companyName from cache
      const companyName = getCompanyName();
      
      if (!companyName) {
        alert.error(t.error, 'Company name not found in cache');
        setLoading(false);
        return;
      }
      
      // Extract username from email
      const workerId = newWorker.email.split('@')[0];
      
      // STEP 1: Call cloud function to create Firebase Auth user ONLY
      const manageWorkerFunction = httpsCallable(functions, 'manageWorker');
      
      console.log('Creating Firebase Auth user for:', newWorker.email);
      
      const result = await manageWorkerFunction({
        action: 'add',
        email: newWorker.email,
        password: newWorker.password,
        name: newWorker.name || '',
        phoneNumber: newWorker.phoneNumber || '',
        companyName: companyName
      });

      console.log('Firebase Auth user created:', result.data);
      
      // STEP 2: Add worker to cache and Firestore using cache function
      const workerData = {
        email: newWorker.email,
        password: newWorker.password,
        name: newWorker.name,
        phoneNumber: newWorker.phoneNumber || '',
        role: 'worker',
        companyName: companyName
      };
      
      await addWorker(workerId, workerData);
      
      alert.success('Success', t.workerAdded);
      setShowAddWorker(false);
      setNewWorker({ email: '', password: '', phoneNumber: '', name: '' });
      await loadWorkers();
    } catch (error) {
      console.error('Error adding worker:', error);
      const errorMessage = error.message || 'Failed to add worker';
      alert.error(t.error, errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleEditWorker = async () => {
    if (!editingWorker.email) {
      alert.error(t.error, t.fillAllFields);
      return;
    }

    try {
      setLoading(true);
      const user = auth.currentUser;
      
      if (!user) {
        alert.error(t.error, 'User not authenticated');
        setLoading(false);
        return;
      }
      
      // Force token refresh to ensure authentication
      await user.getIdToken(true);
      
      // Get manager's companyName from cache
      const companyName = getCompanyName();
      
      if (!companyName) {
        alert.error(t.error, 'Company name not found in cache');
        setLoading(false);
        return;
      }
      
      // Extract username from email
      const workerId = editingWorker.email.split('@')[0];
      
      // STEP 1: If password is being changed, call cloud function to update Firebase Auth
      if (editingWorker.password) {
        const manageWorkerFunction = httpsCallable(functions, 'manageWorker');
        
        console.log('Updating Firebase Auth password for:', editingWorker.email);
        
        await manageWorkerFunction({
          action: 'edit',
          email: editingWorker.email,
          newPassword: editingWorker.password,
          name: editingWorker.name,
          phoneNumber: editingWorker.phoneNumber,
          companyName: companyName
        });
        
        console.log('Firebase Auth password updated');
      }
      
      // STEP 2: Update worker in cache and Firestore using cache function
      const updates = {
        name: editingWorker.name,
        phoneNumber: editingWorker.phoneNumber || ''
      };
      
      // Include password in Firestore update if changed
      if (editingWorker.password) {
        updates.password = editingWorker.password;
      }
      
      await editWorker(workerId, updates);
      
      alert.success('Success', t.workerUpdated);
      setShowEditWorker(false);
      setEditingWorker(null);
      await loadWorkers();
    } catch (error) {
      console.error('Error editing worker:', error);
      const errorMessage = error.message || 'Failed to edit worker';
      alert.error(t.error, errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWorker = async (email, username) => {
    alert.confirm(
      'Confirm Delete',
      t.confirmDelete,
      [
        { text: t.cancel, style: 'cancel', onPress: () => {} },
        {
          text: t.delete,
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              const user = auth.currentUser;
              
              if (!user) {
                alert.error(t.error, 'User not authenticated');
                setLoading(false);
                return;
              }
              
              // Force token refresh to ensure authentication
              await user.getIdToken(true);
              
              // Get manager's companyName from cache
              const companyName = getCompanyName();
              
              if (!companyName) {
                alert.error(t.error, 'Company name not found in cache');
                setLoading(false);
                return;
              }
              
              // Extract workerId from email
              const workerId = email.split('@')[0];
              
              // STEP 1: Call cloud function to delete Firebase Auth user
              const manageWorkerFunction = httpsCallable(functions, 'manageWorker');
              
              console.log('Deleting Firebase Auth user:', email);
              
              await manageWorkerFunction({
                action: 'delete',
                email: email,
                companyName: companyName
              });

              console.log('Firebase Auth user deleted');
              
              // STEP 2: Delete worker from cache and Firestore using cache function
              await deleteWorker(workerId);
              
              alert.success('Success', t.workerDeleted);
              await loadWorkers();
            } catch (error) {
              console.error('Error deleting worker:', error);
              const errorMessage = error.message || 'Failed to delete worker';
              alert.error(t.error, errorMessage);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <StatusBar style={isDarkMode ? "light" : "dark"} />
      
      {/* Header */}
      <View style={[styles.header, { backgroundColor: themeColors.card }]}>
        <View style={styles.headerCenter}>
          <View style={styles.titleContainer}>
            <MaterialCommunityIcons name="account-group" size={28} color={themeColors.primary} />
            <Text style={[styles.title, { color: themeColors.textPrimary }]}>{t.title}</Text>
          </View>
          <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>{t.subtitle}</Text>
        </View>
      </View>

      {/* Content */}
      <ScrollableContainer 
        style={[styles.content, { backgroundColor: themeColors.background }]}
        contentContainerStyle={{ paddingTop: 10 }}
      >
          <TouchableOpacity
            onPress={() => setShowAddWorker(true)}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={['#10b981', '#059669']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.addButton}
            >
              <View style={styles.addButtonContent}>
                <View style={styles.iconCircle}>
                  <Ionicons name="add" size={28} color="white" />
                </View>
                <Text style={styles.addButtonText}>{t.addWorker}</Text>
                <Feather name="chevron-right" size={24} color="white" />
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {workers.length === 0 ? (
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="account-off-outline" size={64} color={themeColors.textSecondary} />
              <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>{t.noWorkers}</Text>
            </View>
          ) : (
            workers.map((worker) => (
              <View key={worker.email} style={[styles.workerCard, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
                <View style={styles.workerCardLeft}>
                  <View style={[styles.workerAvatar, { backgroundColor: themeColors.secondary + '20' }]}>
                    <MaterialCommunityIcons name="account" size={32} color={themeColors.secondary} />
                  </View>
                  <View style={styles.workerInfo}>
                    <Text style={[styles.workerUsername, { color: themeColors.textPrimary }]}>{worker.name || worker.username}</Text>
                    <Text style={[styles.workerEmail, { color: themeColors.textSecondary }]}>{worker.email}</Text>
                  </View>
                </View>
                <View style={styles.workerActions}>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.editButton]}
                    onPress={() => {
                      setEditingWorker(worker);
                      setShowEditWorker(true);
                    }}
                  >
                    <Feather name="edit-2" size={18} color="white" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.deleteButton]}
                    onPress={() => handleDeleteWorker(worker.email, worker.username)}
                  >
                    <Feather name="trash-2" size={18} color="white" />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollableContainer>

        {/* Add Worker Modal */}
        <Modal visible={showAddWorker} transparent animationType="slide" onRequestClose={() => setShowAddWorker(false)}>
          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            <TouchableOpacity
              style={{ flex: 1 }}
              activeOpacity={1}
              onPress={() => setShowAddWorker(false)}
            >
              <SafeAreaView style={{ flex: 1 }}>
                <View style={styles.modalContainer}>
                  <TouchableOpacity
                    activeOpacity={1}
                    onPress={(e) => e.stopPropagation()}
                    style={{ flex: 1 }}
                  >
                    <ScrollView
                      contentContainerStyle={styles.modalScrollContent}
                      keyboardShouldPersistTaps="handled"
                    >
                      <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
                        {/* Gradient Header */}
                        <LinearGradient
                          colors={['#10b981', '#059669']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.modalHeader}
                        >
                          <View style={styles.modalHeaderIcon}>
                            <Ionicons name="person-add" size={32} color="white" />
                          </View>
                          <Text style={styles.modalHeaderTitle}>{t.addWorker}</Text>
                        </LinearGradient>

                        {/* Form Content */}
                        <View style={[styles.formContainer, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
                          {/* Name Input */}
                          <View style={styles.inputWrapper}>
                            <View style={styles.labelRow}>
                              <MaterialCommunityIcons name="account" size={18} color={themeColors.primary} />
                              <Text style={[styles.inputLabel, { color: themeColors.textPrimary }]}>{t.name || 'Worker Name'}</Text>
                            </View>
                            <TextInput
                              style={[styles.fullWidthInput, { backgroundColor: themeColors.backgroundLight, color: themeColors.textPrimary, borderColor: themeColors.border }]}
                              placeholder="Enter worker name"
                              placeholderTextColor={themeColors.textLight}
                              value={newWorker.name || ''}
                              onChangeText={(text) => setNewWorker({ ...newWorker, name: text })}
                              returnKeyType="next"
                            />
                          </View>

                          {/* Email Input */}
                          <View style={styles.inputWrapper}>
                            <View style={styles.labelRow}>
                              <MaterialCommunityIcons name="email" size={18} color={themeColors.primary} />
                              <Text style={[styles.inputLabel, { color: isDarkMode ? '#f3f4f6' : '#111827' }]}>{t.email || 'Email'}</Text>
                            </View>
                            <TextInput
                              style={[styles.fullWidthInput, { backgroundColor: themeColors.backgroundLight, color: themeColors.textPrimary, borderColor: themeColors.border }]}
                              placeholder="worker@company.com"
                              placeholderTextColor={themeColors.textLight}
                              value={newWorker.email || ''}
                              onChangeText={(text) => setNewWorker({ ...newWorker, email: text })}
                              autoCapitalize="none"
                              keyboardType="email-address"
                              returnKeyType="next"
                            />
                          </View>

                          {/* Password Input */}
                          <View style={styles.inputWrapper}>
                            <View style={styles.labelRow}>
                              <MaterialCommunityIcons name="lock" size={18} color={themeColors.primary} />
                              <Text style={[styles.inputLabel, { color: isDarkMode ? '#f3f4f6' : '#111827' }]}>{t.password || 'Password'}</Text>
                            </View>
                            <TextInput
                              style={[styles.fullWidthInput, { backgroundColor: themeColors.backgroundLight, color: themeColors.textPrimary, borderColor: themeColors.border }]}
                              placeholder="Enter password"
                              placeholderTextColor={themeColors.textLight}
                              value={newWorker.password || ''}
                              onChangeText={(text) => setNewWorker({ ...newWorker, password: text })}
                              secureTextEntry
                              returnKeyType="next"
                            />
                          </View>

                          {/* Phone Input */}
                          <View style={styles.inputWrapper}>
                            <View style={styles.labelRow}>
                              <MaterialCommunityIcons name="phone" size={18} color={themeColors.primary} />
                              <Text style={[styles.inputLabel, { color: isDarkMode ? '#d1d5db' : '#4b5563' }]}>{t.phoneNumber || 'Phone Number (Optional)'}</Text>
                            </View>
                            <TextInput
                              style={[styles.fullWidthInput, { backgroundColor: themeColors.backgroundLight, color: themeColors.textPrimary, borderColor: themeColors.border }]}
                              placeholder="+1234567890"
                              placeholderTextColor={themeColors.textLight}
                              value={newWorker.phoneNumber || ''}
                              onChangeText={(text) => setNewWorker({ ...newWorker, phoneNumber: text })}
                              keyboardType="phone-pad"
                              returnKeyType="done"
                            />
                          </View>
                        </View>
              
                        {/* Action Buttons */}
                        <View style={styles.modalActions}>
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() => {
                              setShowAddWorker(false);
                              setNewWorker({ email: '', password: '', phoneNumber: '', name: '' });
                            }}
                            style={{ flex: 1 }}
                          >
                            <LinearGradient
                              colors={['#6b7280', '#4b5563']}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 1 }}
                              style={[styles.modalButton, styles.cancelButton]}
                            >
                              <Ionicons name="close-circle" size={20} color="white" style={{ marginRight: 6 }} />
                              <Text style={styles.modalButtonText}>{t.cancel}</Text>
                            </LinearGradient>
                          </TouchableOpacity>
                          
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={handleAddWorker}
                            disabled={loading}
                            style={{ flex: 1 }}
                          >
                            <LinearGradient
                              colors={['#10b981', '#059669']}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 1 }}
                              style={[styles.modalButton, styles.submitButton]}
                            >
                              {loading ? (
                                <ActivityIndicator color="white" size="small" />
                              ) : (
                                <>
                                  <Ionicons name="checkmark-circle" size={20} color="white" style={{ marginRight: 6 }} />
                                  <Text style={styles.modalButtonText}>{t.submit}</Text>
                                </>
                              )}
                            </LinearGradient>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </ScrollView>
                  </TouchableOpacity>
              </View>
            </SafeAreaView>
              </TouchableOpacity>
          </KeyboardAvoidingView>
        </Modal>

        {/* Edit Worker Modal */}
        <Modal visible={showEditWorker} transparent animationType="slide" onRequestClose={() => setShowEditWorker(false)}>
          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            <TouchableOpacity
              style={{ flex: 1 }}
              activeOpacity={1}
              onPress={() => setShowEditWorker(false)}
            >
              <SafeAreaView style={{ flex: 1 }}>
                <View style={styles.modalContainer}>
                  <TouchableOpacity
                    activeOpacity={1}
                    onPress={(e) => e.stopPropagation()}
                    style={{ flex: 1 }}
                  >
                    <ScrollView 
                      contentContainerStyle={styles.modalScrollContent}
                      keyboardShouldPersistTaps="handled"
                    >
                      <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
                        {/* Gradient Header */}
                        <LinearGradient
                          colors={['#3b82f6', '#2563eb']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.modalHeader}
                        >
                          <View style={styles.modalHeaderIcon}>
                            <Feather name="edit-2" size={28} color="white" />
                          </View>
                          <Text style={styles.modalHeaderTitle}>{t.editWorker}</Text>
                        </LinearGradient>

                        {/* Form Content */}
                        <View style={[styles.formContainer, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
                          {/* Name Input */}
                          <View style={styles.inputWrapper}>
                            <View style={styles.labelRow}>
                              <MaterialCommunityIcons name="account" size={18} color={themeColors.primary} />
                              <Text style={[styles.inputLabel, { color: isDarkMode ? '#f3f4f6' : '#111827' }]}>{t.name || 'Worker Name'}</Text>
                            </View>
                            <TextInput
                              style={[styles.fullWidthInput, { backgroundColor: themeColors.backgroundLight, color: themeColors.textPrimary, borderColor: themeColors.border }]}
                              placeholder="Enter worker name"
                              placeholderTextColor={themeColors.textLight}
                              value={editingWorker?.name || ''}
                              onChangeText={(text) => setEditingWorker({ ...editingWorker, name: text })}
                              returnKeyType="next"
                            />
                          </View>

                          {/* Email Input (Disabled) */}
                          <View style={styles.inputWrapper}>
                            <View style={styles.labelRow}>
                              <MaterialCommunityIcons name="email-lock" size={18} color={isDarkMode ? '#9ca3af' : '#6b7280'} />
                              <Text style={[styles.inputLabel, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>{t.email || 'Email'} (Cannot be changed)</Text>
                            </View>
                            <TextInput
                              style={[styles.fullWidthInput, styles.disabledInput, { backgroundColor: themeColors.backgroundLight, color: themeColors.textSecondary, borderColor: themeColors.border }]}
                              placeholder="Email"
                              placeholderTextColor={themeColors.textLight}
                              value={editingWorker?.email || ''}
                              editable={false}
                            />
                          </View>

                          {/* Password Input */}
                          <View style={styles.inputWrapper}>
                            <View style={styles.labelRow}>
                              <MaterialCommunityIcons name="lock-reset" size={18} color={themeColors.primary} />
                              <Text style={[styles.inputLabel, { color: isDarkMode ? '#f3f4f6' : '#111827' }]}>{t.password || 'New Password'}</Text>
                            </View>
                            <TextInput
                              style={[styles.fullWidthInput, { backgroundColor: themeColors.backgroundLight, color: themeColors.textPrimary, borderColor: themeColors.border }]}
                              placeholder="Enter new password"
                              placeholderTextColor={themeColors.textLight}
                              value={editingWorker?.password || ''}
                              onChangeText={(text) => setEditingWorker({ ...editingWorker, password: text })}
                              secureTextEntry
                              returnKeyType="next"
                            />
                          </View>

                          {/* Phone Input */}
                          <View style={styles.inputWrapper}>
                            <View style={styles.labelRow}>
                              <MaterialCommunityIcons name="phone" size={18} color={themeColors.primary} />
                              <Text style={[styles.inputLabel, { color: isDarkMode ? '#d1d5db' : '#4b5563' }]}>{t.phoneNumber || 'Phone Number (Optional)'}</Text>
                            </View>
                            <TextInput
                              style={[styles.fullWidthInput, { backgroundColor: themeColors.backgroundLight, color: themeColors.textPrimary, borderColor: themeColors.border }]}
                              placeholder="+1234567890"
                              placeholderTextColor={themeColors.textLight}
                              value={editingWorker?.phoneNumber || ''}
                              onChangeText={(text) => setEditingWorker({ ...editingWorker, phoneNumber: text })}
                              keyboardType="phone-pad"
                              returnKeyType="done"
                            />
                          </View>
                        </View>
              
                        {/* Action Buttons */}
                        <View style={styles.modalActions}>
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() => {
                              setShowEditWorker(false);
                              setEditingWorker(null);
                            }}
                            style={{ flex: 1 }}
                          >
                            <LinearGradient
                              colors={['#6b7280', '#4b5563']}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 1 }}
                              style={[styles.modalButton, styles.cancelButton]}
                            >
                              <Ionicons name="close-circle" size={20} color="white" style={{ marginRight: 6 }} />
                              <Text style={styles.modalButtonText}>{t.cancel}</Text>
                            </LinearGradient>
                          </TouchableOpacity>
                          
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={handleEditWorker}
                            disabled={loading}
                            style={{ flex: 1 }}
                          >
                            <LinearGradient
                              colors={['#3b82f6', '#2563eb']}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 1 }}
                              style={[styles.modalButton, styles.submitButton]}
                            >
                              {loading ? (
                                <ActivityIndicator color="white" size="small" />
                              ) : (
                                <>
                                  <Ionicons name="checkmark-circle" size={20} color="white" style={{ marginRight: 6 }} />
                                  <Text style={styles.modalButtonText}>{t.submit}</Text>
                                </>
                              )}
                            </LinearGradient>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </ScrollView>
                  </TouchableOpacity>
              </View>
            </SafeAreaView>
              </TouchableOpacity>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 110 : 98,
    paddingBottom: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    ...shadows.sm,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 13,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  addButton: {
    borderRadius: 16,
    padding: 18,
    marginBottom: 24,
    ...shadows.lg,
  },
  addButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
    marginLeft: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
    fontWeight: '500',
  },
  workerCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#6d0e0eff',
  },
  workerCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  workerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  workerInfo: {
    flex: 1,
  },
  workerUsername: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  workerEmail: {
    fontSize: 13,
  },
  workerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  editButton: {
    backgroundColor: '#3b82f6',
  },
  deleteButton: {
    backgroundColor: '#ef4444',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 2,
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 0,
  },
  modalContent: {
    borderRadius: 28,
    width: '100%',
    maxWidth: 1400,
    minWidth: '95%',
    alignSelf: 'center',
    overflow: 'hidden',
    ...shadows.xl,
    // backgroundColor will be applied inline with themeColors.card
  },
  modalHeader: {
    padding: 24,
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 24,
  },
  modalHeaderIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  modalHeaderTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
  },
  formContainer: {
    padding: 32,
    paddingTop: 24,
    // backgroundColor will be applied inline
  },
  inputWrapper: {
    marginBottom: 20,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  fullWidthInput: {
    width: '100%',
    borderWidth: 2,
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
    minHeight: 56,
  },
  disabledInput: {
    opacity: 0.6,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 16,
    padding: 24,
    paddingTop: 8,
  },
  modalButton: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    minHeight: 56,
    ...shadows.lg,
  },
  cancelButton: {
    // Gradient applied via LinearGradient component
  },
  submitButton: {
    // Gradient applied via LinearGradient component
  },
  modalButtonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});