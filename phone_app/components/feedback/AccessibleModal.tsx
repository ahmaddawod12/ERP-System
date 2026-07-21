import React from 'react';
import {
  AccessibilityInfo,
  Modal,
  StyleSheet,
  View,
  type ModalProps,
} from 'react-native';

export interface AccessibleModalProps extends ModalProps {
  announcement?: string;
}

export default function AccessibleModal({
  announcement,
  children,
  onShow,
  ...props
}: AccessibleModalProps) {
  return (
    <Modal
      {...props}
      onShow={(event) => {
        if (announcement?.trim()) {
          AccessibilityInfo.announceForAccessibility(announcement.trim());
        }
        onShow?.(event);
      }}
    >
      <View
        style={styles.modalRoot}
        accessibilityViewIsModal
        importantForAccessibility="yes"
      >
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
});
