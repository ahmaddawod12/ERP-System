// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { FlatList, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  borderRadius,
  getColors,
  shadows,
  spacing,
} from '../../theme';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import {
  AppButton,
  AppCard,
  AppEmptyState,
  AppInput,
  AppText,
  GlobalHeader,
} from '../../components';
import { DOC_TYPE } from '@smart-job/contracts';

const translations = {
  en: {
    title: 'General Documents',
    subtitle: 'Create and manage official documents',
    searchPlaceholder: 'Search document type',
    createDocument: 'Create Document',
    history: 'Document History',
    historyDesc: 'Review existing documents with filters',
    noResults: 'No document types matched your search.',
  },
  he: {
    title: 'מסמכים כלליים',
    subtitle: 'יצירה וניהול מסמכים רשמיים',
    searchPlaceholder: 'חיפוש סוג מסמך',
    createDocument: 'יצירת מסמך',
    history: 'היסטוריית מסמכים',
    historyDesc: 'סקירת מסמכים קיימים עם סינון',
    noResults: 'לא נמצאו סוגי מסמכים תואמים.',
  },
  ar: {
    title: 'مستندات عامة',
    subtitle: 'إنشاء وإدارة المستندات الرسمية',
    searchPlaceholder: 'بحث عن نوع المستند',
    createDocument: 'إنشاء مستند',
    history: 'سجل المستندات',
    historyDesc: 'مراجعة المستندات الموجودة مع تصفية',
    noResults: 'لم يتم العثور على أنواع مستندات مطابقة.',
  },
};

const docDefinitions = [
  {
    id: DOC_TYPE.TAX_INVOICE,
    title: 'Tax Invoice',
    description: 'Create a tax invoice for completed work.',
    icon: 'file-document-outline',
    color: '#10B981',
  },
  {
    id: DOC_TYPE.RECEIPT,
    title: 'Receipt',
    description: 'Issue a receipt for incoming payment.',
    icon: 'receipt',
    color: '#06B6D4',
  },
  {
    id: DOC_TYPE.PRICE_PROPOSAL,
    title: 'Price Proposal',
    description: 'Prepare a proposal before starting work.',
    icon: 'file-document-edit-outline',
    color: '#3B82F6',
  },
  {
    id: DOC_TYPE.DELIVERY_NOTE,
    title: 'Delivery Note',
    description: 'Document delivered items and quantities.',
    icon: 'truck-delivery-outline',
    color: '#8B5CF6',
  },
  {
    id: DOC_TYPE.RETURN_CERTIFICATE,
    title: 'Return Certificate',
    description: 'Record returned parts or equipment.',
    icon: 'file-certificate-outline',
    color: '#EC4899',
  },
  {
    id: DOC_TYPE.REFUND,
    title: 'Refund',
    description: 'Generate a refund document for adjustments.',
    icon: 'cash-refund',
    color: '#F59E0B',
  },
];

export default function GeneralDocuments() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const t = translations[language] || translations.en;

  const [searchQuery, setSearchQuery] = useState('');

  const filteredDocs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return docDefinitions;
    return docDefinitions.filter((doc) => {
      const title = doc.title.toLowerCase();
      const description = doc.description.toLowerCase();
      return title.includes(query) || description.includes(query) || String(doc.id).includes(query);
    });
  }, [searchQuery]);

  const renderDocument = ({ item }) => (
    <AppCard style={styles.documentCard}>
      <View style={styles.documentHeader}>
        <View style={[styles.iconWrap, { backgroundColor: `${item.color}20` }]}>
          <MaterialCommunityIcons name={item.icon} size={24} color={item.color} />
        </View>
        <View style={styles.documentHeaderText}>
          <AppText variant="heading">{item.title}</AppText>
          <AppText variant="caption" color={palette.textSecondary}>
            Type #{item.id}
          </AppText>
        </View>
      </View>
      <AppText variant="body" color={palette.textSecondary} style={styles.documentDescription}>
        {item.description}
      </AppText>
      <AppButton
        title={t.createDocument}
        onPress={() =>
          router.push({
            pathname: '/CreateDocument',
            params: { type: item.id },
          })
        }
        iconLeft={{ name: 'add-circle-outline' }}
      />
    </AppCard>
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />

      <FlatList
        data={filteredDocs}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderDocument}
        contentContainerStyle={{
          paddingTop: Platform.OS === 'ios' ? 108 : 96,
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + 90,
          flexGrow: filteredDocs.length === 0 ? 1 : 0,
        }}
        ListHeaderComponent={
          <View style={styles.headerSection}>
            <View style={[styles.heroIconWrap, { backgroundColor: `${palette.secondary}18` }]}>
              <MaterialCommunityIcons
                name="file-document-multiple-outline"
                size={34}
                color={palette.secondary}
              />
            </View>
            <AppText variant="title">{t.title}</AppText>
            <AppText variant="caption" color={palette.textSecondary}>
              {t.subtitle}
            </AppText>
            <AppInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t.searchPlaceholder}
              leftIcon={<MaterialCommunityIcons name="magnify" size={18} color={palette.textLight} />}
              style={styles.searchInput}
            />
            <TouchableOpacity onPress={() => router.push('/DocumentHistory')} activeOpacity={0.9}>
              <AppCard style={styles.historyCard}>
                <View style={styles.historyRow}>
                  <View>
                    <AppText variant="bodyStrong">{t.history}</AppText>
                    <AppText variant="caption" color={palette.textSecondary}>
                      {t.historyDesc}
                    </AppText>
                  </View>
                  <MaterialCommunityIcons name="history" size={22} color={palette.secondary} />
                </View>
              </AppCard>
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={<AppEmptyState icon="file-find-outline" title={t.noResults} />}
      />

      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerSection: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  heroIconWrap: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  searchInput: {
    marginTop: spacing.xs,
  },
  historyCard: {
    marginTop: spacing.xs,
    ...shadows.sm,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  documentCard: {
    marginBottom: spacing.md,
    ...shadows.card,
  },
  documentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentHeaderText: {
    flex: 1,
  },
  documentDescription: {
    marginBottom: spacing.md,
  },
});

