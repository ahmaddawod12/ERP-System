variable "aws_region" {
  type    = string
  default = "eu-central-1"

  validation {
    condition     = can(regex("^eu-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "aws_region must be an EU AWS region."
  }
}

variable "role_name" {
  type    = string
  default = "smart-job-email-ses"

  validation {
    condition     = can(regex("^[A-Za-z0-9+=,.@_-]{1,64}$", var.role_name))
    error_message = "role_name must be a valid IAM role name."
  }
}

variable "google_service_account_unique_id" {
  description = "Immutable numeric unique ID of the Cloud Run email service account; do not use its mutable email address."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{10,32}$", var.google_service_account_unique_id))
    error_message = "google_service_account_unique_id must be the service account's numeric unique ID."
  }
}

variable "oidc_audience" {
  description = "Dedicated audience requested from the Google metadata identity endpoint."
  type        = string

  validation {
    condition     = length(var.oidc_audience) >= 8 && length(var.oidc_audience) <= 256
    error_message = "oidc_audience must contain 8-256 characters."
  }
}

variable "ses_identity_arn" {
  description = "Verified SES email/domain identity authorized as the From identity."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:ses:[a-z0-9-]+:[0-9]{12}:identity\\/.+$", var.ses_identity_arn))
    error_message = "ses_identity_arn must identify a verified SES identity."
  }
}

variable "tags" {
  type = map(string)
  default = {
    application = "smart-job"
    component   = "email"
    managed-by  = "terraform"
  }
}
