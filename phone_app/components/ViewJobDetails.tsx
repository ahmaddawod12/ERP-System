import React from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { borderRadius, getColors, spacing } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';
import AppButton from './AppButton';
import AppCard from './AppCard';
import AppChip from './AppChip';
import AppIcon from './AppIcon';
import AppText from './AppText';
import AppDivider from './AppDivider';
import type { DateLike } from '../types';

interface PhotoRef {
  uri?: string;
  url?: string;
}

interface PartUsed {
  id?: string;
  name?: string;
  quantity?: number;
}

interface JobData {
  title?: string;
  jobTitle?: string;
  description?: string;
  workDescription?: string;
  status?: string;
  photos?: (string | PhotoRef)[];
  partsUsed?: PartUsed[];
  signature?: string | PhotoRef;
  location?: string;
  cname?: string;
  cphone?: string;
  mname?: string;
  createdAt?: DateLike;
  finishedAt?: DateLike;
  timeWorked?: string;
  timeFrom?: string;
  timeTo?: string;
  signingPerson?: string;
}

export interface ViewJobDetailsProps {
  visible: boolean;
  job: JobData | null;
  onClose: () => void;
  translations?: Record<string, string>;
  getStatusColor?: (status: string) => string;
  onImagePress?: (photo: string | PhotoRef) => void;
  isDarkMode?: boolean;
}

const formatDate = (value: DateLike | undefined): string => {
  if (!value) return '-';
  try {
    const date = typeof value === 'object' && 'toDate' in value ? value.toDate() : new Date(value as string | number);
    if (Number.isNaN(date.getTime())) return String(value);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  } catch {
    return String(value);
  }
};

const getPhotoUri = (photo: string | PhotoRef | undefined): string | null => {
  if (!photo) return null;
  if (typeof photo === 'string') return photo;
  return photo.uri || photo.url || null;
};

const normalizeStatus = (status: string | undefined): string => String(status || '').toLowerCase();

interface DetailRowProps {
  label: string;
  value?: string;
  labelColor?: string;
}

const DetailRow = ({ label, value, labelColor }: DetailRowProps) => (
  <View style={styles.detailRow}>
    <AppText variant="label" color={labelColor} style={styles.detailLabel}>
      {label}
    </AppText>
    <AppText variant="body" style={styles.detailValue}>
      {value || '-'}
    </AppText>
  </View>
);

