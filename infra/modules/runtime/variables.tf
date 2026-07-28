variable "project_id" {
  type = string
}

variable "environment" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "enable_runtime" {
  description = "Create workloads only after secret versions and signed images exist."
  type        = bool
}

variable "enable_otel" {
  description = "Deploy the pinned Google-built OpenTelemetry Collector sidecar for serving workloads."
  type        = bool
  default     = false
}

variable "email_ses_federation" {
  description = "Post-stabilization AWS SES federation settings. Static keys are not mounted when enabled."
  type = object({
    enabled                          = bool
    role_arn                         = string
    oidc_audience                    = string
    google_service_account_unique_id = string
  })
  default = {
    enabled                          = false
    role_arn                         = ""
    oidc_audience                    = ""
    google_service_account_unique_id = ""
  }

  validation {
    condition = !var.email_ses_federation.enabled || (
      can(regex("^arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]{1,512}$", var.email_ses_federation.role_arn))
      && length(var.email_ses_federation.oidc_audience) >= 8
      && length(var.email_ses_federation.oidc_audience) <= 256
      && can(regex("^[0-9]{10,32}$", var.email_ses_federation.google_service_account_unique_id))
    )
    error_message = "Enabled email SES federation requires a role ARN, bounded audience, and numeric Google service-account unique ID."
  }
}

variable "enable_release_jobs" {
  description = "Create only migration/smoke jobs before the first runtime apply."
  type        = bool
  default     = false
}

variable "primary_region" {
  type = string
}

variable "tax_region" {
  type = string
}

variable "network_id" {
  type = string
}

variable "primary_subnet_id" {
  type = string
}

variable "tax_subnet_id" {
  type = string
}

variable "service_accounts" {
  type = map(string)
}

variable "secret_ids" {
  type = map(string)
}

variable "secret_versions" {
  description = "Explicit enabled Secret Manager versions keyed by secret ID."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for version in values(var.secret_versions) :
      can(regex("^[1-9][0-9]*$", version))
    ])
    error_message = "Secret versions must be positive numeric version strings, never latest."
  }
}

variable "archive_bucket_name" {
  type = string
}

variable "company_files_bucket_name" {
  type = string
}

variable "backup_bucket_name" {
  type = string
}

variable "image_digests" {
  description = "Signed OCI image references pinned by sha256 digest."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for image in values(var.image_digests) :
      can(regex("^[^[:space:]]+@sha256:[0-9a-f]{64}$", image))
    ])
    error_message = "Every image must be an immutable @sha256 reference."
  }
}

variable "image_registry_prefix" {
  description = "Environment-owned Artifact Registry prefix, ending in a slash."
  type        = string
}

variable "website_origin" {
  description = "Exact public website origin, without a trailing slash."
  type        = string
}

variable "api_origin" {
  description = "Exact public API origin behind the HTTPS load balancer."
  type        = string
}

variable "tax_origin" {
  description = "Exact public tax callback origin behind the HTTPS load balancer."
  type        = string
}

variable "recaptcha_site_key" {
  description = "Public reCAPTCHA Enterprise site key."
  type        = string
}

variable "web_session_key_version" {
  description = "Non-secret identifier for the active opaque-session key."
  type        = string
  default     = "v1"
}

variable "database_connection_limit" {
  description = "Purchased PostgreSQL connection ceiling."
  type        = number

  validation {
    condition     = var.database_connection_limit >= 10
    error_message = "database_connection_limit must be at least 10."
  }
}

variable "service_max_instances" {
  description = "Hard service scaling ceilings."
  type = object({
    website = number
    api     = number
    tax     = number
    pdf     = number
    email   = number
  })

  validation {
    condition = alltrue([
      for value in values(var.service_max_instances) : value >= 1 && value == floor(value)
    ])
    error_message = "Every service maximum must be a positive integer."
  }
}

variable "database_pool_max" {
  description = "Per-instance or per-job database pool limits."
  type = object({
    api       = number
    pdf       = number
    email     = number
    archiver  = number
    migration = number
  })

  validation {
    condition = alltrue([
      for value in values(var.database_pool_max) : value >= 1 && value <= 20 && value == floor(value)
    ])
    error_message = "Every database pool maximum must be an integer from 1 through 20."
  }
}

variable "document_drain_schedule" {
  type    = string
  default = "*/2 * * * *"
}

variable "email_drain_schedule" {
  type    = string
  default = "*/2 * * * *"
}

variable "tax_drain_schedule" {
  type    = string
  default = "*/5 * * * *"
}

variable "archive_schedule" {
  type    = string
  default = "30 1 1 * *"
}

variable "backup_storage_schedule" {
  type    = string
  default = "*/15 * * * *"
}

variable "backup_database_schedule" {
  type    = string
  default = "15 2 * * *"
}

variable "labels" {
  type    = map(string)
  default = {}
}
