export function getSupportTranslations(language: string) {
  if (language === 'en') {
    return {
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
      sendMessage: 'Send',
      fillTemplate: 'Fill out the template to help us understand your issue better',
      question1: 'Question 1',
      question2: 'Question 2',
      question3: 'Question 3',
      question4: 'Question 4',
      answer: 'Your answer...',
      openStatus: 'Open',
      closedStatus: 'Closed',
    };
  }

  if (language === 'he') {
    return {
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
      sendMessage: 'שלח',
      fillTemplate: 'מלא את התבנית כדי לעזור לנו להבין את הבעיה שלך',
      question1: 'שאלה 1',
      question2: 'שאלה 2',
      question3: 'שאלה 3',
      question4: 'שאלה 4',
      answer: 'התשובה שלך...',
      openStatus: 'פתוח',
      closedStatus: 'סגור',
    };
  }

  return {
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
    freeChat: 'دردشة حرة',
    sendMessage: 'إرسال',
    fillTemplate: 'املأ النموذج لمساعدتنا على فهم مشكلتك بشكل أفضل',
    question1: 'السؤال 1',
    question2: 'السؤال 2',
    question3: 'السؤال 3',
    question4: 'السؤال 4',
    answer: 'إجابتك...',
    openStatus: 'مفتوح',
    closedStatus: 'مغلق',
  };
}

export function getSupportTemplateQuestions(language: string, category: string | null) {
  const isEn = language === 'en';
  const isHe = language === 'he';

  switch (category) {
    case 'bug':
      return [
        isEn ? 'Where did you encounter the issue?' : isHe ? 'איפה נתקלת בבעיה?' : 'أين واجهت المشكلة؟',
        isEn ? 'What were you doing when it happened?' : isHe ? 'מה עשית כשזה קרה?' : 'ماذا كنت تفعل عندما حدث ذلك؟',
        isEn ? 'What error message did you see?' : isHe ? 'איזו הודעת שגיאה ראית?' : 'ما هي رسالة الخطأ التي رأيتها؟',
        isEn ? 'Please describe the issue:' : isHe ? 'נא לתאר את הבעיה:' : 'يرجى وصف المشكلة:',
      ];
    case 'opinion':
      return [
        isEn ? 'What do you think about the app?' : isHe ? 'מה אתה חושב על האפליקציה?' : 'ما رأيك في التطبيق؟',
        isEn ? 'What do you like most?' : isHe ? 'מה אהבת הכי הרבה?' : 'ما الذي أعجبك أكثر؟',
        isEn ? 'What could be improved?' : isHe ? 'מה ניתן לשפר?' : 'ما الذي يمكن تحسينه؟',
        isEn ? 'Your feedback:' : isHe ? 'המשוב שלך:' : 'ملاحظاتك:',
      ];
    case 'suggestion':
      return [
        isEn ? 'What feature would you like to see?' : isHe ? 'איזו תכונה תרצה לראות?' : 'ما الميزة التي تود رؤيتها؟',
        isEn ? 'How would it help you?' : isHe ? 'איך זה יעזור לך?' : 'كيف ستساعدك؟',
        isEn ? 'Your suggestion:' : isHe ? 'ההצעה שלך:' : 'اقتراحك:',
      ];
    case 'support':
      return [
        isEn ? 'What do you need help with?' : isHe ? 'במה אתה צריך עזרה?' : 'ما الذي تحتاج مساعدة فيه؟',
        isEn ? 'Please describe your issue in detail:' : isHe ? 'נא לתאר את הבעיה שלך בפירוט:' : 'يرجى وصف مشكلتك بالتفصيل:',
      ];
    default:
      return [];
  }
}

export function getSupportCategoryMeta(category: string | null, colors: any, t: ReturnType<typeof getSupportTranslations>) {
  switch (category) {
    case 'bug':
      return { icon: 'bug-outline', type: 'Ionicons', color: colors.error, label: t.reportBug };
    case 'opinion':
      return { icon: 'comment-text-outline', type: 'MaterialCommunityIcons', color: '#9C27B0', label: t.opinion };
    case 'suggestion':
      return { icon: 'bulb-outline', type: 'Ionicons', color: '#FF9800', label: t.suggestion };
    case 'support':
      return { icon: 'account-tie-outline', type: 'MaterialCommunityIcons', color: colors.primary, label: t.technicalSupport };
    case 'freeChat':
      return { icon: 'chatbubbles-outline', type: 'Ionicons', color: '#4CAF50', label: t.freeChat };
    default:
      return { icon: 'chatbubble-outline', type: 'Ionicons', color: colors.textSecondary, label: t.selectCategory };
  }
}
