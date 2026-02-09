import React, { useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert, Dimensions } from 'react-native';
import SignatureScreen from 'react-native-signature-canvas';
import * as FileSystem from 'expo-file-system/legacy';
import { colors } from '../theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export const SignaturePad = ({ onSave, onCancel }) => {
  const signatureRef = useRef(null);

  const handleSignature = async (signature) => {
    try {
      // signature is base64 string like "data:image/png;base64,iVBORw0KG..."
      if (!signature) {
        Alert.alert('Error', 'Please provide a signature');
        return;
      }

      // Convert base64 to file
      const filename = `signature_${Date.now()}.png`;
      const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      const fileUri = cacheDir + filename;
      
      console.log('Cache directory:', cacheDir);
      console.log('Full file URI:', fileUri);
      
      // Remove the data:image/png;base64, prefix
      const base64Data = signature.replace(/^data:image\/\w+;base64,/, '');
      
      // Write base64 to file (use 'base64' string directly for new FileSystem API)
      await FileSystem.writeAsStringAsync(fileUri, base64Data, {
        encoding: 'base64',
      });

      console.log('Signature saved successfully to:', fileUri);
      onSave(fileUri);
    } catch (error) {
      console.error('Error saving signature:', error);
      Alert.alert('Error', `Failed to save signature: ${error.message}`);
    }
  };

  const handleClear = () => {
    signatureRef.current?.clearSignature();
  };

  const handleEmpty = () => {
    Alert.alert('Error', 'Please provide a signature');
  };

  const style = `.m-signature-pad {
    box-shadow: none;
    border: none;
  }
  .m-signature-pad--body {
    border: none;
  }
  .m-signature-pad--footer {
    display: none;
    margin: 0px;
  }
  body,html {
    width: 100%;
    height: 100%;
  }`;

  return (
    <View style={styles.overlay}>
      <TouchableOpacity 
        style={styles.backdrop} 
        activeOpacity={1} 
        onPress={onCancel}
      />
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Client Signature</Text>
          <TouchableOpacity onPress={onCancel} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.signatureContainer}>
          <SignatureScreen
            ref={signatureRef}
            onOK={handleSignature}
            onEmpty={handleEmpty}
            descriptionText=""
            webStyle={style}
            autoClear={false}
            imageType="image/png"
          />
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
            <Text style={styles.clearButtonText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.saveButton}
            onPress={() => signatureRef.current?.readSignature()}
          >
            <Text style={styles.saveButtonText}>Save Signature</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  container: {
    height: SCREEN_HEIGHT * 0.7, // 70% of screen height for more space
    backgroundColor: '#FAFBFC',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  header: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  title: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: -0.3,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  signatureContainer: {
    flex: 1,
    margin: 16,
    marginTop: 12,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'white',
  },
  buttonContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  clearButton: {
    flex: 1,
    backgroundColor: '#64748B',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  clearButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: 'bold',
    letterSpacing: 0.3,
  },
  saveButton: {
    flex: 2,
    backgroundColor: colors.secondary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: 'bold',
    letterSpacing: 0.3,
  },
  cancelButton: {
    backgroundColor: '#EF4444',
    margin: 16,
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: 'bold',
    letterSpacing: 0.3,
  },
});
