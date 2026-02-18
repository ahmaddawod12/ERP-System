# Email Delivery Service Documentation

## Overview

Smart-Job uses **Amazon SES (Simple Email Service)** for automated email delivery of generated documents. When a document is created and the client has an email address, the system automatically sends an email with the document download link.

## Amazon SES Configuration

### Prerequisites

- AWS Account
- AWS SES enabled in your region (eu-west-1 - Europe Ireland)
- Access Key ID and Secret Access Key

---

## AWS SES Setup Guide

### Step 1: Enable SES in AWS Console

1. Log into [AWS Console](https://console.aws.amazon.com)
2. Navigate to **Amazon SES** service
3. Select **Europe (Ireland) eu-west-1** region
4. Click **Get Started** if this is your first time

### Step 2: Verify Sender Email/Domain

**Option A: Single Email Verification (Quick Start)**

1. In SES Console, go to **Configuration** → **Verified identities**
2. Click **Create identity**
3. Select **Email address**
4. Enter your business email (e.g., `info@yourbusiness.com`)
5. Click **Create identity**
6. Check your email and click the verification link
7. Status will change to **Verified**

**Option B: Domain Verification (Recommended for Production)**

1. In SES Console, go to **Configuration** → **Verified identities**
2. Click **Create identity**
3. Select **Domain**
4. Enter your domain (e.g., `yourbusiness.com`)
5. Follow DNS setup instructions (add CNAME records to your domain)
6. Wait for verification (can take up to 72 hours)

### Step 3: Request Production Access

⚠️ **IMPORTANT**: New AWS accounts start in SES **Sandbox mode** which:
- Limits sending to verified email addresses only
- Caps at 200 emails/day
- Restricts sending to 1 email/second

To move to Production:

1. In SES Console, go to **Account dashboard**
2. Click **Request production access**
3. Fill out the form:
   - **Mail type**: Transactional
   - **Website URL**: Your company website
   - **Use case description**: 
     ```
     Smart-Job is a job management system that sends automated document 
     notifications (invoices, receipts, price proposals) to customers after 
     job completion. Emails contain PDF download links. Average volume: 
     [X] emails per day. All recipients have opted in by using our service.
     ```
   - **Compliance**: Confirm you have opt-in process
4. Submit request
5. Wait for approval (usually 24 hours)

### Step 4: Configure Cloud Run Service

Add these environment variables to your Cloud Run service:

```bash
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=YOUR_AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=YOUR_AWS_SECRET_ACCESS_KEY
```

**Deployment Command:**
```bash
gcloud run deploy smartjob-pdf-service \
  --set-env-vars="AWS_REGION=eu-west-1,AWS_ACCESS_KEY_ID=YOUR_AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY=YOUR_AWS_SECRET_ACCESS_KEY" \
  --region=europe-west1
```

⚠️ **Security Note**: In production, use **Google Cloud Secret Manager** instead of environment variables.

---

## Email Configuration

### Sender Email (FROM)

The sender email is **dynamically set** from the business information in each document:
- **Email**: `businessInfo.business_email` from Firestore
- **Name**: `businessInfo.business_name` from Firestore
- **Format**: `Business Name <business@email.com>`

⚠️ **Important**: The business email **MUST be verified** in AWS SES before it can send emails.

### Recipient Email (TO)

The recipient email is taken from the document's client information:
- **Email**: `client.email` from document data
- **Name**: `client.name` from document data (used in greeting)

---

## Testing Email Delivery

### Test in Sandbox Mode

While in sandbox mode, you can only send to verified email addresses.

**To test**:
1. Verify your test email in SES
2. Generate a test document with that email as client
3. Check email inbox for delivery

### Verify Email Sent Successfully

Check Cloud Run logs:
```bash
gcloud run logs read smartjob-pdf-service --region=europe-west1 --limit=50
```

Look for:
```
[SES] Email service initialized { region: 'eu-west-1' }
[SES] Email sent successfully {
  messageId: '01010194abcdef...',
  to: 'client@example.com',
  from: 'info@yourbusiness.com'
}
```

---

**Last Updated**: January 30, 2026  
**AWS Region**: eu-west-1 (Europe - Ireland)  
**Email Provider**: Amazon SES
