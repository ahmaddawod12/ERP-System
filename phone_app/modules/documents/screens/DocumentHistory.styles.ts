import { StyleSheet } from 'react-native';
import { spacing, borderRadius, typography, shadows } from '../../../theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  heroCard: {
    marginBottom: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.body,
  },
  errorText: {
    marginTop: spacing.sm,
    fontSize: typography.small,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  retryButtonWrap: {
    width: '72%',
    marginTop: spacing.md,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  headerTitle: {
    fontSize: typography.h1,
    fontWeight: 'bold',
    marginTop: spacing.sm,
  },
  headerSubtitle: {
    fontSize: typography.body,
    marginTop: spacing.xs,
  },
  filtersContainer: {
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  filtersRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  filterLabel: {
    fontSize: typography.body,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  dropdownButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  selectedIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownText: {
    fontSize: typography.body,
    fontWeight: '500',
  },
  dropdownOptions: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.md,
    ...shadows.md,
    overflow: 'hidden',
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    gap: spacing.sm,
  },
  dropdownOptionBorder: {
    borderBottomWidth: 1,
  },
  optionIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitle: {
    fontSize: typography.body,
  },
  dateFilterButton: {
    flex: 1,
  },
  dateFilterGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  dateFilterText: {
    color: 'white',
    fontSize: typography.body,
    fontWeight: '600',
  },
  clearDatesButton: {
    marginBottom: spacing.md,
  },
  clearDatesGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  clearDatesText: {
    color: 'white',
    fontSize: typography.body,
    fontWeight: '600',
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    fontSize: typography.body,
  },
  documentsContainer: {
    gap: spacing.md,
  },
  showMoreButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyText: {
    fontSize: typography.body,
    marginTop: spacing.md,
  },
  documentCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.md,
  },
  documentHeader: {
    marginBottom: spacing.md,
  },
  documentTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  documentTitleInfo: {
    flex: 1,
  },
  documentType: {
    fontSize: typography.h3,
    fontWeight: 'bold',
  },
  documentDate: {
    fontSize: typography.small,
    marginTop: spacing.xs,
  },
  documentDetails: {
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  detailText: {
    fontSize: typography.body,
  },
  documentDescription: {
    fontSize: typography.small,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  documentActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
  },
  actionButtonThree: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  actionButtonText: {
    color: 'white',
    fontSize: typography.small,
    fontWeight: '600',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    maxHeight: '80%',
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  modalTitle: {
    fontSize: typography.h2,
    fontWeight: 'bold',
  },
  modalScrollView: {
    marginBottom: spacing.lg,
  },
  previewRow: {
    marginBottom: spacing.md,
  },
  previewLabel: {
    fontSize: typography.small,
    marginBottom: spacing.xs,
  },
  previewValue: {
    fontSize: typography.body,
    fontWeight: '600',
  },
  closeButton: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  closeButtonText: {
    color: 'white',
    fontSize: typography.body,
    fontWeight: 'bold',
  },
  clientFilterInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  clientInput: {
    flex: 1,
    fontSize: typography.body,
    padding: spacing.xs,
  },
});
