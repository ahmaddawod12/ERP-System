import type { Dispatch, SetStateAction } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { DOC_TYPE } from '@smart-job/contracts';

import {
  AppInput,
  AppText,
  ClientSelector,
  InventoryItemSearch,
} from '../../../components';
import { getColors } from '../../../theme';
import type { Client, InventoryPart, Language } from '../../../types';
import {
  DOCUMENT_CONFIGS,
  getPaymentMethods,
} from '../lib/document-config';
import { getDocumentTranslations } from '../lib/document-copy';
import type {
  DocumentFormItem,
  FormData,
  InvoiceDocumentRecord,
  ModalType,
  ReceiptMode,
} from '../lib/create-document-model';
import { formatDateLike } from '../lib/create-document-model';
import { styles } from '../screens/CreateDocument.styles';

type DocumentConfig = (typeof DOCUMENT_CONFIGS)[keyof typeof DOCUMENT_CONFIGS];
type DocumentCopy = ReturnType<typeof getDocumentTranslations>;
type DocumentColors = ReturnType<typeof getColors>;
type PaymentMethods = ReturnType<typeof getPaymentMethods>;

interface CreateDocumentFormProps {
  addItem: () => void;
  applyPriceProposal: (proposal: InvoiceDocumentRecord) => void;
  cachedClients: Client[];
  calculateTotal: () => number;
  colors: DocumentColors;
  config: DocumentConfig;
  currentStep: number;
  documentType: number;
  findMatchingProposals: (client: Client | null) => void;
  formData: FormData;
  getInventoryParts: () => InventoryPart[];
  goToStep1: () => void;
  goToStep2: () => void;
  handleItemPartSelect: (itemId: number, part: InventoryPart) => void;
  handlePreview: () => void;
  isSubmitting: boolean;
  isTwoStepFlow: boolean;
  items: DocumentFormItem[];
  language: Language;
  matchingProposals: InvoiceDocumentRecord[];
  openModal: (type: Exclude<ModalType, null>) => void;
  paymentMethods: PaymentMethods;
  receiptMode: ReceiptMode;
  removeItem: (id: number) => void;
  selectedClientObj: Client | null;
  selectedInvoice: InvoiceDocumentRecord | null;
  selectedPriceProposal: InvoiceDocumentRecord | null;
  setFormData: Dispatch<SetStateAction<FormData>>;
  setItems: Dispatch<SetStateAction<DocumentFormItem[]>>;
  setMatchingProposals: Dispatch<SetStateAction<InvoiceDocumentRecord[]>>;
  setReceiptMode: Dispatch<SetStateAction<ReceiptMode>>;
  setSelectedClientObj: Dispatch<SetStateAction<Client | null>>;
  setSelectedInvoice: Dispatch<SetStateAction<InvoiceDocumentRecord | null>>;
  setSelectedPriceProposal: Dispatch<SetStateAction<InvoiceDocumentRecord | null>>;
  t: DocumentCopy;
  updateItem: (id: number, field: keyof DocumentFormItem, value: string | number | null) => void;
}

