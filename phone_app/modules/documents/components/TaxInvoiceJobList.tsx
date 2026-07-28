import {
  View,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AppInput, AppText, ScrollableContainer } from '../../../components';
import { spacing, borderRadius, typography, shadows, type ColorPalette } from '../../../theme';

export interface TaxInvoiceJob {
  id: string;
  title?: string;
  description?: string;
  wname?: string;
  cname?: string;
  cphone?: string;
  location?: string;
  timeWorked?: string;
  finishedAt?: string | Date;
  partsUsed?: unknown[];
  clientId?: string;
  isCert?: boolean;
  status?: string;
}

interface TaxInvoiceJobListProps {
  filteredJobs: TaxInvoiceJob[];
  selectedJobs: TaxInvoiceJob[];
  setSelectedJobs: (jobs: TaxInvoiceJob[]) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  toggleJobSelection: (job: TaxInvoiceJob) => void;
  formatDate: (value?: string | Date | null) => string;
  handleOpenModal: (jobs: TaxInvoiceJob[]) => void;
  colors: ColorPalette;
  t: Record<string, string>;
  insets: { bottom: number };
  loading?: boolean;
}

/**
 * Job list sub-component for the Generate Tax Invoice screen.
 * Renders the search bar, the finished jobs list, and the floating selection bar.
 */
