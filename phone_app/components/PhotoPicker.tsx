import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { borderRadius, getColors, spacing } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';
import { useAlert } from '../contexts/AlertContext';
import AppButton from './AppButton';
import AppText from './AppText';

const normalizeAssets = (result: ImagePicker.ImagePickerResult | null): string[] => {
  if (!result || result.canceled || !Array.isArray(result.assets)) return [];
  return result.assets
    .map((asset) => asset?.uri)
    .filter((uri): uri is string => Boolean(uri));
};

export interface PhotoPickerProps {
  visible: boolean;
  onClose: () => void;
  onPhotosSelected?: (uris: string[]) => void;
  maxPhotos?: number;
  existingPhotos?: string[];
}

export default function PhotoPicker({
  visible,
  onClose,
  onPhotosSelected,
  maxPhotos = 5,
  existingPhotos = [],
}: PhotoPickerProps) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const alert = useAlert();

  const remaining = Math.max(0, maxPhotos - (existingPhotos?.length || 0));

  const handlePickFromGallery = async () => {
    try {
      if (remaining <= 0) {
        alert.warning('Limit reached', `You can upload up to ${maxPhotos} photos.`);
        return;
      }

      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        alert.error('Permission denied', 'Gallery access is required to pick photos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: remaining > 1,
        selectionLimit: remaining,
        quality: 0.75,
      });

      const selectedUris = normalizeAssets(result);
      if (selectedUris.length === 0) return;
      const merged = [...(existingPhotos || []), ...selectedUris].slice(0, maxPhotos);
      onPhotosSelected?.(merged);
      onClose?.();
    } catch (error) {
      console.error('PhotoPicker gallery error:', error);
      alert.error('Error', 'Failed to pick photos from gallery.');
    }
  };

  const handleTakePhoto = async () => {
    try {
      if (remaining <= 0) {
        alert.warning('Limit reached', `You can upload up to ${maxPhotos} photos.`);
        return;
      }

      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        alert.error('Permission denied', 'Camera access is required to take photos.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.75,
      });

      const selectedUris = normalizeAssets(result);
      if (selectedUris.length === 0) return;
      const merged = [...(existingPhotos || []), ...selectedUris].slice(0, maxPhotos);
      onPhotosSelected?.(merged);
      onClose?.();
    } catch (error) {
      console.error('PhotoPicker camera error:', error);
      alert.error('Error', 'Failed to take photo.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: palette.overlay }]}>
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <AppText variant="heading">Add Photos</AppText>
          <AppText variant="caption" color={palette.textSecondary}>
            {existingPhotos?.length || 0}/{maxPhotos} selected
          </AppText>

          <View style={styles.actions}>
            <AppButton
              title="Take Photo"
              iconLeft={{ name: 'camera-outline' }}
              onPress={handleTakePhoto}
            />
            <AppButton
              title="Choose From Gallery"
              iconLeft={{ name: 'images-outline' }}
              variant="secondary"
              onPress={handlePickFromGallery}
            />
            <AppButton title="Cancel" variant="ghost" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  actions: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
});
