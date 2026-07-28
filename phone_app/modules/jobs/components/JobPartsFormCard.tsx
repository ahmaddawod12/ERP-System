import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { AppCard, AppText, InventoryItemSearch } from '../../../components';
import { useAlert } from '../../../contexts/AlertContext';
import { spacing, type ColorPalette } from '../../../theme';
import type { InventoryPart, Language } from '../../../types';
import type { FillJobPart } from '../lib/fill-job-model';
import { styles } from '../screens/FillJob.styles';

export interface JobPartsFormCardProps {
  title: string;
  language: Language;
  colors: ColorPalette;
  inventory: InventoryPart[];
  searchText: string;
  selectedParts: FillJobPart[];
  onSearchTextChange: (value: string) => void;
  onPartsChange: (parts: FillJobPart[]) => void;
}

const copy = {
  en: { duplicateTitle: 'Already Added', duplicate: 'This part is already in your list', search: 'Search parts to add...', quantity: 'Qty' },
  he: { duplicateTitle: 'כבר נוסף', duplicate: 'חלק זה כבר ברשימה שלך', search: 'חפש חלקים להוספה...', quantity: 'כמות' },
  ar: { duplicateTitle: 'تمت الإضافة بالفعل', duplicate: 'هذا الجزء موجود بالفعل في قائمتك', search: 'ابحث عن قطع لإضافتها...', quantity: 'الكمية' },
} as const;

export default function JobPartsFormCard({
  title,
  language,
  colors,
  inventory,
  searchText,
  selectedParts,
  onSearchTextChange,
  onPartsChange,
}: JobPartsFormCardProps) {
  const alert = useAlert();
  const t = copy[language];

  const changeQuantity = (part: FillJobPart, delta: number) => {
    const current = part.usedQuantity || 1;
    const maximum = Number(part.quantity) || 999;
    const next = Math.min(maximum, Math.max(1, current + delta));
    onPartsChange(selectedParts.map((candidate) => (
      candidate.id === part.id ? { ...candidate, usedQuantity: next } : candidate
    )));
  };

  return (
    <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
      <View style={styles.cardHeader}>
        <MaterialCommunityIcons name="cog" size={20} color={colors.secondary} />
        <AppText style={[styles.cardTitle, { color: colors.textPrimary }]} accessibilityRole="header">
          {title}
        </AppText>
      </View>

      <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.sm }}>
        <InventoryItemSearch
          value={searchText}
          onChangeText={onSearchTextChange}
          inventoryParts={inventory}
          onSelectPart={(part) => {
            if (selectedParts.some((candidate) => candidate.id === part.id || candidate.name === part.name)) {
              alert.info(t.duplicateTitle, t.duplicate);
              return;
            }
            onPartsChange([...selectedParts, {
              id: part.id || part.name,
              name: part.name,
              quantity: part.quantity,
              usedQuantity: 1,
            }]);
            onSearchTextChange('');
          }}
          placeholder={t.search}
          colors={colors}
          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, marginHorizontal: 0, marginBottom: 0 }]}
        />
      </View>

      {selectedParts.length > 0 ? (
        <View style={styles.partsList}>
          {selectedParts.map((part) => (
            <View key={part.id} style={[styles.partItem, { backgroundColor: colors.background }]}>
              <View style={{ flex: 1 }}>
                <AppText style={[styles.partName, { color: colors.textPrimary }]}>{part.name}</AppText>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: spacing.sm }}>
                  <AppText style={{ fontSize: 12, color: colors.textSecondary }}>{t.quantity}:</AppText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <TouchableOpacity
                      onPress={() => changeQuantity(part, -1)}
                      style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' }}
                      accessibilityRole="button"
                      accessibilityLabel={`Decrease ${part.name} quantity`}
                    >
                      <AppText style={{ fontSize: 16, fontWeight: '700', color: colors.textPrimary }}>−</AppText>
                    </TouchableOpacity>
                    <AppText
                      style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary, minWidth: 24, textAlign: 'center' }}
                      accessibilityLiveRegion="polite"
                    >
                      {part.usedQuantity || 1}
                    </AppText>
                    <TouchableOpacity
                      onPress={() => changeQuantity(part, 1)}
                      style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.secondary, justifyContent: 'center', alignItems: 'center' }}
                      accessibilityRole="button"
                      accessibilityLabel={`Increase ${part.name} quantity`}
                    >
                      <AppText style={{ fontSize: 16, fontWeight: '700', color: 'white' }}>+</AppText>
                    </TouchableOpacity>
                  </View>
                  <AppText style={{ fontSize: 11, color: colors.textSecondary }}>
                    / {part.quantity || '∞'}
                  </AppText>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => onPartsChange(selectedParts.filter((candidate) => candidate.id !== part.id))}
                style={{ padding: 4 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${part.name}`}
              >
                <MaterialCommunityIcons name="close-circle" size={22} color={colors.error || '#EF4444'} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
    </AppCard>
  );
}