export default function CreateDocumentForm({
  addItem,
  applyPriceProposal,
  cachedClients,
  calculateTotal,
  colors,
  config,
  currentStep,
  documentType,
  findMatchingProposals,
  formData,
  getInventoryParts,
  goToStep1,
  goToStep2,
  handleItemPartSelect,
  handlePreview,
  isSubmitting,
  isTwoStepFlow,
  items,
  language,
  matchingProposals,
  openModal,
  paymentMethods,
  receiptMode,
  removeItem,
  selectedClientObj,
  selectedInvoice,
  selectedPriceProposal,
  setFormData,
  setItems,
  setMatchingProposals,
  setReceiptMode,
  setSelectedClientObj,
  setSelectedInvoice,
  setSelectedPriceProposal,
  t,
  updateItem,
}: CreateDocumentFormProps) {
  return (
    <>
      {/* Receipt Mode Selection (Auto from Invoice or Manual) */}
      {config.hasReceiptMode && receiptMode === null && (
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <View style={styles.receiptModeTitleContainer}>
      <MaterialCommunityIcons name="receipt" size={28} color={colors.primary} />
      <AppText style={[styles.receiptModeMainTitle, { color: colors.primary }]}>
      {t.selectReceiptMode}
      </AppText>
      </View>
      <AppText style={[styles.sectionDescription, { color: colors.textSecondary }]}>
      {t.selectReceiptModeDescription}
      </AppText>
      
      <View style={styles.receiptModeContainer}>
      {/* Auto from Invoice Option */}
      <TouchableOpacity
      style={[styles.receiptModeCard, styles.receiptModeCardRecommended, { backgroundColor: colors.backgroundLight }]}
      onPress={() => setReceiptMode('auto')}
      activeOpacity={0.7}
      >
      <View style={styles.recommendedBadge}>
      <AppText style={styles.recommendedBadgeText}>
      {t.recommended}
      </AppText>
      </View>
      <LinearGradient
      colors={['#10B981', '#059669']}
      style={styles.receiptModeIconContainer}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      >
      <MaterialCommunityIcons name="file-document-multiple" size={32} color="white" />
      </LinearGradient>
      <AppText style={[styles.receiptModeTitle, { color: colors.textPrimary }]}>
      {t.autoFromInvoice}
      </AppText>
      <AppText style={[styles.receiptModeDescription, { color: colors.textSecondary }]}>
      {t.autoFromInvoiceDescription}
      </AppText>
      <View style={[styles.receiptModeFeatures, { borderTopColor: colors.border }]}>
      <View style={styles.featureItem}>
      <Ionicons name="checkmark-circle" size={16} color="#10B981" />
      <AppText style={[styles.featureText, { color: colors.textSecondary }]}>
      {t.preFilledData}
      </AppText>
      </View>
      <View style={styles.featureItem}>
      <Ionicons name="checkmark-circle" size={16} color="#10B981" />
      <AppText style={[styles.featureText, { color: colors.textSecondary }]}>
      {t.invoiceLinked}
      </AppText>
      </View>
      </View>
      </TouchableOpacity>
      
      {/* Manual Entry Option */}
      <TouchableOpacity
      style={[styles.receiptModeCard, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}
      onPress={() => setReceiptMode('manual')}
      activeOpacity={0.7}
      >
      <LinearGradient
      colors={['#6B7280', '#4B5563']}
      style={styles.receiptModeIconContainer}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      >
      <MaterialCommunityIcons name="pencil-outline" size={32} color="white" />
      </LinearGradient>
      <AppText style={[styles.receiptModeTitle, { color: colors.textPrimary }]}>
      {t.manualEntry}
      </AppText>
      <AppText style={[styles.receiptModeDescription, { color: colors.textSecondary }]}>
      {t.manualEntryDescription}
      </AppText>
      <View style={[styles.receiptModeFeatures, { borderTopColor: colors.border }]}>
      <View style={styles.featureItem}>
      <Ionicons name="create-outline" size={16} color="#6B7280" />
      <AppText style={[styles.featureText, { color: colors.textSecondary }]}>
      {t.fullControl}
      </AppText>
      </View>
      <View style={styles.featureItem}>
      <Ionicons name="document-outline" size={16} color="#6B7280" />
      <AppText style={[styles.featureText, { color: colors.textSecondary }]}>
      {t.noInvoiceNeeded}
      </AppText>
      </View>
      </View>
      </TouchableOpacity>
      </View>
      </View>
      )}
      
      {/* Receipt Mode Change Button (when already selected) */}
      {config.hasReceiptMode && receiptMode !== null && (
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <View style={styles.receiptModeHeader}>
      <AppText style={[styles.sectionTitle, { color: colors.primary, marginBottom: 0 }]}>
      {receiptMode === 'auto' ? t.autoFromInvoice : t.manualEntry}
      </AppText>
      <TouchableOpacity
      style={[styles.changeModeButton, { backgroundColor: colors.primary }]}
      onPress={() => {
      setReceiptMode(null);
      setSelectedInvoice(null);
      setSelectedClientObj(null);
      setFormData({
      ...formData,
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      customerAddress: '',
      customerId: '',
      invoiceReference: '',
      });
      setItems([{ id: Date.now(), description: '', price: '', quantity: '1' }]);
      }}
      >
      <AppText style={styles.changeModeText}>{t.changeMode}</AppText>
      </TouchableOpacity>
      </View>
      </View>
      )}
      
      {/* Invoice Selection (for Receipt auto mode) */}
      {config.hasReceiptMode && receiptMode === 'auto' && (
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
      {t.selectInvoice}
      </AppText>
      
      {selectedInvoice ? (
      <View style={styles.selectedInvoiceContainer}>
      <View style={styles.selectedInvoiceInfo}>
      <AppText style={[styles.selectedInvoiceLabel, { color: colors.textPrimary }]}>
      {t.invoiceNumber}: {selectedInvoice.documentNumber}
      </AppText>
      <AppText style={[styles.selectedInvoiceDetail, { color: colors.textSecondary }]}>
      {selectedInvoice.documentData?.client?.name}
      </AppText>
      </View>
      <TouchableOpacity
      style={[styles.changeInvoiceButton, { backgroundColor: colors.primary }]}
      onPress={() => openModal('invoiceSelect')}
      >
      <AppText style={styles.changeInvoiceText}>{t.changeInvoice}</AppText>
      </TouchableOpacity>
      </View>
      ) : (
      <TouchableOpacity
      style={[styles.selectInvoiceButton, { borderColor: colors.border }]}
      onPress={() => openModal('invoiceSelect')}
      >
      <MaterialCommunityIcons name="file-document-outline" size={24} color={colors.textSecondary} />
      <AppText style={[styles.selectInvoiceText, { color: colors.textSecondary }]}>
      {t.tapToSelectInvoice}
      </AppText>
      </TouchableOpacity>
      )}
      </View>
      )}
      
      {/* Only show form if not receipt OR receipt mode is selected */}
      {(!config.hasReceiptMode || receiptMode !== null) && (
      <>
      {/* Step Indicator - for all document types with 2-step flow */}
      {(isTwoStepFlow || (config.hasReceiptMode && receiptMode !== null)) && (
      <View style={styles.stepIndicator}>
      <View style={[styles.stepDot, currentStep >= 1 && { backgroundColor: colors.primary }]}>
      <AppText style={[styles.stepDotText, currentStep >= 1 && { color: '#fff' }]}>1</AppText>
      </View>
      <View style={[styles.stepConnector, currentStep >= 2 && { backgroundColor: colors.primary }]} />
      <View style={[styles.stepDot, currentStep >= 2 && { backgroundColor: colors.primary }]}>
      <AppText style={[styles.stepDotText, currentStep >= 2 && { color: '#fff' }]}>2</AppText>
      </View>
      </View>
      )}
      
      {/* Step 1: Customer Details */}
      {(currentStep === 1) && (
      <>
      {/* Customer Details Section - with embedded client search */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
      {t.customerDetails}
      </AppText>
      
      {/* Embedded client selector (search + dropdown) */}
      <ClientSelector
      clients={cachedClients}
      onSelect={(client) => {
      setSelectedClientObj(client);
      setFormData(prev => ({
      ...prev,
      customerName: client.name || '',
      customerPhone: client.phone || '',
      customerEmail: client.email || '',
      customerAddress: client.address || '',
      customerCity: client.city || '',
      customerId: client.id || '',
      clientVatNumber: client.vatNumber || '',
      }));
      // Find matching price proposals for this client (Tax Invoice only)
      if (documentType === DOC_TYPE.TAX_INVOICE) {
      findMatchingProposals(client);
      }
      }}
      selectedClient={selectedClientObj}
      onClear={() => {
      setSelectedClientObj(null);
      setFormData(prev => ({
      ...prev,
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      customerAddress: '',
      customerCity: '',
      customerId: '',
      clientVatNumber: '',
      }));
      setMatchingProposals([]);
      setSelectedPriceProposal(null);
      }}
      colors={colors}
      language={language}
      />
      
      {/* Customer fields - always visible, pre-filled when client selected */}
      {/* Customer Name */}
      <View style={styles.inputGroup}>
      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
      {t.customerName} <AppText style={styles.requiredStar}>*</AppText>
      </AppText>
      <AppInput
      inputStyle={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
      value={formData.customerName}
      onChangeText={(text) => setFormData({ ...formData, customerName: text })}
      placeholder={t.customerName}
      />
      </View>
      
      {/* VAT Number - Required for Tax Invoice, Optional for others */}
      <View style={styles.inputGroup}>
      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
      {t.clientVatNumber} {config.requiresVatNumber 
      ? <AppText style={styles.requiredStar}>*</AppText>
      : <AppText style={styles.optionalText}>({t.optional})</AppText>
      }
      </AppText>
      <AppInput
      inputStyle={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
      value={formData.clientVatNumber}
      onChangeText={(text) => setFormData({ ...formData, clientVatNumber: text })}
      placeholder={t.clientVatNumber}
      keyboardType="numeric"
      />
      </View>
      
      {/* Customer Email */}
      <View style={styles.inputGroup}>
      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
      {t.customerEmail} <AppText style={styles.optionalText}>({t.optional})</AppText>
      </AppText>
      <AppInput
      inputStyle={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
      value={formData.customerEmail}
      onChangeText={(text) => setFormData({ ...formData, customerEmail: text })}
      placeholder={t.customerEmail}
      keyboardType="email-address"
      />
      </View>
      
      {/* Customer Address */}
      <View style={styles.inputGroup}>
      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
      {t.customerAddress} <AppText style={styles.optionalText}>({t.optional})</AppText>
      </AppText>
      <AppInput
      inputStyle={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
      value={formData.customerAddress}
      onChangeText={(text) => setFormData({ ...formData, customerAddress: text })}
      placeholder={t.customerAddress}
      />
      </View>
      
      {/* Customer City */}
      <View style={styles.inputGroup}>
      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
      {t.customerCity} <AppText style={styles.optionalText}>({t.optional})</AppText>
      </AppText>
      <AppInput
      inputStyle={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
      value={formData.customerCity}
      onChangeText={(text) => setFormData({ ...formData, customerCity: text })}
      placeholder={t.customerCity}
      />
      </View>
      
      {/* Customer Phone */}
      <View style={styles.inputGroup}>
      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
      {t.customerPhone} <AppText style={styles.optionalText}>({t.optional})</AppText>
      </AppText>
      <AppInput
      inputStyle={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
      value={formData.customerPhone}
      onChangeText={(text) => setFormData({ ...formData, customerPhone: text })}
      placeholder={t.customerPhone}
      keyboardType="phone-pad"
      />
      </View>
      
      
      </View>
      
      {/* Matching Price Proposals - Step 1 (Tax Invoice only) */}
      {documentType === DOC_TYPE.TAX_INVOICE && matchingProposals.length > 0 && (
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
      {t.priceProposals}
      </AppText>
      <AppText style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
      {t.selectProposal}
      </AppText>
      {matchingProposals.map((proposal) => {
      const isSelected = selectedPriceProposal?.id === proposal.id;
      const proposalDate = formatDateLike(proposal.createdAt);
      const proposalTotal = proposal.items
      ? proposal.items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0)
      : 0;
      return (
      <TouchableOpacity
      key={proposal.id}
      style={[
      styles.proposalCard,
      { backgroundColor: colors.backgroundLight, borderColor: isSelected ? colors.primary : colors.border },
      isSelected && { borderWidth: 2 },
      ]}
      onPress={() => applyPriceProposal(proposal)}
      >
      <View style={styles.proposalHeader}>
      <View style={styles.proposalInfo}>
      <AppText style={[styles.proposalTitle, { color: colors.textPrimary }]}>
      {t.priceProposal} #{proposal.documentNumber || ''}
      </AppText>
      {proposalDate ? (
      <AppText style={[styles.proposalMeta, { color: colors.textSecondary }]}>
      {proposalDate}
      </AppText>
      ) : null}
      </View>
      {isSelected && (
      <View style={[styles.selectedBadge, { backgroundColor: colors.primary }]}>
      <Ionicons name="checkmark" size={14} color="#fff" />
      <AppText style={styles.selectedBadgeText}>{t.selected}</AppText>
      </View>
      )}
      </View>
      <AppText style={[styles.proposalMeta, { color: colors.textSecondary }]}>
      {proposal.items?.length || 0} {t.proposalItems} · ₪{proposalTotal.toFixed(2)}
      </AppText>
      </TouchableOpacity>
      );
      })}
      </View>
      )}
      
      {documentType === DOC_TYPE.TAX_INVOICE && matchingProposals.length === 0 && selectedClientObj && (
      <View style={[styles.noProposalsContainer, { backgroundColor: colors.surface }]}>
      <Ionicons name="document-text-outline" size={24} color={colors.textSecondary} />
      <AppText style={[styles.noProposalsText, { color: colors.textSecondary }]}>
      {t.noProposals}
      </AppText>
      </View>
      )}
      
      {/* Step 1 Continue Button */}
      {(
      <TouchableOpacity
      style={styles.continueButtonContainer}
      onPress={goToStep2}
      >
      <LinearGradient
      colors={config.gradient}
      style={styles.continueButton}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      >
      <AppText style={styles.continueButtonText}>{t.continueToItems}</AppText>
      <Ionicons name="arrow-forward" size={20} color="white" />
      </LinearGradient>
      </TouchableOpacity>
      )}
      </>
      )}
      
      {/* Step 2: Items & Submission */}
      {(currentStep === 2) && (
      <>
      {/* Payment Method (Receipt only) */}
      {config.requiresPaymentMethod && (
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <AppText style={[styles.sectionTitle, { color: colors.primary }]}>
      {t.paymentDetails}
      </AppText>
      
      <View style={styles.inputGroup}>
      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
      {t.paymentMethod} <AppText style={styles.requiredStar}>*</AppText>
      </AppText>
      <View style={styles.paymentMethodsContainer}>
      {paymentMethods.map((method) => (
      <TouchableOpacity
      key={method.id}
      style={[
      styles.paymentMethodButton,
      formData.paymentMethod === method.id && styles.paymentMethodButtonActive,
      { borderColor: formData.paymentMethod === method.id ? colors.primary : colors.border }
      ]}
      onPress={() => setFormData({ ...formData, paymentMethod: method.id })}
      >
      <AppText style={[
      styles.paymentMethodText,
      { color: formData.paymentMethod === method.id ? colors.primary : colors.textSecondary }
      ]}>
      {method.label}
      </AppText>
      </TouchableOpacity>
      ))}
      </View>
      </View>
      
      {/* Payment Info/Reference - shows relevant placeholder based on payment method */}
      <View style={styles.inputGroup}>
      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
      {t.paymentInfo} <AppText style={styles.optionalText}>({t.optional})</AppText>
      </AppText>
      <AppInput
      inputStyle={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary, borderColor: colors.border }]}
      value={formData.paymentInfo}
      onChangeText={(text) => setFormData({ ...formData, paymentInfo: text })}
      placeholder={
      formData.paymentMethod === 'check' ? t.paymentInfoCheckPlaceholder :
      formData.paymentMethod === 'transfer' ? t.paymentInfoTransferPlaceholder :
      formData.paymentMethod === 'credit' ? t.paymentInfoCreditPlaceholder :
      t.paymentInfoPlaceholder
      }
      />
      </View>
      </View>
      )}
      
      {/* Items Section */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <View style={styles.itemsSectionHeader}>
      <AppText style={[styles.sectionTitle, { color: colors.primary, marginBottom: 0 }]}>
      {t.itemsTitle}
      </AppText>
      {/* Show locked indicator for auto mode */}
      {config.hasReceiptMode && receiptMode === 'auto' && selectedInvoice && (
      <View style={[styles.lockedBadge, { backgroundColor: colors.backgroundLight }]}>
      <Ionicons name="lock-closed" size={14} color={colors.textSecondary} />
      <AppText style={[styles.lockedBadgeText, { color: colors.textSecondary }]}>
      {t.fromInvoice}
      </AppText>
      </View>
      )}
      </View>
      
      {items.map((item, index) => {
      // Items are read-only in auto mode when invoice is selected
      const isReadOnly = config.hasReceiptMode && receiptMode === 'auto' && selectedInvoice;
      
      return (
      <View key={item.id} style={[
      styles.itemCard, 
      { backgroundColor: colors.backgroundLight, borderColor: colors.border },
      isReadOnly && styles.itemCardReadOnly
      ]}>
      <View style={styles.itemHeader}>
      <AppText style={[styles.itemNumber, { color: colors.primary }]}>
      {t.item} {index + 1}
      </AppText>
      {/* Only show delete button if not read-only and more than 1 item */}
      {!isReadOnly && items.length > 1 && (
      <TouchableOpacity onPress={() => removeItem(item.id)}>
      <MaterialCommunityIcons name="delete" size={24} color="#EF4444" />
      </TouchableOpacity>
      )}
      </View>
      
      <View style={styles.inputGroup}>
      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
      {t.itemDescription} {!isReadOnly && <AppText style={styles.requiredStar}>*</AppText>}
      </AppText>
      {/* Use InventoryItemSearch for items when inventory is available */}
      {!isReadOnly && getInventoryParts().length > 0 ? (
      <InventoryItemSearch
      value={item.description}
      onChangeText={(text) => updateItem(item.id, 'description', text)}
      onSelectPart={(part) => handleItemPartSelect(item.id, part)}
      inventoryParts={getInventoryParts()}
      placeholder={t.itemDescription}
      colors={colors}
      editable={!isReadOnly}
      style={[
      styles.inputMultiline,
      { backgroundColor: colors.background, borderColor: colors.border },
      ]}
      />
      ) : (
      <AppInput
      inputStyle={[
      styles.inputMultiline, 
      { backgroundColor: isReadOnly ? colors.backgroundLight : colors.background, color: colors.textPrimary, borderColor: colors.border },
      isReadOnly && styles.inputReadOnly
      ]}
      value={item.description}
      onChangeText={(text) => !isReadOnly && updateItem(item.id, 'description', text)}
      placeholder={t.itemDescription}
      multiline
      numberOfLines={2}
      editable={!isReadOnly}
      />
      )}
      </View>
      
      <View style={styles.inputGroup}>
      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
      {t.itemPrice} {!isReadOnly && <AppText style={styles.requiredStar}>*</AppText>}
      </AppText>
      <AppInput
      inputStyle={[
      styles.input, 
      { backgroundColor: isReadOnly ? colors.backgroundLight : colors.background, color: colors.textPrimary, borderColor: colors.border },
      isReadOnly && styles.inputReadOnly
      ]}
      value={item.price}
      onChangeText={(text) => !isReadOnly && updateItem(item.id, 'price', text)}
      placeholder={t.itemPrice}
      keyboardType="decimal-pad"
      editable={!isReadOnly}
      />
      </View>
      
      <View style={styles.inputGroup}>
      <AppText style={[styles.inputLabel, { color: colors.textPrimary }]}>
      {t.itemQuantity} {!isReadOnly && <AppText style={styles.optionalText}>({t.optional})</AppText>}
      </AppText>
      <AppInput
      inputStyle={[
      styles.input, 
      { backgroundColor: isReadOnly ? colors.backgroundLight : colors.background, color: colors.textPrimary, borderColor: colors.border },
      isReadOnly && styles.inputReadOnly
      ]}
      value={item.quantity}
      onChangeText={(text) => !isReadOnly && updateItem(item.id, 'quantity', text)}
      placeholder={t.itemQuantity}
      keyboardType="numeric"
      editable={!isReadOnly}
      />
      </View>
      </View>
      );
      })}
      
      {/* Only show add item button if manual mode or not receipt */}
      {(!config.hasReceiptMode || receiptMode === 'manual') && (
      <TouchableOpacity
      style={[styles.addItemButton, { backgroundColor: colors.primary }]}
      onPress={addItem}
      >
      <MaterialCommunityIcons name="plus" size={20} color="white" />
      <AppText style={styles.addItemText}>{t.addItem}</AppText>
      </TouchableOpacity>
      )}
      
      {/* Total Display */}
      <View style={[styles.totalContainer, { borderTopColor: colors.border }]}>
      <AppText style={[styles.totalLabel, { color: colors.textPrimary }]}>{t.total}</AppText>
      <AppText style={[styles.totalValue, { color: colors.primary }]}>
      ₪{calculateTotal().toFixed(2)}
      </AppText>
      </View>
      </View>
      
      {/* Submit Buttons */}
      <View style={styles.buttonContainer}>
      {/* Back button: goes to Step 1 */}
      <TouchableOpacity
      style={[styles.cancelButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={goToStep1}
      >
      <AppText style={[styles.cancelButtonText, { color: colors.textPrimary }]}>
      {t.backToClient}
      </AppText>
      </TouchableOpacity>
      
      <TouchableOpacity
      style={styles.submitButtonContainer}
      onPress={handlePreview}
      disabled={isSubmitting}
      >
      <LinearGradient
      colors={config.gradient}
      style={styles.submitButton}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      >
      {isSubmitting ? (
      <ActivityIndicator color="white" size="small" />
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
      </>
      )}
    </>
  );
}
