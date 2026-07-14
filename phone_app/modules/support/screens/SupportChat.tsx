import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { randomUUID } from 'expo-crypto';
import { useMutation } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  SupportCategory,
  SupportConversationSummary,
  SupportMessage,
} from '@smart-job/api-contracts';

import { AppInput, AppText, GlobalHeader } from '../../../components';
import { useAlert } from '../../../contexts/AlertContext';
import { useLanguageContext } from '../../../contexts/LanguageContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTenant } from '../../../contexts/TenantContext';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { queryClient, tenantQueryKey } from '../../../lib/query/client';
import { borderRadius, getColors, gradients, shadows, spacing, typography } from '../../../theme';
import { logger } from '../../../utils/logger';
import { StableSupportActionKeys } from '../lib/support-action-keys';
import {
  appendSupportMessage,
  createSupportConversation,
  markSupportConversationRead,
} from '../lib/support-api';
import {
  getSupportCategoryMeta,
  getSupportTemplateQuestions,
  getSupportTranslations,
} from '../lib/support-copy';
import { supportDate } from '../lib/support-message-store';
import {
  appendSupportMessageToThreadCache,
  useSupportConversationsInfinite,
  useSupportThreadInfinite,
} from '../lib/use-support-queries';

const CATEGORIES: readonly SupportCategory[] = [
  'bug',
  'opinion',
  'suggestion',
  'support',
  'freeChat',
];

type ScreenMode = 'main' | 'history' | 'thread';

const statusTranslations = {
  en: {
    loadFailed: 'Support conversations could not be loaded.',
    refreshFailed: 'Support data could not be refreshed. Saved data remains visible.',
    threadFailed: 'Messages could not be loaded.',
    actionFailed: 'The support action failed. You can retry safely.',
    retry: 'Retry',
    loadMore: 'Load more',
    loadNewer: 'Load newer messages',
  },
  he: {
    loadFailed: 'לא ניתן היה לטעון את שיחות התמיכה.',
    refreshFailed: 'לא ניתן היה לרענן את התמיכה. הנתונים השמורים נשארו מוצגים.',
    threadFailed: 'לא ניתן היה לטעון את ההודעות.',
    actionFailed: 'פעולת התמיכה נכשלה. ניתן לנסות שוב בבטחה.',
    retry: 'נסה שוב',
    loadMore: 'טען עוד',
    loadNewer: 'טען הודעות חדשות יותר',
  },
  ar: {
    loadFailed: 'تعذر تحميل محادثات الدعم.',
    refreshFailed: 'تعذر تحديث الدعم. ستبقى البيانات المحفوظة ظاهرة.',
    threadFailed: 'تعذر تحميل الرسائل.',
    actionFailed: 'فشل إجراء الدعم. يمكنك إعادة المحاولة بأمان.',
    retry: 'إعادة المحاولة',
    loadMore: 'تحميل المزيد',
    loadNewer: 'تحميل رسائل أحدث',
  },
};

