import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import SignatureCanvas from 'react-native-signature-canvas';
import { borderRadius, getColors, spacing } from '../../theme';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAlert } from '../../contexts/AlertContext';
import AppButton from '../primitives/AppButton';
import AppText from '../primitives/AppText';

export interface SignaturePadProps {
  onSave?: (signature: string) => void;
  onCancel?: () => void;
}

export default function SignaturePad({ onSave, onCancel }: SignaturePadProps) {
  const { isDarkMode } = useThemeContext();
  const palette = getColors(isDarkMode);
  const alert = useAlert();
  const signatureRef = useRef<any>(null);

  const handleSave = (signature: string) => {
    if (!signature) {
      alert.warning('No signature', 'Please sign before saving.');
      return;
    }
    onSave?.(signature);
  };

  const webStyle = `
    .m-signature-pad {
      box-shadow: none;
      border: none;
      border-radius: 12px;
      overflow: hidden;
    }
    .m-signature-pad--footer {
      display: none;
    }
    body,html {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
  `;

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <AppText variant="heading">Signature</AppText>
      </View>

      <View style={[styles.canvasWrap, { borderColor: palette.border, backgroundColor: palette.surface }]}>
        <SignatureCanvas
          ref={signatureRef}
          onOK={handleSave}
          onEmpty={() => alert.warning('No signature', 'Please sign before saving.')}
          webStyle={webStyle}
          autoClear={false}
          descriptionText=""
        />
      </View>

      <View style={styles.actions}>
        <AppButton title="Clear" variant="secondary" onPress={() => signatureRef.current?.clearSignature()} />
        <AppButton title="Cancel" variant="ghost" onPress={onCancel} />
        <AppButton title="Save" onPress={() => signatureRef.current?.readSignature()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    marginBottom: spacing.md,
  },
  canvasWrap: {
    flex: 1,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  actions: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
});
