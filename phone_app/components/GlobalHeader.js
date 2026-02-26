import React, { useMemo, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeContext } from '../contexts/ThemeContext';
import { getColors, borderRadius, shadows, spacing } from '../theme';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useHeader } from '../contexts/HeaderContext';
import AppText from './AppText';

const HOME_PATHS = new Set([
  '/',
  '/ManagerHomepage',
  '/UserHomepage',
  '/WorkerHomepage',
  '/BasicHomepage',
]);

const translations = {
  en: {
    settings: 'Settings',
    support: 'Support & Feedback',
    menu: 'Menu',
    back: 'Go back',
  },
  he: {
    settings: 'הגדרות',
    support: 'תמיכה ומשוב',
    menu: 'תפריט',
    back: 'חזרה',
  },
  ar: {
    settings: 'الإعدادات',
    support: 'الدعم والملاحظات',
    menu: 'القائمة',
    back: 'رجوع',
  },
};

function MenuRow({ icon, iconLibrary, label, onPress, palette, isRTL }) {
  const IconSet = iconLibrary === 'material' ? MaterialCommunityIcons : Ionicons;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.menuItem,
        { borderBottomColor: palette.borderLight, opacity: pressed ? 0.86 : 1 },
      ]}
      onPress={onPress}
    >
      <View style={[styles.menuItemLeft, isRTL && styles.menuItemLeftRtl]}>
        <IconSet name={icon} size={20} color={palette.secondary} />
        <AppText variant="bodyStrong" color={palette.textPrimary}>
          {label}
        </AppText>
      </View>
      <Ionicons
        name={isRTL ? 'chevron-back' : 'chevron-forward'}
        size={18}
        color={palette.textLight}
      />
    </Pressable>
  );
}

export function GlobalHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { isDarkMode } = useThemeContext();
  const { language } = useLanguageContext();
  const { headerAnimatedValue } = useHeader();
  const [menuVisible, setMenuVisible] = useState(false);
  const palette = getColors(isDarkMode);
  const isRTL = language === 'he' || language === 'ar';
  const isHomepage = HOME_PATHS.has(pathname);
  const t = translations[language] || translations.en;

  const HEADER_HEIGHT = useMemo(() => insets.top + 66, [insets.top]);

  const headerTranslateY = headerAnimatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -HEADER_HEIGHT],
    extrapolate: 'clamp',
  });

  const headerOpacity = headerAnimatedValue.interpolate({
    inputRange: [0, 0.65, 1],
    outputRange: [1, 0.35, 0],
    extrapolate: 'clamp',
  });

  const closeMenuAndNavigate = (to) => {
    setMenuVisible(false);
    setTimeout(() => router.push(to), 80);
  };

  return (
    <>
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.headerContainer,
          {
            paddingTop: insets.top + 8,
            transform: [{ translateY: headerTranslateY }],
            opacity: headerOpacity,
          },
        ]}
      >
        {!isHomepage ? (
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t.back}
            style={({ pressed }) => [
              styles.iconButton,
              isRTL ? styles.alignEnd : styles.alignStart,
              {
                backgroundColor: palette.surfaceAlt,
                borderColor: palette.border,
                opacity: pressed ? 0.86 : 1,
              },
            ]}
          >
            <Ionicons
              name="arrow-back"
              size={21}
              color={palette.primary}
              style={isRTL ? styles.rtlFlipped : null}
            />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setMenuVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={t.menu}
            style={({ pressed }) => [
              styles.iconButton,
              isRTL ? styles.alignStart : styles.alignEnd,
              {
                backgroundColor: palette.surfaceAlt,
                borderColor: palette.border,
                opacity: pressed ? 0.86 : 1,
              },
            ]}
          >
            <Ionicons name="menu" size={22} color={palette.primary} />
          </Pressable>
        )}
      </Animated.View>

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable
          style={[styles.menuOverlay, { backgroundColor: palette.overlaySoft }]}
          onPress={() => setMenuVisible(false)}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.menuDropdown,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
                top: insets.top + (Platform.OS === 'ios' ? 60 : 52),
                right: isRTL ? undefined : spacing.lg,
                left: isRTL ? spacing.lg : undefined,
              },
            ]}
          >
            <MenuRow
              icon="settings-outline"
              label={t.settings}
              onPress={() => closeMenuAndNavigate('/Settings')}
              palette={palette}
              isRTL={isRTL}
            />
            <MenuRow
              icon="chat-question-outline"
              iconLibrary="material"
              label={t.support}
              onPress={() => closeMenuAndNavigate('/SupportChat')}
              palette={palette}
              isRTL={isRTL}
            />
          </Pressable>
        </Pressable>
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
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  alignStart: {
    alignSelf: 'flex-start',
  },
  alignEnd: {
    alignSelf: 'flex-end',
  },
  rtlFlipped: {
    transform: [{ scaleX: -1 }],
  },
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    ...shadows.floating,
  },
  menuOverlay: {
    flex: 1,
  },
  menuDropdown: {
    position: 'absolute',
    minWidth: 236,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    overflow: 'hidden',
    ...shadows.floating,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  menuItemLeftRtl: {
    flexDirection: 'row-reverse',
  },
});
