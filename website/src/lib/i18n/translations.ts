export const locales = ["en", "he", "ar"] as const;
export type Locale = (typeof locales)[number];

export const languageLabels: Record<Locale, string> = {
  en: "English",
  he: "עברית",
  ar: "العربية",
};

export const rtlLocales: Locale[] = ["he", "ar"];

export const translations = {
  en: {
    common: {
      appName: "Smart-Job ERP",
      subtitle: "Cross-Platform Business Management System",
      login: "Login",
      register: "Register",
      dashboard: "Dashboard",
      logout: "Logout",
      loading: "Loading...",
      save: "Save",
      cancel: "Cancel",
      submit: "Submit",
      contact: "Contact",
      requestUpgrade: "Request upgrade",
      light: "Light",
      dark: "Dark",
    },
    nav: {
      home: "Home",
      features: "Features",
      solutions: "Solutions",
      pricing: "Pricing",
      security: "Security",
      docs: "Docs",
      contact: "Contact",
      privacy: "Privacy",
      terms: "Terms",
      hvac: "HVAC",
      fieldServices: "Field Services",
    },
    hero: {
      title: "Run jobs, teams, inventory, and documents from one ERP.",
      description:
        "Smart-Job ERP helps HVAC and field service companies track work orders, assign teams, and generate compliance documents in real time.",
      primaryCta: "Start onboarding",
      secondaryCta: "View pricing",
    },
  },
  he: {
    common: {
      appName: "Smart-Job ERP",
      subtitle: "מערכת ניהול עסק חוצת פלטפורמות",
      login: "התחברות",
      register: "הרשמה",
      dashboard: "לוח בקרה",
      logout: "התנתקות",
      loading: "טוען...",
      save: "שמור",
      cancel: "ביטול",
      submit: "שלח",
      contact: "צור קשר",
      requestUpgrade: "בקשת שדרוג",
      light: "בהיר",
      dark: "כהה",
    },
    nav: {
      home: "דף הבית",
      features: "יכולות",
      solutions: "פתרונות",
      pricing: "מחירים",
      security: "אבטחה",
      docs: "תיעוד",
      contact: "צור קשר",
      privacy: "פרטיות",
      terms: "תנאים",
      hvac: "HVAC",
      fieldServices: "שירותי שטח",
    },
    hero: {
      title: "נהלו עבודות, עובדים, מלאי ומסמכים במערכת אחת.",
      description:
        "Smart-Job ERP עוזרת לעסקי HVAC ושירותי שטח לנהל משימות, מלאי ותיעוד בזמן אמת.",
      primaryCta: "התחל תהליך קליטה",
      secondaryCta: "צפה במחירים",
    },
  },
  ar: {
    common: {
      appName: "Smart-Job ERP",
      subtitle: "نظام إدارة أعمال متعدد المنصات",
      login: "تسجيل الدخول",
      register: "إنشاء حساب",
      dashboard: "لوحة التحكم",
      logout: "تسجيل الخروج",
      loading: "جار التحميل...",
      save: "حفظ",
      cancel: "إلغاء",
      submit: "إرسال",
      contact: "تواصل معنا",
      requestUpgrade: "طلب ترقية",
      light: "فاتح",
      dark: "داكن",
    },
    nav: {
      home: "الرئيسية",
      features: "المزايا",
      solutions: "الحلول",
      pricing: "الأسعار",
      security: "الأمان",
      docs: "الوثائق",
      contact: "اتصل",
      privacy: "الخصوصية",
      terms: "الشروط",
      hvac: "HVAC",
      fieldServices: "الخدمات الميدانية",
    },
    hero: {
      title: "أدر الوظائف والفرق والمخزون والمستندات من منصة واحدة.",
      description:
        "Smart-Job ERP يساعد شركات HVAC والخدمات الميدانية على مزامنة المهام والوثائق بشكل فوري.",
      primaryCta: "ابدأ الإعداد",
      secondaryCta: "عرض الأسعار",
    },
  },
} as const;

type TranslationTree = typeof translations.en;
export type TranslationPath = `${keyof TranslationTree}.${string}`;

