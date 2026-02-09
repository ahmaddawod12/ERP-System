/**
 * Custom Photo Picker Component for Smart-Job App
 * Beautiful photo selection interface with image enlargement
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  Alert,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors, spacing, borderRadius, typography, shadows } from '../theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export const PhotoPicker = ({
  visible,
  onClose,
  onPhotosSelected,
  maxPhotos = 5,
  existingPhotos = [],
}) => {
  const [selectedPhotos, setSelectedPhotos] = useState(existingPhotos);
  const [enlargedImage, setEnlargedImage] = useState(null);

  useEffect(() => {
    setSelectedPhotos(existingPhotos);
  }, [existingPhotos]);

  const handleTakePhoto = async () => {
    if (selectedPhotos.length >= maxPhotos) {
      Alert.alert('Limit Reached', `You can only add up to ${maxPhotos} photos.`);
      return;
    }

    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      
      if (permissionResult.status !== 'granted') {
        Alert.alert('Permission Denied', 'Camera permission is required to take photos.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsEditing: false,
        exif: false,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        setSelectedPhotos([...selectedPhotos, result.assets[0].uri]);
      }
    } catch (error) {
      console.error('Camera error:', error);
      Alert.alert('Error', 'Failed to open camera. Please try again.');
    }
  };

  const handlePickFromGallery = async () => {
    if (selectedPhotos.length >= maxPhotos) {
      Alert.alert('Limit Reached', `You can only add up to ${maxPhotos} photos.`);
      return;
    }

    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (permissionResult.status !== 'granted') {
        Alert.alert('Permission Denied', 'Gallery permission is required to select photos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: maxPhotos - selectedPhotos.length,
        allowsEditing: false,
        exif: false,
      });

      if (!result.canceled && result.assets) {
        const newPhotos = result.assets.map((asset) => asset.uri);
        const totalPhotos = selectedPhotos.length + newPhotos.length;
        
        if (totalPhotos > maxPhotos) {
          Alert.alert(
            'Too Many Photos',
            `You can only add ${maxPhotos - selectedPhotos.length} more photo(s).`
          );
          return;
        }
        
        setSelectedPhotos([...selectedPhotos, ...newPhotos]);
      }
    } catch (error) {
      console.error('Gallery error:', error);
      Alert.alert('Error', 'Failed to open gallery. Please try again.');
    }
  };

  const handleRemovePhoto = (index) => {
    const newPhotos = selectedPhotos.filter((_, i) => i !== index);
    setSelectedPhotos(newPhotos);
  };

  const handleConfirm = () => {
    onPhotosSelected(selectedPhotos);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={onClose}
        >
          <View
            style={styles.modalContent}
            onStartShouldSetResponder={() => true}
          >
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>Add Photos</Text>
              <Text style={styles.subtitle}>
                {selectedPhotos.length} / {maxPhotos} photos selected
              </Text>
            </View>

            {/* Action Buttons */}
              <View style={styles.actionsContainer}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={handleTakePhoto}
                  activeOpacity={0.7}
                >
                  <View style={[styles.iconContainer, { backgroundColor: colors.secondary + '20' }]}>
                    <Text style={styles.iconText}>📷</Text>
                  </View>
                  <Text style={styles.actionText}>Take Photo</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={handlePickFromGallery}
                  activeOpacity={0.7}
                >
                  <View style={[styles.iconContainer, { backgroundColor: colors.accent + '20' }]}>
                    <Text style={styles.iconText}>🖼️</Text>
                  </View>
                  <Text style={styles.actionText}>Choose from Gallery</Text>
                </TouchableOpacity>
              </View>

              {/* Selected Photos Grid */}
              {selectedPhotos.length > 0 && (
                <View style={styles.photosSection}>
                  <Text style={styles.sectionTitle}>Selected Photos</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.photosScroll}
                  >
                    {selectedPhotos.map((photo, index) => (
                      <View key={index} style={styles.photoCard}>
                        <TouchableOpacity
                          activeOpacity={0.9}
                          onPress={() => setEnlargedImage(photo)}
                        >
                          <Image
                            source={{ uri: photo }}
                            style={styles.photoImage}
                            resizeMode="cover"
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.removeButton}
                          onPress={() => handleRemovePhoto(index)}
                        >
                          <Text style={styles.removeButtonText}>✕</Text>
                        </TouchableOpacity>
                        <View style={styles.photoNumber}>
                          <Text style={styles.photoNumberText}>{index + 1}</Text>
                        </View>
                        <View style={styles.tapToEnlargeHint}>
                          <Ionicons name="expand-outline" size={14} color="white" />
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Empty State */}
              {selectedPhotos.length === 0 && (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>📸</Text>
                  <Text style={styles.emptyText}>No photos selected yet</Text>
                  <Text style={styles.emptySubtext}>
                    Tap the buttons above to add photos
                  </Text>
                </View>
              )}

              {/* Bottom Buttons */}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.button, styles.cancelButton]}
                  onPress={onClose}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.confirmButton,
                    selectedPhotos.length === 0 && styles.confirmButtonDisabled,
                  ]}
                  onPress={handleConfirm}
                  disabled={selectedPhotos.length === 0}
                >
                  <Text
                    style={[
                      styles.confirmButtonText,
                      selectedPhotos.length === 0 && styles.confirmButtonTextDisabled,
                    ]}
                  >
                    Confirm ({selectedPhotos.length})
                  </Text>
                </TouchableOpacity>
              </View>
          </View>
        </TouchableOpacity>
      </View>

      {/* Enlarged Image Modal */}
      <Modal
        visible={!!enlargedImage}
        transparent
        animationType="fade"
        onRequestClose={() => setEnlargedImage(null)}
        statusBarTranslucent
      >
        <View style={styles.enlargedImageContainer}>
          <TouchableOpacity
            style={styles.enlargedImageOverlay}
            activeOpacity={1}
            onPress={() => setEnlargedImage(null)}
          />
          <View style={styles.enlargedImageContent}>
            {enlargedImage && (
              <Image
                source={{ uri: enlargedImage }}
                style={styles.enlargedImage}
                resizeMode="contain"
              />
            )}
            <TouchableOpacity
              style={styles.closeEnlargedButton}
              onPress={() => setEnlargedImage(null)}
            >
              <Ionicons name="close-circle" size={44} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  overlayTouchable: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingBottom: spacing.xl,
    maxHeight: '85%',
    ...shadows.lg,
  },
  header: {
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    alignItems: 'center',
  },
  title: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.sm,
    color: colors.textSecondary,
  },
  actionsContainer: {
    flexDirection: 'row',
    padding: spacing.lg,
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  iconText: {
    fontSize: 32,
  },
  actionText: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    color: colors.primary,
    textAlign: 'center',
  },
  photosSection: {
    paddingVertical: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    color: colors.primary,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  photosScroll: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  photoCard: {
    width: 120,
    height: 120,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    position: 'relative',
    ...shadows.md,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  removeButton: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  removeButtonText: {
    color: colors.textWhite,
    fontSize: typography.base,
    fontWeight: typography.bold,
  },
  photoNumber: {
    position: 'absolute',
    bottom: spacing.xs,
    left: spacing.xs,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoNumberText: {
    color: colors.textWhite,
    fontSize: typography.xs,
    fontWeight: typography.bold,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  emptyText: {
    fontSize: typography.lg,
    fontWeight: typography.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  emptySubtext: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  button: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.textSecondary,
  },
  confirmButton: {
    backgroundColor: colors.secondary,
    ...shadows.sm,
  },
  confirmButtonDisabled: {
    backgroundColor: colors.disabled,
  },
  confirmButtonText: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    color: colors.textWhite,
  },
  confirmButtonTextDisabled: {
    color: colors.textLight,
  },
  // Tap to enlarge hint
  tapToEnlargeHint: {
    position: 'absolute',
    bottom: spacing.xs,
    right: spacing.xs,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Enlarged image modal styles
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
  enlargedImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
  },
  closeEnlargedButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 30,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 22,
  },
});