export default function ViewJobDetails({
  visible,
  job,
  onClose,
  translations = {},
  getStatusColor,
  onImagePress,
  isDarkMode,
}: ViewJobDetailsProps) {
  const themeContext = useThemeContext();
  const darkMode = typeof isDarkMode === 'boolean' ? isDarkMode : themeContext.isDarkMode;
  const palette = getColors(darkMode);

  if (!visible || !job) return null;

  const titleText = job.title || job.jobTitle || translations.untitledJob || 'Job';
  const descriptionText = job.description || job.workDescription || '-';
  const status = normalizeStatus(job.status);
  const statusColor = getStatusColor ? getStatusColor(status) : undefined;
  const photos = Array.isArray(job.photos) ? job.photos : [];
  const partsUsed = Array.isArray(job.partsUsed) ? job.partsUsed : [];
  const signatureUri = getPhotoUri(job.signature);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: palette.overlay }]}>
        <View style={[styles.sheet, { backgroundColor: palette.backgroundElevated }]}>
          <View style={styles.headerRow}>
            <AppText variant="title" style={styles.title}>
              {translations.jobDetails || translations.title || 'Job Details'}
            </AppText>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={translations.close || 'Close'}
              style={[styles.closeButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
            >
              <AppIcon name="close" size={18} color={palette.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <AppCard>
              <AppText variant="heading">{titleText}</AppText>
              <View style={styles.statusWrap}>
                <AppChip label={status || '-'} status={status} color={statusColor} />
              </View>
              <AppDivider />
              <DetailRow
                label={translations.description || 'Description'}
                value={descriptionText}
                labelColor={palette.textSecondary}
              />
              <DetailRow label={translations.location || 'Location'} value={job.location} labelColor={palette.textSecondary} />
              <DetailRow label={translations.clientName || 'Client'} value={job.cname} labelColor={palette.textSecondary} />
              <DetailRow label={translations.clientPhone || 'Phone'} value={job.cphone} labelColor={palette.textSecondary} />
              <DetailRow
                label={translations.assignedBy || 'Assigned By'}
                value={job.mname}
                labelColor={palette.textSecondary}
              />
              <DetailRow label={translations.createdAt || 'Created'} value={formatDate(job.createdAt)} labelColor={palette.textSecondary} />
              <DetailRow label={translations.finishedAt || 'Finished'} value={formatDate(job.finishedAt)} labelColor={palette.textSecondary} />
              <DetailRow
                label={translations.timeWorked || translations.timeStatus || 'Time'}
                value={
                  job.timeWorked ||
                  (job.timeFrom || job.timeTo ? `${job.timeFrom || '--'} - ${job.timeTo || '--'}` : '-')
                }
                labelColor={palette.textSecondary}
              />
              <DetailRow label={translations.signingPerson || 'Signed By'} value={job.signingPerson} labelColor={palette.textSecondary} />
            </AppCard>

            <AppCard>
              <AppText variant="heading">{translations.partsUsed || 'Parts Used'}</AppText>
              {partsUsed.length === 0 ? (
                <AppText variant="caption" color={palette.textLight} style={styles.emptyText}>
                  {translations.noParts || 'No parts used'}
                </AppText>
              ) : (
                partsUsed.map((part, index) => (
                  <View key={`${part.id || part.name || 'part'}-${index}`} style={styles.partRow}>
                    <AppText variant="bodyStrong">{part.name || '-'}</AppText>
                    <AppText variant="caption" color={palette.textSecondary}>
                      x{part.quantity || 0}
                    </AppText>
                  </View>
                ))
              )}
            </AppCard>

            <AppCard>
              <AppText variant="heading">{translations.photos || 'Photos'}</AppText>
              {photos.length === 0 ? (
                <AppText variant="caption" color={palette.textLight} style={styles.emptyText}>
                  {translations.noPhotos || 'No photos'}
                </AppText>
              ) : (
                <View style={styles.photoGrid}>
                  {photos.map((photo, index) => {
                    const uri = getPhotoUri(photo);
                    if (!uri) return null;
                    return (
                      <TouchableOpacity
                        key={`${uri}-${index}`}
                        onPress={() => onImagePress?.(photo)}
                        style={styles.photoButton}
                      >
                        <Image source={{ uri }} style={styles.photo} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </AppCard>

            <AppCard>
              <AppText variant="heading">{translations.signature || 'Signature'}</AppText>
              {signatureUri ? (
                <Image source={{ uri: signatureUri }} style={styles.signature} resizeMode="contain" />
              ) : (
                <AppText variant="caption" color={palette.textLight} style={styles.emptyText}>
                  {translations.noSignature || 'No signature'}
                </AppText>
              )}
            </AppCard>
          </ScrollView>

          <View style={styles.footer}>
            <AppButton
              title={translations.close || 'Close'}
              onPress={onClose}
              variant="primary"
              iconLeft={{ name: 'checkmark-circle-outline' }}
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
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingTop: spacing.lg,
  },
  headerRow: {
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    flex: 1,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.sm,
  },
  statusWrap: {
    marginTop: spacing.sm,
  },
  detailRow: {
    marginBottom: spacing.sm,
  },
  detailLabel: {
    marginBottom: spacing.xs,
  },
  detailValue: {
    lineHeight: 22,
  },
  emptyText: {
    marginTop: spacing.sm,
  },
  partRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  photoButton: {
    width: 90,
    height: 90,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: '100%',
    borderRadius: borderRadius.sm,
  },
  signature: {
    width: '100%',
    height: 140,
    marginTop: spacing.md,
    borderRadius: borderRadius.sm,
  },
});
