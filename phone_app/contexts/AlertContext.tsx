import React, { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { View, ActivityIndicator, StyleSheet, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import CustomAlert from '../components/feedback/CustomAlert';
import { AppText } from '../components';
import { gradients as themeGradients } from '../theme';
import type { AlertType, AlertButton, AlertConfig, LoadingConfig, AlertContextValue } from '../types';

const AlertContext = createContext<AlertContextValue | null>(null);

export function AlertProvider({ children }: { children: ReactNode }) {
  const [alertConfig, setAlertConfig] = useState<AlertConfig>({
    visible: false,
    type: 'info',
    title: '',
    message: '',
    buttons: [],
    icon: null,
  });
  const [loadingConfig, setLoadingConfig] = useState<LoadingConfig>({
    visible: false,
    title: '',
    message: '',
  });

  const showAlert = useCallback((config: Partial<AlertConfig>) => {
    // Ensure loading is hidden first to avoid nested modals
    setLoadingConfig({ visible: false, title: '', message: '' });
    
    // Small delay to ensure loading modal is fully dismissed on iOS
    setTimeout(() => {
      setAlertConfig({
        visible: true,
        type: (config.type as AlertType) || 'info',
        title: config.title || '',
        message: config.message || '',
        buttons: config.buttons || [],
        icon: config.icon || null,
      });
    }, 100);
  }, []);

  const hideAlert = useCallback(() => {
    setAlertConfig((prev) => ({ ...prev, visible: false }));
  }, []);

  const showLoading = useCallback((title?: string, message?: string) => {
    // Hide any existing alert first
    setAlertConfig({ visible: false, type: 'info', title: '', message: '', buttons: [], icon: null });
    
    setLoadingConfig({
      visible: true,
      title: title || 'Please Wait',
      message: message || 'Processing...',
    });
  }, []);

  const hideLoading = useCallback(() => {
    setLoadingConfig({ visible: false, title: '', message: '' });
  }, []);

  const alert: AlertContextValue = useMemo(() => ({
    show: showAlert,
    success: (title: string, message?: string, buttons?: AlertButton[]) => showAlert({ type: 'success', title, message, buttons }),
    error: (title: string, message?: string, buttons?: AlertButton[]) => showAlert({ type: 'error', title, message, buttons }),
    failed: (title: string, message?: string, buttons?: AlertButton[]) => showAlert({ type: 'failed', title, message, buttons }),
    waiting: (title: string, message?: string, buttons?: AlertButton[]) => showAlert({ type: 'waiting', title, message, buttons }),
    info: (title: string, message?: string, buttons?: AlertButton[]) => showAlert({ type: 'info', title, message, buttons }),
    confirm: (title: string, message?: string, buttons?: AlertButton[]) => showAlert({ type: 'confirm', title, message, buttons }),
    warning: (title: string, message?: string, buttons?: AlertButton[]) => showAlert({ type: 'info', title, message, buttons }),
    loading: showLoading,
    hideLoading: hideLoading,
  }), [showAlert, showLoading, hideLoading]);

  return (
    <AlertContext.Provider value={alert}>
      {children}
      
      {/* Main Alert Modal */}
      <CustomAlert
        visible={alertConfig.visible}
        type={alertConfig.type}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        icon={alertConfig.icon}
        onDismiss={hideAlert}
      />
      
      {/* Loading Modal - NO nested CustomAlert, just simple UI */}
      <Modal
        visible={loadingConfig.visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        presentationStyle="overFullScreen"
        hardwareAccelerated
      >
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingBox}>
            <LinearGradient
              colors={themeGradients.yellowBox}
              style={styles.loadingGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Ionicons name="hourglass" size={40} color="#FFFFFF" />
              <AppText style={styles.loadingTitle}>{loadingConfig.title}</AppText>
              <AppText style={styles.loadingMessage}>{loadingConfig.message}</AppText>
              <ActivityIndicator size="large" color="#FFFFFF" style={styles.spinner} />
            </LinearGradient>
          </View>
        </View>
      </Modal>
    </AlertContext.Provider>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingBox: {
    width: '80%',
    maxWidth: 350,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  loadingGradient: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 15,
    textAlign: 'center',
  },
  loadingMessage: {
    fontSize: 15,
    color: '#FFFFFF',
    marginTop: 8,
    textAlign: 'center',
    opacity: 0.95,
  },
  spinner: {
    marginTop: 20,
  },
});

export function useAlert(): AlertContextValue {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlert must be used within an AlertProvider');
  }
  return context;
}
