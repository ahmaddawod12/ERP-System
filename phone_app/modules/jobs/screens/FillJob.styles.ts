import { Platform, StyleSheet } from 'react-native';
import { spacing, borderRadius } from '../../../theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  heroCard: {
    marginHorizontal: spacing.md,
    marginTop: Platform.OS === 'ios' ? 96 : 88,
    marginBottom: spacing.lg,
  },
  card: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
    padding: 0,
    borderRadius: 12,
    overflow: 'hidden',
    borderLeftWidth: 4,
    borderLeftColor: '#00ACC1',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: 'rgba(0, 172, 193, 0.08)',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginLeft: spacing.sm,
    flex: 1,
  },
  input: {
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    marginBottom: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
    paddingTop: 14,
  },
  timeRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  timeColumn: {
    flex: 1,
  },
  timeLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: spacing.xs,
    opacity: 0.7,
  },
  timeButton: {
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
  },
  timeText: {
    fontSize: 15,
    fontWeight: '500',
  },
  locationButton: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  travelDistanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  travelDistanceInput: {
    flex: 1,
    marginBottom: 0,
    marginHorizontal: 0,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  travelDistanceUnit: {
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  travelDistanceUnitText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 12,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  actionButton: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  photosList: {
    marginTop: spacing.md,
    paddingLeft: spacing.lg,
  },
  photoPreview: {
    width: 90,
    height: 90,
    borderRadius: 8,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
  },
  partsList: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  partItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 8,
    gap: spacing.sm,
    backgroundColor: 'rgba(0, 172, 193, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0, 172, 193, 0.15)',
  },
  partName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  partBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#00ACC1',
  },
  partBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '700',
  },
  signatureContainer: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  signatureLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: spacing.sm,
    opacity: 0.7,
  },
  signaturePreview: {
    width: '100%',
    height: 160,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#10B981',
    backgroundColor: '#FFFFFF',
  },
  actionButtons: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    flex: 0.8,
  },
  draftButton: {
    flex: 1,
  },
  submitButton: {
    flex: 1.2,
  },
});
