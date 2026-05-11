import { StyleSheet } from 'react-native';
import { spacing, borderRadius, typography, shadows } from '../../../theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
  },
  section: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  sectionTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    marginBottom: spacing.md,
  },
  sectionDescription: {
    fontSize: typography.sm,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  // Receipt mode selection
  receiptModeContainer: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  receiptModeCard: {
    flex: 1,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  receiptModeIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  receiptModeTitle: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  receiptModeDescription: {
    fontSize: typography.xs,
    textAlign: 'center',
    lineHeight: 16,
  },
  receiptModeTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  receiptModeMainTitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
  },
  receiptModeCardRecommended: {
    borderColor: '#10B981',
    borderWidth: 2,
  },
  recommendedBadge: {
    position: 'absolute',
    top: -10,
    right: 10,
    backgroundColor: '#10B981',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  recommendedBadgeText: {
    color: 'white',
    fontSize: typography.xs,
    fontWeight: typography.bold,
  },
  receiptModeFeatures: {
    width: '100%',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  featureText: {
    fontSize: typography.xs,
  },
  itemsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  lockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  lockedBadgeText: {
    fontSize: typography.xs,
    fontWeight: typography.medium,
  },
  itemCardReadOnly: {
    opacity: 0.9,
  },
  inputReadOnly: {
    opacity: 0.7,
  },
  receiptModeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  changeModeButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
  },
  changeModeText: {
    color: 'white',
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    marginBottom: spacing.xs,
  },
  requiredStar: {
    color: '#EF4444',
  },
  optionalText: {
    fontSize: typography.xs,
    fontWeight: typography.regular,
    opacity: 0.6,
  },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: typography.base,
  },
  inputMultiline: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: typography.base,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  // Customer Type
  customerTypeContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  customerTypeButton: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  customerTypeButtonActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  customerTypeText: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  // Payment Methods
  paymentMethodsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  paymentMethodButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
  },
  paymentMethodButtonActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  paymentMethodText: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
  },
  // Invoice Selection
  selectedInvoiceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  selectedInvoiceInfo: {
    flex: 1,
  },
  selectedInvoiceLabel: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
  },
  selectedInvoiceDetail: {
    fontSize: typography.sm,
    marginTop: 2,
  },
  changeInvoiceButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
  },
  changeInvoiceText: {
    color: 'white',
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  selectInvoiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  selectInvoiceText: {
    fontSize: typography.base,
  },
  // Items
  itemCard: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  itemNumber: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  addItemButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  addItemText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  totalContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    marginTop: spacing.md,
    borderTopWidth: 1,
  },
  totalLabel: {
    fontSize: typography.lg,
    fontWeight: typography.semibold,
  },
  totalValue: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
  },
  // Buttons
  buttonContainer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacing.md + 2,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  submitButtonContainer: {
    flex: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md + 2,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  submitButtonText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    ...shadows.sm,
  },
  modalTitle: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.base,
  },
  invoiceList: {
    padding: spacing.lg,
  },
  invoiceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  invoiceItemLeft: {
    marginRight: spacing.md,
  },
  invoiceIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invoiceItemContent: {
    flex: 1,
  },
  invoiceItemNumber: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
  },
  invoiceItemCustomer: {
    fontSize: typography.sm,
    marginTop: 2,
  },
  invoiceItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  invoiceItemDate: {
    fontSize: typography.xs,
  },
  invoiceItemAmount: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  // PDF Modal
  pdfModalContainer: {
    flex: 1,
  },
  pdfModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    ...shadows.sm,
  },
  pdfModalTitle: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    flex: 1,
  },
  closePdfButton: {
    padding: spacing.xs,
  },
  pdfActionsContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  pdfSuccessText: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
  pdfInfoText: {
    fontSize: typography.base,
    marginTop: spacing.sm,
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  openPdfButtonContainer: {
    width: '100%',
    maxWidth: 300,
  },
  openPdfButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
  },
  openPdfButtonText: {
    color: 'white',
    fontSize: typography.lg,
    fontWeight: typography.bold,
  },
  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.base,
  },
  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  emptyText: {
    fontSize: typography.base,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  // 2-step Tax Invoice flow styles
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  stepDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotText: {
    fontSize: typography.sm,
    fontWeight: typography.bold,
    color: '#999',
  },
  stepConnector: {
    flex: 1,
    height: 3,
    backgroundColor: '#E0E0E0',
    marginHorizontal: spacing.sm,
    maxWidth: 80,
  },
  sectionSubtitle: {
    fontSize: typography.sm,
    marginBottom: spacing.md,
  },
  noProposalsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: borderRadius.lg,
  },
  noProposalsText: {
    fontSize: typography.sm,
  },
  proposalCard: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  proposalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  proposalInfo: {
    flex: 1,
  },
  proposalTitle: {
    fontSize: typography.base,
    fontWeight: typography.semiBold,
  },
  proposalMeta: {
    fontSize: typography.sm,
  },
  selectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  selectedBadgeText: {
    color: '#fff',
    fontSize: typography.xs,
    fontWeight: typography.bold,
  },
  continueButtonContainer: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
  },
  continueButtonText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
});
