import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { useSession } from '../../contexts/SessionContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import AppButton from '../primitives/AppButton';
import AppCard from '../primitives/AppCard';
import AppChip from '../primitives/AppChip';
import AppIcon from '../primitives/AppIcon';
import AppText from '../primitives/AppText';
import AppDivider from '../primitives/AppDivider';
import type { DateLike, JobFileRef } from '../../types';
import { resolveJobFileUri } from '../../modules/jobs/lib/job-file-utils';
import { fetchJobDetail } from '../../modules/jobs/lib/jobs-api';
import { mapJobDetail } from '../../modules/jobs/lib/job-list-model';
import { tenantQueryKey } from '../../lib/query/client';

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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const { user } = useSession();
  const themeContext = useThemeContext();
  const darkMode = typeof isDarkMode === 'boolean' ? isDarkMode : themeContext.isDarkMode;
  const palette = getColors(darkMode);
  const [resolvedPhotoUris, setResolvedPhotoUris] = useState<string[]>([]);
  const [resolvedSignatureUri, setResolvedSignatureUri] = useState<string | null>(null);
  const safeJob = job ?? null;
  const companyId = Number(getCompanyId());
  const uid = user?.id ?? '';
  const jobId = String(safeJob?.id || '').trim();
  const canLoadDetail = visible
    && uid.length > 0
    && Number.isSafeInteger(companyId)
    && companyId > 0
    && UUID_PATTERN.test(jobId);
  const detailQuery = useQuery({
    queryKey: tenantQueryKey(uid, companyId, 'jobs', 'detail', jobId),
    queryFn: ({ signal }) => fetchJobDetail({ uid, companyId, jobId, signal }),
    enabled: canLoadDetail,
  });
  const authoritativeJob = useMemo(
    () => detailQuery.data ? mapJobDetail(detailQuery.data) : null,
    [detailQuery.data],
  );
  const displayedJob = (authoritativeJob ?? safeJob) as JobData | null;
  const titleText = displayedJob?.title || displayedJob?.jobTitle || translations.untitledJob || 'Job';
  const descriptionText = displayedJob?.description || displayedJob?.workDescription || '-';
  const status = normalizeStatus(displayedJob?.status);
  const statusColor = getStatusColor ? getStatusColor(status) : undefined;
  const photos = Array.isArray(displayedJob?.photos) ? displayedJob.photos : [];
  const partsUsed = Array.isArray(displayedJob?.partsUsed) ? displayedJob.partsUsed : [];

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function hydrateAttachmentUris() {
      if (!visible || !displayedJob) {
        setResolvedPhotoUris([]);
        setResolvedSignatureUri(null);
        return;
      }

      try {
        const nextPhotoUris = await Promise.all(
          photos.map((photo) => resolveJobFileUri(photo, uid, companyId, jobId, controller.signal)),
        );
        const nextSignatureUri = await resolveJobFileUri(
          displayedJob.signature,
          uid,
          companyId,
          jobId,
          controller.signal,
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
      controller.abort();
    };
  }, [authoritativeJob, companyId, jobId, safeJob, uid, visible]);

  if (!visible || !displayedJob) return null;

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
               <DetailRow label={translations.location || 'Location'} value={displayedJob.location} labelColor={palette.textSecondary} />
               <DetailRow label={translations.clientName || 'Client'} value={displayedJob.cname} labelColor={palette.textSecondary} />
               <DetailRow label={translations.clientPhone || 'Phone'} value={displayedJob.cphone} labelColor={palette.textSecondary} />
              <DetailRow
                label={translations.assignedBy || 'Assigned By'}
                 value={displayedJob.mname}
                labelColor={palette.textSecondary}
              />
               <DetailRow label={translations.createdAt || 'Created'} value={formatDate(displayedJob.createdAt)} labelColor={palette.textSecondary} />
               <DetailRow label={translations.finishedAt || 'Finished'} value={formatDate(displayedJob.finishedAt)} labelColor={palette.textSecondary} />
              <DetailRow
                label={translations.timeWorked || translations.timeStatus || 'Time'}
                value={
                   displayedJob.timeWorked ||
                   (displayedJob.timeFrom || displayedJob.timeTo ? `${displayedJob.timeFrom || '--'} - ${displayedJob.timeTo || '--'}` : '-')
                }
                labelColor={palette.textSecondary}
              />
               <DetailRow label={translations.signingPerson || 'Signed By'} value={displayedJob.signingPerson} labelColor={palette.textSecondary} />
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
