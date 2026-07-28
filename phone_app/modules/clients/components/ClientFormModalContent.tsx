import React from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { AppInput, AppText } from '../../../components';
import { gradients, type ColorPalette } from '../../../theme';
import type { MobileClientSummary } from '../lib/client-list-model';
import type { ClientFormData } from '../lib/client-form-model';
import { styles } from '../screens/ClientBook.styles';

interface ClientFormCopy {
  addClient: string;
  editClient: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  vatNumber: string;
  cancel: string;
  save: string;
}

export interface ClientFormModalContentProps {
  editingClient: MobileClientSummary | null;
  formData: ClientFormData;
  colors: ColorPalette;
  copy: ClientFormCopy;
  loading: boolean;
  removing: boolean;
  onChange: (field: keyof ClientFormData, value: string) => void;
  onDelete: (client: MobileClientSummary) => void;
  onCancel: () => void;
  onSave: () => void;
}

const fields: ReadonlyArray<{
  key: keyof ClientFormData;
  icon: string;
  iconLibrary: 'ionicons' | 'material';
  keyboardType?: 'default' | 'phone-pad' | 'email-address' | 'numeric';
}> = [
  { key: 'name', icon: 'person', iconLibrary: 'ionicons' },
  { key: 'phone', icon: 'call', iconLibrary: 'ionicons', keyboardType: 'phone-pad' },
  { key: 'email', icon: 'mail', iconLibrary: 'ionicons', keyboardType: 'email-address' },
  { key: 'address', icon: 'location', iconLibrary: 'ionicons' },
  { key: 'city', icon: 'city', iconLibrary: 'material' },
  { key: 'vatNumber', icon: 'file-document-outline', iconLibrary: 'material', keyboardType: 'numeric' },
];

export default function ClientFormModalContent({
  editingClient,
  formData,
  colors,
  copy,
  loading,
  removing,
  onChange,
  onDelete,
  onCancel,
  onSave,
}: ClientFormModalContentProps) {
  const blocked = loading || removing;

  return (
    <KeyboardAvoidingView
      style={styles.modalOverlay}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
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
              <AppText style={styles.modalTitle} accessibilityRole="header">
                {editingClient ? copy.editClient : copy.addClient}
              </AppText>
            </LinearGradient>
          </View>

          <ScrollView
            style={styles.formScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {fields.map((field) => {
              const label = copy[field.key];
              const icon = field.iconLibrary === 'material'
                ? <MaterialCommunityIcons name={field.icon as never} size={16} color={colors.secondary} />
                : <Ionicons name={field.icon as never} size={16} color={colors.secondary} />;
              return (
                <View key={field.key} style={styles.formField}>
                  <View style={styles.fieldLabelRow} accessible={false}>
                    {icon}
                    <AppText style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                      {label}{field.key === 'name' ? ' *' : ''}
                    </AppText>
                  </View>
                  <AppInput
                    label={label}
                    accessibilityHint={field.key === 'name' ? 'Required' : undefined}
                    value={formData[field.key]}
                    onChangeText={(text) => onChange(field.key, text)}
                    autoFocus={field.key === 'name' && !editingClient}
                    keyboardType={field.keyboardType}
                    autoCapitalize={field.key === 'email' ? 'none' : undefined}
                    colors={colors}
                  />
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.modalActions}>
            {editingClient ? (
              <TouchableOpacity
                style={[styles.deleteButton, { borderColor: colors.error }]}
                onPress={() => onDelete(editingClient)}
                disabled={blocked}
                accessibilityRole="button"
                accessibilityLabel="Delete client"
                accessibilityState={{ disabled: blocked, busy: removing }}
              >
                {removing
                  ? <ActivityIndicator size="small" color={colors.error} />
                  : <Ionicons name="trash-outline" size={20} color={colors.error} />}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.cancelButton, { borderColor: colors.border, flex: 1 }]}
              onPress={onCancel}
              disabled={blocked}
              accessibilityRole="button"
              accessibilityLabel={copy.cancel}
              accessibilityState={{ disabled: blocked }}
            >
              <AppText style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{copy.cancel}</AppText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveButtonWrapper, { flex: 1 }]}
              onPress={onSave}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={copy.save}
              accessibilityState={{ disabled: loading, busy: loading }}
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
                    <AppText style={styles.saveButtonText}>{copy.save}</AppText>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}
