import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { borderRadius, getColors, spacing } from '../../theme';
import { useThemeContext } from '../../contexts/ThemeContext';
import AppButton from '../primitives/AppButton';
import AppCard from '../primitives/AppCard';
import AppIcon from '../primitives/AppIcon';
import AppListItem from '../primitives/AppListItem';
import AppText from '../primitives/AppText';
import type { Language } from '../../types';
import AccessibleModal from '../feedback/AccessibleModal';

type DateFilterType = 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'allTime';

export interface DateFilterRange {
  type: DateFilterType;
  startDate: Date;
  endDate: Date;
  label: string;
}

const getTranslations = (language: Language) =>
  language === 'he'
    ? {
        title: 'סינון לפי תאריך',
        close: 'סגור',
        last7days: '7 ימים אחרונים',
        last30days: '30 ימים אחרונים',
        thisMonth: 'החודש הנוכחי',
        lastMonth: 'החודש הקודם',
        thisYear: 'השנה הנוכחית',
        allTime: 'כל הזמנים',
      }
    : language === 'ar'
      ? {
          title: 'تصفية حسب التاريخ',
          close: 'إغلاق',
          last7days: 'آخر 7 أيام',
          last30days: 'آخر 30 يوم',
          thisMonth: 'هذا الشهر',
          lastMonth: 'الشهر الماضي',
          thisYear: 'هذه السنة',
          allTime: 'كل الفترات',
        }
      : {
          title: 'Filter By Date',
          close: 'Close',
          last7days: 'Last 7 Days',
          last30days: 'Last 30 Days',
          thisMonth: 'This Month',
          lastMonth: 'Last Month',
          thisYear: 'This Year',
          allTime: 'All Time',
        };

const toFilterRange = (type: DateFilterType, label: string): DateFilterRange => {
  const now = new Date();
  const endDate = new Date();
  let startDate = new Date();

  if (type === 'last7days') {
    startDate.setDate(now.getDate() - 7);
  } else if (type === 'last30days') {
    startDate.setDate(now.getDate() - 30);
  } else if (type === 'thisMonth') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (type === 'lastMonth') {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endDate.setFullYear(now.getFullYear(), now.getMonth(), 0);
    endDate.setHours(23, 59, 59, 999);
  } else if (type === 'thisYear') {
    startDate = new Date(now.getFullYear(), 0, 1);
  } else if (type === 'allTime') {
    startDate = new Date(2000, 0, 1);
  }

  return { type, startDate, endDate, label };
};

export interface DateFilterProps {
  visible: boolean;
  onClose: () => void;
  onFilterChange?: (range: DateFilterRange) => void;
  currentFilter?: DateFilterType;
  language?: Language;
  isDarkMode?: boolean;
}

export default function DateFilter({
  visible,
  onClose,
  onFilterChange,
  currentFilter = 'last7days',
  language = 'en',
  isDarkMode,
}: DateFilterProps) {
  const themeContext = useThemeContext();
  const darkMode = typeof isDarkMode === 'boolean' ? isDarkMode : themeContext.isDarkMode;
  const palette = getColors(darkMode);
  const t = getTranslations(language);

  const options: { type: DateFilterType; label: string }[] = [
    { type: 'last7days', label: t.last7days },
    { type: 'last30days', label: t.last30days },
    { type: 'thisMonth', label: t.thisMonth },
    { type: 'lastMonth', label: t.lastMonth },
    { type: 'thisYear', label: t.thisYear },
    { type: 'allTime', label: t.allTime },
  ];

  return (
    <AccessibleModal visible={visible} transparent animationType="fade" onRequestClose={onClose} announcement={t.title}>
      <View style={[styles.overlay, { backgroundColor: palette.overlay }]}>
        <AppCard style={styles.card} contentStyle={styles.cardContent}>
          <View style={styles.header}>
            <AppText variant="heading">{t.title}</AppText>
            <TouchableOpacity onPress={onClose} style={styles.closeIconButton} accessibilityRole="button" accessibilityLabel={t.close}>
              <AppIcon name="close" size={18} color={palette.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.options}>
            {options.map((option) => {
              const selected = currentFilter === option.type;
              return (
                <AppListItem
                  key={option.type}
                  title={option.label}
                  selected={selected}
                  onPress={() => {
                    onFilterChange?.(toFilterRange(option.type, option.label));
                    onClose?.();
                  }}
                  style={[
                    styles.option,
                    {
                      borderColor: selected ? palette.secondary : palette.border,
                    },
                  ]}
                  right={
                    selected ? (
                      <AppIcon name="checkmark-circle" size={20} color={palette.secondary} />
                    ) : (
                      <View style={styles.emptyDot} />
                    )
                  }
                />
              );
            })}
          </View>

          <AppButton title={t.close} variant="secondary" onPress={onClose} />
        </AppCard>
      </View>
    </AccessibleModal>
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
    maxWidth: 460,
    borderRadius: borderRadius.xl,
  },
  cardContent: {
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    marginBottom: 0,
  },
  emptyDot: {
    width: 20,
    height: 20,
  },
});