export default function SupportChat() {
  const insets = useSafeAreaInsets();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const { user, status: sessionStatus } = useSession();
  const { workspace, status: tenantStatus } = useTenant();
  const alert = useAlert();
  const colors = getColors(isDarkMode);
  const t = getSupportTranslations(language);
  const statusText = statusTranslations[language] || statusTranslations.en;
  const uid = user?.id ?? null;
  const companyId = workspace?.companyId ?? null;
  const scopeCompanyId = companyId ?? 0;
  const supportEnabled = sessionStatus === 'authenticated' && tenantStatus !== 'loading';

  const [mode, setMode] = useState<ScreenMode>('main');
  const [selectedConversation, setSelectedConversation] = useState<SupportConversationSummary | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<SupportCategory | null>(null);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateAnswers, setTemplateAnswers] = useState<Record<number, string>>({});
  const [message, setMessage] = useState('');
  const [hiddenConversations, setHiddenConversations] = useState<string[]>([]);
  const flatListRef = useRef<FlatList<SupportMessage> | null>(null);
  const actionKeysRef = useRef<StableSupportActionKeys | null>(null);
  actionKeysRef.current ??= new StableSupportActionKeys(() => randomUUID());
  const actionKeys = actionKeysRef.current;

  const openConversationsQuery = useSupportConversationsInfinite({
    uid,
    companyId,
    status: 'open',
    enabled: supportEnabled,
  });
  const closedConversationsQuery = useSupportConversationsInfinite({
    uid,
    companyId,
    status: 'closed',
    enabled: supportEnabled && mode === 'history',
  });
  const threadQuery = useSupportThreadInfinite({
    uid,
    companyId,
    conversationId: selectedConversation?.id ?? null,
    enabled: supportEnabled && mode === 'thread',
  });

  useEffect(() => {
    actionKeys.reset();
    setHiddenConversations([]);
    setMode('main');
    setSelectedConversation(null);
    setSelectedCategory(null);
    setShowCategoryDropdown(false);
    setShowTemplateForm(false);
    setTemplateAnswers({});
    setMessage('');
  }, [actionKeys, scopeCompanyId, uid]);

  useEffect(() => {
    const error = openConversationsQuery.query.error
      ?? closedConversationsQuery.query.error
      ?? threadQuery.query.error;
    if (error) logger.warn('Support query failed; retaining same-scope cached data', error);
  }, [
    closedConversationsQuery.query.error,
    openConversationsQuery.query.error,
    threadQuery.query.error,
  ]);

  const visibleOpenConversations = useMemo(
    () => openConversationsQuery.conversations.filter(
      (conversation) => !hiddenConversations.includes(conversation.id),
    ),
    [hiddenConversations, openConversationsQuery.conversations],
  );
  const visibleClosedConversations = useMemo(
    () => closedConversationsQuery.conversations.filter(
      (conversation) => !hiddenConversations.includes(conversation.id),
    ),
    [closedConversationsQuery.conversations, hiddenConversations],
  );
  const hasTemplateAnswer = useMemo(
    () => Object.values(templateAnswers).some((answer) => answer.trim().length > 0),
    [templateAnswers],
  );

  const createMutation = useMutation({
    mutationFn: createSupportConversation,
  });
  const appendMutation = useMutation({
    mutationFn: appendSupportMessage,
  });
  const readMutation = useMutation({
    mutationFn: markSupportConversationRead,
  });

  const invalidateConversationLists = async () => {
    if (!uid) return;
    await queryClient.invalidateQueries({
      queryKey: tenantQueryKey(uid, scopeCompanyId, 'support', 'conversations'),
    });
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
      logger.warn('Could not mark support conversation as read', error);
    }
  };

  const viewConversation = (conversation: SupportConversationSummary) => {
    setSelectedConversation(conversation);
    setSelectedCategory(conversation.category);
    setShowTemplateForm(false);
    setMode('thread');
    if (conversation.unreadForUser > 0) void markConversationRead(conversation.id);
  };

  const startNewConversation = async (category: SupportCategory) => {
    if (!uid || createMutation.isPending) return;
    setSelectedCategory(category);
    setShowCategoryDropdown(false);
    const fingerprint = `${companyId ?? 'none'}:${category}`;
    const action = 'conversation:create';
    const key = actionKeys.keyFor(action, fingerprint);
    try {
      const created = await createMutation.mutateAsync({
        uid,
        companyId,
        category,
        idempotencyKey: key,
      });
      actionKeys.complete(action, key);
      setSelectedConversation(created);
      setShowTemplateForm(category !== 'freeChat');
      setTemplateAnswers({});
      setMode('thread');
      await invalidateConversationLists();
    } catch (error) {
      logger.warn('Could not create support conversation', error);
    }
  };

  const sendText = async (text: string): Promise<boolean> => {
    const conversationId = selectedConversation?.id;
    const trimmedText = text.trim();
    if (!uid || !conversationId || !trimmedText || appendMutation.isPending) return false;
    const action = `message:${conversationId}`;
    const fingerprint = `${conversationId}:${trimmedText}`;
    const key = actionKeys.keyFor(action, fingerprint);
    try {
      const created = await appendMutation.mutateAsync({
        uid,
        companyId,
        conversationId,
        text: trimmedText,
        idempotencyKey: key,
      });
      actionKeys.complete(action, key);
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
      return true;
    } catch (error) {
      logger.warn('Could not append support message', error);
      return false;
    }
  };

  const sendMessage = async () => {
    const sent = await sendText(message);
    if (sent) setMessage('');
  };

  const useTemplateAnswers = async () => {
    const questions = getSupportTemplateQuestions(language, selectedCategory);
    const formatted = questions
      .map((question, index) => {
        const answer = templateAnswers[index]?.trim() ?? '';
        return answer ? `${question}\n${answer}` : '';
      })
      .filter(Boolean)
      .join('\n\n');
    if (!formatted) return;
    const sent = await sendText(formatted);
    if (sent) {
      setShowTemplateForm(false);
      setTemplateAnswers({});
    }
  };

  const hideConversation = (conversationId: string) => {
    alert.confirm(t.hideChat, t.hideConfirm, [
      { text: t.cancel, style: 'cancel', onPress: () => undefined },
      {
        text: t.yes,
        style: 'destructive',
        onPress: () => {
          const nextHidden = [...new Set([...hiddenConversations, conversationId])];
          setHiddenConversations(nextHidden);
          alert.success(t.hidden, '');
        },
      },
    ]);
  };

  const formatDate = (value: string) => supportDate(value)?.toLocaleDateString() ?? '';
  const actionError = createMutation.error ?? appendMutation.error ?? readMutation.error;

  const renderConversation = ({ item }: { item: SupportConversationSummary }) => {
    const category = getSupportCategoryMeta(item.category, colors, t);
    return (
      <View style={[styles.conversationCard, { backgroundColor: colors.surface }]}>
        <TouchableOpacity style={styles.conversationMain} onPress={() => viewConversation(item)}>
          {category.type === 'Ionicons' ? (
            <Ionicons
              name={category.icon as keyof typeof Ionicons.glyphMap}
              size={22}
              color={category.color}
            />
          ) : (
            <MaterialCommunityIcons
              name={category.icon as keyof typeof MaterialCommunityIcons.glyphMap}
              size={22}
              color={category.color}
            />
          )}
          <View style={styles.conversationText}>
            <AppText variant="bodyStrong" numberOfLines={2}>{item.lastMessage || t.emptyState}</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              {formatDate(item.lastMessageAt)} · {item.status === 'open' ? t.openStatus : t.closedStatus}
            </AppText>
          </View>
          {item.unreadForUser > 0 ? (
            <View style={[styles.unreadBadge, { backgroundColor: colors.error }]}>
              <AppText style={styles.unreadText}>{item.unreadForUser}</AppText>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.hideButton} onPress={() => hideConversation(item.id)}>
          <Ionicons name="eye-off-outline" size={20} color={colors.error} />
        </TouchableOpacity>
      </View>
    );
  };

  const renderMessage = ({ item }: { item: SupportMessage }) => {
    const fromUser = item.senderRole === 'user';
    return (
      <View style={[styles.messageRow, fromUser ? styles.userRow : styles.devRow]}>
        <View style={[
          styles.messageBubble,
          fromUser
            ? { backgroundColor: colors.primary, borderBottomRightRadius: borderRadius.xs }
            : { backgroundColor: colors.surface, borderBottomLeftRadius: borderRadius.xs },
        ]}>
          <AppText color={fromUser ? 'white' : colors.textPrimary}>{item.text}</AppText>
        </View>
      </View>
    );
  };

  if (sessionStatus === 'restoring' || tenantStatus === 'loading' || openConversationsQuery.query.isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar style={isDarkMode ? 'light' : 'dark'} />
        <View style={styles.centerState}><ActivityIndicator size="large" color={colors.primary} /></View>
        <GlobalHeader />
      </SafeAreaView>
    );
  }

  if (!uid) return null;

  const mainQuery = mode === 'history'
    ? closedConversationsQuery.query
    : openConversationsQuery.query;
  const mainHasData = mode === 'history'
    ? visibleClosedConversations.length > 0
    : visibleOpenConversations.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <LinearGradient colors={gradients.primary} style={styles.header}>
        {mode !== 'main' ? (
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => {
              setMode('main');
              setSelectedConversation(null);
              setShowTemplateForm(false);
            }}
          >
            <Ionicons name="arrow-back" size={22} color="white" />
          </TouchableOpacity>
        ) : <View style={styles.headerSpacer} />}
        <AppText style={styles.headerTitle}>
          {mode === 'history' ? t.history : t.title}
        </AppText>
        {mode === 'main' ? (
          <TouchableOpacity style={styles.headerButton} onPress={() => setMode('history')}>
            <MaterialCommunityIcons name="history" size={22} color="white" />
          </TouchableOpacity>
        ) : <View style={styles.headerSpacer} />}
      </LinearGradient>

      {actionError ? (
        <View style={[styles.errorBanner, { borderColor: colors.error, backgroundColor: colors.surface }]}>
          <AppText color={colors.error} style={styles.errorText}>{statusText.actionFailed}</AppText>
        </View>
      ) : null}

      {mode === 'main' ? (
        <ScrollView
          contentContainerStyle={styles.mainContent}
          refreshControl={(
            <RefreshControl
              refreshing={openConversationsQuery.query.isRefetching}
              onRefresh={() => { void openConversationsQuery.query.refetch(); }}
              tintColor={colors.primary}
            />
          )}
        >
          {openConversationsQuery.query.isError ? (
            <View style={[styles.errorBanner, { borderColor: colors.error, backgroundColor: colors.surface }]}>
              <AppText color={colors.error} style={styles.errorText}>
                {mainHasData ? statusText.refreshFailed : statusText.loadFailed}
              </AppText>
              <TouchableOpacity onPress={() => { void openConversationsQuery.query.refetch(); }}>
                <AppText color={colors.primary} variant="label">{statusText.retry}</AppText>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={[styles.categoryCard, { backgroundColor: colors.surface }]}>
            <TouchableOpacity
              style={styles.categoryHeader}
              onPress={() => setShowCategoryDropdown((shown) => !shown)}
              disabled={createMutation.isPending}
            >
              <MaterialCommunityIcons name="format-list-bulleted" size={22} color={colors.primary} />
              <AppText style={styles.categoryHeaderText}>
                {selectedCategory
                  ? getSupportCategoryMeta(selectedCategory, colors, t).label
                  : t.selectCategory}
              </AppText>
              {createMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name={showCategoryDropdown ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} />
              )}
            </TouchableOpacity>
            {showCategoryDropdown ? CATEGORIES.map((categoryValue) => {
              const category = getSupportCategoryMeta(categoryValue, colors, t);
              return (
                <TouchableOpacity
                  key={categoryValue}
                  style={styles.categoryOption}
                  disabled={createMutation.isPending}
                  onPress={() => { void startNewConversation(categoryValue); }}
                >
                  {category.type === 'Ionicons' ? (
                    <Ionicons name={category.icon as keyof typeof Ionicons.glyphMap} size={20} color={category.color} />
                  ) : (
                    <MaterialCommunityIcons name={category.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={20} color={category.color} />
                  )}
                  <AppText>{category.label}</AppText>
                </TouchableOpacity>
              );
            }) : null}
          </View>

          <AppText variant="heading" style={styles.sectionTitle}>{t.openChats}</AppText>
          {visibleOpenConversations.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="chat-outline" size={52} color={colors.textSecondary} />
              <AppText color={colors.textSecondary}>{t.noOpenChats}</AppText>
            </View>
          ) : visibleOpenConversations.map((conversation) => (
            <View key={conversation.id}>{renderConversation({ item: conversation })}</View>
          ))}
          {openConversationsQuery.query.hasNextPage ? (
            <TouchableOpacity
              style={[styles.loadMoreButton, { borderColor: colors.primary }]}
              disabled={openConversationsQuery.query.isFetchingNextPage}
              onPress={() => { void openConversationsQuery.query.fetchNextPage(); }}
            >
              {openConversationsQuery.query.isFetchingNextPage
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <AppText color={colors.primary} variant="label">{statusText.loadMore}</AppText>}
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      ) : mode === 'history' ? (
        mainQuery.isLoading ? (
          <View style={styles.centerState}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : (
          <FlatList
            data={visibleClosedConversations}
            keyExtractor={(item) => item.id}
            renderItem={renderConversation}
            contentContainerStyle={visibleClosedConversations.length ? styles.listContent : styles.emptyListContent}
            ListEmptyComponent={(
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="chat-outline" size={52} color={colors.textSecondary} />
                <AppText color={colors.textSecondary}>{t.noHistory}</AppText>
              </View>
            )}
            ListHeaderComponent={mainQuery.isError ? (
              <View style={[styles.errorBanner, { borderColor: colors.error, backgroundColor: colors.surface }]}>
                <AppText color={colors.error} style={styles.errorText}>
                  {mainHasData ? statusText.refreshFailed : statusText.loadFailed}
                </AppText>
                <TouchableOpacity onPress={() => { void mainQuery.refetch(); }}>
                  <AppText color={colors.primary} variant="label">{statusText.retry}</AppText>
                </TouchableOpacity>
              </View>
            ) : null}
            ListFooterComponent={mainQuery.hasNextPage ? (
              <TouchableOpacity
                style={[styles.loadMoreButton, { borderColor: colors.primary }]}
                disabled={mainQuery.isFetchingNextPage}
                onPress={() => { void mainQuery.fetchNextPage(); }}
              >
                {mainQuery.isFetchingNextPage
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <AppText color={colors.primary} variant="label">{statusText.loadMore}</AppText>}
              </TouchableOpacity>
            ) : null}
            refreshControl={(
              <RefreshControl
                refreshing={mainQuery.isRefetching}
                onRefresh={() => { void mainQuery.refetch(); }}
                tintColor={colors.primary}
              />
            )}
          />
        )
      ) : (
        <KeyboardAvoidingView
          style={styles.threadContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          {showTemplateForm && selectedCategory ? (
            <View style={styles.templateContainer}>
              <ScrollView contentContainerStyle={styles.templateContent}>
                <AppText variant="heading">{t.fillTemplate}</AppText>
                {getSupportTemplateQuestions(language, selectedCategory).map((question, index) => (
                  <View key={`${selectedCategory}-${index}`} style={styles.templateQuestion}>
                    <AppText variant="label">{question}</AppText>
                    <AppInput
                      inputStyle={[styles.templateInput, { borderColor: colors.border, color: colors.textPrimary }]}
                      placeholder={t.answer}
                      value={templateAnswers[index] ?? ''}
                      onChangeText={(text) => setTemplateAnswers((answers) => ({ ...answers, [index]: text }))}
                      multiline
                    />
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: hasTemplateAnswer && !appendMutation.isPending ? 1 : 0.5,
                  },
                ]}
                disabled={!hasTemplateAnswer || appendMutation.isPending}
                onPress={() => { void useTemplateAnswers(); }}
              >
                {appendMutation.isPending
                  ? <ActivityIndicator size="small" color="white" />
                  : <AppText color="white" variant="label">{t.sendMessage}</AppText>}
              </TouchableOpacity>
            </View>
          ) : threadQuery.query.isLoading ? (
            <View style={styles.centerState}><ActivityIndicator size="large" color={colors.primary} /></View>
          ) : threadQuery.query.isError && threadQuery.messages.length === 0 ? (
            <View style={styles.centerState}>
              <AppText color={colors.error}>{statusText.threadFailed}</AppText>
              <TouchableOpacity onPress={() => { void threadQuery.query.refetch(); }}>
                <AppText color={colors.primary} variant="label">{statusText.retry}</AppText>
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
                  <AppText color={colors.error} style={styles.errorText}>{statusText.refreshFailed}</AppText>
                  <TouchableOpacity onPress={() => { void threadQuery.query.refetch(); }}>
                    <AppText color={colors.primary} variant="label">{statusText.retry}</AppText>
                  </TouchableOpacity>
                </View>
              ) : null}
              ListEmptyComponent={(
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="chat-processing-outline" size={52} color={colors.textSecondary} />
                  <AppText color={colors.textSecondary}>{t.emptyState}</AppText>
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
                    : <AppText color={colors.primary} variant="label">{statusText.loadNewer}</AppText>}
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

          {!showTemplateForm && selectedConversation?.status === 'open' ? (
            <View style={[styles.inputRow, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.sm }]}>
              <AppInput
                inputStyle={[styles.messageInput, { color: colors.textPrimary }]}
                placeholder={t.placeholder}
                value={message}
                onChangeText={setMessage}
                maxLength={4_000}
                multiline
              />
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  { backgroundColor: colors.primary, opacity: message.trim() && !appendMutation.isPending ? 1 : 0.5 },
                ]}
                disabled={!message.trim() || appendMutation.isPending}
                onPress={() => { void sendMessage(); }}
              >
                {appendMutation.isPending
                  ? <ActivityIndicator size="small" color="white" />
                  : <Ionicons name="send" size={20} color="white" />}
              </TouchableOpacity>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      )}
      <GlobalHeader />
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
  headerButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerSpacer: { width: 40 },
  mainContent: { padding: spacing.lg },
  categoryCard: { borderRadius: borderRadius.lg, marginBottom: spacing.xl, ...shadows.small },
  categoryHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  categoryHeaderText: { flex: 1 },
  categoryOption: {
    alignItems: 'center',
    borderTopColor: 'rgba(127,127,127,0.15)',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: { marginBottom: spacing.md },
  conversationCard: {
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    marginBottom: spacing.sm,
    padding: spacing.sm,
    ...shadows.small,
  },
  conversationMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm },
  conversationText: { flex: 1, gap: spacing.xs },
  hideButton: { padding: spacing.sm },
  unreadBadge: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 24,
    minWidth: 24,
    paddingHorizontal: spacing.xs,
  },
  unreadText: { color: 'white', fontSize: typography.xs, fontWeight: typography.bold },
  emptyState: { alignItems: 'center', gap: spacing.md, justifyContent: 'center', padding: spacing.xxl },
  listContent: { padding: spacing.md },
  emptyListContent: { flexGrow: 1, padding: spacing.md },
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
  threadContainer: { flex: 1 },
  messagesContent: { flexGrow: 1, padding: spacing.md },
  messageRow: { marginBottom: spacing.sm },
  userRow: { alignItems: 'flex-end' },
  devRow: { alignItems: 'flex-start' },
  messageBubble: { borderRadius: borderRadius.lg, maxWidth: '82%', padding: spacing.md, ...shadows.small },
  inputRow: { alignItems: 'flex-end', flexDirection: 'row', padding: spacing.md, ...shadows.medium },
  messageInput: { flex: 1, maxHeight: 120, minHeight: 44 },
  sendButton: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    marginLeft: spacing.sm,
    width: 44,
  },
  templateContainer: { flex: 1 },
  templateContent: { gap: spacing.lg, padding: spacing.lg },
  templateQuestion: { gap: spacing.xs },
  templateInput: { borderRadius: borderRadius.md, borderWidth: 1, minHeight: 72, padding: spacing.md },
  primaryButton: {
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    margin: spacing.md,
    minHeight: 48,
  },
});
