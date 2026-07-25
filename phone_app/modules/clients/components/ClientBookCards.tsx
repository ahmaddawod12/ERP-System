import { TouchableOpacity, View } from 'react-native';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { DOC_COLORS, getDocumentLabel } from '@smart-job/contracts';

import { AppText } from '../../../components';
import { getColors, spacing } from '../../../theme';
import type { Language } from '../../../types';
import type { ClientBookCopy } from '../lib/client-book-copy';
import {
  formatClientHistoryDate,
  type ClientHistoryEntry,
} from '../lib/client-history-model';
import type { MobileClientSummary } from '../lib/client-list-model';
import { styles } from '../screens/ClientBook.styles';

type ClientBookColors = ReturnType<typeof getColors>;

interface ClientCardProps {
  client: MobileClientSummary;
  colors: ClientBookColors;
  isRTL: boolean;
  onPress: () => void;
}

export function ClientCard({ client, colors, isRTL, onPress }: ClientCardProps) {
  return (
    <TouchableOpacity
      style={[styles.clientCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={client.name}
    >
      <View style={styles.clientCardRow}>
        <View style={[styles.clientAvatar, { backgroundColor: `${colors.secondary}15` }]}>
          <MaterialCommunityIcons name="account" size={28} color={colors.secondary} />
        </View>
        <View style={styles.clientCardInfo}>
          <View style={styles.clientNameRow}>
            <AppText style={[styles.clientName, { color: colors.textPrimary }]} numberOfLines={1}>
              {client.name}
            </AppText>
            <View style={[styles.idBadge, { backgroundColor: `${colors.secondary}15` }]}>
              <AppText style={[styles.idBadgeText, { color: colors.secondary }]}>#{client.cid ?? client.id}</AppText>
            </View>
          </View>
          {client.phone ? (
            <View style={styles.detailRow}>
              <Ionicons name="call-outline" size={13} color={colors.textSecondary} />
              <AppText style={[styles.clientDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                {client.phone}
              </AppText>
            </View>
          ) : null}
          {client.email ? (
            <View style={styles.detailRow}>
              <Ionicons name="mail-outline" size={13} color={colors.textSecondary} />
              <AppText style={[styles.clientDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                {client.email}
              </AppText>
            </View>
          ) : null}
          {client.address || client.city ? (
            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
              <AppText style={[styles.clientDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                {[client.address, client.city].filter(Boolean).join(', ')}
              </AppText>
            </View>
          ) : null}
          {client.vatNumber ? (
            <View style={styles.detailRow}>
              <MaterialCommunityIcons name="file-document-outline" size={13} color={colors.textSecondary} />
              <AppText style={[styles.clientDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                {client.vatNumber}
              </AppText>
            </View>
          ) : null}
        </View>
        <Feather name={isRTL ? 'chevron-left' : 'chevron-right'} size={20} color={colors.textLight} />
      </View>
    </TouchableOpacity>
  );
}

interface ClientHistoryCardProps {
  colors: ClientBookColors;
  copy: ClientBookCopy;
  entry: ClientHistoryEntry;
  language: Language;
}

export function ClientHistoryCard({ colors, copy, entry, language }: ClientHistoryCardProps) {
  if (entry.kind === 'job') {
    return (
      <View style={[styles.dataCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.dataCardHeader}>
          <View style={{ flex: 1 }}>
            <AppText style={[styles.dataCardTitle, { color: colors.textPrimary }]} numberOfLines={2}>
              {entry.title}
            </AppText>
          </View>
          {entry.status ? (
            <View style={[styles.statusBadge, { backgroundColor: '#10B98120' }]}>
              <AppText style={[styles.statusBadgeText, { color: '#10B981' }]}>{entry.status}</AppText>
            </View>
          ) : null}
        </View>
        <View style={styles.dataCardDetails}>
          <View style={styles.dataDetailRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
            <AppText style={[styles.dataDetailText, { color: colors.textSecondary }]}>
              {copy.completedOn}: {formatClientHistoryDate(entry.occurredAt, language)}
            </AppText>
          </View>
          {entry.location ? (
            <View style={styles.dataDetailRow}>
              <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
              <AppText style={[styles.dataDetailText, { color: colors.textSecondary }]} numberOfLines={1}>
                {entry.location}
              </AppText>
            </View>
          ) : null}
          {entry.partNames.length ? (
            <View style={styles.dataDetailRow}>
              <Ionicons name="construct-outline" size={14} color={colors.textSecondary} />
              <AppText style={[styles.dataDetailText, { color: colors.textSecondary }]} numberOfLines={1}>
                {copy.partsUsed}: {entry.partNames.join(', ')}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  const numericType = typeof entry.documentType === 'string'
    ? Number.parseInt(entry.documentType, 10)
    : entry.documentType;
  const typeColor = numericType === undefined || Number.isNaN(numericType)
    ? colors.textSecondary
    : DOC_COLORS[numericType as keyof typeof DOC_COLORS] ?? colors.textSecondary;
  const typeLabel = numericType === undefined || Number.isNaN(numericType)
    ? String(entry.documentType ?? '—')
    : getDocumentLabel(numericType, language) || String(entry.documentType);

  return (
    <View style={[styles.dataCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.dataCardHeader}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <View style={[styles.docTypeBadge, { backgroundColor: `${typeColor}20` }]}>
              <AppText style={[styles.docTypeBadgeText, { color: typeColor }]}>{typeLabel}</AppText>
            </View>
            {entry.documentNumber ? (
              <AppText style={[styles.docNumberText, { color: colors.textSecondary }]}>
                #{entry.documentNumber}
              </AppText>
            ) : null}
          </View>
        </View>
        {entry.total > 0 ? (
          <AppText style={[styles.amountText, { color: colors.primary }]}>
            ₪{entry.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </AppText>
        ) : null}
      </View>
      <View style={styles.dataCardDetails}>
        <View style={styles.dataDetailRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
          <AppText style={[styles.dataDetailText, { color: colors.textSecondary }]}>
            {copy.createdOn}: {formatClientHistoryDate(entry.occurredAt, language)}
          </AppText>
        </View>
        {entry.clientName ? (
          <View style={styles.dataDetailRow}>
            <Ionicons name="person-outline" size={14} color={colors.textSecondary} />
            <AppText style={[styles.dataDetailText, { color: colors.textSecondary }]} numberOfLines={1}>
              {entry.clientName}
            </AppText>
          </View>
        ) : null}
      </View>
    </View>
  );
}
