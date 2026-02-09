import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Modal, Animated } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { useThemeContext } from '../contexts/ThemeContext';
import { getColors, shadows, borderRadius, spacing, typography } from '../theme';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useHeader } from '../contexts/HeaderContext';

export function GlobalHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const { isDarkMode } = useThemeContext();
  const { language } = useLanguageContext();
  const { headerAnimatedValue } = useHeader();
  const colors = getColors(isDarkMode);
  const [menuVisible, setMenuVisible] = useState(false);

  // Header height for translation calculation
  const HEADER_HEIGHT = Platform.OS === 'ios' ? 120 : 110;

  // Animated transform - moves header up when hidden
  const headerTranslateY = headerAnimatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -HEADER_HEIGHT],
    extrapolate: 'clamp',
  });

  // Animated opacity for smooth fade
  const headerOpacity = headerAnimatedValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0.5, 0],
    extrapolate: 'clamp',
  });

  // Check if current page is a homepage
  const isHomepage =  pathname === '/'||
                      pathname === '/ManagerHomepage' || 
                      pathname === '/UserHomepage' || 
                      pathname === '/WorkerHomepage' ||
                      pathname === '/BasicHomepage';

  const t = language === 'en' ? {
    settings: 'Settings',
    permission: 'Permission',
    support: 'Support & Feedback',
    menu: 'Menu',
  } : language === 'he' ? {
    settings: 'הגדרות',
    permission: 'הרשאות',
    support: 'תמיכה ומשוב',
    menu: 'תפריט',
  } : {
    settings: 'الإعدادات',
    permission: 'الأذونات',
    support: 'الدعم والملاحظات',
    menu: 'القائمة',
  };

  const handleMenuItemPress = (action) => {
    setMenuVisible(false);
    // Small delay to ensure menu closes before navigation
    setTimeout(() => {
      action();
    }, 100);
  };

  return (
    <>
      {/* Animated Header Container */}
      <Animated.View
        style={[
          styles.headerContainer,
          {
            transform: [{ translateY: headerTranslateY }],
            opacity: headerOpacity,
          },
        ]}
        pointerEvents="box-none"
      >
        {/* Back Button - Show on all pages except homepages */}
        {!isHomepage && (
          <TouchableOpacity 
            style={[styles.backButton, { backgroundColor: colors.secondary }]} 
            onPress={() => router.back()}
            activeOpacity={0.7}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
          >
            <Ionicons name="arrow-back" size={22} color="white" />
          </TouchableOpacity>
        )}

        {/* Show Menu Button Only in Homepage */}
        {isHomepage && (
          <TouchableOpacity 
            style={[styles.menuButton, { backgroundColor: colors.secondary }]} 
            onPress={() => setMenuVisible(true)}
            activeOpacity={0.7}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
          >
            <Ionicons name="menu" size={22} color="white" />
          </TouchableOpacity>
        )}
      </Animated.View>

      {/* Menu Dropdown */}
      <Modal
        visible={menuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity 
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View 
            style={[
              styles.menuDropdown, 
              { backgroundColor: colors.surface, top: Platform.OS === 'ios' ? 105 : 95 }
            ]}
            onStartShouldSetResponder={() => true}
          >
            {/* Settings Option */}
            <TouchableOpacity
              style={[styles.menuItem, { borderBottomColor: colors.border }]}
              onPress={() => handleMenuItemPress(() => router.push('/Settings'))}
            >
              <Ionicons name="settings-outline" size={20} color={colors.primary} />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>
                {t.settings}
              </Text>
            </TouchableOpacity>

            {/* Permission Option */}
            <TouchableOpacity
              style={[styles.menuItem, { borderBottomColor: colors.border }]}
              onPress={() => handleMenuItemPress(() => router.push('/Permission'))}
            >
              <MaterialCommunityIcons name="shield-check-outline" size={20} color={colors.primary} />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>
                {t.permission}
              </Text>
            </TouchableOpacity>

            {/* Support & Feedback Option */}
            <TouchableOpacity
              style={[styles.menuItem, { borderBottomColor: colors.border }]}
              onPress={() => handleMenuItemPress(() => router.push('/SupportChat'))}
            >
              <MaterialCommunityIcons name="chat-question-outline" size={20} color={colors.primary} />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>
                {t.support}
              </Text>
            </TouchableOpacity>

            {/* Add more menu items here in the future */}
            {/* Example:
            <TouchableOpacity
              style={[styles.menuItem, { borderBottomColor: colors.border }]}
              onPress={() => handleMenuItemPress(() => router.push('/Profile'))}
            >
              <Ionicons name="person-outline" size={20} color={colors.primary} />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>
                Profile
              </Text>
            </TouchableOpacity>
            */}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 9999,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 50,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 9999,
    ...shadows.floating,
  },
  menuButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 50,
    right: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 9999,
    ...shadows.floating,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  menuDropdown: {
    position: 'absolute',
    right: 16,
    minWidth: 200,
    borderRadius: borderRadius.lg,
    ...shadows.floating,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderBottomWidth: 0.5,
    gap: 16,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '500',
  },
});
