/**
 * Custom Time Picker Component for Smart-Job App
 * Beautiful scrollable time picker with smooth native scrolling
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Dimensions,
} from 'react-native';
import { colors, spacing, borderRadius, typography, shadows } from '../theme';

const { height } = Dimensions.get('window');
const ITEM_HEIGHT = 50;

const TimeColumn = ({ data, selectedValue, onValueChange, label }) => {
  const flatListRef = useRef(null);
  const initialIndex = data.indexOf(selectedValue);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  const handleScroll = (event) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const index = Math.round(offsetY / ITEM_HEIGHT);
    
    if (index >= 0 && index < data.length && index !== currentIndex) {
      setCurrentIndex(index);
      const newValue = data[index];
      if (newValue !== selectedValue) {
        onValueChange(newValue);
      }
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.timeItem}
      activeOpacity={0.7}
      onPress={() => {
        const index = data.indexOf(item);
        flatListRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });
        onValueChange(item);
      }}
    >
      <Text
        style={[
          styles.timeText,
          item === selectedValue && styles.selectedTimeText,
        ]}
      >
        {item}
      </Text>
    </TouchableOpacity>
  );

  const getItemLayout = (data, index) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index,
  });

  return (
    <View style={styles.pickerColumn}>
      <Text style={styles.columnLabel}>{label}</Text>
      <View style={styles.pickerContainer}>
        {/* Selection indicator */}
        <View style={styles.selectionIndicator} pointerEvents="none" />
        
        <FlatList
          ref={flatListRef}
          data={data}
          renderItem={renderItem}
          keyExtractor={(item) => item}
          getItemLayout={getItemLayout}
          initialScrollIndex={initialIndex >= 0 ? initialIndex : 0}
          showsVerticalScrollIndicator={false}
          snapToInterval={ITEM_HEIGHT}
          decelerationRate="fast"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          ListHeaderComponent={<View style={styles.spacer} />}
          ListFooterComponent={<View style={styles.spacer} />}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({
                index: info.index,
                animated: false,
                viewPosition: 0.5,
              });
            }, 100);
          }}
        />
      </View>
    </View>
  );
};

export const TimePicker = ({
  visible,
  onClose,
  onConfirm,
  initialHour = 7,
  initialMinute = 0,
  title = 'Select Time',
}) => {
  const [selectedHour, setSelectedHour] = useState(String(initialHour).padStart(2, '0'));
  const [selectedMinute, setSelectedMinute] = useState(String(initialMinute).padStart(2, '0'));

  // Reset to initial values when modal opens
  useEffect(() => {
    if (visible) {
      setSelectedHour(String(initialHour).padStart(2, '0'));
      setSelectedMinute(String(initialMinute).padStart(2, '0'));
    }
  }, [visible, initialHour, initialMinute]);

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

  const handleConfirm = () => {
    const timeString = `${selectedHour}:${selectedMinute}`;
    onConfirm(timeString, parseInt(selectedHour), parseInt(selectedMinute));
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={onClose}
        >
          <View
            style={styles.modalContent}
            onStartShouldSetResponder={() => true}
          >
              {/* Header */}
              <View style={styles.header}>
                <Text style={styles.title}>{title}</Text>
                <View style={styles.currentTimeDisplay}>
                  <View style={styles.timeDisplayBox}>
                    <Text style={styles.timeDisplayText}>{selectedHour}</Text>
                  </View>
                  <Text style={styles.timeSeparator}>:</Text>
                  <View style={styles.timeDisplayBox}>
                    <Text style={styles.timeDisplayText}>{selectedMinute}</Text>
                  </View>
                </View>
              </View>

              {/* Time Pickers */}
              <View style={styles.pickersRow}>
                <TimeColumn
                  data={hours}
                  selectedValue={selectedHour}
                  onValueChange={setSelectedHour}
                  label="Hour"
                />

                <View style={styles.separator} />

                <TimeColumn
                  data={minutes}
                  selectedValue={selectedMinute}
                  onValueChange={setSelectedMinute}
                  label="Minute"
                />
              </View>

              {/* Buttons */}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.button, styles.cancelButton]}
                  onPress={onClose}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.confirmButton]}
                  onPress={handleConfirm}
                >
                  <Text style={styles.confirmButtonText}>Confirm</Text>
                </TouchableOpacity>
              </View>
          </View>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  overlayTouchable: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingBottom: spacing.xl,
    ...shadows.lg,
  },
  header: {
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    alignItems: 'center',
  },
  title: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: colors.primary,
    marginBottom: spacing.md,
  },
  currentTimeDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  timeDisplayBox: {
    backgroundColor: colors.secondary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    minWidth: 70,
    alignItems: 'center',
  },
  timeDisplayText: {
    fontSize: typography.xxxl,
    fontWeight: typography.bold,
    color: colors.textWhite,
  },
  timeSeparator: {
    fontSize: typography.xxxl,
    fontWeight: typography.bold,
    color: colors.primary,
  },
  pickersRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    height: 250,
  },
  pickerColumn: {
    flex: 1,
    alignItems: 'center',
  },
  columnLabel: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  pickerContainer: {
    height: 200,
    width: '100%',
    position: 'relative',
  },
  selectionIndicator: {
    position: 'absolute',
    top: 75,
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    backgroundColor: colors.secondaryLight + '20',
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.secondary,
    zIndex: 1,
  },
  spacer: {
    height: 75,
  },
  timeItem: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeText: {
    fontSize: typography.xl,
    color: colors.textSecondary,
    fontWeight: typography.normal,
  },
  selectedTimeText: {
    fontSize: typography.xxl,
    color: colors.secondary,
    fontWeight: typography.bold,
  },
  separator: {
    width: 2,
    height: 200,
    backgroundColor: colors.borderLight,
    marginHorizontal: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  button: {
    flex: 1,
    paddingVertical: spacing.md + 2,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  cancelButtonText: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.2,
  },
  confirmButton: {
    backgroundColor: colors.secondary,
    ...shadows.primary,
  },
  confirmButtonText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    color: colors.textWhite,
    letterSpacing: 0.3,
  },
});
