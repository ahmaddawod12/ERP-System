import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { getColors } from '../../theme';
import AppText from '../primitives/AppText';

const COPY = {
  en: 'Some historical records could not be loaded. Retry or choose a narrower date range.',
  he: 'חלק מהרשומות ההיסטוריות לא נטענו. נסו שוב או בחרו טווח תאריכים קצר יותר.',
  ar: 'تعذّر تحميل بعض السجلات التاريخية. أعد المحاولة أو اختر نطاقًا زمنيًا أضيق.',
} as const;

export function HistoricalResultsNotice({ complete }: { readonly complete: boolean }) {
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const colors = getColors(isDarkMode);
  if (complete) return null;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginHorizontal: 16,
        marginVertical: 8,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.warning,
        backgroundColor: colors.backgroundElevated,
      }}
    >
      <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.warning} />
      <AppText style={{ flex: 1, color: colors.textPrimary }}>
        {COPY[language]}
      </AppText>
    </View>
  );
}
