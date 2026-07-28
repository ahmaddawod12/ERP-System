import { Platform, StyleSheet } from 'react-native';

import { spacing, borderRadius, typography, shadows } from '../../../theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  warningBox: {
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    ...shadows.sm,
  },
  warningBoxContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  warningBoxIcon: {
    marginRight: spacing.md,
  },
  warningBoxText: {
    flex: 1,
  },
  warningTitle: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    marginBottom: spacing.xs / 2,
    letterSpacing: 0.2,
  },
  warningDescription: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  heroCard: {
    marginBottom: spacing.lg,
  },
  addButton: {
    marginBottom: spacing.md,
  },
  catalogNotice: {
    marginBottom: spacing.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  catalogNoticeText: {
    flex: 1,
    fontSize: typography.sm,
    lineHeight: 20,
  },
  queryErrorCard: {
    marginBottom: spacing.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  retryButton: {
    alignSelf: 'flex-start',
  },
  loadMoreButton: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  formLabel: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    marginBottom: spacing.xs,
    letterSpacing: 0.2,
  },
  formInput: {
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.base,
    fontWeight: '600',
    borderWidth: 1.5,
  },
  formButtonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  formPrimaryButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  formPrimaryButtonText: {
    color: 'white',
    fontWeight: typography.bold,
    fontSize: typography.base,
    letterSpacing: 0.3,
  },
  formSecondaryButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  formSecondaryButtonText: {
    fontWeight: typography.bold,
    fontSize: typography.base,
    letterSpacing: 0.3,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  searchInput: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    fontSize: typography.base,
  },
  emptyCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.xxl,
    alignItems: 'center',
    ...shadows.card,
  },
  emptyTitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    marginBottom: spacing.xs,
    letterSpacing: -0.2,
  },
  emptySubtitle: {
    fontSize: typography.sm,
    letterSpacing: 0.2,
  },
  partCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  partHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  partInfo: {
    flex: 1,
  },
  partNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    gap: spacing.xs,
  },
  idBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  idBadgeText: {
    fontSize: typography.sm,
    fontWeight: typography.bold,
    letterSpacing: 0.3,
  },
  warningIcon: {
    marginRight: spacing.xs,
  },
  partName: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    letterSpacing: -0.2,
    flex: 1,
  },
  partQuantity: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  partActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionButton: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 6,
    borderRadius: borderRadius.md,
  },
  actionButtonText: {
    fontWeight: typography.bold,
    fontSize: typography.xs,
    letterSpacing: 0.3,
  },
  amountInput: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.2)',
  },
  amountTextInput: {
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.base,
    fontWeight: '600',
    borderWidth: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  confirmButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: 'white',
    fontWeight: typography.bold,
    letterSpacing: 0.3,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontWeight: typography.bold,
    letterSpacing: 0.3,
  },
  // ─── Company Parts Picker Modal ───
  pickerOverlay: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  pickerTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    letterSpacing: -0.3,
    flex: 1,
  },
  pickerCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerSearch: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    fontSize: typography.base,
  },
  pickerList: {
    padding: spacing.lg,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    gap: spacing.sm,
  },
  pickerItemName: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    flex: 1,
    letterSpacing: -0.2,
  },
  pickerEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  pickerEmptyText: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
  },
  pickerForm: {
    padding: spacing.lg,
  },
  selectedPartBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  selectedPartName: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    flex: 1,
    letterSpacing: -0.2,
  },
});


