/**
 * DevInbox module - Dev Support Inbox screen logic
 *
 * Only visible to users with profile.role === 'dev'
 * Lists all open conversations and allows dev to reply and close conversations.
 *
 * Extracted from app/DevInbox.js to follow the thin-wrapper pattern.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  SafeAreaView,
  Modal,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db, auth, FieldValue, collection, doc, getDoc, getDocs, updateDoc, query, where, orderBy, runTransaction, signOut } from '../../firebase';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAlert } from '../../contexts/AlertContext';
import { useCache } from '../../contexts/CacheContext';
import { getColors, spacing, borderRadius, typography, shadows, gradients } from '../../theme';
import { AppText, GlobalHeader } from '../../components';

export default function DevInbox() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const colors = getColors(isDarkMode);
  const alert = useAlert();
  const { clearCache } = useCache();
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  
  const flatListRef = useRef(null);

  const t = language === 'en' ? {
    inboxTitle: 'Dev Inbox',
    replyPlaceholder: 'Type your reply...',
    closeConversation: 'Close Conversation',
    noOpenConversations: 'No open conversations',
    openLabel: 'Open',
    closedLabel: 'Closed',
    send: 'Send',
    confirmClose: 'Are you sure you want to close this conversation?',
    yes: 'Yes',
    cancel: 'Cancel',
    conversationClosed: 'Conversation closed',
  } : language === 'he' ? {
    inboxTitle: 'תיבת דואר מפתח',
    replyPlaceholder: 'כתוב את התשובה שלך...',
    closeConversation: 'סגור שיחה',
    noOpenConversations: 'אין שיחות פתוחות',
    openLabel: 'פתוח',
    closedLabel: 'סגור',
    send: 'שלח',
    confirmClose: 'האם אתה בטוח שברצונך לסגור שיחה זו?',
    yes: 'כן',
    cancel: 'ביטול',
    conversationClosed: 'השיחה נסגרה',
  } : {
    inboxTitle: 'صندوق بريد المطور',
    replyPlaceholder: 'اكتب ردك...',
    closeConversation: 'إغلاق المحادثة',
    noOpenConversations: 'لا توجد محادثات مفتوحة',
    openLabel: 'مفتوح',
    closedLabel: 'مغلق',
    send: 'إرسال',
    confirmClose: 'هل أنت متأكد من إغلاق هذه المحادثة؟',
    yes: 'نعم',
    cancel: 'إلغاء',
    conversationClosed: 'تم إغلاق المحادثة',
  };

  // Helper: Extract messages from conversation doc (message1, message2, etc.)
  const extractMessagesFromDoc = (convData) => {
    const msgs = [];
    let i = 1;
    while (convData[`message${i}`]) {
      const msg = convData[`message${i}`];
      msgs.push({
        id: `message${i}`,
        senderUid: msg.senderUid,
        text: msg.text,
        index: i,
      });
      i++;
    }
    return msgs;
  };

  // Helper: Get next message number from conversation data
  const getNextMessageNumber = (convData) => {
    let maxNum = 0;
    Object.keys(convData).forEach(key => {
      const match = key.match(/^message(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
    return maxNum + 1;
  };

  // Load conversations (one-time fetch, no realtime)
  const loadConversations = async () => {
    try {
      const conversationsRef = collection(db, 'conversations');
      // Optimized query: only fetch open conversations with unread messages
      const q = query(conversationsRef,
        where('status', '==', 'open'),
        where('unreadForDev', '>', 0),
        orderBy('unreadForDev', 'desc'),
        orderBy('lastMessageAt', 'desc')
      );
      
      const snapshot = await getDocs(q);
      
      const convs = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data(),
        lastMessageAt: docSnap.data().lastMessageAt?.toDate() || new Date(),
        createdAt: docSnap.data().createdAt?.toDate() || new Date(),
      }));
      
      setConversations(convs);
      setLoading(false);
    } catch (error) {
      console.error('Error loading conversations:', error);
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadConversations();
  }, []);

  // Refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadConversations();
    setRefreshing(false);
  }, []);

  // Load messages for a specific conversation (one-time fetch)
  const loadConversationMessages = async (convId) => {
    try {
      const convRef = doc(db, 'conversations', convId);
      const convSnap = await getDoc(convRef);
      
      if (convSnap.exists) {
        const convData = convSnap.data();
        const msgs = extractMessagesFromDoc(convData);
        setMessages(msgs);
        
        // Scroll to bottom
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: false });
        }, 100);
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const openConversation = async (conv) => {
    setSelectedConversation(conv);
    setLoadingMessages(true);
    
    // Load messages (one-time fetch)
    await loadConversationMessages(conv.id);
    setLoadingMessages(false);
    
    // Mark as read for dev
    try {
      await updateDoc(doc(db, 'conversations', conv.id), {
        unreadForDev: 0,
      });
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  // Refresh messages in modal
  const refreshConversationMessages = async () => {
    if (selectedConversation) {
      setRefreshing(true);
      await loadConversationMessages(selectedConversation.id);
      setRefreshing(false);
    }
  };

  const closeConversationModal = () => {
    setSelectedConversation(null);
    setMessages([]);
    setReply('');
  };

  const sendReply = async () => {
    if (!reply.trim() || !selectedConversation || sending) return;
    
    const user = auth.currentUser;
    if (!user) return;
    
    const trimmedReply = reply.trim();
    setReply('');
    setSending(true);
    
    try {
      const convRef = doc(db, 'conversations', selectedConversation.id);
      
      // Use transaction to safely add next message
      await runTransaction(db, async (transaction) => {
        const convSnap = await transaction.get(convRef);
        if (!convSnap.exists) {
          throw new Error('Conversation not found');
        }
        
        const convData = convSnap.data();
        const nextNum = getNextMessageNumber(convData);
        const messageKey = `message${nextNum}`;
        
        transaction.update(convRef, {
          [messageKey]: {
            senderUid: 'dev',
            text: trimmedReply,
          },
          lastMessage: trimmedReply,
          lastMessageAt: FieldValue.serverTimestamp(),
          unreadForUser: (convData.unreadForUser || 0) + 1,
          unreadForDev: 0,
        });
      });
      
      // Refresh messages after sending
      await loadConversationMessages(selectedConversation.id);
      
      setSending(false);
    } catch (error) {
      console.error('Error sending reply:', error);
      setReply(trimmedReply);
      setSending(false);
    }
  };

  const handleCloseConversation = () => {
    const convId = selectedConversation?.id;
    if (!convId) return;
    
    // Close modal first to avoid nested modal issues
    closeConversationModal();
    
    // Show alert after modal is closed
    setTimeout(() => {
      alert.confirm(
        t.closeConversation,
        t.confirmClose,
        [
          { text: t.cancel, style: 'cancel', onPress: () => {} },
          {
            text: t.yes,
            style: 'destructive',
            onPress: async () => {
              try {
                await updateDoc(doc(db, 'conversations', convId), {
                  status: 'closed',
                });
                alert.success(t.conversationClosed, '');
              } catch (error) {
                console.error('Error closing conversation:', error);
              }
            },
          },
        ]
      );
    }, 300);
  };

  const handleLogout = () => {
    alert.confirm(
      language === 'en' ? 'Logout' : language === 'he' ? 'התנתקות' : 'تسجيل الخروج',
      language === 'en' ? 'Are you sure you want to logout?' : language === 'he' ? 'האם אתה בטוח שברצונך להתנתק?' : 'هل أنت متأكد من تسجيل الخروج؟',
      [
        { text: t.cancel, style: 'cancel', onPress: () => {} },
        {
          text: t.yes,
          style: 'destructive',
          onPress: async () => {
            try {
              clearCache();
              await signOut(auth);
              router.replace('/');
            } catch (error) {
              console.error('Error signing out:', error);
            }
          },
        },
      ]
    );
  };

  const formatTime = (date) => {
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (date) => {
    if (!date) return '';
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return formatTime(date);
    } else if (days === 1) {
      return language === 'en' ? 'Yesterday' : language === 'he' ? 'אתמול' : 'أمس';
    } else {
      return date.toLocaleDateString();
    }
  };

  const renderConversation = ({ item }) => {
    // Use userName if available, otherwise fall back to userId
    const displayName = item.userName || item.userId || 'Unknown User';
    
    // Get category icon and color
    const getCategoryIcon = () => {
      switch(item.category) {
        case 'bug':
          return { icon: 'bug-outline', type: 'Ionicons', color: colors.error };
        case 'opinion':
          return { icon: 'comment-text-outline', type: 'MaterialCommunityIcons', color: '#9C27B0' };
        case 'suggestion':
          return { icon: 'bulb-outline', type: 'Ionicons', color: '#FF9800' };
        case 'support':
          return { icon: 'account-tie-outline', type: 'MaterialCommunityIcons', color: colors.primary };
        default:
          return { icon: 'chatbubble-outline', type: 'Ionicons', color: colors.textSecondary };
      }
    };
    
    const categoryIcon = getCategoryIcon();
    
    return (
      <TouchableOpacity
        style={[styles.conversationItem, { backgroundColor: colors.surface }]}
        onPress={() => openConversation(item)}
      >
        <View style={styles.avatarContainer}>
          <LinearGradient
            colors={gradients.primary}
            style={styles.avatar}
          >
            <AppText style={styles.avatarText}>
              {displayName.charAt(0).toUpperCase()}
            </AppText>
          </LinearGradient>
        </View>
        <View style={styles.conversationContent}>
          <View style={styles.conversationHeader}>
            <View style={styles.categoryIconContainer}>
              {categoryIcon.type === 'Ionicons' ? (
                <Ionicons name={categoryIcon.icon} size={18} color={categoryIcon.color} />
              ) : (
                <MaterialCommunityIcons name={categoryIcon.icon} size={18} color={categoryIcon.color} />
              )}
            </View>
            <AppText style={[styles.conversationUserName, { color: colors.textPrimary }]} numberOfLines={1}>
              {displayName}
            </AppText>
            {item.unreadForDev > 0 && (
              <View style={[styles.unreadBadge, { backgroundColor: colors.error }]}>
                <AppText style={styles.unreadBadgeText}>{item.unreadForDev}</AppText>
              </View>
            )}
          </View>
          <AppText style={[styles.conversationMessage, { color: colors.textSecondary }]} numberOfLines={2}>
            {item.lastMessage || '(No messages)'}
          </AppText>
          <AppText style={[styles.conversationDate, { color: colors.textSecondary }]}>
            {formatDate(item.lastMessageAt)}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    );
  };

  const renderMessage = ({ item }) => {
    const isDev = item.senderUid === 'dev';
    
    return (
      <View style={[
        styles.messageContainer,
        isDev ? styles.devMessageContainer : styles.userMessageContainer,
      ]}>
        <View style={[
          styles.messageBubble,
          isDev 
            ? [styles.devBubble, { backgroundColor: colors.primary }]
            : [styles.userBubble, { backgroundColor: colors.backgroundLight }],
        ]}>
          <AppText style={[
            styles.messageText,
            { color: isDev ? 'white' : colors.textPrimary }
          ]}>
            {item.text}
          </AppText>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar style={isDarkMode ? 'light' : 'dark'} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <GlobalHeader />
      
      {/* Header */}
      <LinearGradient
        colors={gradients.secondary}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <AppText style={styles.headerTitle}>{t.inboxTitle}</AppText>
        <View style={styles.headerRight}>
          <View style={styles.headerBadge}>
            <AppText style={styles.headerBadgeText}>{conversations.length}</AppText>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
            <MaterialCommunityIcons name="logout" size={26} color="white" />
            <AppText style={styles.logoutText}>
              {language === 'en' ? 'Logout' : language === 'he' ? 'יציאה' : 'خروج'}
            </AppText>
          </TouchableOpacity>
        </View>
      </LinearGradient>
      
      {/* Conversations List */}
      {conversations.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons name="inbox-outline" size={64} color={colors.textSecondary} />
          <AppText style={[styles.emptyText, { color: colors.textSecondary }]}>
            {t.noOpenConversations}
          </AppText>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderConversation}
          contentContainerStyle={styles.conversationsList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        />
      )}
      
      {/* Conversation Modal */}
      <Modal
        visible={!!selectedConversation}
        animationType="slide"
        onRequestClose={closeConversationModal}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          {/* Modal Header */}
          <LinearGradient
            colors={gradients.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.modalHeader}
          >
            <TouchableOpacity onPress={closeConversationModal} style={styles.modalBackButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <View style={styles.modalTitleContainer}>
              <AppText style={styles.modalTitle} numberOfLines={1}>
                {selectedConversation?.userName || selectedConversation?.userId || 'user'}
              </AppText>
            </View>
            <TouchableOpacity 
              onPress={handleCloseConversation} 
              style={styles.closeConvButton}
            >
              <Ionicons name="checkmark-done" size={20} color="white" />
              <AppText style={styles.closeConvText}>
                {language === 'en' ? 'Close' : language === 'he' ? 'סגור' : 'إغلاق'}
              </AppText>
            </TouchableOpacity>
          </LinearGradient>
          
          <KeyboardAvoidingView 
            style={styles.chatContainer}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
          >
            {loadingMessages ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : messages.length === 0 ? (
              <View style={styles.emptyContainer}>
                <MaterialCommunityIcons name="chat-outline" size={64} color={colors.textSecondary} />
                <AppText style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No messages
                </AppText>
              </View>
            ) : (
              <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={(item) => item.id}
                renderItem={renderMessage}
                contentContainerStyle={[styles.messagesList, { paddingBottom: insets.bottom + 80 }]}
                onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={refreshConversationMessages}
                    colors={[colors.primary]}
                    tintColor={colors.primary}
                  />
                }
              />
            )}
            
            {/* Reply Input */}
            <View style={[styles.inputContainer, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.sm }]}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary }]}
                placeholder={t.replyPlaceholder}
                placeholderTextColor={colors.textSecondary}
                value={reply}
                onChangeText={setReply}
                multiline
                maxLength={1000}
              />
              <TouchableOpacity
                style={[styles.sendButton, { backgroundColor: colors.primary, opacity: reply.trim() ? 1 : 0.5 }]}
                onPress={sendReply}
                disabled={!reply.trim() || sending}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Ionicons name="send" size={20} color="white" />
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
  },
  headerTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: 'white',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  headerBadgeText: {
    color: 'white',
    fontSize: typography.sm,
    fontWeight: typography.bold,
  },
  logoutButton: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  logoutText: {
    color: 'white',
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    fontSize: typography.base,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  conversationsList: {
    padding: spacing.md,
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.lg,
    ...shadows.small,
  },
  avatarContainer: {
    marginRight: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: 'white',
    fontSize: typography.lg,
    fontWeight: typography.bold,
  },
  conversationContent: {
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  categoryIconContainer: {
    marginRight: spacing.xs,
  },
  conversationUserName: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    flex: 1,
  },
  conversationUserId: {
    fontSize: typography.sm,
    flex: 1,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  unreadBadgeText: {
    color: 'white',
    fontSize: typography.xs,
    fontWeight: typography.bold,
  },
  conversationMessage: {
    fontSize: typography.base,
    marginBottom: spacing.xs,
  },
  conversationDate: {
    fontSize: typography.sm,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'ios' ? spacing.xxl + 10 : spacing.xxl,
  },
  modalBackButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: spacing.sm,
    borderRadius: borderRadius.md,
  },
  modalTitleContainer: {
    flex: 1,
    marginHorizontal: spacing.md,
  },
  modalTitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    color: 'white',
  },
  closeConvButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  closeConvText: {
    color: 'white',
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  chatContainer: {
    flex: 1,
  },
  messagesList: {
    padding: spacing.md,
  },
  messageContainer: {
    marginBottom: spacing.sm,
  },
  userMessageContainer: {
    alignItems: 'flex-start',
  },
  devMessageContainer: {
    alignItems: 'flex-end',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    ...shadows.small,
  },
  userBubble: {
    borderBottomLeftRadius: borderRadius.xs,
  },
  devBubble: {
    borderBottomRightRadius: borderRadius.xs,
  },
  messageText: {
    fontSize: typography.base,
    lineHeight: typography.base * 1.4,
  },
  messageTime: {
    fontSize: typography.xs,
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.md,
    ...shadows.medium,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
    fontSize: typography.base,
    marginRight: spacing.sm,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
