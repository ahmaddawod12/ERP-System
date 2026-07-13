import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { DOC_TYPE, DOC_LABELS, getDocumentLabel } from '@smart-job/contracts';

/**
 * Escape a string for safe interpolation into HTML text content.
 */
function escapeHtml(input: unknown): string {
  const raw = String(input ?? '');
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strip control characters that could be used for email-header injection.
 * Allows printable ASCII plus common Unicode, but removes CR, LF, TAB,
 * null bytes, and other header-control characters.
 */
function sanitizeEmailHeaderValue(input: unknown): string {
  const raw = String(input ?? '');
  return raw
    .replace(/[\x00-\x1F\x7F]/g, '') // C0 control + DEL
    .replace(/[\u200E\u200F\u202A-\u202E]/g, '') // bidirectional override characters
    .trim();
}

const EMAIL_ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmailAddress(email: unknown, label: string): string {
  const raw = String(email ?? '');
  const cleaned = sanitizeEmailHeaderValue(raw);
  if (!EMAIL_ADDRESS_RE.test(cleaned)) {
    throw new Error(`Invalid ${label} email address: ${raw}`);
  }
  return cleaned;
}

/**
 * Email Service Module for Smart-Job PDF Service
 * 
 * Uses Amazon SES (Simple Email Service) for document email delivery.
 * 
 * Configuration via environment variables:
 * - AWS_REGION: AWS region for SES (default: 'eu-west-1')
 * - AWS_ACCESS_KEY_ID: AWS access key
 * - AWS_SECRET_ACCESS_KEY: AWS secret key
 * 
 * Email sender/receiver configuration:
 * - Sender Email: businessInfo.business_email from document
 * - Sender Name: businessInfo.business_name from document
 * - Receiver: client.email from document
 */


// ============================================================================
// AMAZON SES EMAIL SERVICE
// ============================================================================

/**
 * Amazon SES Email Service
 * 
 * Uses AWS SDK v3 for Amazon Simple Email Service.
 * 
 * Setup:
 * 1. Enable SES in your AWS region (eu-west-1)
 * 2. Verify sender email/domain in SES console
 * 3. Request production access (move out of sandbox)
 * 4. Configure AWS credentials as environment variables
 */
class AmazonSESEmailService {
  enabled: boolean;
  client: any;
  constructor() {
    const region = process.env.AWS_REGION || 'eu-west-1';
    
    // Check if AWS credentials are available (from Secret Manager via Cloud Run)
    const hasCredentials = (
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    );
    
    if (!hasCredentials) {
      console.warn('[SES] AWS credentials not configured - email sending disabled');
      this.enabled = false;
    } else {
      this.client = new SESClient({ 
        region,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
      });
      this.enabled = true;
      console.log('[SES] Email service initialized', { region });
    }
  }

  /**
   * Send document email via Amazon SES
   * 
   * @param {Object} options - Email options
   * @param {string} options.recipientEmail - Recipient email address (client email)
   * @param {string} options.recipientName - Recipient name
   * @param {string} options.documentTitle - Email subject (document title)
   * @param {string} options.documentUrl - PDF download URL
   * @param {string} options.language - Document language ('he' | 'en' | 'ar')
   * @param {Object} options.businessInfo - Business information
   * @param {string} options.businessInfo.business_email - Verified sender email
   * @param {string} options.businessInfo.business_name - Sender name
   * @returns {Promise<Object>} Send result with messageId
   */
  async sendDocumentEmail({
    recipientEmail,
    recipientName,
    documentTitle,
    documentUrl,
    language = 'he',
    businessInfo = {} as any
  }) {
    if (!this.enabled) {
      throw new Error('SES email service is not enabled - check AWS credentials');
    }

    if (!recipientEmail) {
      throw new Error('Recipient email is required');
    }

    if (!businessInfo.email) {
      throw new Error('Business email (sender) is required in businessInfo');
    }

    // Sender configuration from business info — sanitize to prevent header injection.
    const senderEmail = validateEmailAddress(businessInfo.email, 'sender');
    const senderName = sanitizeEmailHeaderValue(businessInfo.name || 'Smart-Job');
    const recipient = validateEmailAddress(recipientEmail, 'recipient');
    const fromAddress = `${senderName} <${senderEmail}>`;
    console.log('[SES] Preparing to send email', {
      to: recipient ? `***@${recipient.split('@')[1] || '?'}` : '(none)',
      from: senderName,
      documentTitle,
      language
    });

    // Generate email content
    const { htmlBody, textBody } = this.generateEmailContent({
      recipientName,
      documentTitle,
      documentUrl,
      language,
      businessName: senderName
    });
    console.log('[SES] Email content generated');
    // Prepare SES send command
    const command = new SendEmailCommand({
      Source: fromAddress,
      Destination: {
        ToAddresses: [recipient]
      },
      ReplyToAddresses: [senderEmail],
      Message: {
        Subject: {
          Data: `${documentTitle} - Smart-Job`,
          Charset: 'UTF-8'
        },
        Body: {
          Html: {
            Data: htmlBody,
            Charset: 'UTF-8'
          },
          Text: {
            Data: textBody,
            Charset: 'UTF-8'
          }
        }
      }
    });

    try {
      const response = await this.client.send(command);
      console.log('[SES] Email sent successfully', {
        messageId: response.MessageId,
        to: recipientEmail ? `***@${recipientEmail.split('@')[1] || '?'}` : '(none)',
        from: senderName
      });

      return {
        success: true,
        messageId: response.MessageId,
        provider: 'ses'
      };
    } catch (error) {
      console.error('[SES] Failed to send email:', error);
      throw new Error(`SES email delivery failed: ${error.message}`);
    }
  }

  /**
   * Generate email HTML and text content
   * Supports Hebrew, English, and Arabic
   */
  generateEmailContent({ recipientName, documentTitle, documentUrl, language, businessName }) {
    const safeRecipientName = escapeHtml(recipientName);
    const safeBusinessName = escapeHtml(businessName);
    const safeDocumentTitle = escapeHtml(documentTitle);
    const safeDocumentUrl = escapeHtml(documentUrl);

    const greetings = {
      he: safeRecipientName ? `שלום ${safeRecipientName}` : 'שלום',
      en: safeRecipientName ? `Hello ${safeRecipientName}` : 'Hello',
      ar: safeRecipientName ? `مرحبا ${safeRecipientName}` : 'مرحبا'
    };

    const messages = {
      he: 'המסמך שלך מוכן להורדה',
      en: 'Your document is ready for download',
      ar: 'وثيقتك جاهزة للتنزيل'
    };

    const downloadButtons = {
      he: 'הורד מסמך',
      en: 'Download Document',
      ar: 'تحميل المستند'
    };

    const footers = {
      he: `תודה שבחרת ב-${safeBusinessName}`,
      en: `Thank you for choosing ${safeBusinessName}`,
      ar: `شكرا لاختيارك ${safeBusinessName}`
    };

    const greeting = greetings[language] || greetings.he;
    const message = messages[language] || messages.he;
    const downloadButton = downloadButtons[language] || downloadButtons.he;
    const footer = footers[language] || footers.he;

    const direction = (language === 'he' || language === 'ar') ? 'rtl' : 'ltr';

    // HTML Body
    const htmlBody = `
<!DOCTYPE html>
<html dir="${direction}" lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeDocumentTitle}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background-color: #f4f4f4;
      margin: 0;
      padding: 20px;
      direction: ${direction};
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background: linear-gradient(135deg, #0F2A4D 0%, #00ACC1 100%);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    .email-header {
      background-color: rgba(255, 255, 255, 0.1);
      padding: 30px 20px;
      text-align: center;
    }
    .email-header h1 {
      color: white;
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .email-body {
      background-color: white;
      padding: 40px 30px;
      text-align: center;
    }
    .greeting {
      font-size: 20px;
      color: #0F2A4D;
      margin-bottom: 10px;
      font-weight: 600;
    }
    .message {
      font-size: 16px;
      color: #555;
      margin-bottom: 30px;
      line-height: 1.6;
    }
    .document-title {
      font-size: 18px;
      color: #00ACC1;
      margin-bottom: 30px;
      font-weight: 600;
    }
    .download-button {
      display: inline-block;
      background: linear-gradient(135deg, #0F2A4D 0%, #00ACC1 100%);
      color: white;
      padding: 15px 40px;
      text-decoration: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      transition: transform 0.2s;
    }
    .download-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.2);
    }
    .email-footer {
      padding: 20px;
      text-align: center;
      color: white;
      font-size: 14px;
      background-color: rgba(0, 0, 0, 0.1);
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1>📄 Smart-Job</h1>
    </div>
    <div class="email-body">
      <p class="greeting">${escapeHtml(greeting)},</p>
      <p class="message">${escapeHtml(message)}</p>
      <p class="document-title">${safeDocumentTitle}</p>
      <a href="${safeDocumentUrl}" class="download-button">${escapeHtml(downloadButton)}</a>
    </div>
    <div class="email-footer">
      <p>${escapeHtml(footer)}</p>
      <p style="margin-top: 10px; font-size: 12px; opacity: 0.8;">Smart-Job © ${new Date().getFullYear()}</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    // Plain Text Body
    const textBody = `
${greeting},

${message}

${safeDocumentTitle}

${downloadButton}: ${safeDocumentUrl}

---
${footer}
Smart-Job © ${new Date().getFullYear()}
    `.trim();

    return { htmlBody, textBody };
  }
}


// ============================================================================
// DOCUMENT TITLE HELPERS
// ============================================================================

/**
 * Generate document title for email subject
 * Format: "Document Type מספר X" (e.g., "חשבונית מס מספר 18")
 * 
 * @param {string} documentType - Type of document
 * @param {string|number} documentNumber - Document number
 * @param {string} [language='he'] - Language for title
 * @returns {string} Formatted document title
 */
function getDocumentTitle(documentType, documentNumber, language = 'he') {
  const numericType = typeof documentType === 'number' ? documentType : Number(documentType);
  const title = DOC_LABELS[numericType as keyof typeof DOC_LABELS]
    ? getDocumentLabel(numericType, language)
    : getDocumentLabel(DOC_TYPE.TAX_INVOICE, language);

  const numberPart = language === 'he'
    ? `מספר ${documentNumber}`
    : language === 'ar'
      ? `رقم ${documentNumber}`
      : `#${documentNumber}`;

  return `${title} ${numberPart}`;
}

/**
 * Singleton instance of email service
 */
let emailServiceInstance: AmazonSESEmailService | null = null;

/**
 * Get or create email service singleton instance
 * 
 * @returns {AmazonSESEmailService} Email service instance
 */
function getEmailServiceInstance(): AmazonSESEmailService {
  if (!emailServiceInstance) {
    emailServiceInstance = new AmazonSESEmailService();
  }
  return emailServiceInstance;
}


// ============================================================================
// EXPORTS
// ============================================================================

export { AmazonSESEmailService, getEmailServiceInstance, getDocumentTitle };

