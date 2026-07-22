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

variable "primary_region" {
  type = string
}

variable "tax_region" {
  type = string
}

variable "service_names" {
  description = "Cloud Run service names keyed by website, api, and tax."
  type        = map(string)
}

variable "root_domain" {
  description = "Authoritative DNS zone without a trailing dot."
  type        = string
}

variable "hostnames" {
  description = "Public hostnames keyed by website, api, and tax."
  type = object({
    website = string
    api     = string
    tax     = string
  })
}

variable "armor_waf_preview" {
  description = "Preview preconfigured WAF rules before enforcement tuning."
  type        = bool
  default     = true
}

variable "rate_limits_per_minute" {
  description = "Per-client-IP request thresholds at each public backend."
  type = object({
    website = number
    api     = number
    tax     = number
  })
  default = {
    website = 600
    api     = 300
    tax     = 120
  }

  validation {
    condition = alltrue([
      for value in values(var.rate_limits_per_minute) : value >= 10 && value == floor(value)
    ])
    error_message = "Every rate limit must be an integer of at least 10 requests per minute."
  }
}

variable "labels" {
  type    = map(string)
  default = {}
}
