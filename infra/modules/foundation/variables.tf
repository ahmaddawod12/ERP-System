variable "project_id" {
  description = "Existing billed GCP project for this environment."
  type        = string
}

variable "environment" {
  description = "Deployment environment."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "name_prefix" {
  description = "Short prefix used for globally-scoped and regional resources."
  type        = string
}

variable "primary_region" {
  description = "Primary region for the website, API, workers, and jobs."
  type        = string
  default     = "europe-west3"
}

variable "tax_region" {
  description = "Israel region for the tax gateway."
  type        = string
  default     = "me-west1"
}

variable "primary_subnet_cidr" {
  description = "CIDR used by direct VPC egress in the primary region."
  type        = string
}

variable "tax_subnet_cidr" {
  description = "CIDR used by direct VPC egress in the tax region."
  type        = string
}

variable "artifact_repository_id" {
  description = "Artifact Registry repository ID for signed release images."
  type        = string
  default     = "smart-job"
}

variable "archive_bucket_name" {
  description = "Globally unique archive bucket name."
  type        = string
}

variable "backup_bucket_name" {
  description = "Globally unique backup/export bucket name."
  type        = string
}

variable "archive_retention_days" {
  description = "Minimum object retention for immutable archive content."
  type        = number

  validation {
    condition     = var.archive_retention_days >= 1
    error_message = "archive_retention_days must be positive."
  }
}

variable "backup_retention_days" {
  description = "Minimum retention for backup/export objects."
  type        = number

  validation {
    condition     = var.backup_retention_days >= 1
    error_message = "backup_retention_days must be positive."
  }
}

variable "github_repository" {
  description = "GitHub repository in owner/name form."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must use owner/name form."
  }
}

variable "github_repository_owner_id" {
  description = "Immutable numeric GitHub repository owner ID."
  type        = string

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.github_repository_owner_id))
    error_message = "github_repository_owner_id must be the immutable numeric ID."
  }
}

variable "github_deploy_workflow_ref" {
  description = "Exact workflow_ref allowed to deploy, including @ref."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/\\.github/workflows/[A-Za-z0-9_.-]+\\.ya?ml@refs/heads/[A-Za-z0-9._/-]+$", var.github_deploy_workflow_ref))
    error_message = "github_deploy_workflow_ref must be an exact branch workflow_ref."
  }
}

variable "labels" {
  description = "Additional resource labels."
  type        = map(string)
  default     = {}
}

variable "artifact_registry_reader_members" {
  description = "External principals allowed to copy signed release manifests from this repository."
  type        = set(string)
  default     = []
}
