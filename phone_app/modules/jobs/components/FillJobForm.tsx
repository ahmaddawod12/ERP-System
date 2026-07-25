import type { Dispatch, SetStateAction } from 'react';
import { ActivityIndicator, Image, ScrollView, TouchableOpacity, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import {
  AppButton,
  AppCard,
  AppInput,
  AppText,
  ClientSelector,
  ScreenHeroCard,
} from '../../../components';
import { borderRadius, getColors, spacing } from '../../../theme';
import type { Client, InventoryPart, Language } from '../../../types';
import { logger } from '../../../utils/logger';
import { getFillJobCopy } from '../lib/fill-job-copy';
import type {
  EditableJob,
  FillJobFormData,
  FillJobMode,
  FillJobPart,
} from '../lib/fill-job-model';
import { styles } from '../screens/FillJob.styles';
import JobPartsFormCard from './JobPartsFormCard';

type FillJobCopy = ReturnType<typeof getFillJobCopy>;
type FillJobColors = ReturnType<typeof getColors>;

interface FillJobFormProps {
  cachedClients: Client[];
  colors: FillJobColors;
  editingJob: EditableJob | null;
  handleGetLocation: () => void;
  handleSaveDraft: () => void;
  handleSubmit: () => void;
  handleTravelDistanceChange: (text: string) => void;
  inventory: InventoryPart[];
  jobData: FillJobFormData;
  language: Language;
  mode: FillJobMode;
  onBack: () => void;
  outboxReady: boolean;
  partsSearchText: string;
  refreshedSignatureURL: string | null;
  resolvedPhotoPreviewUrls: string[];
  selectedClientObj: Client | null;
  selectedParts: FillJobPart[];
  setJobData: Dispatch<SetStateAction<FillJobFormData>>;
  setPartsSearchText: Dispatch<SetStateAction<string>>;
  setSelectedClientObj: Dispatch<SetStateAction<Client | null>>;
  setSelectedParts: Dispatch<SetStateAction<FillJobPart[]>>;
  setShowPhotoPicker: Dispatch<SetStateAction<boolean>>;
  setShowSignature: Dispatch<SetStateAction<boolean>>;
  setShowTimeFromPicker: Dispatch<SetStateAction<boolean>>;
  setShowTimeToPicker: Dispatch<SetStateAction<boolean>>;
  signatureLoading: boolean;
  submitting: boolean;
  t: FillJobCopy;
  travelDistance: string;
  travelDistanceError: string;
}

export default function FillJobForm({
  cachedClients,
  colors,
  editingJob,
  handleGetLocation,
  handleSaveDraft,
  handleSubmit,
  handleTravelDistanceChange,
  inventory,
  jobData,
  language,
  mode,
  onBack,
  outboxReady,
  partsSearchText,
  refreshedSignatureURL,
  resolvedPhotoPreviewUrls,
  selectedClientObj,
  selectedParts,
  setJobData,
  setPartsSearchText,
  setSelectedClientObj,
  setSelectedParts,
  setShowPhotoPicker,
  setShowSignature,
  setShowTimeFromPicker,
  setShowTimeToPicker,
  signatureLoading,
  submitting,
  t,
  travelDistance,
  travelDistanceError,
}: FillJobFormProps) {
  return (
    <>
      <ScreenHeroCard
      title={editingJob ? t.editJob : t.fillJob}
      subtitle={mode === 'user' ? t.jobDescription : t.clientInfo}
      eyebrow="Jobs"
      icon="clipboard-text-outline"
      iconLibrary="material"
      accentColor={colors.boxIndigo}
      metrics={[
      { label: t.photosMetric, value: String(jobData.photos.length) },
      { label: t.partsMetric, value: String(selectedParts.length) },
      { label: t.modeMetric, value: String(mode) },
      ]}
      badges={[t.clientInfo, t.timeWorked, t.clientSignature]}
      style={styles.heroCard}
      />
      
      {/* Job Title Card (User mode only) */}
      {mode === 'user' && (
      <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
      <View style={styles.cardHeader}>
      <MaterialCommunityIcons name="briefcase" size={20} color={colors.secondary} />
      <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
      {t.jobTitle} *
      </AppText>
      </View>
      <AppInput
      inputStyle={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
      placeholder={t.jobTitle}
      value={jobData.title}
      onChangeText={(text) => setJobData({ ...jobData, title: text })}
      />
      </AppCard>
      )}
      
      {/* Client Information Card - with embedded client search */}
      <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
      <View style={styles.cardHeader}>
      <Ionicons name="person" size={20} color={colors.secondary} />
      <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
      {t.clientInfo}
      </AppText>
      </View>
      
      {/* Embedded client selector (search + dropdown) */}
      {mode === 'user' && (
      <ClientSelector
      clients={cachedClients}
      onSelect={(client) => {
      setSelectedClientObj(client);
      setJobData(prev => ({
      ...prev,
      cname: client.cname || client.name || '',
      cphone: client.cphone || client.phone || '',
      }));
      }}
      selectedClient={selectedClientObj}
      onClear={() => {
      setSelectedClientObj(null);
      setJobData(prev => ({ ...prev, cname: '', cphone: '' }));
      }}
      colors={colors}
      language={language}
      />
      )}
      
      {/* Client fields - always visible, pre-filled when client selected */}
      <AppInput
      inputStyle={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
      placeholder={t.clientName + (mode === 'user' ? ' *' : '')}
      value={jobData.cname}
      onChangeText={(text) => setJobData({ ...jobData, cname: text })}
      editable={mode === 'user'}
      />
      <AppInput
      inputStyle={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
      placeholder={t.clientPhone}
      value={jobData.cphone}
      onChangeText={(text) => setJobData({ ...jobData, cphone: text })}
      keyboardType="phone-pad"
      editable={mode === 'user'}
      />
      
      </AppCard>
      
      {/* Time Worked Card */}
      <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
      <View style={styles.cardHeader}>
      <Ionicons name="time" size={20} color={colors.secondary} />
      <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
      {t.timeWorked} *
      </AppText>
      </View>
      <View style={styles.timeRow}>
      <View style={styles.timeColumn}>
      <AppText style={[styles.timeLabel, { color: colors.textSecondary }]}>{t.from}</AppText>
      <TouchableOpacity
      style={[styles.timeButton, { backgroundColor: colors.background, borderColor: colors.border }]}
      onPress={() => setShowTimeFromPicker(true)}
      >
      <AppText style={[styles.timeText, { color: colors.textPrimary }]}>
      {jobData.timeFrom || 'HH:MM'}
      </AppText>
      </TouchableOpacity>
      </View>
      
      <View style={styles.timeColumn}>
      <AppText style={[styles.timeLabel, { color: colors.textSecondary }]}>{t.to}</AppText>
      <TouchableOpacity
      style={[styles.timeButton, { backgroundColor: colors.background, borderColor: colors.border }]}
      onPress={() => setShowTimeToPicker(true)}
      >
      <AppText style={[styles.timeText, { color: colors.textPrimary }]}>
      {jobData.timeTo || 'HH:MM'}
      </AppText>
      </TouchableOpacity>
      </View>
      </View>
      </AppCard>
      
      {/* Location Card */}
      <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
      <View style={styles.cardHeader}>
      <Ionicons name="location" size={20} color={colors.secondary} />
      <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
      {t.location}{mode === 'user' ? ' *' : ''}
      </AppText>
      </View>
      <AppInput
      inputStyle={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
      placeholder={t.locationPlaceholder}
      value={jobData.location}
      onChangeText={(text) => setJobData({ ...jobData, location: text })}
      editable={mode === 'user'}
      />
      {mode === 'user' && (
      <AppButton
      title={t.getLocation}
      iconLeft={{ name: 'navigate-outline' }}
      onPress={handleGetLocation}
      style={styles.locationButton}
      />
      )}
      </AppCard>
      
      {/* Travel Distance Card */}
      <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
      <View style={styles.cardHeader}>
      <MaterialCommunityIcons name="map-marker-distance" size={20} color={colors.primary} />
      <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
      {t.travelDistance}
      </AppText>
      </View>
      
      <View style={styles.travelDistanceContainer}>
      <AppInput
      inputStyle={[
      styles.input, 
      styles.travelDistanceInput,
      { 
      color: colors.textPrimary, 
      backgroundColor: colors.background, 
      borderColor: travelDistanceError ? colors.error : colors.border 
      }
      ]}
      placeholder={t.travelDistancePlaceholder}
      value={travelDistance}
      onChangeText={handleTravelDistanceChange}
      keyboardType="decimal-pad"
      returnKeyType="done"
      />
      <View style={[styles.travelDistanceUnit, { backgroundColor: colors.primary }]}>
      <AppText style={styles.travelDistanceUnitText}>{t.travelDistanceUnit}</AppText>
      </View>
      </View>
      {travelDistanceError ? (
      <AppText style={[styles.errorText, { color: colors.error }]}>{travelDistanceError}</AppText>
      ) : null}
      </AppCard>
      
      {/* Description Card */}
      <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
      <View style={styles.cardHeader}>
      <MaterialCommunityIcons name="text" size={20} color={colors.secondary} />
      <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
      {t.jobDescription}{mode === 'user' ? ' *' : ''}
      </AppText>
      </View>
      <AppInput
      inputStyle={[styles.input, styles.textArea, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
      placeholder={t.descriptionPlaceholder}
      value={jobData.description}
      onChangeText={(text) => setJobData({ ...jobData, description: text })}
      multiline
      numberOfLines={4}
      textAlignVertical="top"
      editable={mode === 'user'}
      />
      </AppCard>
      
      {/* Photos Card */}
      <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
      <View style={styles.cardHeader}>
      <Ionicons name="images" size={20} color={colors.secondary} />
      <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
      {t.photos} * ({jobData.photos.length}/5)
      </AppText>
      </View>
      <AppButton
      title={t.addPhoto}
      iconLeft={{ name: 'camera-outline' }}
      onPress={() => setShowPhotoPicker(true)}
      style={styles.actionButton}
      />
      
      {jobData.photos.length > 0 && (
      <ScrollView horizontal style={styles.photosList}>
      {resolvedPhotoPreviewUrls.map((photoUri, index) => (
      <Image key={index} source={{ uri: photoUri }} style={styles.photoPreview} />
      ))}
      </ScrollView>
      )}
      </AppCard>
      
      <JobPartsFormCard
      title={t.partsUsed}
      language={language}
      colors={colors}
      inventory={inventory}
      searchText={partsSearchText}
      selectedParts={selectedParts}
      onSearchTextChange={setPartsSearchText}
      onPartsChange={setSelectedParts}
      />
      
      {/* Signature Card */}
      <AppCard style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}> 
      <View style={styles.cardHeader}>
      <MaterialCommunityIcons name="draw" size={20} color={colors.secondary} />
      <AppText style={[styles.cardTitle, { color: colors.textPrimary }]}>
      {t.clientSignature} *
      </AppText>
      </View>
      
      {/* Show existing signature prominently if it exists */}
      {jobData.signature && (
      <View style={[styles.signatureContainer, { backgroundColor: colors.background, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.md }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
      <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
      <AppText style={[styles.signatureLabel, { color: colors.success, marginLeft: spacing.xs, marginBottom: 0 }]}>
      {t.existingSignature || 'Existing Signature:'}
      </AppText>
      </View>
      
      {signatureLoading ? (
      <View style={[styles.signaturePreview, { borderColor: colors.border, marginTop: 0, justifyContent: 'center', alignItems: 'center' }]}>
      <ActivityIndicator size="large" color={colors.secondary} />
      <AppText style={[{ color: colors.textSecondary, marginTop: spacing.sm }]}>Loading signature...</AppText>
      </View>
      ) : refreshedSignatureURL ? (
      <Image 
      source={{ uri: refreshedSignatureURL }} 
      style={[styles.signaturePreview, { borderColor: colors.border, marginTop: 0 }]} 
      resizeMode="contain"
      onError={(error) => {
      logger.error('Signature image failed to load from the refreshed URL:', error?.nativeEvent || error);
      logger.debug('Refreshed signature URI:', refreshedSignatureURL);
      }}
      onLoad={() => {
      logger.debug('Signature image loaded successfully from refreshed URL');
      }}
      />
      ) : (
      <View style={[styles.signaturePreview, { borderColor: colors.border, marginTop: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }]}>
      <MaterialCommunityIcons name="image-off" size={48} color={colors.textSecondary} />
      <AppText style={[{ color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' }]}>
      Signature not available
      </AppText>
      </View>
      )}
      </View>
      )}
      
      <AppInput
      inputStyle={[styles.input, { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.border }]}
      placeholder={t.signingPerson + ' *'}
      value={jobData.signingPerson}
      onChangeText={(text) => setJobData({ ...jobData, signingPerson: text })}
      />
      <AppButton
      title={jobData.signature ? t.changeSignature || 'Change Signature' : t.addSignature}
      iconLeft={{ name: 'create-outline' }}
      onPress={() => setShowSignature(true)}
      variant={jobData.signature ? 'secondary' : 'primary'}
      style={styles.actionButton}
      />
      </AppCard>
      
      {/* Action Buttons */}
      <View style={styles.actionButtons}>
      <AppButton
      title={t.cancel}
      variant="secondary"
      style={[styles.button, styles.cancelButton]}
      onPress={onBack}
      />
      
      {!editingJob && (
      <AppButton
      title={t.saveDraft}
      variant="success"
      style={[styles.button, styles.draftButton]}
      onPress={handleSaveDraft}
      />
      )}
      
      <AppButton
      title={t.submit}
      style={[styles.button, styles.submitButton]}
      onPress={handleSubmit}
      disabled={submitting || !outboxReady || (mode === 'worker' && !editingJob?.entityVersion)}
      loading={submitting}
      />
      </View>
    </>
  );
}
