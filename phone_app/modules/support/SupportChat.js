/**
 * SupportChat.js - User Support & Feedback Chat Page
 * 
 * Full-page chat screen for users to send support questions/feedback
 * and receive replies from dev team.
 */
import { useCache } from '../../contexts/CacheContext';
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
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { storage } from '../../contexts/CacheContext';
import { db, auth, FieldValue, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, runTransaction } from '../../firebase';
import { useLanguageContext } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAlert } from '../../contexts/AlertContext';
import { getColors, spacing, borderRadius, typography, shadows, gradients } from '../../theme';
import { AppText, GlobalHeader } from '../../components';

export default function SupportChat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const colors = getColors(isDarkMode);
  const alert = useAlert();
  const {profile} = useCache();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [conversationStatus, setConversationStatus] = useState('open');
  const [showHistory, setShowHistory] = useState(false);
  const [closedConversations, setClosedConversations] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [viewingClosedConversation, setViewingClosedConversation] = useState(null);
  const [hiddenConversations, setHiddenConversations] = useState([]);
  const [hasNoConversation, setHasNoConversation] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [openConversations, setOpenConversations] = useState([]);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateAnswers, setTemplateAnswers] = useState({});
  
  const flatListRef = useRef(null);

  const t = language === 'en' ? {
    title: 'Support & Feedback',
    placeholder: 'Type your message...',
    send: 'Send',
    emptyState: 'No messages yet. Send us your question or feedback!',
    history: 'History',
    startNew: 'Start New Conversation',
    closed: 'This conversation is closed',
    noHistory: 'No previous conversations',
    hideChat: 'Hide',
    hideConfirm: 'Hide this conversation from your history?',
    yes: 'Yes',
    cancel: 'Cancel',
    hidden: 'Conversation hidden',
    startConversation: 'Start Chat',
    chooseCategory: 'How can we help you?',
    reportBug: 'Report a Bug',
    opinion: 'Tell us your opinion',
    suggestion: 'Suggestion for improvements',
    technicalSupport: 'Technical Support',
    selectCategory: 'Select a category',
    openChats: 'Open Conversations',
    noOpenChats: 'No open conversations',
    freeChat: 'Free Chat',
    templateBug: 'Where did you encounter the issue?\n\nWhat were you doing when it happened?\n\nWhat error message did you see?\n\nPlease describe the issue:',
    templateOpinion: 'What do you think about the app?\n\nWhat do you like most?\n\nWhat could be improved?\n\nYour feedback:',
    templateSuggestion: 'What feature would you like to see?\n\nHow would it help you?\n\nYour suggestion:',
    templateSupport: 'What do you need help with?\n\nPlease describe your issue in detail:',
    sendMessage: 'Send',
    fillTemplate: 'Fill out the template to help us understand your issue better',
    question1: 'Question 1',
    question2: 'Question 2',
    question3: 'Question 3',
    question4: 'Question 4',
    answer: 'Your answer...',
  } : language === 'he' ? {
    title: 'תמיכה ומשוב',
    placeholder: 'כתוב את ההודעה שלך...',
    send: 'שלח',
    emptyState: 'אין הודעות עדיין. שלח לנו שאלה או משוב!',
    history: 'היסטוריה',
    startNew: 'התחל שיחה חדשה',
    closed: 'שיחה זו סגורה',
    noHistory: 'אין שיחות קודמות',
    hideChat: 'הסתר',
    hideConfirm: 'להסתיר את השיחה מההיסטוריה?',
    yes: 'כן',
    cancel: 'ביטול',
    hidden: 'השיחה הוסתרה',
    startConversation: 'התחל צ\'אט',
    chooseCategory: 'איך נוכל לעזור?',
    reportBug: 'דיווח על תקלה',
    opinion: 'ספר לנו את דעתך',
    suggestion: 'הצעה לשיפור',
    technicalSupport: 'תמיכה טכנית',
    selectCategory: 'בחר קטגוריה',
    openChats: 'שיחות פתוחות',
    noOpenChats: 'אין שיחות פתוחות',
    freeChat: 'צ\'אט חופשי',
    templateBug: 'איפה נתקלת בבעיה?\n\nמה עשית כשזה קרה?\n\nאיזו הודעת שגיאה ראית?\n\nנא לתאר את הבעיה:',
    templateOpinion: 'מה אתה חושב על האפליקציה?\n\nמה אהבת הכי הרבה?\n\nמה ניתן לשפר?\n\nהמשוב שלך:',
    templateSuggestion: 'איזו תכונה תרצה לראות?\n\nאיך זה יעזור לך?\n\nההצעה שלך:',
    templateSupport: 'במה אתה צריך עזרה?\n\nנא לתאר את הבעיה שלך בפירוט:',
    sendMessage: 'שלח',
    fillTemplate: 'מלא את התבנית כדי לעזור לנו להבין את הבעיה שלך',
    question1: 'שאלה 1',
    question2: 'שאלה 2',
    question3: 'שאלה 3',
    question4: 'שאלה 4',
    answer: 'התשובה שלך...',
  } : {
    title: 'الدعم والملاحظات',
    placeholder: 'اكتب رسالتك...',
    send: 'إرسال',
    emptyState: 'لا توجد رسائل حتى الآن. أرسل لنا سؤالك أو ملاحظاتك!',
    history: 'السجل',
    startNew: 'بدء محادثة جديدة',
    closed: 'هذه المحادثة مغلقة',
    noHistory: 'لا توجد محادثات سابقة',
    hideChat: 'إخفاء',
    hideConfirm: 'إخفاء هذه المحادثة من السجل؟',
    yes: 'نعم',
    cancel: 'إلغاء',
    hidden: 'تم إخفاء المحادثة',
    startConversation: 'بدء الدردشة',
    chooseCategory: 'كيف يمكننا مساعدتك؟',
    reportBug: 'الإبلاغ عن خطأ',
    opinion: 'أخبرنا برأيك',
    suggestion: 'اقتراحات للتحسين',
    technicalSupport: 'الدعم التقني',
    selectCategory: 'اختر فئة',
    openChats: 'المحادثات المفتوحة',
    noOpenChats: 'لا توجد محادثات مفتوحة',
    templateBug: 'أين واجهت المشكلة؟\n\nماذا كنت تفعل عندما حدث ذلك؟\n\nما هي رسالة الخطأ التي رأيتها؟\n\nيرجى وصف المشكلة:',
    templateOpinion: 'ما رأيك في التطبيق؟\n\nما الذي أعجبك أكثر؟\n\nما الذي يمكن تحسينه؟\n\nملاحظاتك:',
    templateSuggestion: 'ما الميزة التي تود رؤيتها؟\n\nكيف ستساعدك؟\n\nاقتراحك:',
    templateSupport: 'ما الذي تحتاج مساعدة فيه؟\n\nيرجى وصف مشكلتك بالتفصيل:',
    useTemplate: 'استخدام النموذج',
    skipTemplate: 'تخطي واكتب يدويًا',
    fillTemplate: 'املأ النموذج لمساعدتنا على فهم مشكلتك بشكل أفضل',
    question1: 'السؤال 1',
    question2: 'السؤال 2',
    question3: 'السؤال 3',
    question4: 'السؤال 4',
    answer: 'إجابتك...',
  };

  // Initialize on mount
  useEffect(() => {
    initializeConversation();
  }, []);

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

  const initializeConversation = async () => {
    const user = auth.currentUser;
    if (!user) {
      router.back();
      return;
    }

    try {
      setLoading(true);
      const uid = user.uid;
      
      // Fetch only open conversations
      const conversationsRef = collection(db, 'conversations');
      const q = query(conversationsRef, 
        where('userId', '==', uid),
        where('status', '==', 'open')
      );
      const openSnapshot = await getDocs(q);
      
      // Map and sort open conversations
      const allOpenConversations = openSnapshot.docs
        .map(docSnap => ({ 
          id: docSnap.id, 
          ...docSnap.data(),
          lastMessageAt: docSnap.data().lastMessageAt?.toDate() || new Date(),
          createdAt: docSnap.data().createdAt?.toDate() || new Date(),
        }))
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      
      // Load hidden conversations from local storage
      const hiddenStr = storage.getString('hiddenConversations');
      const hiddenIds = hiddenStr ? JSON.parse(hiddenStr) : [];
      setHiddenConversations(hiddenIds);
      
      // Load open conversations to display on main page
      const openConvs = allOpenConversations.filter(conv => !hiddenIds.includes(conv.id));
      setOpenConversations(openConvs);
      
      // Always show main page with category dropdown and open conversations
      setHasNoConversation(true);
      setConversationId(null);
      setMessages([]);
      
      setLoading(false);
    } catch (error) {
      console.error('Error initializing conversation:', error);
      setLoading(false);
    }
  };

  // Refresh handler for pull-to-refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await initializeConversation();
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

  // Refresh current conversation messages
  const refreshMessages = async () => {
    if (conversationId) {
      setRefreshing(true);
      await loadConversationMessages(conversationId);
      setRefreshing(false);
    }
  };

  const sendMessage = async () => {
    if (!message.trim() || !conversationId || sending) return;
    
    const user = auth.currentUser;
    if (!user) return;
    
    const trimmedMessage = message.trim();
    const uid = user.uid;
    setMessage('');
    setSending(true);
    
    try {
      const convRef = doc(db, 'conversations', conversationId);
      
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
            senderUid: uid,
            text: trimmedMessage,
          },
          status: 'open',
          lastMessage: trimmedMessage,
          lastMessageAt: FieldValue.serverTimestamp(),
          unreadForDev: (convData.unreadForDev || 0) + 1,
        });
      });
      
      // Refresh messages after sending
      await loadConversationMessages(conversationId);
      
      setSending(false);
    } catch (error) {
      console.error('Error sending message:', error);
      setMessage(trimmedMessage); // Restore message on error
      setSending(false);
    }
  };

  const loadAllConversations = async () => {
    const user = auth.currentUser;
    if (!user) return;
    
    setLoadingHistory(true);
    const uid = user.uid;
    
    try {
      const conversationsRef = collection(db, 'conversations');
      const q = query(conversationsRef,
        where('userId', '==', uid),
        where('status', '==', 'closed')
      );
      const snapshot = await getDocs(q);
      
      // Get all closed conversations, exclude hidden ones, and sort
      const convs = snapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data(),
          lastMessageAt: doc.data().lastMessageAt?.toDate() || new Date(),
          createdAt: doc.data().createdAt?.toDate() || new Date(),
        }))
        .filter(conv => !hiddenConversations.includes(conv.id))
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      
      // Fetch open conversations for main page refresh
      const openQuery = query(conversationsRef,
        where('userId', '==', uid),
        where('status', '==', 'open')
      );
      const openSnapshot = await getDocs(openQuery);
      const openConvs = openSnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data(),
          lastMessageAt: doc.data().lastMessageAt?.toDate() || new Date(),
          createdAt: doc.data().createdAt?.toDate() || new Date(),
        }))
        .filter(conv => !hiddenConversations.includes(conv.id))
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      
      setOpenConversations(openConvs);
      
      setClosedConversations(convs);
      setLoadingHistory(false);
    } catch (error) {
      console.error('Error loading closed conversations:', error);
      setLoadingHistory(false);
    }
  };

  const viewConversation = async (conv) => {
    setViewingClosedConversation(conv);
    
    // If conversation is open, allow chatting
    if (conv.status === 'open' || (conv.status === 'closed' && conv.unreadForUser > 0)) {
      setConversationId(conv.id);
      setConversationStatus('open');
      setHasNoConversation(false);
      await loadConversationMessages(conv.id);
      setShowHistory(false);
      setViewingClosedConversation(null);
      
      // Mark as read for user
      try {
        await updateDoc(doc(db, 'conversations', conv.id), {
          unreadForUser: 0,
        });
      } catch (error) {
        console.error('Error marking as read:', error);
      }
    } else {
      // For closed conversations, load messages as read-only
      await loadConversationMessages(conv.id);
      setConversationStatus('closed');
      setShowHistory(false);
    }
  };

  const startNewConversation = async (category = null) => {
    const user = auth.currentUser;
    if (!user) return;
    
    // If no category provided, show the welcome screen with category selection
    if (!category) {
      setViewingClosedConversation(null);
      setConversationId(null);
      setConversationStatus('open');
      setHasNoConversation(true);
      setMessages([]);
      setSelectedCategory(null);
      return;
    }
    
    setLoading(true);
    setViewingClosedConversation(null);
    setHasNoConversation(false);
    
    try {
      // Create new conversation
      const conversationsRef = collection(db, 'conversations');
      const uid = user.uid;
      
      // Ensure category is a string
      const categoryValue = typeof category === 'string' ? category : (typeof selectedCategory === 'string' ? selectedCategory : 'general');
      
      const newConvRef = await addDoc(conversationsRef, {
        userId: uid,
        userName: profile.name,
        status: 'open',
        category: categoryValue,
        lastMessage: '',
        lastMessageAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        unreadForUser: 0,
        unreadForDev: 0,
      });
      
      setConversationId(newConvRef.id);
      setConversationStatus('open');
      setMessages([]);
      
      // Show template form only for structured categories (not for freeChat)
      if (categoryValue !== 'freeChat') {
        setShowTemplateForm(true);
        setTemplateAnswers({});
      }
      
      setShowHistory(false);
      setLoading(false);
    } catch (error) {
      console.error('Error creating new conversation:', error);
      setLoading(false);
    }
  };

  // Get template questions based on category
  const getTemplateQuestions = (category) => {
    switch(category) {
      case 'bug':
        return [
          language === 'en' ? 'Where did you encounter the issue?' :
          language === 'he' ? 'איפה נתקלת בבעיה?' : 'أين واجهت المشكلة؟',
          
          language === 'en' ? 'What were you doing when it happened?' :
          language === 'he' ? 'מה עשית כשזה קרה?' : 'ماذا كنت تفعل عندما حدث ذلك؟',
          
          language === 'en' ? 'What error message did you see?' :
          language === 'he' ? 'איזו הודעת שגיאה ראית?' : 'ما هي رسالة الخطأ التي رأيتها؟',
          
          language === 'en' ? 'Please describe the issue:' :
          language === 'he' ? 'נא לתאר את הבעיה:' : 'يرجى وصف المشكلة:',
        ];
      case 'opinion':
        return [
          language === 'en' ? 'What do you think about the app?' :
          language === 'he' ? 'מה אתה חושב על האפליקציה?' : 'ما رأيك في التطبيق؟',
          
          language === 'en' ? 'What do you like most?' :
          language === 'he' ? 'מה אהבת הכי הרבה?' : 'ما الذي أعجبك أكثر؟',
          
          language === 'en' ? 'What could be improved?' :
          language === 'he' ? 'מה ניתן לשפר?' : 'ما الذي يمكن تحسينه؟',
          
          language === 'en' ? 'Your feedback:' :
          language === 'he' ? 'המשוב שלך:' : 'ملاحظاتك:',
        ];
      case 'suggestion':
        return [
          language === 'en' ? 'What feature would you like to see?' :
          language === 'he' ? 'איזו תכונה תרצה לראות?' : 'ما الميزة التي تود رؤيتها؟',
          
          language === 'en' ? 'How would it help you?' :
          language === 'he' ? 'איך זה יעזור לך?' : 'كيف ستساعدك؟',
          
          language === 'en' ? 'Your suggestion:' :
          language === 'he' ? 'ההצעה שלך:' : 'اقتراحك:',
        ];
      case 'support':
        return [
          language === 'en' ? 'What do you need help with?' :
          language === 'he' ? 'במה אתה צריך עזרה?' : 'ما الذي تحتاج مساعدة فيه؟',
          
          language === 'en' ? 'Please describe your issue in detail:' :
          language === 'he' ? 'נא לתאר את הבעיה שלך בפירוט:' : 'يرجى وصف مشكلتك بالتفصيل:',
        ];
      default:
        return [];
    }
  };

  // Format template answers and send message directly
  const useTemplateAnswers = async () => {
    if (!conversationId || sending) return;
    
    const user = auth.currentUser;
    if (!user) return;
    
    const questions = getTemplateQuestions(selectedCategory);
    let formattedMessage = '';
    
    questions.forEach((question, index) => {
      const answer = templateAnswers[index] || '';
      if (answer.trim()) {
        formattedMessage += `${question}\n${answer}\n\n`;
      }
    });
    
    const trimmedMessage = formattedMessage.trim();
    if (!trimmedMessage) return;
    
    const uid = user.uid;
    setShowTemplateForm(false);
    setTemplateAnswers({});
    setSending(true);
    
    try {
      const convRef = doc(db, 'conversations', conversationId);
      
      // Use transaction to safely add message
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
            senderUid: uid,
            text: trimmedMessage,
          },
          status: 'open',
          lastMessage: trimmedMessage,
          lastMessageAt: FieldValue.serverTimestamp(),
          unreadForDev: (convData.unreadForDev || 0) + 1,
        });
      });
      
      // Refresh messages after sending
      await loadConversationMessages(conversationId);
      
      setSending(false);
    } catch (error) {
      console.error('Error sending message:', error);
      setSending(false);
    }
  };

  const toggleHistory = () => {
    if (!showHistory) {
      loadAllConversations();
    }
    setShowHistory(!showHistory);
  };

  const hideConversation = (convId) => {
    if (!convId) return;
    
    alert.confirm(
      t.hideChat,
      t.hideConfirm,
      [
        { text: t.cancel, style: 'cancel', onPress: () => {} },
        {
          text: t.yes,
          style: 'destructive',
          onPress: async () => {
            try {
              // Add to hidden list (local only)
              const newHidden = [...hiddenConversations, convId];
              setHiddenConversations(newHidden);
              storage.set('hiddenConversations', JSON.stringify(newHidden));
              
              // Remove from closed conversations list
              setClosedConversations(prev => prev.filter(c => c.id !== convId));
              
              alert.success(t.hidden, '');
            } catch (error) {
              console.error('Error hiding conversation:', error);
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
    return date.toLocaleDateString();
  };

  const renderMessage = ({ item }) => {
    const user = auth.currentUser;
    const uid = user ? user.uid : '';
    const isUser = item.senderUid === uid;
    
    return (
      <View style={[
        styles.messageContainer,
        isUser ? styles.userMessageContainer : styles.devMessageContainer,
      ]}>
        <View style={[
          styles.messageBubble,
          isUser 
            ? [styles.userBubble, { backgroundColor: colors.primary }]
            : [styles.devBubble, { backgroundColor: colors.surface }],
        ]}>
          <AppText style={[
            styles.messageText,
            { color: isUser ? 'white' : colors.textPrimary }
          ]}>
            {item.text}
          </AppText>
        </View>
      </View>
    );
  };

  const renderConversation = ({ item }) => {
    const isOpen = item.status === 'open';
    
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
        case 'freeChat':
          return { icon: 'chatbubbles-outline', type: 'Ionicons', color: '#4CAF50' };
        default:
          return { icon: 'chatbubble-outline', type: 'Ionicons', color: colors.textSecondary };
      }
    };
    
    const categoryIcon = getCategoryIcon();
    
    return (
      <View style={[styles.historyItem, { backgroundColor: colors.surface }]}>
        <TouchableOpacity
          style={styles.historyItemTouchable}
          onPress={() => viewConversation(item)}
        >
          <View style={styles.historyItemContent}>
            <View style={styles.historyItemHeader}>
              <View style={styles.categoryIconContainer}>
                {categoryIcon.type === 'Ionicons' ? (
                  <Ionicons name={categoryIcon.icon} size={20} color={categoryIcon.color} />
                ) : (
                  <MaterialCommunityIcons name={categoryIcon.icon} size={20} color={categoryIcon.color} />
                )}
              </View>
              <AppText style={[styles.historyItemMessage, { color: colors.textPrimary }]} numberOfLines={2}>
                {item.lastMessage || t.emptyState}
              </AppText>
              {(item.unreadForUser || 0) > 0 && (
                <View style={[styles.unreadBadge, { backgroundColor: colors.error }]}>
                  <MaterialCommunityIcons name="message-badge" size={16} color="white" />
                  <AppText style={styles.unreadBadgeText}>{item.unreadForUser}</AppText>
                </View>
              )}
              <View style={[
                styles.statusBadge,
                { backgroundColor: isOpen ? colors.success : colors.textSecondary }
              ]}>
                <AppText style={styles.statusBadgeText}>
                  {isOpen ? (language === 'en' ? 'Open' : language === 'he' ? 'פתוח' : 'مفتوح') : (language === 'en' ? 'Closed' : language === 'he' ? 'סגור' : 'مغلق')}
                </AppText>
              </View>
            </View>
            <AppText style={[styles.historyItemDate, { color: colors.textSecondary }]}>
              {formatDate(item.lastMessageAt)}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.historyHideButton}
          onPress={() => hideConversation(item.id)}
        >
          <Ionicons name="eye-off-outline" size={20} color={colors.error} />
        </TouchableOpacity>
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
        <GlobalHeader />
      </SafeAreaView>
    );
  }

  // History view
  if (showHistory) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar style={isDarkMode ? 'light' : 'dark'} />
        
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.historyHeader}
        >
          <TouchableOpacity onPress={toggleHistory} style={styles.historyBackButton}>
            <Ionicons name="arrow-back" size={24} color="white" />
            <AppText style={styles.historyBackText}>
              {language === 'en' ? 'Back' : language === 'he' ? 'חזור' : 'رجوع'}
            </AppText>
          </TouchableOpacity>
          <AppText style={styles.historyHeaderTitle}>{t.history}</AppText>
          <View style={{ width: 80 }} />
        </LinearGradient>
        
        {loadingHistory ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : closedConversations.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="chat-outline" size={64} color={colors.textSecondary} />
            <AppText style={[styles.emptyText, { color: colors.textSecondary }]}>
              {t.noHistory}
            </AppText>
          </View>
        ) : (
          <FlatList
            data={closedConversations}
            keyExtractor={(item) => item.id}
            renderItem={renderConversation}
            contentContainerStyle={styles.historyList}
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      
      {/* Header */}
      <LinearGradient
        colors={gradients.primary}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <AppText style={styles.headerTitle}>{t.title}</AppText>
        <TouchableOpacity onPress={toggleHistory} style={styles.historyButton}>
          <MaterialCommunityIcons name="history" size={22} color="white" />
          <AppText style={styles.historyButtonText}>{t.history}</AppText>
        </TouchableOpacity>
      </LinearGradient>
      
      {/* Main page with category dropdown and open conversations */}
      {(hasNoConversation || !conversationId) && !viewingClosedConversation ? (
        <ScrollView 
          style={styles.mainContainer} 
          contentContainerStyle={styles.mainContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        >
          {/* Category Dropdown Selector */}
          <View style={[styles.categoryDropdownContainer, { backgroundColor: colors.surface }]}>
            <TouchableOpacity
              style={styles.categoryDropdownButton}
              onPress={() => setShowCategoryDropdown(!showCategoryDropdown)}
            >
              <View style={styles.categoryDropdownContent}>
                {selectedCategory ? (
                  <>
                    {selectedCategory === 'bug' && <Ionicons name="bug-outline" size={20} color={colors.error} />}
                    {selectedCategory === 'opinion' && <MaterialCommunityIcons name="comment-text-outline" size={20} color="#9C27B0" />}
                    {selectedCategory === 'suggestion' && <Ionicons name="bulb-outline" size={20} color="#FF9800" />}
                    {selectedCategory === 'support' && <MaterialCommunityIcons name="account-tie-outline" size={20} color={colors.primary} />}
                    {selectedCategory === 'freeChat' && <Ionicons name="chatbubbles-outline" size={20} color="#4CAF50" />}
                    <AppText style={[styles.categoryDropdownText, { color: colors.textPrimary }]}>
                      {selectedCategory === 'bug' ? t.reportBug :
                       selectedCategory === 'opinion' ? t.opinion :
                       selectedCategory === 'suggestion' ? t.suggestion :
                       selectedCategory === 'support' ? t.technicalSupport :
                       t.freeChat}
                    </AppText>
                  </>
                ) : (
                  <>
                    <MaterialCommunityIcons name="format-list-bulleted" size={20} color={colors.textSecondary} />
                    <AppText style={[styles.categoryDropdownText, { color: colors.textSecondary }]}>
                      {t.selectCategory}
                    </AppText>
                  </>
                )}
              </View>
              <Ionicons
                name={showCategoryDropdown ? "chevron-up" : "chevron-down"}
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
            
            {showCategoryDropdown && (
              <View style={[styles.categoryDropdownList, { backgroundColor: colors.surface }]}>
                <TouchableOpacity
                  style={styles.categoryDropdownItem}
                  onPress={() => {
                    setSelectedCategory('bug');
                    setShowCategoryDropdown(false);
                    startNewConversation('bug');
                  }}
                >
                  <Ionicons name="bug-outline" size={20} color={colors.error} />
                  <AppText style={[styles.categoryDropdownItemText, { color: colors.textPrimary }]}>
                    {t.reportBug}
                  </AppText>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.categoryDropdownItem}
                  onPress={() => {
                    setSelectedCategory('opinion');
                    setShowCategoryDropdown(false);
                    startNewConversation('opinion');
                  }}
                >
                  <MaterialCommunityIcons name="comment-text-outline" size={20} color="#9C27B0" />
                  <AppText style={[styles.categoryDropdownItemText, { color: colors.textPrimary }]}>
                    {t.opinion}
                  </AppText>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.categoryDropdownItem}
                  onPress={() => {
                    setSelectedCategory('suggestion');
                    setShowCategoryDropdown(false);
                    startNewConversation('suggestion');
                  }}
                >
                  <Ionicons name="bulb-outline" size={20} color="#FF9800" />
                  <AppText style={[styles.categoryDropdownItemText, { color: colors.textPrimary }]}>
                    {t.suggestion}
                  </AppText>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.categoryDropdownItem}
                  onPress={() => {
                    setSelectedCategory('support');
                    setShowCategoryDropdown(false);
                    startNewConversation('support');
                  }}
                >
                  <MaterialCommunityIcons name="account-tie-outline" size={20} color={colors.primary} />
                  <AppText style={[styles.categoryDropdownItemText, { color: colors.textPrimary }]}>
                    {t.technicalSupport}
                  </AppText>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.categoryDropdownItem}
                  onPress={() => {
                    setSelectedCategory('freeChat');
                    setShowCategoryDropdown(false);
                    startNewConversation('freeChat');
                  }}
                >
                  <Ionicons name="chatbubbles-outline" size={20} color="#4CAF50" />
                  <AppText style={[styles.categoryDropdownItemText, { color: colors.textPrimary }]}>
                    {t.freeChat}
                  </AppText>
                </TouchableOpacity>
              </View>
            )}
          </View>
          
          {/* Open Conversations Section */}
          <View style={styles.openConversationsSection}>
            <AppText style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              {t.openChats}
            </AppText>
            
            {openConversations.filter(conv => conv.lastMessage && conv.lastMessage.trim()).length === 0 ? (
              <View style={styles.noOpenChatsContainer}>
                <MaterialCommunityIcons name="chat-outline" size={48} color={colors.textSecondary} />
                <AppText style={[styles.noOpenChatsText, { color: colors.textSecondary }]}>
                  {t.noOpenChats}
                </AppText>
              </View>
            ) : (
              <View>
                {openConversations.filter(conv => conv.lastMessage && conv.lastMessage.trim()).map((item) => (
                  <View key={item.id}>
                    {renderConversation({ item })}
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      ) : (
        <KeyboardAvoidingView 
          style={styles.chatContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
        {/* Template Form or Messages */}
        {showTemplateForm && selectedCategory ? (
          <View style={[styles.templateFormFullContainer, { backgroundColor: colors.background }]}>
            <View style={[styles.templateFormHeader, { backgroundColor: colors.surface }]}>
              <MaterialCommunityIcons name="form-textbox" size={24} color={colors.primary} />
              <AppText style={[styles.templateFormTitle, { color: colors.textPrimary }]}>
                {t.fillTemplate}
              </AppText>
            </View>
            
            <ScrollView style={styles.templateFormFullScroll} showsVerticalScrollIndicator={false}>
              {getTemplateQuestions(selectedCategory).map((question, index) => (
                <View key={index} style={styles.templateQuestionContainer}>
                  <AppText style={[styles.templateQuestion, { color: colors.textPrimary }]}>
                    {question}
                  </AppText>
                  <TextInput
                    style={[styles.templateInput, { 
                      backgroundColor: colors.surface, 
                      color: colors.textPrimary,
                      borderColor: colors.border || 'rgba(0,0,0,0.1)',
                    }]}
                    placeholder={t.answer}
                    placeholderTextColor={colors.textSecondary}
                    value={templateAnswers[index] || ''}
                    onChangeText={(text) => setTemplateAnswers(prev => ({ ...prev, [index]: text }))}
                    multiline
                    numberOfLines={3}
                  />
                </View>
              ))}
            </ScrollView>
            
            <View style={[styles.templateFormActions, { backgroundColor: colors.surface }]}>
              <TouchableOpacity
                style={[styles.templateSendButton, { backgroundColor: colors.primary, opacity: sending ? 0.5 : 1 }]}
                onPress={useTemplateAnswers}
                disabled={sending}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <>
                    <Ionicons name="send" size={20} color="white" />
                    <AppText style={styles.templateActionButtonText}>{t.sendMessage}</AppText>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="chat-processing-outline" size={64} color={colors.textSecondary} />
            <AppText style={[styles.emptyText, { color: colors.textSecondary }]}>
              {t.emptyState}
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
                onRefresh={refreshMessages}
                colors={[colors.primary]}
                tintColor={colors.primary}
              />
            }
          />
        )}
        
        {/* Input (only if not viewing closed or conversation is open, and not showing template form) */}
        {!viewingClosedConversation && conversationStatus === 'open' && !showTemplateForm && (
          <View style={[styles.inputContainer, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.sm }]}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundLight, color: colors.textPrimary }]}
              placeholder={t.placeholder}
              placeholderTextColor={colors.textSecondary}
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={1000}
            />
            <TouchableOpacity
              style={[styles.sendButton, { backgroundColor: colors.primary, opacity: message.trim() ? 1 : 0.5 }]}
              onPress={sendMessage}
              disabled={!message.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Ionicons name="send" size={20} color="white" />
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
      )}
      
      <GlobalHeader />
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
    paddingTop: Platform.OS === 'ios' ? spacing.xxl + 20 : spacing.xxl,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'ios' ? spacing.xxl + 20 : spacing.xxl,
  },
  historyBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  historyBackText: {
    color: 'white',
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  historyHeaderTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: 'white',
  },
  headerBackButton: {
    padding: spacing.xs,
  },
  headerTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: 'white',
  },
  historyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  historyButtonText: {
    color: 'white',
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  closedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  closedBannerText: {
    color: 'white',
    fontSize: typography.sm,
    fontWeight: typography.medium,
  },
  backButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.sm,
  },
  backButtonText: {
    color: 'white',
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  newConvButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.sm,
  },
  newConvButtonText: {
    color: 'white',
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  chatContainer: {
    flex: 1,
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
  messagesList: {
    padding: spacing.md,
  },
  messageContainer: {
    marginBottom: spacing.sm,
  },
  userMessageContainer: {
    alignItems: 'flex-end',
  },
  devMessageContainer: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    ...shadows.small,
  },
  userBubble: {
    borderBottomRightRadius: borderRadius.xs,
  },
  devBubble: {
    borderBottomLeftRadius: borderRadius.xs,
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
  startNewButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
  },
  startNewButtonText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.semibold,
  },
  historyList: {
    padding: spacing.md,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.md,
    ...shadows.small,
  },
  historyItemTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyHideButton: {
    padding: spacing.sm,
    marginLeft: spacing.sm,
  },
  historyItemContent: {
    flex: 1,
  },
  historyItemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  categoryIconContainer: {
    marginRight: spacing.xs,
    marginTop: 2,
  },
  historyItemMessage: {
    fontSize: typography.base,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
  },
  statusBadgeText: {
    color: 'white',
    fontSize: typography.xs,
    fontWeight: typography.semibold,
  },
  unreadBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    gap: 4,
  },
  unreadBadgeText: {
    color: 'white',
    fontSize: typography.xs,
    fontWeight: typography.bold,
  },
  historyItemDate: {
    fontSize: typography.sm,
  },
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  welcomeTitle: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  welcomeSubtitle: {
    fontSize: typography.base,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  categoryContainer: {
    width: '100%',
    marginBottom: spacing.lg,
  },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.md,
    gap: spacing.md,
    ...shadows.small,
  },
  categoryButtonSelected: {
    ...shadows.medium,
  },
  categoryText: {
    fontSize: typography.base,
    fontWeight: typography.medium,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
    ...shadows.medium,
  },
  startButtonText: {
    color: 'white',
    fontSize: typography.lg,
    fontWeight: typography.semibold,
  },
  // New styles for dropdown and open conversations
  mainContainer: {
    flex: 1,
  },
  mainContent: {
    padding: spacing.lg,
  },
  categoryDropdownContainer: {
    borderRadius: borderRadius.md,
    marginBottom: spacing.lg,
    ...shadows.small,
  },
  categoryDropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  categoryDropdownContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  categoryDropdownText: {
    fontSize: typography.base,
    fontWeight: typography.medium,
  },
  categoryDropdownList: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  categoryDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  categoryDropdownItemText: {
    fontSize: typography.base,
  },
  openConversationsSection: {
    marginTop: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    marginBottom: spacing.md,
  },
  noOpenChatsContainer: {
    alignItems: 'center',
    padding: spacing.xxl,
  },
  noOpenChatsText: {
    fontSize: typography.base,
    marginTop: spacing.md,
  },
  // Template Form Styles
  templateFormFullContainer: {
    flex: 1,
  },
  templateFormContainer: {
    maxHeight: 500,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
    ...shadows.medium,
  },
  templateFormHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  templateFormTitle: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    flex: 1,
  },
  templateFormFullScroll: {
    flex: 1,
    padding: spacing.lg,
  },
  templateFormScroll: {
    maxHeight: 350,
    padding: spacing.md,
  },
  templateQuestionContainer: {
    marginBottom: spacing.md,
  },
  templateQuestion: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
    marginBottom: spacing.xs,
  },
  templateInput: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: typography.base,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  templateFormActions: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
    ...shadows.medium,
  },
  templateActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  templateSendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
    ...shadows.medium,
  },
  templateActionButtonText: {
    color: 'white',
    fontSize: typography.base,
    fontWeight: typography.semibold,
  },
});

