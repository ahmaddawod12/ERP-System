import sanitizeHtml from 'sanitize-html';

/**
 * HTML Template Generator Module
 * Generates professional HTML templates for PDF documents
 */

/**
 * Helper function to sanitize user input
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return String(input || '');
  }
  
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'escape',
  });
}

/**
 * Sanitize a URL to prevent XSS via javascript: or data: schemes.
 * Only allows https://, http://, and root-relative (/) URLs.
 */
function sanitizeUrl(url: unknown): string {
  if (typeof url !== 'string' || url.trim() === '') return '';
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) {
    return trimmed;
  }
  return '';
}

/**
 * Parse amount to cents
 */
function parseAmountToCents(value, fieldName = 'amount') {
  const num = Number(value);
  
  if (isNaN(num) || !isFinite(num)) {
    throw new Error(`${fieldName} must be a valid number`);
  }
  
  if (num < 0) {
    throw new Error(`${fieldName} cannot be negative`);
  }
  
  return Math.round(num * 100);
}

function formatCentsToAmount(cents) {
  return (cents / 100).toFixed(2);
}

/**
 * Document Type Codes (numeric) — mirrors @smart-job/contracts DOC_TYPE.
 * Kept local because this Cloud Run service is deployed via Docker without
 * access to the monorepo's file: dependency.  Keep in sync with contracts.
 *
 * 10 = Price Proposal (הצעת מחיר)
 * 200 = Delivery Note (תעודת משלוח)
 * 210 = Return Certificate (תעודת החזרה)
 * 305 = Tax Invoice (חשבונית מס)
 * 330 = Refund (זיכוי)
 * 400 = Receipt (קבלה)
 */
const DOC_TYPE = {
  PRICE_PROPOSAL: 10,
  DELIVERY_NOTE: 200,
  RETURN_CERTIFICATE: 210,
  TAX_INVOICE: 305,
  REFUND: 330,
  RECEIPT: 400
};

/** Israel VAT rate — mirrors @smart-job/contracts VAT_RATE. Keep in sync. */
const VAT_RATE = 0.18;

/**
 * Generate HTML template for documents
 */