export default function TaxInvoiceJobList({
  filteredJobs,
  selectedJobs,
  setSelectedJobs,
  searchQuery,
  setSearchQuery,
  toggleJobSelection,
  formatDate,
  handleOpenModal,
  colors,
  t,
  insets,
  loading,
}: TaxInvoiceJobListProps) {
  return (
    <>
      {/* Search Bar */}
      <AppInput
        placeholder={t.searchPlaceholder}
        value={searchQuery}
        onChangeText={setSearchQuery}
        colors={colors}
        leftIcon={<Ionicons name="search" size={20} color={colors.textSecondary} />}
        rightIcon={searchQuery.length > 0 ? (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
        containerStyle={styles.searchContainer}
      />

      {/* Jobs List */}
      <ScrollableContainer 
        style={[styles.scrollView, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.scrollContent, { paddingTop: 100, paddingBottom: insets.bottom + 80 }]}
      >
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <AppText style={[styles.loadingText, { color: colors.textSecondary }]}>{t.loading}</AppText>
          </View>
        ) : filteredJobs.length === 0 ? (
          <View style={styles.centerContainer}>
            <MaterialCommunityIcons name="file-document-outline" size={64} color={colors.textSecondary} />
            <AppText style={[styles.noJobsText, { color: colors.textSecondary }]}>{t.noJobs}</AppText>
          </View>
        ) : (
          filteredJobs.map((job) => {
            const isSelected = selectedJobs.some(j => j.id === job.id);
            return (
            <TouchableOpacity 
              key={job.id} 
              activeOpacity={0.7}
              onPress={() => toggleJobSelection(job)}
              style={[
                styles.jobCard, 
                { backgroundColor: colors.surface },
                isSelected && { borderWidth: 2, borderColor: colors.primary },
              ]}
            >
              {/* Job Header */}
              <View style={styles.jobHeader}>
                <View style={styles.jobHeaderLeft}>
                  {/* Checkbox */}
                  <Ionicons 
                    name={isSelected ? "checkbox" : "square-outline"} 
                    size={24} 
                    color={isSelected ? colors.primary : colors.textSecondary} 
                  />
                  <MaterialCommunityIcons name="briefcase-check" size={24} color={colors.primary} />
                  <AppText style={[styles.jobTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                    {job.title || 'Untitled Job'}
                  </AppText>
                </View>
              </View>

              {/* Job Details */}
              <View style={styles.jobDetails}>
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="account" size={18} color={colors.textSecondary} />
                  <AppText style={[styles.detailLabel, { color: colors.textSecondary }]}>{t.worker}:</AppText>
                  <AppText style={[styles.detailValue, { color: colors.textPrimary }]}>{job.wname || 'N/A'}</AppText>
                </View>

                {job.cname && (
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="account-tie" size={18} color={colors.textSecondary} />
                    <AppText style={[styles.detailLabel, { color: colors.textSecondary }]}>{t.customer}:</AppText>
                    <AppText style={[styles.detailValue, { color: colors.textPrimary }]}>{job.cname}</AppText>
                  </View>
                )}

                {job.cphone && (
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="phone" size={18} color={colors.textSecondary} />
                    <AppText style={[styles.detailLabel, { color: colors.textSecondary }]}>{t.phone || 'Phone'}:</AppText>
                    <AppText style={[styles.detailValue, { color: colors.textPrimary }]}>{job.cphone}</AppText>
                  </View>
                )}

                {job.location && (
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="map-marker" size={18} color={colors.textSecondary} />
                    <AppText style={[styles.detailLabel, { color: colors.textSecondary }]}>{t.location}:</AppText>
                    <AppText style={[styles.detailValue, { color: colors.textPrimary }]} numberOfLines={1}>
                      {job.location}
                    </AppText>
                  </View>
                )}

                {job.timeWorked && (
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="clock-outline" size={18} color={colors.textSecondary} />
                    <AppText style={[styles.detailLabel, { color: colors.textSecondary }]}>{t.timeWorked}:</AppText>
                    <AppText style={[styles.detailValue, { color: colors.textPrimary }]}>{job.timeWorked}</AppText>
                  </View>
                )}

                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="calendar-check" size={18} color={colors.textSecondary} />
                  <AppText style={[styles.detailLabel, { color: colors.textSecondary }]}>{t.completedOn}:</AppText>
                  <AppText style={[styles.detailValue, { color: colors.textPrimary }]}>
                    {formatDate(job.finishedAt)}
                  </AppText>
                </View>

                {job.partsUsed && job.partsUsed.length > 0 && (
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="package-variant" size={18} color={colors.textSecondary} />
                    <AppText style={[styles.detailLabel, { color: colors.textSecondary }]}>{t.parts}:</AppText>
                    <AppText style={[styles.detailValue, { color: colors.textPrimary }]}>
                      {job.partsUsed.length} items
                    </AppText>
                  </View>
                )}
              </View>
            </TouchableOpacity>
            );
          })
        )}
      </ScrollableContainer>

      {/* Floating bottom bar: selected count + Generate button */}
      {selectedJobs.length > 0 && (
        <View style={[styles.selectionBar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + 10 }]}>
          <View style={styles.selectionBarContent}>
            <View style={styles.selectionInfo}>
              <AppText style={[styles.selectionCountText, { color: colors.primary }]}>
                {selectedJobs.length} {t.jobsSelected}
              </AppText>
              <TouchableOpacity onPress={() => setSelectedJobs([])}>
                <AppText style={[styles.deselectText, { color: colors.error }]}>{t.deselectAll}</AppText>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={() => handleOpenModal(selectedJobs)}
            >
              <LinearGradient
                colors={['#00ACC1', '#0097A7']}
                style={styles.generateSelectedButton}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <MaterialCommunityIcons name="receipt" size={20} color="white" />
                <AppText style={styles.generateButtonText}>{t.generateFromSelected}</AppText>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: Platform.OS === 'ios' ? 110 : 98,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    ...shadows.sm,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.base,
    paddingVertical: spacing.xs,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.base,
  },
  noJobsText: {
    marginTop: spacing.md,
    fontSize: typography.lg,
    textAlign: 'center',
  },
  jobCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.md,
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  jobHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  jobTitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    flex: 1,
  },
  jobDetails: {
    gap: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  detailLabel: {
    fontSize: typography.sm,
    marginLeft: spacing.xs,
  },
  detailValue: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    flex: 1,
  },
  // Multi-select bottom bar styles
  selectionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    ...shadows.lg,
  },
  selectionBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  selectionInfo: {
    flex: 1,
  },
  selectionCountText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  deselectText: {
    fontSize: typography.sm,
    marginTop: 2,
  },
  generateSelectedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  generateButtonText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
});

