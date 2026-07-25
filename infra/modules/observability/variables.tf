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
  type = bool
}

variable "service_names" {
  description = "Cloud Run service names keyed by workload."
  type        = map(string)
}

variable "service_locations" {
  description = "Cloud Run locations keyed by workload."
  type        = map(string)
}

variable "subscription_names" {
  description = "Durable Pub/Sub subscription names keyed by task type."
  type        = map(string)
}

variable "job_names" {
  description = "Cloud Run Job names keyed by workload."
  type        = map(string)
}

variable "slo_goal" {
  description = "Thirty-day successful-request target."
  type        = number
  default     = 0.999

  validation {
    condition     = var.slo_goal >= 0.90 && var.slo_goal < 1
    error_message = "slo_goal must be at least 0.90 and lower than 1."
  }
}

variable "notification_channels" {
  description = "Existing Monitoring notification-channel resource names."
  type        = list(string)
  default     = []
}

variable "labels" {
  type    = map(string)
  default = {}
}
