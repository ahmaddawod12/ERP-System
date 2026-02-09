import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getColors, gradients, spacing, borderRadius, typography } from '../theme';

/**
 * DateFilter Component
 * Provides date filtering options: Last 7 Days, This Month, Pick a Month
 * Returns date range for Firestore queries to reduce reads
 */
export default function DateFilter({ 
  visible, 
  onClose, 
  onFilterChange, 
  currentFilter = 'last7days',
  isDarkMode = false,
  language = 'en' 
}) {
  const colors = getColors(isDarkMode);
  const [filterType, setFilterType] = useState(currentFilter);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());

  // Sync filterType with currentFilter when modal opens
  useEffect(() => {
    if (visible) {
      setFilterType(currentFilter);
    }
  }, [visible, currentFilter]);

  const t = language === 'en' ? {
    title: 'Filter by Date',
    apply: 'Apply',
    cancel: 'Cancel',
    year: 'Year',
    last7days: 'Last 7 Days',
    thisMonth: 'This Month',
    pickMonth: 'Pick a Month',
    months: ['January', 'February', 'March', 'April', 'May', 'June', 
             'July', 'August', 'September', 'October', 'November', 'December'],
  } : language === 'he' ? {
    title: 'סינון לפי תאריך',
    apply: 'החל',
    cancel: 'ביטול',
    year: 'שנה',
    last7days: '7 ימים אחרונים',
    thisMonth: 'חודש זה',
    pickMonth: 'בחר חודש',
    months: ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
             'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'],
  } : {
    title: 'تصفية حسب التاريخ',
    apply: 'تطبيق',
    cancel: 'إلغاء',
    year: 'السنة',
    last7days: 'آخر 7 أيام',
    thisMonth: 'هذا الشهر',
    pickMonth: 'اختر شهراً',
    months: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
             'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  };

  const handleApply = () => {
    let startDate, endDate, label;

    if (filterType === 'last7days') {
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      label = t.last7days;
    } else if (filterType === 'thisMonth') {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      label = t.thisMonth;
    } else {
      // pickMonth
      startDate = new Date(selectedYear, selectedMonth, 1);
      endDate = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);
      label = `${t.months[selectedMonth]} ${selectedYear}`;
    }

    onFilterChange({
      type: filterType,
      startDate,
      endDate,
      label
    });
    
    onClose();
  };

  const renderYearSelector = () => {
    return (
      <View style={styles.selectorRow}>
        <Text style={[styles.selectorLabel, { color: colors.textPrimary }]}>{t.year}:</Text>
        <View style={styles.selectorControls}>
          <TouchableOpacity
            onPress={() => setSelectedYear(selectedYear - 1)}
            style={[styles.controlButton, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.controlButtonText}>-</Text>
          </TouchableOpacity>
          <Text style={[styles.selectorValue, { color: colors.textPrimary }]}>{selectedYear}</Text>
          <TouchableOpacity
            onPress={() => setSelectedYear(selectedYear + 1)}
            style={[styles.controlButton, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.controlButtonText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderMonthSelector = () => {
    return (
      <View style={styles.selectorRow}>
        <Text style={[styles.selectorLabel, { color: colors.textPrimary }]}>{t.months[selectedMonth]}:</Text>
        <View style={styles.selectorControls}>
          <TouchableOpacity
            onPress={() => setSelectedMonth(selectedMonth === 0 ? 11 : selectedMonth - 1)}
            style={[styles.controlButton, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.controlButtonText}>-</Text>
          </TouchableOpacity>
          <Text style={[styles.selectorValue, { color: colors.textPrimary }]}>{selectedMonth + 1}</Text>
          <TouchableOpacity
            onPress={() => setSelectedMonth(selectedMonth === 11 ? 0 : selectedMonth + 1)}
            style={[styles.controlButton, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.controlButtonText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>{t.title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Filter Type Selection */}
            <View style={styles.filterOptions}>
              {/* Last 7 Days Option */}
              <TouchableOpacity
                style={[
                  styles.filterOption,
                  { borderColor: filterType === 'last7days' ? colors.primary : 'rgba(0,0,0,0.1)' }
                ]}
                onPress={() => setFilterType('last7days')}
              >
                <View style={styles.filterOptionContent}>
                  <Ionicons 
                    name="calendar-outline" 
                    size={24} 
                    color={filterType === 'last7days' ? colors.primary : colors.textSecondary} 
                  />
                  <Text style={[
                    styles.filterOptionText, 
                    { color: filterType === 'last7days' ? colors.primary : colors.textPrimary }
                  ]}>
                    {t.last7days}
                  </Text>
                </View>
                {filterType === 'last7days' && (
                  <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                )}
              </TouchableOpacity>

              {/* This Month Option */}
              <TouchableOpacity
                style={[
                  styles.filterOption,
                  { borderColor: filterType === 'thisMonth' ? colors.primary : 'rgba(0,0,0,0.1)' }
                ]}
                onPress={() => setFilterType('thisMonth')}
              >
                <View style={styles.filterOptionContent}>
                  <Ionicons 
                    name="today-outline" 
                    size={24} 
                    color={filterType === 'thisMonth' ? colors.primary : colors.textSecondary} 
                  />
                  <Text style={[
                    styles.filterOptionText, 
                    { color: filterType === 'thisMonth' ? colors.primary : colors.textPrimary }
                  ]}>
                    {t.thisMonth}
                  </Text>
                </View>
                {filterType === 'thisMonth' && (
                  <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                )}
              </TouchableOpacity>

              {/* Pick a Month Option */}
              <TouchableOpacity
                style={[
                  styles.filterOption,
                  { borderColor: filterType === 'pickMonth' ? colors.primary : 'rgba(0,0,0,0.1)' }
                ]}
                onPress={() => setFilterType('pickMonth')}
              >
                <View style={styles.filterOptionContent}>
                  <Ionicons 
                    name="albums-outline" 
                    size={24} 
                    color={filterType === 'pickMonth' ? colors.primary : colors.textSecondary} 
                  />
                  <Text style={[
                    styles.filterOptionText, 
                    { color: filterType === 'pickMonth' ? colors.primary : colors.textPrimary }
                  ]}>
                    {t.pickMonth}
                  </Text>
                </View>
                {filterType === 'pickMonth' && (
                  <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                )}
              </TouchableOpacity>
            </View>

            {/* Month Picker (only show when pickMonth is selected) */}
            {filterType === 'pickMonth' && (
              <View style={styles.monthPickerContainer}>
                {renderYearSelector()}
                {renderMonthSelector()}
              </View>
            )}
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.card }]}
              onPress={onClose}
            >
              <Text style={[styles.actionButtonText, { color: colors.textPrimary }]}>
                {t.cancel}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleApply}
            >
              <LinearGradient
                colors={gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.gradientButton}
              >
                <Text style={styles.applyButtonText}>{t.apply}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '90%',
    maxWidth: 500,
    maxHeight: '80%',
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  title: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
  },
  closeButton: {
    padding: spacing.xs,
  },
  content: {
    padding: spacing.lg,
  },
  filterOptions: {
    gap: spacing.md,
  },
  filterOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    borderWidth: 2,
  },
  filterOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  filterOptionText: {
    fontSize: typography.lg,
    fontWeight: typography.semibold,
  },
  monthPickerContainer: {
    gap: spacing.xl,
    paddingVertical: spacing.lg,
  },
  selectorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  selectorLabel: {
    fontSize: typography.lg,
    fontWeight: typography.semibold,
    minWidth: 100,
  },
  selectorControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButtonText: {
    color: '#fff',
    fontSize: typography.xxl,
    fontWeight: typography.bold,
  },
  selectorValue: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    minWidth: 60,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    padding: spacing.lg,
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  actionButton: {
    flex: 1,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  gradientButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  applyButtonText: {
    color: '#fff',
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
});