function generateDocumentHTML(documentData) {
  const { 
    type, client, items, company, language = 'he', documentNumber, date, notes, logoUrl, 
    invoiceReference, paymentMethod,
    confirmationNumber, // Tax Authority confirmation number (מספר הקצאה) for tax invoices
  } = documentData;
  
  // Convert type to number if it's a string (for backwards compatibility during transition)
  const numericType = typeof type === 'number' ? type : Number(type);
  
  // Force Hebrew for all business documents.
  // Israeli tax regulations require Hebrew on official documents.
  // The en/ar label tables below are retained for future multi-language support
  // if non-tax documents (e.g. internal reports) are added later.
  const effectiveLanguage = 'he';
  const isPriceProposal = numericType === DOC_TYPE.PRICE_PROPOSAL;
  const isTaxInvoice = numericType === DOC_TYPE.TAX_INVOICE;
  const isReturnCertificate = numericType === DOC_TYPE.RETURN_CERTIFICATE;
  const isRefund = numericType === DOC_TYPE.REFUND;
  const isReceipt = numericType === DOC_TYPE.RECEIPT;
  const isDeliveryNote = numericType === DOC_TYPE.DELIVERY_NOTE;
  
  // Document type titles (keyed by numeric type)
  const titles = {
    [DOC_TYPE.TAX_INVOICE]: { he: 'חשבונית מס', en: 'Tax Invoice', ar: 'فاتورة ضريبية' },
    [DOC_TYPE.PRICE_PROPOSAL]: { he: 'הצעת מחיר', en: 'Price Proposal', ar: 'عرض سعر' },
    [DOC_TYPE.REFUND]: { he: 'זיכוי', en: 'Refund', ar: 'رد' },
    [DOC_TYPE.RETURN_CERTIFICATE]: { he: 'תעודת החזרה', en: 'Return Certificate', ar: 'شهادة إرجاع' },
    [DOC_TYPE.RECEIPT]: { he: 'קבלה', en: 'Receipt', ar: 'إيصال' },
    [DOC_TYPE.DELIVERY_NOTE]: { he: 'תעודת משלוח', en: 'Delivery Note', ar: 'إشعار تسليم' }
  };

  const labels = {
    he: {
      documentNumber: 'מספר מסמך',
      date: 'תאריך',
      clientDetails: 'פרטי לקוח',
      name: 'שם',
      email: 'דוא"ל',
      phone: 'טלפון',
      address: 'כתובת',
      city: 'עיר',
      vatNumber: 'מספר עוסק מורשה',
      businessType: 'סוג העסק',
      fax: 'פקס',
      items: 'פריטים',
      description: 'תיאור',
      quantity: 'כמות',
      price: 'מחיר',
      total: 'סה"כ',
      subtotal: 'סכום ביניים',
      vat: 'מע"מ (18%)',
      grandTotal: 'סה"כ לתשלום',
      notes: 'הערות',
      serviceDescription: 'תיאור השירות',
      companyDetails: 'פרטי החברה',
      invoiceReference: 'מספר חשבונית',
      paymentMethod: 'אמצעי תשלום',
      amountReceived: 'סכום שהתקבל',
      deliveryAddress: 'כתובת למשלוח',
      itemName: 'שם הפריט',
      unit: 'יחידה'
    },
    en: {
      documentNumber: 'Document Number',
      date: 'Date',
      clientDetails: 'Client Details',
      name: 'Name',
      email: 'Email',
      phone: 'Phone',
      address: 'Address',
      city: 'City',
      vatNumber: 'VAT Number',
      businessType: 'Business Type',
      fax: 'Fax',
      items: 'Items',
      description: 'Description',
      quantity: 'Quantity',
      price: 'Price',
      total: 'Total',
      subtotal: 'Subtotal',
      vat: 'VAT (18%)',
      grandTotal: 'Grand Total',
      notes: 'Notes',
      companyDetails: 'Company Details',
      invoiceReference: 'Invoice Number',
      paymentMethod: 'Payment Method',
      amountReceived: 'Amount Received',
      deliveryAddress: 'Delivery Address',
      itemName: 'Item Name',
      unit: 'Unit'
    },
    ar: {
      documentNumber: 'رقم الوثيقة',
      date: 'التاريخ',
      clientDetails: 'تفاصيل العميل',
      name: 'الاسم',
      email: 'البريد الإلكتروني',
      phone: 'الهاتف',
      address: 'العنوان',
      city: 'المدينة',
      vatNumber: 'رقم ضريبة القيمة المضافة',
      businessType: 'نوع العمل',
      fax: 'الفاكس',
      items: 'العناصر',
      description: 'الوصف',
      quantity: 'الكمية',
      price: 'السعر',
      total: 'المجموع',
      subtotal: 'المجموع الفرعي',
      vat: 'ضريبة القيمة المضافة (18%)',
      grandTotal: 'المجموع الإجمالي',
      notes: 'ملاحظات',
      companyDetails: 'تفاصيل الشركة',
      invoiceReference: 'رقم الفاتورة',
      paymentMethod: 'طريقة الدفع',
      amountReceived: 'المبلغ المستلم',
      deliveryAddress: 'عنوان التوصيل',
      itemName: 'اسم العنصر',
      unit: 'الوحدة'
    }
  };

  const t = labels[effectiveLanguage] || labels.he;
  const docTitle = titles[numericType] ? titles[numericType][effectiveLanguage] : titles[DOC_TYPE.TAX_INVOICE][effectiveLanguage];
  const isRTL = effectiveLanguage === 'he' || effectiveLanguage === 'ar';

  // Sanitize all text inputs to prevent XSS
  const sanitizedClient = {
    name: sanitizeInput(client.name),
    email: sanitizeInput(client.email || ''),
    phone: sanitizeInput(client.phone || ''),
    address: sanitizeInput(client.address || ''),
    vatNumber: sanitizeInput(client.clientVatNumber || client.vatNumber || ''), // Client VAT number
  };
  
  // Sanitize confirmation number for tax invoices
  const sanitizedConfirmationNumber = sanitizeInput(confirmationNumber || '');
  
  const sanitizedCompany = {
    name: sanitizeInput(company.name),
    nameHe: sanitizeInput(company.nameHe || ''),
    nameEn: sanitizeInput(company.nameEn || ''),
    email: sanitizeInput(company.email || ''),
    phone: sanitizeInput(company.phone || ''),
    fax: sanitizeInput(company.fax || ''),
    address: sanitizeInput(company.address || ''),
    city: sanitizeInput(company.city || ''),
    vatNumber: sanitizeInput(company.vatNumber || ''),
    businessType: sanitizeInput(company.businessType || ''),
  };
  
  const sanitizedNotes = sanitizeInput(notes || '');
  const sanitizedDocNumber = sanitizeInput(documentNumber || 'N/A');

  // Calculate totals using integer cents arithmetic to avoid floating point errors
  // Delivery notes now include prices (same as other documents)
  let subtotalCents = 0;
  const sanitizedItems = items.map(item => {
    const quantityCents = parseAmountToCents(item.quantity, 'quantity');
    const priceCents = parseAmountToCents(item.price || 0, 'price');
    const itemTotalCents = Math.round((quantityCents / 100) * priceCents);
    subtotalCents += itemTotalCents;
    
    return {
      description: sanitizeInput(item.description),
      quantity: item.quantity,
      price: item.price || 0,
      priceCents: priceCents,
      totalCents: itemTotalCents,
      partId: item.partId ? sanitizeInput(item.partId) : null,
    };
  });
  
  const vatCents = Math.round(subtotalCents * VAT_RATE);
  const grandTotalCents = subtotalCents + vatCents;
  
  // Convert back to display amounts
  const subtotal = formatCentsToAmount(subtotalCents);
  const vatAmount = formatCentsToAmount(vatCents);
  const grandTotal = formatCentsToAmount(grandTotalCents);

  // P1-10: Locale-aware currency symbol
  const currencySymbol = '₪'; // ILS — Israeli businesses
  const dirAttr = isRTL ? 'rtl' : 'ltr';
  const localeTag = effectiveLanguage === 'he' ? 'he-IL' : effectiveLanguage === 'ar' ? 'ar-IL' : 'en-IL';

  // Generate uniform HTML template for all document types
  return `
<!DOCTYPE html>
<html lang="${effectiveLanguage}" dir="${dirAttr}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${docTitle}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    @page {
      size: A4;
      margin: 15mm;
    }
    
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      direction: ${dirAttr};
      background: white;
      color: #000;
      font-size: 11px;
      line-height: 1.4;
    }
    
    .document {
      max-width: 210mm;
      margin: 0 auto;
      background: white;
      padding: 8mm;
    }
    
    /* Header Section */
    .header {
      width: 100%;
      display: table;
      padding-bottom: 15px;
      margin-bottom: 15px;
      border-bottom: 2px solid #000;
    }
    
    .info-sections {
      display: table-cell;
      width: 70%;
      vertical-align: top;
      text-align: right;
    }
    
    .sender-info-section, .client-info-section {
      width: 100%;
      margin-bottom: 15px;
    }
    
    .sender-info-section h3, .client-info-section h3 {
      font-size: 14px;
      font-weight: bold;
      color: #000;
      margin-bottom: 8px;
    }
    
    .client-info-section {
      padding-top: 15px;
      border-top: 1px solid #ccc;
    }
    
    .info-row {
      margin-bottom: 4px;
      font-size: 10px;
      text-align: right;
    }
    
    .info-row .label {
      font-weight: bold;
      color: #000;
      display: inline-block;
      min-width: 90px;
    }
    
    .info-row .value {
      color: #333;
      display: inline;
    }
    
    .company-logo-section {
      display: table-cell;
      width: 30%;
      vertical-align: top;
      text-align: left;
      padding-left: 20px;
    }
    
    .company-logo {
      width: 120px;
      height: 120px;
      border: 2px solid #333;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #fafafa;
    }
    
    .company-logo img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    
    .company-logo-text {
      font-size: 10px;
      color: #888;
      text-align: center;
      line-height: 1.3;
    }
    
    /* Document Title */
    .document-title {
      width: 100%;
      margin: 15px 0 20px 0;
      padding-bottom: 10px;
      border-bottom: 2px solid #000;
      position: relative;
      text-align: center;
    }
    
    .document-title h1 {
      font-size: 28px;
      font-weight: bold;
      color: #000;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin: 0;
      padding: 0;
    }
    
    .document-date {
      position: absolute;
      left: 0;
      top: 5px;
      font-size: 10px;
      color: #555;
    }
    
    /* Items Table */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
      border: 1.5px solid #666;
    }
    
    table th {
      background: #2a2a2a;
      color: #fff;
      padding: 10px 8px;
      text-align: right;
      font-weight: bold;
      font-size: 11px;
      border: 1px solid #666;
    }
    
    table td {
      padding: 8px;
      border: 1px solid #ccc;
      text-align: right;
      font-size: 10px;
      background: white;
    }
    
    table tbody tr:nth-child(even) td {
      background: #f8f8f8;
    }
    
    /* Totals Section */
    .totals {
      margin-top: 15px;
      margin-right: auto;
      width: 280px;
      border: 1.5px solid #555;
    }
    
    .totals .row {
      display: table;
      width: 100%;
      padding: 8px 12px;
      border-bottom: 1px solid #bbb;
      font-size: 11px;
      background: white;
    }
    
    .totals .row span:first-child {
      display: table-cell;
      text-align: right;
    }
    
    .totals .row span:last-child {
      display: table-cell;
      text-align: left;
    }
    
    .totals .row:last-child {
      border-bottom: none;
    }
    
    .totals .row.subtotal {
      background: #f8f8f8;
    }
    
    .totals .row.vat {
      background: #f8f8f8;
    }
    
    .totals .row.grand-total {
      background: white;
      color: #000;
      font-weight: bold;
      font-size: 14px;
      padding: 12px;
      border-top: 2px solid #000;
    }
    
    .totals .row.grand-total .amount {
      font-size: 16px;
      font-weight: bold;
    }
    
    /* Notes Section */
    .notes {
      margin-top: 20px;
      padding: 12px;
      border: 1.5px solid #333;
      background: #fafafa;
    }
    
    .notes h3 {
      color: #000;
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: bold;
    }
    
    .notes p {
      line-height: 1.6;
      color: #333;
      font-size: 10px;
    }
    
    /* Footer */
    .footer {
      margin-top: 30px;
      text-align: center;
      color: #666;
      font-size: 8px;
      padding-top: 15px;
      border-top: 1px solid #999;
    }
    
    .footer p {
      margin: 3px 0;
    }
    
    .footer .brand {
      font-weight: bold;
      color: #000;
    }
  </style>
</head>
<body>
  <div class="document">
    <!-- Header -->
    <div class="header">
      <!-- Info Sections (Right side) -->
      <div class="info-sections">
        <!-- Sender Information -->
        <div class="sender-info-section">
          <h3>מאת</h3>
          <div class="info-row">
            <span class="label">שם החברה:</span>
            <span class="value">${sanitizedCompany.nameHe || sanitizedCompany.nameEn || sanitizedCompany.name || 'לא צוין'}</span>
          </div>
          <div class="info-row">
            <span class="label">ע.מ:</span>
            <span class="value">${sanitizedCompany.vatNumber || 'לא צוין'}</span>
          </div>
          <div class="info-row">
            <span class="label">טלפון:</span>
            <span class="value">${sanitizedCompany.phone || 'לא צוין'}</span>
          </div>
          <div class="info-row">
            <span class="label">דוא"ל:</span>
            <span class="value">${sanitizedCompany.email || 'לא צוין'}</span>
          </div>
          ${sanitizedCompany.fax ? `
          <div class="info-row">
            <span class="label">פקס:</span>
            <span class="value">${sanitizedCompany.fax}</span>
          </div>` : ''}
          <div class="info-row">
            <span class="label">כתובת:</span>
            <span class="value">${[sanitizedCompany.address, sanitizedCompany.city].filter(Boolean).join(', ') || 'לא צוין'}</span>
          </div>
          ${sanitizedCompany.businessType ? `
          <div class="info-row">
            <span class="label">סוג העסק:</span>
            <span class="value">${sanitizedCompany.businessType}</span>
          </div>` : ''}
        </div>
        
        <!-- Client Information -->
        <div class="client-info-section">
          <h3>לכבוד</h3>
          <div class="info-row">
            <span class="label">שם הלקוח:</span>
            <span class="value">${sanitizedClient.name || 'לא צוין'}</span>
          </div>
          ${sanitizedClient.phone ? `
          <div class="info-row">
            <span class="label">טלפון:</span>
            <span class="value">${sanitizedClient.phone}</span>
          </div>` : ''}
          ${sanitizedClient.email ? `
          <div class="info-row">
            <span class="label">דוא"ל:</span>
            <span class="value">${sanitizedClient.email}</span>
          </div>` : ''}
          ${sanitizedClient.address ? `
          <div class="info-row">
            <span class="label">כתובת:</span>
            <span class="value">${sanitizedClient.address}</span>
          </div>` : ''}
          ${sanitizedClient.vatNumber ? `
          <div class="info-row">
            <span class="label">ע.מ לקוח:</span>
            <span class="value">${sanitizedClient.vatNumber}</span>
          </div>` : ''}
        </div>
      </div>
      
      <!-- Company Logo (Left side) -->
      <div class="company-logo-section">
        <div class="company-logo">
          ${sanitizeUrl(logoUrl) ? `<img src="${sanitizeUrl(logoUrl)}" alt="לוגו החברה" />` : `
          <div class="company-logo-text">
            לוגו החברה<br>
            120x120
          </div>`}
        </div>
      </div>
    </div>
    
    <!-- Document Title -->
    <div class="document-title">
      <h1>${docTitle} - ${sanitizedDocNumber}</h1>
      ${isTaxInvoice ? `
      <div class="confirmation-number" style="text-align: center; margin-top: 8px; font-size: 14px; color: #333;">
        <strong>מספר הקצאה:</strong> ${sanitizedConfirmationNumber || ''}
      </div>` : ''}
      <div class="document-date">
        <strong>תאריך:</strong> ${date || new Date().toLocaleDateString('he-IL')}
      </div>
    </div>
    
    ${isReceipt && invoiceReference ? `
    <!-- Receipt Invoice Reference -->
    <div class="receipt-reference" style="margin: 15px 0; padding: 12px; background: #f0f0f0; border: 1px solid #ccc; border-radius: 4px;">
      <div class="info-row">
        <span class="label" style="font-weight: bold;">עבור חשבונית מספר:</span>
        <span class="value" style="font-size: 14px; font-weight: bold;">${sanitizeInput(invoiceReference)}</span>
      </div>
      ${paymentMethod ? `
      <div class="info-row" style="margin-top: 8px;">
        <span class="label" style="font-weight: bold;">${t.paymentMethod}:</span>
        <span class="value">${sanitizeInput(paymentMethod)}</span>
      </div>` : ''}
    </div>` : ''}
    
    <!-- Items Table -->
    <table>
      <thead>
        <tr>
          ${sanitizedItems.some(item => item.partId) ? `<th style="width: 15%;">${t.itemName || t.description}</th>` : ''}
          <th style="${sanitizedItems.some(item => item.partId) ? 'width: 35%;' : 'width: 50%;'}">${t.description}</th>
          <th style="width: 15%;">${t.quantity}</th>
          <th style="width: 17.5%;">${t.price}</th>
          <th style="width: 17.5%;">${t.total}</th>
        </tr>
      </thead>
      <tbody>
        ${sanitizedItems.map(item => `
        <tr>
          ${sanitizedItems.some(i => i.partId) ? `<td>${item.partId || '-'}</td>` : ''}
          <td>${item.description}</td>
          <td>${item.quantity}</td>
          <td>${currencySymbol}${Number(item.price).toFixed(2)}</td>
          <td>${currencySymbol}${formatCentsToAmount(item.totalCents)}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
    
    <!-- Totals -->
    <div class="totals">
      <div class="row subtotal">
        <span><strong>${t.subtotal}:</strong></span>
        <span>${currencySymbol}${subtotal}</span>
      </div>
      <div class="row vat">
        <span><strong>${t.vat}:</strong></span>
        <span>${currencySymbol}${vatAmount}</span>
      </div>
      <div class="row grand-total">
        <span><strong>${isReceipt ? (t.amountReceived || t.grandTotal) + ':' : isDeliveryNote ? t.grandTotal + ':' : t.grandTotal + ':'}</strong></span>
        <span class="amount">${currencySymbol}${grandTotal}</span>
      </div>
    </div>
    
    ${sanitizedNotes ? `
    <!-- Notes -->
    <div class="notes">
      <h3>${t.notes}</h3>
      <p>${sanitizedNotes}</p>
    </div>` : ''}
    
    <!-- Footer -->
    <div class="footer">
      <p><span class="brand">Smart-Job</span> - מערכת ניהול עבודות מקצועית</p>
      <p>נוצר בתאריך: ${new Date().toLocaleString(localeTag, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
    </div>
  </div>
</body>
</html>
  `;
}
export default generateDocumentHTML;
