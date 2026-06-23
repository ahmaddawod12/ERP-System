import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { borderRadius, getColors, spacing } from '../../theme';
import { useThemeContext } from '../../contexts/ThemeContext';
import AppButton from '../primitives/AppButton';
import AppIcon from '../primitives/AppIcon';
import AppText from '../primitives/AppText';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const format = (value: number): string => String(value).padStart(2, '0');

export interface TimePickerProps {
  visible: boolean;
  onClose: () => void;
  onConfirm?: (time: string) => void;
  title?: string;
  initialHour?: number;
  initialMinute?: number;
}

export default function TimePicker({
  visible,
  onClose,
  onConfirm,
  title = 'Select Time',
  initialHour = 0,
  initialMinute = 0,
}: TimePickerProps) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const [hour, setHour] = useState(clamp(initialHour, 0, 23));
  const [minute, setMinute] = useState(clamp(initialMinute, 0, 59));

  useEffect(() => {
    if (!visible) return;
    setHour(clamp(initialHour, 0, 23));
    setMinute(clamp(initialMinute, 0, 59));
  }, [visible, initialHour, initialMinute]);

  const updateHour = (delta: number) => {
    setHour((prev) => {
      const next = prev + delta;
      if (next < 0) return 23;
      if (next > 23) return 0;
      return next;
    });
  };

  const updateMinute = (delta: number) => {
    setMinute((prev) => {
      const next = prev + delta;
      if (next < 0) return 59;
      if (next > 59) return 0;
      return next;
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: palette.overlay }]}>
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <AppText variant="heading">{title}</AppText>

          <View style={styles.timeRow}>
            <View style={styles.column}>
              <TouchableOpacity style={styles.arrowBtn} onPress={() => updateHour(1)}>
                <AppIcon name="chevron-up" size={22} color={palette.textPrimary} />
              </TouchableOpacity>
              <AppText variant="display">{format(hour)}</AppText>
              <TouchableOpacity style={styles.arrowBtn} onPress={() => updateHour(-1)}>
                <AppIcon name="chevron-down" size={22} color={palette.textPrimary} />
              </TouchableOpacity>
            </View>

            <AppText variant="display">:</AppText>

            <View style={styles.column}>
              <TouchableOpacity style={styles.arrowBtn} onPress={() => updateMinute(1)}>
                <AppIcon name="chevron-up" size={22} color={palette.textPrimary} />
              </TouchableOpacity>
              <AppText variant="display">{format(minute)}</AppText>
              <TouchableOpacity style={styles.arrowBtn} onPress={() => updateMinute(-1)}>
                <AppIcon name="chevron-down" size={22} color={palette.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.actions}>
            <AppButton title="Cancel" variant="secondary" onPress={onClose} style={styles.actionBtn} />
            <AppButton
              title="Confirm"
              variant="primary"
              onPress={() => {
                onConfirm?.(`${format(hour)}:${format(minute)}`);
              }}
              style={styles.actionBtn}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  column: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 86,
    gap: spacing.sm,
  },
  arrowBtn: {
    width: 44,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
  },
});
