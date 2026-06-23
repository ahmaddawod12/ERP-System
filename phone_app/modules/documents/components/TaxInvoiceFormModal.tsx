// @ts-nocheck
import React from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { WebView } from 'react-native-webview';
import { AppText, AppInput, GlobalHeader, InventoryItemSearch } from '../../../components';
import { spacing, borderRadius, typography, shadows } from '../../../theme';

/**
 * Form modal sub-component for the Generate Tax Invoice screen.
 * Contains the 2-step form modal, PDF preview modal, and PDF viewer modal (iOS).
 */
export default function TaxInvoiceFormModal({
  modalVisible,
  closeReceiptForm,
  currentStep,
  goToStep1,
  goToStep2,
  invoiceData,
  setInvoiceData,
  selectedClientObj,
  matchingProposals,
  selectedPriceProposal,
  applyPriceProposal,
  jobParts,
  updateJobPartPrice,
  customParts,
  updateCustomPart,
  handleCustomPartSelect,
  addCustomPart,
  removeCustomPart,
  selectedJobs,
  handlePreviewInvoice,
  handleSubmitInvoice,
  downloadAndSharePDF,
  previewLoading,
  previewURL,
  pdfModalVisible,
  setPdfModalVisible,
  pdfViewerVisible,
  setPdfViewerVisible,
  colors,
  isDarkMode,
  t,
  insets,
  language,
  getInventoryParts,
  alert,
}) {
  const showErrorMessage = (title, message) => alert.error(title, message);

  return (
    <>
      {/* Receipt Form Modal - 2 Step Flow */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={closeReceiptForm}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
            <StatusBar style={isDarkMode ? "light" : "dark"} />
            
            <GlobalHeader />

            {/* Modal Header with Step Indicator */}
            <View style={[styles.modalHeader, { paddingTop: insets.top + 60, backgroundColor: colors.surface }]}>
              <TouchableOpacity onPress={closeReceiptForm} style={styles.closeButton}>
                <Ionicons name="close" size={28} color={colors.textPrimary} />
              </TouchableOpacity>
              <View style={styles.stepHeaderCenter}>
                <AppText style={[styles.modalTitle, { color: colors.textPrimary }]}>
                  {currentStep === 1 ? t.step1Title : t.step2Title}
                </AppText>
                {/* Step Indicator Dots */}
                <View style={styles.stepIndicator}>
                  <View style={[styles.stepDot, currentStep === 1 && { backgroundColor: colors.primary }]} />
                  <View style={[styles.stepConnector, { backgroundColor: currentStep === 2 ? colors.primary : colors.border }]} />
                  <View style={[styles.stepDot, currentStep === 2 && { backgroundColor: colors.primary }]} />
                </View>
              </View>
              <View style={{ width: 28 }} />
            </View>

            <ScrollView 
              style={styles.formScrollView}
              contentContainerStyle={[styles.formContent, { paddingBottom: insets.bottom + 20 }]}
            >
              {/* =========== STEP 1: Client Details =========== */}
              {currentStep === 1 && (
                <>
                  {/* Client Source Badge */}
                  {selectedClientObj && (
                    <View style={[styles.clientSourceBadge, { backgroundColor: colors.success + '15', borderColor: colors.success + '40' }]}>
                      <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                      <AppText style={[styles.clientSourceText, { color: colors.success }]}>
                        {t.clientFromBook}
                      </AppText>
                    </View>
                  )}

                  {/* Customer Details Section */}
                  <View style={[styles.formSection, { backgroundColor: colors.surface }]}>
                    <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
                      {t.customerDetails}
                    </AppText>

                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.customerName} <AppText style={styles.requiredStar}>*</AppText>
                      </AppText>
                      <AppInput
                        value={invoiceData.customerName}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, customerName: text })}
                        placeholder={t.customerName}
                        colors={colors}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.customerVatNumber} <AppText style={styles.requiredStar}>*</AppText>
                      </AppText>
                      <AppInput
                        value={invoiceData.customerVatNumber}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, customerVatNumber: text })}
                        placeholder={t.customerVatNumber}
                        colors={colors}
                        keyboardType="number-pad"
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.customerEmail} <AppText style={styles.optionalText}>({t.optional})</AppText>
                      </AppText>
                      <AppInput
                        value={invoiceData.customerEmail}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, customerEmail: text })}
                        placeholder={t.customerEmail}
                        colors={colors}
                        keyboardType="email-address"
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.customerAddress} <AppText style={styles.optionalText}>({t.optional})</AppText>
                      </AppText>
                      <AppInput
                        value={invoiceData.customerAddress}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, customerAddress: text })}
                        placeholder={t.customerAddress}
                        colors={colors}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.customerCity} <AppText style={styles.optionalText}>({t.optional})</AppText>
                      </AppText>
                      <AppInput
                        value={invoiceData.customerCity}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, customerCity: text })}
                        placeholder={t.customerCity}
                        colors={colors}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.customerPhone} <AppText style={styles.optionalText}>({t.optional})</AppText>
                      </AppText>
                      <AppInput
                        value={invoiceData.customerPhone}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, customerPhone: text })}
                        placeholder={t.customerPhone}
                        colors={colors}
                        keyboardType="phone-pad"
                      />
                    </View>
                  </View>

                  {/* Matching Price Proposals */}
                  <View style={[styles.formSection, { backgroundColor: colors.surface }]}>
                    <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
                      {t.priceProposals}
                    </AppText>
                    <AppText style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
                      {t.selectProposal}
                    </AppText>

                    {matchingProposals.length === 0 ? (
                      <View style={[styles.noProposalsContainer, { backgroundColor: colors.backgroundLight }]}>
                        <MaterialCommunityIcons name="file-document-outline" size={32} color={colors.textSecondary} />
                        <AppText style={[styles.noProposalsText, { color: colors.textSecondary }]}>
                          {t.noProposals}
                        </AppText>
                      </View>
                    ) : (
                      matchingProposals.map((proposal) => {
                        const isSelected = selectedPriceProposal?.id === proposal.id;
                        const totalAmount = proposal.totalWithVat || proposal.totalBeforeVat || 0;
                        const itemCount = proposal.items?.length || 0;
                        const dateStr = proposal.createdAt ? new Date(proposal.createdAt).toLocaleDateString() : '';
                        
                        return (
                          <TouchableOpacity
                            key={proposal.id}
                            style={[
                              styles.proposalCard,
                              { backgroundColor: colors.backgroundLight, borderColor: isSelected ? colors.primary : colors.border },
                              isSelected && { borderWidth: 2 },
                            ]}
                            onPress={() => applyPriceProposal(proposal)}
                            activeOpacity={0.7}
                          >
                            <View style={styles.proposalHeader}>
                              <View style={styles.proposalInfo}>
                                <Ionicons 
                                  name={isSelected ? "checkmark-circle" : "document-text-outline"} 
                                  size={20} 
                                  color={isSelected ? colors.primary : colors.textSecondary} 
                                />
                                <AppText style={[styles.proposalTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                                  {proposal.cname || t.priceProposals}
                                </AppText>
                              </View>
                              {isSelected && (
                                <View style={[styles.selectedBadge, { backgroundColor: colors.primary + '20' }]}>
                                  <AppText style={[styles.selectedBadgeText, { color: colors.primary }]}>{t.selected}</AppText>
                                </View>
                              )}
                            </View>
                            <View style={styles.proposalMeta}>
                              {dateStr ? (
                                <AppText style={[styles.proposalMetaText, { color: colors.textSecondary }]}>
                                  {t.proposalDate}: {dateStr}
                                </AppText>
                              ) : null}
                              <AppText style={[styles.proposalMetaText, { color: colors.textSecondary }]}>
                                {itemCount} {t.proposalItems} • ₪{totalAmount.toFixed(2)}
                              </AppText>
                            </View>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </View>

                  {/* Continue Button */}
                  <View style={styles.buttonContainer}>
                    <TouchableOpacity
                      style={[styles.cancelButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                      onPress={closeReceiptForm}
                    >
                      <AppText style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{t.cancel}</AppText>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.submitButtonContainer}
                      onPress={goToStep2}
                    >
                      <LinearGradient
                        colors={['#3B82F6', '#2563EB']}
                        style={styles.submitButton}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                      >
                        <AppText style={styles.submitButtonText}>{t.continueToItems}</AppText>
                        <Ionicons name="arrow-forward" size={20} color="white" />
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* =========== STEP 2: Items & Pricing =========== */}
              {currentStep === 2 && (
                <>
                  {/* Service Details Section */}
                  <View style={[styles.formSection, { backgroundColor: colors.surface }]}>
                    <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
                      {t.serviceDetails}
                    </AppText>
                    
                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.serviceDescription} <AppText style={styles.requiredStar}>*</AppText>
                      </AppText>
                      <AppInput
                        value={invoiceData.serviceDescription}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, serviceDescription: text })}
                        placeholder={t.serviceDescription}
                        colors={colors}
                        multiline
                        numberOfLines={3}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                        {t.invoiceDate} <AppText style={styles.requiredStar}>*</AppText>
                      </AppText>
                      <AppInput
                        value={invoiceData.invoiceDate}
                        onChangeText={(text) => setInvoiceData({ ...invoiceData, invoiceDate: text })}
                        placeholder="YYYY-MM-DD"
                        colors={colors}
                      />
                    </View>
                  </View>

                  {/* Parts & Services Section */}
                  <View style={[styles.formSection, { backgroundColor: colors.surface }]}>
                    <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
                      {t.partsAndServices}
                    </AppText>

                    {/* Price Proposal Applied Badge */}
                    {selectedPriceProposal && (
                      <View style={[styles.proposalAppliedBadge, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
                        <Ionicons name="pricetag" size={16} color={colors.primary} />
                        <AppText style={[styles.proposalAppliedText, { color: colors.primary }]}>
                          {language === 'he' ? 'מחירים מהצעת מחיר' : language === 'ar' ? 'أسعار من عرض السعر' : 'Prices from Price Proposal'}
                        </AppText>
                        <TouchableOpacity onPress={() => applyPriceProposal(selectedPriceProposal)}>
                          <Ionicons name="close-circle" size={18} color={colors.primary} />
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Job Parts */}
                    {jobParts.length > 0 ? (
                      <>
                        <AppText style={[styles.inputLabel, { color: colors.textPrimary, marginBottom: spacing.sm }]}>
                          {selectedJobs.length > 1 ? t.mergedParts : t.jobParts}
                          {selectedJobs.length > 1 && (
                            <AppText style={{ fontSize: typography.xs, color: colors.textSecondary, fontWeight: 'normal' }}>
                              {' '}({selectedJobs.length} {t.jobsSelected})
                            </AppText>
                          )}
                        </AppText>
                        {jobParts.map((part, index) => (
                          <View key={index} style={[styles.partItem, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}>
                            <View style={styles.partRow}>
                              <AppText style={[styles.partName, { color: colors.textPrimary }]}>{part.name}</AppText>
                              <AppText style={[styles.partQuantity, { color: colors.textSecondary }]}>
                                {t.quantity}: {part.quantity}
                              </AppText>
                            </View>
                            <View style={styles.partPriceRow}>
                              <AppText style={[styles.inputLabel, { color: colors.textPrimary, marginBottom: 4 }]}>
                                {t.price} <AppText style={styles.requiredStar}>*</AppText>
                              </AppText>
                              <AppInput
                                value={part.price}
                                onChangeText={(text) => updateJobPartPrice(index, text)}
                                placeholder={t.price}
                                colors={colors}
                                keyboardType="decimal-pad"
                              />
                            </View>
                            {part.price && !isNaN(parseFloat(part.price)) && (
                              <AppText style={[styles.partTotal, { color: colors.primary }]}>
                                {t.totalPrice}: {(parseFloat(part.quantity) * parseFloat(part.price)).toFixed(2)} ₪
                              </AppText>
                            )}
                          </View>
                        ))}
                      </>
                    ) : (
                      <AppText style={[styles.noPartsText, { color: colors.textSecondary }]}>
                        {t.noPartsFromJob}
                      </AppText>
                    )}

                    {/* Custom Parts with Inventory Search */}
                    <View style={{ marginTop: spacing.lg }}>
                      <AppText style={[styles.inputLabel, { color: colors.textPrimary, marginBottom: spacing.sm }]}>
                        {t.customParts}
                      </AppText>
                      {customParts.map((part, index) => (
                        <View key={index} style={[styles.partItem, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}>
                          <View style={styles.partHeader}>
                            <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
                              {t.partName} <AppText style={styles.requiredStar}>*</AppText>
                            </AppText>
                            <TouchableOpacity onPress={() => removeCustomPart(index)}>
                              <MaterialCommunityIcons name="close-circle" size={24} color={colors.error} />
                            </TouchableOpacity>
                          </View>
                          <InventoryItemSearch
                            style={[styles.input, { backgroundColor: colors.surface, color: colors.textPrimary, borderColor: colors.border, marginBottom: spacing.sm }]}
                            value={part.name}
                            onChangeText={(text) => updateCustomPart(index, 'name', text)}
                            onSelectPart={(selectedPart) => handleCustomPartSelect(index, selectedPart)}
                            inventoryParts={getInventoryParts()}
                            placeholder={t.customPartPlaceholder}
                            colors={colors}
                          />
                          <View style={styles.partPriceRow}>
                            <View style={{ flex: 1, marginRight: spacing.sm }}>
                              <AppText style={[styles.inputLabel, { color: colors.textPrimary, marginBottom: 4 }]}>
                                {t.quantity} <AppText style={styles.requiredStar}>*</AppText>
                              </AppText>
                              <AppInput
                                value={part.quantity}
                                onChangeText={(text) => updateCustomPart(index, 'quantity', text)}
                                placeholder={t.quantity}
                                colors={colors}
                                keyboardType="decimal-pad"
                              />
                            </View>
                            <View style={{ flex: 1 }}>
                              <AppText style={[styles.inputLabel, { color: colors.textPrimary, marginBottom: 4 }]}>
                                {t.price} <AppText style={styles.requiredStar}>*</AppText>
                              </AppText>
                              <AppInput
                                value={part.price}
                                onChangeText={(text) => updateCustomPart(index, 'price', text)}
                                placeholder={t.price}
                                colors={colors}
                                keyboardType="decimal-pad"
                              />
                            </View>
                          </View>
                          {part.quantity && part.price && !isNaN(parseFloat(part.quantity)) && !isNaN(parseFloat(part.price)) && (
                            <AppText style={[styles.partTotal, { color: colors.primary }]}>
                              {t.totalPrice}: {(parseFloat(part.quantity) * parseFloat(part.price)).toFixed(2)} ₪
                            </AppText>
                          )}
                        </View>
                      ))}

                      {/* Add Custom Part Button */}
                      <TouchableOpacity
                        onPress={addCustomPart}
                        style={[styles.addPartButton, { backgroundColor: colors.primary }]}
                      >
                        <MaterialCommunityIcons name="plus-circle" size={20} color="white" />
                        <AppText style={styles.addPartButtonText}>{t.addCustomPart}</AppText>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Step 2 Buttons */}
                  <View style={styles.buttonContainer}>
                    <TouchableOpacity
                      style={[styles.cancelButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                      onPress={goToStep1}
                    >
                      <Ionicons name="arrow-back" size={18} color={colors.textPrimary} style={{ marginRight: 4 }} />
                      <AppText style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{t.backToClient}</AppText>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.submitButtonContainer}
                      onPress={handlePreviewInvoice}
                      disabled={previewLoading}
                    >
                      <LinearGradient
                        colors={previewLoading ? ['#9CA3AF', '#9CA3AF'] : ['#10B981', '#059669']}
                        style={styles.submitButton}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                      >
                        {previewLoading ? (
                          <ActivityIndicator color="white" />
                        ) : (
                          <>
                            <MaterialCommunityIcons name="eye" size={20} color="white" />
                            <AppText style={styles.submitButtonText}>{t.preview}</AppText>
                          </>
                        )}
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* PDF Preview Modal */}
      <Modal
        visible={pdfModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setPdfModalVisible(false)}
      >
        <View style={[styles.pdfModalContainer, { backgroundColor: colors.background }]}>
          <StatusBar style={isDarkMode ? "light" : "dark"} />
          
          {/* PDF Modal Header */}
          <View style={[styles.pdfModalHeader, { paddingTop: insets.top + 10, backgroundColor: colors.surface }]}>
            <AppText style={[styles.pdfModalTitle, { color: colors.textPrimary }]}>
              {t.previewTitle}
            </AppText>
            <TouchableOpacity onPress={() => setPdfModalVisible(false)} style={styles.closePdfButton}>
              <Ionicons name="close" size={28} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* PDF Actions */}
          {previewURL && (
            <View style={styles.pdfActionsContainer}>
              <MaterialCommunityIcons name="file-pdf-box" size={120} color={colors.primary} />
              <AppText style={[styles.pdfSuccessText, { color: colors.textPrimary }]}>
                Tax Invoice Generated Successfully!
              </AppText>
              <AppText style={[styles.pdfInfoText, { color: colors.textSecondary }]}>
                Your PDF is ready to view or share
              </AppText>

              <View style={styles.openPdfButtonContainer}>
                <TouchableOpacity onPress={downloadAndSharePDF}>
                  <LinearGradient
                    colors={['#3B82F6', '#2563EB']}
                    style={styles.openPdfButton}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  >
                    <MaterialCommunityIcons name="file-pdf-box" size={24} color="white" />
                    <AppText style={styles.openPdfButtonText}>Open PDF</AppText>
                  </LinearGradient>
                </TouchableOpacity>
              </View>

              <View style={[styles.openPdfButtonContainer, { marginTop: spacing.md }]}>
                <TouchableOpacity onPress={handleSubmitInvoice}>
                  <LinearGradient
                    colors={['#10B981', '#059669']}
                    style={styles.openPdfButton}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  >
                    <MaterialCommunityIcons name="check-circle" size={24} color="white" />
                    <AppText style={styles.openPdfButtonText}>Generate Invoice</AppText>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* PDF Viewer Modal - iOS only, Android uses IntentLauncher */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={pdfViewerVisible}
          animationType="slide"
          onRequestClose={() => {
            setPdfViewerVisible(false);
            setPdfModalVisible(true);
          }}
        >
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <StatusBar style={isDarkMode ? "light" : "dark"} />

          {/* Viewer Header */}
          <View style={[styles.pdfModalHeader, { backgroundColor: colors.surface, paddingTop: insets.top + 10 }]}>
            <AppText style={[styles.pdfModalTitle, { color: colors.primary }]}>Tax Invoice Preview</AppText>
            <TouchableOpacity
              onPress={() => {
                setPdfViewerVisible(false);
                setPdfModalVisible(true);
              }}
              style={styles.closePdfButton}
            >
              <Ionicons name="close" size={28} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={{ flex: 1 }}>
            {previewURL ? (
              <WebView
                source={{ uri: previewURL }}
                style={{ flex: 1, backgroundColor: '#525659' }}
                javaScriptEnabled
                domStorageEnabled
                startInLoadingState
                scalesPageToFit
                allowFileAccess
                originWhitelist={['*']}
                renderLoading={() => (
                  <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <AppText style={[styles.loadingText, { color: colors.text }]}>{t.loading}</AppText>
                  </View>
                )}
                onError={(syntheticEvent) => {
                  const { nativeEvent } = syntheticEvent;
                  console.warn('WebView error:', nativeEvent);
                  showErrorMessage('Error', 'Failed to load PDF preview');
                }}
                onHttpError={(syntheticEvent) => {
                  const { nativeEvent } = syntheticEvent;
                  console.warn('WebView HTTP error:', nativeEvent);
                  showErrorMessage('Error', 'Failed to load PDF preview (HTTP)');
                }}
              />
            ) : (
              <View style={styles.centerContainer}>
                <MaterialCommunityIcons name="file-alert" size={64} color={colors.textSecondary} />
                <AppText style={[styles.noJobsText, { color: colors.textSecondary }]}>No preview available</AppText>
              </View>
            )}
          </View>
        </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Modal Styles
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
  closeButton: {
    padding: spacing.xs,
  },
  modalTitle: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
  },
  formScrollView: {
    flex: 1,
  },
  formContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  formSection: {
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
  sectionSubtitle: {
    fontSize: typography.sm,
    marginBottom: spacing.md,
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
    minHeight: 80,
    textAlignVertical: 'top',
  },
  // Client source badge
  clientSourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    gap: spacing.xs,
  },
  clientSourceText: {
    fontSize: typography.sm,
    fontWeight: '500',
  },
  // Price Proposals
  noProposalsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  noProposalsText: {
    fontSize: typography.sm,
    textAlign: 'center',
  },
  proposalCard: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  proposalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  proposalInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  proposalTitle: {
    fontSize: typography.base,
    fontWeight: '600',
    flex: 1,
  },
  selectedBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  selectedBadgeText: {
    fontSize: typography.xs,
    fontWeight: '600',
  },
  proposalMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    paddingLeft: 28,
  },
  proposalMetaText: {
    fontSize: typography.xs,
  },
  proposalAppliedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  proposalAppliedText: {
    fontSize: typography.xs,
    fontWeight: '500',
    flex: 1,
  },
  // Buttons
  buttonContainer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  cancelButton: {
    flex: 1,
    flexDirection: 'row',
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
  // Parts Section Styles
  partItem: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  partRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  partName: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    flex: 1,
  },
  partQuantity: {
    fontSize: typography.sm,
    marginLeft: spacing.sm,
  },
  partPriceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  partTotal: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    marginTop: spacing.sm,
    textAlign: 'right',
  },
  partHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  noPartsText: {
    fontSize: typography.sm,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  addPartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  addPartButtonText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  // Step indicator
  stepHeaderCenter: {
    flex: 1,
    alignItems: 'center',
  },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#D1D5DB',
  },
  stepConnector: {
    width: 30,
    height: 2,
    marginHorizontal: 4,
  },
  // PDF Modal Styles
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
  // PDF Viewer fallback
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
});

