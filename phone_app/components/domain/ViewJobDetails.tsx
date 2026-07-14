import React, { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { borderRadius, getColors, spacing } from '../../theme';
import { useCache } from '../../contexts/CacheContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import AppButton from '../primitives/AppButton';
import AppCard from '../primitives/AppCard';
import AppChip from '../primitives/AppChip';
import AppIcon from '../primitives/AppIcon';
import AppText from '../primitives/AppText';
import AppDivider from '../primitives/AppDivider';
import type { DateLike, JobFileRef } from '../../types';
import { resolveJobFileUri } from '../../modules/jobs/lib/job-file-utils';

interface PartUsed {
  id?: string | number;
  name?: string;
  quantity?: string | number;
}

interface JobData {
  title?: string;
  jobTitle?: string;
  description?: string;
  workDescription?: string;
  status?: string;
  id?: string;
  photos?: (string | JobFileRef)[];
  partsUsed?: PartUsed[];
  signature?: string | JobFileRef;
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
  onImagePress?: (photo: string | JobFileRef) => void;
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
  const { getCompanyId } = useCache();
  const themeContext = useThemeContext();
  const darkMode = typeof isDarkMode === 'boolean' ? isDarkMode : themeContext.isDarkMode;
  const palette = getColors(darkMode);
  const [resolvedPhotoUris, setResolvedPhotoUris] = useState<string[]>([]);
  const [resolvedSignatureUri, setResolvedSignatureUri] = useState<string | null>(null);
  const safeJob = job ?? null;
  const titleText = safeJob?.title || safeJob?.jobTitle || translations.untitledJob || 'Job';
  const descriptionText = safeJob?.description || safeJob?.workDescription || '-';
  const status = normalizeStatus(safeJob?.status);
  const statusColor = getStatusColor ? getStatusColor(status) : undefined;
  const photos = Array.isArray(safeJob?.photos) ? safeJob.photos : [];
  const partsUsed = Array.isArray(safeJob?.partsUsed) ? safeJob.partsUsed : [];
  const companyId = getCompanyId();
  const jobId = String(safeJob?.id || '').trim();

  useEffect(() => {
    let cancelled = false;

    async function hydrateAttachmentUris() {
      if (!visible || !safeJob) {
        setResolvedPhotoUris([]);
        setResolvedSignatureUri(null);
        return;
      }

      try {
        const nextPhotoUris = await Promise.all(
          photos.map((photo) => resolveJobFileUri(photo, companyId, jobId)),
        );
        const nextSignatureUri = await resolveJobFileUri(
          safeJob.signature,
          companyId,
          jobId,
        );

        if (!cancelled) {
          setResolvedPhotoUris(
            nextPhotoUris.filter((value): value is string => Boolean(value)),
          );
          setResolvedSignatureUri(nextSignatureUri);
        }
      } catch {
        if (!cancelled) {
          setResolvedPhotoUris([]);
          setResolvedSignatureUri(null);
        }
      }
    }

    void hydrateAttachmentUris();
    return () => {
      cancelled = true;
    };
  }, [companyId, jobId, photos, safeJob, visible]);

  if (!visible || !safeJob) return null;

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
              <DetailRow label={translations.location || 'Location'} value={safeJob.location} labelColor={palette.textSecondary} />
              <DetailRow label={translations.clientName || 'Client'} value={safeJob.cname} labelColor={palette.textSecondary} />
              <DetailRow label={translations.clientPhone || 'Phone'} value={safeJob.cphone} labelColor={palette.textSecondary} />
              <DetailRow
                label={translations.assignedBy || 'Assigned By'}
                value={safeJob.mname}
                labelColor={palette.textSecondary}
              />
              <DetailRow label={translations.createdAt || 'Created'} value={formatDate(safeJob.createdAt)} labelColor={palette.textSecondary} />
              <DetailRow label={translations.finishedAt || 'Finished'} value={formatDate(safeJob.finishedAt)} labelColor={palette.textSecondary} />
              <DetailRow
                label={translations.timeWorked || translations.timeStatus || 'Time'}
                value={
                  safeJob.timeWorked ||
                  (safeJob.timeFrom || safeJob.timeTo ? `${safeJob.timeFrom || '--'} - ${safeJob.timeTo || '--'}` : '-')
                }
                labelColor={palette.textSecondary}
              />
              <DetailRow label={translations.signingPerson || 'Signed By'} value={safeJob.signingPerson} labelColor={palette.textSecondary} />
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
              {resolvedPhotoUris.length === 0 ? (
                <AppText variant="caption" color={palette.textLight} style={styles.emptyText}>
                  {translations.noPhotos || 'No photos'}
                </AppText>
              ) : (
                <View style={styles.photoGrid}>
                  {resolvedPhotoUris.map((uri, index) => {
                    return (
                      <TouchableOpacity
                        key={`${uri}-${index}`}
                        onPress={() => onImagePress?.(uri)}
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
              {resolvedSignatureUri ? (
                <Image source={{ uri: resolvedSignatureUri }} style={styles.signature} resizeMode="contain" />
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
