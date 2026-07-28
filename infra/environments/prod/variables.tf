variable "project_id" {
  description = "Existing billed GCP project ID."
  type        = string
}

variable "primary_region" {
  type    = string
  default = "europe-west3"
}

variable "tax_region" {
  type    = string
  default = "me-west1"
}

variable "primary_subnet_cidr" {
  type    = string
  default = "10.60.0.0/24"
}

variable "tax_subnet_cidr" {
  type    = string
  default = "10.60.1.0/24"
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

variable "archive_retention_days" {
  description = "Provisional only; legal must approve before production apply."
  type        = number
}

variable "backup_retention_days" {
  description = "Provisional only; recovery owner must approve before production apply."
  type        = number
}

variable "lock_backup_retention" {
  type    = bool
  default = false
}

variable "backup_restore_drill_verified" {
  type    = bool
  default = false
}

variable "github_repository_owner_id" {
  description = "Immutable numeric GitHub owner ID, not the owner login."
  type        = string
}

variable "github_deploy_workflow_ref" {
  description = "Exact GitHub workflow_ref permitted by WIF."
  type        = string
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "enable_runtime" {
  description = "Enable only after secret versions and signed image digests exist."
  type        = bool
  default     = false
}

variable "enable_release_jobs" {
  description = "Create migration/smoke jobs after their image and migrator secret exist."
  type        = bool
  default     = false
}

variable "email_ses_federation" {
  description = "Enable only after the AWS federation stack and staging send/failover tests pass."
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
}

variable "image_digests" {
  description = "Signed release image references keyed by website/api/tax/pdf/email/archiver/migration."
  type        = map(string)
  default     = {}
}

variable "secret_versions" {
  description = "Enabled numeric Secret Manager versions keyed by secret container ID."
  type        = map(string)
  default     = {}
}

variable "root_domain" {
  description = "Authoritative environment DNS zone without a trailing dot."
  type        = string
}

variable "website_hostname" {
  type = string
}

variable "api_hostname" {
  type = string
}

variable "tax_hostname" {
  type = string
}

variable "recaptcha_site_key" {
  description = "Public reCAPTCHA Enterprise site key."
  type        = string
  default     = ""
}

variable "web_session_key_version" {
  type    = string
  default = "v1"
}

variable "database_connection_limit" {
  description = "Purchased Postgres connection limit used by the 70% capacity guard."
  type        = number
}

variable "service_max_instances" {
  type = object({
    website = number
    api     = number
    tax     = number
    pdf     = number
    email   = number
  })
  default = {
    website = 4
    api     = 8
    tax     = 3
    pdf     = 3
    email   = 3
  }
}

variable "database_pool_max" {
  type = object({
    api       = number
    pdf       = number
    email     = number
    archiver  = number
    migration = number
  })
  default = {
    api       = 5
    pdf       = 3
    email     = 3
    archiver  = 1
    migration = 2
  }
}

variable "armor_waf_preview" {
  type    = bool
  default = true
}

variable "notification_channels" {
  description = "Existing Monitoring notification-channel resource names."
  type        = list(string)
  default     = []

  validation {
    condition     = !var.enable_runtime || length(var.notification_channels) > 0
    error_message = "At least one Monitoring notification channel is required when runtime infrastructure is enabled."
  }
}

variable "artifact_registry_reader_members" {
  description = "External principals allowed to copy release manifests from this environment."
  type        = set(string)
  default     = []
}
