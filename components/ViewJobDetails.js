import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
  Platform,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { getColors, shadows } from '../theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const ViewJobDetails = ({
  visible,
  job,
  onClose,
  translations,
  getStatusColor,
  onImagePress,
  isDarkMode = false,
}) => {
  const colors = getColors(isDarkMode);
  const [enlargedImage, setEnlargedImage] = useState(null);

  if (!job) return null;

  // Debug logging
  console.log('ViewJobDetails - Full job object:', JSON.stringify(job, null, 2));
  console.log('ViewJobDetails - Photos:', job.photos);
  console.log('ViewJobDetails - Signature:', job.signature);

  return (
    <Modal 
      visible={visible} 
      transparent 
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.detailsModalContent}>
          {/* Gradient Header */}
          <LinearGradient
            colors={['#0F2A4D', '#00ACC1']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradientHeader}
          >
            <View style={styles.headerContent}>
              <View style={styles.headerIconContainer}>
                <MaterialCommunityIcons name="briefcase-check" size={32} color="white" />
              </View>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerSubtitle}>{translations.jobDetails}</Text>
                <Text style={styles.headerTitle} numberOfLines={2}>{job.title}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
            >
              <Ionicons name="close-circle" size={36} color="white" />
            </TouchableOpacity>
          </LinearGradient>

          <ScrollView 
            contentContainerStyle={styles.detailsModalScrollContent}
            showsVerticalScrollIndicator={true}
          >

            {/* Description Card */}
            <View style={styles.infoCard}>
              <View style={styles.cardHeader}>
                <MaterialCommunityIcons name="text" size={20} color="#00ACC1" />
                <Text style={styles.cardTitle}>{translations.description}</Text>
              </View>
              <Text style={styles.detailValue}>{job.description}</Text>
            </View>

            {/* Client & Location Info */}
            <View style={styles.infoCard}>
              <View style={styles.cardHeader}>
                <MaterialCommunityIcons name="account-group" size={20} color="#00ACC1" />
                <Text style={styles.cardTitle}>{translations.clientInfo || 'Client Information'}</Text>
              </View>
              {job.clientName && (
                <View style={styles.infoRow}>
                  <Ionicons name="person" size={18} color="#6b7280" />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{translations.clientName || 'Client Name'}</Text>
                    <Text style={styles.detailValue}>{job.clientName}</Text>
                  </View>
                </View>
              )}
              {job.clientPhone && (
                <View style={styles.infoRow}>
                  <Ionicons name="call" size={18} color="#6b7280" />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{translations.clientPhone || 'Client Phone'}</Text>
                    <Text style={styles.detailValue}>{job.clientPhone}</Text>
                  </View>
                </View>
              )}
              {job.location && (
                <View style={styles.infoRow}>
                  <Ionicons name="location" size={18} color="#6b7280" />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{translations.location}</Text>
                    <Text style={styles.detailValue}>{job.location}</Text>
                  </View>
                </View>
              )}
              {(job.travelDistance !== null && job.travelDistance !== undefined && job.travelDistance !== '') && (
                <View style={styles.infoRow}>
                  <MaterialCommunityIcons name="map-marker-distance" size={18} color="#6b7280" />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{translations.travelDistance || 'Travel Distance'}</Text>
                    <Text style={styles.detailValue}>{job.travelDistance} {translations.km || 'km'}</Text>
                  </View>
                </View>
              )}
            </View>

            {/* Time & Status Info */}
            <View style={styles.infoCard}>
              <View style={styles.cardHeader}>
                <Ionicons name="time" size={20} color="#00ACC1" />
                <Text style={styles.cardTitle}>{translations.timeStatus || 'Timeline & Status'}</Text>
              </View>
              {job.timeFrom && job.timeTo && (
                <View style={styles.infoRow}>
                  <Ionicons name="timer" size={18} color="#6b7280" />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{translations.timeWorked}</Text>
                    <Text style={styles.detailValue}>{job.timeFrom} - {job.timeTo}</Text>
                  </View>
                </View>
              )}
              {job.createdAt && (
                <View style={styles.infoRow}>
                  <Ionicons name="calendar" size={18} color="#6b7280" />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{translations.createdAt || 'Created At'}</Text>
                    <Text style={styles.detailValue}>{new Date(job.createdAt).toLocaleString()}</Text>
                  </View>
                </View>
              )}
              {job.finishedAt && (
                <View style={styles.infoRow}>
                  <Ionicons name="checkmark-circle" size={18} color="#6b7280" />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{translations.finishedAt || 'Finished At'}</Text>
                    <Text style={styles.detailValue}>{new Date(job.finishedAt).toLocaleString()}</Text>
                  </View>
                </View>
              )}
              {job.MName && (
                <View style={styles.infoRow}>
                  <Ionicons name="person-add" size={18} color="#6b7280" />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{translations.assignedBy}</Text>
                    <Text style={styles.detailValue}>{job.MName}</Text>
                  </View>
                </View>
              )}
              {job.status && (
                <View style={styles.infoRow}>
                  <Ionicons name="information-circle" size={18} color="#6b7280" />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{translations.status || 'Status'}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor ? getStatusColor(job.status) : '#6b7280' }]}>
                      <Text style={styles.statusText}>{job.status}</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>

            {/* Parts Used */}
            {job.partsUsed && job.partsUsed.length > 0 && (
              <View style={styles.infoCard}>
                <View style={styles.cardHeader}>
                  <MaterialCommunityIcons name="cog" size={20} color="#00ACC1" />
                  <Text style={styles.cardTitle}>{translations.partsUsed || 'Parts Used'}</Text>
                </View>
                {job.partsUsed.map((part, index) => (
                  <View key={index} style={styles.partItem}>
                    <View style={styles.partIcon}>
                      <MaterialCommunityIcons name="wrench" size={18} color="#00ACC1" />
                    </View>
                    <Text style={styles.partName}>{part.name}</Text>
                    <View style={styles.partQuantityBadge}>
                      <Text style={styles.partQuantity}>{part.quantity}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Photos */}
            {job.photos && job.photos.length > 0 ? (
              <View style={styles.infoCard}>
                <View style={styles.cardHeader}>
                  <Ionicons name="images" size={20} color="#00ACC1" />
                  <Text style={styles.cardTitle}>
                    {translations.photos} ({job.photos.length})
                  </Text>
                </View>
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false} 
                  style={styles.photosScroll}
                >
                  {job.photos.map((photo, index) => {
                    console.log(`Photo ${index}:`, photo);
                    return (
                      <TouchableOpacity 
                        key={index} 
                        activeOpacity={0.9}
                        onPress={() => setEnlargedImage(photo)}
                      >
                        <Image
                          source={{ uri: photo }}
                          style={styles.photoThumbnail}
                          resizeMode="cover"
                          onError={(error) => console.log(`Photo ${index} load error:`, error.nativeEvent)}
                          onLoad={() => console.log(`Photo ${index} loaded successfully`)}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            {/* Signature */}
            {job.signature ? (
              <View style={styles.infoCard}>
                <View style={styles.cardHeader}>
                  <MaterialCommunityIcons name="draw-pen" size={20} color="#00ACC1" />
                  <Text style={styles.cardTitle}>{translations.signature}</Text>
                </View>
                {job.signingPerson && (
                  <View style={styles.infoRow}>
                    <Ionicons name="person" size={18} color="#6b7280" />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>{translations.signingPerson || 'Signing Person'}</Text>
                      <Text style={styles.detailValue}>{job.signingPerson}</Text>
                    </View>
                  </View>
                )}
                <View style={styles.signatureContainer}>
                  {job.signature.startsWith('data:image') || 
                   job.signature.startsWith('http') ? (
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => setEnlargedImage(job.signature)}
                    >
                      <Image 
                        source={{ uri: job.signature }} 
                        style={styles.signatureImage}
                        resizeMode="contain"
                        onError={(error) => {
                          console.log('Signature load error:', error.nativeEvent);
                          console.log('Signature URI:', job.signature);
                        }}
                        onLoad={() => console.log('Signature loaded successfully')}
                      />
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.signatureText}>{job.signature}</Text>
                  )}
                </View>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.closeModalButton, { backgroundColor: colors.secondary }]}
              onPress={onClose}
            >
              <Text style={styles.modalButtonText}>{translations.close}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Enlarged Image Modal */}
        <Modal
          visible={enlargedImage !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setEnlargedImage(null)}
        >
          <View style={styles.enlargedImageContainer}>
            <TouchableOpacity
              style={styles.enlargedImageOverlay}
              activeOpacity={1}
              onPress={() => setEnlargedImage(null)}
            />
            <View style={styles.enlargedImageContent}>
              {enlargedImage && (
                <View style={[
                  styles.enlargedImageWrapper,
                  // Add white background for signatures (they have dark ink on transparent/white)
                  enlargedImage === job?.signature && { backgroundColor: 'white' }
                ]}>
                  <Image
                    source={{ uri: enlargedImage }}
                    style={styles.enlargedImage}
                    resizeMode="contain"
                    onError={(error) => {
                      console.log('Enlarged image load error:', error.nativeEvent);
                      console.log('Enlarged image URI:', enlargedImage);
                    }}
                    onLoad={() => console.log('Enlarged image loaded successfully:', enlargedImage)}
                  />
                </View>
              )}
              <TouchableOpacity
                style={styles.closeEnlargedButton}
                onPress={() => setEnlargedImage(null)}
              >
                <Ionicons name="close-circle" size={40} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  detailsModalContent: {
    backgroundColor: '#FAFBFC',
    borderRadius: 28,
    maxHeight: '90%',
    width: '92%',
    maxWidth: 520,
    overflow: 'hidden',
    ...shadows.floating,
  },
  gradientHeader: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  headerIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  headerTextContainer: {
    marginLeft: 18,
    flex: 1,
  },
  headerSubtitle: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  headerTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    lineHeight: 30,
    letterSpacing: -0.3,
  },
  closeButton: {
    marginTop: 4,
  },
  detailsModalScrollContent: {
    padding: 24,
    paddingBottom: Platform.OS === 'android' ? 44 : 24,
  },
  infoCard: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 20,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 1.5,
    borderBottomColor: '#E2E8F0',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    marginLeft: 12,
    flex: 1,
    letterSpacing: -0.2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  infoContent: {
    flex: 1,
    marginLeft: 14,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 5,
  },
  detailValue: {
    fontSize: 16,
    color: '#0F172A',
    lineHeight: 24,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 4,
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  partItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#0EA5E9',
  },
  partIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(14, 165, 233, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  partName: {
    flex: 1,
    fontSize: 16,
    color: '#0F172A',
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  partQuantityBadge: {
    backgroundColor: '#0EA5E9',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 44,
    alignItems: 'center',
  },
  partQuantity: {
    fontSize: 15,
    color: 'white',
    fontWeight: 'bold',
  },
  photosScroll: {
    marginTop: 10,
    height: 160,
  },
  photoThumbnail: {
    width: 150,
    height: 150,
    borderRadius: 16,
    marginRight: 14,
    backgroundColor: '#E2E8F0',
    borderWidth: 3,
    borderColor: '#0EA5E9',
  },
  signatureContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 18,
    marginTop: 8,
    minHeight: 120,
    borderWidth: 2,
    borderColor: '#e5e7eb',
  },
  signatureImage: {
    width: '100%',
    height: 220,
    borderRadius: 8,
  },
  signatureText: {
    fontSize: 16,
    color: '#4b5563',
    fontStyle: 'italic',
  },
  noDataText: {
    fontSize: 15,
    color: '#9ca3af',
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  closeModalButton: {
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 56,
    ...shadows.md,
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  // Enlarged Image Styles
  enlargedImageContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  enlargedImageOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  enlargedImageContent: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  enlargedImageWrapper: {
    width: SCREEN_WIDTH * 0.95,
    height: SCREEN_HEIGHT * 0.8,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    overflow: 'hidden',
  },
  enlargedImage: {
    width: '100%',
    height: '100%',
  },
  closeEnlargedButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 30,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
  },
});

export default ViewJobDetails;
