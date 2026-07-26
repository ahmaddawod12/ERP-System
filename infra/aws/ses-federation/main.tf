resource "aws_iam_openid_connect_provider" "google" {
  url = "https://accounts.google.com"

  # Google service-account identity tokens include azp. AWS maps azp to the
  # accounts.google.com:aud condition key and validates it as the client ID.
  client_id_list = [var.google_service_account_unique_id]
}

data "aws_iam_policy_document" "email_trust" {
  statement {
    sid     = "GoogleCloudRunEmailIdentity"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.google.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "accounts.google.com:aud"
      values   = [var.google_service_account_unique_id]
    }

    condition {
      test     = "StringEquals"
      variable = "accounts.google.com:oaud"
      values   = [var.oidc_audience]
    }

    condition {
      test     = "StringEquals"
      variable = "accounts.google.com:sub"
      values   = [var.google_service_account_unique_id]
    }
  }
}

resource "aws_iam_role" "email" {
  name                 = var.role_name
  description          = "Short-lived SES sender for the Smart-Job Cloud Run email identity"
  assume_role_policy   = data.aws_iam_policy_document.email_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "email_ses" {
  statement {
    sid       = "SendFromVerifiedIdentity"
    effect    = "Allow"
    actions   = ["ses:SendEmail"]
    resources = [var.ses_identity_arn]
  }

  statement {
    sid       = "ReadSendingAvailability"
    effect    = "Allow"
    actions   = ["ses:GetAccountSendingEnabled"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "email_ses" {
  name   = "smart-job-email-ses"
  role   = aws_iam_role.email.id
  policy = data.aws_iam_policy_document.email_ses.json
}
