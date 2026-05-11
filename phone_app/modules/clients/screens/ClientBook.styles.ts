import { Platform, StyleSheet } from 'react-native';
import { spacing, borderRadius, typography, shadows } from '../../../theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Header
  headerContainer: {
    zIndex: 1,
  },
  headerGradient: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomLeftRadius: borderRadius.xl,
    borderBottomRightRadius: borderRadius.xl,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: typography.xxl + 2,
    fontWeight: typography.bold,
    color: 'white',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: typography.sm,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.md,
  },
  // Search
  searchWrapper: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    height: 48,
    gap: spacing.xs,
    ...shadows.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.base,
    paddingVertical: 0,
  },
  // List
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl + 20,
  },
  listContentEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  // Client Card
  clientCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  clientCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clientAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  clientCardInfo: {
    flex: 1,
  },
  clientNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 3,
  },
  clientName: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    flex: 1,
  },
  idBadge: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  idBadgeText: {
    fontSize: typography.xs - 1,
    fontWeight: typography.bold,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  clientDetail: {
    fontSize: typography.xs,
    flex: 1,
  },
  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl * 2,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    marginTop: spacing.sm,
  },
  emptyDesc: {
    fontSize: typography.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
  },

  // ====================== Options Modal ======================
  optionsOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: spacing.lg,
  },
  optionsContainer: {
    width: '100%',
    maxWidth: 400,
    borderRadius: borderRadius.xl + 4,
    overflow: 'hidden',
    ...shadows.lg,
  },
  optionsHeader: {
    overflow: 'hidden',
  },
  optionsHeaderGradient: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  optionsHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  optionsHeaderTitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    color: 'white',
  },
  optionsHeaderSubtitle: {
    fontSize: typography.xs,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  optionsButtonList: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    gap: spacing.md,
  },
  optionIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionButtonTitle: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
  },

  // ====================== Data Modal ======================
  dataModalContainer: {
    flex: 1,
  },
  dataModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  dataModalClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dataModalTitle: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: 'rgba(255,255,255,0.85)',
  },
  dataModalSubtitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    color: 'white',
  },
  // Month Navigator
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    ...shadows.sm,
  },
  monthNavButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  monthNavCenter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  monthNavText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  // Data Cards
  dataListContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.xs,
  },
  dataListEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  dataCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  dataCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  dataCardTitle: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  statusBadgeText: {
    fontSize: typography.xs,
    fontWeight: typography.bold,
  },
  docTypeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  docTypeBadgeText: {
    fontSize: typography.xs,
    fontWeight: typography.bold,
  },
  docNumberText: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
  },
  amountText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  dataCardDetails: {
    marginTop: spacing.sm,
    gap: 4,
  },
  dataDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dataDetailText: {
    fontSize: typography.sm,
    flex: 1,
  },
  dataLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dataEmptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl * 2,
    gap: spacing.md,
  },
  dataEmptyText: {
    fontSize: typography.base,
    textAlign: 'center',
  },

  // ====================== Add/Edit Modal ======================
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContainer: {
    borderTopLeftRadius: borderRadius.xl + 4,
    borderTopRightRadius: borderRadius.xl + 4,
    maxHeight: '85%',
    ...shadows.lg,
  },
  modalHeader: {
    overflow: 'hidden',
    borderTopLeftRadius: borderRadius.xl + 4,
    borderTopRightRadius: borderRadius.xl + 4,
  },
  modalHeaderGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  modalTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: 'white',
  },
  // Form
  formScroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  formField: {
    marginBottom: spacing.md,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  formInput: {
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    fontSize: typography.base,
  },
  // Actions
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  deleteButton: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    height: 48,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  saveButtonWrapper: {
    height: 48,
  },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  saveButtonText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    color: 'white',
  },
});
