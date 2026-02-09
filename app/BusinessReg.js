import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { db, auth, doc, getDoc, setDoc } from '../firebase';
import { getColors, shadows } from '../theme';
import { useLanguageContext } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { useAlert } from '../contexts/AlertContext';
import { Input, GlobalHeader, LoadingSpinner, ScrollableContainer } from '../components';
import { increment, updateDoc } from '@react-native-firebase/firestore';

export default function BusinessReg() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { language } = useLanguageContext();
  const { isDarkMode } = useThemeContext();
  const alert = useAlert();
  const colors = getColors(isDarkMode);
  
  // Get params from route
  const companyId = params.companyId;
  const userRole = params.userRole;

  const [loading, setLoading] = useState(false);
  
  // Required changeable fields
  const [heName, setHeName] = useState('');
  const [enName, setEnName] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  
  // Required non-changeable fields
  const [vatNumber, setVatNumber] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState('1');
  const [receiptNumber, setReceiptNumber] = useState('1');
  const [refundNumber, setRefundNumber] = useState('1');
  const [returnCertNumber, setReturnCertNumber] = useState('1');
  const [priceProposalNumber, setPriceProposalNumber] = useState('1');
  const [deliveryNoteNumber, setDeliveryNoteNumber] = useState('1');
  
  // Optional fields
  const [businessEmail, setBusinessEmail] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [businessFax, setBusinessFax] = useState('');
  
  // Optional accountant info
  const [accountantName, setAccountantName] = useState('');
  const [accountantEmail, setAccountantEmail] = useState('');
  const [accountantPhone, setAccountantPhone] = useState('');

  const t = language === 'en' ? {
    title: 'Business Registration',
    subtitle: 'Complete your business information to continue',
    requiredSection: 'Required Information',
    optionalSection: 'Optional Information',
    accountantSection: 'Accountant Information (Optional)',
    heName: 'Business Name (Hebrew)',
    enName: 'Business Name (English)',
    city: 'City',
    address: 'Business Address',
    vatNumber: 'VAT Number',
    businessType: 'Business Type',
    serialNumbers: 'Starting Serial Numbers',
    taxInvoice: 'Tax Invoice',
    receipt: 'Receipt',
    refund: 'Refund',
    returnCert: 'Return Certificate',
    priceProposal: 'Price Proposal',
    deliveryNote: 'Delivery Note',
    businessEmail: 'Business Email',
    businessPhone: 'Business Phone',
    businessFax: 'Business Fax',
    accountantName: 'Accountant Name',
    accountantEmail: 'Accountant Email',
    accountantPhone: 'Accountant Phone',
    accountantEmailNote: '(Used for monthly reports)',
    submit: 'Complete Registration',
    submitting: 'Saving...',
    fillRequired: 'Please fill all required fields',
    invalidVat: 'VAT number must be 9 digits',
    invalidEmail: 'Invalid email format',
    success: 'Business information saved successfully!',
    error: 'Failed to save business information',
  } : language === 'he' ? {
    title: 'רישום עסק',
    subtitle: 'השלם את פרטי העסק כדי להמשיך',
    requiredSection: 'מידע חובה',
    optionalSection: 'מידע רשות',
    accountantSection: 'פרטי רואה חשבון (רשות)',
    heName: 'שם העסק (עברית)',
    enName: 'שם העסק (אנגלית)',
    city: 'עיר',
    address: 'כתובת העסק',
    vatNumber: 'מספר עוסק מורשה',
    businessType: 'סוג העסק',
    serialNumbers: 'מספרים סידוריים התחלתיים',
    taxInvoice: 'חשבונית מס',
    receipt: 'קבלה',
    refund: 'זיכוי',
    returnCert: 'תעודת החזרה',
    priceProposal: 'הצעת מחיר',
    deliveryNote: 'תעודת משלוח',
    businessEmail: 'אימייל עסקי',
    businessPhone: 'טלפון עסקי',
    businessFax: 'פקס עסקי',
    accountantName: 'שם רואה חשבון',
    accountantEmail: 'אימייל רואה חשבון',
    accountantPhone: 'טלפון רואה חשבון',
    accountantEmailNote: '(ישמש לשליחת דוחות חודשיים)',
    submit: 'השלמת רישום',
    submitting: 'שומר...',
    fillRequired: 'אנא מלא את כל השדות החובה',
    invalidVat: 'מספר עוסק מורשה חייב להכיל 9 ספרות',
    invalidEmail: 'פורמט אימייל לא תקין',
    success: 'פרטי העסק נשמרו בהצלחה!',
    error: 'שגיאה בשמירת פרטי העסק',
  } : {
    title: 'تسجيل الأعمال',
    subtitle: 'أكمل معلومات عملك للمتابعة',
    requiredSection: 'معلومات مطلوبة',
    optionalSection: 'معلومات اختيارية',
    accountantSection: 'معلومات المحاسب (اختياري)',
    heName: 'اسم العمل (بالعبرية)',
    enName: 'اسم العمل (بالإنجليزية)',
    city: 'المدينة',
    address: 'عنوان العمل',
    vatNumber: 'رقم ضريبة القيمة المضافة',
    businessType: 'نوع العمل',
    serialNumbers: 'أرقام تسلسلية بدءًا',
    taxInvoice: 'فاتورة ضريبية',
    receipt: 'إيصال',
    refund: 'رد',
    returnCert: 'شهادة إرجاع',
    priceProposal: 'عرض سعر',
    deliveryNote: 'إشعار تسليم',
    businessEmail: 'البريد الإلكتروني للعمل',
    businessPhone: 'هاتف العمل',
    businessFax: 'فاكس العمل',
    accountantName: 'اسم المحاسب',
    accountantEmail: 'البريد الإلكتروني للمحاسب',
    accountantPhone: 'هاتف المحاسب',
    accountantEmailNote: '(يستخدم للتقارير الشهرية)',
    submit: 'إكمال التسجيل',
    submitting: 'جاري الحفظ...',
    fillRequired: 'يرجى ملء جميع الحقول المطلوبة',
    invalidVat: 'يجب أن يحتوي رقم ضريبة القيمة المضافة على 9 أرقام',
    invalidEmail: 'تنسيق البريد الإلكتروني غير صالح',
    success: 'تم حفظ معلومات العمل بنجاح!',
    error: 'فشل في حفظ معلومات العمل',
  };

  const validateEmail = (email) => {
    if (!email) return true; // Optional field
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateVatNumber = (vat) => {
    // Israeli VAT is 9 digits
    const vatRegex = /^\d{9}$/;
    return vatRegex.test(vat);
  };

  const handleSubmit = async () => {
    // Validate required fields
    if (!heName || !enName || !city || !address || !vatNumber || !businessType) {
      alert.warning(t.fillRequired, 'Please fill: Business Name (Hebrew/English), City, Address, VAT Number, Business Type');
      return;
    }

    // Validate VAT number
    if (!validateVatNumber(vatNumber)) {
      alert.error(t.invalidVat, 'VAT number must be exactly 9 digits');
      return;
    }

    // Validate emails if provided
    if (businessEmail && !validateEmail(businessEmail)) {
      alert.error(t.invalidEmail, 'Business email format is invalid');
      return;
    }
    if (accountantEmail && !validateEmail(accountantEmail)) {
      alert.error(t.invalidEmail, 'Accountant email format is invalid');
      return;
    }

    setLoading(true);
    try {
      // Get current user info
      const currentUser = auth.currentUser;
      const uid = currentUser ? currentUser.uid : 'unknown';
      
      // CRITICAL: Ensure user profile exists in Firestore BEFORE saving business_info
      // The Firestore rules check if profile exists to authorize business_info write
      const userProfileRef = doc(db, uid, 'profile');
      const userProfileSnap = await getDoc(userProfileRef);
      
      if (!userProfileSnap.exists()) {
        // Create profile if it doesn't exist
        console.log('Creating user profile in Firestore...');
        await setDoc(userProfileRef, {
          email: currentUser.email,
          role: userRole || 'user',
          companyId: companyId,
          createdAt: new Date().toISOString(),
        });
      } else {
        // Update profile to ensure companyId is set
        console.log('Updating user profile companyId...');
        await setDoc(userProfileRef, {
          companyId: companyId,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
      
      const businessData = {
        // Required changeable
        he_name: heName.trim(),
        en_name: enName.trim(),
        city: city.trim(),
        address: address.trim(),
        
        // Required non-changeable
        vat_number: vatNumber.trim(),
        business_type: businessType.trim(),
        
        // Serial numbers for different document types
        document_numbers: {
          taxInvoice: parseInt(taxInvoiceNumber) || 1,
          receipt: parseInt(receiptNumber) || 1,
          refund: parseInt(refundNumber) || 1,
          returnCertificate: parseInt(returnCertNumber) || 1,
          priceProposal: parseInt(priceProposalNumber) || 1,
          deliveryNote: parseInt(deliveryNoteNumber) || 1,
        },
        
        // Optional fields (only save if provided)
        ...(businessEmail && { business_email: businessEmail.trim() }),
        ...(businessPhone && { business_phone: businessPhone.trim() }),
        ...(businessFax && { business_fax: businessFax.trim() }),
        
        // Optional accountant info (only save if provided)
        ...(accountantName && { accountant_name: accountantName.trim() }),
        ...(accountantEmail && { accountant_email: accountantEmail.trim() }),
        ...(accountantPhone && { accountant_phone: accountantPhone.trim() }),
        
        // Metadata
        registered_at: new Date().toISOString(),
        registered_by: uid,
        registered_by_role: userRole || 'user',
        last_updated: new Date().toISOString(),
      };
      const businessInfoRef = doc(db, 'companies', companyId, 'business_data', 'business_info');
      await setDoc(businessInfoRef, businessData);
      try {
        if (userRole !== 'manager') {
          await updateDoc(doc(db, uid, 'cache'), {
            business_info: increment(1),
          });
        } else {
          await updateDoc(doc(db, 'companies', companyId, 'business_data', 'cache'), {
            business_info: increment(1),
          });
        }
      } catch (cacheError) {
        // Cache version bump is non-blocking for registration success.
        console.warn('Failed to increment business_info cache version:', cacheError?.message || cacheError);
      }

      alert.success(t.success, 'You can now use all app features');
      
      // Navigate based on role
      if (userRole === 'manager') {
        router.replace('/ManagerHomepage');
      } else if (userRole === 'basic') {
        router.replace('/BasicHomepage');
      } else {
        router.replace('/UserHomepage');
      }
    } catch (error) {
      console.error('Error saving business data:', error);
      alert.error(t.error, error.message || 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={['#0F2A4D', '#00ACC1']}
        style={styles.header}
      >
        <MaterialCommunityIcons name="office-building" size={60} color="white" />
        <Text style={styles.headerTitle}>{t.title}</Text>
        <Text style={styles.headerSubtitle}>{t.subtitle}</Text>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollableContainer style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          
          {/* Required Section */}
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <View style={styles.sectionHeader}>
              <Ionicons name="alert-circle" size={24} color={colors.error} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{t.requiredSection}</Text>
            </View>

            <Input
              label={t.heName + ' *'}
              value={heName}
              onChangeText={setHeName}
              placeholder="שם החברה"
              colors={colors}
            />
            <Input
              label={t.enName + ' *'}
              value={enName}
              onChangeText={setEnName}
              placeholder="Company Name"
              colors={colors}
            />
            <Input
              label={t.city + ' *'}
              value={city}
              onChangeText={setCity}
              placeholder="Tel Aviv"
              colors={colors}
            />
            <Input
              label={t.address + ' *'}
              value={address}
              onChangeText={setAddress}
              placeholder="123 Main Street"
              multiline
              numberOfLines={2}
              colors={colors}
            />
            <Input
              label={t.vatNumber + ' *'}
              value={vatNumber}
              onChangeText={setVatNumber}
              placeholder="123456789"
              keyboardType="numeric"
              maxLength={9}
              colors={colors}
            />
            <Input
              label={t.businessType + ' *'}
              value={businessType}
              onChangeText={setBusinessType}
              placeholder="HVAC Services, Plumbing, etc."
              colors={colors}
            />

            {/* Serial Numbers */}
            <Text style={[styles.subsectionTitle, { color: colors.text }]}>{t.serialNumbers}</Text>
            <View style={styles.serialNumbersGrid}>
              <View style={styles.serialNumberItem}>
                <Text style={[styles.serialNumberLabel, { color: colors.textSecondary }]}>
                  {t.taxInvoice}
                </Text>
                <Input
                  value={taxInvoiceNumber}
                  onChangeText={setTaxInvoiceNumber}
                  keyboardType="numeric"
                  placeholder="1"
                  colors={colors}
                />
              </View>
              <View style={styles.serialNumberItem}>
                <Text style={[styles.serialNumberLabel, { color: colors.textSecondary }]}>
                  {t.receipt}
                </Text>
                <Input
                  value={receiptNumber}
                  onChangeText={setReceiptNumber}
                  keyboardType="numeric"
                  placeholder="1"
                  colors={colors}
                />
              </View>
              <View style={styles.serialNumberItem}>
                <Text style={[styles.serialNumberLabel, { color: colors.textSecondary }]}>
                  {t.refund}
                </Text>
                <Input
                  value={refundNumber}
                  onChangeText={setRefundNumber}
                  keyboardType="numeric"
                  placeholder="1"
                  colors={colors}
                />
              </View>
              <View style={styles.serialNumberItem}>
                <Text style={[styles.serialNumberLabel, { color: colors.textSecondary }]}>
                  {t.returnCert}
                </Text>
                <Input
                  value={returnCertNumber}
                  onChangeText={setReturnCertNumber}
                  keyboardType="numeric"
                  placeholder="1"
                  colors={colors}
                />
              </View>
              <View style={styles.serialNumberItem}>
                <Text style={[styles.serialNumberLabel, { color: colors.textSecondary }]}>
                  {t.priceProposal}
                </Text>
                <Input
                  value={priceProposalNumber}
                  onChangeText={setPriceProposalNumber}
                  keyboardType="numeric"
                  placeholder="1"
                  colors={colors}
                />
              </View>
              <View style={styles.serialNumberItem}>
                <Text style={[styles.serialNumberLabel, { color: colors.textSecondary }]}>
                  {t.deliveryNote}
                </Text>
                <Input
                  value={deliveryNoteNumber}
                  onChangeText={setDeliveryNoteNumber}
                  keyboardType="numeric"
                  placeholder="1"
                  colors={colors}
                />
              </View>
            </View>
          </View>

          {/* Optional Section */}
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <View style={styles.sectionHeader}>
              <Ionicons name="information-circle-outline" size={24} color={colors.secondary} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{t.optionalSection}</Text>
            </View>

            <Input
              label={t.businessEmail}
              value={businessEmail}
              onChangeText={setBusinessEmail}
              placeholder="info@company.com"
              keyboardType="email-address"
              autoCapitalize="none"
              colors={colors}
            />
            <Input
              label={t.businessPhone}
              value={businessPhone}
              onChangeText={setBusinessPhone}
              placeholder="+972-50-1234567"
              keyboardType="phone-pad"
              colors={colors}
            />
            <Input
              label={t.businessFax}
              value={businessFax}
              onChangeText={setBusinessFax}
              placeholder="+972-3-1234567"
              keyboardType="phone-pad"
              colors={colors}
            />
          </View>

          {/* Accountant Section */}
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <View style={styles.sectionHeader}>
              <MaterialCommunityIcons name="account-tie" size={24} color={colors.secondary} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{t.accountantSection}</Text>
            </View>

            <Input
              label={t.accountantName}
              value={accountantName}
              onChangeText={setAccountantName}
              placeholder="John Doe"
              colors={colors}
            />
            <Input
              label={t.accountantEmail}
              value={accountantEmail}
              onChangeText={setAccountantEmail}
              placeholder="accountant@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              helperText={t.accountantEmailNote}
              colors={colors}
            />
            <Input
              label={t.accountantPhone}
              value={accountantPhone}
              onChangeText={setAccountantPhone}
              placeholder="+972-50-1234567"
              keyboardType="phone-pad"
              colors={colors}
            />
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={loading}
            style={styles.submitButtonWrapper}
          >
            <LinearGradient
              colors={loading ? ['#9CA3AF', '#9CA3AF'] : ['#0F2A4D', '#00ACC1']}
              style={styles.submitButton}
            >
              {loading ? (
                <LoadingSpinner size="small" color="white" />
              ) : (
                <>
                  <MaterialCommunityIcons name="check-circle" size={24} color="white" />
                  <Text style={styles.submitButtonText}>
                    {loading ? t.submitting : t.submit}
                  </Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </ScrollableContainer>
      </KeyboardAvoidingView>

      <GlobalHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 70 : 50,
    paddingBottom: 30,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: 'white',
    marginTop: 16,
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 8,
    textAlign: 'center',
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
  section: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    ...shadows.card,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 12,
  },
  serialNumbersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  serialNumberItem: {
    flex: 1,
    minWidth: '45%',
  },
  serialNumberLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  submitButtonWrapper: {
    marginTop: 20,
    marginBottom: 20,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 20,
    borderRadius: 16,
    ...shadows.primary,
  },
  submitButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
