import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { randomUUID } from 'expo-crypto';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SupportConversationSummary, SupportMessage } from '@smart-job/api-contracts';

import { AppInput, AppText, GlobalHeader } from '../../../components';
import { useAlert } from '../../../contexts/AlertContext';
import { useCache } from '../../../contexts/CacheContext';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTenant } from '../../../contexts/TenantContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { clearViewerPushToken } from '../../../lib/api/push-tokens';
import { invalidateTenantQueries } from '../../../lib/query/client';
import { ROUTES } from '../../../navigation/routes';
import NotAvailableScreen from '../../shared/NotAvailableScreen';
import { runLogoutSequence } from '../../settings/lib/logout';
import { borderRadius, getColors, gradients, shadows, spacing, typography } from '../../../theme';
import { logger } from '../../../utils/logger';
import { StableSupportActionKeys } from '../lib/support-action-keys';
import {
  appendSupportMessage,
  closeSupportConversation,
  markSupportConversationRead,
} from '../lib/support-api';
import { supportDate } from '../lib/support-message-store';
import {
  appendSupportMessageToThreadCache,
  useSupportConversationsInfinite,
  useSupportThreadInfinite,
  useTrustedViewerProfile,
} from '../lib/use-support-queries';

const translations = {
  en: {
    inboxTitle: 'Dev Inbox',
    replyPlaceholder: 'Type your reply...',
    closeConversation: 'Close conversation',
    noOpenConversations: 'No open conversations',
    noMessages: 'No messages',
    confirmClose: 'Are you sure you want to close this conversation?',
    conversationClosed: 'Conversation closed',
    loadFailed: 'The support inbox could not be loaded.',
    refreshFailed: 'The inbox could not be refreshed. Saved conversations remain visible.',
    threadFailed: 'The conversation messages could not be loaded.',
    actionFailed: 'The action failed. You can retry safely.',
    retry: 'Retry',
    loadMore: 'Load more conversations',
    loadNewer: 'Load newer messages',
    logout: 'Logout',
    logoutConfirm: 'Are you sure you want to logout?',
    yes: 'Yes',
    cancel: 'Cancel',
  },
  he: {
    inboxTitle: 'תיבת דואר מפתח',
    replyPlaceholder: 'כתוב את התשובה שלך...',
    closeConversation: 'סגור שיחה',
    noOpenConversations: 'אין שיחות פתוחות',
    noMessages: 'אין הודעות',
    confirmClose: 'האם אתה בטוח שברצונך לסגור שיחה זו?',
    conversationClosed: 'השיחה נסגרה',
    loadFailed: 'לא ניתן היה לטעון את תיבת התמיכה.',
    refreshFailed: 'לא ניתן היה לרענן את התיבה. השיחות השמורות נשארו מוצגות.',
    threadFailed: 'לא ניתן היה לטעון את הודעות השיחה.',
    actionFailed: 'הפעולה נכשלה. ניתן לנסות שוב בבטחה.',
    retry: 'נסה שוב',
    loadMore: 'טען שיחות נוספות',
    loadNewer: 'טען הודעות חדשות יותר',
    logout: 'התנתקות',
    logoutConfirm: 'האם אתה בטוח שברצונך להתנתק?',
    yes: 'כן',
    cancel: 'ביטול',
  },
  ar: {
    inboxTitle: 'صندوق بريد المطور',
    replyPlaceholder: 'اكتب ردك...',
    closeConversation: 'إغلاق المحادثة',
    noOpenConversations: 'لا توجد محادثات مفتوحة',
    noMessages: 'لا توجد رسائل',
    confirmClose: 'هل أنت متأكد من إغلاق هذه المحادثة؟',
    conversationClosed: 'تم إغلاق المحادثة',
    loadFailed: 'تعذر تحميل صندوق الدعم.',
    refreshFailed: 'تعذر تحديث الصندوق. ستبقى المحادثات المحفوظة ظاهرة.',
    threadFailed: 'تعذر تحميل رسائل المحادثة.',
    actionFailed: 'فشل الإجراء. يمكنك إعادة المحاولة بأمان.',
    retry: 'إعادة المحاولة',
    loadMore: 'تحميل محادثات إضافية',
    loadNewer: 'تحميل رسائل أحدث',
    logout: 'تسجيل الخروج',
    logoutConfirm: 'هل أنت متأكد من تسجيل الخروج؟',
    yes: 'نعم',
    cancel: 'إلغاء',
  },
};

