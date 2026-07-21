import React, { memo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { AppInput, AppText } from '../../../components';
import { useAlert } from '../../../contexts/AlertContext';
import { borderRadius, getColors, shadows, spacing, typography } from '../../../theme';
import type { MobileInventoryPart } from '../lib/inventory-list-model';

export interface InventoryPartRowProps {
  part: MobileInventoryPart;
  colors: ReturnType<typeof getColors>;
  isDarkMode: boolean;
  disabled: boolean;
  copy: Record<string, string>;
  onRemove: (id: string | number) => void;
  onUse: (id: string | number, amount: number) => void;
  onAddQuantity: (id: string | number, amount: number) => void;
}

function parsePositiveAmount(value: string): number | null {
  const amount = Number.parseInt(value, 10);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

const InventoryPartRow = memo(function InventoryPartRow({
  part,
  colors,
  isDarkMode,
  disabled,
  copy,
  onRemove,
  onUse,
  onAddQuantity,
}: InventoryPartRowProps) {
  const alert = useAlert();
  const [useAmount, setUseAmount] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [activeForm, setActiveForm] = useState<'add' | 'use' | null>(null);
  const isLowStock = part.quantity <= (part.lowThreshold || 0);

  const commitAmount = (kind: 'add' | 'use') => {
    const current = kind === 'add' ? addAmount : useAmount;
    const amount = parsePositiveAmount(current);
    if (amount === null) {
      alert.warning(copy.invalidAmount, copy.amountMustBePositive);
      return;
    }
    if (kind === 'add') onAddQuantity(part.id, amount);
    else onUse(part.id, amount);
    setAddAmount('');
    setUseAmount('');
    setActiveForm(null);
  };

  const actionStyle = {
    backgroundColor: isDarkMode ? 'rgba(0, 172, 193, 0.15)' : 'rgba(0, 172, 193, 0.08)',
    borderColor: colors.secondary,
  };

  return (
    <View
      style={[styles.partCard, { backgroundColor: colors.surface }]}
      accessibilityLabel={`${part.name}, ${copy.quantity}: ${part.quantity}`}
    >
      <View style={styles.partHeader}>
        <View style={styles.partInfo}>
          <View style={styles.partNameRow}>
            {isLowStock ? (
              <MaterialCommunityIcons name="alert-circle" size={24} color="#ef4444" />
            ) : null}
            <View style={[styles.idBadge, { backgroundColor: `${colors.secondary}20` }]}>
              <AppText style={[styles.idBadgeText, { color: colors.secondary }]}>#{part.id}</AppText>
            </View>
            <AppText style={[styles.partName, { color: colors.textPrimary }]}>{part.name}</AppText>
          </View>
          <AppText style={[styles.partQuantity, { color: colors.textSecondary }]}>
            {copy.quantity}: {part.quantity} ({copy.alert}: {part.lowThreshold || 0})
          </AppText>
        </View>

        <View style={styles.partActions}>
          <TouchableOpacity
            style={[styles.actionButton, actionStyle]}
            disabled={disabled}
            onPress={() => setActiveForm('add')}
            accessibilityRole="button"
            accessibilityLabel={`${copy.add} ${part.name}`}
            accessibilityState={{ disabled, expanded: activeForm === 'add' }}
          >
            <AppText style={[styles.actionButtonText, { color: colors.secondary }]}>+ {copy.add}</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, actionStyle]}
            disabled={disabled}
            onPress={() => setActiveForm('use')}
            accessibilityRole="button"
            accessibilityLabel={`${copy.use} ${part.name}`}
            accessibilityState={{ disabled, expanded: activeForm === 'use' }}
          >
            <AppText style={[styles.actionButtonText, { color: colors.secondary }]}>- {copy.use}</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionButton,
              {
                backgroundColor: isDarkMode ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.08)',
                borderColor: '#ef4444',
              },
            ]}
            disabled={disabled}
            onPress={() => {
              alert.confirm(
                copy.confirmRemove,
                `${copy.areYouSure}\n${part.name}\n\n${copy.confirmRemoveMessage}`,
                [
                  { text: copy.cancel, style: 'cancel', onPress: () => {} },
                  { text: copy.remove, style: 'destructive', onPress: () => onRemove(part.id) },
                ],
              );
            }}
            accessibilityRole="button"
            accessibilityLabel={`${copy.remove} ${part.name}`}
            accessibilityState={{ disabled }}
          >
            <MaterialCommunityIcons name="delete-outline" size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>

      {activeForm ? (
        <View style={styles.amountInput}>
          <AppInput
            label={copy.amount}
            value={activeForm === 'add' ? addAmount : useAmount}
            onChangeText={activeForm === 'add' ? setAddAmount : setUseAmount}
            keyboardType="numeric"
            colors={colors}
            autoFocus
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity
              disabled={disabled}
              onPress={() => commitAmount(activeForm)}
              style={[styles.confirmButton, { backgroundColor: colors.secondary }]}
              accessibilityRole="button"
              accessibilityLabel={copy.confirm}
              accessibilityState={{ disabled }}
            >
              <AppText style={styles.confirmButtonText}>{copy.confirm}</AppText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setActiveForm(null);
                setAddAmount('');
                setUseAmount('');
              }}
              style={[styles.cancelButton, { backgroundColor: colors.background, borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel={copy.cancel}
            >
              <AppText style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{copy.cancel}</AppText>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
});

export default InventoryPartRow;

const styles = StyleSheet.create({
  partCard: { borderRadius: borderRadius.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadows.sm },
  partHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  partInfo: { flex: 1 },
  partNameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs, gap: spacing.xs },
  idBadge: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: borderRadius.md },
  idBadgeText: { fontSize: typography.sm, fontWeight: typography.bold, letterSpacing: 0.3 },
  partName: { fontSize: typography.lg, fontWeight: typography.bold, letterSpacing: -0.2, flex: 1 },
  partQuantity: { fontSize: typography.sm, fontWeight: typography.semibold },
  partActions: { flexDirection: 'row', gap: spacing.xs },
  actionButton: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 6, borderRadius: borderRadius.md, borderWidth: 1 },
  actionButtonText: { fontWeight: typography.bold, fontSize: typography.xs, letterSpacing: 0.3 },
  amountInput: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: 'rgba(128,128,128,0.2)' },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  confirmButton: { flex: 1, paddingVertical: spacing.md, borderRadius: borderRadius.lg, alignItems: 'center' },
  confirmButtonText: { color: 'white', fontWeight: typography.bold, letterSpacing: 0.3 },
  cancelButton: { flex: 1, paddingVertical: spacing.md, borderRadius: borderRadius.lg, alignItems: 'center', borderWidth: 1 },
  cancelButtonText: { fontWeight: typography.bold, letterSpacing: 0.3 },
});