export default function DevInbox() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const { user, status: sessionStatus, signOut: signOutSession } = useSession();
  const { workspace, status: tenantStatus } = useTenant();
  const { clearCache } = useCache();
  const alert = useAlert();
  const colors = getColors(isDarkMode);
  const t = translations[language] || translations.en;
  const uid = user?.id ?? null;
  const companyId = workspace?.companyId ?? null;
  const scopeCompanyId = companyId ?? 0;
  const actionKeysRef = useRef<StableSupportActionKeys | null>(null);
  actionKeysRef.current ??= new StableSupportActionKeys(() => randomUUID());
  const actionKeys = actionKeysRef.current;
  const flatListRef = useRef<FlatList<SupportMessage> | null>(null);

  const [selectedConversation, setSelectedConversation] = useState<SupportConversationSummary | null>(null);
  const [reply, setReply] = useState('');

  const viewerQuery = useTrustedViewerProfile(uid, companyId);
  const isDev = workspace?.role === 'dev' || viewerQuery.data?.systemRole === 'dev';
  const conversationsQuery = useSupportConversationsInfinite({
    uid,
    companyId,
    status: 'open',
    enabled: sessionStatus === 'authenticated' && isDev,
  });
  const threadQuery = useSupportThreadInfinite({
    uid,
    companyId,
    conversationId: selectedConversation?.id ?? null,
    enabled: sessionStatus === 'authenticated' && isDev && selectedConversation !== null,
  });

  useEffect(() => {
    actionKeys.reset();
    setSelectedConversation(null);
    setReply('');
  }, [actionKeys, scopeCompanyId, uid]);

  useEffect(() => {
    const error = viewerQuery.error ?? conversationsQuery.query.error ?? threadQuery.query.error;
    if (error) logger.warn('Developer support inbox query failed; retaining cached data', error);
  }, [conversationsQuery.query.error, threadQuery.query.error, viewerQuery.error]);

  const appendMutation = useMutation({ mutationFn: appendSupportMessage });
  const readMutation = useMutation({ mutationFn: markSupportConversationRead });
  const closeMutation = useMutation({ mutationFn: closeSupportConversation });

  const invalidateConversationLists = async () => {
    if (!uid) return;
    await invalidateTenantQueries(uid, scopeCompanyId, 'support', 'conversations');
  };

  const markConversationRead = async (conversationId: string) => {
    if (!uid) return;
    const action = `read:${conversationId}`;
    const key = actionKeys.keyFor(action, conversationId);
    try {
      await readMutation.mutateAsync({
        uid,
        companyId,
        conversationId,
        idempotencyKey: key,
      });
      actionKeys.complete(action, key);
      await invalidateConversationLists();
    } catch (error) {
      logger.warn('Could not mark developer support conversation as read', error);
    }
  };

  const openConversation = (conversation: SupportConversationSummary) => {
    setSelectedConversation(conversation);
    setReply('');
    if (conversation.unreadForDev > 0) void markConversationRead(conversation.id);
  };

  const sendReply = async () => {
    const conversationId = selectedConversation?.id;
    const trimmedReply = reply.trim();
    if (!uid || !conversationId || !trimmedReply || appendMutation.isPending) return;
    const action = `message:${conversationId}`;
    const key = actionKeys.keyFor(action, `${conversationId}:${trimmedReply}`);
    try {
      const created = await appendMutation.mutateAsync({
        uid,
        companyId,
        conversationId,
        text: trimmedReply,
        idempotencyKey: key,
      });
      actionKeys.complete(action, key);
      setReply('');
      const cached = appendSupportMessageToThreadCache({
        uid,
        companyId,
        conversationId,
        message: created,
      });
      await Promise.all([
        cached ? Promise.resolve() : threadQuery.query.refetch(),
        invalidateConversationLists(),
      ]);
    } catch (error) {
      logger.warn('Could not send developer support reply', error);
    }
  };

  const handleCloseConversation = () => {
    const conversationId = selectedConversation?.id;
    if (!uid || !conversationId || closeMutation.isPending) return;
    alert.confirm(t.closeConversation, t.confirmClose, [
      { text: t.cancel, style: 'cancel', onPress: () => undefined },
      {
        text: t.yes,
        style: 'destructive',
        onPress: async () => {
          const action = `close:${conversationId}`;
          const key = actionKeys.keyFor(action, conversationId);
          try {
            await closeMutation.mutateAsync({
              uid,
              companyId,
              conversationId,
              idempotencyKey: key,
            });
            actionKeys.complete(action, key);
            setSelectedConversation(null);
            setReply('');
            await invalidateConversationLists();
            alert.success(t.conversationClosed, '');
          } catch (error) {
            logger.warn('Could not close support conversation', error);
          }
        },
      },
    ]);
  };

  const handleLogout = () => {
    alert.confirm(t.logout, t.logoutConfirm, [
      { text: t.cancel, style: 'cancel', onPress: () => undefined },
      {
        text: t.yes,
        style: 'destructive',
        onPress: async () => {
          try {
            await runLogoutSequence({
              userId: uid,
              clearPushToken: clearViewerPushToken,
              signOut: signOutSession,
              clearCache,
              onPushTokenClearError: (error) => {
                logger.warn('Failed to clear push token before developer logout', error);
              },
            });
            router.replace(ROUTES.root);
          } catch (error) {
            logger.error('Developer logout failed', error);
            alert.error(t.logout, t.actionFailed);
          }
        },
      },
    ]);
  };

  const formatDate = (value: string) => {
    const date = supportDate(value);
    if (!date) return '';
    const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
    if (days === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString();
  };

  const renderConversation = ({ item }: { item: SupportConversationSummary }) => (
    <TouchableOpacity
      style={[styles.conversationCard, { backgroundColor: colors.surface }]}
      onPress={() => openConversation(item)}
    >
      <LinearGradient colors={gradients.primary} style={styles.avatar}>
        <AppText style={styles.avatarText}>{item.userName.charAt(0).toUpperCase()}</AppText>
      </LinearGradient>
      <View style={styles.conversationText}>
        <View style={styles.conversationTitleRow}>
          <AppText variant="bodyStrong" numberOfLines={1} style={styles.userName}>{item.userName}</AppText>
          {item.unreadForDev > 0 ? (
            <View style={[styles.unreadBadge, { backgroundColor: colors.error }]}>
              <AppText style={styles.unreadText}>{item.unreadForDev}</AppText>
            </View>
          ) : null}
        </View>
        <AppText color={colors.textSecondary} numberOfLines={2}>{item.lastMessage}</AppText>
        <AppText variant="caption" color={colors.textSecondary}>{formatDate(item.lastMessageAt)}</AppText>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  const renderMessage = ({ item }: { item: SupportMessage }) => {
    const fromDev = item.senderRole === 'dev';
    return (
      <View style={[styles.messageRow, fromDev ? styles.devRow : styles.userRow]}>
        <View style={[
          styles.messageBubble,
          fromDev
            ? { backgroundColor: colors.primary, borderBottomRightRadius: borderRadius.xs }
            : { backgroundColor: colors.surface, borderBottomLeftRadius: borderRadius.xs },
        ]}>
          <AppText color={fromDev ? 'white' : colors.textPrimary}>{item.text}</AppText>
        </View>
      </View>
    );
  };

  const accessLoading = sessionStatus === 'restoring'
    || tenantStatus === 'loading'
    || viewerQuery.isLoading;
  if (accessLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centerState}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }
  if (!uid) return null;
  if (!isDev && viewerQuery.isError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centerState}>
          <AppText color={colors.error}>{t.loadFailed}</AppText>
          <TouchableOpacity onPress={() => { void viewerQuery.refetch(); }}>
            <AppText color={colors.primary} variant="label">{t.retry}</AppText>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }
  if (!isDev) return <NotAvailableScreen reason="role" />;

  const hasConversations = conversationsQuery.conversations.length > 0;
  const mutationError = appendMutation.error ?? closeMutation.error ?? readMutation.error;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <GlobalHeader />
      <LinearGradient colors={gradients.secondary} style={styles.header}>
        <AppText style={styles.headerTitle}>{t.inboxTitle}</AppText>
        <View style={styles.headerActions}>
          <View style={styles.countBadge}>
            <AppText style={styles.countText}>{conversationsQuery.conversations.length}</AppText>
          </View>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={22} color="white" />
            <AppText style={styles.logoutText}>{t.logout}</AppText>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {conversationsQuery.query.isLoading ? (
        <View style={styles.centerState}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : conversationsQuery.query.isError && !hasConversations ? (
        <View style={styles.centerState}>
          <AppText color={colors.error}>{t.loadFailed}</AppText>
          <TouchableOpacity onPress={() => { void conversationsQuery.query.refetch(); }}>
            <AppText color={colors.primary} variant="label">{t.retry}</AppText>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={conversationsQuery.conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderConversation}
          contentContainerStyle={hasConversations ? styles.listContent : styles.emptyListContent}
          ListHeaderComponent={conversationsQuery.query.isError ? (
            <View style={[styles.errorBanner, { borderColor: colors.error, backgroundColor: colors.surface }]}>
              <AppText color={colors.error} style={styles.errorText}>{t.refreshFailed}</AppText>
              <TouchableOpacity onPress={() => { void conversationsQuery.query.refetch(); }}>
                <AppText color={colors.primary} variant="label">{t.retry}</AppText>
              </TouchableOpacity>
            </View>
          ) : null}
          ListEmptyComponent={(
            <View style={styles.centerState}>
              <MaterialCommunityIcons name="inbox-outline" size={60} color={colors.textSecondary} />
              <AppText color={colors.textSecondary}>{t.noOpenConversations}</AppText>
            </View>
          )}
          ListFooterComponent={conversationsQuery.query.hasNextPage ? (
            <TouchableOpacity
              style={[styles.loadMoreButton, { borderColor: colors.primary }]}
              disabled={conversationsQuery.query.isFetchingNextPage}
              onPress={() => { void conversationsQuery.query.fetchNextPage(); }}
            >
              {conversationsQuery.query.isFetchingNextPage
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <AppText color={colors.primary} variant="label">{t.loadMore}</AppText>}
            </TouchableOpacity>
          ) : null}
          refreshControl={(
            <RefreshControl
              refreshing={conversationsQuery.query.isRefetching}
              onRefresh={() => { void conversationsQuery.query.refetch(); }}
              tintColor={colors.primary}
            />
          )}
        />
      )}

      <Modal
        visible={selectedConversation !== null}
        animationType="slide"
        onRequestClose={() => setSelectedConversation(null)}
      >
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
          <LinearGradient colors={gradients.primary} style={styles.modalHeader}>
            <TouchableOpacity style={styles.headerButton} onPress={() => setSelectedConversation(null)}>
              <Ionicons name="arrow-back" size={22} color="white" />
            </TouchableOpacity>
            <AppText style={styles.modalTitle} numberOfLines={1}>
              {selectedConversation?.userName ?? ''}
            </AppText>
            <TouchableOpacity
              style={[styles.closeButton, { opacity: closeMutation.isPending ? 0.5 : 1 }]}
              disabled={closeMutation.isPending}
              onPress={handleCloseConversation}
            >
              {closeMutation.isPending
                ? <ActivityIndicator size="small" color="white" />
                : <Ionicons name="checkmark-done" size={20} color="white" />}
              <AppText style={styles.closeText}>{t.closeConversation}</AppText>
            </TouchableOpacity>
          </LinearGradient>

          {mutationError ? (
            <View style={[styles.errorBanner, { borderColor: colors.error, backgroundColor: colors.surface }]}>
              <AppText color={colors.error}>{t.actionFailed}</AppText>
            </View>
          ) : null}

          <KeyboardAvoidingView
            style={styles.threadContainer}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            {threadQuery.query.isLoading ? (
              <View style={styles.centerState}><ActivityIndicator size="large" color={colors.primary} /></View>
            ) : threadQuery.query.isError && threadQuery.messages.length === 0 ? (
              <View style={styles.centerState}>
                <AppText color={colors.error}>{t.threadFailed}</AppText>
                <TouchableOpacity onPress={() => { void threadQuery.query.refetch(); }}>
                  <AppText color={colors.primary} variant="label">{t.retry}</AppText>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                ref={flatListRef}
                data={threadQuery.messages}
                keyExtractor={(item) => item.id}
                renderItem={renderMessage}
                contentContainerStyle={[styles.messagesContent, { paddingBottom: insets.bottom + 24 }]}
                ListHeaderComponent={threadQuery.query.isError ? (
                  <View style={[styles.errorBanner, { borderColor: colors.error, backgroundColor: colors.surface }]}>
                    <AppText color={colors.error} style={styles.errorText}>{t.refreshFailed}</AppText>
                    <TouchableOpacity onPress={() => { void threadQuery.query.refetch(); }}>
                      <AppText color={colors.primary} variant="label">{t.retry}</AppText>
                    </TouchableOpacity>
                  </View>
                ) : null}
                ListEmptyComponent={(
                  <View style={styles.centerState}>
                    <MaterialCommunityIcons name="chat-outline" size={56} color={colors.textSecondary} />
                    <AppText color={colors.textSecondary}>{t.noMessages}</AppText>
                  </View>
                )}
                ListFooterComponent={threadQuery.query.hasNextPage ? (
                  <TouchableOpacity
                    style={[styles.loadMoreButton, { borderColor: colors.primary }]}
                    disabled={threadQuery.query.isFetchingNextPage}
                    onPress={() => { void threadQuery.query.fetchNextPage(); }}
                  >
                    {threadQuery.query.isFetchingNextPage
                      ? <ActivityIndicator size="small" color={colors.primary} />
                      : <AppText color={colors.primary} variant="label">{t.loadNewer}</AppText>}
                  </TouchableOpacity>
                ) : null}
                refreshControl={(
                  <RefreshControl
                    refreshing={threadQuery.query.isRefetching}
                    onRefresh={() => { void threadQuery.query.refetch(); }}
                    tintColor={colors.primary}
                  />
                )}
              />
            )}

            <View style={[styles.inputRow, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.sm }]}>
              <AppInput
                inputStyle={[styles.replyInput, { color: colors.textPrimary }]}
                placeholder={t.replyPlaceholder}
                value={reply}
                onChangeText={setReply}
                maxLength={4_000}
                multiline
              />
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  { backgroundColor: colors.primary, opacity: reply.trim() && !appendMutation.isPending ? 1 : 0.5 },
                ]}
                disabled={!reply.trim() || appendMutation.isPending}
                onPress={() => { void sendReply(); }}
              >
                {appendMutation.isPending
                  ? <ActivityIndicator size="small" color="white" />
                  : <Ionicons name="send" size={20} color="white" />}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerState: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  headerTitle: { color: 'white', fontSize: typography.xl, fontWeight: typography.bold },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  countBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  countText: { color: 'white', fontWeight: typography.bold },
  logoutButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  logoutText: { color: 'white', fontWeight: typography.semibold },
  listContent: { padding: spacing.md },
  emptyListContent: { flexGrow: 1, padding: spacing.md },
  conversationCard: {
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    ...shadows.small,
  },
  avatar: { alignItems: 'center', borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
  avatarText: { color: 'white', fontSize: typography.lg, fontWeight: typography.bold },
  conversationText: { flex: 1, gap: spacing.xs },
  conversationTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  userName: { flex: 1 },
  unreadBadge: {
    alignItems: 'center',
    borderRadius: 11,
    justifyContent: 'center',
    minHeight: 22,
    minWidth: 22,
    paddingHorizontal: spacing.xs,
  },
  unreadText: { color: 'white', fontSize: typography.xs, fontWeight: typography.bold },
  errorBanner: {
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    margin: spacing.md,
    padding: spacing.md,
  },
  errorText: { flex: 1 },
  loadMoreButton: {
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginVertical: spacing.md,
    minHeight: 44,
  },
  modalHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  headerButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  modalTitle: { color: 'white', flex: 1, fontSize: typography.lg, fontWeight: typography.bold },
  closeButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  closeText: { color: 'white', fontSize: typography.sm, fontWeight: typography.semibold },
  threadContainer: { flex: 1 },
  messagesContent: { flexGrow: 1, padding: spacing.md },
  messageRow: { marginBottom: spacing.sm },
  devRow: { alignItems: 'flex-end' },
  userRow: { alignItems: 'flex-start' },
  messageBubble: { borderRadius: borderRadius.lg, maxWidth: '82%', padding: spacing.md, ...shadows.small },
  inputRow: { alignItems: 'flex-end', flexDirection: 'row', padding: spacing.md, ...shadows.medium },
  replyInput: { flex: 1, maxHeight: 120, minHeight: 44 },
  sendButton: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    marginLeft: spacing.sm,
    width: 44,
  },
});
